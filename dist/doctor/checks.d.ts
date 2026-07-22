import { type RunDelegateFn } from "../health-check";
import { type DoctorContext } from "./context";
export { makeContext, type DoctorContext } from "./context";
export interface CheckResult {
    id: string;
    label: string;
    ok: boolean;
    detail: string;
    fixHint?: string;
}
export declare function runChecks(ctx: DoctorContext, run: RunDelegateFn): Promise<CheckResult[]>;
export declare function applyFixes(results: CheckResult[], ctx: DoctorContext): CheckResult[];
//# sourceMappingURL=checks.d.ts.map