import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter, stringifyFrontmatter } from "./markdown.js";
import { PRIORITIES, STATUSES, type TaskFile, type TaskMeta, type TaskPriority, type TaskStatus, type Workspace } from "./types.js";
import { listFiles, nowIso, uniqueSlug } from "./utils.js";
import { taskDir, workspaceForGoal } from "./workspace.js";

const TASK_ORDER = [
	"id",
	"title",
	"status",
	"priority",
	"assignee",
	"workflow",
	"skills",
	"specs",
	"depends_on",
	"blocks",
	"blocked_by",
	"relates_to",
	"created",
	"updated",
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
		workflow: "",
		skills: [],
		specs: [],
		depends_on: [],
		blocks: [],
		blocked_by: [],
		relates_to: [],
		created: timestamp,
		updated: timestamp,
	};
	const body = `## Goal\n\nDescribe the desired outcome.\n\n## Acceptance Criteria\n\n- [ ] Define success criteria.\n`;
	const task = { path: join(tasksDir, `${id}.md`), meta, body };
	await writeTaskFile(task);
	return task;
}

export async function updateTask(
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

export async function setTaskStatus(
	workspace: Workspace,
	id: string,
	status: string,
	options: { assignee?: string; blockReason?: string; force?: boolean } = {},
): Promise<TaskFile> {
	const task = await getTask(workspace, id);
	const nextStatus = parseStatus(status);
	if (nextStatus === "done" && !options.force && hasUncheckedCriteria(task.body)) {
		throw new Error(
			`Task ${id} still has unchecked acceptance criteria. Use --force to close anyway.`,
		);
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

export async function readTaskFile(path: string): Promise<TaskFile> {
	const content = await readFile(path, "utf-8");
	const doc = parseFrontmatter<Record<string, unknown>>(content);
	const meta = normalizeTaskMeta(doc.meta, path);
	return { path, meta, body: doc.body };
}

export async function writeTaskFile(task: TaskFile): Promise<void> {
	await writeFile(
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
		workflow: typeof raw.workflow === "string" ? raw.workflow : "",
		skills: arrayOfStrings(raw.skills),
		specs: arrayOfStrings(raw.specs),
		depends_on: arrayOfStrings(raw.depends_on),
		blocks: arrayOfStrings(raw.blocks),
		blocked_by: arrayOfStrings(raw.blocked_by),
		relates_to: arrayOfStrings(raw.relates_to),
		created: String(raw.created),
		updated: String(raw.updated),
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

function unique(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))];
}
