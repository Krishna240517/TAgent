import { MCPToolset } from "@google/adk";
import { getGithubAccessToken } from "../../../../lib/github.token.js";
import { getStoredDockerCreds } from "../../auth/docker.auth.js";



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

    getTools(server: string): MCPToolset | undefined {
        return this.servers.get(server);
    }

    getAllTools(): MCPToolset[] {
        return Array.from(this.servers.values());
    }
}