import { type CodexAdapterConfig } from "../config";
export type PreToolUseInput = {
    tool_name?: string;
    tool_input?: Record<string, unknown>;
    model?: string;
};
export type PreToolUseOutput = {
    hookSpecificOutput?: {
        hookEventName: "PreToolUse";
        permissionDecision: "deny";
        permissionDecisionReason: string;
    };
};
export declare function handlePreToolUse(input: PreToolUseInput, config?: CodexAdapterConfig): PreToolUseOutput | undefined;
//# sourceMappingURL=pre-tool-use.d.ts.map