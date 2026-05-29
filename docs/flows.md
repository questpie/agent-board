# Flows

`agent-board flow` is a minimal local orchestration layer for controller agents.

The CLI is not meant to be a human workflow builder. Humans can speak naturally; the controller agent uses `flow new`, edits the script, summarizes the phases, and runs it after approval or explicit go-ahead.

## Commands

```sh
agent-board flow new <name> --template feature
agent-board flow cat <name>
agent-board flow write <name> --from ./flow.mjs
agent-board flow run <name> --input "<scope>" --task <task-id>
agent-board flow show <run-id>
```

Templates:

- `default`: general read-only fan-out
- `feature`: feature planning, test planning, and synthesis
- `review`: cross-agent review
- `fix`: reproduction, localization, regression-test planning

For quick read-only fan-out:

```sh
agent-board flow run "Audit auth for missing tests" --agents 3 --concurrency 3
```

## Script API

Workflow scripts export a default async function:

```js
export default async function flow({ input, agent, parallel, log, workspace }) {
	await log(`running audit: ${input}`);

	const results = await parallel([
		() => agent(`Inspect architecture for: ${input}`, { name: "researcher" }),
		() => agent(`Find risks for: ${input}`, { name: "critic" }),
	]);

	return results.map((result) => `## ${result.name}\n\n${result.text}`).join("\n\n");
}
```

Available context:

- `input`: `--input` text, or the ad-hoc target for unscripted runs
- `agent(prompt, options)`: spawn a local coding agent
- `parallel(items, worker)`: run tasks with the CLI concurrency limit
- `log(message)`: write compact lifecycle logs
- `workspace`: project, goal, and repo metadata

## Artifacts

Each run writes:

```txt
~/.agent-board/projects/<project>/goals/<goal>/flows/runs/<run-id>/
  summary.md
  events.jsonl
  diagnostics.jsonl
  agents/
    01-researcher.md
    02-critic.md
```

Read order:

1. `summary.md`
2. `agents/*.md` only when details are needed
3. `diagnostics.jsonl` only for runtime or MCP issues

Raw agent stderr is quiet by default. Use `--verbose` only when debugging the runtime.

## Controller Pattern

For non-trivial work:

1. Confirm project and goal with `agent-board status`.
2. Write or update a spec.
3. Split the feature into linked tasks.
4. Create a flow script with `agent-board flow new <name> --template <kind>`.
5. Inspect or edit the script with `agent-board flow cat/write` to encode phases: fan-out, worker prompts, reviews, synthesis, and task/evidence updates.
6. Summarize the phases to the user.
7. Run the script after approval or explicit go-ahead.
8. Read `summary.md`, update board state, and decide the next wave.

The main chat remains controller. Spawned agents do not own roadmap, branch policy, commit policy, or final done decisions.

## Same-Worktree Safety

Same-worktree write flows are acceptable for P0 only when the script prevents agents from fighting:

- no branch switching by spawned agents
- no commits by spawned agents
- no reset/rebase
- no overlapping file edits
- no concurrent git operations

For heavy parallel implementation, use separate git worktrees and pass `AGENT_BOARD_REPO`.
