import { existsSync, readFileSync, readdirSync, writeFileSync, copyFileSync, renameSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";
import { PKG, resolveConfigPath, loadConfigForContext, ownPackageJsonPath, which } from "./check-utils";
export function checkPluginRegistered(ctx) {
    const candidates = [
        join(ctx.cwd, "opencode.json"),
        join(ctx.cwd, "opencode.jsonc"),
        join(ctx.homeDir, ".config", "opencode", "opencode.json"),
        join(ctx.homeDir, ".config", "opencode", "opencode.jsonc"),
    ];
    for (const path of candidates) {
        if (existsSync(path) && readFileSync(path, "utf-8").includes(PKG)) {
            return { id: "plugin-registered", label: "Plugin registered", ok: true, detail: `declared in ${path}` };
        }
    }
    const wrapperDirs = [
        join(ctx.cwd, ".opencode", "plugin"),
        join(ctx.homeDir, ".config", "opencode", "plugins"),
    ];
    for (const dir of wrapperDirs) {
        if (!existsSync(dir))
            continue;
        for (const file of readdirSync(dir)) {
            if (!/\.(ts|js)$/.test(file))
                continue;
            if (readFileSync(join(dir, file), "utf-8").includes(PKG)) {
                return { id: "plugin-registered", label: "Plugin registered", ok: true, detail: `wrapper ${join(dir, file)}` };
            }
        }
    }
    return {
        id: "plugin-registered",
        label: "Plugin registered",
        ok: false,
        detail: "no opencode.json(c) plugin entry or plugin wrapper file mentions opencode-cli-dispatch",
        fixHint: `Add to opencode.json: { "plugin": ["${PKG}"] } — or create a wrapper file. ` +
            `Run "cli-dispatch doctor --fix" to patch an existing opencode.json automatically.`,
    };
}
function wrapperIsDevGated(text) {
    return text.includes("CLI_DISPATCH_DEV") || text.includes("createLocalCliDispatchPlugin");
}
function wrapperIsActive(text) {
    return wrapperIsDevGated(text) ? process.env.CLI_DISPATCH_DEV === "1" : true;
}
function isCliDispatchWrapper(text) {
    return (text.includes(PKG) ||
        text.includes("createCliDispatchPlugin") ||
        text.includes("createLocalCliDispatchPlugin"));
}
export function checkDuplicatePluginRegistration(ctx) {
    const configCandidates = [
        join(ctx.cwd, "opencode.json"),
        join(ctx.cwd, "opencode.jsonc"),
        join(ctx.homeDir, ".config", "opencode", "opencode.json"),
        join(ctx.homeDir, ".config", "opencode", "opencode.jsonc"),
    ];
    const declaredIn = configCandidates.find((path) => existsSync(path) && readFileSync(path, "utf-8").includes(PKG));
    const wrapperDirs = [
        join(ctx.cwd, ".opencode", "plugin"),
        join(ctx.homeDir, ".config", "opencode", "plugins"),
    ];
    const activeWrappers = [];
    const inactiveDevWrappers = [];
    for (const dir of wrapperDirs) {
        if (!existsSync(dir))
            continue;
        for (const file of readdirSync(dir)) {
            if (!/\.(ts|js)$/.test(file))
                continue;
            const path = join(dir, file);
            const text = readFileSync(path, "utf-8");
            if (!isCliDispatchWrapper(text))
                continue;
            if (wrapperIsActive(text))
                activeWrappers.push(path);
            else
                inactiveDevWrappers.push(path);
        }
    }
    if (declaredIn && activeWrappers.length > 0) {
        return {
            id: "duplicate-plugin-registration",
            label: "Duplicate plugin registration",
            ok: false,
            detail: `plugin is declared in ${declaredIn} and also loaded by wrapper(s): ${activeWrappers.join(", ")}`,
            fixHint: "Keep one registration source. For this repo's old dogfood wrapper, run \"cli-dispatch doctor --fix\"; otherwise disable the wrapper or unset CLI_DISPATCH_DEV.",
        };
    }
    if (declaredIn && inactiveDevWrappers.length > 0) {
        return {
            id: "duplicate-plugin-registration",
            label: "Duplicate plugin registration",
            ok: true,
            detail: `dev-gated wrapper present but disabled: ${inactiveDevWrappers.join(", ")}`,
        };
    }
    return {
        id: "duplicate-plugin-registration",
        label: "Duplicate plugin registration",
        ok: true,
        detail: "no duplicate registration",
    };
}
export function fixDuplicatePluginRegistration(r, ctx) {
    const pluginDir = join(ctx.cwd, ".opencode", "plugin");
    if (!existsSync(pluginDir))
        return r;
    const disabled = [];
    for (const file of readdirSync(pluginDir)) {
        if (!/\.(ts|js)$/.test(file))
            continue;
        const path = join(pluginDir, file);
        const text = readFileSync(path, "utf-8");
        const isOldDogfoodWrapper = text.includes('from "../../src/index"') &&
            text.includes("createCliDispatchPlugin") &&
            !wrapperIsDevGated(text);
        if (!isOldDogfoodWrapper)
            continue;
        copyFileSync(path, `${path}.bak`);
        renameSync(path, `${path}.disabled`);
        disabled.push(path);
    }
    if (disabled.length === 0) {
        return { ...r, detail: `${r.detail} (no old always-on dogfood wrapper found to disable — apply the fixHint manually)` };
    }
    return { ...r, ok: true, detail: `disabled old dogfood wrapper(s): ${disabled.join(", ")}` };
}
export function checkOpencodeCompat(ctx) {
    if (!which("opencode", ctx.pathEnv)) {
        return { id: "opencode-compat", label: "OpenCode compatibility", ok: true, detail: "opencode not on PATH; skipped" };
    }
    const res = spawnSync("opencode", ["--version"], {
        encoding: "utf-8",
        timeout: 5000,
        env: { ...process.env, PATH: ctx.pathEnv },
        shell: process.platform === "win32",
    });
    const opencodeVersion = (res.stdout ?? "").trim();
    if (!/^\d+\.\d+\.\d+/.test(opencodeVersion)) {
        return { id: "opencode-compat", label: "OpenCode compatibility", ok: true, detail: `could not parse opencode version (${opencodeVersion}); skipped` };
    }
    const pkg = JSON.parse(readFileSync(ownPackageJsonPath(), "utf-8"));
    const supported = pkg.devDependencies?.["@opencode-ai/plugin"] ?? "";
    const [oMaj, oMin] = opencodeVersion.split(".");
    const [sMaj, sMin] = supported.replace(/^[^\d]*/, "").split(".");
    if (oMaj === sMaj && oMin === sMin) {
        return { id: "opencode-compat", label: "OpenCode compatibility", ok: true, detail: `opencode ${opencodeVersion} matches plugin API ${supported}` };
    }
    return {
        id: "opencode-compat",
        label: "OpenCode compatibility",
        ok: false,
        detail: `opencode ${opencodeVersion} vs plugin API ${supported} (minor mismatch)`,
        fixHint: `Align the devDependency: set "@opencode-ai/plugin" to "${opencodeVersion}" in package.json, run bun install && bun run build, then restart opencode.`,
    };
}
export function checkConfigFile(ctx) {
    const found = resolveConfigPath(ctx);
    try {
        const config = loadConfigForContext(ctx);
        if (!found) {
            return {
                result: { id: "config-file", label: "Config file", ok: true, detail: "no config file found; using built-in defaults" },
                config,
            };
        }
        return {
            result: { id: "config-file", label: "Config file", ok: true, detail: `valid config at ${found}` },
            config,
        };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            result: {
                id: "config-file",
                label: "Config file",
                ok: false,
                detail: message,
                fixHint: "Fix or remove the config file above, then re-run doctor. See docs/configuration.md for the schema.",
            },
            config: { delegates: {} },
        };
    }
}
function stripJsoncComments(text) {
    // Remove single-line comments that are not inside strings.
    const withoutLineComments = text.replace(/(^|[^:"'])(\/\/[^\r\n]*)/g, "$1");
    // Remove multi-line comments.
    const withoutBlockComments = withoutLineComments.replace(/\/\*[\s\S]*?\*\//g, "");
    return withoutBlockComments;
}
export function fixPluginRegistration(r, ctx) {
    const candidates = [
        join(ctx.cwd, "opencode.json"),
        join(ctx.cwd, "opencode.jsonc"),
        join(ctx.homeDir, ".config", "opencode", "opencode.json"),
        join(ctx.homeDir, ".config", "opencode", "opencode.jsonc"),
    ];
    for (const path of candidates) {
        if (!existsSync(path))
            continue;
        try {
            if (path.endsWith(".jsonc")) {
                const text = readFileSync(path, "utf-8");
                if (text.includes(PKG)) {
                    return { ...r, ok: true, detail: `plugin already declared in ${path}` };
                }
                const stripped = stripJsoncComments(text);
                let obj;
                try {
                    obj = JSON.parse(stripped);
                }
                catch {
                    return {
                        ...r,
                        detail: `${r.detail} (unsupported JSONC structure in ${path} — please add "${PKG}" to the plugin array manually)`,
                    };
                }
                const plugins = Array.isArray(obj.plugin) ? obj.plugin : [];
                if (!plugins.some((p) => typeof p === "string" && p.includes(PKG))) {
                    obj.plugin = [...plugins, PKG];
                }
                writeFileSync(path, JSON.stringify(obj, null, 2) + "\n", "utf-8");
                return { ...r, ok: true, detail: `added "${PKG}" to plugin array in ${path}` };
            }
            const obj = JSON.parse(readFileSync(path, "utf-8"));
            const plugins = Array.isArray(obj.plugin) ? obj.plugin : [];
            if (!plugins.some((p) => typeof p === "string" && p.includes(PKG))) {
                obj.plugin = [...plugins, PKG];
                writeFileSync(path, JSON.stringify(obj, null, 2) + "\n", "utf-8");
            }
            return { ...r, ok: true, detail: `added "${PKG}" to plugin array in ${path}` };
        }
        catch {
            // fall through to next candidate / report-only
        }
    }
    return { ...r, detail: `${r.detail} (no writable opencode.json(c) found to patch — apply the fixHint manually)` };
}
//# sourceMappingURL=env-checks.js.map