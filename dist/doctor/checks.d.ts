import type { RunDelegateFn } from "../health-check";
import { type DoctorContext } from "./context";
import { type CheckResult } from "./check-utils";
export { makeContext, type DoctorContext } from "./context";
export { type CheckResult, which } from "./check-utils";
export declare function runChecks(ctx: DoctorContext, run: RunDelegateFn): Promise<CheckResult[]>;
export declare function applyFixes(results: CheckResult[], ctx: DoctorContext): CheckResult[];
//# sourceMappingURL=checks.d.ts.map