// Claude Code PreToolUse hook entrypoint: reads the hook payload from stdin,
// blocks a delegate-tool call whose prompt is the whole command template via
// stderr + exit code 2 (design.md D3), otherwise exits 0.
import { loadAdapterConfig } from "./config"
import { checkPreToolUse, type PreToolUseInput } from "./pretooluse-check"

const raw = await Bun.stdin.text()
let input: PreToolUseInput = {}
try {
  input = JSON.parse(raw)
} catch {
  // Unparseable payload: nothing to check, allow the call.
}

const verdict = checkPreToolUse(input, loadAdapterConfig())
if (verdict.block) {
  console.error(verdict.reason)
  process.exit(2)
}
