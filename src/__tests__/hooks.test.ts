import { describe, it, expect } from "bun:test"
import { makeChatMessage } from "../hooks"
import { getSessionAgent } from "../session-store"

describe("makeChatMessage", () => {
  it("caches the session's agent from chat.message input", async () => {
    const hook = makeChatMessage()
    await hook({ sessionID: "chat-msg-session-1", agent: "plan" }, { parts: [] })

    expect(getSessionAgent("chat-msg-session-1")).toBe("plan")
  })

  it("leaves any previously cached agent untouched when input has none", async () => {
    const hook = makeChatMessage()
    await hook({ sessionID: "chat-msg-session-2", agent: "build" }, { parts: [] })
    await hook({ sessionID: "chat-msg-session-2" }, { parts: [] })

    expect(getSessionAgent("chat-msg-session-2")).toBe("build")
  })
})
