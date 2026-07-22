import { type DoctorContext } from "./context";
import type { RunDelegateFn } from "../health-check";
export declare function makeDoctorTool(run?: RunDelegateFn, overrides?: Partial<DoctorContext>): {
    description: string;
    args: {};
    execute(args: Record<string, never>, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
};
//# sourceMappingURL=tool.d.ts.map