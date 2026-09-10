# opencode prompt dumps

Real assembled requests from opencode, captured before anything was sent over the network.

| File | What |
|---|---|
| `*-main-anthropic-claude-opus-4-5.{txt,json}` | The main model call. `.txt` is sectioned and readable, `.json` is machine-readable. |
| `*-small-anthropic-claude-haiku-4-5-*.{txt,json}` | The title-generation call. opencode fires this on a separate "small" model regardless of which main model you pick. |
| `opencode-dump.patch` | The instrumentation that produced them. |

The `.txt` files are split into sections: `META`, `SYSTEM BLOCK 0` (the final joined system
prompt), `SYSTEM BLOCK 0 — CONSTITUENT PARTS` (the same content *before* joining, so you can see
which layer contributed what), `TOOLS — SUMMARY` / `TOOLS — FULL`, `MESSAGES`, `PARAMS`,
`HEADERS`, `MESSAGE TRANSFORM OPTIONS`.

> **Redacted:** these dumps originally contained the machine owner's global `~/.claude/CLAUDE.md`,
> because opencode's `instruction.ts` walks the filesystem for `AGENTS.md` / `CLAUDE.md` and folds
> whatever it finds into the system prompt. That block has been replaced with a `[REDACTED: ...]`
> marker. Everything else is byte-for-byte what opencode assembled. Regenerate and you will get
> your own instructions in that slot instead.

## Regenerating

opencode is not vendored here — it is a 2.6GB checkout. Clone it yourself:

```sh
git clone https://github.com/sst/opencode.git
cd opencode
git checkout b7ca4f9          # the commit these dumps came from; omit for latest
```

Apply the instrumentation:

```sh
git apply /path/to/prompt-surgery/dumps/opencode-dump.patch
```

Install deps — opencode is bun-only (`packageManager: bun@1.3.14`), and its `.txt` prompt imports
rely on bun's loader, so node will not work:

```sh
curl -fsSL https://bun.sh/install | bash
bun install                   # ~2,300 packages, a couple of minutes
```

Run it. `PROMPT_DUMP_DIR` is what arms the dump; without it the patch is a no-op:

```sh
mkdir -p /tmp/oc-sandbox
PROMPT_DUMP_DIR=$PWD/dumps ANTHROPIC_API_KEY=dummy \
  bun run --cwd packages/opencode src/index.ts run \
    --dir /tmp/oc-sandbox -m anthropic/claude-opus-4-5 "hello"
```

You will see:

```
[prompt-surgery] dumped <stamp> to <dir> — aborting before HTTP request
```

## What the patch does

Adds `dumpPrepared()` at the end of `prepare()` in
`packages/opencode/src/session/llm/request.ts` — the last point where the system prompt, tools,
messages, params and headers all exist together, immediately before the request is handed to the
provider SDK.

It writes both formats, then calls `process.exit(0)` on the non-small call. **Nothing is ever
sent upstream**, so the dummy API key is never validated and no tokens are spent. Two files per
call are produced because both the small and main `prepare()` calls are captured; only the main
one exits.

## Notes

- Run against an empty directory (`--dir /tmp/oc-sandbox`). Point it at a real project and the
  AGENTS.md/CLAUDE.md walk will pull that project's instructions into the dump.
- Model selection is by substring: any model id containing `claude` gets `prompt/anthropic.txt`.
  Opus and Sonnet dumps are byte-identical apart from the model name echoed in the env block.
- The haiku dump appears no matter which model you pass — it is the title-generation call, whose
  model comes from `Provider.getSmallModel` (falls back to the `claude-haiku` family).
