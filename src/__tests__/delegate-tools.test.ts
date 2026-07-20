import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { snapshotWorktree, buildChangeSummary } from "../delegate-tools"

let dir: string

function git(...args: string[]) {
  const result = Bun.spawnSync(
    ["git", "-c", "user.email=test@test", "-c", "user.name=test", ...args],
    { cwd: dir },
  )
  if (!result.success) throw new Error(`git ${args[0]} failed: ${result.stderr.toString()}`)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cli-dispatch-git-test-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function initRepoWithCommit() {
  git("init")
  writeFileSync(join(dir, "config.ts"), "export const x = 1\n")
  git("add", ".")
  git("commit", "-m", "init")
}

describe("snapshotWorktree", () => {
  it("returns null outside a git repository", () => {
    expect(snapshotWorktree(dir)).toBeNull()
  })

  it("returns empty string for a clean repository", () => {
    initRepoWithCommit()
    expect(snapshotWorktree(dir)).toBe("")
  })
})

describe("buildChangeSummary", () => {
  it("returns null when nothing changed", () => {
    initRepoWithCommit()
    const snap = snapshotWorktree(dir)!
    expect(buildChangeSummary(snap, snap, dir)).toBeNull()
  })

  it("summarizes tracked modifications and new untracked files", () => {
    initRepoWithCommit()
    const before = snapshotWorktree(dir)!

    writeFileSync(join(dir, "config.ts"), "export const x = 2\n")
    writeFileSync(join(dir, "notes.md"), "hello\n")

    const after = snapshotWorktree(dir)!
    const summary = buildChangeSummary(before, after, dir)

    expect(summary).not.toBeNull()
    expect(summary).toContain("Changed during this run:")
    expect(summary).toContain("config.ts")
    expect(summary).toContain("new file: notes.md")
  })

  it("does not list untracked files that existed before the run", () => {
    initRepoWithCommit()
    writeFileSync(join(dir, "old-scratch.txt"), "was here\n")
    const before = snapshotWorktree(dir)!

    writeFileSync(join(dir, "config.ts"), "export const x = 2\n")

    const after = snapshotWorktree(dir)!
    const summary = buildChangeSummary(before, after, dir)

    expect(summary).not.toBeNull()
    expect(summary).toContain("config.ts")
    expect(summary).not.toContain("old-scratch.txt")
  })
})
