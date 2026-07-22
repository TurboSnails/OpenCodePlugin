import { type ClaudeCodeAdapterConfig } from "./config";
export declare const HOME_COMMAND = "/cc";
export type UserPromptSubmitInput = {
    session_id: string;
    transcript_path?: string;
    prompt: string;
};
export type UserPromptSubmitDecision = {
    kind: "none";
} | {
    kind: "inject";
    context: string;
} | {
    kind: "block";
    reason: string;
};
export declare function decideUserPromptSubmit(input: UserPromptSubmitInput, config: ClaudeCodeAdapterConfig, stateDir?: string): UserPromptSubmitDecision;
//# sourceMappingURL=userpromptsubmit-logic.d.ts.map