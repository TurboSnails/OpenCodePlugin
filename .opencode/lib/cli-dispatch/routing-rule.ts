import type { DelegateName } from "./session-store"

export function buildRoutingRule(delegate: DelegateName): string {
  return [
    `DELEGATION ACTIVE: this conversation is delegated to the ${delegate} CLI.`,
    `Take the user's latest message verbatim — including any command-injected instructions — and pass it as the "prompt" argument to the ${delegate}_reply tool.`,
    `Return the tool's output to the user without adding your own commentary.`,
    `Do not answer the message yourself, even if other instructions tell you to.`,
  ].join(" ")
}
