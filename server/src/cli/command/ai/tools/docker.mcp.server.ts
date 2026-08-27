import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
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
        inputSchema: {
            running: z
                .boolean()
                .optional()
                .default(false)
                .describe("Only return currently running containers"),

            all: z
                .boolean()
                .optional()
                .default(true)
                .describe("Include stopped containers"),

            nonRunning: z
                .boolean()
                .optional()
                .default(false)
                .describe("Only return containers that are not running"),
        },
    },
    async ({ running, all, nonRunning }) => {
        try {
            let containers = await docker.listContainers({
                all: all || nonRunning,
            });


            if (running) {
                containers = containers.filter((container) => container.State === "running")
            } else if (nonRunning) {
                containers = containers.filter((container) => container.State !== "running")
            }

            const result = containers.map((container) => ({
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
        inputSchema: {
            containerIdOrName: z.string().min(1).describe("Container ID or Container name")
        }
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
        description: "Create and start a new Docker container. Pulls the image automatically if it does not exist locally.",
        inputSchema: {
            image: z.string().min(1).describe("Docker image, e.g. nginx:latest"),
            command: z.string().optional().describe("Command to execute inside the container"),
            name: z.string().optional().describe("Optional container name"),
            ports: z.record(z.string(), z.number()).optional().describe("Port mappings such as {'80/tcp': 8080}"),

            environment: z.record(z.string(), z.string()).optional().describe("Environment variables such as {'NODE_ENV': 'production'}"),
        }
    },

    async ({ image, command, name, ports, environment }) => {
        try {
            await ensureImageExists(image);

            const ExposedPorts: Record<string, {}> = {};
            const PortBindings: Record<
                string,
                Array<{ HostPort: string }>
            > = {};

            if (ports) {
                for (const [containerPort, hostPort] of Object.entries(ports)) {
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

                Cmd: command
                    ? command.split(/\s+/)
                    : undefined,

                name,

                Env,

                ExposedPorts:
                    Object.keys(ExposedPorts).length > 0
                        ? ExposedPorts
                        : undefined,

                HostConfig: {
                    PortBindings:
                        Object.keys(PortBindings).length > 0
                            ? PortBindings
                            : undefined,
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
                                name,
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



export default server;