import { existsSync } from "node:fs";
import { open, readFile, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { gitState } from "./git.js";
import { parseFrontmatter, stringifyFrontmatter } from "./markdown.js";
import { PRIORITIES, STATUSES, type TaskFile, type TaskMeta, type TaskPriority, type TaskStatus, type Workspace } from "./types.js";
import { atomicWrite, listFiles, nowIso, uniqueSlug } from "./utils.js";
import { parseVerifyCommands } from "./verify.js";
import { taskDir, workspaceForGoal } from "./workspace.js";

const TASK_ORDER = [
	"id",
	"title",
	"status",
	"priority",
	"assignee",
	"branch",
	"skills",
	"specs",
	"depends_on",
	"blocks",
	"blocked_by",
	"relates_to",
	"created",
	"updated",
	"verified",
	"verified_sha",
];

export async function listTasks(workspace: Workspace): Promise<TaskFile[]> {
	const files = await listFiles(taskDir(workspace), ".md");
	const tasks = await Promise.all(files.map(readTaskFile));
	return tasks.sort((a, b) => a.meta.id.localeCompare(b.meta.id));
}

export async function createTask(
	workspace: Workspace,
	input: { title: string; status?: string; priority?: string },
): Promise<TaskFile> {
	const status = parseStatus(input.status ?? "todo");
	const priority = parsePriority(input.priority ?? "normal");
	const tasksDir = taskDir(workspace);
	const id = await uniqueSlug(tasksDir, input.title);
	const timestamp = nowIso();
	const meta: TaskMeta = {
		id,
		title: input.title,
		status,
		priority,
		assignee: "",
		branch: "",
		skills: [],
		specs: [],
		depends_on: [],
		blocks: [],
		blocked_by: [],
		relates_to: [],
		created: timestamp,
		updated: timestamp,
		verified: "",
		verified_sha: "",
	};
	const body = `## Goal\n\nDescribe the desired outcome.\n\n## Acceptance Criteria\n\n- [ ] Define success criteria.\n\n## Verify\n\n<!-- Put one shell command per line inside a sh code block. \`agent-board verify\` runs these from the repo root before done. Leave empty to skip the verify gate. -->\n`;
	const task = { path: join(tasksDir, `${id}.md`), meta, body };
	await writeTaskFile(task);
	return task;
}

export async function updateTask(
	workspace: Workspace,
	id: string,
	update: (task: TaskFile) => void,
): Promise<TaskFile> {
	const taskPath = join(taskDir(workspace), `${id}.md`);
	return withTaskLock(taskPath, async () => updateTaskUnlocked(workspace, id, update));
}

// Read-modify-write core without the task lock. Callers that already hold the
// lock for this task path (e.g. writeTaskBody) must use this to avoid a
// non-reentrant double-lock on the same path.
async function updateTaskUnlocked(
	workspace: Workspace,
	id: string,
	update: (task: TaskFile) => void,
): Promise<TaskFile> {
	const task = await getTask(workspace, id);
	update(task);
	task.meta.updated = nowIso();
	await writeTaskFile(task);
	return task;
}

export async function linkTasks(
	workspace: Workspace,
	fromRef: string,
	toRef: string,
): Promise<void> {
	const from = resolveTaskRef(workspace, fromRef);
	const to = resolveTaskRef(workspace, toRef);
	// Validate BOTH endpoints exist before any write, so a typo in the target
	// can't leave a dangling ref half-applied to the source's blocks array.
	await getTask(from.workspace, from.id);
	await getTask(to.workspace, to.id);
	await updateTask(from.workspace, from.id, (task) => {
		task.meta.blocks = unique([...task.meta.blocks, formatTaskRefFor(from.workspace, to)]);
	});
	await updateTask(to.workspace, to.id, (task) => {
		task.meta.depends_on = unique([...task.meta.depends_on, formatTaskRefFor(to.workspace, from)]);
	});
}

export async function linkTaskSpec(
	workspace: Workspace,
	taskId: string,
	specId: string,
): Promise<TaskFile> {
	return updateTask(workspace, taskId, (task) => {
		task.meta.specs = unique([...task.meta.specs, specId]);
		task.meta.relates_to = unique([...task.meta.relates_to, specId]);
	});
}

export async function unblockTask(
	workspace: Workspace,
	id: string,
): Promise<TaskFile> {
	return updateTask(workspace, id, (task) => {
		task.meta.status = "ready";
		task.meta.blocked_by = [];
	});
}

export async function getTask(
	workspace: Workspace,
	id: string,
): Promise<TaskFile> {
	const path = join(taskDir(workspace), `${id}.md`);
	if (!existsSync(path)) throw new Error(`Task not found: ${id}`);
	return readTaskFile(path);
}

export async function writeTaskBody(
	workspace: Workspace,
	id: string,
	body: string,
): Promise<TaskFile> {
	const taskPath = join(taskDir(workspace), `${id}.md`);
	return withTaskLock(taskPath, async () => updateTaskUnlocked(workspace, id, (task) => {
		const nextBody = normalizeBody(body);
		if (task.body !== nextBody) {
			task.meta.verified = "";
			task.meta.verified_sha = "";
		}
		task.body = nextBody;
	}));
}

export async function setTaskStatus(
	workspace: Workspace,
	id: string,
	status: string,
	options: { assignee?: string; blockReason?: string; force?: boolean; reason?: string } = {},
): Promise<TaskFile> {
	const taskPath = join(taskDir(workspace), `${id}.md`);
	return withTaskLock(taskPath, async () => setTaskStatusUnlocked(workspace, id, status, options));
}

// Read-modify-write core without the task lock. claimTask already holds the
// lock for this path and calls this directly to avoid a non-reentrant
// double-lock that would self-deadlock.
async function setTaskStatusUnlocked(
	workspace: Workspace,
	id: string,
	status: string,
	options: { assignee?: string; blockReason?: string; force?: boolean; reason?: string } = {},
): Promise<TaskFile> {
	const task = await getTask(workspace, id);
	const nextStatus = parseStatus(status);
	if (nextStatus === "done") {
		const uncheckedCriteria = hasUncheckedCriteria(task.body);
		const unverified = parseVerifyCommands(task.body).length > 0 && !task.meta.verified;
		if (!options.force) {
			if (uncheckedCriteria) {
				throw new Error(
					`Task ${id} still has unchecked acceptance criteria. Use --force --reason "<why>" to close anyway.`,
				);
			}
			if (unverified) {
				throw new Error(
					`Task ${id} defines verify commands but has no recorded pass. Run \`agent-board verify ${id}\`, or close with --force --reason "<why>".`,
				);
			}
		} else if (uncheckedCriteria || unverified) {
			if (!options.reason) {
				throw new Error(
					`Forcing ${id} done requires --reason "<why>" (unchecked criteria or unverified).`,
				);
			}
			const who = task.meta.assignee ? ` by ${task.meta.assignee}` : "";
			task.body = appendEvidence(
				task.body,
				`- [forced] done ${nowIso()}${who}: ${options.reason}`,
			);
		}
	}
	task.meta.status = nextStatus;
	task.meta.updated = nowIso();
	if (options.assignee !== undefined) task.meta.assignee = options.assignee;
	if (options.blockReason) {
		task.body = appendSection(task.body, "Blocker", options.blockReason);
		task.meta.blocked_by = [...task.meta.blocked_by, options.blockReason];
	}
	await writeTaskFile(task);
	return task;
}

export async function claimTask(
	workspace: Workspace,
	id: string,
	options: { agent: string; allowDetached?: boolean },
): Promise<{ task: TaskFile; warnings: string[] }> {
	const taskPath = join(taskDir(workspace), `${id}.md`);
	return withTaskLock(taskPath, async () => {
		const task = await getTask(workspace, id);
		const warnings: string[] = [];

		if (task.meta.status === "done") {
			throw new Error(`Task ${id} is already done.`);
		}
		if (task.meta.status === "blocked") {
			throw new Error(`Task ${id} is blocked. Run \`agent-board unblock ${id}\` first.`);
		}
		if (
			task.meta.status === "in_progress" &&
			task.meta.assignee &&
			task.meta.assignee !== options.agent
		) {
			throw new Error(`Task ${id} is already claimed by ${task.meta.assignee}.`);
		}

		const unmet = await unmetDependencies(workspace, task);
		if (unmet.length) {
			throw new Error(`Task ${id} has unfinished dependencies: ${unmet.join(", ")}`);
		}

		const state = await gitState(workspace.repoPath);
		if (state.isRepo) {
			if (state.detached && !options.allowDetached) {
				throw new Error(
					`Refusing to claim ${id} on a detached HEAD. Checkout a branch or pass --allow-detached.`,
				);
			}
			if (state.dirty) warnings.push("Working tree is dirty.");
			if (task.meta.branch && state.branch && state.branch !== task.meta.branch) {
				warnings.push(`On branch ${state.branch}, but task targets ${task.meta.branch}.`);
			}
		}

		const claimed = await setTaskStatusUnlocked(workspace, id, "in_progress", {
			assignee: options.agent,
		});
		return { task: claimed, warnings };
	});
}

// Mutual-exclusion lock for the claim read-check-write so two agents racing on
// the same task cannot both win. O_EXCL create fails for the loser.
async function withTaskLock<T>(taskPath: string, fn: () => Promise<T>): Promise<T> {
	const lockPath = `${taskPath}.lock`;
	const existing = await stat(lockPath).catch(() => null);
	if (existing && Date.now() - existing.mtimeMs > 30_000) {
		await unlink(lockPath).catch(() => {});
	}
	let handle: Awaited<ReturnType<typeof open>>;
	try {
		handle = await open(lockPath, "wx");
	} catch {
		throw new Error("Task is being claimed by another agent (lock held). Retry shortly.");
	}
	try {
		return await fn();
	} finally {
		await handle.close();
		await unlink(lockPath).catch(() => {});
	}
}

async function unmetDependencies(
	workspace: Workspace,
	task: TaskFile,
): Promise<string[]> {
	const unmet: string[] = [];
	for (const dep of task.meta.depends_on) {
		const ref = resolveTaskRef(workspace, dep);
		const depTask = await getTask(ref.workspace, ref.id).catch(() => null);
		if (!depTask || depTask.meta.status !== "done") unmet.push(dep);
	}
	return unmet;
}

export async function readTaskFile(path: string): Promise<TaskFile> {
	const content = await readFile(path, "utf-8");
	const doc = parseFrontmatter<Record<string, unknown>>(content);
	const meta = normalizeTaskMeta(doc.meta, path);
	return { path, meta, body: doc.body };
}

export async function writeTaskFile(task: TaskFile): Promise<void> {
	await atomicWrite(
		task.path,
		stringifyFrontmatter(task.meta as unknown as Record<string, unknown>, task.body, TASK_ORDER),
	);
}

export function parseStatus(value: string): TaskStatus {
	if (!STATUSES.includes(value as TaskStatus)) {
		throw new Error(`Invalid status "${value}". Expected one of: ${STATUSES.join(", ")}`);
	}
	return value as TaskStatus;
}

export function parsePriority(value: string): TaskPriority {
	if (!PRIORITIES.includes(value as TaskPriority)) {
		throw new Error(
			`Invalid priority "${value}". Expected one of: ${PRIORITIES.join(", ")}`,
		);
	}
	return value as TaskPriority;
}

export function pickNextTask(tasks: TaskFile[]): TaskFile | undefined {
	const weight: Record<TaskPriority, number> = { high: 3, normal: 2, low: 1 };
	return tasks
		.filter((task) => task.meta.status === "ready" || task.meta.status === "todo")
		.sort((a, b) => {
			if (a.meta.status !== b.meta.status) {
				return a.meta.status === "ready" ? -1 : 1;
			}
			return weight[b.meta.priority] - weight[a.meta.priority];
		})[0];
}

export function resolveTaskRef(
	workspace: Workspace,
	ref: string,
): { workspace: Workspace; id: string } {
	if (!ref.startsWith("task:")) return { workspace, id: ref };
	const parts = ref.slice("task:".length).split("/");
	if (parts.length !== 3 || parts.some((part) => !part)) {
		throw new Error(`Invalid task ref: ${ref}`);
	}
	const [projectSlug, goalSlug, id] = parts as [string, string, string];
	return {
		workspace: workspaceForGoal(workspace, projectSlug, goalSlug),
		id,
	};
}

export function formatTaskRefFor(
	base: Workspace,
	target: { workspace: Workspace; id: string },
): string {
	if (
		base.projectSlug === target.workspace.projectSlug &&
		base.goalSlug === target.workspace.goalSlug
	) {
		return target.id;
	}
	return `task:${target.workspace.projectSlug}/${target.workspace.goalSlug}/${target.id}`;
}

function normalizeTaskMeta(
	raw: Record<string, unknown>,
	path: string,
): TaskMeta {
	const required = ["id", "title", "status", "priority", "created", "updated"];
	for (const key of required) {
		if (typeof raw[key] !== "string" || raw[key] === "") {
			throw new Error(`Invalid task frontmatter in ${path}: missing ${key}`);
		}
	}
	return {
		id: String(raw.id),
		title: String(raw.title),
		status: parseStatus(String(raw.status)),
		priority: parsePriority(String(raw.priority)),
		assignee: typeof raw.assignee === "string" ? raw.assignee : "",
		branch: typeof raw.branch === "string" ? raw.branch : "",
		skills: arrayOfStrings(raw.skills),
		specs: arrayOfStrings(raw.specs),
		depends_on: arrayOfStrings(raw.depends_on),
		blocks: arrayOfStrings(raw.blocks),
		blocked_by: arrayOfStrings(raw.blocked_by),
		relates_to: arrayOfStrings(raw.relates_to),
		created: String(raw.created),
		updated: String(raw.updated),
		verified: typeof raw.verified === "string" ? raw.verified : "",
		verified_sha: typeof raw.verified_sha === "string" ? raw.verified_sha : "",
	};
}

function arrayOfStrings(value: unknown): string[] {
	return Array.isArray(value) ? value.map(String) : [];
}

function hasUncheckedCriteria(body: string): boolean {
	const match = /## Acceptance Criteria([\s\S]*?)(?:\n## |\n?$)/.exec(body);
	return !!match?.[1]?.match(/- \[ \]/);
}

function appendSection(body: string, title: string, value: string): string {
	return `${body.trimEnd()}\n\n## ${title}\n\n${value}\n`;
}

export function appendEvidence(body: string, entry: string): string {
	const trimmed = body.trimEnd();
	if (/(^|\n)##\s+Evidence\b/.test(trimmed)) {
		return `${trimmed}\n\n${entry}\n`;
	}
	return `${trimmed}\n\n## Evidence\n\n${entry}\n`;
}

function unique(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))];
}

function normalizeBody(body: string): string {
	return body.endsWith("\n") ? body : `${body}\n`;
}
