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
