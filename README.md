# agent-board

A small Markdown task board and workflow runner for coding agents.

`agent-board` gives Codex, Claude Code, and similar agents a shared place to keep track of work: goals, tasks, specs, knowledge, workflow recipes, and run logs. Everything is plain text under `~/.agent-board`, with repositories registered by path.

It is a small local system: the CLI owns state, skills guide agent behavior, and workflows describe which agents should run and in what order.

## Why

Multi-step coding work needs a durable map. A plan gets discussed, a blocker appears, a review finds follow-up work, and the next useful action should still be clear tomorrow.

`agent-board` keeps that map on disk:

- `goals` keep a slice of work focused
- `tasks` track executable work, status, blockers, and dependencies
- `specs` keep design notes and acceptance criteria
- `knowledge` keeps decisions, gotchas, and reusable facts
- `workflows` run Codex/Claude steps from YAML
- `runs` store prompts, logs, and summaries

It runs local agents with your configured CLI permissions. Treat it as a project memory and orchestration layer.

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

`agent-board skills install` links the bundled skill into:

```txt
~/.claude/skills/agent-board
~/.agents/skills/agent-board
```

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
agent-board run add-task-cli --workflow dev
```

Inspect the run:

```sh
agent-board runs add-task-cli
agent-board logs <run-id-or-prefix>
```

`run` prints the run id as soon as the run folder exists, so you can refer to it immediately.

## How It Thinks About Work

**Project** is a registered repository path.

**Goal** is the active slice of work inside a project. Tasks and runs belong to a goal.

**Task** is work that can be claimed and finished.

**Spec** is durable reasoning: why something is being built, what tradeoffs matter, what done means.

**Knowledge** is reusable project memory: decisions, gotchas, conventions, facts.

**Workflow** is a YAML recipe for running agents.

**Run** is the saved execution: prompt, stdout/stderr, summary, and metadata.

## Storage

All state lives in `~/.agent-board`:

```txt
~/.agent-board/
  registry.json
  workflows/
  specs/
  knowledge/
  skills/agent-board/
  projects/<project>/
    project.json
    workflows/
    specs/
    knowledge/
    goals/<goal>/
      goal.md
      tasks/
      runs/
      workflows/
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

Specs, knowledge, and workflows can live at three levels:

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
workflow: ""
skills: []
specs: ["cli-mvp-plan"]
depends_on: []
blocks: []
blocked_by: []
relates_to: []
created: "2026-05-16T00:00:00.000Z"
updated: "2026-05-16T00:00:00.000Z"
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

## Workflows

Workflows are YAML files in any `workflows/` overlay.

```yaml
name: dev
description: Implement task with review sidecars
default_agent: codex
skills: [agent-board]
context:
  - repo:AGENTS.md
  - task:current
  - specs:linked
  - knowledge:global
  - knowledge:project
  - knowledge:goal
  - runs:current

steps:
  - id: implement
    role: main
    agent: codex
    intent: implementation
    skills: [agent-board]
    prompt: |
      Implement this task. Read the task, linked specs, knowledge, and repo instructions.

  - id: review
    parallel:
      - id: code-review
        role: reviewer
        agent: claude
        intent: review
        skills: [agent-board]
        prompt: |
          Review for bugs, missing tests, regressions, and unresolved criteria.
      - id: test-review
        role: validator
        agent: codex
        intent: validation
        skills: [agent-board]
        prompt: |
          Inspect changed files and run or propose relevant checks.
```

Top-level steps run sequentially. `parallel` groups run concurrently.

Supported context aliases:

- `repo:<path>` reads from the registered repo
- `task:current` renders the active task
- `specs:linked` renders specs linked from task frontmatter
- `knowledge:global`, `knowledge:project`, `knowledge:goal` render scoped knowledge
- `runs:current` renders the current run folder

Supported template variables:

- `{{task.id}}`
- `{{task.title}}`
- `{{task.status}}`
- `{{workspace.path}}`
- `{{repo.path}}`
- `{{project.id}}`
- `{{goal.id}}`
- `{{run.path}}`

## Agent Commands

Default execution is trusted local execution:

```sh
codex exec --dangerously-bypass-approvals-and-sandbox -
claude -p --permission-mode bypassPermissions
```

Override binaries or args with environment variables:

```sh
AGENT_BOARD_CODEX_BIN=/path/to/codex
AGENT_BOARD_CLAUDE_BIN=/path/to/claude
AGENT_BOARD_CODEX_ARGS='exec --dangerously-bypass-approvals-and-sandbox -'
AGENT_BOARD_CLAUDE_ARGS='-p --permission-mode bypassPermissions'
```

Custom agent names use:

```sh
AGENT_BOARD_<AGENT_NAME>_BIN=/path/to/binary
```

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
agent-board claim <task-id> [--agent <name>]
agent-board block <task-id> <reason>
agent-board ready <task-id>
agent-board unblock <task-id>
agent-board link <task-id> --blocks <task-id>
agent-board link <task-id> --spec <spec-id>
agent-board plan [--related]
agent-board review <task-id>
agent-board done <task-id> [--force]
```

Specs and knowledge:

```sh
agent-board spec new <title> [--scope global|project|goal]
agent-board spec list [--scope global|project|goal]
agent-board spec show <spec-id>
agent-board knowledge add <title> [--kind decision|note|gotcha] [--scope global|project|goal]
agent-board knowledge list [--scope global|project|goal]
```

Workflows and runs:

```sh
agent-board workflows
agent-board run <task-id> [--workflow <name>] [--agent <codex|claude>]
agent-board runs [<task-id>]
agent-board logs <run-id-or-prefix> [--step <step-id>]
```

Skills:

```sh
agent-board skills install
```

## Bundled Workflows

`init` installs these workflows into the global overlay:

- `research`: inspect repo context and create findings/specs/tasks
- `triage`: break a goal into tasks, blockers, and parallel lanes
- `dev`: implement with review/validation sidecars
- `validate`: focused review/test pass with follow-up task creation

## Agent Modes

The bundled skill nudges agents into two modes.

In `orchestrator` mode, the agent plans work, writes specs, creates tasks, links dependencies, runs workflows, reads logs, and updates the board. Implementation happens through workflow runs or through an explicit worker request.

In `worker` mode, the agent has a concrete task. It claims the task, edits files, runs checks, and updates task state.

Typical orchestrator loop:

```sh
agent-board status
agent-board plan --related
agent-board run <ready-task> --workflow dev
agent-board runs <ready-task>
agent-board logs <run-id-or-prefix>
```

The V1 runner is foreground: it streams worker output, stores logs, and exits when the workflow exits. Background supervision is a later extension.

## Migration

Older flat layouts can be copied into `goals/main`:

```sh
agent-board migrate --project <slug>
```

The command copies old `tasks`, `specs`, `knowledge`, `runs`, and `workflows`, and rewrites legacy `.agent/*` workflow context aliases where safe. Existing `.agent` symlinks are left untouched.

## Development

```sh
bun install
bun run check-types
bun test
```

The tests cover frontmatter parsing, task graph links, overlays, prompt rendering, fake-agent workflow runs, global skill install, related project planning, and migration.

## License

MIT
