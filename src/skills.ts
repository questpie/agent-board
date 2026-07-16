export const skillReadme = `---
name: agent-board
description: "Router and orchestrator for agent-board autopilot work: choose bootstrap, research, spec, safe-workflow, flow, implement, grill, or maintenance workflows; keep durable goals/specs/tasks/knowledge/evidence on the board. Triggers: agent-board, autopilot, flow, sprint, plan, goal, delegate, multitask, orchestrate, organize, board hygiene, archive, backlog."
---

# Agent Board

Use when controlling agent-board work. This is the router/controller skill: choose the right workflow, keep durable state on the board, and decide the next wave from evidence. It is not the implementation skill.

## Role

- Keep durable state in \`agent-board\`, not hidden in chat.
- Create goals/specs/tasks, link dependencies, delegate explicit task ids, review evidence, and decide the next wave.
- Use web/docs/repo/runtime discovery when facts are time-sensitive: stacks, APIs, libraries, model ids, platform behavior, pricing, laws, or schedules.
- Do not claim or implement tasks yourself unless the user explicitly switches you into implement/worker mode.

## Route The Work

- New project or feature bootstrap -> \`agent-board-bootstrap\`.
- Unknown repo, feasibility, current docs, or facts likely to change -> \`agent-board-research\`.
- Turning intent into specs, tasks, dependencies, and verify blocks -> \`agent-board-spec\`.
- Frontend/product implementation with screens or UX -> \`agent-board-design-wireframe\`, then \`agent-board-design-review\`, before implementation.
- Visual QA of the IMPLEMENTED running UI (pixel-perfect / 1:1, layout / contrast / spacing defects) -> \`agent-board-design-qa\`.
- User-facing behavior, TDD, use cases, e2e scenarios, regression protection, or safe workflow -> \`agent-board-safe-workflow\`.
- Multi-agent execution, review waves, or closed loops -> \`agent-board-flow\`.
- One concrete implementation task -> \`agent-board-implement\` (legacy alias: \`agent-board-worker\`).
- Adversarial challenge, missing assumptions, weak specs, or pre-implementation critique -> \`agent-board-grill\`.
- Board cleanup, archive, stale runs, stale claims, duplicate specs/knowledge -> \`agent-board-maintenance\`.

## Controller Loop

1. Run \`agent-board status\`; use \`agent-board plan --related\` only when related projects matter.
2. Read relevant task/specs/knowledge before deciding.
3. For broad work, create or choose a goal, write/update a spec, then split into linked tasks. Subtasks are small linked tasks, not checklist prose.
4. For frontend/product work, create the design gate before code: spec -> design flow or wireframe board -> design review -> implementation tasks.
5. For user-facing behavior or risky changes, create the safe workflow gate before code: use cases -> scenario matrix -> failing test/replay -> implementation -> full regression.
6. Before choosing a runtime/model, run \`agent-board flow runtimes\` or \`agent-board flow models --runtime codex\`; if the runtime cannot report models, use official docs instead of guessing.
7. Delegate ready implementation to workers that use \`agent-board-implement\` or \`agent-board-worker\` and a specific task id.
8. Use \`agent-board flow new <name> --template <kind>\`, inspect/edit with \`flow cat/write\`, then run multi-agent fan-out, reviews, or synthesis after user approval unless execution was already explicit.
9. Read \`summary.md\` first; inspect \`agents/*.md\` or \`diagnostics.jsonl\` only when needed.
10. Update tasks/specs/knowledge from evidence. Archive superseded records with concrete commands such as \`agent-board archive spec <id> --reason "<why>"\`, then choose the next wave.

## Delegation Contract

- Worker prompt must include the task id and say to use \`agent-board-implement\` (or legacy \`agent-board-worker\`).
- Research/audit prompt should use \`agent-board-research\` and stay read-only.
- Flow scripts are agent-authored orchestration tools. The main chat remains controller; spawned agents do not own roadmap, branch, commit, or final done decisions.

## Commands To Reach For

- \`agent-board status\`, \`agent-board plan --related\`
- \`agent-board goal new\`, \`agent-board spec new\`, \`agent-board knowledge add\`; use \`--goal <id>\` or \`AGENT_BOARD_GOAL=<id>\` instead of switching shared active goal during agent work
- \`agent-board new\`, \`agent-board link <from> --blocks <to>\`, \`agent-board progress <task> "<checkpoint>"\`, \`agent-board block <task> "<reason>"\`
- \`agent-board task/spec/knowledge cat|write\`, \`agent-board wireframe import <directory>\`, \`agent-board flow runtimes\`, \`agent-board flow models --runtime codex\`, \`agent-board flow new <name> --template feature|review|fix|design|task-graph|refactor|hygiene|grill|safe-workflow\`, \`agent-board flow cat|write\`, \`agent-board flow run <name>\`
- \`agent-board archive list\`, \`agent-board archive task <id> --reason "<why>"\`, \`agent-board archive restore task <id>\`
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
- Frontend/product implementation starts with spec + wireframe/design-board + design review before production code.
- User-facing behavior starts with use cases + scenario matrix + regression gate before production code.
- Worker delegation must include a concrete task id and the \`agent-board-implement\` skill (legacy \`agent-board-worker\` is still valid).
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

export const implementSkillReadme = `---
name: agent-board-implement
description: "Implement or fix one explicit agent-board task end to end. Modern name for the worker workflow; compatible with agent-board-worker. Use when told to implement, fix, claim, pick up, or work on a concrete task id."
---

# Agent Board Implement

Use this skill for ONE concrete task id. This is the implementation lane, not planning.

## Loop

1. If no task id was provided, stop and ask.
2. Read the task: \`agent-board show <task-id>\`.
3. Check git state and get on the task branch before edits; never commit on a detached HEAD.
4. Claim the task: \`agent-board claim <task-id> --agent <your-name>\`.
5. Implement only the task scope.
6. Record durable checkpoints during long work: \`agent-board progress <task-id> "<checkpoint>" --agent <your-name>\`.
7. Run \`agent-board verify <task-id>\`; fix failures.
8. Close with \`agent-board done <task-id>\`. If blocked, run \`agent-board block <task-id> "<reason>"\`.

## Boundaries

- Do not create the roadmap, split broad work, archive records, force close, or choose final product decisions.
- Do not switch shared goals with \`agent-board goal use\`; use \`AGENT_BOARD_GOAL\` when scope is pinned.
- Do not skip verify evidence when a task has a \`## Verify\` block.
`;

export const implementSkillAgents = `# Agent Board Implement Rules

- Implement one explicit task id only.
- Sequence: \`agent-board show\` -> branch check -> \`agent-board claim\` -> edit -> \`agent-board verify\` -> \`agent-board done\`.
- Never commit on a detached HEAD. Do not switch shared goals.
- Block with \`agent-board block <id> "<reason>"\` when stuck.
`;

export const bootstrapSkillReadme = `---
name: agent-board-bootstrap
description: "Cutting-edge project or feature bootstrap interview with current docs and explicit tradeoffs. Use when starting a new app, package, feature, architecture, or stack choice before implementation."
---

# Agent Board Bootstrap

Use this skill before building a new project, package, or major feature. The goal is an educated, spec-first bootstrap, not a silent default stack.

## Loop

1. Run \`agent-board status\`; create or choose a goal if needed.
2. Interview for outcomes, users, constraints, deployment target, budget, timeline, and non-goals.
3. Research current facts before choosing stack or APIs. Use official docs, package metadata, repository examples, and web search when facts may have changed.
4. Capture decisions in \`agent-board knowledge add "<decision>" --kind decision\`.
5. Write a spec with problem, constraints, tradeoffs, chosen stack, rejected alternatives, acceptance criteria, and verify strategy.
6. For frontend/product work, add a design gate to the spec: screens, states, responsive breakpoints, wireframe/design-board artifact, optional presentation artifact, and design-review acceptance criteria.
7. Split the spec into linked tasks with \`agent-board new\` and \`agent-board link <from> --blocks <to>\`.
8. Recommend a flow: design, safe-workflow, task-graph, research, implementation, review, refactor, hygiene, or grill.

## Output

Return the spec id, key knowledge ids, task graph, open questions, and exact verification commands.
`;

export const bootstrapSkillAgents = `# Agent Board Bootstrap Rules

- Do not choose a stack, framework, API, or model silently when the current answer may have changed.
- Research official docs/current sources first, then store decisions in knowledge and specs.
- Frontend/product bootstraps include a wireframe/design-board and review gate before implementation tasks.
- Produce a task graph and verify strategy before implementation.
`;

export const specSkillReadme = `---
name: agent-board-spec
description: "Turn research and intent into durable specs, task graphs, dependencies, acceptance criteria, and verify blocks. Use for spec-first planning, task breakdown, and graph design."
---

# Agent Board Spec

Use this skill to turn intent and research into executable board state.

## Loop

1. Run \`agent-board status\` and read related specs/knowledge.
2. Write or update a spec with context, decisions, non-goals, risks, acceptance criteria, and verification.
3. Create small tasks with \`agent-board new\`. A task should be one reviewable change with a clear \`## Verify\` block.
4. Link dependencies with \`agent-board link <from> --blocks <to>\`.
5. Link tasks to specs with \`agent-board link <task> --spec <spec-id>\`.
6. For UI work, add explicit design tasks before implementation: wireframe/design-board, optional presentation, design review, then code tasks.
7. Mark missing decisions as blockers instead of inventing them.
8. Archive superseded specs only after writing the canonical replacement: \`agent-board archive spec <id> --reason "<why>" --superseded-by spec:<scope>/<id>\`.

## Quality Bar

The graph should expose parallel lanes, blockers, and verification. Do not hide executable subtasks inside prose.
`;

export const specSkillAgents = `# Agent Board Spec Rules

- Specs explain why; tasks explain what next.
- Every non-trivial task gets acceptance criteria and a \`## Verify\` block.
- UI task graphs put design/wireframe/review gates before implementation.
- Link dependencies explicitly; archive superseded docs with a reason.
`;

export const flowSkillReadme = `---
name: agent-board-flow
description: "Design and run closed-loop multi-agent flows with runtime/model discovery, fan-out, review, synthesis, and evidence updates. Use when execution should happen through flows instead of direct chat work."
---

# Agent Board Flow

Use this skill when chat should remain the high-level orchestrator and execution should run through flow waves.

## Loop

1. Confirm project/goal: \`agent-board status\`.
2. Discover local runtimes with \`agent-board flow runtimes\`.
3. Before specifying a model, ask the runtime: \`agent-board flow models --runtime codex\`. If no model selector is exposed, use official runtime docs instead of guessing.
4. Create or inspect a flow: \`agent-board flow new <name> --template feature|review|fix|design|task-graph|refactor|hygiene|grill|safe-workflow\`, then \`agent-board flow cat <name>\`.
5. Edit with \`agent-board flow write <name> --from <file|->\` when phases need to be explicit.
6. Run with \`agent-board flow run <name> --input "<scope>" --task <task-id>\`; use \`--model <model>\` only when the runtime supports a model selector.
7. Read \`summary.md\` first, then update tasks/specs/knowledge/evidence.

## Closed Loop

Flow output is not done by itself. The controller must convert it into task progress, decisions, follow-ups, blockers, archives, or the next flow wave.

## Deterministic Templates

- \`design\`: spec -> wireframe/design-board -> design-review gate for frontend/product work.
- \`task-graph\`: turn lanes or requirements into dependency edges, parallel waves, and board commands.
- \`refactor\`: split up to 30 file paths into per-file read lanes and produce a safe implementation graph.
- \`hygiene\`: find stale, duplicate, or superseded board records and propose archive/consolidation commands.
- \`grill\`: adversarial challenge of assumptions, stale facts, risks, and test gaps.
- \`safe-workflow\`: use-case ids, scenario matrix, TDD order, e2e/replay gates, and no-regression verify commands.
`;

export const flowSkillAgents = `# Agent Board Flow Rules

- Chat controls; flows execute.
- Discover runtimes/models before selecting them.
- Use the named templates for deterministic lanes; do not bury process in chat.
- Read flow summary first; update board state after every run.
- Spawned agents do not own branch, commit, roadmap, archive, or final done decisions.
`;

export const safeWorkflowSkillReadme = `---
name: agent-board-safe-workflow
description: "TDD and no-regression workflow for user-facing behavior: define use cases, scenario matrices, stable test IDs, e2e/replay gates, red-green-refactor tasks, and verify blocks before implementation. Use for safe workflow, TDD, use cases, e2e scenarios, regression gates, qprobe replay, and behavior coverage."
---

# Agent Board Safe Workflow

Use this skill when a change can regress product behavior. The goal is not more tests by habit; it is a durable behavior contract that makes implementation safe.

## Loop

1. Read the goal/spec/tasks and identify the behavior being changed.
2. Create or update a spec section for use cases. Prefer stable ids such as \`UC-001\` for use cases and \`F01\` for end-to-end flows.
3. Define the scenario matrix before code: actors/roles, states, locales, permissions, data fixtures, and layers such as API, route, PWA/browser, visual, or native.
4. Define stable selectors/test ids for UI surfaces. Use product terms, lowercase kebab segments, and locale-independent names; never bind tests to visible copy when copy can change.
5. Choose the cheapest red test that proves the behavior: unit/contract first, integration/API next, e2e or replay when the user journey matters.
6. Write or record the failing scenario first. For browser apps, prefer qprobe's logs/API/browser order and record/replay when available: record the important flow, then replay it as regression.
7. Split work into linked tasks:
   - contract/use-case task,
   - failing test or replay task,
   - implementation task,
   - regression review task.
8. Add concrete \`## Verify\` commands to each implementation task. The final gate must include existing regression suite plus the new scenario.
9. After implementation, run full verification, read failures as product evidence, and update the board. Do not mark done while the new or existing scenario matrix is red.

## Scenario Contract

A good scenario record includes:

- use case ids: \`UC-...\`
- flow id: \`F..\`
- scenario slug: lower-kebab-case
- layer: api, route, pwa/browser, visual, or native
- actors/roles
- data state and fixture source
- locales and permissions
- whether a real API/server is required
- file or recording name, for example \`F02-join-light-name.pwa.spec.ts\`
- verify command and expected result

## TDD Gate

- Red: a failing unit/integration/e2e/replay exists and is linked to the task.
- Green: implementation passes the focused failing test.
- Refactor: run broader tests and replay all relevant recorded flows.
- Done: task evidence shows full verify commands, not just a local claim.

## E2E Harness Rules

- Use real HTTP for journeys that depend on auth, cookies, redirects, file upload, realtime, or cross-service behavior.
- Isolate runs with fresh test data, random ports, and disposable databases or tenants.
- Keep app/server singleton state inside a killable subprocess when env binding or module cache can leak across test files.
- Capture logs and network/browser errors as first-class evidence.
- Record important browser flows early; replay is cheap regression coverage.

## Board Output

Return the spec ids, scenario matrix, task graph, verify commands, new recordings/tests, and any blockers. Store reusable gotchas with \`agent-board knowledge add "<gotcha>" --kind gotcha --category testing\`.
`;

export const safeWorkflowSkillAgents = `# Agent Board Safe Workflow Rules

- User-facing behavior needs a use-case/scenario contract before implementation.
- Prefer red-green-refactor: failing test or replay, implementation, then full regression.
- Stable selectors/test ids must be locale-independent and product-term based.
- E2E scenarios should name flow/use-case ids and prove behavior over real boundaries when needed.
- Existing regressions and new scenarios must pass before done.
`;

export const grillSkillReadme = `---
name: agent-board-grill
description: "Adversarially challenge a plan, spec, bootstrap, task graph, or implementation before work proceeds. Use for grill me, critique, red-team, weak assumptions, missing docs, stale decisions, and risk review."
---

# Agent Board Grill

Use this skill to challenge work before expensive execution.

## Loop

1. Read the active spec/tasks/knowledge and relevant flow summaries.
2. Check whether any decision depends on current external facts; if yes, require web/docs/repo/runtime discovery.
3. Attack assumptions: scope, stack, API freshness, data model, security, migration risk, tests, rollout, failure modes, and hidden dependencies.
4. Separate findings into blockers, follow-ups, accepted risks, and questions.
5. Create tasks for actionable issues with \`agent-board new\` and link them to the spec.
6. Store reusable traps with \`agent-board knowledge add "<gotcha>" --kind gotcha\`.

## Output

Lead with blockers. If nothing blocks, say what residual risk remains and what evidence supports proceeding.
`;

export const grillSkillAgents = `# Agent Board Grill Rules

- Challenge assumptions with evidence, not vibes.
- Missing current docs/source checks are findings when the decision is time-sensitive.
- Convert actionable findings into linked tasks or knowledge.
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
3. For time-sensitive facts, use current sources before deciding: official docs, package registry metadata, web search, GitHub/repo search, or runtime discovery such as \`agent-board flow models --runtime codex\`.
4. Write durable findings into specs (\`agent-board spec new <title>\`) or knowledge (\`agent-board knowledge add <title> --kind note\`).
5. Create concrete tasks only when the breakdown is clear (\`agent-board new\`), and link dependencies (\`agent-board link <from> --blocks <to>\`).
6. Mark missing decisions as blockers.

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
- Use current official docs/web/repo/runtime discovery for time-sensitive facts; do not silently guess stacks, APIs, model ids, or platform behavior.
`;

export const maintenanceSkillReadme = `---
name: agent-board-maintenance
description: "Audit and maintain an agent-board without destructive cleanup. Use when asked to clean up stale flow runs, stale claims, broken links, duplicate specs/knowledge, archive old records, knowledge/spec consolidation, board hygiene, retry readiness, or maintenance reports. Read-only by default."
---

# Agent Board Maintenance

Use this skill when the user asks about stale runs, cleanup, idempotent retry readiness, broken links, duplicate knowledge/specs, archive policy, or board hygiene. You are in MAINTENANCE mode: inspect and report first. Do not delete files, retry flows, rewrite specs/knowledge, archive/restore records, or change task state unless the user explicitly approves a specific action.

## Loop

1. Run \`agent-board maintenance --stale-after 24h\` from the project.
2. If the report is large or automation needs the data, rerun \`agent-board maintenance --json\`.
3. Read the specific tasks, flow summaries, specs, or knowledge docs referenced by the report before proposing changes.
4. Check current archive state with \`agent-board archive list\`.
5. Group findings into:
   - stale claims that may need unblock/reclaim/block decisions,
   - stale or failed flow runs that may need \`agent-board archive flow-run <id> --reason "<why>"\`, retry planning, or investigation,
   - broken task/spec links,
   - spec/knowledge consolidation candidates.
6. Propose a small, ordered cleanup plan with exact commands or files to edit.
7. Apply changes only after approval. Keep archive, destructive cleanup, restore, and flow retry explicit.

## Commands To Reach For

- \`agent-board maintenance\`
- \`agent-board maintenance --json\`
- \`agent-board maintenance --stale-after 7d\`
- \`agent-board show <task-id>\`
- \`agent-board flow show <run-id>\`
- \`agent-board spec cat <spec-id>\`, \`agent-board knowledge cat <knowledge-id>\`
- \`agent-board archive list\`
- \`agent-board archive spec <id> --reason "<why>" --superseded-by spec:<scope>/<id>\`
- \`agent-board archive knowledge <id> --reason "<why>"\`
- \`agent-board archive flow-run <id> --reason "<why>"\`
- \`agent-board spec write <spec-id> --from <file|->\`, \`agent-board knowledge write <knowledge-id> --from <file|->\` only after approval

## Guardrails

- Treat the report as a dry-run: it is evidence, not permission to mutate.
- Prefer archive over deletion. Do not remove \`flows/runs/<run-id>\` directories from a user repo unless the user approved that exact run or retention rule.
- Do not retry a flow by guessing command history. Idempotent retry needs an explicit CLI contract or a user-approved replay plan.
- Do not merge knowledge/spec documents until you have read all source docs and preserved important decisions, gotchas, and links.
`;

export const maintenanceSkillAgents = `# Agent Board Maintenance Rules

- Maintenance mode: read-only first. Start with \`agent-board maintenance\`.
- Use \`agent-board maintenance --json\` for structured automation or large reports.
- Report stale claims, stale/failed flow runs, broken links, and spec/knowledge consolidation candidates separately.
- Check \`agent-board archive list\`; propose archive commands for superseded or stale records, but do not apply them without approval.
- Do not delete run folders, rewrite docs, archive/restore records, change task state, or retry flows without explicit approval.
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
- Skills are always global: \`~/.agent-board/skills/{agent-board,agent-board-bootstrap,agent-board-research,agent-board-spec,agent-board-safe-workflow,agent-board-flow,agent-board-implement,agent-board-worker,agent-board-grill,agent-board-maintenance,agent-board-design-wireframe,agent-board-design-review,agent-board-design-qa}\`, linked into \`~/.claude/skills\`, \`~/.agents/skills\`, and \`~/.cursor/skills\` by \`agent-board skills install\`. Local boards never copy skills into the repo.

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
9. Delegate execution to worker sub-agents (agent-board-implement skill, or legacy agent-board-worker) instead of doing all work directly.
10. Review flow progress, flow summaries, per-task Evidence, and status before deciding next steps.
11. Create follow-up tasks for actionable review findings.

Recipes: for new slices create goal/spec/tasks/dependencies; for discovery run fan-out flows; for ready work hand each task to an implement worker (agent-board-implement or agent-board-worker); run cross-agent reviews when risk warrants; review Evidence, update board state, create follow-ups, and only then mark ready/done.

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
   - run \`agent-board flow new <name> --template feature|review|fix|design|task-graph|refactor|hygiene|grill|safe-workflow\`
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
- Flow heartbeats mean liveness, not evidence. Thinking/tool/runtime activity keeps the per-agent inactivity watchdog alive; a long review should keep running while activity arrives. A lane only has review evidence once it produces text in \`agents/*.md\` or \`summary.md\`.
- Review gates should distinguish \`pass\`, \`findings\`, and \`inconclusive\`. Missing, thin, contradictory, or runtime-limited reviewer output is \`inconclusive\`, not proof that the implementation is bad or good.
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
- Use \`inconclusive\` when reviewer output is missing, thin, contradictory, runtime-limited, or otherwise cannot support a usable verdict. Escalate to a retry, another reviewer, or an explicit controller override with Evidence.

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
description: "Author or extend an editable design board (wireframe) that lives in the agent-board store: a real foundations → kit → screens design system in static, granular HTML you can edit live in the browser — retype text, swap images (board media / upload / URL) — with changes round-tripping to the source file. Use when prototyping screens, building UI/UX mockups, a design system, or a flow board before implementation. Pairs with agent-board-design-review. Triggers: wireframe, mockup, prototype, design board, flow board, screen mockup, HTML mockup, UI/UX, design system, design tokens, component library, theme, editable mockup."
---

# Agent Board · Design Wireframe

Author an editable design board: device-sized screens a human reviews and a coder implements from. It lives in agent-board and is editable live in the browser — a reviewer retypes a heading or swaps a photo and the change round-trips to the source file. Build it like a real design system, not one-off mockups: **foundations → kit → screens**. That discipline IS the product — it's what makes the board themeable, consistent, and editable — and it's non-negotiable below.

## Where the board lives: in agent-board (source of truth)

- Create it on the board: \`agent-board wireframe scaffold --title "<title>"\` (alias \`agent-board design new\`) writes the template straight into the store at \`wireframes/<id>/\`. To bring in an existing bundle: \`agent-board wireframe import <directory> --category design\`.
- That store dir IS the source of truth — git-versioned, and where live edits persist. Never keep the canonical board in a loose working/temp dir; if you scaffolded outside, import it so the board owns it.
- Tie it to the work: \`agent-board link <task-id> --spec <spec-id>\`, and mention the wireframe id in the spec/task body.

## Out-of-the-box shells — never touch these

The scaffold ships generic, content-agnostic shells you build *through*, not *on*:
- \`board-stage.js\` — canvas chrome + Edit toggle; parses the board root \`[data-board]\`.
- \`editor.js\` — click-to-edit text + the image picker (board media / upload / URL).
- \`preview.js\` — standalone host for \`bun preview.js\`.

They know nothing about your content. You never edit them — you only write the static screens and the foundations/kit. **The HTML is the data; the shells are the runtime.**

## The law: foundations → kit → screens

Mandatory, not stylistic. A screen is an **instance** of kit components — never ad-hoc markup.

1. **Tokens first — \`tokens.css\`.** Tiered brand → semantic → scales (color, spacing \`--space-*\`, radius, type, elevation). Set the project's real brand tier *before* building screens. **RULE: no raw hex or px exists anywhere except \`tokens.css\`.** Re-theme the whole board by editing this one file; dark via \`[data-theme="dark"]\`.
2. **Reuse-or-die — \`kit.css\` + \`components/\`.** Every UI element is a token-driven kit class defined ONCE, and documented as a standalone \`@dsCard\` card in \`components/<Name>.html\` (link tokens+kit, render every variant/state from kit classes only). Screens compose those classes. If a pattern appears twice, it's a component: add the class + its card first, then instance it. Never copy-paste inline styling for a repeated thing.
3. **Per-component tokens.** Each component exposes its own \`--c-*\` vars defaulting to semantic tokens, so you re-theme three ways: globally (\`tokens.css\`), per type (the component's \`--c-*\` default in \`kit.css\`), per instance (inline \`style="--btn-bg: …"\`). Always \`var(--…)\`, never a literal.
4. **Layout = auto-layout, never freeform.** Compose with the auto-layout primitives — \`.stack\` / \`.row\` / \`.between\` / \`.grow\` (flex + token gaps; Figma auto-layout ≈ flex). Spacing is always a \`--space-*\` token. **NEVER lay out with absolute / \`top\`/\`left\` magic pixels** — it breaks responsiveness and live editing. (Absolute is only for true overlays, e.g. a badge pinned on an image.)

## The medium: static, granular, directly editable

Plain static HTML — no build, no framework for content. A static node is its own source, so a human click-edits it in the browser and it round-trips to the file, and you (the AI) edit the same markup.

- One screen = one artboard: \`<section data-screen="<slug>" data-device="phone|desktop">\` inside \`[data-board]\`.
- Every editable leaf is its own node: text → \`<h1 class="title" data-edit="text" data-key="title">…</h1>\`; image → \`<div class="ph" data-edit="image" data-key="hero" data-label="hero image">\`. Spell repeats out — three cards = three \`<div class="card">\`, never one looped from an array.
- \`data-key\` is a stable, human id unique within its screen (\`title\`, \`cta\`, \`hero\`); it's how an edit addresses the node and it survives reorder.
- Reach for React/JS only when a screen genuinely needs interactive behaviour static HTML can't express (phase-B); even then keep editable copy as static leaves.

## Conventions that make it good

- Honest placeholders only — never fake photos, logos, or real-looking data passed off as content. Use the kit's \`.ph\` / \`.avatar\` placeholders.
- One screen = one artboard at a real device size (e.g. 390×844 phone, 1320×896 desktop); match the platform's chrome (native status/tab bars vs a browser frame).
- A section is one user flow or screen family; a screen's label states its intent and the spec section it satisfies.

## Preview + edit (verify before handing off)

- Open \`agent-board web\` → Wireframes → the board. Toggle **Edit**, then click any text to retype it or any photo to replace it (pick from board media, upload a file, or paste a URL); hover any \`.stack\`/\`.row\` for a toolbar to reorder its children, flip direction (stack↔row), or step gap/padding on the \`--space-*\` scale; changes persist into the store (loopback-gated \`PUT /api/wireframe/edit\`), git-versioned. This is why auto-layout authoring matters — it's what makes layout live-editable. Same loop a non-technical reviewer uses.
- Standalone: \`bun preview.js\` inside the bundle serves it and persists edits to disk.
- Walk every screen and state, then hand off to the agent-board-design-review skill.

## Reject-and-rewrite — run this before handing off

Reject (and fix) any markup that:
- has a raw hex or px outside \`tokens.css\` → replace with a token;
- lays out with absolute / \`top\`/\`left\` magic numbers → rebuild with \`.stack\`/\`.row\` + token gaps;
- repeats inline styling instead of using or adding a kit class → promote it to a component + card;
- buries editable copy in a JS/array render → static, granular leaves;
- fakes imagery, brands, or realistic data → honest placeholders.

## Don't

- Don't keep the canonical board in a loose dir — it belongs in the agent-board store, where edits round-trip.
- Don't edit the shells (\`board-stage.js\` / \`editor.js\`); you write screens + tokens/kit, not runtime.
- Don't scatter raw hex/px, hand-position layout, or one-off-style what should be a reused component.
`;

export const designWireframeSkillAgents = `# Agent Board Design Wireframe Rules

- Author mode: produce an editable design board — a real foundations → kit → screens system, not production code or one-off mockups. A coder reimplements from it.
- Lives in the agent-board store: \`agent-board wireframe scaffold\` (alias \`design new\`) or \`wireframe import <dir> --category design\`; that \`wireframes/<id>/\` dir is the git-versioned source of truth where live edits persist. Never keep it in a loose dir.
- Build through the shells, never on them: \`board-stage.js\`/\`editor.js\` are generic — you only write static screens + \`tokens.css\`/\`kit.css\`/\`components/\`. HTML is the data; the shells are the runtime.
- The law (mandatory): tokens-first (no raw hex/px outside \`tokens.css\`); reuse-or-die (every element a token-driven kit class + an \`@dsCard\` card, instanced into screens — repeats spelled out, never looped); per-component \`--c-*\` tokens; layout = auto-layout primitives (\`.stack\`/\`.row\`/\`.between\`/\`.grow\` + \`--space-*\`), never absolute magic pixels.
- Static, granular contract: one screen = \`<section data-screen>\`; every editable leaf carries \`data-edit="text|image"\` + a stable \`data-key\`. React only for genuinely interactive demos, never for editable copy (breaks click-to-edit + round-trip).
- Honest placeholders only; one screen = one device-sized artboard; sections are flows; labels carry spec refs.
- Preview + edit via \`agent-board web\` (toggle Edit; text + image via board media/upload/URL; layout via a hover toolbar on \`.stack\`/\`.row\` — reorder / direction / gap / padding; edits round-trip to the store); tie to spec (\`agent-board link <task-id> --spec <spec-id>\`); hand off to agent-board-design-review.
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

export const designQaSkillReadme = `---
name: agent-board-design-qa
description: "QA the IMPLEMENTED, running web UI by MEASURING it, not eyeballing screenshots: catch wrapped text, off-center button labels, misalignment, off-token shadows/spacing, low contrast, and — when a reference exists — pixel-fidelity drift. Reuses the harness's own preview/browser tools and adds the missing framework. Use after implementing or changing UI, for pixel-perfect / 1:1 work, or when asked whether a design 'looks right'. Pairs with agent-board-design-review (which reviews the mockup). Triggers: design qa, visual qa, pixel-perfect, 1:1, does this look right, polish the UI, fix the layout, text wrapping, misalignment, off-center, contrast, design tokens, visual check."
---

# Agent Board · Design QA

Use this skill to QA the IMPLEMENTED, running web UI — the design analog of running the tests, not reading them. You MEASURE the rendered page and fix in code; the screenshot is your proof, never your judge. This is the post-implementation gate that pairs with \`agent-board-design-review\` (which critiques the mockup before code).

## Measure, don't perceive

A screenshot that "looks fine" is the trap. Vision models downsample every image to a fixed budget, so a 2px misalignment, a silently truncated label, an off-token shadow, or a slightly off-center button vanish before the model ever sees them — frontier models score under 50% on fine-grained visual perception versus ~96% for humans. So do not judge quality by looking. Derive findings from the DOM and CSSOM, where the numbers are exact, and reserve the screenshot for evidence and for the small residual that genuinely resists measurement.

Split of responsibility:

- HOW (this skill): the method, the thresholds, the layer order, the finding format. Portable across repos.
- WHAT (the repo): the design system — spacing scale, color/radius/shadow tokens, breakpoints, component library. Read it from THIS repo every run; generic thresholds are only the floor.
- MEASURE (a dumb capability): open the page, eval JS, screenshot. Reused from your harness — never rebuilt here.

## Capability contract (works on any harness)

This skill needs three capabilities from whatever harness you are on — Claude Code, Codex, qprobe, raw Playwright. Bind each to the tool yours exposes; do not build new browser infrastructure:

1. Eval JS in the page — Claude Code \`preview_eval\`, qprobe \`qprobe browser eval\`, Playwright \`page.evaluate\`.
2. Screenshot — \`preview_screenshot\`, \`qprobe browser screenshot\`.
3. Set the viewport — \`preview_resize\`, \`qprobe browser resize\`.

If none is available, wiring one up is the first step; the rest of the loop assumes these three.

If \`@questpie/probe\` (qprobe) is installed, skip manual injection: \`qprobe design <url> --viewport 375,768,1280\` launches headless Chromium and runs the geometry and token scans below as a tested command, printing the same JSON findings. Prefer it when available; the embedded scans are the portable fallback for harnesses without qprobe.

## Loop

1. Target. Read the task and its spec: \`agent-board show <task-id>\`, then \`agent-board spec cat <spec-id>\`. Note the required screens, states, and breakpoints. If a visual reference exists (a mockup via \`agent-board web\`, a Figma export, or a screenshot), keep its image for step 7 — the reference is just an image; where it comes from is your call.
2. Read this repo's design system. Find the token source (Tailwind/theme config, CSS custom properties, the component library) and extract the spacing scale, the color/radius/shadow tokens, and the real breakpoints. These are the WHAT you measure against.
3. Render at the repo's real breakpoints (its own \`sm\`/\`md\`/\`lg\`, not invented numbers). Set the viewport, load the page, let it settle.
4. Measure (deterministic, no vision). Inject the geometry scan below via your eval capability, at each breakpoint. It returns located, measured findings: horizontal overflow, clipped/overflowing content, silently truncated text, collapsed (zero-height) content, sibling overlap, near-miss misalignment, tiny tap targets, sub-16px input fonts.
5. Token conformance. Inject the token scan below: it learns the repo's CSS-variable tokens at runtime (probing each var through a throwaway element) and flags off-palette colors, off-token box-shadows, and off-token border-radii. This is where an "ugly shadow" usually lives: a one-off blur nobody chose. (Spacing conformance needs a real scale — see the token scan's note.)
6. Contrast and a11y heuristics. Inject axe-core from a CDN and run it; surface color-contrast, accessible-name, and target-size violations. Low contrast is a real "looks cheap" signal, not just an a11y nit.
7. Reference diff — only when a reference image exists. Screenshot the page at the reference's viewport and diff it: a perceptual pixel diff (pixelmatch / odiff / Playwright \`toHaveScreenshot\`, YIQ + anti-aliasing on, threshold ~0.2) for drift, plus an onion-skin overlay (reference at 50% opacity over the screenshot) for alignment — misalignment shows up as ghosting. This is the 1:1 layer.
8. Vision LAST, residual only. For what truly resists measurement — an ugly shadow that passed the token check, optical (not mathematical) alignment, overall balance — screenshot a CROP of that region (never the full page; crops keep the detail the downsampler destroys) and judge it against a short, explicit rubric. The verdict is advisory: it may add a finding, never overturn a measured one.
9. Fix in code, then re-run from step 3 until the measured layers are clean. You are fixing real located defects, not chasing a vibe. Attach the final screenshot as proof.
10. Record on the board. Blocking defects become tasks: \`agent-board new "<fix>" --status ready\`. Reusable traps become knowledge: \`agent-board knowledge add "<gotcha>" --kind gotcha --category design\`. Tie them to the spec with \`agent-board link <task-id> --spec <spec-id>\`.

## The geometry scan (first portable primitive)

A dumb measurer: it returns numbers, it does not judge. Inject it with your eval capability at each breakpoint; it returns an array of findings. Tune the magic numbers (spacing base, min tap target) to the repo's tokens in step 2, and scope \`document.body\` to a container on large pages.

\`\`\`js
(function () {
  var vw = document.documentElement.clientWidth || window.innerWidth;
  if (!vw) return [{ layer: "meta", severity: "warn", selector: "html", viewport: 0, prop: "viewport", measured: "0", expected: "> 0", message: "viewport width is 0 - page not laid out yet; retry after load" }];
  var out = [];
  function sel(el) {
    if (el.id) return "#" + el.id;
    var parts = [], n = el, depth = 0;
    while (n && n.nodeType === 1 && depth < 4) {
      var p = n.tagName.toLowerCase();
      if (n.classList && n.classList.length) p += "." + Array.prototype.slice.call(n.classList, 0, 2).join(".");
      parts.unshift(p);
      n = n.parentElement; depth++;
    }
    return parts.join(" > ");
  }
  function visible(el) {
    var r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && parseFloat(s.opacity) > 0 && !el.ownerSVGElement;
  }
  function add(layer, sev, el, prop, measured, expected, msg) {
    out.push({ layer: layer, severity: sev, selector: sel(el), viewport: vw, prop: prop, measured: measured, expected: expected, message: msg });
  }
  var all = Array.prototype.slice.call(document.body.querySelectorAll("*")).filter(visible);
  for (var i = 0; i < all.length; i++) {
    var el = all[i], r = el.getBoundingClientRect(), s = getComputedStyle(el);
    var tag = el.tagName.toLowerCase();
    var parentOver = el.parentElement && el.parentElement.getBoundingClientRect().right > vw + 2;
    if (r.right > vw + 2 && !parentOver) add("geometry", "blocking", el, "right", Math.round(r.right) + "px", "<= " + vw + "px", "extends " + Math.round(r.right - vw) + "px past the viewport (horizontal overflow)");
    if (el.scrollWidth > el.clientWidth + 1 && s.overflowX !== "auto" && s.overflowX !== "scroll" && tag !== "select") add("geometry", "warn", el, "scrollWidth", el.scrollWidth + "px", "<= " + el.clientWidth + "px", "content overflows its box by " + (el.scrollWidth - el.clientWidth) + "px");
    if (s.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1 && !el.title && !el.getAttribute("aria-label")) add("geometry", "warn", el, "text", "truncated", "title or aria-label", "ellipsis-truncated text with no title/aria-label");
    if (el.children.length === 0 && (el.textContent || "").trim().length > 0 && r.height < 1) add("geometry", "warn", el, "height", Math.round(r.height) + "px", "> 0", "has text but renders at zero height (collapsed)");
    var interactive = (tag === "a" || tag === "button" || tag === "select" || tag === "textarea") || el.getAttribute("role") === "button" || (tag === "input" && el.type !== "hidden");
    if (interactive && (r.width < 44 || r.height < 44)) add("a11y", "warn", el, "size", Math.round(r.width) + "x" + Math.round(r.height), ">= 44x44", "tap target smaller than 44x44");
    if ((tag === "input" || tag === "textarea" || tag === "select") && parseFloat(s.fontSize) < 16) add("a11y", "polish", el, "fontSize", s.fontSize, ">= 16px", "input font under 16px (causes mobile zoom-on-focus)");
  }
  var parents = all.filter(function (p) { return p.children.length > 1; });
  for (var j = 0; j < parents.length; j++) {
    var kids = Array.prototype.filter.call(parents[j].children, visible);
    if (kids.length < 2) continue;
    var lefts = kids.map(function (k) { return Math.round(k.getBoundingClientRect().left); });
    var counts = {};
    lefts.forEach(function (v) { counts[v] = (counts[v] || 0) + 1; });
    var dom = null, best = 0;
    for (var key in counts) { if (counts[key] > best) { best = counts[key]; dom = parseInt(key, 10); } }
    if (dom !== null && best >= 2) {
      for (var a = 0; a < kids.length; a++) {
        var d = lefts[a] - dom;
        if (d !== 0 && Math.abs(d) <= 4) add("geometry", "warn", kids[a], "left", lefts[a] + "px", dom + "px", "left edge off by " + d + "px from its siblings (near-miss misalignment)");
      }
    }
    for (var x = 0; x < kids.length; x++) {
      for (var y = x + 1; y < kids.length; y++) {
        var ra = kids[x].getBoundingClientRect(), rb = kids[y].getBoundingClientRect();
        var ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        var oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (ox > 2 && oy > 2) add("geometry", "warn", kids[y], "overlap", Math.round(ox) + "x" + Math.round(oy) + "px", "no overlap", "overlaps a sibling by " + Math.round(ox) + "x" + Math.round(oy) + "px");
      }
    }
  }
  return out.slice(0, 200);
})()
\`\`\`

Hardening (learned from dogfooding the scanner on a real board UI): read the viewport from document.documentElement.clientWidth and bail if it is 0 (the eval context may not be laid out yet, which otherwise flags every element as overflowing); report only the OUTERMOST overflowing element, not every descendant of it; skip elements inside an svg (ownerSVGElement), whose internal paths/shapes are geometry not layout and produce pure noise; ignore native select content-overflow (it clips option text by design). Detect overlap by pairwise rect intersection of siblings, NOT by comparing a parent's area to the sum of its children's areas — the area method is unsound and gives false positives.

## The token scan (second portable primitive)

The geometry scan asks "is it broken?"; the token scan asks "is it off-system?". It learns the repo's design tokens at runtime: read the CSS custom properties on \`:root\`, then PROBE each by applying \`var(--x)\` to a throwaway element's \`background-color\`, \`box-shadow\`, and \`border-radius\` and keeping whatever the browser computes. Probing (not string parsing) is the trick — a token shadow and a rendered shadow never compare equal as strings (\`0 18px 40px -28px rgba(...)\` vs \`rgba(...) 0px 18px 40px -28px\`), and it needs zero per-stack config: any design system exposed as CSS variables is picked up. It then flags rendered values absent from the token set: off-palette colors (RGB distance), off-token box-shadows, off-token border-radii. On a repo with no token variables it simply finds nothing.

\`\`\`js
(function () {
  var names = {};
  for (var si = 0; si < document.styleSheets.length; si++) {
    var rules; try { rules = document.styleSheets[si].cssRules; } catch (e) { continue; }
    if (!rules) continue;
    for (var ri = 0; ri < rules.length; ri++) {
      var rule = rules[ri];
      if (!rule.style || typeof rule.selectorText !== "string") continue;
      var sl = rule.selectorText;
      if (sl.indexOf(":root") < 0 && sl.indexOf("html") < 0 && sl !== "*") continue;
      for (var pi = 0; pi < rule.style.length; pi++) { var prop = rule.style[pi]; if (prop.indexOf("--") === 0) names[prop] = true; }
    }
  }
  var probe = document.createElement("div");
  probe.style.position = "absolute"; probe.style.left = "-9999px"; probe.style.top = "0";
  document.body.appendChild(probe);
  var colorSet = {}, shadowSet = {}, radiusSet = {}, nShadow = 0, nRadius = 0;
  for (var name in names) {
    var ref = "var(" + name + ")";
    probe.style.backgroundColor = ""; probe.style.backgroundColor = ref;
    var bc = getComputedStyle(probe).backgroundColor;
    if (bc && bc !== "rgba(0, 0, 0, 0)" && bc !== "transparent") { colorSet[bc] = true; continue; }
    probe.style.boxShadow = ""; probe.style.boxShadow = ref;
    var bs = getComputedStyle(probe).boxShadow;
    if (bs && bs !== "none") { if (!shadowSet[bs]) { shadowSet[bs] = true; nShadow++; } continue; }
    probe.style.borderTopLeftRadius = ""; probe.style.borderTopLeftRadius = ref;
    var br = parseFloat(getComputedStyle(probe).borderTopLeftRadius);
    if (!isNaN(br) && br > 0) { if (!radiusSet[Math.round(br)]) { radiusSet[Math.round(br)] = true; nRadius++; } }
  }
  function rgb(s) { if (!s) return null; var o = s.indexOf("("); var c = s.indexOf(")"); if (o < 0 || c < 0) return null; var a = s.slice(o + 1, c).split(","); if (a.length < 3) return null; return [parseFloat(a[0]), parseFloat(a[1]), parseFloat(a[2]), a.length > 3 ? parseFloat(a[3]) : 1]; }
  var palette = []; for (var ck in colorSet) { var pc = rgb(ck); if (pc) palette.push(pc); }
  function dist(c) { var b = 1e9; for (var i = 0; i < palette.length; i++) { var d = Math.abs(c[0] - palette[i][0]) + Math.abs(c[1] - palette[i][1]) + Math.abs(c[2] - palette[i][2]); if (d < b) b = d; } return b; }
  var out = [];
  function sel(el) { if (el.id) return "#" + el.id; var parts = [], n = el, d = 0; while (n && n.nodeType === 1 && d < 4) { var p = n.tagName.toLowerCase(); if (n.classList && n.classList.length) p += "." + Array.prototype.slice.call(n.classList, 0, 2).join("."); parts.unshift(p); n = n.parentElement; d++; } return parts.join(" > "); }
  function visible(el) { var r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && parseFloat(s.opacity) > 0 && !el.ownerSVGElement; }
  function add(sev, el, prop, measured, expected, msg) { out.push({ layer: "tokens", severity: sev, selector: sel(el), prop: prop, measured: measured, expected: expected, message: msg }); }
  var all = Array.prototype.slice.call(document.body.querySelectorAll("*")).filter(visible);
  var COLOR_TOL = 10;
  for (var i = 0; i < all.length; i++) {
    var el = all[i], s = getComputedStyle(el);
    if (nShadow > 0) { var esh = s.boxShadow; if (esh && esh !== "none" && !shadowSet[esh]) add("warn", el, "box-shadow", esh, "a shadow token", "off-token box-shadow (one-off, not a design token)"); }
    if (nRadius > 0) { var c4 = [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius]; for (var ci = 0; ci < 4; ci++) { var rv = parseFloat(c4[ci]); if (!isNaN(rv) && rv > 0 && rv < 200 && !radiusSet[Math.round(rv)]) { add("polish", el, "border-radius", Math.round(rv) + "px", "a radius token", "off-token border-radius " + Math.round(rv) + "px"); break; } } }
    if (palette.length > 0) { var cks = [["color", s.color], ["background-color", s.backgroundColor], ["border-color", s.borderTopColor]]; for (var k = 0; k < 3; k++) { var cv = rgb(cks[k][1]); if (cv && cv[3] > 0.05 && dist(cv) > COLOR_TOL) add("polish", el, cks[k][0], cks[k][1], "a color token", "off-palette " + cks[k][0]); } }
  }
  probe.remove();
  return out.slice(0, 200);
})()
\`\`\`

Spacing is deliberately NOT a generic heuristic here. "Must be a multiple of 4px" is an assumption, not the repo's truth; on a hand-rolled scale it is pure noise (it was the loudest false-positive source in testing). Check spacing only against a real scale — e.g. Tailwind's \`--spacing\` base, flagging padding/margin/gap that are not multiples of it — and add that per-repo when the scale exists.

## Finding format

Every layer — scan, tokens, a11y, diff, vision — emits the same shape so findings sort and act uniformly:

\`{ layer, severity, selector, viewport, prop, measured, expected, message, fix }\`

- \`layer\`: geometry | tokens | a11y | diff | vision
- \`severity\`: blocking | warn | polish
- \`selector\`: a click-to-find CSS path
- \`measured\` / \`expected\`: the numbers (e.g. measured "blur 17px", expected "one of 0/1/2/4/8/16")
- \`fix\`: the concrete code change

## Output

A verdict per breakpoint, then an ordered list of findings (blocking first, polish last). Each names the selector, the viewport, the measured value, the rule it breaks, and a fix. Close with residual risk and the layers you did not run (no reference, vision skipped, etc.).

## Don't

- Don't eyeball a screenshot and call it reviewed — that is the exact failure this skill exists to fix.
- Don't assert exact pixels or colors from a downsampled screenshot; read them from the DOM/CSSOM.
- Don't invent thresholds the repo's tokens already define; the token set is the truth, generic numbers are the floor.
- Don't let the vision judge overturn a measured finding; it is advisory, runs on crops, and runs last.
- Don't build new browser infrastructure; bind to the harness's preview/browser tools.
- Don't bake in a Figma engine; a reference is just an image in.
`;

export const designQaSkillAgents = `# Agent Board Design QA Rules

- QA the IMPLEMENTED running UI by MEASURING it; never judge quality from a screenshot — vision misses 2px misalignment, silent truncation, and off-token shadows.
- Reuse the harness's own browser tools (Claude Code \`preview_*\`, qprobe \`browser\`, Playwright); do not build new browser infrastructure.
- HOW is this skill (method, thresholds, layer order); WHAT is the repo (tokens, breakpoints, components) — read the design system every run and measure against it.
- Layer order: DOM geometry scan -> token conformance -> axe-core contrast/a11y -> reference pixel-diff + overlay (only when a reference image exists) -> vision judge LAST, on crops, advisory only.
- The token scan learns tokens at runtime by probing \`:root\` CSS variables (color/shadow/radius) — no per-stack config, and nothing flagged on a repo without token vars. Spacing conformance only against a real scale (e.g. Tailwind \`--spacing\`), never a generic 4px assumption.
- A reference is just an image in (Figma export/MCP or a mockup screenshot); no baked-in Figma engine.
- Fix in code and re-run until the measured layers are clean; the screenshot is proof, not the judge.
- Record blocking defects as tasks (\`agent-board new\`) and reusable traps as knowledge (\`agent-board knowledge add --kind gotcha --category design\`); link findings to the spec.
`;
