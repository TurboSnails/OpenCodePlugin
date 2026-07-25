import { codexFileDelegateStore } from "../session-store"

export type SessionEndInput = { session_id?: string }

export function handleSessionEnd(input: SessionEndInput, stateDir?: string): void {
  if (!input.session_id) return
  codexFileDelegateStore(stateDir).clearActiveDelegate(input.session_id)
}
