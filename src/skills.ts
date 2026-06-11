export const skillReadme = `---
name: agent-board
description: "Orchestrate and plan work with agent-board: goals, specs, task graphs, dependencies, flows, sprints, and delegating tasks to workers. Use when planning whole features, breaking work into goals/tasks/subtasks, running multi-agent flow fan-out/review/synthesis, or reviewing task state. Orchestrator mode by default — delegate implementation to a worker that follows the agent-board-worker skill. Triggers: agent-board, flow, sprint, plan, goal, delegate, multitask, orchestrate, organize, naming conventions, tidy board, task board, backlog."
---

# Agent Board

Use when controlling agent-board work: goals, specs, task graph, delegation, flow waves, and review. This is the controller/orchestrator skill, not the implementation skill.

## Role

- Keep durable state in \`agent-board\`, not hidden in chat.
- Create goals/specs/tasks, link dependencies, delegate explicit task ids, review evidence, and decide the next wave.
- Do not claim or implement tasks yourself unless the user explicitly switches you into worker mode.

## Controller Loop

1. Run \`agent-board status\`; use \`agent-board plan --related\` only when related projects matter.
2. Read the relevant task/specs/knowledge before deciding.
3. For broad work, create or choose a goal, write a spec, then split into linked tasks. Subtasks are small linked tasks, not checklist prose.
4. Delegate ready implementation to workers that use \`agent-board-worker\` and a specific task id.
5. Use \`agent-board flow new <name> --template <kind>\`, inspect/edit with \`flow cat/write\`, then run multi-agent fan-out, reviews, or synthesis after user approval unless execution was already explicit.
6. Read \`summary.md\` first; inspect \`agents/*.md\` or \`diagnostics.jsonl\` only when needed.
7. Update tasks/specs/knowledge from evidence, then choose the next wave.

## Delegation Contract

- Worker prompt must include the task id and say to use \`agent-board-worker\`.
- Research/audit prompt should use \`agent-board-research\` and stay read-only.
- Flow scripts are agent-authored orchestration tools. The main chat remains controller; spawned agents do not own roadmap, branch, commit, or final done decisions.

## Commands To Reach For

- \`agent-board status\`, \`agent-board plan --related\`
- \`agent-board goal new\`, \`agent-board spec new\`, \`agent-board knowledge add\`; use \`--goal <id>\` or \`AGENT_BOARD_GOAL=<id>\` instead of switching shared active goal during agent work
- \`agent-board new\`, \`agent-board link <from> --blocks <to>\`, \`agent-board progress <task> "<checkpoint>"\`, \`agent-board block <task> "<reason>"\`
- \`agent-board task/spec/knowledge cat|write\`, \`agent-board flow new <name> --template feature|review|fix\`, \`agent-board flow cat|write\`, \`agent-board flow run <name>\`
- \`agent-board nudge\` when the CLI tips that CLAUDE.md/AGENTS.md don't mention agent-board

## References

- \`references/organization.md\` - naming and structure conventions: numbered phase goals, verb-object tasks, noun-phrase specs, categorized knowledge. Read this when asked to organize, tidy, or rename a board.
- \`references/pm-orchestrator.md\` - PM loop, task breakdown, blockers, parallelization.
- \`references/flow-orchestration.md\` - controller loop, fan-out, cross-agent reviews, synthesis, and staged execution.
- \`references/task-workflow.md\` - worker lifecycle for picking up and closing tasks.
- \`references/research-workflow.md\` - discovery, specs, and task creation.
- \`references/review-workflow.md\` - review, validation, and follow-up tasks.
- \`references/config.md\` - workspace layout, scopes, and skill links.
`;

export const skillAgents = `# Agent Board Rules

- Start with \`agent-board status\`; use \`agent-board plan --related\` for cross-project blockers.
- Controller mode: plan, create specs/tasks, link blockers, delegate, review evidence. Do not claim/edit implementation tasks unless explicitly asked.
- Broad features become a goal/spec plus linked tasks; subtasks are first-class tasks, not hidden checklist prose.
- Worker delegation must include a concrete task id and the \`agent-board-worker\` skill.
- Use \`agent-board flow new <name> --template <kind>\`, inspect/edit with \`flow cat/write\`, summarize phases, then \`flow run\` after approval or explicit go-ahead.
- \`flow run\` prints live progress by default; use \`agent-board progress <task-id> "<checkpoint>"\` for durable task-level handoffs during long work.
- Read flow \`summary.md\` before per-agent outputs; open \`diagnostics.jsonl\` only for runtime debugging.
- Keep task Markdown concise; logs stay in flow/run folders.
- Organizing or naming: goals are numbered phases (\`NN-slug\`), tasks are \`verb-object\`, specs are noun phrases, knowledge is kind + category. See references/organization.md.
`;

export const workerSkillReadme = `---
name: agent-board-worker
description: "Implement or fix a single agent-board task as a worker. Use when told to claim, implement, fix, or work on a specific task. Enforces the safe sequence: checkout the task branch, claim, implement, verify, done — never commit on a detached HEAD. Triggers: claim, implement task, fix task, work on task, worker mode, agent-board claim, pick up task."
---

# Agent Board Worker

Use this skill when implementing or fixing ONE concrete agent-board task. You are in WORKER mode: execute a single task end to end. For planning, breakdown, or delegation, use the \`agent-board\` (orchestrator) skill instead.

## Mandatory sequence

0. If no task id was provided, stop and ask. Do not pick \`agent-board next\` on your own.
1. Read the task and its context: \`agent-board show <task-id>\` (goal, acceptance criteria, \`## Verify\` block, target branch).
2. Get on the right branch BEFORE any edit or commit:
   - Run \`git branch --show-current\`. Never commit on a detached HEAD.
   - If the task frontmatter names a \`branch:\`, \`git checkout <branch>\` first.
3. Claim it: \`agent-board claim <task-id> --agent <your-name>\`.
   - This is rejected on a detached HEAD or with unfinished dependencies. Fix the cause; do not pass \`--allow-detached\` unless the user said the repo is intentionally detached.
4. Implement on that branch. Keep commits scoped to this task.
5. During long work, record durable checkpoints: \`agent-board progress <task-id> "<what changed / what you learned>" --agent <your-name>\`. Use \`--from -\` for multiline handoffs. This is for intermediate findings, not a substitute for verify.
6. Verify before requesting done: \`agent-board verify <task-id>\` runs the task's \`## Verify\` commands from the repo root and records evidence. All must pass.
7. Close: \`agent-board done <task-id>\` — blocked unless acceptance criteria are checked and verify passed. Forcing requires \`--force --reason "<why>"\` and is logged as evidence (orchestrator decision, not the worker's).
8. If blocked, stop and record it: \`agent-board block <task-id> "<reason>"\`.

## Git rules

- Never commit on a detached HEAD; check \`git branch --show-current\` first.
- Commit on the branch named in the task (frontmatter \`branch:\`) or the branch the orchestrator gave you.
- Do not switch branches mid-task or mix unrelated changes.

## Verify rules

- The \`## Verify\` block holds one shell command per line inside a fenced code block.
- Run \`agent-board verify <id>\`; fix failures before \`done\`. If a command is wrong, fix the \`## Verify\` block — don't skip it.
- If the task should have verify commands but has none, add them.

## Isolation (when multiple agents run at once)

- Your project, goal, and repo are pinned via environment: \`AGENT_BOARD_PROJECT\`, \`AGENT_BOARD_GOAL\`, and (for a git worktree) \`AGENT_BOARD_REPO\`. Work only inside them.
- Never run \`agent-board goal use\` — the active goal is shared mutable state; switching it derails every other agent in the project.
- If you share one repository with another agent, work in your own git worktree and set \`AGENT_BOARD_REPO\` to it, so checkouts, branches, and verify do not collide. (A linked worktree also resolves to its main checkout's project automatically when the env is missing; the env vars remain the explicit, preferred pin.)
- If spawned by \`agent-board flow\`, you are still a normal worker. The flow runner does not waive claim, branch, verify, or evidence rules.

## Don't

- Don't plan or build the task graph — that's the orchestrator.
- Don't mark tasks done without verify evidence.
- Don't edit files outside this task's scope.
`;

export const workerSkillAgents = `# Agent Board Worker Rules

- Worker mode: execute one claimed task; do not plan or create the task graph.
- Get on the task branch before editing; never commit on a detached HEAD (\`git branch --show-current\`).
- Sequence: \`agent-board show\` -> checkout branch -> \`agent-board claim <id> --agent <name>\` -> implement -> \`agent-board verify <id>\` -> \`agent-board done <id>\`.
- For long work or handoff-worthy findings, run \`agent-board progress <id> "<checkpoint>" --agent <name>\`; use \`--from -\` for multiline notes.
- Closing is blocked until acceptance criteria are checked and verify passed; only the orchestrator forces, with \`--force --reason\`.
- If stuck, \`agent-board block <id> "<reason>"\` instead of forcing through.
`;

export const researchSkillReadme = `---
name: agent-board-research
description: "Research, audit, or discover before implementation with agent-board. Use for repo investigation, feasibility/MVP evaluation, and turning uncertainty into specs and tasks. Read-only: no commits unless the user approves. Triggers: research, audit, discover, investigate, explore, feasibility, MVP evaluation, spec out, scope."
---

# Agent Board Research

Use this skill for discovery before implementation. You are in RESEARCH mode: investigate and turn uncertainty into durable context. Do not implement or commit unless the user explicitly approves.

## Loop

1. Read the task, linked specs, knowledge, and repo instructions (\`agent-board show <id>\`).
2. Investigate the repo: relevant files, APIs, current patterns, risks, and unknowns.
3. Write durable findings into specs (\`agent-board spec new <title>\`) or knowledge (\`agent-board knowledge add <title> --kind note\`).
4. Create concrete tasks only when the breakdown is clear (\`agent-board new\`), and link dependencies (\`agent-board link <from> --blocks <to>\`).
5. Mark missing decisions as blockers.

## Output should answer

- Relevant files/APIs and existing patterns.
- Missing decisions and open questions.
- Parallelizable work and dependencies.
- Concrete blockers.

## Don't

- Don't commit code or edit implementation files unless the user approves.
- Don't invent a plan past what the evidence supports.
`;

export const researchSkillAgents = `# Agent Board Research Rules

- Research mode: read-only. No commits or implementation edits unless the user approves.
- Turn findings into specs, knowledge, and concrete linked tasks.
- Prefer file references and concrete risks over vague notes; mark missing decisions as blockers.
`;

export const maintenanceSkillReadme = `---
name: agent-board-maintenance
description: "Audit and maintain an agent-board without destructive cleanup. Use when asked to clean up stale flow runs, stale claims, broken links, duplicate specs/knowledge, knowledge/spec consolidation, board hygiene, retry readiness, or maintenance reports. Read-only by default."
---

# Agent Board Maintenance

Use this skill when the user asks about stale runs, cleanup, idempotent retry readiness, broken links, duplicate knowledge/specs, or board hygiene. You are in MAINTENANCE mode: inspect and report first. Do not delete files, retry flows, rewrite specs/knowledge, or change task state unless the user explicitly approves a specific action.

## Loop

1. Run \`agent-board maintenance --stale-after 24h\` from the project.
2. If the report is large or automation needs the data, rerun \`agent-board maintenance --json\`.
3. Read the specific tasks, flow summaries, specs, or knowledge docs referenced by the report before proposing changes.
4. Group findings into:
   - stale claims that may need unblock/reclaim/block decisions,
   - stale or failed flow runs that may need manual archive, retry planning, or investigation,
   - broken task/spec links,
   - spec/knowledge consolidation candidates.
5. Propose a small, ordered cleanup plan with exact commands or files to edit.
6. Apply changes only after approval. Keep destructive cleanup and flow retry explicit.

## Commands To Reach For

- \`agent-board maintenance\`
- \`agent-board maintenance --json\`
- \`agent-board maintenance --stale-after 7d\`
- \`agent-board show <task-id>\`
- \`agent-board flow show <run-id>\`
- \`agent-board spec cat <spec-id>\`, \`agent-board knowledge cat <knowledge-id>\`
- \`agent-board spec write <spec-id> --from <file|->\`, \`agent-board knowledge write <knowledge-id> --from <file|->\` only after approval

## Guardrails

- Treat the report as a dry-run: it is evidence, not permission to mutate.
- Do not remove \`flows/runs/<run-id>\` directories from a user repo unless the user approved that exact run or retention rule.
- Do not retry a flow by guessing command history. Idempotent retry needs an explicit CLI contract or a user-approved replay plan.
- Do not merge knowledge/spec documents until you have read all source docs and preserved important decisions, gotchas, and links.
`;

export const maintenanceSkillAgents = `# Agent Board Maintenance Rules

- Maintenance mode: read-only first. Start with \`agent-board maintenance\`.
- Use \`agent-board maintenance --json\` for structured automation or large reports.
- Report stale claims, stale/failed flow runs, broken links, and spec/knowledge consolidation candidates separately.
- Do not delete run folders, rewrite docs, change task state, or retry flows without explicit approval.
- For consolidation, read every source doc before proposing a canonical spec/knowledge note.
`;

export const configSkillReadme = `# Agent Board Configuration

Use this skill when setting up or changing \`agent-board\` itself in a project.

## Storage Modes

\`agent-board\` is file-based and stores a board in one of two places:

- **Home (default):** the shared \`~/.agent-board\` (override with \`AGENT_BOARD_HOME\`). Multiplexes many projects under \`projects/<project-slug>\`, indexed by \`registry.json\` (maps \`repo_path\` -> project; linked git worktrees resolve to their main checkout's project automatically). Keeps board state out of the repo so parallel agents/worktrees never collide on it.
- **Local:** a single-project \`.agent-board/\` committed inside the repo, git-versioned with the project. Flat layout (no \`projects/\` wrapper, no \`registry.json\`), and \`project.json\` omits \`repo_path\` (derived from the board location) so it stays portable across clones and machines.

Discovery precedence when resolving which board governs a command:
1. \`AGENT_BOARD_HOME\` set -> that home board.
2. a \`.agent-board/\` found by walking up from cwd (stops at \`$HOME\`) -> that local board. Inside a linked git worktree, the main checkout's board wins over the worktree's own committed copy, so every worktree shares one board.
3. cwd inside a linked git worktree whose main checkout has a \`.agent-board/\` -> that local board.
4. otherwise \`~/.agent-board\`.

Home-registry matching follows the same rule: a cwd inside a linked git worktree resolves to the project registered for its main checkout, and the workspace repo becomes the worktree itself so git operations stay in the agent's own checkout (\`AGENT_BOARD_REPO\` still wins as the explicit override).

Layout:

- Project config: \`project.json\` with \`active_goal\` and \`related_projects\` (plus \`repo_path\` for home boards).
- \`active_goal\` is a human convenience default. Agents and parallel runs should pin goal scope with \`--goal <id>\` or \`AGENT_BOARD_GOAL=<id>\`; \`goal use\` mutates shared project state and non-interactive use requires \`--force\`.
- Goals: \`<board>/goals/<goal-slug>\`; tasks are goal-level only.
- Flow scripts: \`<board>/flows/*.mjs\`; run artifacts: \`<board>/goals/<goal-slug>/flows/runs/<run-id>/\`.
- Home boards prefix the above paths with \`projects/<project-slug>/\`.
- Specs, knowledge, and wireframes: overlay layers at global, project, and goal scope. In a local board, global and project scope collapse (single project).
- Skills are always global: \`~/.agent-board/skills/{agent-board,agent-board-worker,agent-board-research,agent-board-maintenance}\`, linked into \`~/.claude/skills\`, \`~/.agents/skills\`, and \`~/.cursor/skills\` by \`agent-board skills install\`. Local boards never copy skills into the repo.

Why: home keeps board state out of source control and lets many projects/agents share one index; local lets a single project version its board (goals, tasks, specs) alongside the code.

## Setup

Run from the project root:

\`\`\`sh
agent-board init --project <slug>            # home board (default, shared)
agent-board init --local --project <slug>    # repo board (.agent-board/, git-versioned)
\`\`\`

Without \`--local\`/\`--global\`, an interactive terminal is prompted; non-interactive callers (agents, CI) default to home. \`init --local\` anchors the board at the git root and writes a \`.agent-board/.gitignore\` for transient run artifacts.

Move an existing board between modes:

\`\`\`sh
agent-board relocate --to local              # home -> repo (.agent-board/)
agent-board relocate --to home               # repo -> shared home
\`\`\`

Relocate copies project goals/specs/knowledge/wireframes/flows and rewrites \`project.json\` for the target layout. It keeps the source as a backup unless you pass \`--cleanup\`. When moving from home to local, shared home global specs/knowledge/wireframes stay in the home board and the CLI warns because the repo-local board will not see them by default. Local boards store global/project specs, knowledge, and wireframes in one flat directory, so default lists show that directory once.

Init is non-destructive and does not create \`.agent\` or project-local skill links. Use \`agent-board skills install\` for global skill links, \`agent-board skills doctor\` to see which runtimes are linked, and \`agent-board skills check\` to confirm these docs still match the CLI.

## Repo Nudge

Board state stays separate from a repo's agent instructions, so a fresh agent may not know the board exists. When a command runs inside a repo whose \`CLAUDE.md\`/\`AGENTS.md\` don't reference agent-board, the CLI prints a one-line tip. Add a managed, idempotent nudge block (other content preserved) so future agents use the board:

\`\`\`sh
agent-board nudge            # add or refresh the block in CLAUDE.md and AGENTS.md
agent-board nudge --remove   # remove it
\`\`\`

The CLI never writes these files on its own — it only hints; you (or an agent that saw the tip) run \`agent-board nudge\`.

Orient fresh projects:

\`\`\`sh
agent-board projects
agent-board status
agent-board goals
\`\`\`

## Validation Checklist

After configuration changes, run:

\`\`\`sh
agent-board status
agent-board goals
agent-board tasks
\`\`\`
`;

export const taskWorkflowReference = `# Task Workflow

Use this reference when picking up, running, blocking, reviewing, or closing a task.

A task is the smallest executable unit. It should be concrete enough to claim, read context, edit, check, and report without inventing the plan.

Use this reference in worker mode. If you are acting as PM/orchestrator, delegate the task to a worker sub-agent instead of doing it yourself.

1. Start from the task id provided by the controller. If no task id was provided, stop and ask.
2. Read the task with \`agent-board show <task-id>\`.
3. Get on the task branch before editing; never commit on a detached HEAD (check \`git branch --show-current\`).
4. Claim work before editing: \`agent-board claim <task-id> --agent <your-name>\` (rejected on a detached HEAD or with unfinished dependencies).
5. Implement on that branch.
6. During long work, record checkpoints with \`agent-board progress <task-id> "<what changed / what you learned>" --agent <your-name>\`; use \`--from -\` for multiline handoffs.
7. If blocked, run \`agent-board block <task-id> "<reason>"\`.
8. Before done, run \`agent-board verify <task-id>\` (executes the task \`## Verify\` block and records evidence); then \`agent-board done <task-id>\`.

If too broad, create smaller linked tasks. If stuck, block with a concrete reason.

When a broad task needs subtasks, create sibling tasks under the same goal and link them with \`agent-board link <from> --blocks <to>\`. Do not hide executable subtasks only inside prose.

Markdown is the source of truth. Manual edits are fine when frontmatter remains valid.
`;

export const pmOrchestratorSkillReadme = `# PM Orchestrator

Use this skill when acting as the project manager for a repository.

PM owns focus/state, not hidden implementation. Clarify goals, create specs/tasks, link blockers, delegate to workers, review outputs, and choose next work from board state. Do not claim/implement a task yourself unless the user explicitly asks you to switch into worker mode.

1. Start with \`agent-board status\` and \`agent-board plan\`.
2. Use \`agent-board goals\` to confirm the active slice.
3. For unclear goals, research before implementation.
4. Use \`agent-board spec new <title>\` for durable decisions and plans.
5. Break large goals into small implementation tasks with \`agent-board new\`.
6. Use \`agent-board link <from> --blocks <to>\` for ordering.
7. Use \`agent-board link <task> --spec <spec>\` to keep context attached.
8. Use \`agent-board flow run\` when the next wave benefits from fan-out research, cross-agent review, or synthesis.
9. Delegate execution to worker sub-agents (agent-board-worker skill) instead of doing all work directly.
10. Review flow progress, flow summaries, per-task Evidence, and status before deciding next steps.
11. Create follow-up tasks for actionable review findings.

Recipes: for new slices create goal/spec/tasks/dependencies; for discovery run fan-out flows; for ready work hand each task to a worker (agent-board-worker); run cross-agent reviews when risk warrants; review Evidence, update board state, create follow-ups, and only then mark ready/done.

Triage rules: ready tasks are independently executable; blocked tasks need concrete blockers; parallel lanes are independent ready tasks; cross-project blockers use qualified refs + \`agent-board plan --related\`; specs explain why, tasks explain what next.
`;

export const flowOrchestrationSkillReadme = `# Flow Orchestration

Use this reference when the main chat is controlling multi-agent execution with \`agent-board flow\`.

The CLI is for agents, not for humans. The user should be able to say, in natural language, what they want done. The controller agent then uses these commands as tools.

The controller loop is:

1. Confirm the active project/goal: \`agent-board status\`, \`agent-board goals\`.
2. Write or update the feature spec.
3. Break the feature into linked tasks. Subtasks are first-class tasks linked with blockers/dependencies.
4. For non-trivial orchestration, create a workflow script:
   - run \`agent-board flow new <name> --template feature|review|fix\`
   - inspect/edit the generated script with \`agent-board flow cat/write\`
   - encode phases, fan-out, reviews, synthesis, and task/evidence updates in the script
   - summarize the script's phases to the user and ask for confirmation before running, unless the user already explicitly approved execution
5. Run a flow wave for the next uncertainty or work batch:
   - fan-out research: independent agents inspect different risks or subsystems
   - implementation wave: workers handle distinct ready tasks
   - cross-agent review: reviewers inspect outputs/patches from other agents
   - synthesis: one agent summarizes findings into decisions and next steps
6. Read \`summary.md\` first. Open \`agents/*.md\` only for details. Open \`diagnostics.jsonl\` only for runtime/debug issues.
7. Update specs, tasks, blockers, and follow-ups from the evidence.
8. Decide the next wave. The main chat remains the controller; spawned agents do not choose the whole roadmap.

Safe defaults:

- Use Codex runtime first.
- Same worktree is acceptable for P0 when the generated script prevents agents from fighting: no branch switching, no commits, no resets/rebases, no overlapping file edits, and no concurrent git operations from spawned agents.
- For true concurrent write-heavy work, prefer one git worktree per writer and pass \`AGENT_BOARD_REPO\`.
- Flow agents default to \`mode: "read"\` (enforced via \`auto-reject\`: native file reads only, no shell, no edits). Cross-agent reviews and research stay read-only; only opt a role into \`mode: "write"\` when the controller explicitly wants it to edit.
- The controller owns git state and final decisions. Spawned agents do not choose branches, commit policy, or roadmap.
- \`flow run\` prints the run id immediately and renders live progress by default. Pass \`--no-watch\` only when another terminal will follow with \`agent-board flow watch <run-id>\`.
- Flow heartbeats mean liveness, not evidence. Thinking/tool/runtime activity keeps the per-agent activity watchdog alive; a lane only has review evidence once it produces text in \`agents/*.md\` or \`summary.md\`.
- Codex flow subagents default to \`--codex-mcp isolated\`: agent-board generates a minimal \`CODEX_HOME\` without global \`mcp_servers\`, avoiding repeated macOS Keychain prompts for \`Codex MCP Credentials\`. Use \`--codex-mcp inherit\` only when the flow intentionally needs the user's normal Codex MCP integrations.
- For durable partial findings tied to a task, record a checkpoint with \`agent-board progress <task-id> --from -\`; do not rely on git diff as the only handoff.

Agent-side command pattern:

\`\`\`sh
agent-board flow new <name> --template feature
agent-board flow cat <name>
agent-board flow write <name> --from ./flow.mjs
agent-board flow run <name> --input "<scope>" --task <task-id>
\`\`\`

Flow scripts get \`agent()\`, \`parallel()\`, \`log()\`, \`input\`, and workspace metadata. Keep scripts small: orchestration belongs in the script, durable decisions belong in specs/tasks/knowledge. Use \`flow run "<goal>"\` without a script only for quick read-only fan-out; implementation loops should use an explicit script the controller can inspect.
`;

export const researchWorkflowSkillReadme = `# Research Workflow

Use this skill for discovery before implementation.

Research turns uncertainty into durable context: files, APIs, risks, missing decisions, and implementation slices. Do not implement unless explicitly asked.

- Read the task, specs, knowledge, and repository instructions.
- Identify relevant files, APIs, commands, risks, and unknowns.
- Write durable findings into specs or knowledge when useful.
- Create concrete tasks only when the breakdown is clear.
- Mark uncertain or missing decisions as blockers.

Output should answer: relevant files/APIs, existing patterns, missing decisions, parallelizable work, blockers.
`;

export const reviewWorkflowSkillReadme = `# Review Workflow

Use this skill for review, validation, and final checks.

Review prevents false completion. Find concrete bugs, missing tests, regressions, and unresolved criteria; create follow-up tasks for real work.

- Inspect the task, acceptance criteria, changed files, and verify Evidence.
- Prioritize bugs, missing tests, regressions, and blockers.
- Create follow-up tasks for real issues.
- Avoid broad rewrites unless the task requires them.
- Keep review notes concise and actionable.

If no actionable issues, say so and note residual risk or checks not run.
`;

export const organizationReference = `# Organization & Naming

Use this reference when the user asks to organize, tidy, restructure, or name a board cleanly: "organize this", "set up phases", "name these properly", "clean up the backlog". A tidy board reads like a roadmap, top to bottom. Names are the index: make them sort, scan, and group on their own.

## Goals are numbered phases

A goal is one shippable phase of the roadmap. Name the slug \`NN-short-slug\` so goals sort in execution order, and keep the title human.

- \`agent-board goal new "Phase 2: Core API" --id 02-core-api\`
- Phases read in order: \`01-foundation\`, \`02-core-api\`, \`03-admin-ui\`, \`04-hardening\`.
- Reserve \`00-\` for always-on lanes like \`00-backlog\` or \`00-meta\`.
- Keep three to seven active goals. One goal is one phase, not a catch-all.

## Tasks are verb-first units of work

A task is one reviewable, PR-sized change. The slug is \`verb-object\`; ordering lives in the dependency graph, never in the name.

- Slugs: \`add-user-auth\`, \`fix-login-redirect\`, \`wire-stripe-webhook\`, \`remove-legacy-config\`.
- Use a small, steady verb set: add, fix, refactor, remove, wire, migrate, test, document.
- If a title needs the word "and", split it into linked tasks.
- Order with \`agent-board link <from> --blocks <to>\`, not number prefixes.
- Urgency is \`--priority\`; state is status. Do not bake either into the slug.
- Create: \`agent-board new "Add user auth" --status ready --priority high\`.

## Specs are noun phrases

A spec holds the why and the acceptance criteria. The slug is a noun phrase, and a category groups it.

- Slugs: \`auth-architecture\`, \`rate-limiting-design\`, \`pricing-model\`.
- \`agent-board spec new "Auth architecture" --category architecture\`.
- Attach context with \`agent-board link <task> --spec <spec>\`.

## Knowledge is decision, note, or gotcha

Pick the kind, then a tight title that states the fact itself.

- decision: name the decision, e.g. "Use Bun as the runtime".
- gotcha: name the trap, e.g. "Codex flows need codex-acp on macOS".
- note: a reusable fact worth keeping.
- \`agent-board knowledge add "Use Bun as the runtime" --kind decision --category tooling\`.

## Categories are one shared taxonomy

Reuse a small vocabulary across specs and knowledge so the board and the web viewer filter cleanly. Use a single lowercase or kebab-case word: \`architecture\`, \`api\`, \`ui\`, \`ops\`, \`tooling\`, \`product\`. Do not invent a new category per item. Fix drift with \`agent-board spec categorize <id> <category>\` or \`agent-board knowledge categorize <id> <category>\`.

## Scope picks the smallest home

- goal scope: only this phase needs it.
- project scope: shared across phases.
- global scope: shared across repos.

## "Organize this board" checklist

1. Renumber goals into \`NN-slug\` phases; merge overlap and split catch-all goals.
2. Rename tasks to \`verb-object\`; split any "X and Y"; move urgency to \`--priority\` and state to status.
3. Make every ordering explicit with \`agent-board link <from> --blocks <to>\`; the graph is the order.
4. Give specs noun-phrase slugs and a category, and link each task to its spec.
5. Tag knowledge with a kind and a category from the shared taxonomy.
6. Confirm with \`agent-board status\` and \`agent-board plan\` that phases read in order.
`;

export const designWireframeSkillReadme = `---
name: agent-board-design-wireframe
description: "Author or extend an HTML-mockup wireframe (design board) the way Claude Design does: zero-build React-UMD + Babel, a window-globals design kit, and a Figma-like canvas of device-sized artboards. Use when prototyping screens, building UI/UX mockups or wireframes, or designing a flow board before implementation — whenever asked to mock up, prototype, or visually design screens. Pairs with agent-board-design-review. Triggers: wireframe, mockup, prototype, design board, flow board, screen mockup, HTML mockup, UI/UX, visual prototype."
---

# Agent Board · Design Wireframe

Use this skill to AUTHOR a design as a portable HTML-mockup board. The output is a faithful, inspectable prototype a human reviews and a coder implements from — not production code. Authoring HTML mockups with the same agent that holds the specs is the highest-leverage design loop: live, themeable, inspectable, no Figma round-trip.

## The medium: zero-build, in-browser

- One HTML entry loads React + ReactDOM UMD and \`@babel/standalone\` from a CDN. Every design file is \`<script type="text/babel" src="*.jsx">\`; Babel transpiles JSX in the browser. No bundler, no node_modules.
- No imports/exports — files publish to \`window.*\` and read each other from there. So load order IS the dependency graph: kit first, then screens, then the canvas, then an inline App that renders.
- Consequence: it must be served over HTTP, never opened from \`file://\` (Babel fetches each .jsx).

## Structure to follow

1. A design kit (one file): tokens as plain JS objects (colors, fonts, spacing), an inline-SVG \`Icon\`, honest placeholders (gradient \`Photo\` tiles, initials \`Avatar\` — never fabricated imagery), device chrome (status bar, a \`Screen\` frame, tab bars), and atoms (\`Btn\`, \`Chip\`, \`Toggle\`). Publish each to \`window\`.
2. Screen modules: each defines screen components (\`ScrXxx\`) and any explainer boards (\`BoardXxx\`) on \`window\`.
3. A canvas: a Figma-like wrapper that lays titled sections of artboards out with pan/zoom. Build a minimal one, or harvest the full pan/zoom/focus/export canvas from a Claude Design export and reuse it.
4. An inline App: a factory like \`A(id, label, child, w, h)\` builds artboards; group them into titled sections; render with \`ReactDOM.createRoot\`.

## Conventions that make it good

- Honest placeholders only — never fake photos, logos, or real-looking data passed off as content.
- Tokens as objects, referenced everywhere; no scattered hex, so a theme swap is one edit.
- One screen = one artboard at a real device size (e.g. 390×844 phone, 1320×896 desktop).
- A section is one user flow or screen family; an artboard label states the screen's intent and the spec section it satisfies.
- Match the platform's chrome (native status/tab bars vs a browser frame) so the prototype reads true.

## Preview (verify visually before handing off)

Serve the bundle over HTTP and open it. A plain static server works; this zero-dep server also shims the canvas file-write bridge so artboard reorder/rename/hide persist to a sidecar:

\`\`\`js
// preview.js — run: bun preview.js ; open http://localhost:4848
const DIR = "./design/board", PORT = 4848;
const SHIM = '<script>window.omelette={writeFile:(f,c)=>' +
  'fetch("/__write?f="+encodeURIComponent(f),{method:"PUT",body:c})' +
  '.then(r=>{if(!r.ok)throw new Error("write")})}</' + 'script>';
Bun.serve({ port: PORT, async fetch(req) {
  const u = new URL(req.url);
  if (req.method === "PUT" && u.pathname === "/__write") {
    if (u.searchParams.get("f") !== ".design-canvas.state.json")
      return new Response("forbidden", { status: 403 });
    await Bun.write(DIR + "/" + u.searchParams.get("f"), await req.text());
    return new Response("ok");
  }
  const p = u.pathname === "/" ? "/index.html" : u.pathname;
  const file = Bun.file(DIR + p);
  if (!(await file.exists())) return new Response("not found", { status: 404 });
  if (p.endsWith(".html"))
    return new Response((await file.text()).replace("</head>", SHIM + "</head>"),
      { headers: { "content-type": "text/html" } });
  return new Response(file);
}});
\`\`\`

The \`window.omelette\` shim is only needed when you reuse a Claude-Design canvas (it persists edits through that bridge); a board without it previews fine as plain static files.

## Put it on the board

- Save or export the working bundle to a temporary/repo directory, then register it with \`agent-board wireframe import <directory> --title "<title>" --category design\` (alias: \`agent-board design import\`). This copies the HTML bundle into the board's \`wireframes/<id>/\` artifact store.
- Preview it through \`agent-board web\` in the Wireframes tab; do not require a project-specific \`package.json\` script for normal review.
- Tie it to the work it serves: \`agent-board link <task-id> --spec <spec-id>\`, and mention the wireframe id in the spec/task body until task-wireframe links become first-class.
- Hand off to review with the agent-board-design-review skill.

## Don't

- Don't write production framework code here — this is a prototype medium; the coder reimplements from it.
- Don't fabricate imagery, brands, or realistic fake data.
- Don't open over \`file://\`, and don't scatter raw hex instead of tokens.
`;

export const designWireframeSkillAgents = `# Agent Board Design Wireframe Rules

- Author mode: produce a portable HTML-mockup board, not production code. A coder reimplements from it.
- Zero-build medium: React + ReactDOM UMD + Babel standalone; files publish to \`window\`; load order is the dependency graph (kit -> screens -> canvas -> inline App).
- Serve over HTTP and verify visually; never open from \`file://\`.
- Honest placeholders only; tokens as objects (no scattered hex); one screen = one device-sized artboard; sections are flows; labels carry spec refs.
- Register the bundle with \`agent-board wireframe import <directory> --category design\`, preview it through \`agent-board web\`, and tie it to its spec (\`agent-board link <task-id> --spec <spec-id>\`); hand off to agent-board-design-review.
`;

export const designReviewSkillReadme = `---
name: agent-board-design-review
description: "Review an HTML-mockup wireframe / design board: open it, screenshot and inspect each artboard, and produce structured, spec-linked critique — the design analog of code review. Use when asked to review, critique, or give feedback on a mockup, wireframe, or design board, or to check a design against its spec. Pairs with agent-board-design-wireframe. Triggers: design review, critique mockup, review wireframe, design feedback, check design against spec, UX review."
---

# Agent Board · Design Review

Use this skill to REVIEW a design wireframe and turn it into concrete, spec-linked findings — the design analog of code review. You critique; you do not redesign.

## Loop

1. Read what the board must satisfy: \`agent-board show <task-id>\` and the linked spec (\`agent-board spec cat <spec-id>\`).
2. Open the board through \`agent-board web\` (Wireframes tab) or serve the bundle over HTTP; it can't run from \`file://\`. Screenshot each artboard.
3. Inspect, don't eyeball: read computed styles for spacing, color, and type — a screenshot won't give exact values. Walk every section and state, not just the happy path.
4. Critique across dimensions:
   - Spec coverage — is every required screen, state, and edge case present?
   - Flow integrity — can a user actually get from each screen to the next?
   - Visual system — token consistency, hierarchy, contrast and legibility (a11y).
   - Honesty — placeholders read as placeholders; no fabricated data masquerading as real.
   - Platform fit — correct device sizes and native-vs-web chrome.
5. Record findings as concrete follow-ups linked to the spec: \`agent-board new "<fix>" --status ready\` for real gaps, or \`agent-board knowledge add "<trap>" --kind gotcha --category design\`. Prioritize blocking gaps over polish.

## Output

A spec-coverage verdict, an ordered list of findings (blocking first, polish last) each naming the artboard and the spec clause it misses, and the residual risk or checks you did not run.

## Don't

- Don't redesign the board — that's the agent-board-design-wireframe skill. Critique and hand back.
- Don't assert exact pixels or colors from a screenshot; inspect computed styles.
- Don't file vague notes — every finding points at an artboard and a reason.
`;

export const designReviewSkillAgents = `# Agent Board Design Review Rules

- Review mode: critique a wireframe; do not redesign it.
- Open via \`agent-board web\` or another HTTP server, screenshot every artboard, and inspect computed styles for exact spacing/color/type.
- Critique spec coverage, flow integrity, visual-system consistency, honesty of placeholders, and platform fit.
- Record concrete, spec-linked follow-ups (\`agent-board new\`, \`agent-board knowledge add\`); blocking gaps before polish.
`;
