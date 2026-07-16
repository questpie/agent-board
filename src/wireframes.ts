import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { parseFrontmatter, stringifyFrontmatter } from "./markdown.js";
import type { OverlayScope, Workspace } from "./types.js";
import { atomicWrite, nowIso, slugify } from "./utils.js";

export interface WireframeMeta {
	id: string;
	title: string;
	status?: string;
	category?: string;
	entry: string;
	created: string;
	updated: string;
}

export interface Wireframe {
	path: string;
	dir: string;
	scope: OverlayScope;
	meta: WireframeMeta;
	body: string;
}

const WIREFRAME_ORDER = ["id", "title", "status", "category", "entry", "created", "updated"];
const SCOPE_ORDER: OverlayScope[] = ["goal", "project", "global"];

export async function importWireframe(
	workspace: Workspace,
	sourceDir: string,
	options: {
		title?: string;
		scope?: OverlayScope;
		category?: string;
		status?: string;
		entry?: string;
	},
): Promise<Wireframe> {
	const source = resolve(sourceDir);
	const sourceStat = await stat(source).catch(() => null);
	if (!sourceStat?.isDirectory()) throw new Error(`Wireframe source must be a directory: ${sourceDir}`);

	const scope = options.scope ?? "project";
	const root = wireframeRoot(workspace, scope);
	await mkdir(root, { recursive: true });
	const title = normalizeTitle(options.title) ?? basename(source);
	const id = await uniqueWireframeId(root, title);
	const dir = join(root, id);
	await mkdir(dir, { recursive: true });
	await copyBundle(source, dir);

	const entry = options.entry ?? await findEntry(dir);
	const now = nowIso();
	const doc: Wireframe = {
		path: join(dir, "wireframe.md"),
		dir,
		scope,
		meta: {
			id,
			title,
			status: options.status ?? "draft",
			category: normalizeCategory(options.category),
			entry,
			created: now,
			updated: now,
		},
		body: "## Notes\n\nImported HTML wireframe bundle.\n",
	};
	await writeWireframe(doc);
	return doc;
}

/** Shipped editable design-board template, copied into the store by scaffoldWireframe. */
const SCAFFOLD_TEMPLATE_DIR = join(import.meta.dir, "scaffold", "design-board");

// Create a new editable design board directly in the agent-board store from the
// shipped template, so the board's source-of-truth lives on the board from
// creation (not a loose working dir). The web edit loop persists back into the
// same dir, git-versioned.
export async function scaffoldWireframe(
	workspace: Workspace,
	options: { title?: string; scope?: OverlayScope; category?: string; status?: string } = {},
): Promise<Wireframe> {
	return importWireframe(workspace, SCAFFOLD_TEMPLATE_DIR, {
		title: options.title ?? "New design board",
		scope: options.scope,
		category: options.category ?? "design",
		status: options.status,
	});
}

export async function listWireframes(
	workspace: Workspace,
	scope?: OverlayScope,
): Promise<Wireframe[]> {
	const scopes = scope ? [scope] : defaultWireframeScopes(workspace);
	const docs = await Promise.all(scopes.map((item) => readWireframes(workspace, item)));
	return docs.flat().sort((a, b) => `${a.scope}:${a.meta.id}`.localeCompare(`${b.scope}:${b.meta.id}`));
}

export async function getWireframe(
	workspace: Workspace,
	ref: string,
): Promise<Wireframe> {
	const qualified = parseQualifiedWireframeRef(ref);
	if (qualified) {
		const path = join(wireframeRoot(workspace, qualified.scope), qualified.id, "wireframe.md");
		if (!existsSync(path)) throw new Error(`Wireframe not found: ${ref}`);
		return readWireframe(path, qualified.scope);
	}
	for (const scope of SCOPE_ORDER) {
		const path = join(wireframeRoot(workspace, scope), ref, "wireframe.md");
		if (existsSync(path)) return readWireframe(path, scope);
	}
	throw new Error(`Wireframe not found: ${ref}`);
}

export async function wireframeAsset(
	workspace: Workspace,
	scope: OverlayScope,
	id: string,
	assetPath?: string,
): Promise<{ path: string; type?: string }> {
	const frame = await getWireframe(workspace, `wireframe:${scope}/${id}`);
	const rel = normalizeAssetPath(assetPath || frame.meta.entry);
	return { path: join(frame.dir, rel), type: contentType(rel) };
}

export interface WireframeNodePatch {
	/** Relative HTML file inside the bundle; defaults to the wireframe entry. */
	entry?: string;
	/** `data-screen` of the containing artboard. */
	screen: string;
	/** `data-key` of the editable leaf within that screen (text/image only). */
	key?: string;
	/** "layout" swaps a whole screen's inner HTML (reorder / gap / direction). */
	kind: "text" | "image" | "layout";
	/** New value for a text/image leaf. */
	value?: string;
	/** New inner HTML of the screen, for a structural "layout" edit. */
	html?: string;
}

const EDIT_TOKEN = /^[\w-]+$/;

// Apply one inline edit (text content or image url) to a bundle's source HTML.
// The content is static, so the rendered node IS the source node: we locate it
// by [data-screen][data-key] and rewrite it in place, then write the file back.
export async function editWireframeNode(
	workspace: Workspace,
	scope: OverlayScope,
	id: string,
	patch: WireframeNodePatch,
): Promise<{ entry: string }> {
	const frame = await getWireframe(workspace, `wireframe:${scope}/${id}`);
	const rel = normalizeAssetPath(patch.entry || frame.meta.entry);
	if (!rel.toLowerCase().endsWith(".html")) throw new Error("Only HTML entries are editable");
	const file = join(frame.dir, rel);
	const html = await readFile(file, "utf-8");
	await atomicWrite(file, applyNodePatch(html, patch));
	return { entry: rel };
}

function applyNodePatch(html: string, patch: WireframeNodePatch): string {
	const { screen, key, kind, value } = patch;
	if (!EDIT_TOKEN.test(screen)) throw new Error("Invalid screen (expected [A-Za-z0-9_-])");

	// Structural/layout edit: the client (the DOM authority for reorder, gap,
	// direction) sends the screen's clean inner HTML; we swap just that one
	// section's children in place, leaving the rest of the file untouched.
	if (kind === "layout") {
		const inner = patch.html;
		if (typeof inner !== "string") throw new Error("layout patch requires html");
		if (inner.length > 512 * 1024) throw new Error("layout html too large");
		let hit = false;
		const out = new HTMLRewriter()
			.on(`[data-screen="${screen}"]`, {
				element(el) {
					hit = true;
					el.setInnerContent(inner, { html: true });
				},
			})
			.transform(html);
		if (!hit) throw new Error(`No screen [data-screen="${screen}"]`);
		return out;
	}

	if (kind !== "text" && kind !== "image") throw new Error('Invalid kind (expected "text", "image", or "layout")');
	if (!key || !EDIT_TOKEN.test(key)) throw new Error("Invalid key (expected [A-Za-z0-9_-])");
	let hit = false;
	const out = new HTMLRewriter()
		.on(`[data-screen="${screen}"] [data-key="${key}"]`, {
			element(el) {
				hit = true;
				if (kind === "text") el.setInnerContent(value ?? "");
				else el.setAttribute("style", value ? `--img:url("${value.replace(/"/g, "%22")}")` : "");
			},
		})
		.transform(html);
	if (!hit) throw new Error(`No editable node [data-screen="${screen}"][data-key="${key}"]`);
	return out;
}

const ASSET_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif"]);

/** A board's media — image files in its bundle assets/ dir, as relative paths. */
export async function listWireframeAssets(
	workspace: Workspace,
	scope: OverlayScope,
	id: string,
): Promise<string[]> {
	const frame = await getWireframe(workspace, `wireframe:${scope}/${id}`);
	const entries = await readdir(join(frame.dir, "assets"), { withFileTypes: true }).catch(() => []);
	return entries
		.filter((e) => e.isFile() && ASSET_EXTS.has(extname(e.name).toLowerCase()))
		.map((e) => `assets/${e.name}`)
		.sort();
}

/** Save an uploaded image into the board's bundle assets/ dir; returns its
 *  relative path (self-contained — travels + serves with the board, no DB). */
export async function saveWireframeAsset(
	workspace: Workspace,
	scope: OverlayScope,
	id: string,
	filename: string,
	bytes: Uint8Array,
): Promise<{ path: string }> {
	const frame = await getWireframe(workspace, `wireframe:${scope}/${id}`);
	const ext = extname(filename).toLowerCase();
	if (!ASSET_EXTS.has(ext)) throw new Error(`Unsupported image type: ${ext || "(none)"}`);
	const base = basename(filename, extname(filename)).replace(/[^a-zA-Z0-9_-]/g, "-").replace(/^-+|-+$/g, "") || "image";
	const dir = join(frame.dir, "assets");
	await mkdir(dir, { recursive: true });
	let name = `${base}${ext}`;
	for (let i = 2; existsSync(join(dir, name)); i++) name = `${base}-${i}${ext}`;
	await writeFile(join(dir, name), bytes);
	return { path: `assets/${name}` };
}

export function wireframeWebPath(workspace: Workspace, frame: Wireframe): string {
	const parts = [
		"wireframes",
		workspace.projectSlug,
		workspace.goalSlug,
		frame.scope,
		frame.meta.id,
		...frame.meta.entry.split("/").filter(Boolean),
	];
	return `/${parts.map(encodeURIComponent).join("/")}`;
}

function wireframeRoot(workspace: Workspace, scope: OverlayScope): string {
	if (scope === "global") return join(workspace.root, "wireframes");
	if (scope === "project") return join(workspace.projectPath, "wireframes");
	return join(workspace.goalPath, "wireframes");
}

function defaultWireframeScopes(workspace: Workspace): OverlayScope[] {
	if (workspace.mode === "local") return ["project", "goal"];
	return ["global", "project", "goal"];
}

async function readWireframes(workspace: Workspace, scope: OverlayScope): Promise<Wireframe[]> {
	const root = wireframeRoot(workspace, scope);
	const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
	const docs = await Promise.all(
		entries
			.filter((entry) => entry.isDirectory())
			.map((entry) => readWireframe(join(root, entry.name, "wireframe.md"), scope).catch(() => null)),
	);
	return docs
		.filter((doc): doc is Wireframe => doc !== null)
		.sort((a, b) => a.meta.id.localeCompare(b.meta.id));
}

async function readWireframe(path: string, scope: OverlayScope): Promise<Wireframe> {
	const content = await readFile(path, "utf-8");
	const doc = parseFrontmatter<Record<string, unknown>>(content);
	const meta = normalizeWireframeMeta(doc.meta, path);
	return { path, dir: resolve(path, ".."), scope, meta, body: doc.body };
}

async function writeWireframe(doc: Wireframe): Promise<void> {
	await atomicWrite(
		doc.path,
		stringifyFrontmatter(doc.meta as unknown as Record<string, unknown>, doc.body, WIREFRAME_ORDER),
	);
}

function normalizeWireframeMeta(raw: Record<string, unknown>, path: string): WireframeMeta {
	if (typeof raw.id !== "string" || typeof raw.title !== "string") {
		throw new Error(`Invalid wireframe frontmatter in ${path}`);
	}
	return {
		id: raw.id,
		title: raw.title,
		status: typeof raw.status === "string" ? raw.status : undefined,
		category: typeof raw.category === "string" && raw.category.trim() ? raw.category.trim() : undefined,
		entry: typeof raw.entry === "string" && raw.entry.trim() ? normalizeAssetPath(raw.entry) : "index.html",
		created: typeof raw.created === "string" ? raw.created : "",
		updated: typeof raw.updated === "string" ? raw.updated : "",
	};
}

function parseQualifiedWireframeRef(ref: string): { scope: OverlayScope; id: string } | undefined {
	const prefix = "wireframe:";
	if (!ref.startsWith(prefix)) return undefined;
	const rest = ref.slice(prefix.length);
	const slash = rest.indexOf("/");
	if (slash === -1) throw new Error(`Invalid wireframe ref: ${ref}`);
	const scope = parseScope(rest.slice(0, slash));
	const id = rest.slice(slash + 1);
	if (!id) throw new Error(`Invalid wireframe ref: ${ref}`);
	return { scope, id };
}

export function parseScope(value: string): OverlayScope {
	if (value === "global" || value === "project" || value === "goal") return value;
	throw new Error('Invalid scope. Expected "global", "project", or "goal".');
}

async function uniqueWireframeId(root: string, title: string): Promise<string> {
	const base = slugify(title);
	let candidate = base;
	let index = 2;
	while (existsSync(join(root, candidate))) {
		candidate = `${base}-${index++}`;
	}
	return candidate;
}

async function copyBundle(source: string, target: string): Promise<void> {
	const entries = await readdir(source, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.name === ".DS_Store" || entry.name === "wireframe.md") continue;
		const from = join(source, entry.name);
		const to = join(target, entry.name);
		if (entry.isDirectory()) {
			await mkdir(to, { recursive: true });
			await copyBundle(from, to);
		} else if (entry.isFile()) {
			await copyFile(from, to);
		}
	}
}

async function findEntry(dir: string): Promise<string> {
	const entries = (await readdir(dir, { withFileTypes: true }))
		.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".html"))
		.map((entry) => entry.name)
		.sort((a, b) => {
			if (a === "index.html") return -1;
			if (b === "index.html") return 1;
			if (a.endsWith("-print.html") && !b.endsWith("-print.html")) return 1;
			if (b.endsWith("-print.html") && !a.endsWith("-print.html")) return -1;
			return a.localeCompare(b);
		});
	if (!entries[0]) throw new Error("Wireframe bundle must contain an HTML entry file");
	return entries[0];
}

function normalizeAssetPath(value: string): string {
	const cleaned = value.replace(/\\/g, "/").replace(/^\/+/, "");
	if (!cleaned || isAbsolute(cleaned) || cleaned.split("/").some((part) => !part || part === "." || part === "..")) {
		throw new Error(`Invalid wireframe asset path: ${value}`);
	}
	return cleaned;
}

function normalizeTitle(value?: string): string | undefined {
	const trimmed = value?.trim();
	return trimmed || undefined;
}

function normalizeCategory(value?: string): string | undefined {
	const trimmed = value?.trim();
	return trimmed || undefined;
}

function contentType(path: string): string | undefined {
	const ext = extname(path).toLowerCase();
	const types: Record<string, string> = {
		".html": "text/html; charset=utf-8",
		".js": "text/javascript; charset=utf-8",
		".jsx": "text/javascript; charset=utf-8",
		".css": "text/css; charset=utf-8",
		".json": "application/json; charset=utf-8",
		".svg": "image/svg+xml",
		".png": "image/png",
		".jpg": "image/jpeg",
		".jpeg": "image/jpeg",
		".webp": "image/webp",
	};
	return types[ext];
}
