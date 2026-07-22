import { describe, it, expect } from "bun:test"
import { mkdtempSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { startDelegateTurn, replyDelegateTurn } from "../delegate-turn"
import type { DelegateStore, DelegateSession } from "../delegate-store"
import type { DelegateConfig } from "../config"

function makeStore(): DelegateStore & { saved: Array<{ delegate: string; externalId: string; sequence: number }>; failIfLatest: boolean } {
  let active: DelegateSession | undefined
  let sequence = 0
  const store = {
    saved: [] as Array<{ delegate: string; externalId: string; sequence: number }>,
    failIfLatest: false,
    getActiveDelegate: () => active,
    setActiveDelegate: (_key: string, delegate: string, externalId: string) => { active = { delegate, externalId } },
    clearActiveDelegate: () => { active = undefined },
    beginDelegateStart: () => ++sequence,
    setActiveDelegateIfLatest: (_key: string, delegate: string, externalId: string, seq: number) => {
      if (store.failIfLatest) return false
      store.saved.push({ delegate, externalId, sequence: seq })
      active = { delegate, externalId }
      return true
    },
  }
  return store as DelegateStore & { saved: Array<{ delegate: string; externalId: string; sequence: number }>; failIfLatest: boolean }
}

const codexConfig: DelegateConfig = {
  binary: "codex",
  parser: "codex",
  startArgs: ["exec", "--", "{prompt}"],
  replyArgs: ["exec", "resume", "--", "{externalId}", "{prompt}"],
}

describe("startDelegateTurn", () => {
  it("registers the validated CLI-reported externalId", async () => {
    const store = makeStore()
    const fakeRun = async () => ({ finalText: "hi", externalId: "thread-12345", stderrText: "" })
    const reply = await startDelegateTurn({
      name: "codex", cfg: codexConfig, store, sessionKey: "s1", prompt: "hello",
      homeCommand: "/cc", onProgress: () => {}, run: fakeRun as any,
      cwd: mkdtempSync(join(tmpdir(), "delegate-turn-test-")),
    })
    expect(reply).toBe("hi")
    expect(store.saved).toEqual([{ delegate: "codex", externalId: "thread-12345", sequence: 1 }])
  })

  it("ignores a reported externalId outside the conservative pattern and falls back to the client-generated id", async () => {
    const store = makeStore()
    const fakeRun = async () => ({ finalText: "hi", externalId: "-p rm -rf", stderrText: "" })
    await startDelegateTurn({
      name: "codex", cfg: codexConfig, store, sessionKey: "s1", prompt: "hello",
      homeCommand: "/cc", onProgress: () => {}, run: fakeRun as any,
      cwd: mkdtempSync(join(tmpdir(), "delegate-turn-test-")),
    })
    expect(store.saved).toHaveLength(1)
    expect(store.saved[0].externalId).not.toBe("-p rm -rf")
    expect(store.saved[0].externalId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it("still returns the result when an older start loses the race", async () => {
    const store = makeStore()
    store.failIfLatest = true
    const fakeRun = async () => ({ finalText: "late", externalId: "thread-late1", stderrText: "" })
    const reply = await startDelegateTurn({
      name: "codex", cfg: codexConfig, store, sessionKey: "s1", prompt: "hello",
      homeCommand: "/cc", onProgress: () => {}, run: fakeRun as any,
      cwd: mkdtempSync(join(tmpdir(), "delegate-turn-test-")),
    })
    expect(reply).toBe("late")
    expect(store.saved).toEqual([])
  })

  it("returns a failure message with the host home command when the run throws", async () => {
    const store = makeStore()
    const fakeRun = async () => { throw new Error("codex timed out after 50ms") }
    const reply = await startDelegateTurn({
      name: "codex", cfg: codexConfig, store, sessionKey: "s1", prompt: "hello",
      homeCommand: "/cc", onProgress: () => {}, run: fakeRun as any,
      cwd: mkdtempSync(join(tmpdir(), "delegate-turn-test-")),
    })
    expect(reply).toBe("codex failed: codex timed out after 50ms. Use /cc to exit delegation.")
    expect(store.saved).toEqual([])
  })
})

describe("replyDelegateTurn", () => {
  it("throws when no session is active for the delegate", async () => {
    const store = makeStore()
    await expect(
      replyDelegateTurn({
        name: "codex", cfg: codexConfig, store, sessionKey: "s1", prompt: "hello",
        homeCommand: "/opencode", onProgress: () => {},
        cwd: mkdtempSync(join(tmpdir(), "delegate-turn-test-")),
      }),
    ).rejects.toThrow("No active codex session for this conversation. Call codex_start first.")
  })

  it("resolves replyArgs with the stored externalId and uses the host home command on failure", async () => {
    const store = makeStore()
    store.setActiveDelegate("s1", "codex", "thread-abc123")
    let seenArgs: string[] = []
    const fakeRun = async (opts: { args: string[] }) => { seenArgs = opts.args; throw new Error("boom") }
    const reply = await replyDelegateTurn({
      name: "codex", cfg: codexConfig, store, sessionKey: "s1", prompt: "next",
      homeCommand: "/opencode", onProgress: () => {}, run: fakeRun as any,
      cwd: mkdtempSync(join(tmpdir(), "delegate-turn-test-")),
    })
    expect(seenArgs).toEqual(["exec", "resume", "--", "thread-abc123", "next"])
    expect(reply).toBe("codex failed: boom. Use /opencode to exit delegation.")
  })
})
