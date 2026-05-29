import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter, stringifyFrontmatter } from "./markdown.js";
import type { OverlayScope, Workspace } from "./types.js";
import { atomicWrite, listFiles, nowIso, uniqueSlug } from "./utils.js";
import { overlayDir } from "./workspace.js";

export type KnowledgeKind = "decision" | "note" | "gotcha";

export interface AgentDocumentMeta {
	id: string;
	title: string;
	kind?: KnowledgeKind | "spec";
	status?: string;
	created: string;
	updated: string;
}

export interface AgentDocument {
	path: string;
	scope: OverlayScope;
	meta: AgentDocumentMeta;
	body: string;
}

const SPEC_ORDER = ["id", "title", "status", "created", "updated"];
const KNOWLEDGE_ORDER = ["id", "title", "kind", "created", "updated"];
const SCOPE_ORDER: OverlayScope[] = ["goal", "project", "global"];

export async function createSpec(
	workspace: Workspace,
	title: string,
	scope: OverlayScope = "project",
): Promise<AgentDocument> {
	const dir = overlayDir(workspace, scope, "specs");
	const id = await uniqueSlug(dir, title);
	const now = nowIso();
	const doc: AgentDocument = {
		path: join(dir, `${id}.md`),
		scope,
		meta: {
			id,
			title,
			status: "draft",
			created: now,
			updated: now,
		},
		body: `## Context\n\nDescribe the problem and relevant constraints.\n\n## Decisions\n\n- TBD\n\n## Tasks\n\n- TBD\n`,
	};
	await writeDocument(doc, SPEC_ORDER);
	return doc;
}

export async function createKnowledge(
	workspace: Workspace,
	title: string,
	kind: string,
	scope: OverlayScope = "project",
): Promise<AgentDocument> {
	const normalizedKind = parseKnowledgeKind(kind);
	const dir = overlayDir(workspace, scope, "knowledge");
	const id = await uniqueSlug(dir, title);
	const now = nowIso();
	const doc: AgentDocument = {
		path: join(dir, `${id}.md`),
		scope,
		meta: {
			id,
			title,
			kind: normalizedKind,
			created: now,
			updated: now,
		},
		body: `## ${capitalize(normalizedKind)}\n\nWrite the ${normalizedKind} here.\n`,
	};
	await writeDocument(doc, KNOWLEDGE_ORDER);
	return doc;
}

export async function listSpecs(
	workspace: Workspace,
	scope?: OverlayScope,
): Promise<AgentDocument[]> {
	return listScopedDocuments(workspace, "specs", scope);
}

export async function listKnowledge(
	workspace: Workspace,
	scope?: OverlayScope,
): Promise<AgentDocument[]> {
	return listScopedDocuments(workspace, "knowledge", scope);
}

export async function getSpec(
	workspace: Workspace,
	id: string,
): Promise<AgentDocument> {
	return getScopedDocument(workspace, "specs", id, "Spec");
}

export async function getKnowledge(
	workspace: Workspace,
	id: string,
): Promise<AgentDocument> {
	return getScopedDocument(workspace, "knowledge", id, "Knowledge");
}

export async function writeSpecBody(
	workspace: Workspace,
	id: string,
	body: string,
): Promise<AgentDocument> {
	return writeScopedDocumentBody(workspace, "specs", id, "Spec", body, SPEC_ORDER);
}

export async function writeKnowledgeBody(
	workspace: Workspace,
	id: string,
	body: string,
): Promise<AgentDocument> {
	return writeScopedDocumentBody(workspace, "knowledge", id, "Knowledge", body, KNOWLEDGE_ORDER);
}

export async function readScopedDocuments(
	workspace: Workspace,
	kind: "specs" | "knowledge",
	scope: OverlayScope,
): Promise<AgentDocument[]> {
	return listDocuments(overlayDir(workspace, scope, kind), scope);
}

export async function resolveSpecRefs(
	workspace: Workspace,
	refs: string[],
): Promise<AgentDocument[]> {
	const docs: AgentDocument[] = [];
	for (const ref of refs) {
		docs.push(await getSpec(workspace, ref));
	}
	return docs;
}

export function parseScope(value: string): OverlayScope {
	if (value === "global" || value === "project" || value === "goal") return value;
	throw new Error('Invalid scope. Expected "global", "project", or "goal".');
}

function parseKnowledgeKind(kind: string): KnowledgeKind {
	if (kind === "decision" || kind === "note" || kind === "gotcha") {
		return kind;
	}
	throw new Error('Invalid knowledge kind. Expected "decision", "note", or "gotcha".');
}

async function listScopedDocuments(
	workspace: Workspace,
	kind: "specs" | "knowledge",
	scope?: OverlayScope,
): Promise<AgentDocument[]> {
	const scopes = scope ? [scope] : (["global", "project", "goal"] as OverlayScope[]);
	const docs = await Promise.all(scopes.map((item) => readScopedDocuments(workspace, kind, item)));
	return docs.flat().sort((a, b) => `${a.scope}:${a.meta.id}`.localeCompare(`${b.scope}:${b.meta.id}`));
}

async function getScopedDocument(
	workspace: Workspace,
	kind: "specs" | "knowledge",
	ref: string,
	label: string,
): Promise<AgentDocument> {
	const qualified = parseQualifiedDocRef(ref, kind === "specs" ? "spec" : "knowledge");
	if (qualified) {
		const path = join(overlayDir(workspace, qualified.scope, kind), `${qualified.id}.md`);
		if (!existsSync(path)) throw new Error(`${label} not found: ${ref}`);
		return readDocument(path, qualified.scope);
	}
	for (const scope of SCOPE_ORDER) {
		const path = join(overlayDir(workspace, scope, kind), `${ref}.md`);
		if (existsSync(path)) return readDocument(path, scope);
	}
	throw new Error(`${label} not found: ${ref}`);
}

async function writeScopedDocumentBody(
	workspace: Workspace,
	kind: "specs" | "knowledge",
	ref: string,
	label: string,
	body: string,
	order: string[],
): Promise<AgentDocument> {
	const doc = await getScopedDocument(workspace, kind, ref, label);
	doc.body = normalizeBody(body);
	doc.meta.updated = nowIso();
	await writeDocument(doc, order);
	return doc;
}

function parseQualifiedDocRef(
	ref: string,
	kind: "spec" | "knowledge",
): { scope: OverlayScope; id: string } | undefined {
	const prefix = `${kind}:`;
	if (!ref.startsWith(prefix)) return undefined;
	const rest = ref.slice(prefix.length);
	const slash = rest.indexOf("/");
	if (slash === -1) throw new Error(`Invalid ${kind} ref: ${ref}`);
	const scope = parseScope(rest.slice(0, slash));
	const id = rest.slice(slash + 1);
	if (!id) throw new Error(`Invalid ${kind} ref: ${ref}`);
	return { scope, id };
}

async function listDocuments(dir: string, scope: OverlayScope): Promise<AgentDocument[]> {
	const files = await listFiles(dir, ".md");
	const docs = await Promise.all(files.map((file) => readDocument(file, scope)));
	return docs.sort((a, b) => a.meta.id.localeCompare(b.meta.id));
}

async function readDocument(path: string, scope: OverlayScope): Promise<AgentDocument> {
	const content = await readFile(path, "utf-8");
	const doc = parseFrontmatter<Record<string, unknown>>(content);
	const meta = normalizeDocumentMeta(doc.meta, path);
	return { path, scope, meta, body: doc.body };
}

async function writeDocument(
	doc: AgentDocument,
	order: string[],
): Promise<void> {
	await atomicWrite(
		doc.path,
		stringifyFrontmatter(
			doc.meta as unknown as Record<string, unknown>,
			doc.body,
			order,
		),
	);
}

function normalizeDocumentMeta(
	raw: Record<string, unknown>,
	path: string,
): AgentDocumentMeta {
	if (typeof raw.id !== "string" || typeof raw.title !== "string") {
		throw new Error(`Invalid document frontmatter in ${path}`);
	}
	return {
		id: raw.id,
		title: raw.title,
		kind: typeof raw.kind === "string" ? (raw.kind as AgentDocumentMeta["kind"]) : undefined,
		status: typeof raw.status === "string" ? raw.status : undefined,
		created: typeof raw.created === "string" ? raw.created : "",
		updated: typeof raw.updated === "string" ? raw.updated : "",
	};
}

function capitalize(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}

function normalizeBody(body: string): string {
	return body.endsWith("\n") ? body : `${body}\n`;
}
