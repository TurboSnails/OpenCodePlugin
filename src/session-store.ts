export type DelegateSession = {
  delegate: string
  externalId: string
}

const sessions = new Map<string, DelegateSession>()
const sessionAgents = new Map<string, string>()
const startSequences = new Map<string, number>()

export function getActiveDelegate(opencodeSessionID: string): DelegateSession | undefined {
  return sessions.get(opencodeSessionID)
}

export function setActiveDelegate(opencodeSessionID: string, delegate: string, externalId: string): void {
  sessions.set(opencodeSessionID, { delegate, externalId })
}

export function clearActiveDelegate(opencodeSessionID: string): void {
  sessions.delete(opencodeSessionID)
}

// Monotonic per-session sequence for `*_start` calls. When concurrent starts
// race, only the latest initiated start may register its delegation — an
// earlier start that finishes later must not overwrite it.
export function beginDelegateStart(opencodeSessionID: string): number {
  const next = (startSequences.get(opencodeSessionID) ?? 0) + 1
  startSequences.set(opencodeSessionID, next)
  return next
}

export function isLatestDelegateStart(opencodeSessionID: string, sequence: number): boolean {
  return startSequences.get(opencodeSessionID) === sequence
}

export function getSessionAgent(opencodeSessionID: string): string | undefined {
  return sessionAgents.get(opencodeSessionID)
}

export function setSessionAgent(opencodeSessionID: string, agent: string): void {
  sessionAgents.set(opencodeSessionID, agent)
}
