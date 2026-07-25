#!/usr/bin/env bun
const subcommand = process.argv[2];
if (subcommand === "codex") {
    const { runCodexCli } = await import("../codex-adapter/cli.js");
    await runCodexCli();
}
else {
    const { runChecks, applyFixes } = await import("./checks");
    const { makeContext } = await import("./context");
    const { formatResults } = await import("./format");
    const { runDelegate } = await import("../run-delegate");
    const fix = process.argv.includes("--fix");
    const ctx = makeContext();
    const results = await runChecks(ctx, runDelegate);
    const final = fix ? applyFixes(results, ctx) : results;
    console.log(formatResults(final));
    process.exit(final.some((r) => !r.ok) ? 1 : 0);
}
export {};
//# sourceMappingURL=run-cli.js.map