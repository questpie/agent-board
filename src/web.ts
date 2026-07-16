import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { listKnowledge, listSpecs } from "./documents.js";
import { listFlows, readFlowScript } from "./flow.js";
import { listGoals, listProjects, resolveWorkspace, workspaceForGoal } from "./workspace.js";
import { listTasks } from "./tasks.js";
import type { Workspace } from "./types.js";
import { editWireframeNode, listWireframeAssets, listWireframes, saveWireframeAsset, wireframeAsset, wireframeWebPath } from "./wireframes.js";
import { parseShareKind, readShareIndex, removeShare, shareArtifact, shareKey } from "./share.js";

export interface WebServerOptions {
	port: number;
	host: string;
	open: boolean;
}

const webDir = join(import.meta.dir, "web");

export async function startWebServer(options: WebServerOptions): Promise<void> {
	let server!: ReturnType<typeof Bun.serve>;
	const handler = async (req: Request): Promise<Response> => {
		const url = new URL(req.url);
		try {
			if (req.method === "POST" && url.pathname === "/api/share") return await handleShare(req, url, server);
			if (req.method === "DELETE" && url.pathname === "/api/share") return await handleUnshare(req, url, server);
			if (req.method === "PUT" && url.pathname === "/api/wireframe/edit") return await handleWireframeEdit(req, url, server);
			if (req.method === "GET" && url.pathname === "/api/wireframe/assets") return await handleWireframeAssets(url);
			if (req.method === "POST" && url.pathname === "/api/wireframe/asset") return await handleWireframeAssetUpload(req, url, server);
			if (url.pathname.startsWith("/api/")) return await handleApi(url);
			if (url.pathname.startsWith("/wireframes/")) return await handleWireframeAsset(url);
			return await serveStatic(url.pathname);
		} catch (error) {
			return json({ error: error instanceof Error ? error.message : String(error) }, 500);
		}
	};

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
	const wireframes = await listWireframes(workspace);
	const shares = await readShareIndex(workspace);
	const sharedFor = (kind: "design" | "spec" | "task" | "knowledge", scope: string, id: string) => {
		const record = shares[shareKey(kind, scope, id)];
		return record ? { url: record.url, gistUrl: record.gistUrl, sharedAt: record.sharedAt } : null;
	};
	const goalSummaries = await Promise.all(
		goals.map(async (g) => ({ id: g.id, title: g.title, active: g.active, updated: await goalUpdatedMs(g.path) })),
	);
	return {
		projects: projects.map((p) => ({ slug: p.slug, repo_path: p.repo_path })),
		current: { project: workspace.projectSlug, goal: workspace.goalSlug, repo: workspace.repoPath },
		goals: goalSummaries,
		tasks: tasks.map((t) => ({ meta: t.meta, body: t.body, shared: sharedFor("task", workspace.goalSlug, t.meta.id) })),
		specs: specs.map((s) => ({ scope: s.scope, meta: s.meta, body: s.body, shared: sharedFor("spec", s.scope, s.meta.id) })),
		knowledge: knowledge.map((k) => ({ scope: k.scope, meta: k.meta, body: k.body, shared: sharedFor("knowledge", k.scope, k.meta.id) })),
		wireframes: wireframes.map((w) => ({ scope: w.scope, meta: w.meta, body: w.body, url: wireframeWebPath(workspace, w), shared: sharedFor("design", w.scope, w.meta.id) })),
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
			const updated = latestIso(tasks.map((task) => task.meta.updated)) ?? await goalUpdatedIso(g.path);
			return { id: g.id, title: g.title, active: g.active, total: tasks.length, counts, runs, updated };
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
	status: FlowRunStatus;
	agents: number;
	runningAgents: number;
	errorAgents: number;
	preview?: string;
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
				const updated = await flowRunUpdatedMs(runPath);
				const state = deriveFlowRunState({ agents, events, hasSummary, updated });
				return {
					id: entry.name,
					updated,
					hasSummary,
					active: state.active,
					status: state.status,
					agents: agents.length,
					runningAgents: state.runningAgents,
					errorAgents: state.errorAgents,
					preview: latestAgentPreview(agents),
				};
			}),
	);
	return runs.sort((a, b) => b.updated - a.updated || b.id.localeCompare(a.id));
}

async function flowRun(workspace: Workspace, idParam: string | null): Promise<unknown> {
	const id = safeName(idParam);
	const dir = join(workspace.goalPath, "flows", "runs", id);
	if (!existsSync(dir)) throw new Error(`Flow run not found: ${id}`);
	const events = await readEvents(join(dir, "events.jsonl"));
	const summary = await readFile(join(dir, "summary.md"), "utf-8").catch(() => "");
	const hasSummary = summary.length > 0;
	const agents = deriveAgents(events);
	const updated = await flowRunUpdatedMs(dir);
	const state = deriveFlowRunState({ agents, events, hasSummary, updated });
	const agentDir = join(dir, "agents");
	const agentFiles = (await readdir(agentDir).catch(() => []))
		.filter((name) => name.endsWith(".md"))
		.sort();
	return { id, summary, events, agents, agentFiles, updated, hasSummary, preview: latestAgentPreview(agents), ...state };
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
	lastActivity?: string;
	error?: string;
}

type FlowRunStatus = "running" | "stale" | "stopped" | "done" | "error";

interface FlowRunState {
	status: FlowRunStatus;
	active: boolean;
	runningAgents: number;
	errorAgents: number;
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
		agent.lastActivity = event.ts ?? agent.lastActivity;
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
				agent.error =
					typeof event.message === "string"
						? event.message
						: typeof event.error === "string"
							? event.error
							: agent.error;
				break;
		}
	}
	return order.map((name) => map.get(name)!);
}

async function flowRunUpdatedMs(runPath: string): Promise<number> {
	let updated = 0;
	for (const name of ["events.jsonl", "summary.md"]) {
		try {
			updated = Math.max(updated, (await stat(join(runPath, name))).mtimeMs);
		} catch {}
	}
	return updated;
}

async function goalUpdatedMs(goalPath: string): Promise<number> {
	try {
		return (await stat(join(goalPath, "goal.md"))).mtimeMs;
	} catch {
		return 0;
	}
}

async function goalUpdatedIso(goalPath: string): Promise<string> {
	const updated = await goalUpdatedMs(goalPath);
	return updated ? new Date(updated).toISOString() : "";
}

function latestIso(values: string[]): string | undefined {
	return values
		.filter(Boolean)
		.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
}

function latestAgentPreview(agents: AgentState[]): string | undefined {
	const withPreview = agents
		.filter((agent) => agent.preview)
		.sort((a, b) => new Date(b.lastActivity ?? b.started ?? 0).getTime() - new Date(a.lastActivity ?? a.started ?? 0).getTime());
	return withPreview[0]?.preview;
}

function deriveFlowRunState(input: {
	agents: AgentState[];
	events: FlowEvent[];
	hasSummary: boolean;
	updated: number;
	now?: number;
}): FlowRunState {
	const runningAgents = input.agents.filter((agent) => agent.status === "running").length;
	const errorAgents = input.agents.filter((agent) => agent.status === "error").length;
	const hasFailure =
		errorAgents > 0 ||
		input.events.some((event) => event.type === "log" && typeof event.message === "string" && event.message.startsWith("flow failed"));
	if (hasFailure) return { status: "error", active: false, runningAgents, errorAgents };
	if (input.hasSummary) return { status: "done", active: false, runningAgents, errorAgents };

	const now = input.now ?? Date.now();
	const recentlyUpdated = input.updated > 0 && now - input.updated <= flowRunStaleMs();
	if (runningAgents > 0) {
		const status = recentlyUpdated ? "running" : "stale";
		return { status, active: status === "running", runningAgents, errorAgents };
	}
	if (recentlyUpdated && input.events.length > 0) {
		return { status: "running", active: true, runningAgents, errorAgents };
	}
	return { status: "stopped", active: false, runningAgents, errorAgents };
}

function flowRunStaleMs(): number {
	const fallback = 10 * 60 * 1000;
	const raw = process.env.AGENT_BOARD_FLOW_STALE_MS;
	if (raw === undefined) return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
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

// The board's only mutating endpoint: publish one artifact as a secret gist.
// Gated to loopback clients so binding `--host 0.0.0.0` can't let a LAN peer
// create gists on the host's GitHub account.
async function handleShare(
	req: Request,
	url: URL,
	server: ReturnType<typeof Bun.serve>,
): Promise<Response> {
	const peer = server.requestIP(req);
	if (peer && !isLoopback(peer.address)) {
		return json({ error: "Sharing is only available from localhost." }, 403);
	}
	const projects = await listProjects();
	if (!projects.length) return json({ error: "No agent-board project found." }, 404);
	const workspace = resolveWs(
		projects,
		url.searchParams.get("project") ?? undefined,
		url.searchParams.get("goal") ?? undefined,
	);
	let payload: { kind?: unknown; id?: unknown };
	try {
		payload = (await req.json()) as { kind?: unknown; id?: unknown };
	} catch {
		return json({ error: "Invalid JSON body." }, 400);
	}
	const id = typeof payload.id === "string" ? payload.id.trim() : "";
	if (!id) return json({ error: "Missing artifact id." }, 400);
	const kind = parseShareKind(String(payload.kind ?? ""));
	return json(await shareArtifact(workspace, kind, id));
}

// Revoke a share: delete the backing gist and drop it from the index. Also
// loopback-only — same reasoning as handleShare.
async function handleUnshare(
	req: Request,
	url: URL,
	server: ReturnType<typeof Bun.serve>,
): Promise<Response> {
	const peer = server.requestIP(req);
	if (peer && !isLoopback(peer.address)) {
		return json({ error: "Sharing is only available from localhost." }, 403);
	}
	const projects = await listProjects();
	if (!projects.length) return json({ error: "No agent-board project found." }, 404);
	const workspace = resolveWs(
		projects,
		url.searchParams.get("project") ?? undefined,
		url.searchParams.get("goal") ?? undefined,
	);
	const id = (url.searchParams.get("id") ?? "").trim();
	if (!id) return json({ error: "Missing artifact id." }, 400);
	const kind = parseShareKind(String(url.searchParams.get("kind") ?? ""));
	return json(await removeShare(workspace, kind, id));
}

// Apply one inline wireframe edit (text/image) to the bundle's source HTML.
// Loopback-only, like sharing — binding 0.0.0.0 must not let a LAN peer rewrite
// the host's design files.
async function handleWireframeEdit(
	req: Request,
	url: URL,
	server: ReturnType<typeof Bun.serve>,
): Promise<Response> {
	const peer = server.requestIP(req);
	if (peer && !isLoopback(peer.address)) {
		return json({ error: "Editing is only available from localhost." }, 403);
	}
	const projects = await listProjects();
	if (!projects.length) return json({ error: "No agent-board project found." }, 404);
	const workspace = resolveWs(
		projects,
		url.searchParams.get("project") ?? undefined,
		url.searchParams.get("goal") ?? undefined,
	);
	let payload: { scope?: unknown; id?: unknown; entry?: unknown; screen?: unknown; key?: unknown; kind?: unknown; value?: unknown; html?: unknown };
	try {
		payload = (await req.json()) as typeof payload;
	} catch {
		return json({ error: "Invalid JSON body." }, 400);
	}
	const kind = payload.kind === "image" ? "image" : payload.kind === "text" ? "text" : payload.kind === "layout" ? "layout" : null;
	if (!kind) return json({ error: 'Invalid "kind" (expected "text", "image", or "layout").' }, 400);
	try {
		const result = await editWireframeNode(
			workspace,
			parseOverlayScope(String(payload.scope ?? "")),
			safeName(typeof payload.id === "string" ? payload.id : null),
			{
				entry: typeof payload.entry === "string" ? payload.entry : undefined,
				screen: String(payload.screen ?? ""),
				key: typeof payload.key === "string" ? payload.key : undefined,
				kind,
				value: typeof payload.value === "string" ? payload.value : undefined,
				html: typeof payload.html === "string" ? payload.html : undefined,
			},
		);
		return json({ ok: true, ...result });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, 400);
	}
}

// List a board's media (read-only; the assets are served anyway).
async function handleWireframeAssets(url: URL): Promise<Response> {
	const projects = await listProjects();
	if (!projects.length) return json({ error: "No agent-board project found." }, 404);
	const workspace = resolveWs(
		projects,
		url.searchParams.get("project") ?? undefined,
		url.searchParams.get("goal") ?? undefined,
	);
	const assets = await listWireframeAssets(
		workspace,
		parseOverlayScope(url.searchParams.get("scope") ?? ""),
		safeName(url.searchParams.get("id")),
	);
	return json({ assets });
}

// Upload an image into a board's assets/ store. Loopback-only, like editing.
async function handleWireframeAssetUpload(
	req: Request,
	url: URL,
	server: ReturnType<typeof Bun.serve>,
): Promise<Response> {
	const peer = server.requestIP(req);
	if (peer && !isLoopback(peer.address)) {
		return json({ error: "Uploads are only available from localhost." }, 403);
	}
	const projects = await listProjects();
	if (!projects.length) return json({ error: "No agent-board project found." }, 404);
	const workspace = resolveWs(
		projects,
		url.searchParams.get("project") ?? undefined,
		url.searchParams.get("goal") ?? undefined,
	);
	const buf = await req.arrayBuffer();
	if (buf.byteLength > 8 * 1024 * 1024) return json({ error: "File too large (max 8MB)." }, 413);
	try {
		const result = await saveWireframeAsset(
			workspace,
			parseOverlayScope(url.searchParams.get("scope") ?? ""),
			safeName(url.searchParams.get("id")),
			url.searchParams.get("name") ?? "image.png",
			new Uint8Array(buf),
		);
		return json({ ok: true, ...result });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, 400);
	}
}

function isLoopback(address: string): boolean {
	return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
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

async function handleWireframeAsset(url: URL): Promise<Response> {
	const projects = await listProjects();
	const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
	const [, project, goal, scope, id, ...assetParts] = parts;
	if (!project || !goal || !scope || !id) return new Response("Not found", { status: 404 });
	const workspace = resolveWs(projects, project, goal);
	const asset = await wireframeAsset(workspace, parseOverlayScope(scope), safeName(id), assetParts.join("/") || undefined);
	const file = Bun.file(asset.path);
	if (!(await file.exists())) return new Response("Not found", { status: 404 });
	return new Response(file, asset.type ? { headers: { "content-type": asset.type } } : undefined);
}

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
	});
}

function parseOverlayScope(value: string): "global" | "project" | "goal" {
	if (value === "global" || value === "project" || value === "goal") return value;
	throw new Error('Invalid scope. Expected "global", "project", or "goal".');
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
