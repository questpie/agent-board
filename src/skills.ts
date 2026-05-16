export const defaultWorkflow = `name: dev
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
      Implement this task. Read the task, related specs, and repo instructions.
      Update files directly and leave a concise summary.

  - id: review
    parallel:
      - id: code-review
        role: reviewer
        agent: claude
        intent: review
        skills: [agent-board]
        prompt: |
          Review the implementation for bugs, missing tests, and regressions.
      - id: test-review
        role: validator
        agent: codex
        intent: validation
        skills: [agent-board]
        prompt: |
          Inspect changed files and propose/run relevant checks if available.

  - id: finalize
    role: main
    agent: codex
    intent: finalization
    skills: [agent-board]
    prompt: |
      Read sidecar outputs from the run folder, address actionable issues,
      update task notes, and prepare final status.
`;

export const researchWorkflow = `name: research
description: Research a goal and create implementation tasks
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
  - id: repo-research
    role: researcher
    agent: codex
    intent: research
    skills: [agent-board]
    prompt: |
      Research the repo for this task. Identify relevant files, current patterns,
      risks, missing decisions, and likely implementation slices.

  - id: triage
    role: pm
    agent: codex
    intent: planning
    skills: [agent-board]
    prompt: |
      Read prior outputs in {{run.path}}. Create or update specs,
      create concrete tasks, set dependencies, and mark blockers.
`;

export const triageWorkflow = `name: triage
description: Break a goal into ready work, blockers, and parallel lanes
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
  - id: task-breakdown
    role: pm
    agent: codex
    intent: triage
    skills: [agent-board]
    prompt: |
      Break this goal into concrete tasks. Use agent-board commands to create
      tasks, link dependencies, connect specs, and mark blockers.
`;

export const validateWorkflow = `name: validate
description: Validate a task and create follow-up work when needed
default_agent: claude
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
  - id: review
    role: reviewer
    agent: claude
    intent: validation
    skills: [agent-board]
    prompt: |
      Validate the completed work for this task. Focus on bugs, missing tests,
      regressions, and unresolved acceptance criteria. Create follow-up tasks
      for actionable issues.
`;

export const skillReadme = `---
name: agent-board
description: "Use agent-board to manage project goals, specs, task graphs, workflow runs, and agent delegation without losing focus."
---

# Agent Board

Use when managing project goals, tasks, specs, knowledge, workflow runs, or agent delegation with \`agent-board\`.

## Why This Exists

\`agent-board\` keeps durable state out of chat: goals narrow focus; tasks are executable units; specs hold reasoning/criteria; knowledge holds reusable facts; workflows define delegation; runs preserve worker output. Update the board when plans, blockers, or task graphs change.

## Core Loop

1. Run \`agent-board status\` and \`agent-board plan --related\` when cross-project work may matter.
2. Read the active task, linked specs, knowledge, and recent runs.
3. If vague, research/triage before implementation.
4. Split broad work into linked tasks.
5. Delegate via workflows; inspect runs/logs before next decisions.
6. Store reasoning in specs and reusable facts in knowledge.

## Operating Rules

- Use \`agent-board claim <task-id> --agent <name>\` before implementation.
- Use \`agent-board link <from> --blocks <to>\` for dependencies.
- Use \`agent-board block <task-id> "<reason>"\` for missing info or unmet dependencies.
- Keep task files concise; logs belong in run folders.

## Scope Rules

- Project scope: repo-level specs/knowledge/workflow defaults.
- Goal scope: slice-specific notes, temporary decisions, workflow overrides.
- Global scope: reusable cross-project knowledge/workflows.
- Tasks and runs are goal-level execution state.
- Cross-project refs: \`task:<project>/<goal>/<task>\`.

## References

- \`references/pm-orchestrator.md\` - PM loop, task breakdown, blockers, parallelization.
- \`references/task-workflow.md\` - worker lifecycle for picking up and closing tasks.
- \`references/research-workflow.md\` - discovery, specs, and task creation.
- \`references/review-workflow.md\` - review, validation, and follow-up tasks.
- \`references/config.md\` - workspace layout, workflow YAML, binaries, and skill links.
`;

export const skillAgents = `# Agent Board Rules

- Start with \`agent-board status\`; use \`agent-board plan --related\` for cross-project blockers.
- Read task + linked specs/knowledge before editing.
- Claim before implementation; block with a concrete reason when stuck.
- Prefer \`agent-board run <task-id> --workflow dev\` for delegated work.
- Write durable decisions to specs, reusable facts/gotchas to knowledge.
- Keep task Markdown concise; logs stay in run folders.
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
- Tasks and runs: goal-level only.
- Specs, knowledge, and workflows: overlay layers at global, project, and goal scope.
- Skills: \`~/.agent-board/skills/agent-board\`, linked globally into \`~/.claude/skills\` and \`~/.agents/skills\` by \`agent-board skills install\`.

Why: home registry avoids repo-local conflicts/source-control noise; project maps to repo; goal keeps focus; overlays avoid copying; run folders preserve execution history.

## Setup

Run from the project root:

\`\`\`sh
agent-board init --project <slug>
\`\`\`

Init is non-destructive and does not create \`.agent\` or project-local skill links. Use \`agent-board skills install\` for global skill links.

Orient fresh projects:

\`\`\`sh
agent-board projects
agent-board status
agent-board goals
agent-board workflows
\`\`\`

## Agent Binaries

Default binaries:

- Codex: \`codex\`
- Claude Code: \`claude\`

Override with environment variables:

\`\`\`sh
AGENT_BOARD_CODEX_BIN=/path/to/codex
AGENT_BOARD_CLAUDE_BIN=/path/to/claude
\`\`\`

For a custom workflow agent name, use:

\`\`\`sh
AGENT_BOARD_<AGENT_NAME>_BIN=/path/to/binary
\`\`\`

Example: workflow agent \`opencode\` uses \`AGENT_BOARD_OPENCODE_BIN\`.

## Workflow YAML

Keep workflows deterministic; CLI runs exactly the YAML.

Supported shape:

\`\`\`yaml
name: dev
description: Implement task with review sidecars
default_agent: codex
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
      Implement {{task.title}}.

  - id: review
    parallel:
      - id: code-review
        role: reviewer
        agent: claude
        intent: review
        skills: [agent-board]
        prompt: |
          Review the implementation.
\`\`\`

Template variables:

- \`{{task.id}}\`
- \`{{task.title}}\`
- \`{{task.status}}\`
- \`{{workspace.path}}\`
- \`{{run.path}}\`

Context aliases:

- \`repo:<path>\`: registered repo path.
- \`task:current\`: active task.
- \`specs:linked\`: task-linked specs.
- \`knowledge:global|project|goal\`: scoped knowledge.
- \`runs:current\`: current run folder.

Execution model:

- \`agent-board\` is not a security boundary.
- Behavior is prompt/skill discipline via \`role\`, \`intent\`, \`skills\`.
- Codex: \`codex exec --dangerously-bypass-approvals-and-sandbox -\`.
- Claude: \`claude -p --permission-mode bypassPermissions\`.

\`\`\`yaml
role: reviewer
intent: review
skills: [agent-board]
\`\`\`

## Validation Checklist

After configuration changes, run:

\`\`\`sh
agent-board workflows
agent-board status
agent-board goals
\`\`\`

For workflow changes, create a small ready task and run a smoke test:

\`\`\`sh
agent-board new "Smoke test" --status ready
agent-board run smoke-test --workflow dev
agent-board runs smoke-test
\`\`\`
`;

export const configSkillAgents = `# Agent Board Configuration Rules

- Treat \`~/.agent-board\` as the only source of truth.
- Prefer editing global/project/goal workflow overlays over changing CLI source code for project-specific workflows.
- Keep workflow YAML deterministic: declared steps only, no hidden agent spawning.
- Do not overwrite existing \`~/.claude/skills/agent-board\` or \`~/.agents/skills/agent-board\` paths without explicit user approval.
- Use \`AGENT_BOARD_HOME\` only for tests, sandboxes, or intentionally isolated workspaces.
- Use \`AGENT_BOARD_CODEX_BIN\` and \`AGENT_BOARD_CLAUDE_BIN\` when the default binaries are not correct.
- Use workflow \`role\`, \`intent\`, and \`skills\` to make worker behavior explicit.
`;

export const taskWorkflowReference = `# Task Workflow

Use this reference when picking up, running, blocking, reviewing, or closing a task.

A task is the smallest executable unit. It should be concrete enough to claim, read context, edit, check, and report without inventing the plan.

1. Run \`agent-board status\` to understand current work.
2. Run \`agent-board next\` or inspect \`agent-board tasks\`.
3. Claim work before editing: \`agent-board claim <task-id> --agent <your-name>\`.
4. Prefer \`agent-board run <task-id> --workflow dev\` when a workflow is available.
5. Inspect sidecar outputs with \`agent-board runs\` and \`agent-board logs <run-id>\`.
6. If blocked, run \`agent-board block <task-id> "<reason>"\`.
7. When done, verify acceptance criteria and run \`agent-board done <task-id>\`.

If too broad, create smaller linked tasks. If stuck, block with a concrete reason.

Markdown is the source of truth. Manual edits are fine when frontmatter remains valid.
`;

export const pmOrchestratorSkillReadme = `# PM Orchestrator

Use this skill when acting as the project manager for a repository.

PM owns focus/state, not hidden implementation. Clarify goals, create specs/tasks, link blockers, run workflows, inspect outputs, and choose next work from board state.

1. Start with \`agent-board status\` and \`agent-board plan\`.
2. Use \`agent-board goals\` to confirm the active slice.
3. For unclear goals, run or create a research task before implementation.
4. Use \`agent-board spec new <title>\` for durable decisions and plans.
5. Break large goals into small implementation tasks with \`agent-board new\`.
6. Use \`agent-board link <from> --blocks <to>\` for ordering.
7. Use \`agent-board link <task> --spec <spec>\` to keep context attached.
8. Delegate execution through workflows instead of doing all work directly.
9. Inspect \`agent-board runs\` and \`agent-board logs <run-id>\` before deciding next steps.
10. Create follow-up tasks for actionable review findings.

Triage rules: ready tasks are independently executable; blocked tasks need concrete blockers; parallel lanes are independent ready tasks; cross-project blockers use qualified refs + \`agent-board plan --related\`; specs explain why, tasks explain what next.
`;

export const pmOrchestratorAgents = `# PM Orchestrator Rules

- Do not lose the goal. Keep task breakdown tied to specs and acceptance criteria.
- Prefer creating small linked tasks over one vague mega-task.
- Mark blockers explicitly and keep ready work unblocked.
- Use workflows to delegate worker execution.
- After each run, inspect logs and update task/spec state.
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

- Inspect the task, acceptance criteria, changed files, and run logs.
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
