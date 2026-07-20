export type DelegateSession = {
  delegate: string
  externalId: string
}

const sessions = new Map<string, DelegateSession>()

export function getActiveDelegate(opencodeSessionID: string): DelegateSession | undefined {
  return sessions.get(opencodeSessionID)
}

export function setActiveDelegate(opencodeSessionID: string, delegate: string, externalId: string): void {
  sessions.set(opencodeSessionID, { delegate, externalId })
}

export function clearActiveDelegate(opencodeSessionID: string): void {
  sessions.delete(opencodeSessionID)
}
