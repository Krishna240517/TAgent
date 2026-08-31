import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import Docker from "dockerode";



const server = new McpServer({
    name: "docker-local-server",
    version: "1.0.0"
});

const docker = new Docker();

async function pullImageInternal(repository: string, tag = "latest"): Promise<void> {
    return new Promise((resolve, reject) => {
        docker.pull(`${repository}:${tag}`, (err: unknown, stream: any) => {
            if (err) {
                reject(err);
                return;
            }

            docker.modem.followProgress(stream, (progressError) => {
                if (progressError) {
                    reject(progressError);
                    return;
                }

                resolve();
            })
        })
    })
}

async function ensureImageExists(image: string): Promise<void> {
    try {
        await docker.getImage(image).inspect();
    } catch (e: any) {
        if (e?.statusCode !== 404) {
            throw e;
        }
        const lastColon = image.lastIndexOf(":");
        const lastSlash = image.lastIndexOf("/");

        const hasTag =
            lastColon > lastSlash;

        const repository = hasTag
            ? image.substring(0, lastColon)
            : image;

        const tag = hasTag
            ? image.substring(lastColon + 1)
            : "latest";

        await pullImageInternal(repository, tag);
    }
}

function dockerError(error: any): string {
    return (
        error?.json?.message ||
        error?.reason ||
        error?.message ||
        String(error)
    );
}


server.registerTool(
    "list_containers",
    {
        title: "Container Listing",
        description: "List Docker containers. Can return running containers, all containers, or only stopped containers",
        inputSchema: z.object({
            status: z.enum(["running", "stopped", "all"]).optional().default("all").describe("Which containers to list: running, stopped, or all ? ")
        }),
    },
    async ({ status }) => {
        try {
            let containers = await docker.listContainers({
                all: status != "running"
            });

            const filteredContainers = status === "stopped" ? containers.filter((container) => container.State !== "running") : containers;

            const result = filteredContainers.map((container) => ({
                id: container.Id.substring(0, 12),
                name: container.Names?.[0]?.replace(/^\//, ""),
                image: container.Image,
                state: container.State,
                status: container.Status,
                ports: container.Ports
            }));

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(result, null, 2),
                    }
                ]
            };

        } catch (error) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: `Docker Error: ${dockerError(error)}`,
                    },
                ],
            };
        }
    }
);

server.registerTool(
    "inspect_container",
    {
        title: "Inspect Container",
        description: "Get detailed configuration, networking, mounts and runtime state of a Docker container",
        inputSchema: z.object({
            containerIdOrName: z.string().min(1).describe("Container ID or Container name")
        })
    },
    async ({ containerIdOrName }) => {
        try {
            const container = docker.getContainer(containerIdOrName);
            const data = await container.inspect();

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(data, null, 2),
                    },
                ]
            }
        } catch (error) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: `Docker Error: ${dockerError(error)}`,
                    },
                ],
            };
        }
    }
);

server.registerTool(
    "run_container",
    {
        title: "Run container",
        description:
            "Create and start a new Docker container. Pulls the image automatically if it does not exist locally.",

        inputSchema: z.object({
            image: z
                .string()
                .min(1)
                .describe("Docker image, e.g. nginx:latest"),

            command: z
                .array(z.string())
                .optional()
                .describe(
                    "Command and arguments to execute, e.g. ['node', 'server.js']"
                ),

            name: z
                .string()
                .optional()
                .describe("Optional container name"),

            ports: z
                .record(z.string(), z.number().int().min(1).max(65535))
                .optional()
                .describe(
                    "Port mappings such as {'80/tcp': 8080}"
                ),

            environment: z
                .record(z.string(), z.string())
                .optional()
                .describe(
                    "Environment variables such as {'NODE_ENV': 'production'}"
                ),

            workingDir: z
                .string()
                .optional()
                .describe(
                    "Working directory inside the container, e.g. '/app'"
                ),

            memoryMb: z
                .number()
                .int()
                .positive()
                .optional()
                .describe("Maximum memory available to the container in MB"),

            cpus: z
                .number()
                .positive()
                .optional()
                .describe("Number of CPU cores available to the container"),

            restartPolicy: z
                .enum([
                    "no",
                    "always",
                    "unless-stopped",
                    "on-failure",
                ])
                .default("no"),
        }),
    },

    async ({
        image,
        command,
        name,
        ports,
        environment,
        workingDir,
        memoryMb,
        cpus,
        restartPolicy,
    }) => {
        try {
            await ensureImageExists(image);

            const ExposedPorts: Record<string, object> = {};
            const PortBindings: Record<
                string,
                Array<{ HostPort: string }>
            > = {};

            if (ports) {
                for (const [containerPort, hostPort] of Object.entries(
                    ports
                )) {
                    ExposedPorts[containerPort] = {};

                    PortBindings[containerPort] = [
                        {
                            HostPort: String(hostPort),
                        },
                    ];
                }
            }

            const Env = environment
                ? Object.entries(environment).map(
                    ([key, value]) => `${key}=${value}`
                )
                : undefined;

            const container = await docker.createContainer({
                Image: image,

                Cmd: command,

                name,

                Env,

                WorkingDir: workingDir,

                ExposedPorts:
                    Object.keys(ExposedPorts).length > 0
                        ? ExposedPorts
                        : undefined,

                HostConfig: {
                    PortBindings:
                        Object.keys(PortBindings).length > 0
                            ? PortBindings
                            : undefined,

                    Memory: memoryMb
                        ? memoryMb * 1024 * 1024
                        : undefined,

                    NanoCpus: cpus
                        ? Math.floor(cpus * 1e9)
                        : undefined,

                    RestartPolicy: {
                        Name: restartPolicy,
                    },
                },
            });

            await container.start();

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(
                            {
                                id: container.id.substring(0, 12),
                                image,
                                name: name ?? null,
                                status: "running",
                            },
                            null,
                            2
                        ),
                    },
                ],
            };
        } catch (error) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: `Docker Error: ${dockerError(error)}`,
                    },
                ],
            };
        }
    }
);

server.registerTool(
    "stop_container",
    {
        title: "Stop Container",
        description: "Gracefully stop a running Docker container.",

        inputSchema: z.object({
            containerIdOrName: z.string().min(1),

            timeout: z
                .number()
                .int()
                .min(0)
                .optional()
                .default(10)
                .describe("Seconds to wait before Docker kills the container"),
        }),
    },

    async ({ containerIdOrName, timeout }) => {
        try {
            const container = docker.getContainer(containerIdOrName);

            await container.stop({
                t: timeout,
            });

            return {
                content: [
                    {
                        type: "text",
                        text: `Container '${containerIdOrName}' stopped successfully.`,
                    },
                ],
            };
        } catch (error) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: `Docker Error: ${dockerError(error)}`,
                    },
                ],
            };
        }
    }
);

server.registerTool(
    "remove_container",
    {
        title: "Remove Container",
        description:
            "Remove a Docker container. Force can be used to remove a running container.",

        inputSchema: z.object({
            containerIdOrName: z.string().min(1),

            force: z
                .boolean()
                .optional()
                .default(false)
                .describe("Force remove a running container"),

            volumes: z
                .boolean()
                .optional()
                .default(false)
                .describe("Remove anonymous volumes attached to the container"),
        }),
    },

    async ({ containerIdOrName, force, volumes }) => {
        try {
            const container = docker.getContainer(containerIdOrName);

            await container.remove({
                force,
                v: volumes,
            });

            return {
                content: [
                    {
                        type: "text",
                        text: `Container '${containerIdOrName}' removed successfully.`,
                    },
                ],
            };
        } catch (error) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: `Docker Error: ${dockerError(error)}`,
                    },
                ],
            };
        }
    }
);

/**
 * Container logs
 */
server.registerTool(
    "container_logs",
    {
        title: "Container Logs",
        description:
            "Retrieve stdout and stderr logs from a Docker container. Supports limiting the number of lines and filtering logs by time.",

        inputSchema: z.object({
            containerIdOrName: z.string().min(1).describe("Docker container ID or name"),

            tail: z
                .number()
                .int()
                .min(1)
                .optional()
                .default(100)
                .describe("Number of log lines to return"),

            timestamps: z
                .boolean()
                .optional()
                .default(false),

            since: z.number().int().min(0).optional().describe("Return logs generated after this Unix timestamp"),
            until: z.number().int().min(0).optional().describe("Return logs generated before this Unix timestamp")
        }),
    },

    async ({ containerIdOrName, tail, timestamps, since, until }) => {
        try {
            const container = docker.getContainer(containerIdOrName);

            const logs = await container.logs({
                stdout: true,
                stderr: true,
                tail,
                timestamps,
                since,
                until
            });

            return {
                content: [
                    {
                        type: "text",
                        text: logs.toString("utf-8"),
                    },
                ],
            };
        } catch (error) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: `Docker Error: ${dockerError(error)}`,
                    },
                ],
            };
        }
    }
);

/**
 * ---------------------------------------------------------
 * IMAGE TOOLS
 * ---------------------------------------------------------
 */

/**
 * Pull image
 */
server.registerTool(
    "pull_image",
    {
        title: "Pull Docker Image",
        description:
            "Pull a Docker image from a remote registry.",

        inputSchema: z.object({
            repository: z
                .string()
                .min(1)
                .describe("Image repository, e.g. nginx"),

            tag: z
                .string()
                .optional()
                .default("latest")
                .describe("Image tag"),
        }),
    },

    async ({ repository, tag }) => {
        try {
            await pullImageInternal(repository, tag);

            return {
                content: [
                    {
                        type: "text",
                        text: `Successfully pulled ${repository}:${tag}`,
                    },
                ],
            };
        } catch (error) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: `Docker Error: ${dockerError(error)}`,
                    },
                ],
            };
        }
    }
);

server.registerTool(
    "list_images",
    {
        title: "List Docker Images",
        description: "List Docker images available locally.",

        inputSchema: z.object({}),
    },

    async () => {
        try {
            const images = await docker.listImages();

            const result = images.map((image) => ({
                id: image.Id.replace(/^sha256:/, "").substring(0, 12),

                tags: image.RepoTags || [],

                size_mb: Number(
                    (image.Size / (1024 * 1024)).toFixed(2)
                ),

                created: image.Created,
            }));

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        } catch (error) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: `Docker Error: ${dockerError(error)}`,
                    },
                ],
            };
        }
    }
);


server.registerTool(
    "remove_image",
    {
        title: "Remove Docker Image",
        description:
            "Remove a locally available Docker image.",

        inputSchema: z.object({
            image: z
                .string()
                .min(1)
                .describe("Image name, tag or ID"),

            force: z
                .boolean()
                .optional()
                .default(false)
                .describe("Force removal"),
        }),
    },

    async ({ image, force }) => {
        try {
            const dockerImage = docker.getImage(image);

            await dockerImage.remove({
                force,
            });

            return {
                content: [
                    {
                        type: "text",
                        text: `Image '${image}' removed successfully.`,
                    },
                ],
            };
        } catch (error) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: `Docker Error: ${dockerError(error)}`,
                    },
                ],
            };
        }
    }
);

server.registerTool(
    "exec_container",
    {
        title: "Execute Action Tool",
        description: "Execute a command inside a running container and get the output.",
        inputSchema: z.object({
            containerIdOrName: z.string().min(1).describe("Docker container ID or name"),
            command: z.array(z.string()).describe("Command array to execute (e.g. ['npm','test'])"),
        })
    },

    async ({ containerIdOrName, command }) => {
        const container = docker.getContainer(String(containerIdOrName));
        const exec = await container.exec({
            Cmd: command as string[],
            AttachStdout: true,
            AttachStderr: true
        });

        const stream = await exec.start({ Detach: false });

        const output = await new Promise<string>((resolve, reject) => {
            let out = "";
            stream.on("data", (chunk: Buffer) => {
                // dockerode streams multiplex stdout/stderr, stripping headers makes it cleaner
                // but for simplicity toString() works for text output
                out += chunk.toString("utf-8");
            });
            stream.on("end", () => resolve(out));
            stream.on("error", reject);
        });

        const inspectData = await exec.inspect();

        return {
            content:[
                {
                    type:"text",
                    text: JSON.stringify({ exitCode: inspectData.ExitCode, output: output.trim() }, null, 2)
                }
            ]
        }
    }
)


server.registerTool(
    "restart_container",
    {
        title:"Restart Container Tool",
        description: "Restart a container",
        inputSchema: z.object({
            containerIdOrName: z.string().min(1).describe("Docker container ID or Name"),
            timeout: z.number().optional().default(10).describe("Time in seconds")
        })
    },

    async({containerIdOrName, timeout}) => {
        const container = docker.getContainer(String(containerIdOrName));
        await container.restart({timeout: timeout})
        return {
            content: [{ type: "text", text: `Container restarted successfully.` }]
        };
    }
);

server.registerTool(
    "container_stats",
    {
        title:"Container Stats tool",
        description: "Get resource usage statistics (CPU, Memory, Network I/O) for a container.",
        inputSchema: z.object({
            containerIdOrName: z.string().min(1).describe("Docker container ID or Name.")
        })
    },

    async({containerIdOrName}) => {
        const container = docker.getContainer(String(containerIdOrName));
        const stats = await container.stats({stream: false});

        const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
        const systemCpuDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
        const numberCpus = stats.cpu_stats.online_cpus || stats.cpu_stats.cpu_usage.percpu_usage?.length || 1;
        const cpuPercent = systemCpuDelta > 0 && cpuDelta > 0 ? (cpuDelta / systemCpuDelta) * numberCpus * 100 : 0;

        const memoryUsageMb = stats.memory_stats.usage / (1024 * 1024);
        const memoryLimitMb = stats.memory_stats.limit / (1024 * 1024);

        const simplifiedStats = {
            cpu_percent: cpuPercent.toFixed(2) + "%",
            memory_usage_mb: memoryUsageMb.toFixed(2),
            memory_limit_mb: memoryLimitMb.toFixed(2),
            networks: stats.networks,
            pids: stats.pids_stats?.current
        };

        return {
            content: [{ type: "text", text: JSON.stringify(simplifiedStats, null, 2) }]
        };
    }
);
server.registerTool(
    "container_processes",
    {
        title: "Container Processes",
        description: "List processes running inside a container (similar to 'docker top').",
        inputSchema: z.object({
            containerIdOrName: z.string().min(1).describe("Docker container ID or name"),
        })
    },
    async ({ containerIdOrName }) => {
        const container = docker.getContainer(String(containerIdOrName));
        const top = await container.top();
        
        return {
            content: [{ type: "text", text: JSON.stringify(top, null, 2) }]
        };
    }
);

server.registerTool(
    "inspect_image",
    {
        title: "Inspect Image",
        description: "Get detailed low-level information about an image.",
        inputSchema: z.object({
            image: z.string().min(1).describe("Docker image name or ID"),
        })
    },
    async ({ image }) => {
        const img = docker.getImage(String(image));
        const data = await img.inspect();
        
        const simplifiedInfo = {
            id: data.Id,
            tags: data.RepoTags,
            created: data.Created,
            size_mb: (data.Size / (1024 * 1024)).toFixed(2),
            architecture: data.Architecture,
            os: data.Os,
            entrypoint: data.Config.Entrypoint,
            cmd: data.Config.Cmd,
            env: data.Config.Env,
            exposed_ports: data.Config.ExposedPorts
        };

        return {
            content: [{ type: "text", text: JSON.stringify(simplifiedInfo, null, 2) }]
        };
    }
);

// 6. list_networks
server.registerTool(
    "list_networks",
    {
        title: "List Networks",
        description: "List Docker networks.",
        inputSchema: z.object({})
    },
    async () => {
        const networks = await docker.listNetworks();
        const formatted = networks.map(n => ({
            id: n.Id.substring(0, 12),
            name: n.Name,
            driver: n.Driver,
            scope: n.Scope
        }));

        return {
            content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }]
        };
    }
);

// 7. inspect_network
server.registerTool(
    "inspect_network",
    {
        title: "Inspect Network",
        description: "Get detailed information about a Docker network, including attached containers.",
        inputSchema: z.object({
            networkIdOrName: z.string().min(1).describe("Docker network ID or name"),
        })
    },
    async ({ networkIdOrName }) => {
        const network = docker.getNetwork(String(networkIdOrName));
        const data = await network.inspect();
        
        return {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }]
        };
    }
);

// 8. list_volumes
server.registerTool(
    "list_volumes",
    {
        title: "List Volumes",
        description: "List Docker volumes.",
        inputSchema: z.object({})
    },
    async () => {
        const data = await docker.listVolumes();
        const formatted = data.Volumes.map(v => ({
            name: v.Name,
            driver: v.Driver,
            mountpoint: v.Mountpoint,
            labels: v.Labels
        }));

        return {
            content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }]
        };
    }
);

// 9. container_health
server.registerTool(
    "container_health",
    {
        title: "Container Health",
        description: "Check the explicit health status of a container.",
        inputSchema: z.object({
            containerIdOrName: z.string().min(1).describe("Docker container ID or name"),
        })
    },
    async ({ containerIdOrName }) => {
        const container = docker.getContainer(String(containerIdOrName));
        const data = await container.inspect();
        
        if (!data.State.Health) {
            return { 
                content: [{ type: "text", text: "No healthcheck configured for this container." }] 
            };
        }
        
        const healthData = {
            status: data.State.Health.Status,
            failing_streak: data.State.Health.FailingStreak,
            last_checks: data.State.Health.Log?.slice(-3) || [] // Keep just the last 3 for brevity
        };

        return {
            content: [{ type: "text", text: JSON.stringify(healthData, null, 2) }]
        };
    }
);

// 10. container_wait
server.registerTool(
    "container_wait",
    {
        title: "Container Wait",
        description: "Block until a container stops, then return the exit code.",
        inputSchema: z.object({
            containerIdOrName: z.string().min(1).describe("Docker container ID or name"),
        })
    },
    async ({ containerIdOrName }) => {
        const container = docker.getContainer(String(containerIdOrName));
        const response = await container.wait();
        
        return {
            content: [{ type: "text", text: JSON.stringify({ exitCode: response.StatusCode }, null, 2) }]
        };
    }
);

// 11. build_image
server.registerTool(
    "build_image",
    {
        title: "Build Image",
        description: "Build a Docker image from a local context path.",
        inputSchema: z.object({
            contextPath: z.string().min(1).describe("Absolute path to the build context"),
            tag: z.string().min(1).describe("Name and optionally a tag in the 'name:tag' format"),
            dockerfile: z.string().optional().default("Dockerfile").describe("Path to Dockerfile relative to context_path")
        })
    },
    async ({ contextPath, tag, dockerfile }) => {
        const { exec } = await import("child_process");
        const { promisify } = await import("util");
        const execAsync = promisify(exec);
        
        try {
            // Using CLI to smoothly handle context mapping & .dockerignore
            const { stdout, stderr } = await execAsync(`docker build -t ${tag} -f ${dockerfile} .`, { cwd: contextPath });
            return {
                content: [{ type: "text", text: `Image built successfully.\n\nLogs:\n${stdout}` }]
            };
        } catch (err: any) {
            return {
                content: [{ type: "text", text: `Build failed.\n\nError: ${err.message}\n\nStderr: ${err.stderr}\n\nStdout: ${err.stdout}` }],
                isError: true
            };
        }
    }
);

export default server;