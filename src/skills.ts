export const skillReadme = `---
name: agent-board
description: "Orchestrate and plan work with agent-board: goals, specs, task graphs, dependencies, flows, sprints, and delegating tasks to workers. Use when planning whole features, breaking work into goals/tasks/subtasks, running multi-agent flow fan-out/review/synthesis, or reviewing task state. Orchestrator mode by default — delegate implementation to a worker that follows the agent-board-worker skill. Triggers: agent-board, flow, sprint, plan, goal, delegate, multitask, orchestrate, task board, backlog."
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
- \`agent-board goal new/use\`, \`agent-board spec new\`, \`agent-board knowledge add\`
- \`agent-board new\`, \`agent-board link <from> --blocks <to>\`, \`agent-board block <task> "<reason>"\`
- \`agent-board task/spec/knowledge cat|write\`, \`agent-board flow new <name> --template feature|review|fix\`, \`agent-board flow cat|write\`, \`agent-board flow run <name>\`

## References

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
- Read flow \`summary.md\` before per-agent outputs; open \`diagnostics.jsonl\` only for runtime debugging.
- Keep task Markdown concise; logs stay in flow/run folders.
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
5. Verify before requesting done: \`agent-board verify <task-id>\` runs the task's \`## Verify\` commands from the repo root and records evidence. All must pass.
6. Close: \`agent-board done <task-id>\` — blocked unless acceptance criteria are checked and verify passed. Forcing requires \`--force --reason "<why>"\` and is logged as evidence (orchestrator decision, not the worker's).
7. If blocked, stop and record it: \`agent-board block <task-id> "<reason>"\`.

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
- If you share one repository with another agent, work in your own git worktree and set \`AGENT_BOARD_REPO\` to it, so checkouts, branches, and verify do not collide.
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

export const configSkillReadme = `# Agent Board Configuration

Use this skill when setting up or changing \`agent-board\` itself in a project.

## Storage Modes

\`agent-board\` is file-based and stores a board in one of two places:

- **Home (default):** the shared \`~/.agent-board\` (override with \`AGENT_BOARD_HOME\`). Multiplexes many projects under \`projects/<project-slug>\`, indexed by \`registry.json\` (maps \`repo_path\` -> project). Keeps board state out of the repo so parallel agents/worktrees never collide on it.
- **Local:** a single-project \`.agent-board/\` committed inside the repo, git-versioned with the project. Flat layout (no \`projects/\` wrapper, no \`registry.json\`), and \`project.json\` omits \`repo_path\` (derived from the board location) so it stays portable across clones and machines.

Discovery precedence when resolving which board governs a command:
1. \`AGENT_BOARD_HOME\` set -> that home board.
2. a \`.agent-board/\` found by walking up from cwd (stops at \`$HOME\`) -> that local board.
3. otherwise \`~/.agent-board\`.

Layout:

- Project config: \`project.json\` with \`active_goal\` and \`related_projects\` (plus \`repo_path\` for home boards).
- Goals: \`<board>/goals/<goal-slug>\`; tasks are goal-level only.
- Flow scripts: \`<board>/flows/*.mjs\`; run artifacts: \`<board>/goals/<goal-slug>/flows/runs/<run-id>/\`.
- Home boards prefix the above paths with \`projects/<project-slug>/\`.
- Specs and knowledge: overlay layers at global, project, and goal scope. In a local board, global and project scope collapse (single project).
- Skills are always global: \`~/.agent-board/skills/{agent-board,agent-board-worker,agent-board-research}\`, linked into \`~/.claude/skills\`, \`~/.agents/skills\`, and \`~/.cursor/skills\` by \`agent-board skills install\`. Local boards never copy skills into the repo.

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

Relocate copies goals/specs/knowledge/flows and rewrites \`project.json\` for the target layout. It keeps the source as a backup unless you pass \`--cleanup\`.

Init is non-destructive and does not create \`.agent\` or project-local skill links. Use \`agent-board skills install\` for global skill links, \`agent-board skills doctor\` to see which runtimes are linked, and \`agent-board skills check\` to confirm these docs still match the CLI.

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
6. If blocked, run \`agent-board block <task-id> "<reason>"\`.
7. Before done, run \`agent-board verify <task-id>\` (executes the task \`## Verify\` block and records evidence); then \`agent-board done <task-id>\`.

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
10. Review flow summaries, per-task Evidence, and status before deciding next steps.
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
