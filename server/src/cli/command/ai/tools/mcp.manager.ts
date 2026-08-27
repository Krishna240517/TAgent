import { MCPToolset } from "@google/adk";
import { getGithubAccessToken } from "../../../../lib/github.token.js";
import { getStoredDockerCreds } from "../../auth/docker.auth.js";
import os from "os";
import path from "path";



export class MCPManager {
    private servers: Map<string, MCPToolset>;

    constructor() {
        this.servers = new Map();
    }


    static async create(): Promise<MCPManager> {
        const manager = new MCPManager();
        await manager.initialize();
        return manager;
    }

    private async initialize(): Promise<void> {
        this.servers.set("github", await this.createGithubToolSet());
        this.servers.set("docker-hub", await this.createDockerHubToolSet());
        this.servers.set("docker-local",this.createDockerLocalToolSet());
        this.servers.set("kubernetes",this.createKubernetesToolSet());
    }

    private async createGithubToolSet(): Promise<MCPToolset> {
        const githubToken = await getGithubAccessToken();

        const githubToolSet = new MCPToolset({
            type: "StdioConnectionParams",

            serverParams: {
                command: "docker",

                args: [
                    "run",
                    "-i",
                    "--rm",
                    "-e",
                    "GITHUB_PERSONAL_ACCESS_TOKEN",
                    "ghcr.io/github/github-mcp-server"
                ],
                env: {
                    GITHUB_PERSONAL_ACCESS_TOKEN: githubToken
                }
            }
        });
        return githubToolSet;
    }

    private async createDockerHubToolSet(): Promise<MCPToolset> {
        const dockerCreds = await getStoredDockerCreds();
        const dockerMcpToolSet = new MCPToolset({
            type: "StdioConnectionParams",
            serverParams: {
                command: "docker",
                args: [
                    "run",
                    "-i",
                    "--rm",
                    "-e",
                    "HUB_PAT_TOKEN",
                    "mcp/dockerhub",
                    "--transport=stdio",
                    `--username=${dockerCreds?.username}`
                ],
                env: {
                    HUB_PAT_TOKEN: dockerCreds?.patToken ?? "";
                }
            }
        })

        return dockerMcpToolSet;
    }

    private createDockerLocalToolSet(): MCPToolset {
        return new MCPToolset({
            type: "StdioConnectionParams",
            serverParams: {
                command: "npx",
                args: [
                    "-y",
                    "@hypnosis/docker-mcp-server" // <-- This handles LOCAL containers
                ]
            }
        });
    }

    private createKubernetesToolSet(): MCPToolset {
        const kubeConfigPath = path.join(os.homedir(), ".kube", "config");
        return new MCPToolset({
            type:"StdioConnectionParams",
            serverParams: {
                command:"npx",
                args:[
                    "-y",
                    "@smithery/kubernetes-mcp-server@latest"
                ],
                env:{
                    KUBECONFIG: kubeConfigPath,
                    PATH: process.env.PATH
                }
            }
        });
    }
    /**
     One architectural point for your project: later, when your agent runs inside your GKE sandbox, don't blindly reuse the host's ~/.kube/config. The Kubernetes MCP server supports in-cluster configuration, so the sandbox can authenticate to its Kubernetes cluster using its service-account identity instea
     */

    getTools(server: string): MCPToolset | undefined {
        return this.servers.get(server);
    }

    getAllTools(): MCPToolset[] {
        return Array.from(this.servers.values());
    }
}