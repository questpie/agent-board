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
agent-board tasks [--status <status>] [--all]
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

## Specs And Knowledge

```sh
agent-board spec new <title> [--scope global|project|goal] [--category <name>]
agent-board spec list [--scope global|project|goal] [--category <name>]
agent-board spec show <spec-id>
agent-board spec cat <spec-id>
agent-board spec write <spec-id> --from <file|->
agent-board spec categorize <spec-id> <category>

agent-board knowledge add <title> [--kind decision|note|gotcha] [--scope global|project|goal] [--category <name>]
agent-board knowledge list [--scope global|project|goal] [--category <name>]
agent-board knowledge cat <knowledge-id>
agent-board knowledge write <knowledge-id> --from <file|->
agent-board knowledge categorize <knowledge-id> <category>
```

`cat` prints body content without frontmatter. `write` replaces body content
while preserving CLI-owned metadata. `--category` groups specs and knowledge
under a freeform label; `categorize` sets or changes it on an existing document,
and `list --category <name>` filters by it.

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

## Flows

```sh
agent-board flow new <name> [--template default|feature|review|fix] [--force]
agent-board flow list
agent-board flow cat <name>
agent-board flow write <name> --from <file|->
agent-board flow run <name-or-path-or-goal> [--input <text>] [--task <task-id>] [--runtime codex|claude|opencode] [--agents <n>] [--concurrency <n>] [--agent-timeout <duration>] [--codex-mcp isolated|inherit] [--verbose] [--no-watch]
agent-board flow show <run-id>
agent-board flow watch <run-id>
```

`flow run` spawns locally installed coding agents; the chosen runtime's CLI must
be installed and logged in — see [Flows: Prerequisites](flows.md#prerequisites).
`flow run` prints the run id immediately and renders live per-agent progress by
default. Pass `--no-watch` to suppress live progress; the command still prints a
`flow watch` command for following the run from another terminal. `flow watch`
tails a run's `events.jsonl`; it is read-only and exits when the run finishes or
on Ctrl-C.

`--agent-timeout` is a per-agent activity watchdog, defaulting to 60m. Thinking,
tool use, and runtime activity count as liveness and render as heartbeats, but
only text output becomes review evidence; a heartbeat with `0 chars` is
liveness, not a verdict. Heartbeats also report whether the runner is actively
receiving runtime events or waiting for the next stream event.

For Codex runtime, `--codex-mcp isolated` is the default. It runs flow subagents
with a generated `CODEX_HOME` that copies `auth.json` but omits the user's global
`mcp_servers`, avoiding repeated macOS Keychain prompts for `Codex MCP
Credentials`. Use `--codex-mcp inherit` only when a flow intentionally needs the
Codex MCP servers from your normal Codex config.

`flow new` prints the template, script path, and next action for the controller
agent. Templates are simple editable JavaScript scripts:

- `default`: researcher + critic + synthesis
- `feature`: researcher + planner + tester + synthesis
- `review`: reviewer + test auditor + risk reviewer + synthesis
- `fix`: reproducer + locator + test planner + synthesis

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
does not delete run artifacts, retry flows, rewrite docs, or change task state.

## Skills

```sh
agent-board skills install
agent-board skills doctor
agent-board skills check
```

`skills install` writes bundled skills into `~/.agent-board/skills` and links them into supported runtime skill directories when safe. `skills check` audits the bundled skill docs against the live CLI and fails on any command/flag drift.
