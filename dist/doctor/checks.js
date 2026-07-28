import { loadConfigForContext, } from "./check-utils";
import { checkPluginRegistered, checkConfigFile, checkOpencodeCompat, fixPluginRegistration, checkDuplicatePluginRegistration, fixDuplicatePluginRegistration, checkServerLoadManifest } from "./env-checks";
import { checkBinaries, checkAuthenticated, checkWritability, checkPluginTools } from "./delegate-checks";
import { checkSlashCommands, fixSlashCommands } from "./command-checks";
export { makeContext } from "./context";
export { which } from "./check-utils";
export async function runChecks(ctx, run) {
    const results = [];
    let config = { delegates: {} };
    const safe = async (id, label, fn) => {
        try {
            return await fn();
        }
        catch (err) {
            return {
                id,
                label,
                ok: false,
                detail: err instanceof Error ? err.message : String(err),
            };
        }
    };
    results.push(await safe("plugin-registered", "Plugin registered", () => checkPluginRegistered(ctx)));
    results.push(await safe("duplicate-plugin-registration", "Duplicate plugin registration", () => checkDuplicatePluginRegistration(ctx)));
    results.push(await safe("server-load-manifest", "Server load manifest", () => checkServerLoadManifest(ctx)));
    const configOutcome = await safe("config-file", "Config file", () => checkConfigFile(ctx).result);
    // config needs to be loaded outside safe() so subsequent checks can use it
    try {
        config = loadConfigForContext(ctx);
    }
    catch {
        config = { delegates: {} };
    }
    results.push(configOutcome);
    results.push(await safe("plugin-tools", "Plugin tools", () => checkPluginTools(ctx, config)));
    results.push(await safe("opencode-compat", "OpenCode compatibility", () => checkOpencodeCompat(ctx)));
    results.push(await safe("delegate-binaries", "Delegate binaries", () => checkBinaries(config, ctx)));
    results.push(await safe("cli-authenticated", "CLI authentication", () => checkAuthenticated(config, ctx)));
    results.push(await safe("writability-probe", "Writability probe", () => checkWritability(config, run)));
    results.push(await safe("slash-commands", "Slash commands", () => checkSlashCommands(config, ctx)));
    return results;
}
export function applyFixes(results, ctx) {
    return results.map((r) => {
        if (r.ok)
            return r;
        if (r.id === "slash-commands")
            return fixSlashCommands(r, ctx);
        if (r.id === "plugin-registered")
            return fixPluginRegistration(r, ctx);
        if (r.id === "duplicate-plugin-registration")
            return fixDuplicatePluginRegistration(r, ctx);
        return r;
    });
}
//# sourceMappingURL=checks.js.map