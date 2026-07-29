import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { validateDelegates } from "../config";
import { isValidVerifiedModelPattern, matchesVerifiedModel } from "../policy";
export function isValidModelPattern(entry) {
    return isValidVerifiedModelPattern(entry, "bare");
}
export function matchesModelPattern(model, patterns) {
    return matchesVerifiedModel(model, patterns);
}
const DEFAULT_CONFIG = {
    delegates: {
        codex: {
            binary: "codex",
            parser: "codex",
            startArgs: ["exec", "--json", "-c", "sandbox_mode=workspace-write", "--skip-git-repo-check", "--", "{prompt}"],
            replyArgs: [
                "exec",
                "resume",
                "--json",
                "-c",
                "sandbox_mode=workspace-write",
                "--skip-git-repo-check",
                "--",
                "{externalId}",
                "{prompt}",
            ],
        },
        opencode: {
            binary: "opencode",
            parser: "opencode",
            startArgs: ["run", "--format", "json", "--", "{prompt}"],
            replyArgs: ["run", "--format", "json", "-s", "{externalId}", "-c", "--", "{prompt}"],
        },
    },
};
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
    issues.push(...validateDelegates(obj.delegates));
    return issues;
}
export function loadAdapterConfig(configPath) {
    const searchPaths = configPath
        ? [configPath]
        : [join(process.cwd(), "claude-code-adapter.config.json")];
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
    console.warn("[cli-dispatch] No claude-code-adapter.config.json found; using safe built-in defaults (codex runs with sandbox_mode=workspace-write, opencode with no permission-escalating flags). Place claude-code-adapter.config.json in your project root to configure delegates.");
    return DEFAULT_CONFIG;
}
//# sourceMappingURL=config.js.map