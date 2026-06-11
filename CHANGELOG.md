# Changelog

Notable changes to `@questpie/agent-board` (CLI binaries: `agent-board`, `agent`).

## Unreleased

## 0.5.0 — 2026-06-11

- **Design skills**: two new bundled skills — `agent-board-design-wireframe` authors an HTML-mockup wireframe (zero-build React-UMD + Babel, a window-globals design kit, a Figma-like canvas of device-sized artboards), and `agent-board-design-review` gives a read-only, spec-linked critique of one. `agent-board skills install` links both into the Claude/agents/Cursor runtimes alongside the existing three, so the same agent that holds the specs can prototype UI as HTML mockups.
- **Worktree-aware resolution**: commands run inside a linked git worktree now resolve to the project of its main checkout. Home-registry lookups follow the worktree's `.git` pointer back to the registered repository; a local board in the main checkout governs all of its worktrees (a committed board copy inside a worktree is no longer written to, so task state cannot fork per worktree). The workspace repo stays the worktree itself, so claims and verify run in the agent's own checkout — `AGENT_BOARD_REPO` remains the explicit override. Fixes spurious `No agent-board project found` / exit 1 from agents working in worktrees.
- **Actionable resolution errors**: the project-not-found error now reports the cwd it failed for, lists registered projects, and points at `--project <slug>` / `AGENT_BOARD_PROJECT` before suggesting `agent-board init` — so an agent in a worktree no longer gets steered into registering a duplicate project.

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
