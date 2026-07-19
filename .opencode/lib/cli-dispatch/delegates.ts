export const DELEGATE_BINARIES = {
  codex: "codex",
  claude: "claude",
  kimi: "kimi",
} as const

export function buildCodexStartArgs(prompt: string): string[] {
  return ["exec", "--json", "-c", "sandbox_mode=read-only", "--skip-git-repo-check", "--", prompt]
}

export function buildCodexReplyArgs(threadId: string, prompt: string): string[] {
  return [
    "exec",
    "resume",
    threadId,
    "--json",
    "-c",
    "sandbox_mode=read-only",
    "--skip-git-repo-check",
    "--",
    prompt,
  ]
}

export function buildClaudeStartArgs(sessionId: string, prompt: string): string[] {
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "dontAsk",
    "--session-id",
    sessionId,
    "--",
    prompt,
  ]
}

export function buildClaudeReplyArgs(sessionId: string, prompt: string): string[] {
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "dontAsk",
    "--resume",
    sessionId,
    "--",
    prompt,
  ]
}

export function buildKimiStartArgs(prompt: string): string[] {
  return ["--print", "--output-format", "stream-json", "--prompt", prompt]
}

export function buildKimiReplyArgs(sessionId: string, prompt: string): string[] {
  return ["--print", "--output-format", "stream-json", "-r", sessionId, "--prompt", prompt]
}
