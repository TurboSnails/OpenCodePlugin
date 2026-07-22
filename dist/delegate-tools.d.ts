import type { ToolDefinition } from "@opencode-ai/plugin";
import type { DelegateConfig } from "./config";
import { type RunDelegateFn } from "./delegate-turn";
export { snapshotWorktree, buildChangeSummary } from "./worktree-summary";
export type { RunDelegateFn } from "./delegate-turn";
export declare function makeStartTool(name: string, cfg: DelegateConfig, run?: RunDelegateFn): ToolDefinition;
export declare function makeReplyTool(name: string, cfg: DelegateConfig, run?: RunDelegateFn): ToolDefinition;
//# sourceMappingURL=delegate-tools.d.ts.map