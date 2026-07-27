import { existsSync, accessSync, constants } from "fs";
import { join, delimiter, isAbsolute } from "path";
import { fileURLToPath } from "url";
import { loadConfig, getConfigSearchPaths, DEFAULT_CONFIG } from "../config";
export const PKG = "opencode-cli-dispatch";
export function resolveConfigPath(ctx) {
    if (ctx.configPath)
        return ctx.configPath;
    return getConfigSearchPaths(undefined, ctx.homeDir, ctx.cwd).find((p) => existsSync(p));
}
export function loadConfigForContext(ctx) {
    const path = resolveConfigPath(ctx);
    if (!path)
        return DEFAULT_CONFIG;
    return loadConfig(path);
}
export function ownPackageJsonPath() {
    return fileURLToPath(new URL("../../package.json", import.meta.url));
}
export function globalCommandsDir(ctx) {
    return join(ctx.homeDir, ".config", "opencode", "commands");
}
export function execAccessFlag() {
    return process.platform === "win32" ? constants.F_OK : constants.X_OK;
}
export function which(binary, pathEnv) {
    const flag = execAccessFlag();
    const isWin = process.platform === "win32";
    if (isAbsolute(binary)) {
        if (!existsSync(binary))
            return false;
        try {
            accessSync(binary, flag);
            return true;
        }
        catch {
            return false;
        }
    }
    const names = isWin ? [binary, `${binary}.exe`, `${binary}.cmd`, `${binary}.bat`] : [binary];
    for (const name of names) {
        for (const dir of pathEnv.split(delimiter)) {
            if (!dir)
                continue;
            try {
                accessSync(join(dir, name), flag);
                return true;
            }
            catch {
                // not here
            }
        }
    }
    return false;
}
//# sourceMappingURL=check-utils.js.map