export type DelegateName = "codex" | "claude" | "kimi"

export type DelegateSession = {
  delegate: DelegateName
  externalId: string
}

const sessions = new Map<string, DelegateSession>()

export function getActiveDelegate(opencodeSessionID: string): DelegateSession | undefined {
  return sessions.get(opencodeSessionID)
}

export function setActiveDelegate(
  opencodeSessionID: string,
  delegate: DelegateName,
  externalId: string,
): void {
  sessions.set(opencodeSessionID, { delegate, externalId })
}

export function clearActiveDelegate(opencodeSessionID: string): void {
  sessions.delete(opencodeSessionID)
}
