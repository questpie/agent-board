import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { listKnowledge, listSpecs } from "./documents.js";
import { listFlows, readFlowScript } from "./flow.js";
import { listGoals, listProjects, resolveWorkspace, workspaceForGoal } from "./workspace.js";
import { listTasks } from "./tasks.js";
import type { Workspace } from "./types.js";

export interface WebServerOptions {
	port: number;
	host: string;
	open: boolean;
}

const webDir = join(import.meta.dir, "web");

export async function startWebServer(options: WebServerOptions): Promise<void> {
	const handler = async (req: Request): Promise<Response> => {
		const url = new URL(req.url);
		try {
			if (url.pathname.startsWith("/api/")) return await handleApi(url);
			return await serveStatic(url.pathname);
		} catch (error) {
			return json({ error: error instanceof Error ? error.message : String(error) }, 500);
		}
	};

	let server: ReturnType<typeof Bun.serve>;
	try {
		server = Bun.serve({ port: options.port, hostname: options.host, fetch: handler });
	} catch (error) {
		if (!isAddrInUse(error)) throw error;
		console.warn(`Port ${options.port} is in use, picking a free port.`);
		server = Bun.serve({ port: 0, hostname: options.host, fetch: handler });
	}

	const shown = options.host === "0.0.0.0" || options.host === "::" ? "localhost" : options.host;
	const target = `http://${shown}:${server.port}`;
	console.log(`agent-board web → ${target}`);
	console.log("Read-only board viewer. Press Ctrl-C to stop.");
	if (options.open) openBrowser(target);

	await new Promise<void>((resolve) => {
		const stop = () => {
			server.stop();
			resolve();
		};
		process.on("SIGINT", stop);
		process.on("SIGTERM", stop);
	});
}

async function handleApi(url: URL): Promise<Response> {
	const projects = await listProjects();
	if (!projects.length) {
		return json({ error: "No agent-board project found. Run `agent-board init` (or `init --local` for a repo board) first.", projects: [] }, 404);
	}
	const project = url.searchParams.get("project") ?? undefined;
	const goal = url.searchParams.get("goal") ?? undefined;
	const workspace = resolveWs(projects, project, goal);

	switch (url.pathname) {
		case "/api/board":
			return json(await board(projects, workspace));
		case "/api/goals":
			return json(await goalsSummary(workspace));
		case "/api/flow-run":
			return json(await flowRun(workspace, url.searchParams.get("id")));
		case "/api/flow-run-file":
			return json(await flowRunFile(workspace, url.searchParams.get("id"), url.searchParams.get("name")));
		case "/api/flow":
			return json(await flowScript(workspace, url.searchParams.get("name")));
		default:
			return json({ error: "Not found" }, 404);
	}
}

async function board(
	projects: Array<{ slug: string; repo_path: string }>,
	workspace: Workspace,
): Promise<unknown> {
	const [goals, tasks, specs, knowledge, flows, runs] = await Promise.all([
		listGoals(workspace),
		listTasks(workspace),
		listSpecs(workspace),
		listKnowledge(workspace),
		listFlows(workspace),
		listFlowRuns(workspace),
	]);
	return {
		projects: projects.map((p) => ({ slug: p.slug, repo_path: p.repo_path })),
		current: { project: workspace.projectSlug, goal: workspace.goalSlug, repo: workspace.repoPath },
		goals: goals.map((g) => ({ id: g.id, title: g.title, active: g.active })),
		tasks: tasks.map((t) => ({ meta: t.meta, body: t.body })),
		specs: specs.map((s) => ({ scope: s.scope, meta: s.meta, body: s.body })),
		knowledge: knowledge.map((k) => ({ scope: k.scope, meta: k.meta, body: k.body })),
		flows: flows.map((f) => ({ name: f.name })),
		runs,
	};
}

const STATUSES = ["todo", "ready", "in_progress", "blocked", "review", "done"];

async function goalsSummary(workspace: Workspace): Promise<unknown> {
	const goals = await listGoals(workspace);
	const summaries = await Promise.all(
		goals.map(async (g) => {
			const gws = workspaceForGoal(workspace, workspace.projectSlug, g.id);
			const [tasks, runs] = await Promise.all([listTasks(gws), countFlowRuns(gws)]);
			const counts: Record<string, number> = {};
			for (const s of STATUSES) counts[s] = 0;
			for (const t of tasks) counts[t.meta.status] = (counts[t.meta.status] ?? 0) + 1;
			return { id: g.id, title: g.title, active: g.active, total: tasks.length, counts, runs };
		}),
	);
	return { goals: summaries };
}

async function countFlowRuns(workspace: Workspace): Promise<number> {
	const dir = join(workspace.goalPath, "flows", "runs");
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
	return entries.filter((entry) => entry.isDirectory()).length;
}

interface FlowRunSummary {
	id: string;
	updated: number;
	hasSummary: boolean;
	active: boolean;
	agents: number;
}

async function listFlowRuns(workspace: Workspace): Promise<FlowRunSummary[]> {
	const dir = join(workspace.goalPath, "flows", "runs");
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
	const runs = await Promise.all(
		entries
			.filter((entry) => entry.isDirectory())
			.map(async (entry) => {
				const runPath = join(dir, entry.name);
				const hasSummary = existsSync(join(runPath, "summary.md"));
				const events = await readEvents(join(runPath, "events.jsonl"));
				const agents = deriveAgents(events);
				const active = !hasSummary && agents.some((a) => a.status === "running");
				let updated = 0;
				try {
					updated = (await stat(join(runPath, "events.jsonl"))).mtimeMs;
				} catch {}
				return { id: entry.name, updated, hasSummary, active, agents: agents.length };
			}),
	);
	return runs.sort((a, b) => b.id.localeCompare(a.id));
}

async function flowRun(workspace: Workspace, idParam: string | null): Promise<unknown> {
	const id = safeName(idParam);
	const dir = join(workspace.goalPath, "flows", "runs", id);
	if (!existsSync(dir)) throw new Error(`Flow run not found: ${id}`);
	const events = await readEvents(join(dir, "events.jsonl"));
	const summary = await readFile(join(dir, "summary.md"), "utf-8").catch(() => "");
	const agentDir = join(dir, "agents");
	const agentFiles = (await readdir(agentDir).catch(() => []))
		.filter((name) => name.endsWith(".md"))
		.sort();
	return { id, summary, events, agents: deriveAgents(events), agentFiles };
}

async function flowRunFile(
	workspace: Workspace,
	idParam: string | null,
	nameParam: string | null,
): Promise<unknown> {
	const id = safeName(idParam);
	const name = basename(String(nameParam ?? ""));
	if (!name || name.includes("/") || name.includes("..")) throw new Error("Invalid file name");
	const path = join(workspace.goalPath, "flows", "runs", id, "agents", name);
	const content = await readFile(path, "utf-8").catch(() => {
		throw new Error(`Agent output not found: ${name}`);
	});
	return { name, content };
}

async function flowScript(workspace: Workspace, nameParam: string | null): Promise<unknown> {
	const name = String(nameParam ?? "");
	if (!name) throw new Error("Missing flow name");
	const script = await readFlowScript(workspace, name);
	return { name: script.name, body: script.body };
}

interface FlowEvent {
	ts?: string;
	type?: string;
	name?: string;
	message?: string;
	chars?: number;
	preview?: string;
	mode?: string;
	[key: string]: unknown;
}

interface AgentState {
	name: string;
	mode?: string;
	status: "running" | "done" | "error";
	chars: number;
	preview?: string;
	started?: string;
	finished?: string;
	error?: string;
}

async function readEvents(path: string): Promise<FlowEvent[]> {
	const raw = await readFile(path, "utf-8").catch(() => "");
	const events: FlowEvent[] = [];
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			events.push(JSON.parse(trimmed) as FlowEvent);
		} catch {}
	}
	return events;
}

function deriveAgents(events: FlowEvent[]): AgentState[] {
	const map = new Map<string, AgentState>();
	const order: string[] = [];
	const ensure = (name: string): AgentState => {
		let agent = map.get(name);
		if (!agent) {
			agent = { name, status: "running", chars: 0 };
			map.set(name, agent);
			order.push(name);
		}
		return agent;
	};
	for (const event of events) {
		const name = typeof event.name === "string" ? event.name : undefined;
		if (!name) continue;
		const agent = ensure(name);
		switch (event.type) {
			case "agent_start":
				agent.status = "running";
				agent.mode = typeof event.mode === "string" ? event.mode : agent.mode;
				agent.started = event.ts ?? agent.started;
				break;
			case "agent_delta":
				if (typeof event.chars === "number") agent.chars = event.chars;
				if (typeof event.preview === "string") agent.preview = event.preview;
				break;
			case "agent_heartbeat":
				if (typeof event.chars === "number") agent.chars = event.chars;
				break;
			case "agent_finish":
				agent.status = "done";
				agent.finished = event.ts ?? agent.finished;
				if (typeof event.chars === "number") agent.chars = event.chars;
				break;
			case "agent_error":
				agent.status = "error";
				agent.finished = event.ts ?? agent.finished;
				agent.error = typeof event.message === "string" ? event.message : agent.error;
				break;
		}
	}
	return order.map((name) => map.get(name)!);
}

function resolveWs(
	projects: Array<{ slug: string; repo_path: string }>,
	projectSlug?: string,
	goalSlug?: string,
): Workspace {
	if (projectSlug) {
		const match = projects.find((p) => p.slug === projectSlug);
		const cwd = match?.repo_path ?? process.cwd();
		try {
			return resolveWorkspace(cwd, { projectSlug, goalSlug });
		} catch {
			return resolveWorkspace(cwd, { projectSlug });
		}
	}
	try {
		return resolveWorkspace(process.cwd(), { goalSlug });
	} catch {}
	const first = projects[0]!;
	return resolveWorkspace(first.repo_path, { projectSlug: first.slug });
}

const CONTENT_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".svg": "image/svg+xml",
};

async function serveStatic(pathname: string): Promise<Response> {
	const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
	if (rel.includes("..")) return new Response("Not found", { status: 404 });
	const path = join(webDir, rel);
	const file = Bun.file(path);
	if (!(await file.exists())) return new Response("Not found", { status: 404 });
	const ext = rel.slice(rel.lastIndexOf("."));
	const type = CONTENT_TYPES[ext];
	return new Response(file, type ? { headers: { "content-type": type } } : undefined);
}

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
	});
}

function safeName(value: string | null): string {
	const name = basename(String(value ?? "")).replace(/[^a-zA-Z0-9._-]/g, "");
	if (!name) throw new Error("Missing or invalid id");
	return name;
}

function isAddrInUse(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes("EADDRINUSE") || message.includes("address already in use") || message.includes("in use");
}

function openBrowser(url: string): void {
	const command =
		process.platform === "darwin"
			? ["open", url]
			: process.platform === "win32"
				? ["cmd", "/c", "start", "", url]
				: ["xdg-open", url];
	try {
		Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
	} catch {}
}
