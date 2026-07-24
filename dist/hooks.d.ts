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
type MessagePartLike = {
    type: string;
    tool?: string;
};
type SessionMessageLike = {
    info: {
        role: string;
        error?: {
            name?: string;
        };
    };
    parts: MessagePartLike[];
};
export declare function findRoutingViolation(messages: SessionMessageLike[], compliantTools: Set<string>): boolean;
export type SessionIdleClient = {
    session: {
        messages: (options: {
            path: {
                id: string;
            };
        }) => Promise<{
            data?: SessionMessageLike[];
        }>;
        prompt: (options: {
            path: {
                id: string;
            };
            body: {
                noReply?: boolean;
                parts: Array<{
                    type: "text";
                    text: string;
                    synthetic?: boolean;
                }>;
            };
        }) => Promise<{
            data?: unknown;
            error?: unknown;
        }>;
    };
};
type SessionIdleEventInput = {
    event: {
        type: string;
        properties?: Record<string, unknown>;
    };
};
export declare function makeSessionIdle(config: CliDispatchConfig, client: SessionIdleClient): (input: SessionIdleEventInput) => Promise<void>;
export declare function makeToolExecuteBefore(config: CliDispatchConfig): (input: ToolExecuteBeforeInput, output: ToolExecuteBeforeOutput) => Promise<void>;
export {};
//# sourceMappingURL=hooks.d.ts.map