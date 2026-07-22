// Claude Code UserPromptSubmit hook entrypoint: reads the hook payload from
// stdin, then either stays silent (exit 0), injects the sticky routing rule
// as additive context (stdout + exit 0), or suppresses the prompt entirely
// (stderr + exit 2) for the home command / unverified model (design.md D4).
import { loadAdapterConfig } from "./config";
import { decideUserPromptSubmit } from "./userpromptsubmit-logic";
const raw = await Bun.stdin.text();
let input;
try {
    input = JSON.parse(raw);
}
catch {
    process.exit(0);
}
const decision = decideUserPromptSubmit(input, loadAdapterConfig());
switch (decision.kind) {
    case "inject":
        console.log(decision.context);
        break;
    case "block":
        console.error(decision.reason);
        process.exit(2);
    case "none":
        break;
}
//# sourceMappingURL=userpromptsubmit-cli.js.map