# agent-board

Local control plane for coding agents.

`agent-board` gives Codex, Claude Code, Cursor, and similar agents a shared Markdown task board plus a small CLI contract. Humans can keep talking in natural language; controller agents use the CLI to plan goals, split tasks, delegate workers, run flow scripts, and record evidence.

## Why

Long-running agent work fails when the plan lives only in chat. `agent-board` keeps the durable state on disk:

- `goals` focus a slice of work
- `tasks` track executable work, dependencies, blockers, assignees, and verify evidence
- `specs` hold decisions and acceptance criteria
- `knowledge` captures reusable facts and gotchas
- `flows` let a controller agent run local multi-agent fan-out, review, and synthesis

The CLI enforces the parts prose cannot: claim locking, detached-HEAD guards, dependency checks, verify evidence, and done gates.

## Install From Source

```sh
bun install
bun link
agent-board skills install
```

`agent-board skills install` links the bundled skills into supported local runtimes:

```txt
~/.claude/skills/{agent-board,agent-board-worker,agent-board-research}
~/.agents/skills/{agent-board,agent-board-worker,agent-board-research}
~/.cursor/skills/{agent-board,agent-board-worker,agent-board-research}
```

Check links with:

```sh
agent-board skills doctor
```

## 60-Second Quickstart

From a repository:

```sh
agent-board init --project my-project
agent-board goal new "CLI MVP" --id cli-mvp
agent-board goal use cli-mvp

agent-board spec new "CLI MVP plan" --scope project
agent-board new "Add task CLI" --status ready --priority high
agent-board link add-task-cli --spec cli-mvp-plan

agent-board status
agent-board plan
```

A worker handles one explicit task:

```sh
agent-board claim add-task-cli --agent worker-1
agent-board verify add-task-cli
agent-board done add-task-cli
```

`done` is blocked until acceptance criteria are checked and the task's `## Verify` commands pass.

## Skills

Three skills are bundled:

- `agent-board`: controller/orchestrator. Plans goals, writes specs, creates and links tasks, delegates workers, reviews evidence, and controls flow waves.
- `agent-board-worker`: executes one explicit task id. Claims, edits, verifies, and closes the task.
- `agent-board-research`: read-only discovery. Turns uncertainty into specs, knowledge, blockers, and concrete tasks.

The split keeps hot skill context small: controllers do not carry worker implementation detail, and workers do not choose the roadmap.

## Optional Flows

`agent-board flow` is agent-facing. The human describes desired work in natural language; the controller agent can create and edit a workflow script, summarize the phases, then run it after approval or explicit go-ahead.

Quick read-only fan-out:

```sh
agent-board flow run "Find the highest-risk missing tests" --agents 3 --concurrency 3
```

Agent-written reusable flow:

```sh
agent-board flow new audit
# agent edits ~/.agent-board/projects/<project>/flows/audit.mjs
agent-board flow run audit --input "Audit deploy pipeline" --task deploy-audit
agent-board flow show <run-id>
```

Flow runs write:

```txt
summary.md        # read this first
agents/*.md       # per-agent details
events.jsonl      # compact lifecycle metadata
diagnostics.jsonl # filtered runtime issues only
```

Raw Codex/ACP stderr is quiet by default; use `--verbose` only when debugging the runtime.

## Concepts

State lives under `~/.agent-board` by default. Repositories are registered by path, tasks belong to goals, and specs/knowledge support global, project, and goal overlays.

Read the deeper docs:

- [Concepts](docs/concepts.md)
- [Flows](docs/flows.md)
- [CLI Reference](docs/cli-reference.md)
- [Execution Contract RFC](docs/rfc-execution-contract.md)

## Development

```sh
bun install
bun run check-types
bun test
```

The tests cover frontmatter parsing, task graph links, overlays, git state detection, verify gates, claim guards, atomic writes, concurrent-claim locking, global skill install, related project planning, migration, and mocked flow runs.

## License

MIT
