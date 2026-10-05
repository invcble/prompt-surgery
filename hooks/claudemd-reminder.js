#!/usr/bin/env node
// UserPromptSubmit hook: appends reminders to a prompt on a per-rule turn interval.
//
// Long conversations drift from CLAUDE.md — it is read once early and then buried under
// thousands of tokens of tool output. This re-surfaces it periodically without injecting
// the file's contents on every turn.
//
// ~/.claude/settings.json — note the nested "hooks" array; the flat {type, command} form
// shown in some docs fails settings validation:
//   "hooks": { "UserPromptSubmit": [ { "hooks": [ { "type": "command",
//       "command": "node /path/to/prompt-surgery/hooks/claudemd-reminder.js" } ] } ] }

const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const STATE_DIR = path.join(os.homedir(), ".claude", "prompt-surgery-turns")

const EVERY_TURN_REMINDER = `Reply in very few words, literally. I prefer not to read a paragraph — surface the important words only, in the form or shape of your concern/answer.

Unless I ask for depth, or the task genuinely needs it: a design trade-off, a plan, a full file.`

const CLAUDEMD_REMINDER = `Keep answering what I am asking. Separately, as a standing reminder:

If this response involves a code change, a design decision, or code output, do not rely on your recollection of my instructions files — the user-level one (~/.claude/CLAUDE.md) and the project-level one in the project root. They were read early and are now far back in this conversation, and recalled rules drift in exactly the way that feels confident.

Before you act, grep those files for the rules that govern what you are about to do and read the matching sections, so you are working from the actual wording. Grep the relevant part rather than re-reading the whole file — the project file is large.

If nothing you are about to do is covered by them, carry on without the lookup.`

const RULES = [
  { every: 1, text: EVERY_TURN_REMINDER },
  { every: Number(process.env.CLAUDEMD_REMINDER_EVERY || 5), text: CLAUDEMD_REMINDER },
]

// A counter only matters to the session that owns it, so anything untouched for a month is
// from a session that will not resume. Losing one is harmless — the count restarts at zero.
function sweepStaleState() {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
  for (const name of fs.readdirSync(STATE_DIR)) {
    const file = path.join(STATE_DIR, name)
    try {
      if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file)
    } catch {}
  }
}

function main() {
  const raw = fs.readFileSync(0, "utf8")
  const input = JSON.parse(raw)
  const sessionID = String(input.session_id || "unknown").replace(/[^A-Za-z0-9_-]/g, "")

  fs.mkdirSync(STATE_DIR, { recursive: true })
  sweepStaleState()
  const stateFile = path.join(STATE_DIR, sessionID)
  const previous = fs.existsSync(stateFile) ? Number(fs.readFileSync(stateFile, "utf8")) : 0
  const count = (Number.isFinite(previous) ? previous : 0) + 1
  fs.writeFileSync(stateFile, String(count))

  const due = RULES.filter((rule) => rule.every > 0 && count % rule.every === 0).map((rule) => rule.text)
  if (due.length === 0) process.exit(0)

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: `\n\nUser Reminder below:\n\n${due.join("\n\n---\n\n")}`,
      },
    }),
  )
}

try {
  main()
} catch {
  // A broken hook must never block a prompt. Fail open, silently.
  process.exit(0)
}
