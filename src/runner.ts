import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunState, RunStepResult, TaskFile, Workflow, WorkflowStep, Workspace } from "./types.js";
import { setTaskStatus } from "./tasks.js";
import { renderPrompt } from "./workflow.js";
import { runsDir } from "./workspace.js";

export async function runWorkflow(input: {
	workspace: Workspace;
	task: TaskFile;
	workflow: Workflow;
	agentOverride?: string;
}): Promise<RunState> {
	await setTaskStatus(input.workspace, input.task.meta.id, "in_progress", {
		assignee: input.task.meta.assignee,
		force: true,
	});

	const runId = `${timestampForPath()}-${input.task.meta.id}-${input.workflow.name}`;
	const runPath = join(runsDir(input.workspace), runId);
	await mkdir(runPath, { recursive: true });

	const state: RunState = {
		id: runId,
		taskId: input.task.meta.id,
		workflow: input.workflow.name,
		status: "running",
		startedAt: new Date().toISOString(),
		steps: [],
	};
	await writeRunState(runPath, state);
	console.log(`Run started: ${state.id}`);
	console.log(`Run path: ${runPath}`);
	console.log(`Logs: agent-board logs ${state.id}`);

	try {
		for (const item of input.workflow.steps) {
			if ("parallel" in item) {
				const results = await Promise.all(
					item.parallel.map((step) =>
						runStep({
							workspace: input.workspace,
							task: input.task,
							workflow: input.workflow,
							runPath,
							step,
							agentOverride: input.agentOverride,
						}),
					),
				);
				state.steps.push(...results);
			} else {
				state.steps.push(
					await runStep({
						workspace: input.workspace,
						task: input.task,
						workflow: input.workflow,
						runPath,
						step: item,
						agentOverride: input.agentOverride,
					}),
				);
			}
			await writeRunState(runPath, state);
		}
		state.status = "completed";
		state.finishedAt = new Date().toISOString();
		await writeSummary(runPath, state);
		await writeRunState(runPath, state);
		return state;
	} catch (error) {
		state.status = "failed";
		state.finishedAt = new Date().toISOString();
		await writeFile(
			join(runPath, "error.txt"),
			error instanceof Error ? error.stack ?? error.message : String(error),
		);
		await writeRunState(runPath, state);
		throw error;
	}
}

async function runStep(input: {
	workspace: Workspace;
	task: TaskFile;
	workflow: Workflow;
	runPath: string;
	step: WorkflowStep;
	agentOverride?: string;
}): Promise<RunStepResult> {
	const agent = input.agentOverride ?? input.step.agent ?? input.workflow.default_agent ?? "codex";
	const stepDir = join(input.runPath, input.step.id);
	await mkdir(stepDir, { recursive: true });

	const prompt = await renderPrompt(input);
	const promptPath = join(stepDir, "prompt.md");
	const stdoutPath = join(stepDir, "stdout.log");
	const stderrPath = join(stepDir, "stderr.log");
	await writeFile(promptPath, prompt);

	const startedAt = new Date().toISOString();
	const { command, args, stdin } = resolveAgentCommand(agent, input.step, prompt);
	console.log(`\n[${input.step.id}] ${command} ${args.join(" ")}`.trim());

	const proc = Bun.spawn([command, ...args], {
		cwd: input.workspace.cwd,
		stdin: stdin ? "pipe" : "inherit",
		stdout: "pipe",
		stderr: "pipe",
		env: process.env,
	});
	if (stdin && proc.stdin) {
		await writeStdin(proc.stdin, stdin);
	}

	const [stdout, stderr, exitCode] = await Promise.all([
		streamAndCollect(proc.stdout, "stdout"),
		streamAndCollect(proc.stderr, "stderr"),
		proc.exited,
	]);

	await writeFile(stdoutPath, stdout);
	await writeFile(stderrPath, stderr);

	const result: RunStepResult = {
		id: input.step.id,
		agent,
		exitCode,
		startedAt,
		finishedAt: new Date().toISOString(),
		stdoutPath,
		stderrPath,
		promptPath,
	};

	if (exitCode !== 0) {
		throw new Error(`Workflow step failed: ${input.step.id} exited ${exitCode}`);
	}

	return result;
}

function resolveAgentCommand(
	agent: string,
	step: WorkflowStep,
	prompt: string,
): { command: string; args: string[]; stdin?: string } {
	if (agent === "codex") {
		return {
			command: process.env.AGENT_BOARD_CODEX_BIN ?? "codex",
			args: agentArgs(
				process.env.AGENT_BOARD_CODEX_ARGS,
				["exec", "--dangerously-bypass-approvals-and-sandbox", "-"],
			),
			stdin: prompt,
		};
	}
	if (agent === "claude") {
		return {
			command: process.env.AGENT_BOARD_CLAUDE_BIN ?? "claude",
			args: agentArgs(
				process.env.AGENT_BOARD_CLAUDE_ARGS,
				["-p", "--permission-mode", "bypassPermissions"],
			),
			stdin: prompt,
		};
	}
	const envName = `AGENT_BOARD_${agent.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_BIN`;
	return { command: process.env[envName] ?? agent, args: [], stdin: prompt };
}

function agentArgs(value: string | undefined, fallback: string[]): string[] {
	if (!value?.trim()) return fallback;
	return splitArgs(value);
}

function splitArgs(value: string): string[] {
	const args: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;
	for (const char of value) {
		if (quote) {
			if (char === quote) quote = null;
			else current += char;
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			continue;
		}
		if (/\s/.test(char)) {
			if (current) {
				args.push(current);
				current = "";
			}
			continue;
		}
		current += char;
	}
	if (current) args.push(current);
	return args;
}

async function writeStdin(
	stdin: { write(value: string | Uint8Array): unknown; end(): unknown },
	value: string,
): Promise<void> {
	stdin.write(value);
	stdin.end();
}

async function streamAndCollect(
	stream: ReadableStream<Uint8Array>,
	target: "stdout" | "stderr",
): Promise<string> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let text = "";
	while (true) {
		const next = await reader.read();
		if (next.done) break;
		const chunk = decoder.decode(next.value, { stream: true });
		text += chunk;
		if (target === "stdout") process.stdout.write(chunk);
		else process.stderr.write(chunk);
	}
	text += decoder.decode();
	return text;
}

async function writeRunState(runPath: string, state: RunState): Promise<void> {
	await writeFile(join(runPath, "run.json"), JSON.stringify(state, null, 2));
}

async function writeSummary(runPath: string, state: RunState): Promise<void> {
	const lines = [
		`# Run ${state.id}`,
		"",
		`Task: ${state.taskId}`,
		`Workflow: ${state.workflow}`,
		`Status: ${state.status}`,
		"",
		"## Steps",
		"",
		...state.steps.map(
			(step) => `- ${step.id} (${step.agent}) exit=${step.exitCode}`,
		),
		"",
	];
	await writeFile(join(runPath, "summary.md"), lines.join("\n"));
}

function timestampForPath(): string {
	return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
}
