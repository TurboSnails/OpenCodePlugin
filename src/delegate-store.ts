// One store interface behind both hosts (design D6). The atomic
// setActiveDelegateIfLatest closes the check-then-set race by interface:
// only the latest initiated start may register its delegation.
export type DelegateSession = {
  delegate: string
  externalId: string
}

export interface DelegateStore {
  getActiveDelegate(sessionKey: string): DelegateSession | undefined
  setActiveDelegate(sessionKey: string, delegate: string, externalId: string): void
  clearActiveDelegate(sessionKey: string): void
  // Monotonic per-session sequence for start calls; pass the returned value
  // to setActiveDelegateIfLatest when the run finishes.
  beginDelegateStart(sessionKey: string): number
  // Registers the delegation only if `sequence` is still the latest started
  // sequence for the session. Returns whether it registered.
  setActiveDelegateIfLatest(sessionKey: string, delegate: string, externalId: string, sequence: number): boolean
}
