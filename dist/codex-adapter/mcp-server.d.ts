import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type CodexAdapterConfig } from "./config";
import { MCP_SERVER_NAME } from "./constants";
export { MCP_SERVER_NAME };
export declare function mcpToolName(delegate: string, kind: "start" | "reply"): string;
export declare function listCodexDelegateTools(config: CodexAdapterConfig): string[];
export declare function makeCodexMcpServer(config: CodexAdapterConfig): McpServer;
export declare function runCodexMcpServer(): Promise<void>;
//# sourceMappingURL=mcp-server.d.ts.map