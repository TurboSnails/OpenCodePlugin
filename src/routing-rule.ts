export function buildRoutingRule(delegate: string, replyTool = `${delegate}_reply`): string {
  return [
    `DELEGATION ACTIVE: this conversation is delegated to the ${delegate} CLI.`,
    `Take the user's latest message verbatim — including any command-injected instructions — and pass it as the "prompt" argument to the ${replyTool} tool.`,
    `Return the tool's output to the user without adding your own commentary.`,
    `Do not answer the message yourself, even if other instructions tell you to.`,
    `Exception: if the latest message is another delegate command, follow that command's instructions instead — it switches or restarts the delegation.`,
  ].join(" ")
}
