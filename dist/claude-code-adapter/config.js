import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { validateDelegates } from "../config";
// One or more word/dot/hyphen characters, optionally ending in a trailing "*"
// wildcard (e.g. "claude-sonnet-5", "claude-*"), or a lone "*".
const MODEL_PATTERN_RE = /^(\*|[\w.-]+\*?)$/;
export function isValidModelPattern(entry) {
    return typeof entry === "string" && MODEL_PATTERN_RE.test(entry);
}
export function matchesModelPattern(model, patterns) {
    return patterns.some((pattern) => {
        if (pattern === "*")
            return true;
        if (pattern.endsWith("*"))
            return model.startsWith(pattern.slice(0, -1));
        return model === pattern;
    });
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
        return ["config must be an object"];
    }
    const obj = config;
    if (typeof obj.delegates !== "object" || obj.delegates === null) {
        return ['"delegates" must be an object'];
    }
    const errors = [];
    if (obj.verifiedModels !== undefined) {
        if (!Array.isArray(obj.verifiedModels)) {
            errors.push('"verifiedModels" must be an array of model-string patterns');
        }
        else {
            for (const entry of obj.verifiedModels) {
                if (!isValidModelPattern(entry)) {
                    errors.push(`"verifiedModels" entry ${JSON.stringify(entry)} must be a bare model string, optionally ending in a trailing "*" wildcard`);
                }
            }
        }
    }
    errors.push(...validateDelegates(obj.delegates));
    return errors;
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
                const errors = validateAdapterConfig(config);
                if (errors.length > 0) {
                    throw new Error(`Invalid config at ${path}:\n  - ${errors.join("\n  - ")}`);
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