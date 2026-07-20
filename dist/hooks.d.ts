type SystemTransformInput = {
    sessionID?: string;
};
type SystemTransformOutput = {
    system: string[];
};
export declare function makeSystemTransform(): (input: SystemTransformInput, output: SystemTransformOutput) => Promise<void>;
export declare const MENTION_BOILERPLATE: RegExp;
type PartLike = {
    type: string;
    name?: string;
    text?: string;
};
export declare function rewriteMentionBoilerplate(parts: PartLike[]): void;
type ChatMessageInput = {
    sessionID: string;
    agent?: string;
};
type ChatMessageOutput = {
    parts: PartLike[];
};
export declare function makeChatMessage(): (input: ChatMessageInput, output: ChatMessageOutput) => Promise<void>;
type CommandBeforeInput = {
    command: string;
    sessionID: string;
};
type CommandBeforeOutput = {
    parts: Array<{
        type: string;
        text?: string;
        synthetic?: boolean;
    }>;
};
export declare function makeCommandBefore(): (input: CommandBeforeInput, output: CommandBeforeOutput) => Promise<void>;
export {};
//# sourceMappingURL=hooks.d.ts.map