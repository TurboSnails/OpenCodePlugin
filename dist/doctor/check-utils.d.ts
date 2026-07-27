import type { CliDispatchConfig } from "../config";
import type { DoctorContext } from "./context";
export interface CheckResult {
    id: string;
    label: string;
    ok: boolean;
    detail: string;
    fixHint?: string;
}
export declare const PKG = "opencode-cli-dispatch";
export declare function resolveConfigPath(ctx: DoctorContext): string | undefined;
export declare function loadConfigForContext(ctx: DoctorContext): CliDispatchConfig;
export declare function ownPackageJsonPath(): string;
export declare function globalCommandsDir(ctx: DoctorContext): string;
export declare function execAccessFlag(): number;
export declare function which(binary: string, pathEnv: string): boolean;
//# sourceMappingURL=check-utils.d.ts.map