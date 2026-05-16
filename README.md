# agent-board

Home-only Markdown task board and workflow runner for coding agents such as Codex and Claude Code.

`agent-board` keeps durable project state out of chat. It gives agents a small PM system for goals, tasks, specs, knowledge, deterministic workflows, and run logs while keeping the source of truth as plain files in `~/.agent-board`.

## Why

Chats are bad long-term project memory. Agents lose focus when the plan, blockers, and decisions live only in conversation. `agent-board` makes the working state explicit:

- Goals keep the active slice narrow.
- Tasks are executable units with status, dependencies, blockers, and linked specs.
- Specs hold durable reasoning, acceptance criteria, and plans.
- Knowledge holds reusable facts, decisions, and gotchas.
- Workflows define how agents are delegated.
- Runs preserve prompts, stdout/stderr, summaries, and sidecar outputs.

`agent-board` is not a security boundary. It is a trusted local orchestrator.

## Install

```sh
bun install
bun link
```

This exposes both binaries:

```sh
agent-board --help
agent --help
```

Install global helper skills for Claude/Codex-style agents:

```sh
agent-board skills install
```

## Quick Start

From any repo:

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
agent-board runs add-task-cli
agent-board logs <run-id>
```

## Concepts

| Concept | Purpose |
| --- | --- |
| Project | Repo/execution boundary registered by `repo_path`. |
| Goal | Focused PM slice inside a project. Tasks and runs are goal-level. |
| Task | Concrete executable work item with status and graph metadata. |
| Spec | Durable reasoning, design plan, acceptance criteria, or decisions. |
| Knowledge | Reusable notes, gotchas, and project facts. |
| Workflow | YAML recipe that runs agent steps sequentially or in parallel. |
| Run | Stored workflow execution logs and prompts. |
| Skill | Agent instructions installed globally; `agent-board` ships one bundled skill. |

## Storage Model

There is no project-local `.agent` source of truth. Everything lives under `~/.agent-board`:

```txt
~/.agent-board/
  registry.json
  workflows/
  specs/
  knowledge/
  skills/agent-board/
  projects/<project-slug>/
    project.json
    workflows/
    specs/
    knowledge/
    goals/<goal-slug>/
      goal.md
      tasks/
      runs/
      workflows/
      specs/
      knowledge/
      status.md
```

The CLI resolves the current project by matching `cwd` against registered `repo_path` values. Use overrides when needed:

```sh
agent-board --project my-project --goal cli-mvp status
AGENT_BOARD_PROJECT=my-project AGENT_BOARD_GOAL=cli-mvp agent-board status
```

## Overlays

Specs, knowledge, and workflows exist at three levels:

- `global`: reusable across projects.
- `project`: repo-level defaults and shared context.
- `goal`: slice-specific notes, temporary decisions, and overrides.

Workflow lookup precedence is:

```txt
goal > project > global
```

Unqualified spec lookups resolve:

```txt
goal > project > global
```

Use qualified refs for cross-project or exact-scope references:

```txt
task:<project>/<goal>/<task>
spec:<scope>/<id>
knowledge:<scope>/<id>
```

## Task Format

Each task is one Markdown file with frontmatter:

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

## Workflow Format

Workflows are YAML recipes in any overlay `workflows/` folder.

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

- `repo:<path>` reads from the registered repo.
- `task:current` renders the active task.
- `specs:linked` renders task-linked specs.
- `knowledge:global`, `knowledge:project`, `knowledge:goal` render scoped knowledge.
- `runs:current` renders the current run folder.

Supported template variables:

- `{{task.id}}`
- `{{task.title}}`
- `{{task.status}}`
- `{{workspace.path}}`
- `{{repo.path}}`
- `{{project.id}}`
- `{{goal.id}}`
- `{{run.path}}`

## Agent Execution

Default agent commands are trusted local execution:

```sh
codex exec --dangerously-bypass-approvals-and-sandbox -
claude -p --permission-mode bypassPermissions
```

Override binaries and args:

```sh
AGENT_BOARD_CODEX_BIN=/path/to/codex
AGENT_BOARD_CLAUDE_BIN=/path/to/claude
AGENT_BOARD_CODEX_ARGS='exec --dangerously-bypass-approvals-and-sandbox -'
AGENT_BOARD_CLAUDE_ARGS='-p --permission-mode bypassPermissions'
```

Custom workflow agent names use:

```sh
AGENT_BOARD_<AGENT_NAME>_BIN=/path/to/binary
```

## Commands

Project and goals:

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
agent-board logs <run-id> [--step <step-id>]
```

Skills:

```sh
agent-board skills install
```

## Bundled Workflows

`agent-board init` installs default workflow YAML into the global overlay:

- `research`: inspect repo context and create findings/specs/tasks.
- `triage`: break a goal into tasks, blockers, and parallel lanes.
- `dev`: implement with review/validation sidecars and finalization.
- `validate`: focused review/test pass with follow-up task creation.

## Bundled Skill

`agent-board skills install` links one skill globally:

```txt
~/.claude/skills/agent-board -> ~/.agent-board/skills/agent-board
~/.agents/skills/agent-board -> ~/.agent-board/skills/agent-board
```

The skill has compact references:

```txt
SKILL.md
AGENTS.md
references/config.md
references/pm-orchestrator.md
references/task-workflow.md
references/research-workflow.md
references/review-workflow.md
```

The installer never overwrites unsafe existing paths.

## PM Workflow

Recommended operating loop for an agent acting as PM:

1. Run `agent-board status` and `agent-board plan --related`.
2. Confirm the active goal with `agent-board goals`.
3. For vague work, run `research` or `triage`.
4. Create specs for durable reasoning.
5. Create small tasks and link dependencies.
6. Delegate implementation through `agent-board run <task> --workflow dev`.
7. Inspect `agent-board runs` and `agent-board logs <run-id>`.
8. Create follow-up tasks for real review findings.
9. Mark tasks `done` only when criteria are satisfied.

## Agent Modes

The bundled skill nudges agents into two modes:

- `orchestrator` mode is the default for PM sessions. The agent plans, writes specs, creates tasks, links blockers, runs workflows, observes outputs, and updates board state. It should not claim or implement tasks itself unless explicitly asked.
- `worker` mode starts when the user directly asks the current agent to implement/fix something, or when a workflow prompt spawns the agent for a concrete task. The worker claims the task, edits files, runs checks, and updates task state.

This is the intended control loop:

```sh
agent-board plan --related
agent-board run <ready-task> --workflow dev
agent-board runs <ready-task>
agent-board logs <run-id>
```

The runner is foreground in V1: the orchestrator starts the worker process, streams output, stores logs, then decides the next action from the run folder. Background supervision can be added later.

## Migration

For older flat layouts:

```sh
agent-board migrate --project <slug>
```

Migration copies old `tasks`, `specs`, `knowledge`, `runs`, and `workflows` into `goals/main` and rewrites legacy `.agent/*` workflow context aliases where safe. Existing `.agent` symlinks are ignored, not removed.

## Development

```sh
bun install
bun run check-types
bun test
```

The test suite covers frontmatter parsing, task graph linking, overlays, workflow prompt rendering, fake-agent workflow runs, global skills install, related project planning, and migration.

## License

MIT
