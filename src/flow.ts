import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir } from "node:fs/promises";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { appendEvidence, getTask, updateTask } from "./tasks.js";
import type { Workspace } from "./types.js";
import { atomicWrite, ensureDir, nowIso, slugify } from "./utils.js";

export type FlowRuntime = "codex" | "claude" | "opencode";

export const FLOW_TEMPLATES = ["default", "feature", "review", "fix"] as const;

export type FlowTemplate = (typeof FLOW_TEMPLATES)[number];

export type FlowAgentMode = "read" | "write";

export const DEFAULT_FLOW_AGENT_MODE: FlowAgentMode = "read";

// Maps the agent-facing flow mode onto a spawn-agent PermissionPolicy value.
// "read" -> "auto-reject" rejects every permission request, which also blocks
// shell execution, so read mode means native file reads only (no shell, no edits).
// "write" -> "auto-allow" grants the agent full write/execute permission.
export function modeToPermission(mode: FlowAgentMode): "auto-reject" | "auto-allow" {
	return mode === "write" ? "auto-allow" : "auto-reject";
}

export interface FlowRunOptions {
	target: string;
	input?: string;
	runtime: FlowRuntime;
	concurrency: number;
	agents: number;
	taskId?: string;
	verbose?: boolean;
}

export interface FlowRunResult {
	runId: string;
	runPath: string;
	summaryPath: string;
	scriptPath?: string;
}

export class FlowRunError extends Error {
	constructor(
		message: string,
		readonly runId: string,
		readonly runPath: string,
		readonly summaryPath: string,
		readonly cause?: unknown,
	) {
		super(message);
	}
}

export interface FlowFile {
	name: string;
	path: string;
}

interface FlowAgentOptions {
	name?: string;
	system?: string;
	cwd?: string;
	timeoutMs?: number;
	mode?: FlowAgentMode;
}

interface FlowAgentResult {
	name: string;
	prompt: string;
	text: string;
	mode: FlowAgentMode;
	started: string;
	finished: string;
	durationMs: number;
	outputPath: string;
	diagnostics: number;
}

interface FlowDiagnostic {
	level: "info" | "warn" | "error";
	message: string;
}

interface FlowContext {
	input: string;
	target: string;
	workspace: {
		project: string;
		goal: string;
		repoPath: string;
	};
	run: {
		id: string;
		path: string;
	};
	options: {
		runtime: FlowRuntime;
		concurrency: number;
		agents: number;
	};
	agent(prompt: string, options?: FlowAgentOptions): Promise<FlowAgentResult>;
	parallel<T, R>(
		items: T[] | Array<() => Promise<R>>,
		worker?: (item: T, index: number) => Promise<R>,
	): Promise<R[]>;
	log(message: string): Promise<void>;
}

interface FlowRunState {
	agents: FlowAgentResult[];
}

export async function createFlow(
	workspace: Workspace,
	name: string,
	options: { force?: boolean; template?: FlowTemplate } = {},
): Promise<FlowFile> {
	const dir = flowDir(workspace);
	await ensureDir(dir);
	const id = slugify(name);
	const path = join(dir, `${id}.mjs`);
	if (existsSync(path) && !options.force) {
		throw new Error(`Flow already exists: ${id}. Use --force to overwrite.`);
	}
	await atomicWrite(path, flowTemplate(name, options.template ?? "default"));
	return { name: id, path };
}

export async function listFlows(workspace: Workspace): Promise<FlowFile[]> {
	const dir = flowDir(workspace);
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
	return entries
		.filter((entry) => entry.isFile() && [".mjs", ".js", ".ts"].includes(extname(entry.name)))
		.map((entry) => ({
			name: basename(entry.name, extname(entry.name)),
			path: join(dir, entry.name),
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readFlowScript(
	workspace: Workspace,
	name: string,
): Promise<{ name: string; path: string; body: string }> {
	assertFlowName(name);
	const path = projectFlowScript(workspace, name);
	if (!path) throw new Error(`Flow script not found: ${name}`);
	return {
		name: basename(path, extname(path)),
		path,
		body: await Bun.file(path).text(),
	};
}

export async function writeFlowScript(
	workspace: Workspace,
	name: string,
	body: string,
): Promise<FlowFile> {
	assertFlowName(name);
	const path = projectFlowScript(workspace, name) ?? flowPathForName(workspace, name);
	await ensureDir(flowDir(workspace));
	await atomicWrite(path, body.endsWith("\n") ? body : `${body}\n`);
	return { name: basename(path, extname(path)), path };
}

export async function runFlow(
	workspace: Workspace,
	options: FlowRunOptions,
): Promise<FlowRunResult> {
	validateRuntime(options.runtime);
	const target = options.target.trim();
	if (!target) throw new Error("Flow target cannot be empty.");
	if (options.taskId) await getTask(workspace, options.taskId);

	const scriptPath = resolveFlowScript(workspace, target);
	const { runId, runPath } = await createRunDir(`${new Date().toISOString().slice(0, 10)}-${slugify(scriptPath ? basename(scriptPath, extname(scriptPath)) : target)}`, workspace);
	const summaryPath = join(runPath, "summary.md");

	const state: FlowRunState = { agents: [] };
	const context = createFlowContext(workspace, runPath, runId, options, state);
	await context.log(`flow started: ${target}`);
	await context.log(`runtime: ${options.runtime}`);
	if (scriptPath) await context.log(`script: ${scriptPath}`);

	let summary: unknown;
	try {
		summary = scriptPath
			? await runScriptFlow(scriptPath, context)
			: await runAdhocFlow(context);
	} catch (error) {
		await atomicWrite(
			summaryPath,
			formatFailedSummary({
				runId,
				workspace,
				options,
				target,
				scriptPath,
				error,
				agents: state.agents,
			}),
		);
		await context.log(`flow failed: ${summaryPath}`);
		throw new FlowRunError(
			`Flow run ${runId} failed: ${error instanceof Error ? error.message : String(error)}`,
			runId,
			runPath,
			summaryPath,
			error,
		);
	}
	await atomicWrite(
		summaryPath,
		formatSummary({
			runId,
			workspace,
			options,
			target,
			scriptPath,
			summary: normalizeResult(summary),
			agents: state.agents,
		}),
	);

	if (options.taskId) {
		await updateTask(workspace, options.taskId, (task) => {
			task.body = appendEvidence(
				task.body,
				`- [flow] ${nowIso()} ${runId}: ${summaryPath}`,
			);
		});
	}

	await context.log(`flow finished: ${summaryPath}`);
	return { runId, runPath, summaryPath, scriptPath };
}

export function flowDir(workspace: Workspace): string {
	return join(workspace.projectPath, "flows");
}

export function flowRunsDir(workspace: Workspace): string {
	return join(workspace.goalPath, "flows", "runs");
}

export function parseFlowRuntime(value: string): FlowRuntime {
	validateRuntime(value);
	return value;
}

export function parseFlowTemplate(value: string): FlowTemplate {
	if (!FLOW_TEMPLATES.includes(value as FlowTemplate)) {
		throw new Error(`Invalid flow template. Expected one of: ${FLOW_TEMPLATES.join(", ")}`);
	}
	return value as FlowTemplate;
}

export function parsePositiveInt(value: string, name: string): number {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error(`${name} must be a positive integer.`);
	}
	return parsed;
}

function createFlowContext(
	workspace: Workspace,
	runPath: string,
	runId: string,
	options: FlowRunOptions,
	state: FlowRunState,
): FlowContext {
	let agentIndex = 0;
	return {
		input: options.input ?? (resolveFlowScript(workspace, options.target) ? "" : options.target),
		target: options.target,
		workspace: {
			project: workspace.projectSlug,
			goal: workspace.goalSlug,
			repoPath: workspace.repoPath,
		},
		run: {
			id: runId,
			path: runPath,
		},
		options: {
			runtime: options.runtime,
			concurrency: options.concurrency,
			agents: options.agents,
		},
		agent: async (prompt, agentOptions = {}) => {
			const callIndex = ++agentIndex;
			const name = agentOptions.name ?? `agent-${callIndex}`;
			const mode = agentOptions.mode ?? DEFAULT_FLOW_AGENT_MODE;
			const started = nowIso();
			await writeEvent(runPath, "agent_start", { name, mode, promptChars: prompt.length });
			console.log(`agent ${name}: start (${mode})`);
			const startedMs = Date.now();
			const diagnostics: FlowDiagnostic[] = [];
			let text: string;
			try {
				text = await runAgentPrompt(options.runtime, prompt, {
					...agentOptions,
					mode,
					cwd: agentOptions.cwd ?? workspace.repoPath,
					diagnostics,
					verbose: options.verbose,
				});
			} catch (error) {
				await writeDiagnostics(runPath, name, diagnostics);
				await writeEvent(runPath, "agent_error", {
					name,
					durationMs: Date.now() - startedMs,
					diagnostics: diagnostics.length,
					error: truncateForLog(error instanceof Error ? error.message : String(error), 300),
				});
				throw error;
			}
			const outputPath = join(runPath, "agents", `${String(callIndex).padStart(2, "0")}-${slugify(name)}.md`);
			await ensureDir(join(runPath, "agents"));
			await atomicWrite(outputPath, formatAgentOutput(name, prompt, text));
			await writeDiagnostics(runPath, name, diagnostics);
			const result: FlowAgentResult = {
				name,
				prompt,
				text,
				mode,
				started,
				finished: nowIso(),
				durationMs: Date.now() - startedMs,
				outputPath,
				diagnostics: diagnostics.length,
			};
			state.agents.push(result);
			await writeEvent(runPath, "agent_finish", {
				name,
				mode,
				durationMs: result.durationMs,
				outputPath,
				chars: text.length,
				diagnostics: diagnostics.length,
			});
			console.log(`agent ${name}: done`);
			return result;
		},
		parallel: async <T, R>(
			items: T[] | Array<() => Promise<R>>,
			worker?: (item: T, index: number) => Promise<R>,
		): Promise<R[]> => {
			const tasks = worker
				? (items as T[]).map((item, index) => () => worker(item, index))
				: (items as Array<() => Promise<R>>);
			return runLimited(tasks, options.concurrency);
		},
		log: async (message) => {
			await writeEvent(runPath, "log", { message });
			console.log(message);
		},
	};
}

async function createRunDir(
	baseId: string,
	workspace: Workspace,
): Promise<{ runId: string; runPath: string }> {
	const root = flowRunsDir(workspace);
	await ensureDir(root);
	for (let attempt = 0; attempt < 20; attempt++) {
		const runId = attempt === 0 ? baseId : `${baseId}-${Math.random().toString(36).slice(2, 8)}`;
		const runPath = join(root, runId);
		try {
			await mkdir(runPath);
			return { runId, runPath };
		} catch (error) {
			if (isNodeError(error) && error.code === "EEXIST") continue;
			throw error;
		}
	}
	throw new Error(`Could not create unique flow run directory for ${baseId}`);
}

async function runScriptFlow(scriptPath: string, context: FlowContext): Promise<unknown> {
	const moduleUrl = `${pathToFileURL(scriptPath).href}?run=${Date.now()}`;
	const module = await import(moduleUrl) as { default?: unknown; flow?: unknown };
	const flow = module.default ?? module.flow;
	if (typeof flow !== "function") {
		throw new Error(`Flow script must export a default function: ${scriptPath}`);
	}
	return flow(context);
}

async function runAdhocFlow(context: FlowContext): Promise<string> {
	const goal = context.input.trim();
	const roles = [
		{
			name: "researcher",
			prompt: `Inspect this repository for the goal below. Do not edit files. Return the key files, current architecture, and useful facts.\n\nGoal:\n${goal}`,
		},
		{
			name: "critic",
			prompt: `Review the goal below for risks, edge cases, and likely failure modes. Do not edit files. Return only concrete findings.\n\nGoal:\n${goal}`,
		},
		{
			name: "planner",
			prompt: `Create the smallest practical implementation plan for the goal below. Do not edit files. Include commands or tests that should verify the work.\n\nGoal:\n${goal}`,
		},
		{
			name: "tester",
			prompt: `Find the most important test coverage needed for the goal below. Do not edit files. Return concise test cases and gaps.\n\nGoal:\n${goal}`,
		},
	].slice(0, context.options.agents);

	const results = await context.parallel(roles, (role) =>
		context.agent(role.prompt, { name: role.name }),
	);
	const findings = results
		.map((result) => `## ${result.name}\n\n${result.text.trim()}`)
		.join("\n\n");
	const synthesis = await context.agent(
		`Synthesize the worker outputs into a concise final report with: decision, highest-signal findings, and next steps.\n\nGoal:\n${goal}\n\nWorker outputs:\n${findings}`,
		{ name: "synthesizer" },
	);
	return synthesis.text;
}

async function runAgentPrompt(
	runtime: FlowRuntime,
	prompt: string,
	options: FlowAgentOptions & { diagnostics: FlowDiagnostic[]; verbose?: boolean },
): Promise<string> {
	if (process.env.AGENT_BOARD_FLOW_MOCK === "1") {
		return [
			`Mock ${runtime} response from ${options.name ?? "agent"}.`,
			"",
			prompt.slice(0, 600),
		].join("\n");
	}

	const [{ generateText }, { spawnAgent }] = await Promise.all([
		import("ai"),
		import("spawn-agent"),
	]);
	const result = await generateText({
		model: spawnAgent(runtime, {
			cwd: options.cwd,
			permission: modeToPermission(options.mode ?? DEFAULT_FLOW_AGENT_MODE),
			inactivityTimeoutMs: options.timeoutMs ?? 180_000,
			onStderr: (line: string) => {
				const diagnostic = summarizeDiagnostic(line);
				if (diagnostic) options.diagnostics.push(diagnostic);
				if (options.verbose) console.error(`[${options.name ?? runtime}] ${line}`);
			},
		}),
		system: options.system ?? defaultSystemPrompt(),
		prompt,
	});
	return result.text;
}

async function runLimited<T>(
	tasks: Array<() => Promise<T>>,
	limit: number,
): Promise<T[]> {
	const results = new Array<T>(tasks.length);
	let next = 0;
	const workers = Array.from(
		{ length: Math.min(limit, tasks.length) },
		async () => {
			while (next < tasks.length) {
				const index = next++;
				results[index] = await tasks[index]!();
			}
		},
	);
	await Promise.all(workers);
	return results;
}

function resolveFlowScript(workspace: Workspace, target: string): string | undefined {
	const direct = resolveCandidate(process.cwd(), target);
	if (direct) return direct;

	const named = [".mjs", ".js", ".ts"]
		.map((extension) => join(flowDir(workspace), `${slugify(target)}${extension}`))
		.find((path) => existsSync(path));
	if (named) return named;

	if (isPathLike(target)) {
		throw new Error(`Flow script not found: ${target}`);
	}
	return undefined;
}

function projectFlowScript(workspace: Workspace, target: string): string | undefined {
	return [".mjs", ".js", ".ts"]
		.map((extension) => join(flowDir(workspace), `${slugify(target)}${extension}`))
		.find((path) => existsSync(path));
}

function flowPathForName(workspace: Workspace, name: string): string {
	return join(flowDir(workspace), `${slugify(name)}.mjs`);
}

function assertFlowName(name: string): void {
	if (isPathLike(name)) {
		throw new Error("Expected a project flow name, not a filesystem path.");
	}
}

function resolveCandidate(cwd: string, target: string): string | undefined {
	const path = isAbsolute(target) ? target : resolve(cwd, target);
	return existsSync(path) ? path : undefined;
}

function isPathLike(value: string): boolean {
	return value.includes("/") || value.startsWith(".") || [".mjs", ".js", ".ts"].includes(extname(value));
}

async function writeEvent(
	runPath: string,
	type: string,
	data: Record<string, unknown>,
): Promise<void> {
	await appendFile(
		join(runPath, "events.jsonl"),
		`${JSON.stringify({ ts: nowIso(), type, ...data })}\n`,
	);
}

async function writeDiagnostics(
	runPath: string,
	agent: string,
	diagnostics: FlowDiagnostic[],
): Promise<void> {
	if (!diagnostics.length) return;
	for (const diagnostic of diagnostics) {
		await appendFile(
			join(runPath, "diagnostics.jsonl"),
			`${JSON.stringify({ ts: nowIso(), agent, ...diagnostic })}\n`,
		);
	}
}

function normalizeResult(value: unknown): string {
	if (typeof value === "string") return value.trim();
	if (isAgentResult(value)) return value.text.trim();
	return JSON.stringify(value, null, 2);
}

function isAgentResult(value: unknown): value is FlowAgentResult {
	return !!value && typeof value === "object" && "text" in value && typeof (value as { text: unknown }).text === "string";
}

function formatSummary(input: {
	runId: string;
	workspace: Workspace;
	options: FlowRunOptions;
	target: string;
	scriptPath?: string;
	summary: string;
	agents: FlowAgentResult[];
}): string {
	const agents = input.agents
		.map((agent) => {
			const diagnostics = agent.diagnostics ? `, diagnostics: ${agent.diagnostics}` : "";
			return `- ${agent.name}: ${agent.mode}, ${agent.durationMs}ms, output: ${agent.outputPath}${diagnostics}`;
		})
		.join("\n") || "- none";
	return [
		`# Flow Run ${input.runId}`,
		"",
		`- Project: ${input.workspace.projectSlug}`,
		`- Goal: ${input.workspace.goalSlug}`,
		`- Runtime: ${input.options.runtime}`,
		`- Target: ${input.target}`,
		input.scriptPath ? `- Script: ${input.scriptPath}` : undefined,
		`- Created: ${nowIso()}`,
		"",
		"## Summary",
		"",
		input.summary || "No summary returned.",
		"",
		"## Agents",
		"",
		agents,
		"",
		"## Controller Next",
		"",
		"- Read this summary first.",
		"- Inspect per-agent outputs only when details are needed.",
		"- Update specs/tasks/evidence before starting the next wave.",
		"",
	].filter((line) => line !== undefined).join("\n");
}

function formatFailedSummary(input: {
	runId: string;
	workspace: Workspace;
	options: FlowRunOptions;
	target: string;
	scriptPath?: string;
	error: unknown;
	agents: FlowAgentResult[];
}): string {
	return formatSummary({
		...input,
		summary: `Flow failed before completion.\n\nError: ${input.error instanceof Error ? input.error.message : String(input.error)}`,
	});
}

function formatAgentOutput(name: string, prompt: string, text: string): string {
	return [
		`# ${name}`,
		"",
		"## Prompt",
		"",
		prompt,
		"",
		"## Output",
		"",
		text.trim() || "No output.",
		"",
	].join("\n");
}

function summarizeDiagnostic(line: string): FlowDiagnostic | undefined {
	if (isNoisyDiagnostic(line)) return undefined;

	const mcpUpdate = /McpStartupUpdate\(McpStartupUpdateEvent \{ server: "([^"]+)", status: ([^}]+)\}/.exec(line);
	if (mcpUpdate) {
		const [, server, status] = mcpUpdate;
		if (status.startsWith("Starting")) return undefined;
		if (status.startsWith("Ready")) {
			return { level: "info", message: `mcp ready: ${server}` };
		}
		return {
			level: "warn",
			message: `mcp ${server} ${truncateForLog(status.replace(/\s+/g, " "), 240)}`,
		};
	}

	const skillFailure = /failed to load skill ([^:]+):\s*(.+)$/.exec(line);
	if (skillFailure) {
		return {
			level: "warn",
			message: `skill load failed: ${skillFailure[1]}: ${truncateForLog(skillFailure[2] ?? "", 180)}`,
		};
	}

	if (/\bERROR\b|failed|Failed|Auth error|Unauthenticated/i.test(line)) {
		return { level: "error", message: truncateForLog(line, 300) };
	}

	return undefined;
}

function isNoisyDiagnostic(line: string): boolean {
	return [
		/unknown feature key in config/,
		/Received event for unknown submission ID/,
		/SkillsUpdateAvailable/,
		/OAuth metadata discovery is unavailable/,
		/Failed to delete shell snapshot/,
		/Failed to kill MCP process group/,
		/failed to open state db/,
		/failed to initialize state runtime/,
		/Failed to list resource templates/,
		/Failed to list resources/,
		/McpStartupComplete/,
	].some((pattern) => pattern.test(line));
}

function truncateForLog(value: string, max: number): string {
	return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function validateRuntime(value: string): asserts value is FlowRuntime {
	if (!["codex", "claude", "opencode"].includes(value)) {
		throw new Error("Invalid runtime. Expected one of: codex, claude, opencode");
	}
}

function defaultSystemPrompt(): string {
	return [
		"You are running inside an agent-board flow.",
		"Be concise and concrete.",
		"When asked to inspect, prefer reading the repository and cite file paths.",
		"Do not claim work is verified unless you actually ran the verification.",
		"Do not choose branches, commits, or roadmap decisions unless the controller explicitly assigned that responsibility.",
	].join(" ");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}

function flowTemplate(name: string, template: FlowTemplate): string {
	const fallback = `Inspect ${name} and recommend the next steps.`;
	if (template === "default") {
		return roleFlowTemplate(name, template, fallback, [
			{
				name: "researcher",
				brief: "Inspect the repository for this goal. Do not edit files. Return relevant files, current behavior, and useful facts.",
			},
			{
				name: "critic",
				brief: "Look for risks, edge cases, and missing tests for this goal. Do not edit files. Return concrete findings only.",
			},
		], "Synthesize this into a concise final report with decision, findings, and next steps.");
	}
	if (template === "feature") {
		return roleFlowTemplate(name, template, fallback, [
			{
				name: "researcher",
				brief: "Inspect the repository for the requested feature. Do not edit files. Return relevant architecture, files, and constraints.",
			},
			{
				name: "planner",
				brief: "Create the smallest practical implementation plan. Do not edit files. Include sequencing, affected files, and acceptance criteria.",
			},
			{
				name: "tester",
				brief: "Identify the most important tests and verification commands for this feature. Do not edit files.",
			},
		], "Synthesize this into an implementation checklist with files, tests, risks, and controller next steps.");
	}
	if (template === "review") {
		return roleFlowTemplate(name, template, fallback, [
			{
				name: "reviewer",
				brief: "Review the current changes for bugs, regressions, and unclear behavior. Do not edit files. Lead with concrete findings.",
			},
			{
				name: "test-auditor",
				brief: "Review test coverage for the current changes. Do not edit files. Return missing or weak tests.",
			},
			{
				name: "risk-reviewer",
				brief: "Review operational, migration, concurrency, and compatibility risks. Do not edit files. Return concrete risks only.",
			},
		], "Synthesize this into a code-review style report with findings first, then tests and next steps.");
	}
	return roleFlowTemplate(name, template, fallback, [
		{
			name: "reproducer",
			brief: "Understand the bug or failure. Do not edit files. Return reproduction clues, likely failing paths, and commands to verify.",
		},
		{
			name: "locator",
			brief: "Inspect the repository to locate the likely source of the bug. Do not edit files. Return files, functions, and reasoning.",
		},
		{
			name: "test-planner",
			brief: "Design focused regression tests for the fix. Do not edit files. Return test cases and commands.",
		},
	], "Synthesize this into a fix checklist with suspected cause, patch plan, regression tests, and risks.");
}

function roleFlowTemplate(
	name: string,
	template: FlowTemplate,
	fallback: string,
	roles: Array<{ name: string; brief: string }>,
	summaryInstruction: string,
): string {
	return `export default async function flow({ input, agent, parallel, log }) {
	const flowName = ${JSON.stringify(name)};
	const goal = input || ${JSON.stringify(fallback)};
	await log(\`running ${template} flow for \${flowName}: \${goal}\`);

	const workers = ${JSON.stringify(roles, null, "\t")};

	const results = await parallel(workers, (worker) =>
		agent(\`\${worker.brief}\\n\\nGoal:\\n\${goal}\`, { name: worker.name, mode: "read" }),
	);

	const findings = results
		.map((result) => \`## \${result.name}\\n\\n\${result.text.trim()}\`)
		.join("\\n\\n");

	const summary = await agent(
		\`Do not edit files. ${summaryInstruction}\\n\\nGoal:\\n\${goal}\\n\\nWorker outputs:\\n\${findings}\`,
		{ name: "synthesizer", mode: "read" },
	);

	return summary.text;
}
`;
}
