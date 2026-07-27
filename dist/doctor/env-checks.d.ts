import type { CliDispatchConfig } from "../config";
import type { DoctorContext } from "./context";
import { type CheckResult } from "./check-utils";
export declare function checkPluginRegistered(ctx: DoctorContext): CheckResult;
export declare function checkDuplicatePluginRegistration(ctx: DoctorContext): CheckResult;
export declare function fixDuplicatePluginRegistration(r: CheckResult, ctx: DoctorContext): CheckResult;
export declare function checkOpencodeCompat(ctx: DoctorContext): CheckResult;
export declare function checkConfigFile(ctx: DoctorContext): {
    result: CheckResult;
    config: CliDispatchConfig;
};
export declare function fixPluginRegistration(r: CheckResult, ctx: DoctorContext): CheckResult;
//# sourceMappingURL=env-checks.d.ts.map