import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { validateArgvInjection } from "./policy";
import { isValidVerifiedModelPattern, matchesVerifiedModel as matchesVerifiedModelPolicy } from "./policy";
export function isValidVerifiedModelEntry(entry) {
    return isValidVerifiedModelPattern(entry, "provider-model");
}
export function matchesVerifiedModel(model, patterns) {
    return matchesVerifiedModelPolicy(model, patterns);
}
export const DEFAULT_CONFIG = {
    delegates: {
        claude: {
            binary: "claude",
            parser: "claude",
            startArgs: [
                "-p",
                "--output-format",
                "stream-json",
                "--verbose",
                "--permission-mode",
                "acceptEdits",
                "--session-id",
                "{sessionId}",
                "--",
                "{prompt}",
            ],
            replyArgs: [
                "-p",
                "--output-format",
                "stream-json",
                "--verbose",
                "--permission-mode",
                "acceptEdits",
                "--resume",
                "{externalId}",
                "--",
                "{prompt}",
            ],
        },
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
    },
};
export function validateDelegates(delegates) {
    const issues = [];
    const error = (message) => issues.push({ level: "error", message });
    const warning = (message) => issues.push({ level: "warning", message });
    for (const [name, delegate] of Object.entries(delegates)) {
        if (!/^[\w-]+$/.test(name)) {
            error(`delegate "${name}": name must match /^[\\w-]+$/ (letters, digits, underscore, hyphen) or it would produce invalid tool names`);
        }
        if (typeof delegate !== "object" || delegate === null) {
            error(`delegate "${name}": must be an object`);
            continue;
        }
        const d = delegate;
        if (typeof d.binary !== "string") {
            error(`delegate "${name}": missing or invalid "binary" field`);
        }
        if (typeof d.parser !== "string" || !["claude", "codex", "opencode", "raw"].includes(d.parser)) {
            error(`delegate "${name}": "parser" must be "claude", "codex", "opencode", or "raw"`);
        }
        if (!Array.isArray(d.startArgs) || !d.startArgs.every((a) => typeof a === "string")) {
            error(`delegate "${name}": "startArgs" must be an array of strings`);
        }
        else {
            if (!d.startArgs.some((a) => a.includes("{prompt}"))) {
                error(`delegate "${name}": "startArgs" must contain the {prompt} placeholder, otherwise the CLI runs without the user's task`);
            }
            const argvError = validateArgvInjection(name, "startArgs", d.startArgs);
            if (argvError)
                error(argvError);
        }
        if (!Array.isArray(d.replyArgs) || !d.replyArgs.every((a) => typeof a === "string")) {
            error(`delegate "${name}": "replyArgs" must be an array of strings`);
        }
        else {
            if (!d.replyArgs.some((a) => a.includes("{externalId}"))) {
                // Warning only: a raw delegate without any session concept may
                // legitimately have nothing to resume.
                warning(`[cli-dispatch] delegate "${name}": "replyArgs" has no {externalId} placeholder; ${name}_reply will not be able to resume a session`);
            }
            const argvError = validateArgvInjection(name, "replyArgs", d.replyArgs);
            if (argvError)
                error(argvError);
        }
        if (d.timeoutMs !== undefined && (typeof d.timeoutMs !== "number" || !(d.timeoutMs > 0))) {
            error(`delegate "${name}": "timeoutMs" must be a positive number`);
        }
    }
    return issues;
}
function validateConfig(config) {
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
            issues.push({ level: "error", message: '"verifiedModels" must be an array of "provider/model" strings' });
        }
        else {
            for (const entry of obj.verifiedModels) {
                if (!isValidVerifiedModelEntry(entry)) {
                    issues.push({
                        level: "error",
                        message: `"verifiedModels" entry ${JSON.stringify(entry)} must be a "provider/model" string, each segment optionally ending in a trailing "*" wildcard`,
                    });
                }
            }
        }
    }
    issues.push(...validateDelegates(obj.delegates));
    return issues;
}
export function getConfigSearchPaths(configPath, homeDir = homedir(), cwd = process.cwd()) {
    if (configPath)
        return [configPath];
    return [
        join(cwd, "cli-dispatch.config.json"),
        join(cwd, ".opencode", "cli-dispatch.config.json"),
        join(cwd, ".opencode", "lib", "cli-dispatch", "config.json"),
        join(homeDir, ".config", "opencode", "cli-dispatch.config.json"),
    ];
}
export function loadConfig(configPath) {
    const searchPaths = getConfigSearchPaths(configPath);
    for (const path of searchPaths) {
        if (existsSync(path)) {
            try {
                const raw = readFileSync(path, "utf-8");
                const config = JSON.parse(raw);
                const issues = validateConfig(config);
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
    console.warn("[cli-dispatch] No cli-dispatch.config.json found; using safe built-in defaults (claude runs with --permission-mode acceptEdits, codex with sandbox_mode=workspace-write). Place cli-dispatch.config.json in your project root to configure delegates; an explicit bypassPermissions entry remains available as an opt-in escalation.");
    return DEFAULT_CONFIG;
}
export function resolveArgs(args, vars) {
    return args.map((arg) => {
        let result = arg;
        for (const [key, value] of Object.entries(vars)) {
            result = result.replaceAll(`{${key}}`, value);
        }
        return result;
    });
}
//# sourceMappingURL=config.js.map