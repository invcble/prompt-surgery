# prompt-surgery

Claude Code, running on opencode's system prompt with the unused tool schemas stripped out.
**87,717 → 57,184 bytes per request. ~8,250 tokens saved, 34.8% smaller.**

## Use it

```sh
claude \
  --system-prompt-file /Users/invi/projects/prompt-surgery/system.txt \
  --disallowedTools Monitor ScheduleWakeup CronCreate CronDelete CronList \
                    EnterWorktree ExitWorktree DesignSync ShareOnboardingGuide
```

Tools drop 24 → 15. Kept: `Agent` `Bash` `Read` `Edit` `Write` `Skill` `WebFetch` `WebSearch`
`NotebookEdit` `SendMessage` `ListAgents` `PushNotification` `ReportFindings` `TaskOutput`
`TaskStop`.

`Agent` and `ReportFindings` are kept deliberately — they cost ~3,670 tokens, but cutting them
breaks `/code-review`, `/pr-review-cycle`, and `pr-review-toolkit:*`.

The system prompt actually gets *bigger* (9,515 → 11,008 B, ~+500 tok). The tool cut pays for that
seventeen times over.

## Why

- **Stability.** Claude Code's prompt changes every release. Good or bad, the behavior you tuned
  around shifts unannounced. Pinning your own file makes the baseline fixed and the changes yours.
- **No conflicts.** The default prompt contradicts CLAUDE.md, and outranks it by position. Worst
  case: CLAUDE.md says never delegate to subagents; the prompt ordered it three times, once marked
  `VERY IMPORTANT` / `CRITICAL`.
- **Rules with nowhere else to live.** `# Ownership` and `# Do exactly what was asked` are
  dispositions, not preferences. They drift when they arrive as user-turn context.
- **Size, as a bonus.** Two-thirds of a request is tool definitions, 11% is the system prompt, and
  neither is visible from inside a session — hence the measuring tools here.

Nothing here spends tokens or calls a real model; both instruments terminate the request locally.
You need `node` and the `claude` CLI. Regenerating the opencode dumps additionally needs `bun`.

## Layout

| Path | What it is |
|---|---|
| `system.txt` | **The deliverable.** opencode's Anthropic system prompt, edited. Feed to `--system-prompt-file`. |
| `tools.txt` | All 24 default tools with byte/token cost and a one-line description each. |
| `proxy/server.js` | Fake Anthropic API that logs what Claude Code sends and returns a canned SSE reply. |
| `proxy/captures/` | Raw captured request bodies. `05` = vanilla, `06` = the command above. |
| `dumps/` | Real assembled requests from opencode, plus the patch that produced them. See `dumps/README.md`. |

opencode is **not** vendored — it is a 2.6GB checkout; `dumps/README.md` has clone/patch/run steps.
`system.txt` derives from opencode's `anthropic.txt` (https://github.com/sst/opencode), MIT, ©
2025 opencode. Dumps and captures had the machine owner's global `~/.claude/CLAUDE.md` redacted;
everything else is byte-for-byte what was sent.

## Using the proxy

`proxy/server.js` is a fake Anthropic API. Claude Code sends it a real request; it writes the body
to `proxy/captures/` and replies with a canned SSE stream so the CLI completes normally. Use it for
any "what does Claude Code actually send?" question — prompt contents, tool schemas, whether a flag
changes the wire, what a setting costs.

**1. Start it:**

```sh
node proxy/server.js
# capture proxy on http://127.0.0.1:8787 -> .../proxy/captures
```

**2. Point Claude Code at it.** Run from a scratch dir so a project's CLAUDE.md doesn't pollute the
capture. The API key must be set to something; its value is never checked.

```sh
mkdir -p /tmp/cc-probe && cd /tmp/cc-probe
ANTHROPIC_BASE_URL=http://127.0.0.1:8787 ANTHROPIC_API_KEY=dummy claude -p "hi"
```

**3. Inspect.** Each capture is the raw request body — `system[]`, `tools[]`, `messages[]`, `model`.

```sh
cd proxy/captures
# where the bytes go
node -e 'const b=require("./05-_v1_messages_beta_true.json");
  const B=x=>Buffer.byteLength(JSON.stringify(x));
  console.log("system",B(b.system),"tools",B(b.tools),"messages",B(b.messages))'
```

**Comparing two configurations** — run twice with different flags, then diff the captures. This is
how `--disallowedTools` was shown to strip schemas from the wire rather than merely gate
permission, and how every figure here was produced.

```sh
ANTHROPIC_BASE_URL=http://127.0.0.1:8787 ANTHROPIC_API_KEY=dummy claude -p "hi"                       # baseline
ANTHROPIC_BASE_URL=http://127.0.0.1:8787 ANTHROPIC_API_KEY=dummy claude -p "hi" --system-prompt-file ../../system.txt --disallowedTools X Y  # trimmed
```

Notes:
- `rm -rf proxy/captures` between experiments; numbering restarts when the server restarts.
- Token counts are `bytes / 3.7`, an estimate — fine for ranking decisions, not for billing.
- A `claude.ai connectors are disabled` warning is expected: the dummy key overrides your login.
- Only `POST` is captured; `count_tokens` gets a stub and is not written to a file.
- Some tools are conditional. `ShareOnboardingGuide` only appears when the cwd has an
  `ONBOARDING.md`, which is why a vanilla capture may show 23 tools rather than 24.

## Regenerating `tools.txt`

`tools.txt` is a snapshot — tool sets change between Claude Code versions. To reprint the list with
current costs, take a fresh vanilla capture and run:

```sh
cd proxy/captures
node -e 'const fs=require("fs");
  const b=JSON.parse(fs.readFileSync(fs.readdirSync(".").sort()[0],"utf8"));
  const r=b.tools.map(t=>({n:t.name,b:Buffer.byteLength(JSON.stringify(t))})).sort((a,c)=>c.b-a.b);
  const w=Math.max(...r.map(x=>x.n.length));
  r.forEach(x=>console.log(`${x.n.padEnd(w)}  # ${String(x.b).padStart(5)} B  ~${String(Math.round(x.b/3.7)).padStart(4)} tok`))'
```

That prints names, bytes and token estimates. The grouping and descriptions in `tools.txt` are
hand-written on top of it — diff the names against the file to spot tools added or removed by an
upgrade.

## What was found

- opencode picks its prompt by model id: anything containing `claude` gets `prompt/anthropic.txt`.
  Opus and Sonnet are byte-identical apart from the model name echoed in the env block.
- Of opencode's 14,314-char assembled prompt, only the 8,212-byte `anthropic.txt` is portable —
  the rest is the env block, your own `~/.claude/CLAUDE.md`, and opencode's skill registry.
- `--system-prompt-file` genuinely **replaces** Claude Code's default prompt (verified: the model
  loses knowledge of its memory directory, which exists only in the default prompt).
- A vanilla request is **89,404 bytes — 66.6% tool schemas**, 11% system prompt, 22% messages.
- No deferred / `ToolSearch` mechanism in a default session; all tools ship with full schemas.
- `--disallowedTools` removes schemas from the wire — it is not just a permission gate.
- `messages[]` is ~19KB even for a one-word prompt, and no flag here touches it. That is where the
  next chunk of savings would have to come from.

## Edits made to `system.txt`

1. Stripped opencode's product bits: the ctrl+p / GitHub-issues block, and the
   "WebFetch opencode.ai/docs" instruction.
2. Removed the Task/subagent mandate (3 places, including a `VERY IMPORTANT`/`CRITICAL` line) and
   replaced it with a direct-search rule — a subagent misses your conversation context, and its
   off-objective findings die at the return boundary.
3. Added `# Comments`: comment the *why*, only when unrecoverable from the code; no narration or
   changelog comments; leave machine-readable comments (`// $COVERAGE-OFF$`, pragmas) alone.
4. Added `# Ownership`: the user owns the code and every judgement call in it. Never widen scope
   silently, never edit a test to make new behavior pass, and surface decisions as choices with
   consequences instead of resolving them quietly — including decisions created by your own work.
