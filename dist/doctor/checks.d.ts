import { type RunDelegateFn } from "../health-check";
export interface CheckResult {
    id: string;
    label: string;
    ok: boolean;
    detail: string;
    fixHint?: string;
}
export type { DoctorContext } from "./context";
export { makeContext } from "./context";
import type { DoctorContext } from "./context";
export declare function runChecks(ctx: DoctorContext, run: RunDelegateFn): Promise<CheckResult[]>;
export declare function applyFixes(results: CheckResult[], ctx: DoctorContext): CheckResult[];
//# sourceMappingURL=checks.d.ts.map