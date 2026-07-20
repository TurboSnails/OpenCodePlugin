import type { DelegateConfig } from "./config";
import { runDelegate } from "./run-delegate";
export type RunDelegateFn = typeof runDelegate;
export type HealthCheckResult = {
    ok: boolean;
    detail: string;
};
export declare function checkDelegate(name: string, cfg: DelegateConfig, run?: RunDelegateFn): Promise<HealthCheckResult>;
export declare function makeCheckTool(name: string, cfg: DelegateConfig, run?: RunDelegateFn): {
    description: string;
    args: {};
    execute(args: Record<string, never>, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
};
//# sourceMappingURL=health-check.d.ts.map