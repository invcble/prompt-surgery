#!/usr/bin/env node
// Logs whatever Claude Code sends to the Messages API, then returns a canned
// SSE response so the CLI completes normally instead of hanging or erroring.
// Nothing is forwarded upstream — this terminates the request.
//
//   node server.js &
//   ANTHROPIC_BASE_URL=http://127.0.0.1:8787 ANTHROPIC_API_KEY=dummy claude -p "hi"

const http = require("node:http")
const fs = require("node:fs")
const path = require("node:path")

const PORT = Number(process.env.PORT || 8787)
const OUT_DIR = path.join(__dirname, "captures")
fs.mkdirSync(OUT_DIR, { recursive: true })

let seq = 0

function sse(res, text) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  })
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  send("message_start", {
    type: "message_start",
    message: {
      id: "msg_proxy",
      type: "message",
      role: "assistant",
      model: "proxy",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  })
  send("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })
  send("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } })
  send("content_block_stop", { type: "content_block_stop", index: 0 })
  send("message_delta", {
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: 1 },
  })
  send("message_stop", { type: "message_stop" })
  res.end()
}

const server = http.createServer((req, res) => {
  const chunks = []
  req.on("data", (c) => chunks.push(c))
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8")

    if (req.method !== "POST") {
      res.writeHead(200, { "Content-Type": "application/json" })
      return res.end("{}")
    }

    // token counting endpoint — answer plausibly, don't log as a capture
    if (req.url.includes("count_tokens")) {
      res.writeHead(200, { "Content-Type": "application/json" })
      return res.end(JSON.stringify({ input_tokens: 1000 }))
    }

    const n = String(++seq).padStart(2, "0")
    const file = path.join(OUT_DIR, `${n}-${req.url.replace(/[^a-z0-9]/gi, "_")}.json`)
    fs.writeFileSync(file, raw)

    let summary = `[capture ${n}] ${req.method} ${req.url} — ${raw.length} bytes`
    try {
      const body = JSON.parse(raw)
      const tools = body.tools ?? []
      summary += ` | model=${body.model} tools=${tools.length} systemBlocks=${(body.system ?? []).length} messages=${(body.messages ?? []).length}`
    } catch {}
    console.log(summary)

    if (req.url.includes("/messages")) return sse(res, "ok")
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end("{}")
  })
})

server.listen(PORT, "127.0.0.1", () => console.log(`capture proxy on http://127.0.0.1:${PORT} -> ${OUT_DIR}`))
