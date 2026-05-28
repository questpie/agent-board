# agent-board

A small Markdown task board and execution contract for coding agents.

`agent-board` gives Codex, Claude Code, Cursor, and similar agents a shared place to keep track of work: goals, tasks, specs, and knowledge. Everything is plain text under `~/.agent-board`, with repositories registered by path.

It is a small local system: the CLI owns durable state and enforces an execution contract (claim, verify, done), while skills guide agent behavior. Orchestration — spawning and coordinating worker agents — is left to your host (Claude Code, Cursor, or your own script), which calls the board's commands.

## Why

Multi-step coding work needs a durable map. A plan gets discussed, a blocker appears, a review finds follow-up work, and the next useful action should still be clear tomorrow.

`agent-board` keeps that map on disk:

- `goals` keep a slice of work focused
- `tasks` track executable work, status, blockers, dependencies, and verify evidence
- `specs` keep design notes and acceptance criteria
- `knowledge` keeps decisions, gotchas, and reusable facts

It also enforces discipline the board can't leave to prose: a task can't be claimed on a detached HEAD or with unfinished dependencies, and a task with verify commands can't be closed until they pass.

## Install

```sh
bun install
bun link
agent-board skills install
```

The package exposes both commands:

```sh
agent-board --help
agent --help
```

`agent-board skills install` links the bundled skills into every runtime it can find:

```txt
~/.claude/skills/{agent-board,agent-board-worker,agent-board-research}
~/.agents/skills/{agent-board,agent-board-worker,agent-board-research}
~/.cursor/skills/{agent-board,agent-board-worker,agent-board-research}
```

Check what's linked with `agent-board skills doctor`.

## First Run

From a repository:

```sh
agent-board init --project my-project
agent-board goal new "CLI MVP" --id cli-mvp
agent-board goal use cli-mvp

agent-board spec new "CLI MVP plan" --scope project
agent-board knowledge add "Use Bun and Commander" --kind decision --scope project

agent-board new "Add task CLI" --status ready --priority high
agent-board link add-task-cli --spec cli-mvp-plan

agent-board status
agent-board plan
```

A worker then picks the task up:

```sh
agent-board claim add-task-cli --agent worker-1   # guards detached HEAD + unfinished deps
# ... implement on the task branch ...
agent-board verify add-task-cli                   # runs the task's ## Verify block, records evidence
agent-board done add-task-cli                      # blocked until criteria are checked and verify passed
```

## How It Thinks About Work

**Project** is a registered repository path.

**Goal** is the active slice of work inside a project. Tasks belong to a goal.

**Task** is work that can be claimed, verified, and finished.

**Spec** is durable reasoning: why something is being built, what tradeoffs matter, what done means.

**Knowledge** is reusable project memory: decisions, gotchas, conventions, facts.

## Storage

All state lives in `~/.agent-board`:

```txt
~/.agent-board/
  registry.json
  specs/
  knowledge/
  skills/
    agent-board/
    agent-board-worker/
    agent-board-research/
  projects/<project>/
    project.json
    specs/
    knowledge/
    goals/<goal>/
      goal.md
      tasks/
      specs/
      knowledge/
      status.md
```

The registry maps repository paths to projects. From any subdirectory in a registered repo, the CLI can resolve the project and active goal.

Use explicit overrides when needed:

```sh
agent-board --project my-project --goal cli-mvp status
AGENT_BOARD_PROJECT=my-project AGENT_BOARD_GOAL=cli-mvp agent-board status
```

## Overlays

Specs and knowledge can live at three levels:

- `global`: shared across projects
- `project`: shared by all goals in one repo
- `goal`: specific to the active slice

Lookup is nearest-first:

```txt
goal > project > global
```

Use qualified references for cross-project or exact-scope links:

```txt
task:<project>/<goal>/<task>
spec:<scope>/<id>
knowledge:<scope>/<id>
```

## Tasks

A task is one Markdown file with frontmatter:

```yaml
---
id: "add-task-cli"
title: "Add task CLI"
status: "ready"
priority: "normal"
assignee: ""
branch: ""
skills: []
specs: ["cli-mvp-plan"]
depends_on: []
blocks: []
blocked_by: []
relates_to: []
created: "2026-05-16T00:00:00.000Z"
updated: "2026-05-16T00:00:00.000Z"
verified: ""
verified_sha: ""
---
```

Statuses:

```txt
todo ready in_progress blocked review done
```

Priorities:

```txt
high normal low
```

The body holds two contract-bearing sections. Acceptance criteria gate `done`:

```md
## Acceptance Criteria

- [ ] Define success criteria.
```

The `## Verify` block holds shell commands (one per line, in a fenced block) that `agent-board verify` runs from the repo root:

````md
## Verify

```sh
bun run check-types
bun test
```
````

`verify` appends results to a `## Evidence` section and, on all-pass, stamps `verified` / `verified_sha`. An empty `## Verify` block leaves the verify gate dormant.

## Execution Contract

The CLI enforces what skills alone can't guarantee under multi-agent pressure:

- **`claim`** refuses a detached HEAD (`--allow-detached` to override) and refuses tasks with unfinished dependencies, and won't steal a task already claimed by another agent.
- **`verify`** runs the task's `## Verify` commands and records evidence.
- **`done`** is blocked while acceptance criteria are unchecked or verify hasn't passed. `--force --reason "<why>"` bypasses with an audit line in `## Evidence`.

Git state is observed, never mutated — checking out branches and committing is the agent's job.

## Concurrency

agent-board is file-based and safe for multiple concurrent agents where state is partitioned:

- **Different projects / repos:** isolated automatically. Initialize one project at a time.
- **Same repo, different goals:** give each agent a git worktree and pin it via env; never use `goal use` concurrently (the active goal is shared mutable state).

```sh
git worktree add ../repo-goalA -b feat/goalA
AGENT_BOARD_PROJECT=myproj AGENT_BOARD_GOAL=goalA AGENT_BOARD_REPO="$PWD/../repo-goalA" agent ...
```

Board writes are atomic (temp + rename), claims take an exclusive lock, and `AGENT_BOARD_REPO` points git guards and verify at the agent's own worktree.

## Skills

Three composable skills are bundled and installed together:

- **`agent-board`** — orchestrator (default): plan, create specs/tasks, link blockers, delegate to workers, review evidence.
- **`agent-board-worker`** — implement one task: checkout branch, claim, implement, verify, done.
- **`agent-board-research`** — read-only discovery: turn uncertainty into specs and tasks.

Each `SKILL.md` carries trigger keywords in its description so Claude Code and Cursor auto-load the right one.

## Command Reference

Projects and goals:

```sh
agent-board init [--project <slug>]
agent-board migrate [--project <slug>]
agent-board projects
agent-board goals
agent-board goal new <title> [--id <slug>]
agent-board goal use <id>
```

Tasks:

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

Specs and knowledge:

```sh
agent-board spec new <title> [--scope global|project|goal]
agent-board spec list [--scope global|project|goal]
agent-board spec show <spec-id>
agent-board knowledge add <title> [--kind decision|note|gotcha] [--scope global|project|goal]
agent-board knowledge list [--scope global|project|goal]
```

Skills:

```sh
agent-board skills install
agent-board skills doctor
```

## Agent Modes

The bundled skills nudge agents into modes.

In **orchestrator** mode (default), the agent plans work, writes specs, creates tasks, links dependencies, delegates ready tasks to worker sub-agents, reviews evidence, and updates the board. It does not implement tasks itself.

In **worker** mode, the agent has a concrete task: it gets on the task branch, claims, edits files, runs `agent-board verify`, and closes the task.

Spawning and coordinating those workers is the host's job (Claude Code's dynamic workflows, Cursor's Task tool, or your own script) — agent-board provides the durable plan and the contract they drive.

## Migration

Older flat layouts can be copied into `goals/main`:

```sh
agent-board migrate --project <slug>
```

The command copies old `tasks`, `specs`, and `knowledge`. Existing `.agent` symlinks are left untouched.

## Development

```sh
bun install
bun run check-types
bun test
```

The tests cover frontmatter parsing, task graph links, overlays, git state detection, the verify gate, claim guards, atomic writes, concurrent-claim locking, global skill install, related project planning, and migration.

## License

MIT
