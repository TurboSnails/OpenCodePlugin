import type { DelegateConfig } from "./config";
import { runDelegate } from "./run-delegate";
export type RunDelegateFn = typeof runDelegate;
export declare function snapshotWorktree(cwd: string): string | null;
export declare function buildChangeSummary(before: string, after: string, cwd: string): string | null;
export declare function makeStartTool(name: string, cfg: DelegateConfig, run?: RunDelegateFn): {
    description: string;
    args: {
        prompt: import("zod").ZodString;
    };
    execute(args: {
        prompt: string;
    }, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
};
export declare function makeReplyTool(name: string, cfg: DelegateConfig, run?: RunDelegateFn): {
    description: string;
    args: {
        prompt: import("zod").ZodString;
    };
    execute(args: {
        prompt: string;
    }, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
};
//# sourceMappingURL=delegate-tools.d.ts.map