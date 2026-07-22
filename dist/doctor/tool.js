import { tool } from "@opencode-ai/plugin";
import { runChecks } from "./checks";
import { makeContext } from "./context";
import { formatResults } from "./format";
import { runDelegate } from "../run-delegate";
export function makeDoctorTool(run = runDelegate, overrides = {}) {
    return tool({
        description: "Diagnose the cli-dispatch installation: plugin registration, config file validity, delegate binaries on PATH, CLI authentication, writability probe, and slash command freshness. Returns one line per check with a fix hint for the first failure.",
        args: {},
        async execute(_args, context) {
            const ctx = makeContext({ cwd: context.directory ?? process.cwd(), ...overrides });
            const results = await runChecks(ctx, run);
            return formatResults(results);
        },
    });
}
//# sourceMappingURL=tool.js.map