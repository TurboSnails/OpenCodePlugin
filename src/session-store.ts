import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { dirname, join } from "path"
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

// Minimal recovery, not a broker (design D7): active delegations are
// persisted to one small JSON file keyed by opencode session id, and a
// session is hydrated from that file on first access. A stale entry is
// treated as lost and surfaced explicitly instead of silently answering as
// the host.
export const STATE_FRESH_MS = 24 * 60 * 60 * 1000

export type SessionNotice =
  | { kind: "restored"; delegate: string }
  | { kind: "lost" }

type PersistedState = Record<string, { delegate: string; externalId: string; updatedAt: number }>

const hydratedSessions = new Set<string>()
const sessionNotices = new Map<string, SessionNotice>()

export function defaultStatePath(): string {
  return join(tmpdir(), "cli-dispatch-opencode", "active-delegations.json")
}

function readPersisted(statePath: string): PersistedState {
  try {
    const obj = JSON.parse(readFileSync(statePath, "utf-8"))
    return typeof obj === "object" && obj !== null ? (obj as PersistedState) : {}
  } catch {
    return {}
  }
}

function writePersisted(statePath: string, state: PersistedState): void {
  mkdirSync(dirname(statePath), { recursive: true })
  const tmp = `${statePath}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(state), "utf-8")
  renameSync(tmp, statePath)
}

export function takeSessionNotice(opencodeSessionID: string): SessionNotice | undefined {
  const notice = sessionNotices.get(opencodeSessionID)
  sessionNotices.delete(opencodeSessionID)
  return notice
}

export function getActiveDelegate(opencodeSessionID: string, statePath: string = defaultStatePath()): DelegateSession | undefined {
  const existing = sessions.get(opencodeSessionID)
  if (existing) return existing

  const hydrateKey = `${statePath}\n${opencodeSessionID}`
  if (hydratedSessions.has(hydrateKey)) return undefined
  hydratedSessions.add(hydrateKey)

  const state = readPersisted(statePath)
  const entry = state[opencodeSessionID]
  if (!entry) return undefined

  if (Date.now() - entry.updatedAt > STATE_FRESH_MS) {
    delete state[opencodeSessionID]
    writePersisted(statePath, state)
    sessionNotices.set(opencodeSessionID, { kind: "lost" })
    return undefined
  }

  const restored = { delegate: entry.delegate, externalId: entry.externalId }
  sessions.set(opencodeSessionID, restored)
  sessionNotices.set(opencodeSessionID, { kind: "restored", delegate: entry.delegate })
  return restored
}

export function setActiveDelegate(opencodeSessionID: string, delegate: string, externalId: string, statePath: string = defaultStatePath()): void {
  sessions.set(opencodeSessionID, { delegate, externalId })
  const state = readPersisted(statePath)
  state[opencodeSessionID] = { delegate, externalId, updatedAt: Date.now() }
  writePersisted(statePath, state)
}

export function clearActiveDelegate(opencodeSessionID: string, statePath: string = defaultStatePath()): void {
  sessions.delete(opencodeSessionID)
  if (!existsSync(statePath)) return
  const state = readPersisted(statePath)
  if (!(opencodeSessionID in state)) return
  delete state[opencodeSessionID]
  writePersisted(statePath, state)
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
  setActiveDelegate(opencodeSessionID, delegate, externalId)
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
