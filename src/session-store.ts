import type { DelegateStore } from "./delegate-store"

export type { DelegateSession } from "./delegate-store"
import type { DelegateSession } from "./delegate-store"

export type SessionModel = {
  providerID: string
  modelID: string
}

const sessions = new Map<string, DelegateSession>()
const sessionAgents = new Map<string, string>()
const sessionModels = new Map<string, SessionModel>()
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

// Atomic variant of the beginDelegateStart/isLatestDelegateStart pair: an
// earlier start that finishes later cannot overwrite a newer delegation.
export function setActiveDelegateIfLatest(opencodeSessionID: string, delegate: string, externalId: string, sequence: number): boolean {
  if (startSequences.get(opencodeSessionID) !== sequence) return false
  sessions.set(opencodeSessionID, { delegate, externalId })
  return true
}

export const memoryDelegateStore: DelegateStore = {
  getActiveDelegate,
  setActiveDelegate,
  clearActiveDelegate,
  beginDelegateStart,
  setActiveDelegateIfLatest,
}

export function getSessionAgent(opencodeSessionID: string): string | undefined {
  return sessionAgents.get(opencodeSessionID)
}

export function setSessionAgent(opencodeSessionID: string, agent: string): void {
  sessionAgents.set(opencodeSessionID, agent)
}

export function getSessionModel(opencodeSessionID: string): SessionModel | undefined {
  return sessionModels.get(opencodeSessionID)
}

export function setSessionModel(opencodeSessionID: string, model: SessionModel): void {
  sessionModels.set(opencodeSessionID, model)
}
