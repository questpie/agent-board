export const skillReadme = `---
name: agent-board
description: "Orchestrate and plan work with agent-board: goals, specs, task graphs, dependencies, sprints, and delegating tasks to workers. Use when planning, breaking down work, running sprints/multitask, delegating, or reviewing task state. Orchestrator mode by default — delegate implementation to a worker that follows the agent-board-worker skill rather than coding yourself. Triggers: agent-board, sprint, plan, goal, delegate, multitask, orchestrate, task board, backlog."
---

# Agent Board

Use when managing project goals, tasks, specs, knowledge, or agent delegation with \`agent-board\`.

## Why This Exists

\`agent-board\` keeps durable state out of chat: goals narrow focus; tasks are executable units; specs hold reasoning/criteria; knowledge holds reusable facts. Update the board when plans, blockers, or task graphs change.

## Core Loop

1. Run \`agent-board status\` and \`agent-board plan --related\` when cross-project work may matter.
2. Read the active task, linked specs, and knowledge.
3. If vague, research before implementation.
4. Split broad work into linked tasks.
5. Delegate ready tasks to worker sub-agents (agent-board-worker skill); review task Evidence and status before next decisions.
6. Store reasoning in specs and reusable facts in knowledge.

## Modes

- Orchestrator mode is default (this skill): plan, create specs/tasks, link blockers, delegate to workers, review evidence, decide next steps. Do not claim or edit implementation tasks yourself.
- To implement a concrete task, switch to the **agent-board-worker** skill: claim -> checkout branch -> implement -> verify -> done.
- For discovery or audit before implementation, use the **agent-board-research** skill (read-only).

## Recipes

- New slice: \`status\` -> \`goals\` -> \`goal new/use\` -> \`spec new\` -> \`new\` tasks -> \`link\` dependencies -> mark ready work.
- Delegate next task: \`plan --related\` -> choose ready task -> hand it to a worker sub-agent (agent-board-worker skill) on that task id -> review the task's Evidence and status.
- After a worker finishes: read the task Evidence, update specs/knowledge/tasks, create follow-ups, unblock/ready/done only with evidence.
- Blocker: \`block <task> "<reason>"\`, create dependency or question task, re-run \`plan --related\`.

## Operating Rules

- In worker mode, use \`agent-board claim <task-id> --agent <name>\` before implementation.
- Use \`agent-board link <from> --blocks <to>\` for dependencies.
- Use \`agent-board block <task-id> "<reason>"\` for missing info or unmet dependencies.
- Keep task files concise; verify evidence lives in the task's Evidence section.

## Scope Rules

- Project scope: repo-level specs/knowledge defaults.
- Goal scope: slice-specific notes and temporary decisions.
- Global scope: reusable cross-project knowledge.
- Tasks are goal-level execution state.
- Cross-project refs: \`task:<project>/<goal>/<task>\`.

## Concurrency

When delegating to several workers at once (or running multiple agents):

- Give each worker a distinct goal and pin it: \`AGENT_BOARD_PROJECT=<slug> AGENT_BOARD_GOAL=<goal>\`. Do not depend on the active goal (\`goal use\`) for concurrent work — it is shared mutable state.
- Across different projects (different repos) agents are isolated automatically; only initialize projects one at a time.
- If workers share one repository, create a git worktree per worker and pass \`AGENT_BOARD_REPO=<worktree>\` so they don't fight over the same checkout/branch.

## References

- \`references/pm-orchestrator.md\` - PM loop, task breakdown, blockers, parallelization.
- \`references/task-workflow.md\` - worker lifecycle for picking up and closing tasks.
- \`references/research-workflow.md\` - discovery, specs, and task creation.
- \`references/review-workflow.md\` - review, validation, and follow-up tasks.
- \`references/config.md\` - workspace layout, scopes, and skill links.
`;

export const skillAgents = `# Agent Board Rules

- Start with \`agent-board status\`; use \`agent-board plan --related\` for cross-project blockers.
- Default to orchestrator mode: do not claim/edit implementation tasks unless explicitly asked or you are the worker.
- Delegate ready work to a worker sub-agent (agent-board-worker skill); review the task's Evidence and status before deciding next steps.
- Read task + linked specs/knowledge before editing.
- In worker mode, claim before implementation; block with a concrete reason when stuck.
- Write durable decisions to specs, reusable facts/gotchas to knowledge.
- Keep task Markdown concise; logs stay in run folders.
`;

export const workerSkillReadme = `---
name: agent-board-worker
description: "Implement or fix a single agent-board task as a worker. Use when told to claim, implement, fix, or work on a specific task. Enforces the safe sequence: checkout the task branch, claim, implement, verify, done — never commit on a detached HEAD. Triggers: claim, implement task, fix task, work on task, worker mode, agent-board claim, pick up task."
---

# Agent Board Worker

Use this skill when implementing or fixing ONE concrete agent-board task. You are in WORKER mode: execute a single task end to end. For planning, breakdown, or delegation, use the \`agent-board\` (orchestrator) skill instead.

## Mandatory sequence

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

## Configuration Model

\`agent-board\` is file-based:

- Global home: \`~/.agent-board\`, override with \`AGENT_BOARD_HOME\`.
- Registry: \`~/.agent-board/registry.json\`.
- Project workspace: \`~/.agent-board/projects/<project-slug>\`.
- Project config: \`project.json\` with \`repo_path\`, \`active_goal\`, and \`related_projects\`.
- Goals: \`projects/<project-slug>/goals/<goal-slug>\`.
- Tasks are goal-level only.
- Specs and knowledge: overlay layers at global, project, and goal scope.
- Skills: \`~/.agent-board/skills/{agent-board,agent-board-worker,agent-board-research}\`, linked globally into \`~/.claude/skills\`, \`~/.agents/skills\`, and \`~/.cursor/skills\` by \`agent-board skills install\`.

Why: home registry avoids repo-local conflicts/source-control noise; project maps to repo; goal keeps focus; overlays avoid copying.

## Setup

Run from the project root:

\`\`\`sh
agent-board init --project <slug>
\`\`\`

Init is non-destructive and does not create \`.agent\` or project-local skill links. Use \`agent-board skills install\` for global skill links, and \`agent-board skills doctor\` to see which runtimes are linked.

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

export const configSkillAgents = `# Agent Board Configuration Rules

- Treat \`~/.agent-board\` as the only source of truth.
- Prefer editing global/project/goal specs and knowledge overlays over changing CLI source code.
- Do not overwrite existing \`~/.claude/skills\`, \`~/.agents/skills\`, or \`~/.cursor/skills\` agent-board links without explicit user approval.
- Use \`AGENT_BOARD_HOME\` only for tests, sandboxes, or intentionally isolated workspaces.
`;

export const taskWorkflowReference = `# Task Workflow

Use this reference when picking up, running, blocking, reviewing, or closing a task.

A task is the smallest executable unit. It should be concrete enough to claim, read context, edit, check, and report without inventing the plan.

Use this reference in worker mode. If you are acting as PM/orchestrator, delegate the task to a worker sub-agent instead of doing it yourself.

1. Run \`agent-board status\` to understand current work.
2. Run \`agent-board next\` or inspect \`agent-board tasks\`; read the task with \`agent-board show <task-id>\`.
3. Get on the task branch before editing; never commit on a detached HEAD (check \`git branch --show-current\`).
4. Claim work before editing: \`agent-board claim <task-id> --agent <your-name>\` (rejected on a detached HEAD or with unfinished dependencies).
5. Implement on that branch.
6. If blocked, run \`agent-board block <task-id> "<reason>"\`.
7. Before done, run \`agent-board verify <task-id>\` (executes the task \`## Verify\` block and records evidence); then \`agent-board done <task-id>\`.

If too broad, create smaller linked tasks. If stuck, block with a concrete reason.

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
8. Delegate execution to worker sub-agents (agent-board-worker skill) instead of doing all work directly.
9. Review each task's Evidence and status before deciding next steps.
10. Create follow-up tasks for actionable review findings.

Recipes: for new slices create goal/spec/tasks/dependencies; for ready work hand each task to a worker (agent-board-worker); review Evidence, update board state, create follow-ups, and only then mark ready/done.

Triage rules: ready tasks are independently executable; blocked tasks need concrete blockers; parallel lanes are independent ready tasks; cross-project blockers use qualified refs + \`agent-board plan --related\`; specs explain why, tasks explain what next.
`;

export const pmOrchestratorAgents = `# PM Orchestrator Rules

- Do not lose the goal. Keep task breakdown tied to specs and acceptance criteria.
- Prefer creating small linked tasks over one vague mega-task.
- Mark blockers explicitly and keep ready work unblocked.
- Delegate worker execution to sub-agents that follow the agent-board-worker skill.
- After each task, review its Evidence and update task/spec state.
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

export const researchWorkflowAgents = `# Research Workflow Rules

- Research first, implement later unless explicitly asked to fix something.
- Prefer file references and concrete risks over vague notes.
- Convert discoveries into specs, knowledge, and actionable tasks.
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

export const reviewWorkflowAgents = `# Review Workflow Rules

- Findings first, ordered by severity.
- Tie each finding to concrete files, commands, or task criteria.
- Create tasks for follow-ups instead of burying work in prose.
`;
