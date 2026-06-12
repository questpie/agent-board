# Flows

`agent-board flow` is a minimal local orchestration layer for controller agents.

The CLI is not meant to be a human workflow builder. Humans can speak naturally; the controller agent uses `flow new`, edits the script, summarizes the phases, and runs it after approval or explicit go-ahead.

## Prerequisites

Flows call no model API directly and need no API keys. Each `agent(...)` spawns a locally installed coding agent over the Agent Client Protocol via [spawn-agent](https://www.npmjs.com/package/spawn-agent), reusing that agent's own auth:

- `--runtime codex` (default): the Codex CLI must be installed and logged in. agent-board prefers the bundled native `codex-acp` binary when it resolves (override with `AGENT_BOARD_CODEX_ACP_BIN`); authentication still comes from your local Codex login.
- `--runtime claude`: Claude Code must be installed and logged in.
- `--runtime cursor`: Cursor Agent must be installed and logged in.
- `--runtime copilot`: GitHub Copilot CLI must be installed and logged in.
- `--runtime gemini`: Gemini CLI must be installed and logged in.
- `--runtime opencode`: OpenCode must be installed and logged in.
- `--runtime droid`: Factory Droid must be installed and logged in.
- `--runtime pi`: Pi must be installed and logged in.

`AGENT_BOARD_FLOW_MOCK=1` short-circuits agent spawning with deterministic mock output — useful for exercising a flow script end to end without spending tokens (the test suite runs flows this way).

Use runtime/model discovery before hardcoding choices:

```sh
agent-board flow runtimes
agent-board flow models --runtime codex
```

`flow models` asks the local runtime for ACP config options and reports model
selectors when available. Some runtimes do not expose models through ACP; in
that case, agent-board says so and the controller should consult official
runtime docs instead of inventing model ids.

## Commands

```sh
agent-board flow new <name> --template feature
agent-board flow runtimes
agent-board flow models --runtime codex
agent-board flow cat <name>
agent-board flow write <name> --from ./flow.mjs
agent-board flow run <name> --input "<scope>" --task <task-id> --model <model>
agent-board flow show <run-id>
agent-board flow watch <run-id>
```

`flow run` prints the run id immediately and renders compact per-agent progress by default (start, throttled char counts and preview, heartbeats, finish, errors). Pass `--no-watch` when you want a quiet run; it still prints the `flow watch <run-id>` command so another terminal can follow the same `events.jsonl`. `flow watch <run-id>` is read-only — it never spawns agents or mutates run state — and exits when the run produces `summary.md` or on Ctrl-C.

`flow run --model <model>` requests a run-level model preference when the runtime
exposes a model selector. The requested model is recorded in `summary.md` and on
each agent row. Per-agent model overrides are available inside scripts with
`agent(prompt, { model: "<model>" })`.

`--agent-timeout` controls the per-agent inactivity watchdog (default 120m).
Long reviews are allowed to keep running while thinking/tool/runtime activity
arrives and renders as heartbeats, but that activity is not review evidence. If
no meaningful runtime activity arrives before the watchdog expires, the lane
fails as a runtime timeout instead of being treated as a pass.

Codex runs default to `--codex-mcp isolated`. agent-board creates a generated
`CODEX_HOME` for flow subagents, copies `auth.json`, writes a minimal
`config.toml`, and omits the user's global `mcp_servers`. This prevents
long-running flow waves from repeatedly triggering macOS Keychain prompts for
`Codex MCP Credentials`. Use `--codex-mcp inherit` if a flow explicitly needs
the MCP servers from your normal Codex config.

Templates:

- `default`: general read-only fan-out
- `feature`: feature planning, test planning, and synthesis
- `review`: cross-agent review
- `fix`: reproduction, localization, regression-test planning
- `design`: design-first frontend/product gate; spec, wireframe/design-board plan, user-flow states, and review criteria before implementation
- `task-graph`: deterministic lane fan-out for specs, task proposals, dependency edges, parallel waves, and verification gates
- `refactor`: deterministic per-file planning; explicit file paths in the input become up to 30 independent read lanes
- `hygiene`: board cleanup planning for stale runs, stale claims, duplicates, archive candidates, and canonical replacements
- `grill`: adversarial challenge of assumptions, stale external facts, risks, and test gaps

For quick read-only fan-out:

```sh
agent-board flow run "Audit auth for missing tests" --agents 3 --concurrency 3
```

## Script API

Workflow scripts export a default async function:

```js
export default async function flow({ input, agent, parallel, log, workspace }) {
	await log(`running audit: ${input}`);

	const results = await parallel([
		() => agent(`Inspect architecture for: ${input}`, { name: "researcher" }),
		() => agent(`Find risks for: ${input}`, { name: "critic" }),
	]);

	return results.map((result) => `## ${result.name}\n\n${result.text}`).join("\n\n");
}
```

Available context:

- `input`: `--input` text, or the ad-hoc target for unscripted runs
- `agent(prompt, options)`: spawn a local coding agent
- `parallel(items, worker)`: run tasks with the CLI concurrency limit
- `pipeline(items, ...stages)`: run ordered stages across many items with the CLI concurrency limit
- `log(message)`: write compact lifecycle logs
- `workspace`: project, goal, and repo metadata

Agent options include `name`, `label`, `phase`, `mode`, `cwd`, `timeoutMs`,
`schema`, and `model`. `model` uses the same ACP model selector as
`flow run --model`.

Flow scripts may also export metadata:

```js
export const meta = {
	name: "docs-audit",
	description: "Evaluate, verify, synthesize, and report on docs quality.",
	phases: [
		{ title: "Evaluate", detail: "fan out by docs group" },
		{ title: "Verify", detail: "adversarial source-code checks" },
		{ title: "Report", detail: "deduplicated final markdown" },
	],
};
```

Metadata is recorded in `summary.md` and compact lifecycle logs.

### Big-Job Primitives

Use `pipeline` when a large workflow needs ordered stages per item:

```js
export default async function flow({ agent, pipeline }) {
	const groups = ["backend", "frontend", "production"];

	return pipeline(
		groups,
		(group) => agent(`Audit ${group}`, { phase: "Evaluate", label: `eval:${group}` }),
		(evalResult, group) => agent(`Verify ${group}\n\n${evalResult.text}`, { phase: "Verify", label: `verify:${group}` }),
	);
}
```

Each stage runs across all items with the run's `--concurrency` limit before the next stage begins. The stage callback receives `(value, originalItem, index)`, so later stages can use both the previous stage result and the original item.

Use `agent(..., { schema })` when downstream stages need reliable JSON:

```js
const FINDING_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		summary: { type: "string" },
		severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
	},
	required: ["summary", "severity"],
};

const result = await agent("Return one finding.", {
	phase: "Evaluate",
	label: "eval:auth",
	schema: FINDING_SCHEMA,
});

console.log(result.json.severity);
```

Structured outputs are validated before the agent finishes. The parsed JSON is available as `result.json`, and the run writes a sibling `.json` artifact next to that agent's markdown output. Supported schema keywords are `type`, `properties`, `required`, `items`, `enum`, and `additionalProperties`.

### Agent permissions (`mode`)

`agent(prompt, { mode })` controls what the spawned agent is allowed to do. This is enforced via the runtime permission policy, not just the prompt:

- `mode: "read"` (default): maps to `auto-reject`, which rejects every permission request. Native file reads still work, but **there is no shell access and no edits** — a researcher can read files but any `rg`/`grep`/`find`/`cat` run through the shell is rejected and degrades. This makes read mode genuinely safe for cross-agent reviews.
- `mode: "write"`: maps to `auto-allow`, granting full write/execute access. Write-heavy flows must opt in explicitly with `{ mode: "write" }`.

The generated templates and ad-hoc fan-out run every role in `read` mode. Each agent's resolved mode is recorded in `summary.md` (e.g. `- reviewer: read, 1234ms, ...`).

A future "allow reads, run read-only shell, reject writes" policy would use the `PermissionPolicy` callback form to inspect each request and allow read-class tools while rejecting write/execute. That is not implemented yet.

## Artifacts

Each run writes:

```txt
~/.agent-board/projects/<project>/goals/<goal>/flows/runs/<run-id>/
  summary.md
  events.jsonl
  diagnostics.jsonl
  agents/
    01-researcher.md
    02-critic.md
```

Read order:

1. `summary.md`
2. `agents/*.md` only when details are needed
3. `diagnostics.jsonl` only for runtime or MCP issues

Raw agent stderr is quiet by default. Use `--verbose` only when debugging the runtime.
For Codex runtime on macOS, agent-board runs the bundled native `codex-acp`
binary directly when it is available. Set `AGENT_BOARD_CODEX_ACP_BIN` only when
you need to pin a different ACP executable for Keychain stability.

### `events.jsonl` schema

`events.jsonl` is the append-only lifecycle/progress stream. Every line is a JSON object with `ts` (ISO timestamp) and `type`, plus type-specific fields. It is intentionally compact: it never carries full agent output (that stays in `agents/*.md`) and never carries raw runtime stderr (that is filtered into `diagnostics.jsonl`). The `flow watch <run-id>` command tails this file, so the schema below is stable.

| `type` | Fields | Meaning |
| --- | --- | --- |
| `log` | `message` | Controller-level lifecycle line. |
| `agent_start` | `name`, `mode`, `promptChars` | An agent began streaming. |
| `agent_delta` | `name`, `chars`, `preview` | Throttled progress while text streams. `chars` is the running output length; `preview` is a SHORT trailing tail (≤ ~80 chars), never the full text. |
| `agent_heartbeat` | `name`, `chars`, `quietMs`, `timeoutMs`, `streamIdleMs` | The agent is still inside the watchdog window but produced no new text. `streamIdleMs = 0` means runtime/tool activity is arriving; `streamIdleMs > 0` means agent-board is waiting for the next stream event. |
| `agent_finish` | `name`, `mode`, `durationMs`, `outputPath`, `chars`, `diagnostics` | An agent completed; full output is at `outputPath`. |
| `agent_error` | `name`, `durationMs`, `diagnostics`, `error` | An agent failed. |

`agent_delta`/`agent_heartbeat` are emitted at most once per throttle window
(default ~1s, override with `AGENT_BOARD_FLOW_THROTTLE_MS`), so a fast token
stream coalesces into a few events rather than one event per token. While the
stream is fully quiet, agent-board emits an idle heartbeat every ~30s by default
(override with `AGENT_BOARD_FLOW_IDLE_HEARTBEAT_MS`) until the runtime returns or
the inactivity watchdog fails the lane.

## Controller Pattern

For non-trivial work:

1. Confirm project and goal with `agent-board status`.
2. Write or update a spec.
3. For frontend/product work, create the design gate first: design flow, wireframe/design-board artifact, optional presentation artifact, and design-review task.
4. Split the feature into linked tasks.
5. Create a flow script with `agent-board flow new <name> --template <kind>`.
6. Inspect or edit the script with `agent-board flow cat/write` to encode phases: fan-out, worker prompts, reviews, synthesis, and task/evidence updates.
7. Summarize the phases to the user.
8. Run the script after approval or explicit go-ahead.
9. While the flow runs, read the live progress lines; if the flow is attached to a task and you learn something durable before completion, record it with `agent-board progress <task-id> --from -`.
10. Read `summary.md`, update board state, and decide the next wave.

For deterministic large fan-out, feed `task-graph` newline-separated lanes or
`refactor` newline-separated file paths. Both templates cap generated lanes at
30 and keep agents in read mode by default. Convert their synthesized plan into
explicit tasks, worktrees, or write-mode flow lanes only after the controller
has accepted the graph.

The main chat remains controller. Spawned agents do not own roadmap, branch policy, commit policy, or final done decisions.

## Same-Worktree Safety

Same-worktree write flows are acceptable for P0 only when the script prevents agents from fighting:

- no branch switching by spawned agents
- no commits by spawned agents
- no reset/rebase
- no overlapping file edits
- no concurrent git operations

For heavy parallel implementation, use separate git worktrees and pass `AGENT_BOARD_REPO`.
