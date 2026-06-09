# Changelog

Notable changes to `@questpie/agent-board` (CLI binaries: `agent-board`, `agent`).

## 0.4.0 — 2026-06-10

First npm release, published as `@questpie/agent-board`.

- **Flows**: agent-authored JS orchestration scripts run by `agent-board flow` — `agent()`, `parallel()`, `pipeline()`, structured JSON via `agent(prompt, { schema })`, optional `meta` with phases. Templates `default`, `feature`, `review`, `fix`; ad-hoc read-only fan-out with `flow run "<prompt>" --agents N`.
- **Flow permission modes**: agents run read-only by default (`mode: "read"` maps to auto-reject); write access is an explicit per-agent opt-in.
- **Flow telemetry**: throttled `events.jsonl` lifecycle stream, `flow watch <run-id>` live tail, filtered `diagnostics.jsonl`, bundled native `codex-acp` binary for macOS Keychain stability (`AGENT_BOARD_CODEX_ACP_BIN` override).
- **Web viewer**: `agent-board web` serves a local read-only board UI — goals with progress, full task graph, specs/knowledge filtered by category, flow runs with polling timeline, deep-linkable tabs. No build step, no database.
- **Local boards**: `init --local` keeps a git-versioned `.agent-board/` in the repo; `relocate --to local|home` moves an existing board; `nudge` manages the agent-board block in `CLAUDE.md`/`AGENTS.md`.
- **Categories**: `spec new --category`, `spec categorize`, `list --category`, and the knowledge equivalents.
- **Command-boundary writes**: `task|spec|knowledge cat/write` and `flow cat/write` so agents never depend on filesystem paths.
- **Organization skill reference**: naming conventions for goals, tasks, specs, and knowledge; script syntax highlighting in the viewer.
- **Hardening**: all task mutations route through one lock, `link --blocks` validates the target before mutating, verify gets a timeout and surfaces an output tail on failure, a flow failure stops scheduling new agents.

## 0.3.0 — 2026-05-29

- Removed the YAML workflow DSL and subprocess runner (`run`, `runs`, `logs`, `workflows` commands): it bypassed the claim/verify/done contract. agent-board reduced to the task board plus execution contract; orchestration returned in 0.4.0 as agent-authored flows that feed evidence back into the contract.

## 0.2.1 — 2026-05-28

- Execution contract: `claim` guards (detached HEAD, unfinished dependencies, no claim stealing), `## Verify` command blocks with recorded evidence, `done` gated on acceptance criteria and a passing verify, `done --force --reason` escape hatch.
- Skills split into `agent-board` (controller), `agent-board-worker`, and `agent-board-research`; Cursor skill install; `skills doctor`.
- Concurrency hardening: atomic board writes, exclusive claim locks, `AGENT_BOARD_REPO` worktree override.

## 0.1.0 — 2026-05-16

- Initial public release: Markdown board under `~/.agent-board`, projects/goals/tasks with dependencies, specs and knowledge with global/project/goal overlay scopes, bundled skills install.
