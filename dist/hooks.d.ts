import { type CliDispatchConfig } from "./config";
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
    model?: {
        providerID: string;
        modelID: string;
    };
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
export declare function makeCommandBefore(config: CliDispatchConfig): (input: CommandBeforeInput, output: CommandBeforeOutput) => Promise<void>;
type ToolExecuteBeforeInput = {
    tool: string;
    sessionID: string;
    callID: string;
};
type ToolExecuteBeforeOutput = {
    args: any;
};
export declare function makeToolExecuteBefore(config: CliDispatchConfig): (input: ToolExecuteBeforeInput, output: ToolExecuteBeforeOutput) => Promise<void>;
export {};
//# sourceMappingURL=hooks.d.ts.map