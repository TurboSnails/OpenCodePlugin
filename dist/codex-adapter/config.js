import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { validateDelegates, loadConfig } from "../config";
import { isValidVerifiedModelPattern, matchesVerifiedModel } from "../policy";
export function isValidModelPattern(entry) {
    return isValidVerifiedModelPattern(entry, "bare");
}
export function matchesModelPattern(model, patterns) {
    return matchesVerifiedModel(model, patterns);
}
function validateAdapterConfig(config) {
    if (typeof config !== "object" || config === null) {
        return [{ level: "error", message: "config must be an object" }];
    }
    const obj = config;
    if (typeof obj.delegates !== "object" || obj.delegates === null) {
        return [{ level: "error", message: '"delegates" must be an object' }];
    }
    const issues = [];
    if (obj.verifiedModels !== undefined) {
        if (!Array.isArray(obj.verifiedModels)) {
            issues.push({ level: "error", message: '"verifiedModels" must be an array of model-string patterns' });
        }
        else {
            for (const entry of obj.verifiedModels) {
                if (!isValidModelPattern(entry)) {
                    issues.push({
                        level: "error",
                        message: `"verifiedModels" entry ${JSON.stringify(entry)} must be a bare model string, optionally ending in a trailing "*" wildcard`,
                    });
                }
            }
        }
    }
    const delegates = obj.delegates;
    if ("opencode" in delegates) {
        issues.push({
            level: "error",
            message: 'delegate "opencode" is not supported in Codex host (the name is reserved for the exit prompt); rename the delegate',
        });
    }
    issues.push(...validateDelegates(delegates));
    return issues;
}
export function getCodexConfigSearchPaths(configPath, cwd = process.cwd(), homeDir = homedir()) {
    if (configPath)
        return [configPath];
    return [
        join(cwd, "codex-adapter.config.json"),
        join(cwd, ".codex", "cli-dispatch.config.json"),
        join(homeDir, ".codex", "cli-dispatch.config.json"),
    ];
}
function loadFallbackDelegates() {
    const base = loadConfig();
    if ("opencode" in base.delegates) {
        throw new Error('delegate "opencode" is not supported in Codex host (the name is reserved for the exit prompt); rename the delegate in cli-dispatch.config.json');
    }
    return base.delegates;
}
export function loadCodexAdapterConfig(configPath) {
    const searchPaths = getCodexConfigSearchPaths(configPath);
    for (const path of searchPaths) {
        if (existsSync(path)) {
            try {
                const raw = readFileSync(path, "utf-8");
                const config = JSON.parse(raw);
                const issues = validateAdapterConfig(config);
                for (const issue of issues.filter((i) => i.level === "warning")) {
                    console.warn(issue.message);
                }
                const errors = issues.filter((i) => i.level === "error");
                if (errors.length > 0) {
                    throw new Error(`Invalid config at ${path}:\n  - ${errors.map((i) => i.message).join("\n  - ")}`);
                }
                return config;
            }
            catch (err) {
                if (err instanceof SyntaxError) {
                    throw new Error(`Failed to parse config at ${path}: ${err.message}`);
                }
                throw err;
            }
        }
    }
    return { delegates: loadFallbackDelegates() };
}
//# sourceMappingURL=config.js.map