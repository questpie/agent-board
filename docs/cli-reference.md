# CLI Reference

## Projects And Goals

```sh
agent-board init [--project <slug>] [--local | --global]
agent-board relocate --to local|home [--cleanup] [--project <slug>]
agent-board nudge [--remove]
agent-board migrate [--project <slug>]
agent-board projects
agent-board goals
agent-board goal new <title> [--id <slug>]
agent-board goal use <id> [--force]
```

`init` defaults to the shared home board (`~/.agent-board`); `--local` keeps the
board in the repo (`.agent-board/`, git-versioned), discovered by walking up from
the working directory. `relocate` moves an existing board between the two and, by
default, leaves the source as a backup unless `--cleanup` is passed.
When moving from home to local, shared home `specs/`, `knowledge/`, and `wireframes/` are not
copied into the repo board; the CLI warns if that global overlay exists because
the local board will not see it by default. Local boards store global/project
docs in the same flat directory, so default lists show that directory once.

`nudge` adds (or refreshes, or with `--remove` removes) a managed agent-board
block in the repo's `CLAUDE.md` and `AGENTS.md`. The CLI never writes these files
on its own — commands run inside a repo only print a tip when the block is
missing, and you (or an agent) run `nudge` to apply it.

Use environment or CLI overrides when concurrent agents must not depend on shared active goal state:

```sh
AGENT_BOARD_PROJECT=my-project AGENT_BOARD_GOAL=cli-mvp agent-board status
agent-board status --project my-project --goal cli-mvp
```

`goal use` mutates the shared active goal in `project.json`; use it as a human
default, not as an agent coordination mechanism. Non-interactive `goal use`
requires `--force`, and without force it refuses to switch away from a goal that
has in-progress tasks or incomplete flow runs. Agents should prefer `--goal` or
`AGENT_BOARD_GOAL` so they do not disrupt other agents.

## Tasks

```sh
agent-board tasks [--status <status>] [--all] [--archived]
agent-board status
agent-board next
agent-board show <task-id>
agent-board task cat <task-id>
agent-board task write <task-id> --from <file|->
agent-board new <title> [--status <status>] [--priority <priority>]
agent-board claim <task-id> [--agent <name>] [--allow-detached]
agent-board progress <task-id> [message...] [--from <file|->] [--agent <name>]
agent-board verify <task-id>
agent-board block <task-id> <reason>
agent-board ready <task-id>
agent-board unblock <task-id>
agent-board link <task-id> --blocks <task-id>
agent-board link <task-id> --spec <spec-id>
agent-board plan [--related]
agent-board review <task-id>
agent-board done <task-id> [--force] [--reason <text>]
```

Important behavior:

- `claim` refuses detached HEAD unless `--allow-detached` is passed.
- `claim` refuses unfinished dependencies.
- `claim` will not steal a task claimed by another agent.
- `progress` appends a timestamped checkpoint to the task's `## Evidence` section; use `--from -` for multiline output.
- `verify` runs the task's `## Verify` commands from the repo root.
- `done` is blocked while acceptance criteria are unchecked or verify has not passed.
- `done --force --reason "<why>"` bypasses gates and records evidence.
- Archived tasks are hidden from default task/status/next/plan views and do not
  satisfy dependencies; use `tasks --archived` or `archive list` to inspect
  them.

## Specs And Knowledge

```sh
agent-board spec new <title> [--scope global|project|goal] [--category <name>]
agent-board spec list [--scope global|project|goal] [--category <name>] [--archived]
agent-board spec show <spec-id>
agent-board spec cat <spec-id>
agent-board spec write <spec-id> --from <file|->
agent-board spec categorize <spec-id> <category>

agent-board knowledge add <title> [--kind decision|note|gotcha] [--scope global|project|goal] [--category <name>]
agent-board knowledge list [--scope global|project|goal] [--category <name>] [--archived]
agent-board knowledge cat <knowledge-id>
agent-board knowledge write <knowledge-id> --from <file|->
agent-board knowledge categorize <knowledge-id> <category>
```

`cat` prints body content without frontmatter. `write` replaces body content
while preserving CLI-owned metadata. `--category` groups specs and knowledge
under a freeform label; `categorize` sets or changes it on an existing document,
and `list --category <name>` filters by it. Archived specs and knowledge are
hidden from default lists; pass `--archived` to include them.

## Archive

```sh
agent-board archive task <task-id> --reason <text> [--superseded-by <ref>]
agent-board archive spec <spec-id> --reason <text> [--superseded-by <ref>]
agent-board archive knowledge <knowledge-id> --reason <text> [--superseded-by <ref>]
agent-board archive flow-run <run-id> --reason <text> [--superseded-by <ref>]
agent-board archive list [--kind task|spec|knowledge|flow-run]
agent-board archive restore <kind> <id>
```

Archive is reversible and non-destructive. Task/spec/knowledge archives are
frontmatter metadata; flow-run archives are `archive.json` marker files beside
the run artifacts. Default task/spec/knowledge lists hide archived records, while
`archive list`, `tasks --archived`, `spec list --archived`, and
`knowledge list --archived` expose them.

## Wireframes

```sh
agent-board wireframe import <directory> [--title <title>] [--scope global|project|goal] [--category <name>] [--entry <path>]
agent-board wireframe list [--scope global|project|goal] [--category <name>]
agent-board wireframe show <wireframe-id>
agent-board wireframe cat <wireframe-id>
agent-board design import <directory>   # alias for wireframe import
```

Wireframes are portable HTML design boards stored inside the board under
`wireframes/<id>/`. Import copies a zero-build bundle (for example React UMD +
Babel + `.jsx` screens) into agent-board storage and records `wireframe.md`
metadata. `agent-board web` serves the bundle in the Wireframes tab; no
project-specific `package.json` preview script is required.

## Share

```sh
agent-board share design <id> [--target gist] [--open]
agent-board share spec <id> [--open]
agent-board share task <id> [--open]
agent-board share knowledge <id> [--open]
agent-board share list
agent-board share rm <design|spec|task|knowledge> <id>
```

Publishes one artifact as a public link. The payload is uploaded as a secret
GitHub gist through your existing `gh` auth (the `gist` scope is required), and a
static viewer at `docs/share` renders it. A `design` is flattened to a single
self-contained HTML file (local stylesheets, scripts, images, and CSS `url(...)`
become inline content and data URLs; CDN/absolute references are left untouched);
`spec`, `task`, and `knowledge` are shared as Markdown. The gist id is recorded in
`shares.json` at the project root, so re-running `share` updates the same gist and
the link stays stable. Enable GitHub Pages (from `docs/share`) to make the link
render, or override the viewer with `AGENT_BOARD_SHARE_VIEWER`. A secret gist is
link-private, not access-controlled.

## Flows

```sh
agent-board flow new <name> [--template default|feature|review|fix|design|task-graph|refactor|hygiene|grill|safe-workflow] [--force]
agent-board flow list
agent-board flow runtimes
agent-board flow models --runtime <runtime>
agent-board flow cat <name>
agent-board flow write <name> --from <file|->
agent-board flow run <name-or-path-or-goal> [--input <text>] [--task <task-id>] [--runtime codex|claude|cursor|copilot|gemini|opencode|droid|pi] [--model <model>] [--agents <n>] [--concurrency <n>] [--agent-timeout <duration>] [--codex-mcp isolated|inherit] [--verbose] [--no-watch]
agent-board flow show <run-id>
agent-board flow watch <run-id>
```

`flow run` spawns locally installed coding agents; the chosen runtime's CLI must
be installed and logged in — see [Flows: Prerequisites](flows.md#prerequisites).
Use `flow runtimes` to list local runtimes detected through `spawn-agent`, and
`flow models --runtime <runtime>` to inspect ACP model selector options when the
runtime exposes them. `flow run --model <model>` requests that model through the
runtime's model selector; if no selector is exposed, agent-board refuses to
guess and points you at the runtime's official docs.
`flow run` prints the run id immediately and renders live per-agent progress by
default. Pass `--no-watch` to suppress live progress; the command still prints a
`flow watch` command for following the run from another terminal. `flow watch`
tails a run's `events.jsonl`; it is read-only and exits when the run finishes or
on Ctrl-C.

`--agent-timeout` is a per-agent inactivity watchdog, defaulting to 120m. Long
reviews are allowed to keep running while thinking, tool use, or runtime
activity arrives and renders as heartbeats. Only text output becomes review
evidence; a heartbeat with `0 chars` is liveness, not a verdict. Heartbeats also
report whether the runner is actively receiving runtime events or waiting for
the next stream event.

For Codex runtime, `--codex-mcp isolated` is the default. It runs flow subagents
with a generated `CODEX_HOME` that copies `auth.json` but omits the user's global
`mcp_servers`, avoiding repeated macOS Keychain prompts for `Codex MCP
Credentials`. Use `--codex-mcp inherit` only when a flow intentionally needs the
Codex MCP servers from your normal Codex config.

`flow new` prints the template, script path, and next action for the controller
agent. Templates are simple editable JavaScript scripts:

- `default`: researcher + critic + synthesis
- `feature`: researcher + planner + tester + synthesis
- `review`: reviewer + test auditor + risk reviewer + synthesis; the summary starts with `Verdict: pass`, `Verdict: findings`, or `Verdict: inconclusive`
- `fix`: reproducer + locator + test planner + synthesis
- `design`: spec reader + wireframe planner + flow mapper + design review gate
- `task-graph`: deterministic lane fan-out for dependencies, parallel waves, and board commands
- `refactor`: deterministic per-file planning; up to 30 file paths become independent read lanes
- `hygiene`: maintenance reader + archive planner + consolidator
- `grill`: adversarial challenge of assumptions, stale facts, risks, and test gaps
- `safe-workflow`: use-case cartographer + scenario matrix auditor + TDD planner + replay gate reviewer

`flow run` prints:

```txt
Summary: <run>/summary.md
Agent outputs: <run>/agents
Diagnostics: <run>/diagnostics.jsonl
```

Read `summary.md` first.

For Codex runtime on macOS, agent-board runs the bundled native `codex-acp`
binary directly when it is available. Set `AGENT_BOARD_CODEX_ACP_BIN` only when
you need to pin a different ACP executable.

## Maintenance

```sh
agent-board maintenance [--stale-after <duration>] [--dry-run] [--json]
```

`maintenance` is read-only. It reports stale in-progress tasks, stale or failed
flow runs, broken task/spec links, and spec/knowledge consolidation candidates.
`--stale-after` accepts durations such as `30m`, `24h`, or `7d`. `--json`
prints the same report as structured data for agents or scripts. The command
does not delete run artifacts, retry flows, archive records, rewrite docs, or
change task state. Use the `archive` commands after reviewing maintenance
findings.

## Skills

```sh
agent-board skills install
agent-board skills doctor
agent-board skills check
```

`skills install` writes bundled skills into `~/.agent-board/skills` and links them into supported runtime skill directories when safe. `skills check` audits the bundled skill docs against the live CLI and fails on any command/flag drift.
