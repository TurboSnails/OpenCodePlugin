// MCP server exposing the delegate tools to Codex. One stdio server process
// per Codex host; the current session id is read from the file written by
// the UserPromptSubmit hook (design.md D-store).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadCodexAdapterConfig } from "./config";
import { startDelegate, replyDelegate } from "./delegate-tools";
import { codexFileDelegateStore, readCurrentSession } from "./session-store";
import { MCP_SERVER_NAME, STATUS_TOOL_NAME } from "./constants";
export { MCP_SERVER_NAME };
export function mcpToolName(delegate, kind) {
    return `mcp__${MCP_SERVER_NAME}__${delegate}_${kind}`;
}
export function listCodexDelegateTools(config) {
    return [...Object.keys(config.delegates).flatMap((name) => [`${name}_start`, `${name}_reply`]), STATUS_TOOL_NAME];
}
function errorResult(err) {
    return { content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }], isError: true };
}
export function makeCodexMcpServer(config) {
    const server = new McpServer({ name: MCP_SERVER_NAME, version: "1.0.0" });
    for (const [name, cfg] of Object.entries(config.delegates)) {
        server.registerTool(`${name}_start`, {
            description: `Start a new ${name} CLI session with the given task and return ${name}'s response. Use this the first time a conversation is delegated to ${name}.`,
            inputSchema: { prompt: z.string().describe("The user's message, verbatim") },
        }, async ({ prompt }) => {
            try {
                const text = await startDelegate(name, cfg, prompt);
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
                const text = await replyDelegate(name, cfg, prompt);
                return { content: [{ type: "text", text }] };
            }
            catch (err) {
                return errorResult(err);
            }
        });
    }
    server.registerTool(STATUS_TOOL_NAME, {
        description: "Report the active CLI delegation status for the current Codex session.",
        inputSchema: {},
    }, async () => {
        const sessionId = readCurrentSession();
        if (!sessionId) {
            return { content: [{ type: "text", text: "No active Codex session is known yet." }] };
        }
        const active = codexFileDelegateStore().getActiveDelegate(sessionId);
        if (!active) {
            return { content: [{ type: "text", text: "No CLI delegation is active for this session." }] };
        }
        return {
            content: [
                {
                    type: "text",
                    text: `Active delegation: ${active.delegate} (external session ${active.externalId}). Use /prompts:opencode to exit.`,
                },
            ],
        };
    });
    return server;
}
export async function runCodexMcpServer() {
    const config = loadCodexAdapterConfig();
    const server = makeCodexMcpServer(config);
    await server.connect(new StdioServerTransport());
}
if (import.meta.main) {
    await runCodexMcpServer();
}
//# sourceMappingURL=mcp-server.js.map