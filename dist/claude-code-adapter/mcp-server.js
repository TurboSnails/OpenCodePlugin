// MCP server exposing the delegate tools to Claude Code. One stdio server
// subprocess per Claude Code session; the subprocess's own
// CLAUDE_CODE_SESSION_ID env var matches the hooks' session_id and keys the
// file-backed session store (design.md D8).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadAdapterConfig } from "./config";
import { startDelegate, replyDelegate } from "./delegate-tools";
import { MCP_SERVER_NAME } from "./pretooluse-check";
function claudeSessionId() {
    const id = process.env.CLAUDE_CODE_SESSION_ID;
    if (!id) {
        throw new Error("CLAUDE_CODE_SESSION_ID is not set; delegate tools must run inside a Claude Code session.");
    }
    return id;
}
function errorResult(err) {
    return { content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }], isError: true };
}
const config = loadAdapterConfig();
const server = new McpServer({ name: MCP_SERVER_NAME, version: "1.0.0" });
for (const [name, cfg] of Object.entries(config.delegates)) {
    server.registerTool(`${name}_start`, {
        description: `Start a new ${name} CLI session with the given task and return ${name}'s response. Use this the first time a conversation is delegated to ${name}.`,
        inputSchema: { prompt: z.string().describe("The user's message, verbatim") },
    }, async ({ prompt }) => {
        try {
            const text = await startDelegate(name, cfg, claudeSessionId(), prompt);
            return { content: [{ type: "text", text }] };
        }
        catch (err) {
            return errorResult(err);
        }
    });
    server.registerTool(`${name}_reply`, {
        description: `Continue the active ${name} CLI session for this conversation with a follow-up message. Requires ${name}_start to have been called first.`,
        inputSchema: { prompt: z.string().describe("The user's message, verbatim") },
    }, async ({ prompt }) => {
        try {
            const text = await replyDelegate(name, cfg, claudeSessionId(), prompt);
            return { content: [{ type: "text", text }] };
        }
        catch (err) {
            return errorResult(err);
        }
    });
}
await server.connect(new StdioServerTransport());
//# sourceMappingURL=mcp-server.js.map