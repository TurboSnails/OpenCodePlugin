export type UserPromptSubmitInput = {
    session_id?: string;
    prompt?: string;
};
export type UserPromptSubmitOutput = {
    continue?: boolean;
    systemMessage?: string;
    hookSpecificOutput?: {
        hookEventName: "UserPromptSubmit";
        additionalContext?: string;
    };
    decision?: "block";
    reason?: string;
};
export declare function handleUserPromptSubmit(input: UserPromptSubmitInput, stateDir?: string): UserPromptSubmitOutput;
//# sourceMappingURL=user-prompt-submit.d.ts.map