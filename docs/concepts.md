# Concepts

`agent-board` stores local Markdown state under `~/.agent-board` by default. Override with `AGENT_BOARD_HOME` for tests or isolated workspaces.

## Layout

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
    flows/
    specs/
    knowledge/
    goals/<goal>/
      goal.md
      status.md
      tasks/
      specs/
      knowledge/
      flows/runs/
```

The registry maps repository paths to projects. From any subdirectory in a registered repo, the CLI resolves the project and active goal.

## Project, Goal, Task

**Project** is a registered repository path.

**Goal** is the active slice of work inside a project. Tasks belong to a goal.

**Task** is the executable unit. It can be claimed, verified, reviewed, blocked, and done.

**Spec** is durable reasoning: decisions, tradeoffs, acceptance criteria, and implementation plans.

**Knowledge** is reusable memory: conventions, facts, gotchas, and decisions.

## Overlays

Specs and knowledge can live at three scopes:

- `global`: shared across projects
- `project`: shared by all goals in one repo
- `goal`: specific to the active slice

Lookup is nearest-first:

```txt
goal > project > global
```

Qualified references:

```txt
task:<project>/<goal>/<task>
spec:<scope>/<id>
knowledge:<scope>/<id>
```

## Task Contract

A task is a Markdown file with frontmatter:

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

Acceptance criteria gate `done`:

```md
## Acceptance Criteria

- [ ] Define success criteria.
```

The `## Verify` block holds one shell command per line inside a fenced code block. `agent-board verify` runs those commands from the repo root and appends evidence.

````md
## Verify

```sh
bun run check-types
bun test
```
````

## Concurrency

Board writes are atomic. Claims use an exclusive lock so two workers cannot both claim the same task.

For concurrent agents:

- Different repositories are isolated automatically.
- Same repository, separate implementation work: prefer separate git worktrees and set `AGENT_BOARD_REPO`.
- Same repository, same worktree: safe only when the controller prevents branch switching, commits, reset/rebase, overlapping file edits, and concurrent git operations.

Pin concurrent workers with:

```sh
AGENT_BOARD_PROJECT=myproj AGENT_BOARD_GOAL=goal-a AGENT_BOARD_REPO=/path/to/worktree agent ...
```

## Storage Model

The current backend is local Markdown on disk. Future Linear, S3/R2, DB, or
custom API integrations should preserve the same task/spec/goal semantics behind
adapter contracts instead of changing how agents use the CLI.

See [Storage Adapters](storage-adapters.md) for the proposed `BoardStore`,
`ArtifactStore`, sync, and Autopilot integration model.
