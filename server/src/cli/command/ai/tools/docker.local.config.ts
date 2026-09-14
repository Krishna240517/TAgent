import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import server from "./docker.mcp.tool.js"

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
};

main().catch((e) => {
    console.error("Failed to start Docker MCP server:", e);
    process.exit(1);
})