import type { CliDispatchConfig } from "../config";
import { type RunDelegateFn } from "../health-check";
import type { DoctorContext } from "./context";
import { type CheckResult } from "./check-utils";
export declare function checkPluginTools(ctx: DoctorContext, config: CliDispatchConfig, loadTools?: () => Promise<string[]>): Promise<CheckResult>;
export declare function checkBinaries(config: CliDispatchConfig, ctx: DoctorContext): CheckResult;
export declare function checkAuthenticated(config: CliDispatchConfig, ctx: DoctorContext): CheckResult;
export declare function checkWritability(config: CliDispatchConfig, run: RunDelegateFn): Promise<CheckResult>;
//# sourceMappingURL=delegate-checks.d.ts.map