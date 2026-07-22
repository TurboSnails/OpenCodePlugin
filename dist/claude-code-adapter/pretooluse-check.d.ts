import { type ClaudeCodeAdapterConfig } from "./config";
export declare const MCP_SERVER_NAME = "cli-dispatch";
export declare function mcpToolName(delegate: string, kind: "start" | "reply"): string;
export type PreToolUseInput = {
    tool_name?: string;
    tool_input?: Record<string, unknown>;
    transcript_path?: string;
};
export type PreToolUseVerdict = {
    block: false;
} | {
    block: true;
    reason: string;
};
export declare function checkPreToolUse(input: PreToolUseInput, config: ClaudeCodeAdapterConfig): PreToolUseVerdict;
//# sourceMappingURL=pretooluse-check.d.ts.map