# Concepts

`agent-board` stores local Markdown state in one of two places: the shared **home** board at `~/.agent-board` (default; override with `AGENT_BOARD_HOME`), or a repo-local `.agent-board/` created with `agent-board init --local` and git-versioned with the project. Move between them with `agent-board relocate --to local|home`.

## Layout

```txt
~/.agent-board/
  registry.json
  specs/
  knowledge/
  wireframes/
  skills/
    agent-board/
    agent-board-bootstrap/
    agent-board-research/
    agent-board-spec/
    agent-board-safe-workflow/
    agent-board-flow/
    agent-board-implement/
    agent-board-worker/
    agent-board-grill/
    agent-board-maintenance/
    agent-board-design-wireframe/
    agent-board-design-review/
  projects/<project>/
    project.json
    flows/
    specs/
    knowledge/
    wireframes/
    goals/<goal>/
      goal.md
      status.md
      tasks/
      specs/
      knowledge/
      wireframes/
      flows/runs/
```

A repo-local board (`init --local`) is flatter — a single project with no `projects/` wrapper and no registry:

```txt
<repo>/.agent-board/
  project.json        # no stored repo_path; derived from location
  .gitignore          # ignores transient flows/runs
  specs/
  knowledge/
  wireframes/
  flows/
  goals/<goal>/
    goal.md
    status.md
    tasks/
    specs/
    knowledge/
    wireframes/
    flows/runs/
```

Resolution precedence from the working directory: `AGENT_BOARD_HOME` (explicit) → a `.agent-board/` found by walking up (stopping at `$HOME`) → the main checkout's `.agent-board/` when the working directory sits in a linked git worktree → `~/.agent-board`. The home registry maps repository paths to projects; a local board needs no registry, since its location identifies the project.

Linked git worktrees resolve to their main checkout's project in both modes: home-registry matching follows the worktree's `.git` pointer back to the registered repository, and a local board in the main checkout governs all of its worktrees (a committed board copy inside a worktree is never written to, so task state cannot fork per worktree). The workspace repo, however, stays the worktree itself — claims, verify, and other git operations run in the agent's own checkout. `AGENT_BOARD_REPO` remains the explicit override.

## Project, Goal, Task

**Project** is a repository's board — a registered path in home mode, or the repo containing a local `.agent-board/`.

**Goal** is a slice of work inside a project. Tasks belong to a goal. `project.json`
stores `active_goal` as a convenience default for humans; parallel agents should
pin their goal with `--goal <id>` or `AGENT_BOARD_GOAL=<id>` instead of running
`goal use`, because `goal use` mutates shared project state.

**Task** is the executable unit. It can be claimed, verified, reviewed, blocked, and done.

**Spec** is durable reasoning: decisions, tradeoffs, acceptance criteria, and implementation plans.

**Knowledge** is reusable memory: conventions, facts, gotchas, and decisions.

## Overlays

Specs, knowledge, and wireframes can live at three scopes:

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
wireframe:<scope>/<id>
```

## Design Gate

Frontend and product work should be represented on the board before production
code starts:

```txt
spec -> wireframe/design board -> design review -> implementation tasks
```

Wireframes are durable board artifacts, not throwaway chat context. Link the
implementation tasks to the spec and mention the relevant `wireframe:<scope>/<id>`
until first-class task-wireframe links exist. A design review can create blocking
follow-up tasks, design gotchas in knowledge, or approval evidence for the next
implementation wave.

## Safe Workflow Gate

User-facing behavior should be represented as a no-regression contract before
production code starts:

```txt
use cases -> scenario matrix -> failing test/replay -> implementation -> full regression
```

Use stable use-case and flow ids such as `UC-001` and `F01`, then describe each
scenario with a lower-kebab slug, layer, actors, states, locales, fixtures,
real-API requirement, and verify command. UI-facing tests should use stable,
locale-independent selectors/test ids based on product terms. The final task is
not done until the new scenario and the existing regression suite pass.

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
archived: "true"                 # optional; hidden from default active views
archived_at: "2026-05-17T00:00:00.000Z"
archived_reason: "Superseded by add-task-cli-v2"
superseded_by: "task:demo/main/add-task-cli-v2"
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

## Archive

Archive is reversible metadata, not deletion. `agent-board archive task|spec|knowledge`
adds frontmatter fields (`archived`, `archived_at`, `archived_reason`, and
optional `superseded_by`). Default active views hide archived tasks/specs/knowledge;
use `tasks --archived`, `spec list --archived`, `knowledge list --archived`, or
`archive list` to inspect them. Archived tasks do not satisfy dependencies.

Flow-run archives are `archive.json` marker files inside
`goals/<goal>/flows/runs/<run-id>/`. The run artifacts remain on disk.

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
one store driver. Agents should still use explicit `agent-board` subcommands;
the driver decides where records are persisted.

See [Storage Drivers](storage-adapters.md) for the proposed command boundary and
driver contract.
