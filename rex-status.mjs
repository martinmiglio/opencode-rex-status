import { createHash } from "node:crypto"

// OpenCode reports working and blocked sessions over OSC 7501, but never done or error.
// This fills that gap inside Rex so finished sessions stay flagged until you look at them.

const APP = "opencode"
const SETTLE_MS = 250
const encoder = new TextEncoder()
const decoder = new TextDecoder()

// Must match OpenCode's built-in record IDs so the next working report replaces ours.
function recordID(id) {
  if (/^[\w.+-]{1,32}$/.test(id)) return id
  return `ses_${createHash("sha256").update(id).digest("hex").slice(0, 16)}`
}

function clip(input, bytes) {
  const text = (input ?? "")
    .replace(/[\u0000-\u001F\u007F-\u009F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!text) return undefined
  const encoded = encoder.encode(text)
  if (encoded.byteLength <= bytes) return text
  return decoder.decode(encoded.subarray(0, bytes - 3)).replace(/\uFFFD+$/, "") + "…"
}

function lastAssistantText(context, sessionID) {
  const messages = context.data.session.message.list(sessionID) ?? []
  const message = messages.findLast((item) => item.type === "assistant")
  return message?.content
    ?.filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ")
}

function enabled(context) {
  if (typeof context.renderer?.setProgramStatus !== "function") return false
  return context.options?.force === true || Boolean(process.env.REX_SESSION)
}

export default {
  id: "rex.status",
  setup(context) {
    if (!enabled(context)) return

    const running = new Set()
    const blockers = new Map()
    const finished = new Set()
    const timers = new Set()
    let rootOwner
    let focused = false

    function send(status) {
      try {
        context.renderer.setProgramStatus(status)
      } catch {
        // A rejected report must never break the TUI.
      }
    }

    function isRoot(sessionID) {
      const session = context.data.session.get(sessionID)
      return Boolean(session) && !session.parentID
    }

    function rootOf(sessionID) {
      if (!sessionID || !context.data.session.get(sessionID)) return undefined
      return context.data.session.root(sessionID)
    }

    function viewedRoot() {
      const route = context.ui.router.current()
      return route.type === "session" ? rootOf(route.sessionID) : undefined
    }

    function hasRunningChild(sessionID) {
      return context.data.session
        .family(sessionID)
        .some(
          (child) =>
            child !== sessionID &&
            context.data.session.get(child)?.parentID === sessionID &&
            context.data.session.status(child) === "running",
        )
    }

    function forget(sessionID) {
      if (!finished.delete(sessionID)) return
      send({ state: "clear", id: recordID(sessionID) })
      if (rootOwner !== sessionID) return
      rootOwner = undefined
      if (running.size === 0 && blockers.size === 0) send({ state: "idle", app: APP })
    }

    function finish(sessionID, state, message) {
      running.delete(sessionID)
      const timer = setTimeout(() => {
        timers.delete(timer)
        if (running.has(sessionID) || context.data.session.status(sessionID) === "running") return
        if (focused && viewedRoot() === sessionID) return

        const title = clip(context.data.session.get(sessionID)?.title, 192)
        const record = { state, app: APP, title, message: clip(message, 2048) }
        finished.add(sessionID)
        send({ ...record, id: recordID(sessionID) })
        if (running.size > 0 || blockers.size > 0) return
        rootOwner = sessionID
        send(record)
      }, SETTLE_MS)
      timers.add(timer)
    }

    function start(event) {
      const sessionID = event.data.sessionID
      if (!isRoot(sessionID)) return
      running.add(sessionID)
      finished.delete(sessionID)
      if (rootOwner === sessionID) rootOwner = undefined
    }

    function block(id, sessionID) {
      const rootID = rootOf(sessionID)
      if (rootID) blockers.set(id, rootID)
    }

    function onFocus() {
      focused = true
      const sessionID = viewedRoot()
      if (sessionID) forget(sessionID)
    }

    function onBlur() {
      focused = false
    }

    context.renderer.on?.("focus", onFocus)
    context.renderer.on?.("blur", onBlur)

    const cleanups = [
      context.data.on("session.execution.started", start),
      context.data.on("session.execution.succeeded", (event) => {
        const sessionID = event.data.sessionID
        if (!isRoot(sessionID) || hasRunningChild(sessionID)) return
        finish(sessionID, "done", lastAssistantText(context, sessionID) ?? "Session done")
      }),
      context.data.on("session.execution.failed", (event) => {
        const sessionID = event.data.sessionID
        if (!isRoot(sessionID)) return
        finish(sessionID, "error", event.data.error?.message ?? "Session failed")
      }),
      context.data.on("session.execution.interrupted", (event) => {
        running.delete(event.data.sessionID)
        forget(event.data.sessionID)
      }),
      context.data.on("permission.asked", (event) => block(event.data.id, event.data.sessionID)),
      context.data.on("permission.replied", (event) => blockers.delete(event.data.requestID)),
      context.data.on("form.created", (event) => block(event.data.form.id, event.data.form.sessionID)),
      context.data.on("form.replied", (event) => blockers.delete(event.data.id)),
      context.data.on("form.cancelled", (event) => blockers.delete(event.data.id)),
      context.data.on("session.deleted", (event) => {
        running.delete(event.data.sessionID)
        forget(event.data.sessionID)
      }),
    ]

    return () => {
      for (const cleanup of cleanups) cleanup()
      for (const timer of timers) clearTimeout(timer)
      context.renderer.off?.("focus", onFocus)
      context.renderer.off?.("blur", onBlur)
    }
  },
}
