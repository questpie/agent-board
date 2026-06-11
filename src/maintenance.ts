import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { getSpec, listKnowledge, listSpecs, type AgentDocument } from "./documents.js";
import { getTask, listTasks, resolveTaskRef } from "./tasks.js";
import type { TaskFile, Workspace } from "./types.js";
import { slugify } from "./utils.js";

export interface MaintenanceOptions {
	staleAfterMs: number;
	now?: number;
}

export interface StaleClaimIssue {
	id: string;
	title: string;
	assignee: string;
	updated: string;
	ageMs: number;
}

export interface FlowRunIssue {
	id: string;
	path: string;
	status: "stale" | "failed";
	updated: string;
	ageMs: number;
	reason: string;
}

export interface BrokenLinkIssue {
	taskId: string;
	field: "depends_on" | "blocks" | "specs";
	ref: string;
	reason: string;
}

export interface DocumentGroup {
	key: string;
	items: Array<{
		scope: string;
		id: string;
		title: string;
		category: string;
		updated: string;
	}>;
}

export interface DocumentIssue {
	scope: string;
	id: string;
	title: string;
	category: string;
	updated: string;
	reason: "uncategorized" | "template-body";
}

export interface MaintenanceReport {
	project: string;
	goal: string;
	generated: string;
	staleAfterMs: number;
	staleClaims: StaleClaimIssue[];
	flowRuns: FlowRunIssue[];
	brokenLinks: BrokenLinkIssue[];
	specConsolidation: {
		duplicates: DocumentGroup[];
		needsReview: DocumentIssue[];
	};
	knowledgeConsolidation: {
		duplicates: DocumentGroup[];
		needsReview: DocumentIssue[];
	};
}

interface FlowEvent {
	ts?: string;
	type?: string;
	name?: string;
	message?: string;
	error?: string;
	[key: string]: unknown;
}

export async function buildMaintenanceReport(
	workspace: Workspace,
	options: MaintenanceOptions,
): Promise<MaintenanceReport> {
	const now = options.now ?? Date.now();
	const [tasks, specs, knowledge, flowRuns] = await Promise.all([
		listTasks(workspace),
		listSpecs(workspace),
		listKnowledge(workspace),
		findFlowRunIssues(workspace, options.staleAfterMs, now),
	]);
	return {
		project: workspace.projectSlug,
		goal: workspace.goalSlug,
		generated: new Date(now).toISOString(),
		staleAfterMs: options.staleAfterMs,
		staleClaims: findStaleClaims(tasks, options.staleAfterMs, now),
		flowRuns,
		brokenLinks: await findBrokenLinks(workspace, tasks),
		specConsolidation: findDocumentConsolidation(specs, specTemplateBody),
		knowledgeConsolidation: findDocumentConsolidation(knowledge, knowledgeTemplateBody),
	};
}

export function parseDurationMs(value: string): number {
	const match = value.trim().match(/^(\d+)(ms|s|m|h|d)?$/);
	if (!match) throw new Error(`Invalid duration: ${value}. Use values like 30m, 24h, or 7d.`);
	const amount = Number.parseInt(match[1]!, 10);
	const unit = match[2] ?? "ms";
	const multipliers: Record<string, number> = {
		ms: 1,
		s: 1000,
		m: 60 * 1000,
		h: 60 * 60 * 1000,
		d: 24 * 60 * 60 * 1000,
	};
	return amount * multipliers[unit]!;
}

function findStaleClaims(
	tasks: TaskFile[],
	staleAfterMs: number,
	now: number,
): StaleClaimIssue[] {
	return tasks
		.filter((task) => task.meta.status === "in_progress" && ageMs(task.meta.updated, now) >= staleAfterMs)
		.map((task) => ({
			id: task.meta.id,
			title: task.meta.title,
			assignee: task.meta.assignee || "-",
			updated: task.meta.updated,
			ageMs: ageMs(task.meta.updated, now),
		}))
		.sort((a, b) => b.ageMs - a.ageMs || a.id.localeCompare(b.id));
}

async function findFlowRunIssues(
	workspace: Workspace,
	staleAfterMs: number,
	now: number,
): Promise<FlowRunIssue[]> {
	const root = join(workspace.goalPath, "flows", "runs");
	const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
	const issues = await Promise.all(
		entries
			.filter((entry) => entry.isDirectory())
			.map(async (entry): Promise<FlowRunIssue | null> => {
				const path = join(root, entry.name);
				const hasSummary = existsSync(join(path, "summary.md"));
				const events = await readEvents(join(path, "events.jsonl"));
				const updatedMs = await flowRunUpdatedMs(path);
				const updated = updatedMs ? new Date(updatedMs).toISOString() : "";
				const failed = events.some(
					(event) =>
						event.type === "agent_error" ||
						(event.type === "log" && typeof event.message === "string" && event.message.startsWith("flow failed")),
				);
				if (failed) {
					return {
						id: entry.name,
						path,
						status: "failed",
						updated,
						ageMs: Math.max(0, now - updatedMs),
						reason: "event log contains an agent_error or flow failed marker",
					};
				}
				if (!hasSummary && updatedMs > 0 && now - updatedMs >= staleAfterMs) {
					return {
						id: entry.name,
						path,
						status: "stale",
						updated,
						ageMs: now - updatedMs,
						reason: "missing summary.md and no recent events",
					};
				}
				return null;
			}),
	);
	return issues
		.filter((issue): issue is FlowRunIssue => issue !== null)
		.sort((a, b) => b.ageMs - a.ageMs || a.id.localeCompare(b.id));
}

async function findBrokenLinks(
	workspace: Workspace,
	tasks: TaskFile[],
): Promise<BrokenLinkIssue[]> {
	const issues: BrokenLinkIssue[] = [];
	for (const task of tasks) {
		for (const field of ["depends_on", "blocks"] as const) {
			for (const ref of task.meta[field]) {
				const resolved = resolveTaskRef(workspace, ref);
				const target = await getTask(resolved.workspace, resolved.id).catch(() => null);
				if (!target) {
					issues.push({ taskId: task.meta.id, field, ref, reason: "target task not found" });
				}
			}
		}
		for (const ref of task.meta.specs) {
			const target = await getSpec(workspace, ref).catch(() => null);
			if (!target) {
				issues.push({ taskId: task.meta.id, field: "specs", ref, reason: "target spec not found" });
			}
		}
	}
	return issues.sort((a, b) => a.taskId.localeCompare(b.taskId) || a.field.localeCompare(b.field) || a.ref.localeCompare(b.ref));
}

function findDocumentConsolidation(
	docs: AgentDocument[],
	isTemplate: (body: string) => boolean,
): { duplicates: DocumentGroup[]; needsReview: DocumentIssue[] } {
	const byTitle = new Map<string, AgentDocument[]>();
	for (const doc of docs) {
		const key = slugify(doc.meta.title);
		byTitle.set(key, [...(byTitle.get(key) ?? []), doc]);
	}
	const duplicates = [...byTitle.entries()]
		.filter(([, group]) => group.length > 1)
		.map(([key, group]) => ({ key, items: group.map(documentSummary) }))
		.sort((a, b) => a.key.localeCompare(b.key));
	const needsReview = docs
		.flatMap((doc): DocumentIssue[] => {
			const issues: DocumentIssue[] = [];
			if (!doc.meta.category) issues.push({ ...documentSummary(doc), reason: "uncategorized" });
			if (isTemplate(doc.body)) issues.push({ ...documentSummary(doc), reason: "template-body" });
			return issues;
		})
		.sort((a, b) => a.reason.localeCompare(b.reason) || a.id.localeCompare(b.id));
	return { duplicates, needsReview };
}

function documentSummary(doc: AgentDocument): DocumentGroup["items"][number] {
	return {
		scope: doc.scope,
		id: doc.meta.id,
		title: doc.meta.title,
		category: doc.meta.category ?? "",
		updated: doc.meta.updated,
	};
}

function specTemplateBody(body: string): boolean {
	return body.includes("- TBD") || body.includes("Describe the problem and relevant constraints.");
}

function knowledgeTemplateBody(body: string): boolean {
	return /Write the (decision|note|gotcha) here\./.test(body);
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

async function flowRunUpdatedMs(runPath: string): Promise<number> {
	let updated = 0;
	for (const name of ["events.jsonl", "summary.md"]) {
		try {
			updated = Math.max(updated, (await stat(join(runPath, name))).mtimeMs);
		} catch {}
	}
	return updated;
}

function ageMs(value: string, now: number): number {
	const time = new Date(value).getTime();
	return Number.isFinite(time) ? Math.max(0, now - time) : 0;
}
