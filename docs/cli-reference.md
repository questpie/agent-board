# CLI Reference

## Projects And Goals

```sh
agent-board init [--project <slug>]
agent-board migrate [--project <slug>]
agent-board projects
agent-board goals
agent-board goal new <title> [--id <slug>]
agent-board goal use <id>
```

Use environment or CLI overrides when concurrent agents must not depend on shared active goal state:

```sh
AGENT_BOARD_PROJECT=my-project AGENT_BOARD_GOAL=cli-mvp agent-board status
agent-board --project my-project --goal cli-mvp status
```

## Tasks

```sh
agent-board tasks [--status <status>] [--all]
agent-board status
agent-board next
agent-board show <task-id>
agent-board new <title> [--status <status>] [--priority <priority>]
agent-board claim <task-id> [--agent <name>] [--allow-detached]
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
- `verify` runs the task's `## Verify` commands from the repo root.
- `done` is blocked while acceptance criteria are unchecked or verify has not passed.
- `done --force --reason "<why>"` bypasses gates and records evidence.

## Specs And Knowledge

```sh
agent-board spec new <title> [--scope global|project|goal]
agent-board spec list [--scope global|project|goal]
agent-board spec show <spec-id>

agent-board knowledge add <title> [--kind decision|note|gotcha] [--scope global|project|goal]
agent-board knowledge list [--scope global|project|goal]
```

## Flows

```sh
agent-board flow new <name> [--force]
agent-board flow list
agent-board flow run <name-or-path-or-goal> [--input <text>] [--task <task-id>] [--runtime codex] [--agents <n>] [--concurrency <n>] [--verbose]
agent-board flow show <run-id>
```

`flow new` prints the script path and next action for the controller agent.

`flow run` prints:

```txt
Summary: <run>/summary.md
Agent outputs: <run>/agents
Diagnostics: <run>/diagnostics.jsonl
```

Read `summary.md` first.

## Skills

```sh
agent-board skills install
agent-board skills doctor
```

`skills install` writes bundled skills into `~/.agent-board/skills` and links them into supported runtime skill directories when safe.
