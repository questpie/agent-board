import { existsSync } from "node:fs";
import { appendFile, chmod, copyFile, mkdir, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { appendEvidence, getTask, updateTask } from "./tasks.js";
import type { Workspace } from "./types.js";
import { atomicWrite, ensureDir, nowIso, slugify } from "./utils.js";

export const FLOW_RUNTIMES = ["codex", "claude", "cursor", "copilot", "gemini", "opencode", "droid", "pi"] as const;

export type FlowRuntime = (typeof FLOW_RUNTIMES)[number];

export type CodexMcpMode = "isolated" | "inherit";

export const FLOW_TEMPLATES = [
	"default",
	"feature",
	"review",
	"fix",
	"design",
	"task-graph",
	"refactor",
	"hygiene",
	"grill",
	"safe-workflow",
] as const;

export type FlowTemplate = (typeof FLOW_TEMPLATES)[number];

export type FlowAgentMode = "read" | "write";

export const DEFAULT_FLOW_AGENT_MODE: FlowAgentMode = "read";
export const DEFAULT_FLOW_AGENT_TIMEOUT_MS = 7_200_000;

const require = createRequire(import.meta.url);

export type FlowJsonSchema = {
	type?: "object" | "array" | "string" | "integer" | "number" | "boolean" | "null";
	enum?: readonly unknown[];
	properties?: { readonly [key: string]: FlowJsonSchema };
	required?: readonly string[];
	items?: FlowJsonSchema;
	additionalProperties?: boolean | FlowJsonSchema;
};

interface FlowMeta {
	name?: string;
	description?: string;
	phases?: Array<{ title: string; detail?: string }>;
}

// Maps the agent-facing flow mode onto a spawn-agent PermissionPolicy value.
// "read" -> "auto-reject" rejects every permission request, which also blocks
// shell execution, so read mode means native file reads only (no shell, no edits).
// "write" -> "auto-allow" grants the agent full write/execute permission.
export function modeToPermission(mode: FlowAgentMode): "auto-reject" | "auto-allow" {
	return mode === "write" ? "auto-allow" : "auto-reject";
}

export interface CodexAcpBinResolution {
	path: string;
	source: "env" | "bundled";
}

export function resolveCodexAcpBin(): CodexAcpBinResolution | undefined {
	const raw = process.env.AGENT_BOARD_CODEX_ACP_BIN?.trim();
	if (raw) {
		const path = resolve(raw);
		if (!existsSync(path)) {
			throw new Error(`AGENT_BOARD_CODEX_ACP_BIN points to a missing file: ${path}`);
		}
		return { path, source: "env" };
	}
	const bundled = resolveBundledCodexAcpBin();
	return bundled ? { path: bundled, source: "bundled" } : undefined;
}

function resolveBundledCodexAcpBin(): string | undefined {
	try {
		const path = require.resolve("@agentclientprotocol/codex-acp/dist/index.js");
		if (existsSync(path)) return path;
	} catch {
		// Fall through to the legacy native package while spawn-agent still
		// carries it transitively. Agent-board ships the maintained adapter.
	}
	const pkg = codexAcpPlatformPackage();
	if (!pkg) return undefined;
	const binaryName = process.platform === "win32" ? "codex-acp.exe" : "codex-acp";
	try {
		const path = require.resolve(`${pkg}/bin/${binaryName}`);
		return existsSync(path) ? path : undefined;
	} catch {
		return undefined;
	}
}

function codexAcpPlatformPackage(): string | undefined {
	if (process.platform === "darwin" && process.arch === "arm64") return "@zed-industries/codex-acp-darwin-arm64";
	if (process.platform === "darwin" && process.arch === "x64") return "@zed-industries/codex-acp-darwin-x64";
	if (process.platform === "linux" && process.arch === "arm64") return "@zed-industries/codex-acp-linux-arm64";
	if (process.platform === "linux" && process.arch === "x64") return "@zed-industries/codex-acp-linux-x64";
	if (process.platform === "win32" && process.arch === "arm64") return "@zed-industries/codex-acp-win32-arm64";
	if (process.platform === "win32" && process.arch === "x64") return "@zed-industries/codex-acp-win32-x64";
	return undefined;
}

export function resolveCodexAcpAdapter<T>(
	factory: (options: { binPath: string; env?: Readonly<Record<string, string>> }) => T,
	env?: Readonly<Record<string, string>>,
): { adapter: T; resolution: CodexAcpBinResolution } | undefined {
	const resolution = resolveCodexAcpBin();
	if (!resolution) return undefined;
	return {
		adapter: factory({ binPath: resolution.path, env }),
		resolution,
	};
}

export interface FlowRunOptions {
	target: string;
	input?: string;
	runtime: FlowRuntime;
	model?: string;
	concurrency: number;
	agents: number;
	agentTimeoutMs: number;
	codexMcpMode: CodexMcpMode;
	taskId?: string;
	verbose?: boolean;
	onRunStart?: (run: {
		runId: string;
		runPath: string;
		summaryPath: string;
		scriptPath?: string;
	}) => void | Promise<void>;
	onEventLine?: (line: string) => void | Promise<void>;
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
	label?: string;
	phase?: string;
	system?: string;
	model?: string;
	cwd?: string;
	timeoutMs?: number;
	mode?: FlowAgentMode;
	env?: Readonly<Record<string, string>>;
	schema?: FlowJsonSchema;
}

interface FlowAgentResult {
	name: string;
	label?: string;
	phase?: string;
	model?: string;
	prompt: string;
	text: string;
	json?: unknown;
	mode: FlowAgentMode;
	started: string;
	finished: string;
	durationMs: number;
	outputPath: string;
	jsonPath?: string;
	diagnostics: number;
}

interface FlowDiagnostic {
	level: "info" | "warn" | "error";
	message: string;
}

export interface FlowRuntimeStatus {
	runtime: FlowRuntime;
	displayName: string;
	available: boolean;
}

export interface FlowModelChoice {
	value: string;
	name: string;
	description?: string;
	group?: string;
}

export interface FlowModelConfig {
	configId: string;
	name: string;
	category: string;
	currentValue: string;
	choices: FlowModelChoice[];
}

export interface FlowModelDiscovery {
	runtime: FlowRuntime;
	configs: FlowModelConfig[];
	warning?: string;
}

// Compact, throttled progress telemetry written to events.jsonl while an agent
// streams. Never carries full agent text: `agent_delta` reports a running char
// count plus a short trailing PREVIEW, and `agent_heartbeat` marks either
// runtime/tool activity with no new text or a fully idle stream that is still
// inside the watchdog window. Full output still lives in agents/*.md.
type FlowProgressEvent =
	| { type: "agent_delta"; chars: number; preview: string }
	| { type: "agent_heartbeat"; chars: number; quietMs: number; timeoutMs: number; streamIdleMs: number };

// Internal, runtime-agnostic stream unit so the real (streamText) path and the
// AGENT_BOARD_FLOW_MOCK path drive the exact same throttling/emission logic.
type FlowStreamPart = { type: "text"; text: string } | { type: "activity" };

// Throttle ceiling: emit at most one progress event per window (default ~1s).
// Overridable for tests via AGENT_BOARD_FLOW_THROTTLE_MS (0 disables throttling).
function flowThrottleMs(): number {
	const raw = process.env.AGENT_BOARD_FLOW_THROTTLE_MS;
	if (raw === undefined) return 1000;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1000;
}

function flowIdleHeartbeatMs(): number {
	const raw = process.env.AGENT_BOARD_FLOW_IDLE_HEARTBEAT_MS;
	if (raw === undefined) return 30_000;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 30_000;
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
		model?: string;
		concurrency: number;
		agents: number;
		agentTimeoutMs: number;
	};
	agent(prompt: string, options?: FlowAgentOptions): Promise<FlowAgentResult>;
	parallel<T, R>(
		items: T[] | Array<() => Promise<R>>,
		worker?: (item: T, index: number) => Promise<R>,
	): Promise<R[]>;
	pipeline<T>(
		items: T[],
		...stages: Array<(value: unknown, original: T, index: number) => Promise<unknown> | unknown>
	): Promise<unknown[]>;
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
	const codexEnv = await prepareCodexFlowEnvironment(workspace, options);
	const eventSink = options.onEventLine
		? createFlowEventLineSink(options.onEventLine)
		: undefined;
	const context = createFlowContext(workspace, runPath, runId, options, state, codexEnv.env, eventSink);
	await options.onRunStart?.({ runId, runPath, summaryPath, scriptPath });
	await context.log(`flow started: ${target}`);
	await context.log(`runtime: ${options.runtime}`);
	for (const diagnostic of codexEnv.diagnostics) await context.log(diagnostic);
	if (scriptPath) await context.log(`script: ${scriptPath}`);

	let summary: unknown;
	let meta: FlowMeta | undefined;
	try {
		if (scriptPath) {
			const scripted = await runScriptFlow(scriptPath, context);
			summary = scripted.summary;
			meta = scripted.meta;
		} else {
			summary = await runAdhocFlow(context);
		}
	} catch (error) {
		await atomicWrite(
			summaryPath,
			formatFailedSummary({
				runId,
				workspace,
				options,
				target,
				scriptPath,
				meta,
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
			meta,
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

export async function listFlowRuntimes(): Promise<FlowRuntimeStatus[]> {
	if (process.env.AGENT_BOARD_FLOW_MOCK === "1") {
		return FLOW_RUNTIMES.map((runtime) => ({
			runtime,
			displayName: flowRuntimeDisplayName(runtime),
			available: true,
		}));
	}
	const { detectAvailableAgents, toAgentDisplayName } = await import("spawn-agent");
	const available = new Set(
		(detectAvailableAgents() as string[]).filter((value): value is FlowRuntime => isFlowRuntime(value)),
	);
	return FLOW_RUNTIMES.map((runtime) => ({
		runtime,
		displayName: toAgentDisplayName(runtime),
		available: available.has(runtime),
	}));
}

export async function discoverFlowModels(
	workspace: Workspace,
	runtime: FlowRuntime,
): Promise<FlowModelDiscovery> {
	validateRuntime(runtime);
	if (process.env.AGENT_BOARD_FLOW_MOCK === "1") {
		return {
			runtime,
			configs: [
				{
					configId: "model",
					name: "Model",
					category: "model",
					currentValue: "mock-default",
					choices: [
						{ value: "mock-default", name: "Mock default" },
						{ value: "mock-large", name: "Mock large" },
					],
				},
			],
		};
	}
	const codexEnv = await prepareCodexFlowEnvironment(workspace, { runtime, codexMcpMode: "isolated" });
	try {
		const { SpawnAgent, adapters } = await import("spawn-agent");
		const codexAcp = runtime === "codex"
			? resolveCodexAcpAdapter(adapters.codex, codexEnv.env)
			: undefined;
		const agent = await SpawnAgent.connect(codexAcp?.adapter ?? runtime, {
			cwd: workspace.repoPath,
			env: codexEnv.env,
			mcpServers: [],
			permission: "auto-reject",
			inactivityTimeoutMs: 30_000,
		});
		try {
			const configs = toModelConfigs(await agent.fetchConfigOptions(workspace.repoPath));
			return {
				runtime,
				configs,
				warning: configs.length ? undefined : "Runtime did not expose a model selector through ACP config options.",
			};
		} finally {
			await agent.close();
		}
	} catch (error) {
		return {
			runtime,
			configs: [],
			warning: error instanceof Error ? error.message : String(error),
		};
	}
}

export function parseCodexMcpMode(value: string): CodexMcpMode {
	if (value === "isolated" || value === "inherit") return value;
	throw new Error("Invalid Codex MCP mode. Expected one of: isolated, inherit");
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

export function parseDurationMs(value: string, name: string): number {
	const trimmed = value.trim();
	const match = /^(\d+)(ms|s|m)?$/.exec(trimmed);
	if (!match) {
		throw new Error(`${name} must be a duration like 180s, 10m, or 180000ms.`);
	}
	const amount = Number.parseInt(match[1]!, 10);
	const unit = match[2] ?? "ms";
	const multiplier = unit === "m" ? 60_000 : unit === "s" ? 1000 : 1;
	const ms = amount * multiplier;
	if (!Number.isSafeInteger(ms) || ms < 1) throw new Error(`${name} must be a positive duration.`);
	return ms;
}

export async function prepareCodexFlowEnvironment(
	workspace: Workspace,
	options: Pick<FlowRunOptions, "runtime" | "codexMcpMode">,
): Promise<{ env: Readonly<Record<string, string>>; diagnostics: string[] }> {
	if (options.runtime !== "codex") return { env: {}, diagnostics: [] };
	if (process.env.AGENT_BOARD_FLOW_MOCK === "1") {
		return {
			env: {},
			diagnostics: ["codex mcp: mock runtime, no Codex home prepared"],
		};
	}
	if (options.codexMcpMode === "inherit") {
		return {
			env: {},
			diagnostics: ["codex mcp: inheriting global Codex config"],
		};
	}

	const sourceHome = process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
	const targetHome = process.env.AGENT_BOARD_FLOW_CODEX_HOME?.trim()
		|| join(agentBoardCacheHome(), "codex-flow-home", workspace.projectSlug);
	await ensureDir(targetHome);

	const sourceAuth = join(sourceHome, "auth.json");
	const targetAuth = join(targetHome, "auth.json");
	if (existsSync(sourceAuth)) {
		await copyFile(sourceAuth, targetAuth);
		await chmod(targetAuth, 0o600).catch(() => {});
	}

	await atomicWrite(
		join(targetHome, "config.toml"),
		minimalCodexConfig(workspace.repoPath),
	);

	return {
		env: { CODEX_HOME: targetHome },
		diagnostics: [`codex mcp: isolated CODEX_HOME without global mcp_servers (${targetHome})`],
	};
}

function agentBoardCacheHome(): string {
	return process.env.AGENT_BOARD_HOME?.trim() || join(homedir(), ".agent-board");
}

function minimalCodexConfig(repoPath: string): string {
	return [
		"# Generated by agent-board for flow subagents.",
		"# Keeps Codex auth, but intentionally omits user MCP server tables to avoid",
		"# macOS Keychain prompts for Codex MCP Credentials during flow runs.",
		"",
		"[features]",
		"rmcp_client = false",
		"",
		`[projects.${tomlString(repoPath)}]`,
		`trust_level = "trusted"`,
		"",
	].join("\n");
}

function tomlString(value: string): string {
	return JSON.stringify(value);
}

// One parsed line of events.jsonl. Only the fields the watch view renders are
// typed; the writer in createFlowContext is the source of truth for the schema.
type FlowEvent = {
	ts?: string;
	type: string;
	name?: string;
	label?: string;
	phase?: string;
	mode?: string;
	model?: string;
	message?: string;
	chars?: number;
	quietMs?: number;
	timeoutMs?: number;
	streamIdleMs?: number;
	preview?: string;
	durationMs?: number;
	error?: string;
};

type FlowEventSink = (event: FlowEvent) => void | Promise<void>;

export type FlowWatchOptions = {
	// Re-read interval while the run is still streaming.
	pollMs?: number;
	// Aborting (e.g. on SIGINT) drains pending events once and returns.
	signal?: AbortSignal;
	// Sink for rendered lines; defaults to console.log.
	onLine?: (line: string) => void;
};

export type FlowWatchResult = {
	runId: string;
	runPath: string;
	// true when summary.md appeared (run finished), false when interrupted.
	finished: boolean;
};

// Read-only tail of a flow run's events.jsonl. Re-reads the whole compact file
// each poll and emits only lines it has not already rendered, so it tolerates a
// run that is appended to live as well as one that already completed. Exits when
// summary.md appears or when the abort signal fires; never mutates run state.
export async function watchFlowRun(
	workspace: Workspace,
	runId: string,
	options: FlowWatchOptions = {},
): Promise<FlowWatchResult> {
	const runPath = join(flowRunsDir(workspace), runId);
	if (!existsSync(runPath)) {
		throw new Error(`Flow run not found: ${runId}`);
	}
	const eventsPath = join(runPath, "events.jsonl");
	const summaryPath = join(runPath, "summary.md");
	const pollMs = options.pollMs ?? 200;
	const emit = options.onLine ?? ((line: string) => console.log(line));

	let consumed = 0;
	let baselineMs = Number.NaN;

	const drain = async (): Promise<void> => {
		const raw = await Bun.file(eventsPath).text().catch(() => "");
		// Only consume lines that are fully terminated, so a half-written append
		// caught mid-poll is picked up on the next pass instead of failing JSON.
		const lastNewline = raw.lastIndexOf("\n");
		if (lastNewline === -1) return;
		const lines = raw.slice(0, lastNewline + 1).split("\n").filter((line) => line.length > 0);
		for (let index = consumed; index < lines.length; index++) {
			const event = parseFlowEvent(lines[index]!);
			if (!event) continue;
			if (Number.isNaN(baselineMs) && event.ts) {
				baselineMs = Date.parse(event.ts);
			}
			const line = formatFlowEvent(event, Number.isNaN(baselineMs) ? 0 : baselineMs);
			if (line !== undefined) emit(line);
		}
		consumed = lines.length;
	};

	while (true) {
		if (options.signal?.aborted) {
			await drain();
			return { runId, runPath, finished: false };
		}
		await drain();
		if (existsSync(summaryPath)) {
			// Flush any events written just before the summary, then stop.
			await drain();
			return { runId, runPath, finished: true };
		}
		await flowWatchDelay(pollMs, options.signal);
	}
}

function parseFlowEvent(line: string): FlowEvent | undefined {
	try {
		const value = JSON.parse(line) as FlowEvent;
		return value && typeof value.type === "string" ? value : undefined;
	} catch {
		return undefined;
	}
}

function createFlowEventLineSink(
	onLine: (line: string) => void | Promise<void>,
): FlowEventSink {
	let baselineMs = Number.NaN;
	return async (event) => {
		if (Number.isNaN(baselineMs) && event.ts) {
			baselineMs = Date.parse(event.ts);
		}
		const line = formatFlowEvent(event, Number.isNaN(baselineMs) ? 0 : baselineMs);
		if (line !== undefined) await onLine(line);
	};
}

// Compact one-line render of a single event for the live watch view.
function formatFlowEvent(event: FlowEvent, baselineMs: number): string | undefined {
	const at = event.ts ? `${formatElapsed(Date.parse(event.ts) - baselineMs)} ` : "";
	const agentName = displayAgent(event.name ?? "agent", event.label, event.phase);
	if (event.type === "log") return `${at}log: ${event.message ?? ""}`;
	if (event.type === "agent_start") return `${at}${agentName}: start (${event.mode})`;
	if (event.type === "agent_delta") {
		const preview = event.preview ? `  ${event.preview}` : "";
		return `${at}${agentName}: ${event.chars ?? 0} chars${preview}`;
	}
	if (event.type === "agent_heartbeat") {
		const quiet = typeof event.quietMs === "number" && typeof event.timeoutMs === "number";
		const streamIdleMs = typeof event.streamIdleMs === "number" ? event.streamIdleMs : 0;
		const state = streamIdleMs > 0
			? `waiting, no stream ${formatDuration(streamIdleMs)}`
			: "active";
		const detail = quiet
			? `, ${state}, no text ${formatDuration(event.quietMs!)}/${formatDuration(event.timeoutMs!)}`
			: "";
		return `${at}${agentName}: working (${event.chars ?? 0} chars${detail})`;
	}
	if (event.type === "agent_finish") {
		return `${at}${agentName}: done in ${event.durationMs ?? 0}ms (${event.chars ?? 0} chars)`;
	}
	if (event.type === "agent_error") return `${at}${agentName}: error ${event.error ?? ""}`;
	return undefined;
}

function formatElapsed(ms: number): string {
	const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
	return `+${(safe / 1000).toFixed(1)}s`;
}

function formatDuration(ms: number): string {
	const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
	if (safe >= 60_000) return `${(safe / 60_000).toFixed(safe % 60_000 === 0 ? 0 : 1)}m`;
	if (safe >= 1000) return `${(safe / 1000).toFixed(safe % 1000 === 0 ? 0 : 1)}s`;
	return `${Math.round(safe)}ms`;
}

function flowWatchDelay(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal?.aborted) {
			resolve();
			return;
		}
		const timer = setTimeout(resolve, ms);
		const onAbort = () => {
			clearTimeout(timer);
			resolve();
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

function createFlowContext(
	workspace: Workspace,
	runPath: string,
	runId: string,
	options: FlowRunOptions,
	state: FlowRunState,
	codexEnv: Readonly<Record<string, string>>,
	eventSink?: FlowEventSink,
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
			model: options.model,
			concurrency: options.concurrency,
			agents: options.agents,
			agentTimeoutMs: options.agentTimeoutMs,
		},
		agent: async (prompt, agentOptions = {}) => {
			const callIndex = ++agentIndex;
			const name = agentOptions.name ?? agentOptions.label ?? `agent-${callIndex}`;
			const label = agentOptions.label;
			const phase = agentOptions.phase;
			const mode = agentOptions.mode ?? DEFAULT_FLOW_AGENT_MODE;
			const model = agentOptions.model ?? options.model;
			const effectivePrompt = agentOptions.schema
				? withStructuredOutputInstruction(prompt, agentOptions.schema)
				: prompt;
			const agentDir = join(runPath, "agents");
			const baseName = `${String(callIndex).padStart(2, "0")}-${slugify(name)}`;
			const outputPath = join(agentDir, `${baseName}.md`);
			const jsonPath = agentOptions.schema ? join(agentDir, `${baseName}.json`) : undefined;
			const started = nowIso();
			await writeEvent(runPath, "agent_start", { name, label, phase, mode, model, promptChars: effectivePrompt.length }, eventSink);
			const startedMs = Date.now();
			const diagnostics: FlowDiagnostic[] = [];
			let text = "";
			let json: unknown;
			try {
				text = await runAgentPrompt(options.runtime, effectivePrompt, {
					...agentOptions,
					mode,
					model,
					timeoutMs: agentOptions.timeoutMs ?? options.agentTimeoutMs,
					cwd: agentOptions.cwd ?? workspace.repoPath,
					env: mergeEnv(codexEnv, agentOptions.env),
					diagnostics,
					verbose: options.verbose,
					onProgress: async (event) => {
						if (event.type === "agent_delta") {
							await writeEvent(runPath, "agent_delta", {
								name,
								label,
								phase,
								chars: event.chars,
								preview: event.preview,
							}, eventSink);
						} else {
							await writeEvent(runPath, "agent_heartbeat", {
								name,
								label,
								phase,
								chars: event.chars,
								quietMs: event.quietMs,
								timeoutMs: event.timeoutMs,
								streamIdleMs: event.streamIdleMs,
							}, eventSink);
						}
					},
				});
				if (agentOptions.schema) {
					json = parseStructuredOutput(text, agentOptions.schema);
				}
			} catch (error) {
				if (text) {
					await ensureDir(agentDir);
					await atomicWrite(outputPath, formatAgentOutput(name, effectivePrompt, text));
				}
				await writeDiagnostics(runPath, name, diagnostics);
				await writeEvent(runPath, "agent_error", {
					name,
					label,
					phase,
					durationMs: Date.now() - startedMs,
					diagnostics: diagnostics.length,
					error: truncateForLog(error instanceof Error ? error.message : String(error), 300),
				}, eventSink);
				throw error;
			}
			await ensureDir(agentDir);
			if (jsonPath !== undefined) {
				await atomicWrite(jsonPath, `${JSON.stringify(json, null, 2)}\n`);
			}
			await atomicWrite(outputPath, formatAgentOutput(name, effectivePrompt, text, jsonPath));
			await writeDiagnostics(runPath, name, diagnostics);
			const result: FlowAgentResult = {
				name,
				label,
				phase,
				model,
				prompt: effectivePrompt,
				text,
				json,
				mode,
				started,
				finished: nowIso(),
				durationMs: Date.now() - startedMs,
				outputPath,
				jsonPath,
				diagnostics: diagnostics.length,
			};
			state.agents.push(result);
			await writeEvent(runPath, "agent_finish", {
				name,
				label,
				phase,
				mode,
				durationMs: result.durationMs,
				outputPath,
				jsonPath,
				chars: text.length,
				diagnostics: diagnostics.length,
			}, eventSink);
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
		pipeline: async <T>(
			items: T[],
			...stages: Array<(value: unknown, original: T, index: number) => Promise<unknown> | unknown>
		): Promise<unknown[]> => {
			let rows = items.map((original) => ({ original, value: original as unknown }));
			for (const stage of stages) {
				const values = await runLimited(
					rows.map((row, index) => async () => stage(row.value, row.original, index)),
					options.concurrency,
				);
				rows = rows.map((row, index) => ({ ...row, value: values[index] }));
			}
			return rows.map((row) => row.value);
		},
		log: async (message) => {
			await writeEvent(runPath, "log", { message }, eventSink);
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

async function runScriptFlow(
	scriptPath: string,
	context: FlowContext,
): Promise<{ summary: unknown; meta?: FlowMeta }> {
	const moduleUrl = `${pathToFileURL(scriptPath).href}?run=${Date.now()}`;
	const module = await import(moduleUrl) as { default?: unknown; flow?: unknown; meta?: unknown };
	const flow = module.default ?? module.flow;
	if (typeof flow !== "function") {
		throw new Error(`Flow script must export a default function: ${scriptPath}`);
	}
	const meta = normalizeFlowMeta(module.meta);
	if (meta?.name) await context.log(`flow meta: ${meta.name}`);
	if (meta?.phases?.length) {
		await context.log(`flow phases: ${meta.phases.map((phase) => phase.title).join(" -> ")}`);
	}
	return { summary: await flow(context), meta };
}

function normalizeFlowMeta(value: unknown): FlowMeta | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const raw = value as Record<string, unknown>;
	const meta: FlowMeta = {};
	if (typeof raw.name === "string" && raw.name.trim()) meta.name = raw.name.trim();
	if (typeof raw.description === "string" && raw.description.trim()) {
		meta.description = raw.description.trim();
	}
	if (Array.isArray(raw.phases)) {
		const phases = raw.phases
			.map((phase) => {
				if (!phase || typeof phase !== "object" || Array.isArray(phase)) return undefined;
				const p = phase as Record<string, unknown>;
				if (typeof p.title !== "string" || !p.title.trim()) return undefined;
				const normalized: { title: string; detail?: string } = { title: p.title.trim() };
				if (typeof p.detail === "string" && p.detail.trim()) normalized.detail = p.detail.trim();
				return normalized;
			})
			.filter((phase): phase is { title: string; detail?: string } => phase !== undefined);
		if (phases.length) meta.phases = phases;
	}
	return meta.name || meta.description || meta.phases?.length ? meta : undefined;
}

function displayAgent(name: string, label?: string, phase?: string): string {
	const visible = label || name;
	return phase ? `[${phase}] ${visible}` : visible;
}

function withStructuredOutputInstruction(prompt: string, schema: FlowJsonSchema): string {
	return [
		prompt,
		"",
		"STRUCTURED OUTPUT:",
		"Return ONLY valid JSON matching this JSON schema. Do not wrap it in Markdown. Do not include commentary.",
		JSON.stringify(schema, null, 2),
	].join("\n");
}

export function parseStructuredOutput(text: string, schema: FlowJsonSchema): unknown {
	const value = extractJsonValue(text);
	const errors = validateJsonValue(value, schema, "$");
	if (errors.length) {
		throw new Error(`Structured output failed schema validation: ${errors.slice(0, 8).join("; ")}`);
	}
	return value;
}

function extractJsonValue(text: string): unknown {
	const trimmed = text.trim();
	if (!trimmed) throw new Error("Structured output was empty.");
	const direct = tryParseJson(trimmed);
	if (direct.ok) return direct.value;

	const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
	if (fenced?.[1]) {
		const parsed = tryParseJson(fenced[1].trim());
		if (parsed.ok) return parsed.value;
	}

	const candidate = findFirstJsonCandidate(text);
	if (candidate !== undefined) {
		const parsed = tryParseJson(candidate);
		if (parsed.ok) return parsed.value;
	}

	throw new Error("Structured output did not contain parseable JSON.");
}

function tryParseJson(value: string): { ok: true; value: unknown } | { ok: false } {
	try {
		return { ok: true, value: JSON.parse(value) as unknown };
	} catch {
		return { ok: false };
	}
}

function findFirstJsonCandidate(text: string): string | undefined {
	const starts: number[] = [];
	for (let index = 0; index < text.length; index++) {
		const char = text[index];
		if (char === "{" || char === "[") starts.push(index);
	}
	for (const start of starts) {
		const candidate = balancedJsonSlice(text, start);
		if (candidate !== undefined) return candidate;
	}
	return undefined;
}

function balancedJsonSlice(text: string, start: number): string | undefined {
	const opener = text[start];
	const closer = opener === "{" ? "}" : "]";
	const stack: string[] = [];
	let inString = false;
	let escaped = false;
	for (let index = start; index < text.length; index++) {
		const char = text[index]!;
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (char === "\\") {
				escaped = true;
			} else if (char === "\"") {
				inString = false;
			}
			continue;
		}
		if (char === "\"") {
			inString = true;
			continue;
		}
		if (char === "{" || char === "[") {
			stack.push(char === "{" ? "}" : "]");
			continue;
		}
		if (char === "}" || char === "]") {
			if (stack.pop() !== char) return undefined;
			if (stack.length === 0) {
				const candidate = text.slice(start, index + 1);
				return candidate.endsWith(closer) ? candidate : undefined;
			}
		}
	}
	return undefined;
}

function validateJsonValue(value: unknown, schema: FlowJsonSchema, path: string): string[] {
	const errors: string[] = [];
	if (schema.enum && !schema.enum.some((item) => jsonEqual(item, value))) {
		errors.push(`${path} must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(", ")}`);
	}

	if (schema.type === "null") {
		if (value !== null) errors.push(`${path} must be null`);
		return errors;
	}
	if (schema.type === "string") {
		if (typeof value !== "string") errors.push(`${path} must be a string`);
		return errors;
	}
	if (schema.type === "boolean") {
		if (typeof value !== "boolean") errors.push(`${path} must be a boolean`);
		return errors;
	}
	if (schema.type === "number") {
		if (typeof value !== "number" || !Number.isFinite(value)) errors.push(`${path} must be a number`);
		return errors;
	}
	if (schema.type === "integer") {
		if (typeof value !== "number" || !Number.isInteger(value)) errors.push(`${path} must be an integer`);
		return errors;
	}
	if (schema.type === "array") {
		if (!Array.isArray(value)) return [`${path} must be an array`];
		if (schema.items) {
			value.forEach((item, index) => {
				errors.push(...validateJsonValue(item, schema.items!, `${path}[${index}]`));
			});
		}
		return errors;
	}
	if (schema.type === "object" || schema.properties || schema.required) {
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			return [`${path} must be an object`];
		}
		const object = value as Record<string, unknown>;
		for (const key of schema.required ?? []) {
			if (!(key in object)) errors.push(`${path}.${key} is required`);
		}
		const properties = schema.properties ?? {};
		for (const [key, propertySchema] of Object.entries(properties)) {
			if (key in object) errors.push(...validateJsonValue(object[key], propertySchema, `${path}.${key}`));
		}
		if (schema.additionalProperties === false) {
			for (const key of Object.keys(object)) {
				if (!(key in properties)) errors.push(`${path}.${key} is not allowed`);
			}
		} else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
			for (const [key, child] of Object.entries(object)) {
				if (!(key in properties)) {
					errors.push(...validateJsonValue(child, schema.additionalProperties, `${path}.${key}`));
				}
			}
		}
	}
	return errors;
}

function jsonEqual(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
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
	options: FlowAgentOptions & {
		env?: Readonly<Record<string, string>>;
		diagnostics: FlowDiagnostic[];
		verbose?: boolean;
		onProgress?: (event: FlowProgressEvent) => Promise<void> | void;
	},
): Promise<string> {
	const throttleMs = flowThrottleMs();
	let fullText = "";
	let charsSinceEmit = 0;
	let activitySinceEmit = false;
	let lastEmitMs = Date.now();
	let lastTextMs = lastEmitMs;
	let lastStreamActivityMs = lastEmitMs;
	const timeoutMs = options.timeoutMs ?? DEFAULT_FLOW_AGENT_TIMEOUT_MS;

	// Coalesce a window of stream activity into at most one compact event. Text
	// wins over activity, so a heartbeat only fires for activity with no new text
	// or for a fully idle stream that is still within the watchdog window.
	const emitProgress = async (force: boolean, idle = false): Promise<void> => {
		const now = Date.now();
		if (!force && now - lastEmitMs < throttleMs) return;
		if (charsSinceEmit > 0) {
			if (options.onProgress) {
				await options.onProgress({ type: "agent_delta", chars: fullText.length, preview: progressPreview(fullText) });
			}
			charsSinceEmit = 0;
			activitySinceEmit = false;
			lastEmitMs = now;
		} else if (activitySinceEmit || idle) {
			if (options.onProgress) {
				await options.onProgress({
					type: "agent_heartbeat",
					chars: fullText.length,
					quietMs: now - lastTextMs,
					timeoutMs,
					streamIdleMs: activitySinceEmit ? 0 : now - lastStreamActivityMs,
				});
			}
			activitySinceEmit = false;
			lastEmitMs = now;
		}
	};

	const startIdleHeartbeat = (): ReturnType<typeof setInterval> | undefined => {
		if (!options.onProgress) return undefined;
		let inFlight = false;
		return setInterval(() => {
			if (inFlight) return;
			inFlight = true;
			void emitProgress(true, true).finally(() => {
				inFlight = false;
			});
		}, flowIdleHeartbeatMs());
	};

	const drain = async (source: AsyncIterable<FlowStreamPart>): Promise<void> => {
		const idleTimer = startIdleHeartbeat();
		try {
			for await (const part of source) {
				const now = Date.now();
				lastStreamActivityMs = now;
				if (part.type === "text") {
					fullText += part.text;
					charsSinceEmit += part.text.length;
					if (part.text.length > 0) lastTextMs = now;
				} else {
					activitySinceEmit = true;
				}
				await emitProgress(false);
			}
		} finally {
			if (idleTimer) clearInterval(idleTimer);
		}
		await emitProgress(true);
	};

	if (process.env.AGENT_BOARD_FLOW_MOCK === "1") {
		await drain(mockAgentStream(runtime, options.name, prompt));
		return fullText;
	}

	if (options.model) {
		await drain(directAgentStream(runtime, prompt, {
			...options,
			timeoutMs,
		}));
		return fullText;
	}

	const [{ streamText }, { spawnAgent, adapters }] = await Promise.all([
		import("ai"),
		import("spawn-agent"),
	]);
	const agentSettings = {
		cwd: options.cwd,
		env: options.env,
		mcpServers: [],
		permission: modeToPermission(options.mode ?? DEFAULT_FLOW_AGENT_MODE),
		inactivityTimeoutMs: timeoutMs,
		onStderr: (line: string) => {
			const diagnostic = summarizeDiagnostic(line);
			if (diagnostic) options.diagnostics.push(diagnostic);
			// Stderr is runtime telemetry, not output: it never enters events.jsonl
			// as text, but it does mark the agent as alive for heartbeats.
			activitySinceEmit = true;
			lastStreamActivityMs = Date.now();
			if (options.verbose) console.error(`[${options.name ?? runtime}] ${line}`);
		},
	};
	const codexAcp = runtime === "codex"
		? resolveCodexAcpAdapter(adapters.codex, options.env)
		: undefined;
	if (codexAcp) {
		options.diagnostics.push({
			level: "info",
			message: `codex acp bin (${codexAcp.resolution.source}): ${codexAcp.resolution.path}`,
		});
	}
	const result = streamText({
		model: codexAcp
			? spawnAgent.fromAdapter(codexAcp.adapter, agentSettings)
			: spawnAgent(runtime, agentSettings),
		system: options.system ?? defaultSystemPrompt(),
		prompt,
	});
	await drain(mapAgentStream(result.fullStream));
	return fullText;
}

async function* directAgentStream(
	runtime: FlowRuntime,
	prompt: string,
	options: FlowAgentOptions & {
		env?: Readonly<Record<string, string>>;
		diagnostics: FlowDiagnostic[];
		verbose?: boolean;
		timeoutMs: number;
	},
): AsyncGenerator<FlowStreamPart> {
	const { SpawnAgent, adapters } = await import("spawn-agent");
	const codexAcp = runtime === "codex"
		? resolveCodexAcpAdapter(adapters.codex, options.env)
		: undefined;
	if (codexAcp) {
		options.diagnostics.push({
			level: "info",
			message: `codex acp bin (${codexAcp.resolution.source}): ${codexAcp.resolution.path}`,
		});
	}
	const agent = await SpawnAgent.connect(
		codexAcp?.adapter ?? runtime,
		{
			cwd: options.cwd,
			env: options.env,
			mcpServers: [],
			permission: modeToPermission(options.mode ?? DEFAULT_FLOW_AGENT_MODE),
			inactivityTimeoutMs: options.timeoutMs,
			systemPrompt: options.system ?? defaultSystemPrompt(),
			onStderr: (line: string) => {
				const diagnostic = summarizeDiagnostic(line);
				if (diagnostic) options.diagnostics.push(diagnostic);
				if (options.verbose) console.error(`[${options.name ?? runtime}] ${line}`);
			},
		},
	);
	let sessionId: Awaited<ReturnType<typeof agent.createSession>> | undefined;
	try {
		sessionId = await agent.createSession({
			cwd: options.cwd,
			mcpServers: [],
			systemPrompt: options.system ?? defaultSystemPrompt(),
		});
		const modelPreference = options.model
			? await resolveModelPreference(agent, sessionId, options.cwd, options.model)
			: undefined;
		const stream = agent.prompt(sessionId, {
			prompt,
			systemPrompt: options.system ?? defaultSystemPrompt(),
			...(modelPreference ? { modelPreference } : {}),
		});
		for await (const event of stream) {
			if (event.type === "text-delta") {
				yield { type: "text", text: event.text };
			} else if (isActivityPart(event.type)) {
				yield { type: "activity" };
			}
		}
		await stream.completion;
	} finally {
		if (sessionId) await agent.closeSession(sessionId).catch(() => {});
		await agent.close();
	}
}

async function resolveModelPreference(
	agent: {
		configOptionsFor(sessionId: unknown): readonly unknown[];
		fetchConfigOptions(cwd?: string): Promise<readonly unknown[]>;
	},
	sessionId: unknown,
	cwd: string | undefined,
	model: string,
): Promise<{ configId: string; value: string }> {
	let configs = toModelConfigs(agent.configOptionsFor(sessionId));
	if (!configs.length) configs = toModelConfigs(await agent.fetchConfigOptions(cwd));
	const config = configs[0];
	if (!config) {
		throw new Error(`Runtime did not expose a model selector through ACP config options; cannot set model ${model}.`);
	}
	return { configId: config.configId, value: model };
}

// Maps the AI SDK fullStream onto FlowStreamPart: only `text-delta` carries
// output text (so the assembled result stays byte-identical to generateText);
// reasoning/tool events become opaque activity for heartbeats; control frames
// (start/finish/step/error/etc.) are ignored.
async function* mapAgentStream(
	stream: AsyncIterable<{ type: string; text?: string }>,
): AsyncGenerator<FlowStreamPart> {
	for await (const part of stream) {
		if (part.type === "text-delta") {
			yield { type: "text", text: part.text ?? "" };
		} else if (isActivityPart(part.type)) {
			yield { type: "activity" };
		}
	}
}

function isActivityPart(type: string): boolean {
	return [
		"reasoning-delta",
		"thinking-delta",
		"tool-input-start",
		"tool-input-delta",
		"tool-call",
		"tool-call-update",
		"tool-call-cancelled",
		"tool-result",
		"tool-error",
		"plan",
		"permission-request",
		"config-options",
		"available-commands",
		"mode-changed",
		"session-info",
		"usage",
		"source",
		"file",
	].includes(type);
}

// Minimal fake stream so streaming telemetry is testable WITHOUT real Codex. The
// assembled text is byte-identical to the previous mock string. Output is split
// into many small chunks that emit fast, so the throttle coalesces dozens of
// "tokens" into a single agent_delta (proving no raw token spam).
// AGENT_BOARD_FLOW_MOCK_ACTIVITY appends spaced activity-only parts so a test can
// observe agent_heartbeat; AGENT_BOARD_FLOW_MOCK_DELAY_MS controls that spacing.
async function* mockAgentStream(
	runtime: FlowRuntime,
	name: string | undefined,
	prompt: string,
): AsyncGenerator<FlowStreamPart> {
	const text = process.env.AGENT_BOARD_FLOW_MOCK_JSON
		?? `Mock ${runtime} response from ${name ?? "agent"}.\n\n${prompt.slice(0, 600)}`;
	const chunkSize = 16;
	for (let index = 0; index < text.length; index += chunkSize) {
		yield { type: "text", text: text.slice(index, index + chunkSize) };
	}
	if (process.env.AGENT_BOARD_FLOW_MOCK_ACTIVITY === "1") {
		const beatMs = Number.parseInt(process.env.AGENT_BOARD_FLOW_MOCK_DELAY_MS ?? "0", 10) || 1;
		for (let beat = 0; beat < 2; beat++) {
			await Bun.sleep(beatMs);
			yield { type: "activity" };
		}
	}
}

// Short, single-line trailing preview for events.jsonl. Deliberately a TAIL of
// the accumulated text (never the head), so the persistent event log carries a
// hint of progress without the full output flooding it.
function progressPreview(text: string): string {
	const max = 80;
	const collapsed = text.replace(/\s+/g, " ").trim();
	if (collapsed.length <= max) return collapsed;
	return `...${collapsed.slice(collapsed.length - max)}`;
}

function mergeEnv(
	base: Readonly<Record<string, string>>,
	override?: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
	return override ? { ...base, ...override } : base;
}

// Bounded-concurrency runner. Once any task throws, `aborted` flips and the
// remaining workers stop pulling NEW tasks from the queue, so a single agent
// failure does not keep scheduling fresh agents (in-flight ones still finish
// since they cannot be force-cancelled). The original error is re-thrown so
// the caller still rejects and writes the failed summary.
export async function runLimited<T>(
	tasks: Array<() => Promise<T>>,
	limit: number,
): Promise<T[]> {
	const results = new Array<T>(tasks.length);
	let next = 0;
	let aborted = false;
	const workers = Array.from(
		{ length: Math.min(limit, tasks.length) },
		async () => {
			while (!aborted && next < tasks.length) {
				const index = next++;
				try {
					results[index] = await tasks[index]!();
				} catch (error) {
					aborted = true;
					throw error;
				}
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
	eventSink?: FlowEventSink,
): Promise<void> {
	const event = { ts: nowIso(), type, ...data } as FlowEvent;
	await appendFile(
		join(runPath, "events.jsonl"),
		`${JSON.stringify(event)}\n`,
	);
	await eventSink?.(event);
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
	meta?: FlowMeta;
	summary: string;
	agents: FlowAgentResult[];
}): string {
	const agents = input.agents
		.map((agent) => {
			const diagnostics = agent.diagnostics ? `, diagnostics: ${agent.diagnostics}` : "";
			const phase = agent.phase ? `, phase: ${agent.phase}` : "";
			const label = agent.label && agent.label !== agent.name ? `, label: ${agent.label}` : "";
			const model = agent.model ? `, model: ${agent.model}` : "";
			const json = agent.jsonPath ? `, json: ${agent.jsonPath}` : "";
			return `- ${agent.name}: ${agent.mode}${phase}${label}${model}, ${agent.durationMs}ms, output: ${agent.outputPath}${json}${diagnostics}`;
		})
		.join("\n") || "- none";
	const metaBlock = formatFlowMeta(input.meta);
	return [
		`# Flow Run ${input.runId}`,
		"",
		`- Project: ${input.workspace.projectSlug}`,
		`- Goal: ${input.workspace.goalSlug}`,
		`- Runtime: ${input.options.runtime}`,
		input.options.model ? `- Model: ${input.options.model}` : undefined,
		`- Target: ${input.target}`,
		input.scriptPath ? `- Script: ${input.scriptPath}` : undefined,
		`- Created: ${nowIso()}`,
		"",
		metaBlock,
		metaBlock ? "" : undefined,
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

function formatFlowMeta(meta?: FlowMeta): string | undefined {
	if (!meta) return undefined;
	const lines = ["## Flow Metadata", ""];
	if (meta.name) lines.push(`- Name: ${meta.name}`);
	if (meta.description) lines.push(`- Description: ${meta.description}`);
	if (meta.phases?.length) {
		lines.push("", "### Phases", "");
		for (const phase of meta.phases) {
			lines.push(`- ${phase.title}${phase.detail ? `: ${phase.detail}` : ""}`);
		}
	}
	return lines.join("\n");
}

function formatFailedSummary(input: {
	runId: string;
	workspace: Workspace;
	options: FlowRunOptions;
	target: string;
	scriptPath?: string;
	meta?: FlowMeta;
	error: unknown;
	agents: FlowAgentResult[];
}): string {
	return formatSummary({
		...input,
		summary: `Flow failed before completion.\n\nError: ${input.error instanceof Error ? input.error.message : String(input.error)}`,
	});
}

function formatAgentOutput(name: string, prompt: string, text: string, jsonPath?: string): string {
	return [
		`# ${name}`,
		"",
		"## Prompt",
		"",
		prompt,
		"",
		jsonPath ? "## Structured Output" : undefined,
		jsonPath ? "" : undefined,
		jsonPath ? `JSON: ${jsonPath}` : undefined,
		jsonPath ? "" : undefined,
		"## Output",
		"",
		text.trim() || "No output.",
		"",
	].filter((line) => line !== undefined).join("\n");
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
	if (!isFlowRuntime(value)) {
		throw new Error(`Invalid runtime. Expected one of: ${FLOW_RUNTIMES.join(", ")}`);
	}
}

function isFlowRuntime(value: string): value is FlowRuntime {
	return (FLOW_RUNTIMES as readonly string[]).includes(value);
}

function flowRuntimeDisplayName(runtime: FlowRuntime): string {
	const names: Record<FlowRuntime, string> = {
		codex: "Codex",
		claude: "Claude Code",
		cursor: "Cursor Agent",
		copilot: "GitHub Copilot CLI",
		gemini: "Gemini CLI",
		opencode: "OpenCode",
		droid: "Factory Droid",
		pi: "Pi",
	};
	return names[runtime];
}

function toModelConfigs(options: readonly unknown[]): FlowModelConfig[] {
	return options
		.filter(isModelConfigOption)
		.map((option) => ({
			configId: String(option.id),
			name: typeof option.name === "string" ? option.name : String(option.id),
			category: typeof option.category === "string" ? option.category : "",
			currentValue: typeof option.currentValue === "string" ? option.currentValue : "",
			choices: flattenModelChoices(option.options),
		}));
}

function isModelConfigOption(value: unknown): value is {
	id: unknown;
	name?: unknown;
	category?: unknown;
	currentValue?: unknown;
	options?: unknown;
} {
	if (!value || typeof value !== "object") return false;
	const option = value as Record<string, unknown>;
	if (typeof option.id !== "string") return false;
	const category = typeof option.category === "string" ? option.category : "";
	const name = typeof option.name === "string" ? option.name : "";
	return category === "model" || /model/i.test(option.id) || /model/i.test(name);
}

function flattenModelChoices(value: unknown): FlowModelChoice[] {
	if (!Array.isArray(value)) return [];
	const choices: FlowModelChoice[] = [];
	for (const item of value) {
		if (!item || typeof item !== "object") continue;
		const record = item as Record<string, unknown>;
		if (Array.isArray(record.options)) {
			const group = typeof record.name === "string" ? record.name : String(record.group ?? "");
			for (const nested of flattenModelChoices(record.options)) {
				choices.push({ ...nested, group: nested.group ?? group });
			}
			continue;
		}
		if (typeof record.value !== "string") continue;
		choices.push({
			value: record.value,
			name: typeof record.name === "string" ? record.name : record.value,
			description: typeof record.description === "string" ? record.description : undefined,
		});
	}
	return choices;
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
				brief: "Review the current changes for bugs, regressions, and unclear behavior. Do not edit files. Lead with concrete findings. End with `Verdict: pass`, `Verdict: findings`, or `Verdict: inconclusive`; use inconclusive when you could not inspect enough to make a usable call.",
			},
			{
				name: "test-auditor",
				brief: "Review test coverage for the current changes. Do not edit files. Return missing or weak tests. End with `Verdict: pass`, `Verdict: findings`, or `Verdict: inconclusive`; use inconclusive when the evidence is too thin.",
			},
			{
				name: "risk-reviewer",
				brief: "Review operational, migration, concurrency, and compatibility risks. Do not edit files. Return concrete risks only. End with `Verdict: pass`, `Verdict: findings`, or `Verdict: inconclusive`; use inconclusive when inspection was incomplete.",
			},
		], "Synthesize this into a code-review style report with findings first, then tests and next steps. Start with exactly one line: `Verdict: pass`, `Verdict: findings`, or `Verdict: inconclusive`. Use `Verdict: inconclusive` when worker outputs are missing, too thin, contradictory, runtime-limited, or otherwise do not support a usable review decision.");
	}
	if (template === "design") {
		return roleFlowTemplate(name, template, fallback, [
			{
				name: "spec-reader",
				brief: "Read the active goal/spec/tasks for a frontend or product implementation. Do not edit files. Return the durable product requirements, acceptance criteria, and decisions that must shape the design.",
			},
			{
				name: "wireframe-planner",
				brief: "Plan the design-board work before implementation. Do not edit files. Return screens, artboards, states, responsive breakpoints, and what should be mocked in an agent-board wireframe.",
			},
			{
				name: "flow-mapper",
				brief: "Map the end-to-end user flow and edge states. Do not edit files. Return navigation, empty/error/loading states, and handoff points into implementation tasks.",
			},
			{
				name: "review-gate",
				brief: "Define the pre-implementation design review gate. Do not edit files. Return what agent-board-design-review must inspect before code starts.",
			},
		], "Synthesize this into a design-first execution plan: spec updates, wireframe/design-board artifacts, optional presentation artifacts, review gates, implementation tasks, and verification. No production implementation starts before the design board and review gate are represented on the board.");
	}
	if (template === "task-graph") {
		return taskGraphFlowTemplate(name, template, fallback);
	}
	if (template === "refactor") {
		return refactorFlowTemplate(name, template, fallback);
	}
	if (template === "hygiene") {
		return roleFlowTemplate(name, template, fallback, [
			{
				name: "maintenance-reader",
				brief: "Inspect board state for stale tasks, stale claims, stale flow runs, duplicate specs, and duplicate knowledge. Do not edit files. Return only concrete cleanup candidates with ids.",
			},
			{
				name: "archive-planner",
				brief: "Plan non-destructive archive actions for superseded tasks/specs/knowledge/flow-runs. Do not edit files. Return exact archive commands with reasons and superseded-by links when known.",
			},
			{
				name: "consolidator",
				brief: "Find canonical replacements for duplicate or overlapping specs/knowledge. Do not edit files. Return what should become canonical, what should be archived, and what links need repair.",
			},
		], "Synthesize this into a board hygiene plan with safe archive commands, canonical records, follow-up tasks, and anything that should not be touched.");
	}
	if (template === "grill") {
		return roleFlowTemplate(name, template, fallback, [
			{
				name: "assumption-attacker",
				brief: "Attack the plan's hidden assumptions, scope shortcuts, and missing decisions. Do not edit files. Return blockers first.",
			},
			{
				name: "docs-staleness-reviewer",
				brief: "Identify decisions that depend on current docs, web facts, model ids, platform behavior, APIs, pricing, or release state. Do not edit files. Return what must be verified before implementation.",
			},
			{
				name: "risk-reviewer",
				brief: "Review security, migration, data, compatibility, concurrency, and rollout risks. Do not edit files. Return concrete risks and required mitigations.",
			},
			{
				name: "test-gap-reviewer",
				brief: "Review the proposed acceptance criteria and verify blocks for missing tests. Do not edit files. Return exact test gaps and suggested commands.",
			},
		], "Synthesize this into a grill report with blockers, must-verify-current-facts, follow-up tasks, accepted risks, and questions. Be adversarial but concrete.");
	}
	if (template === "safe-workflow") {
		return roleFlowTemplate(name, template, fallback, [
			{
				name: "use-case-cartographer",
				brief: "Map the requested work into durable use cases and app flows before implementation. Do not edit files. Return proposed UC ids, flow ids, actors, states, locales, acceptance criteria, and gaps in the current spec.",
			},
			{
				name: "scenario-matrix-auditor",
				brief: "Design a regression scenario matrix. Do not edit files. Return route/API/PWA/visual/native layers, stable scenario names, filename conventions, required real API coverage, and which existing scenarios must keep passing.",
			},
			{
				name: "tdd-planner",
				brief: "Plan the red-green-refactor sequence. Do not edit files. Return the first failing test, implementation slice, refactor guard, and exact verification commands.",
			},
			{
				name: "replay-gate-reviewer",
				brief: "Define the no-regression gate. Do not edit files. Return replay/e2e commands, qprobe record/replay opportunities, log/API/browser assertions, and conditions that block done.",
			},
		], "Synthesize this into a safe workflow plan: use-case ids, scenario matrix, stable selectors/test ids, TDD red-green-refactor order, e2e or qprobe replay gates, verify commands, board tasks, and blockers. Work is not shippable until existing regressions and new scenarios pass.");
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

function taskGraphFlowTemplate(name: string, template: FlowTemplate, fallback: string): string {
	return `export default async function flow({ input, agent, parallel, log }) {
	const flowName = ${JSON.stringify(name)};
	const goal = input || ${JSON.stringify(fallback)};
	await log(\`running ${template} flow for \${flowName}: \${goal}\`);

	const rawItems = goal
		.split(/\\r?\\n/)
		.map((line) => line.replace(/^[-*]\\s+/, "").trim())
		.filter(Boolean);
	const lanes = (rawItems.length > 1 ? rawItems : [
		"graph-shape",
		"dependency-order",
		"parallel-waves",
		"verification-gates",
	]).slice(0, 30);

	const results = await parallel(lanes, (lane, index) =>
		agent(
			[
				"Inspect this work lane for a deterministic agent-board task graph.",
				"Do not edit files.",
				"Return required specs, task ids or task proposals, dependencies, blockers, verification gates, and whether this lane can run in parallel.",
				"",
				"Lane " + String(index + 1) + ":",
				lane,
				"",
				"Overall goal:",
				goal,
			].join("\\n"),
			{ name: "graph-" + String(index + 1).padStart(2, "0"), mode: "read" },
		),
	);

	const findings = results
		.map((result) => "## " + result.name + "\\n\\n" + result.text.trim())
		.join("\\n\\n");

	const summary = await agent(
		[
			"Do not edit files.",
			"Synthesize a deterministic execution graph for agent-board.",
			"Include specs, tasks, dependency edges, parallel waves, max useful agent count, review gates, archive/cleanup needs, and exact next controller commands.",
			"Never mark work done from this flow alone.",
			"",
			"Goal:",
			goal,
			"",
			"Lane outputs:",
			findings,
		].join("\\n"),
		{ name: "graph-synthesizer", mode: "read" },
	);

	return summary.text;
}
`;
}

function refactorFlowTemplate(name: string, template: FlowTemplate, fallback: string): string {
	return `export default async function flow({ input, agent, parallel, log }) {
	const flowName = ${JSON.stringify(name)};
	const goal = input || ${JSON.stringify(fallback)};
	await log(\`running ${template} flow for \${flowName}: \${goal}\`);

	const candidates = goal
		.split(/\\r?\\n/)
		.map((line) => line.replace(/^[-*]\\s+/, "").trim())
		.filter((line) => line && !line.startsWith("#") && !line.includes(" "))
		.slice(0, 30);
	const targets = candidates.length ? candidates : [
		"discover-refactor-files",
		"detect-shared-contracts",
		"plan-verification",
	];

	const results = await parallel(targets, (target, index) => {
		const prompt = candidates.length
			? [
				"Inspect this single file for a deterministic refactor lane.",
				"Do not edit files.",
				"Return the exact intended change, local invariants, related tests, risks, and whether the lane can be implemented independently.",
				"",
				"File:",
				target,
				"",
				"Refactor goal:",
				goal,
			].join("\\n")
			: [
				"Inspect the repository for a deterministic per-file refactor plan.",
				"Do not edit files.",
				"Return up to 30 file paths, grouping rules, dependency constraints, tests, and which lanes should not run concurrently.",
				"",
				"Refactor goal:",
				goal,
				"",
				"Discovery lane:",
				target,
			].join("\\n");
		return agent(prompt, {
			name: candidates.length ? "file-" + String(index + 1).padStart(2, "0") : target,
			mode: "read",
		});
	});

	const findings = results
		.map((result) => "## " + result.name + "\\n\\n" + result.text.trim())
		.join("\\n\\n");

	const summary = await agent(
		[
			"Do not edit files.",
			"Synthesize a per-file refactor execution plan for agent-board.",
			"Include file lanes, dependencies, which lanes can fan out up to 30 agents, which must be serialized, tests, review gates, and next controller commands.",
			"If write execution is needed, say which explicit tasks or worktrees should receive write-mode workers.",
			"",
			"Goal:",
			goal,
			"",
			"Lane outputs:",
			findings,
		].join("\\n"),
		{ name: "refactor-synthesizer", mode: "read" },
	);

	return summary.text;
}
`;
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
