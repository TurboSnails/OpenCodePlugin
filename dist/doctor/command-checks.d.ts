import type { CliDispatchConfig } from "../config";
import type { DoctorContext } from "./context";
import { type CheckResult } from "./check-utils";
export declare function checkSlashCommands(config: CliDispatchConfig, ctx: DoctorContext): CheckResult;
export declare function fixSlashCommands(r: CheckResult, ctx: DoctorContext): CheckResult;
//# sourceMappingURL=command-checks.d.ts.map