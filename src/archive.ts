import { existsSync } from "node:fs";
import { readFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
	archiveKnowledge,
	archiveSpec,
	isDocumentArchived,
	listKnowledge,
	listSpecs,
	restoreKnowledge,
	restoreSpec,
	type AgentDocument,
} from "./documents.js";
import { archiveTask, isTaskArchived, listTasks, restoreTask, type ArchiveOptions as TaskArchiveOptions } from "./tasks.js";
import type { Workspace } from "./types.js";
import { atomicWrite, nowIso } from "./utils.js";

export type ArchiveKind = "task" | "spec" | "knowledge" | "flow-run";

export interface ArchiveOptions {
	reason: string;
	supersededBy?: string;
}

export interface ArchivedRecord {
	kind: ArchiveKind;
	scope: string;
	id: string;
	title: string;
	archivedAt: string;
	reason: string;
	supersededBy: string;
	path: string;
}

interface FlowRunArchiveMarker {
	kind: "flow-run";
	id: string;
	archived: true;
	archived_at: string;
	archived_reason: string;
	superseded_by?: string;
}

export async function archiveRecord(
	workspace: Workspace,
	kind: ArchiveKind,
	id: string,
	options: ArchiveOptions,
): Promise<ArchivedRecord> {
	if (kind === "task") {
		const task = await archiveTask(workspace, id, taskArchiveOptions(options));
		return {
			kind,
			scope: "goal",
			id: task.meta.id,
			title: task.meta.title,
			archivedAt: task.meta.archived_at ?? "",
			reason: task.meta.archived_reason ?? "",
			supersededBy: task.meta.superseded_by ?? "",
			path: task.path,
		};
	}
	if (kind === "spec") return docArchivedRecord(kind, await archiveSpec(workspace, id, options));
	if (kind === "knowledge") return docArchivedRecord(kind, await archiveKnowledge(workspace, id, options));
	return archiveFlowRun(workspace, id, options);
}

export async function restoreArchivedRecord(
	workspace: Workspace,
	kind: ArchiveKind,
	id: string,
): Promise<{ kind: ArchiveKind; id: string; path: string }> {
	if (kind === "task") {
		const task = await restoreTask(workspace, id);
		return { kind, id: task.meta.id, path: task.path };
	}
	if (kind === "spec") {
		const doc = await restoreSpec(workspace, id);
		return { kind, id: doc.meta.id, path: doc.path };
	}
	if (kind === "knowledge") {
		const doc = await restoreKnowledge(workspace, id);
		return { kind, id: doc.meta.id, path: doc.path };
	}
	const path = flowRunArchivePath(workspace, id);
	if (!existsSync(path)) throw new Error(`Flow run is not archived: ${id}`);
	await unlink(path);
	return { kind, id, path: flowRunPath(workspace, id) };
}

export async function listArchivedRecords(
	workspace: Workspace,
	kind?: ArchiveKind,
): Promise<ArchivedRecord[]> {
	const groups: ArchivedRecord[][] = [];
	if (!kind || kind === "task") {
		const tasks = await listTasks(workspace, { includeArchived: true });
		groups.push(
			tasks
				.filter(isTaskArchived)
				.map((task) => ({
					kind: "task",
					scope: "goal",
					id: task.meta.id,
					title: task.meta.title,
					archivedAt: task.meta.archived_at ?? "",
					reason: task.meta.archived_reason ?? "",
					supersededBy: task.meta.superseded_by ?? "",
					path: task.path,
				})),
		);
	}
	if (!kind || kind === "spec") {
		const specs = await listSpecs(workspace, undefined, { includeArchived: true });
		groups.push(specs.filter(isDocumentArchived).map((doc) => docArchivedRecord("spec", doc)));
	}
	if (!kind || kind === "knowledge") {
		const knowledge = await listKnowledge(workspace, undefined, { includeArchived: true });
		groups.push(knowledge.filter(isDocumentArchived).map((doc) => docArchivedRecord("knowledge", doc)));
	}
	if (!kind || kind === "flow-run") {
		groups.push(await listArchivedFlowRuns(workspace));
	}
	return groups
		.flat()
		.sort((a, b) => a.kind.localeCompare(b.kind) || a.scope.localeCompare(b.scope) || a.id.localeCompare(b.id));
}

export function parseArchiveKind(value: string): ArchiveKind {
	if (value === "task" || value === "spec" || value === "knowledge" || value === "flow-run") return value;
	throw new Error("Invalid archive kind. Expected one of: task, spec, knowledge, flow-run");
}

export function isFlowRunArchived(workspace: Workspace, id: string): boolean {
	return existsSync(flowRunArchivePath(workspace, id));
}

async function archiveFlowRun(
	workspace: Workspace,
	id: string,
	options: ArchiveOptions,
): Promise<ArchivedRecord> {
	const dir = flowRunPath(workspace, id);
	if (!existsSync(dir)) throw new Error(`Flow run not found: ${id}`);
	const reason = normalizeArchiveReason(options.reason);
	const marker: FlowRunArchiveMarker = {
		kind: "flow-run",
		id,
		archived: true,
		archived_at: nowIso(),
		archived_reason: reason,
		superseded_by: options.supersededBy?.trim() || undefined,
	};
	await atomicWrite(flowRunArchivePath(workspace, id), `${JSON.stringify(marker, null, 2)}\n`);
	return {
		kind: "flow-run",
		scope: "goal",
		id,
		title: id,
		archivedAt: marker.archived_at,
		reason,
		supersededBy: marker.superseded_by ?? "",
		path: dir,
	};
}

async function listArchivedFlowRuns(workspace: Workspace): Promise<ArchivedRecord[]> {
	const root = join(workspace.goalPath, "flows", "runs");
	const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
	const records = await Promise.all(
		entries
			.filter((entry) => entry.isDirectory())
			.map(async (entry): Promise<ArchivedRecord | null> => {
				const path = flowRunArchivePath(workspace, entry.name);
				const raw = await readFile(path, "utf-8").catch(() => "");
				if (!raw) return null;
				const marker = JSON.parse(raw) as Partial<FlowRunArchiveMarker>;
				if (marker.archived !== true) return null;
				return {
					kind: "flow-run",
					scope: "goal",
					id: entry.name,
					title: entry.name,
					archivedAt: marker.archived_at ?? "",
					reason: marker.archived_reason ?? "",
					supersededBy: marker.superseded_by ?? "",
					path: flowRunPath(workspace, entry.name),
				};
			}),
	);
	return records.filter((record): record is ArchivedRecord => record !== null);
}

function docArchivedRecord(kind: "spec" | "knowledge", doc: AgentDocument): ArchivedRecord {
	return {
		kind,
		scope: doc.scope,
		id: doc.meta.id,
		title: doc.meta.title,
		archivedAt: doc.meta.archived_at ?? "",
		reason: doc.meta.archived_reason ?? "",
		supersededBy: doc.meta.superseded_by ?? "",
		path: doc.path,
	};
}

function taskArchiveOptions(options: ArchiveOptions): TaskArchiveOptions {
	return {
		reason: options.reason,
		supersededBy: options.supersededBy,
	};
}

function flowRunPath(workspace: Workspace, id: string): string {
	return join(workspace.goalPath, "flows", "runs", id);
}

function flowRunArchivePath(workspace: Workspace, id: string): string {
	return join(flowRunPath(workspace, id), "archive.json");
}

function normalizeArchiveReason(reason: string): string {
	const trimmed = reason.trim();
	if (!trimmed) throw new Error("Archive reason cannot be empty.");
	return trimmed;
}
