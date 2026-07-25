#!/usr/bin/env bun
import { setupCodexAdapter, uninstallCodexAdapter, doctorCodexAdapter } from "./setup";
export async function runCodexCli() {
    const action = process.argv[3];
    const dryRun = process.argv.includes("--dry-run");
    if (action === "setup") {
        const changes = setupCodexAdapter({ dryRun });
        console.log(changes.join("\n"));
        if (dryRun)
            console.log("\n(dry-run: no files were written)");
        else
            console.log("\nDone. Run /hooks in Codex to trust the new hooks, then restart Codex.");
        return;
    }
    if (action === "uninstall") {
        const changes = uninstallCodexAdapter({ dryRun });
        console.log(changes.join("\n"));
        if (dryRun)
            console.log("\n(dry-run: no files were written)");
        return;
    }
    if (action === "doctor") {
        console.log(doctorCodexAdapter().join("\n"));
        return;
    }
    console.error("Usage: cli-dispatch codex <setup|uninstall|doctor> [--dry-run]");
    process.exit(1);
}
if (import.meta.main) {
    await runCodexCli();
}
//# sourceMappingURL=cli.js.map