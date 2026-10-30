import assert from "node:assert/strict"
import test from "node:test"

import plugin from "./rex-status.mjs"

process.env.REX_SESSION = "test-session"

function harness(extra = []) {
  const handlers = new Map()
  const rendererHandlers = new Map()
  const reports = []
  const statuses = new Map()
  let active = "root"
  const sessions = new Map([
    ["root", { id: "root", title: "Root session" }],
    ["other", { id: "other", title: "Other session" }],
    ["child", { id: "child", parentID: "root", title: "Child session" }],
    ...extra,
  ])
  const messages = new Map([
    ["root", [{ type: "assistant", content: [{ type: "text", text: "  All\n tests   pass. " }] }]],
  ])

  const context = {
    options: {},
    renderer: {
      setProgramStatus(status) {
        reports.push(status)
        return true
      },
      on: (type, handler) => rendererHandlers.set(type, handler),
      off: (type) => rendererHandlers.delete(type),
    },
    data: {
      on(type, handler) {
        handlers.set(type, handler)
        return () => handlers.delete(type)
      },
      session: {
        get: (id) => sessions.get(id),
        root: (id) => sessions.get(id)?.parentID ?? id,
        family: (id) => [...sessions.values()].filter((s) => s.id === id || s.parentID === id).map((s) => s.id),
        status: (id) => statuses.get(id) ?? "idle",
        message: { list: (id) => messages.get(id) ?? [] },
      },
    },
    ui: {
      router: { current: () => (active ? { type: "session", sessionID: active } : { type: "home" }) },
    },
  }

  const cleanup = plugin.setup(context)
  return {
    cleanup,
    reports,
    dispatch: (type, data) => handlers.get(type)?.({ type, data }),
    renderer: (type) => rendererHandlers.get(type)?.(),
    setActive: (id) => (active = id),
    setStatus: (id, status) => statuses.set(id, status),
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 300))

test("does nothing outside Rex", () => {
  const previous = process.env.REX_SESSION
  delete process.env.REX_SESSION
  try {
    const h = harness()
    assert.equal(h.cleanup, undefined)
  } finally {
    process.env.REX_SESSION = previous
  }
})

test("reports done on the session record and the root after the session settles", async () => {
  const h = harness()
  h.dispatch("session.execution.started", { sessionID: "root" })
  h.dispatch("session.execution.succeeded", { sessionID: "root" })
  assert.deepEqual(h.reports, [])
  await settle()

  const record = { state: "done", app: "opencode", title: "Root session", message: "All tests pass." }
  assert.deepEqual(h.reports, [{ ...record, id: "root" }, record])
  h.cleanup()
})

test("reports error with the failure message", async () => {
  const h = harness()
  h.dispatch("session.execution.started", { sessionID: "root" })
  h.dispatch("session.execution.failed", { sessionID: "root", error: { message: "Rate limited" } })
  await settle()

  assert.equal(h.reports[0].state, "error")
  assert.equal(h.reports[0].message, "Rate limited")
  h.cleanup()
})

test("skips done when the user is already looking at the session", async () => {
  const h = harness()
  h.renderer("focus")
  h.dispatch("session.execution.started", { sessionID: "root" })
  h.dispatch("session.execution.succeeded", { sessionID: "root" })
  await settle()

  assert.deepEqual(h.reports, [])
  h.cleanup()
})

test("keeps the root for sessions still working or blocked", async () => {
  const h = harness()
  h.dispatch("session.execution.started", { sessionID: "root" })
  h.dispatch("session.execution.started", { sessionID: "other" })
  h.dispatch("session.execution.succeeded", { sessionID: "root" })
  await settle()
  assert.deepEqual(h.reports.map((r) => r.id), ["root"])

  h.dispatch("permission.asked", { id: "perm", sessionID: "other" })
  h.dispatch("session.execution.succeeded", { sessionID: "other" })
  await settle()
  assert.deepEqual(h.reports.map((r) => r.id), ["root", "other"])
  h.cleanup()
})

test("ignores subagents and parents waiting on a running subagent", async () => {
  const h = harness()
  h.dispatch("session.execution.started", { sessionID: "root" })
  h.dispatch("session.execution.succeeded", { sessionID: "child" })
  h.setStatus("child", "running")
  h.dispatch("session.execution.succeeded", { sessionID: "root" })
  await settle()

  assert.deepEqual(h.reports, [])
  h.cleanup()
})

test("drops done when the session wakes again before it settles", async () => {
  const h = harness()
  h.dispatch("session.execution.started", { sessionID: "root" })
  h.dispatch("session.execution.succeeded", { sessionID: "root" })
  h.dispatch("session.execution.started", { sessionID: "root" })
  await settle()

  assert.deepEqual(h.reports, [])
  h.cleanup()
})

test("clears the record and resets the root once the user focuses the session", async () => {
  const h = harness()
  h.dispatch("session.execution.started", { sessionID: "root" })
  h.dispatch("session.execution.succeeded", { sessionID: "root" })
  await settle()
  h.reports.length = 0

  h.renderer("focus")
  assert.deepEqual(h.reports, [{ state: "clear", id: "root" }, { state: "idle", app: "opencode" }])

  h.reports.length = 0
  h.renderer("focus")
  assert.deepEqual(h.reports, [])
  h.cleanup()
})

test("hashes session IDs that are not valid record IDs", async () => {
  const long = `ses_${"x".repeat(40)}`
  const h = harness([[long, { id: long, title: "Long" }]])
  h.dispatch("session.execution.started", { sessionID: long })
  h.dispatch("session.execution.succeeded", { sessionID: long })
  await settle()

  assert.match(h.reports[0].id, /^ses_[0-9a-f]{16}$/)
  h.cleanup()
})
