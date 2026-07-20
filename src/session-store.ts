export type DelegateSession = {
  delegate: string
  externalId: string
}

const sessions = new Map<string, DelegateSession>()
const sessionAgents = new Map<string, string>()

export function getActiveDelegate(opencodeSessionID: string): DelegateSession | undefined {
  return sessions.get(opencodeSessionID)
}

export function setActiveDelegate(opencodeSessionID: string, delegate: string, externalId: string): void {
  sessions.set(opencodeSessionID, { delegate, externalId })
}

export function clearActiveDelegate(opencodeSessionID: string): void {
  sessions.delete(opencodeSessionID)
}

export function getSessionAgent(opencodeSessionID: string): string | undefined {
  return sessionAgents.get(opencodeSessionID)
}

export function setSessionAgent(opencodeSessionID: string, agent: string): void {
  sessionAgents.set(opencodeSessionID, agent)
}
