import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, statSync, readdirSync, readFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { isValidModelPattern, matchesModelPattern, loadAdapterConfig } from "../claude-code-adapter/config"
import { getCurrentModel } from "../claude-code-adapter/current-model"
import { getActiveDelegate, setActiveDelegate, clearActiveDelegate, beginDelegateStart, setActiveDelegateIfLatest, fileDelegateStore } from "../claude-code-adapter/session-store"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cli-dispatch-cc-adapter-test-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("isValidModelPattern", () => {
  it("accepts bare model strings and trailing wildcards", () => {
    expect(isValidModelPattern("claude-sonnet-5")).toBe(true)
    expect(isValidModelPattern("claude-*")).toBe(true)
    expect(isValidModelPattern("*")).toBe(true)
  })

  it("rejects provider/model pairs, non-strings, and leading wildcards", () => {
    expect(isValidModelPattern("anthropic/claude-sonnet-5")).toBe(false)
    expect(isValidModelPattern("*-sonnet")).toBe(false)
    expect(isValidModelPattern("")).toBe(false)
    expect(isValidModelPattern(42)).toBe(false)
  })
})

describe("matchesModelPattern", () => {
  it("matches exactly, by trailing wildcard, and by lone wildcard", () => {
    expect(matchesModelPattern("claude-sonnet-5", ["claude-sonnet-5"])).toBe(true)
    expect(matchesModelPattern("claude-sonnet-5", ["claude-*"])).toBe(true)
    expect(matchesModelPattern("claude-sonnet-5", ["*"])).toBe(true)
  })

  it("does not match a different model and is case-sensitive", () => {
    expect(matchesModelPattern("claude-opus-4", ["claude-sonnet-5"])).toBe(false)
    expect(matchesModelPattern("Claude-sonnet-5", ["claude-*"])).toBe(false)
    expect(matchesModelPattern("claude-sonnet-5", [])).toBe(false)
  })
})

describe("loadAdapterConfig", () => {
  const validConfig = {
    delegates: {
      codex: {
        binary: "codex",
        parser: "codex",
        startArgs: ["exec", "--", "{prompt}"],
        replyArgs: ["exec", "resume", "--", "{externalId}", "{prompt}"],
      },
    },
    verifiedModels: ["claude-*"],
  }

  it("loads a valid config file", () => {
    const path = join(dir, "config.json")
    writeFileSync(path, JSON.stringify(validConfig))
    const config = loadAdapterConfig(path)
    expect(config.delegates.codex.binary).toBe("codex")
    expect(config.verifiedModels).toEqual(["claude-*"])
  })

  it("rejects invalid verifiedModels entries", () => {
    const path = join(dir, "bad.json")
    writeFileSync(path, JSON.stringify({ ...validConfig, verifiedModels: ["anthropic/claude-*"] }))
    expect(() => loadAdapterConfig(path)).toThrow("verifiedModels")
  })

  it("reuses delegate validation for malformed delegates", () => {
    const path = join(dir, "bad-delegate.json")
    writeFileSync(
      path,
      JSON.stringify({ delegates: { codex: { binary: "codex", parser: "nope", startArgs: [], replyArgs: [] } } }),
    )
    expect(() => loadAdapterConfig(path)).toThrow('"parser" must be "claude", "codex", "opencode", or "raw"')
  })

  it("returns a default codex/opencode config when no file exists", () => {
    const config = loadAdapterConfig(join(dir, "missing.json"))
    expect(Object.keys(config.delegates).sort()).toEqual(["codex", "opencode"])
    expect(config.delegates.opencode.parser).toBe("opencode")
  })
})

describe("getCurrentModel", () => {
  it("returns the model from the last assistant line that has one", () => {
    const path = join(dir, "transcript.jsonl")
    writeFileSync(
      path,
      [
        JSON.stringify({ type: "user", message: { role: "user" } }),
        JSON.stringify({ type: "assistant", message: { model: "claude-sonnet-5" } }),
        JSON.stringify({ type: "assistant", message: { model: "claude-opus-4" } }),
        "",
      ].join("\n"),
    )
    expect(getCurrentModel(path)).toBe("claude-opus-4")
  })

  it("returns undefined when the file does not exist", () => {
    expect(getCurrentModel(join(dir, "nope.jsonl"))).toBeUndefined()
  })

  it("returns undefined when no line carries a model yet", () => {
    const path = join(dir, "first-message.jsonl")
    writeFileSync(path, JSON.stringify({ type: "user", message: { role: "user" } }) + "\nnot json\n")
    expect(getCurrentModel(path)).toBeUndefined()
  })
})

describe("session-store (file-backed)", () => {
  it("returns undefined for a session with no state", () => {
    expect(getActiveDelegate("session-none", dir)).toBeUndefined()
  })

  it("round-trips state across separate calls, keyed by session id", () => {
    setActiveDelegate("session-a", "codex", "thread-1", dir)
    setActiveDelegate("session-b", "opencode", "ses_2", dir)

    expect(getActiveDelegate("session-a", dir)).toEqual({ delegate: "codex", externalId: "thread-1" })
    expect(getActiveDelegate("session-b", dir)).toEqual({ delegate: "opencode", externalId: "ses_2" })
  })

  it("overwrites state when a different delegate starts", () => {
    setActiveDelegate("session-a", "codex", "thread-1", dir)
    setActiveDelegate("session-a", "opencode", "ses_9", dir)
    expect(getActiveDelegate("session-a", dir)).toEqual({ delegate: "opencode", externalId: "ses_9" })
  })

  it("clears state, and clearing a missing session is a no-op", () => {
    setActiveDelegate("session-a", "codex", "thread-1", dir)
    clearActiveDelegate("session-a", dir)
    expect(getActiveDelegate("session-a", dir)).toBeUndefined()
    expect(() => clearActiveDelegate("session-a", dir)).not.toThrow()
  })

  it("sanitizes session ids that are not file-name safe", () => {
    setActiveDelegate("weird/session:id", "codex", "thread-1", dir)
    expect(getActiveDelegate("weird/session:id", dir)).toEqual({ delegate: "codex", externalId: "thread-1" })
  })
})

describe("setActiveDelegateIfLatest (file store)", () => {
  it("rejects an older sequence atomically and accepts the latest", () => {
    const first = beginDelegateStart("cc-latest-1", dir)
    const second = beginDelegateStart("cc-latest-1", dir)
    expect(setActiveDelegateIfLatest("cc-latest-1", "codex", "ext-old", first, dir)).toBe(false)
    expect(getActiveDelegate("cc-latest-1", dir)).toBeUndefined()
    expect(setActiveDelegateIfLatest("cc-latest-1", "codex", "ext-new", second, dir)).toBe(true)
    expect(getActiveDelegate("cc-latest-1", dir)).toEqual({ delegate: "codex", externalId: "ext-new" })
  })

  it("fileDelegateStore implements the DelegateStore interface", () => {
    const store = fileDelegateStore(dir)
    const seq = store.beginDelegateStart("cc-latest-2")
    expect(store.setActiveDelegateIfLatest("cc-latest-2", "opencode", "ext-1", seq)).toBe(true)
    expect(store.getActiveDelegate("cc-latest-2")).toEqual({ delegate: "opencode", externalId: "ext-1" })
    store.clearActiveDelegate("cc-latest-2")
    expect(store.getActiveDelegate("cc-latest-2")).toBeUndefined()
  })
})

describe("file store modes and TTL", () => {
  it("creates the state dir with mode 0700 and state files with mode 0600", () => {
    const fresh = join(dir, "modes-subdir")
    setActiveDelegate("cc-modes-1", "codex", "ext-1", fresh)
    expect(statSync(fresh).mode & 0o777).toBe(0o700)
    const files = readdirSync(fresh).filter((f) => f.endsWith(".json") && !f.endsWith(".seq.json"))
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) {
      expect(statSync(join(fresh, f)).mode & 0o777).toBe(0o600)
    }
  })

  it("ignores entries older than 24 hours", () => {
    setActiveDelegate("cc-ttl-1", "codex", "ext-old", dir)
    const file = join(dir, "cc-ttl-1.json")
    const obj = JSON.parse(readFileSync(file, "utf-8"))
    obj.updatedAt = Date.now() - 25 * 60 * 60 * 1000
    writeFileSync(file, JSON.stringify(obj), "utf-8")
    expect(getActiveDelegate("cc-ttl-1", dir)).toBeUndefined()
  })

  it("accepts fresh entries", () => {
    setActiveDelegate("cc-ttl-2", "codex", "ext-new", dir)
    expect(getActiveDelegate("cc-ttl-2", dir)).toEqual({ delegate: "codex", externalId: "ext-new" })
  })
})
