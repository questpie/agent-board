import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { getKnowledge, getSpec } from "./documents.js";
import { getTask } from "./tasks.js";
import type { Workspace } from "./types.js";
import { atomicWrite, nowIso } from "./utils.js";
import { getWireframe } from "./wireframes.js";

export type ShareKind = "design" | "spec" | "task" | "knowledge";

export const SHARE_KINDS: ShareKind[] = ["design", "spec", "task", "knowledge"];

export function parseShareKind(value: string): ShareKind {
	if ((SHARE_KINDS as string[]).includes(value)) return value as ShareKind;
	throw new Error(`Invalid kind "${value}". Expected one of: ${SHARE_KINDS.join(", ")}.`);
}

// The hosted viewer that renders a shared gist. Static page on the repo's
// GitHub Pages; overridable so forks/self-hosters can point elsewhere.
const DEFAULT_VIEWER_BASE = "https://questpie.github.io/agent-board/share/";

function viewerBase(): string {
	const base = process.env.AGENT_BOARD_SHARE_VIEWER ?? DEFAULT_VIEWER_BASE;
	return base.endsWith("/") ? base : `${base}/`;
}

function viewerUrl(gistId: string): string {
	return `${viewerBase()}#${gistId}`;
}

function pkgVersion(): string {
	try {
		return JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8")).version;
	} catch {
		return "0";
	}
}

// ---------------------------------------------------------------------------
// Wireframe bundle → single self-contained HTML
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
	".css": "text/css",
	".js": "text/javascript",
	".mjs": "text/javascript",
	".jsx": "text/javascript",
	".json": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".avif": "image/avif",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".otf": "font/otf",
	".html": "text/html",
};

function isExternalRef(ref: string): boolean {
	return (
		/^(https?:)?\/\//i.test(ref) ||
		ref.startsWith("data:") ||
		ref.startsWith("#") ||
		ref.startsWith("mailto:") ||
		ref.startsWith("tel:") ||
		ref.startsWith("blob:")
	);
}

// Resolve a local asset reference to an absolute path inside the bundle, or
// null if it is external, absolute, escapes the bundle, or does not exist.
function resolveLocal(baseDir: string, root: string, ref: string): string | null {
	if (!ref || isExternalRef(ref)) return null;
	const clean = ref.split(/[?#]/)[0]!.trim();
	if (!clean || isAbsolute(clean)) return null;
	const abs = resolve(baseDir, clean);
	const rel = relative(root, abs);
	if (rel.startsWith("..") || isAbsolute(rel)) return null;
	return existsSync(abs) ? abs : null;
}

async function dataUrl(path: string): Promise<string> {
	const buf = await readFile(path);
	const mime = MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
	return `data:${mime};base64,${buf.toString("base64")}`;
}

function getAttr(tag: string, name: string): string | null {
	const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
	if (!match) return null;
	return match[2] ?? match[3] ?? match[4] ?? "";
}

async function replaceAllAsync(
	input: string,
	re: RegExp,
	fn: (match: string, ...groups: string[]) => Promise<string>,
): Promise<string> {
	const matches = [...input.matchAll(re)];
	let out = "";
	let last = 0;
	for (const match of matches) {
		out += input.slice(last, match.index);
		out += await fn(match[0], ...match.slice(1));
		last = match.index + match[0].length;
	}
	return out + input.slice(last);
}

// Inline local url(...) references inside a chunk of CSS as data URLs.
async function inlineCssUrls(css: string, baseDir: string, root: string): Promise<string> {
	const seen = new Map<string, string>();
	const matches = [...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)];
	for (const match of matches) {
		const token = match[0];
		if (seen.has(token)) continue;
		const local = resolveLocal(baseDir, root, match[2]!.trim());
		if (!local) continue;
		seen.set(token, `url(${await dataUrl(local)})`);
	}
	let out = css;
	for (const [token, replacement] of seen) out = out.split(token).join(replacement);
	return out;
}

export interface InlinedBundle {
	html: string;
	bytes: number;
}

// Flatten an imported wireframe bundle (HTML entry + sibling assets) into one
// self-contained HTML string: local stylesheets, scripts, images, icons and
// CSS url() refs become inline content / data URLs. External (CDN, absolute)
// references are left untouched. ES-module relative imports and <img srcset>
// are not rewritten — wireframes built by the design kit use script tags.
export async function inlineBundle(bundleDir: string, entry: string): Promise<InlinedBundle> {
	const root = resolve(bundleDir);
	const entryPath = resolve(root, entry);
	const entryDir = dirname(entryPath);
	let html = await readFile(entryPath, "utf8");

	// <link rel="stylesheet|icon" href="local">
	html = await replaceAllAsync(html, /<link\b[^>]*>/gi, async (tag) => {
		const href = getAttr(tag, "href");
		if (!href) return tag;
		const local = resolveLocal(entryDir, root, href);
		if (!local) return tag;
		const rel = (getAttr(tag, "rel") ?? "").toLowerCase();
		if (rel.includes("stylesheet")) {
			const css = await inlineCssUrls(await readFile(local, "utf8"), dirname(local), root);
			return `<style>\n${css}\n</style>`;
		}
		if (rel.includes("icon")) return tag.split(href).join(await dataUrl(local));
		return tag;
	});

	// <script src="local"></script> (empty body) → inline, preserving attrs
	html = await replaceAllAsync(html, /<script\b[^>]*>\s*<\/script>/gi, async (tag) => {
		const src = getAttr(tag, "src");
		if (!src) return tag;
		const local = resolveLocal(entryDir, root, src);
		if (!local) return tag;
		const code = await readFile(local, "utf8");
		const openEnd = tag.indexOf(">");
		const openTag = tag
			.slice(0, openEnd + 1)
			.replace(/\ssrc\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, "");
		return `${openTag}${code}</script>`;
	});

	// <img src="local">
	html = await replaceAllAsync(html, /<img\b[^>]*>/gi, async (tag) => {
		const src = getAttr(tag, "src");
		if (!src) return tag;
		const local = resolveLocal(entryDir, root, src);
		if (!local) return tag;
		return tag.split(src).join(await dataUrl(local));
	});

	// url(...) inside author-written <style> blocks
	html = await replaceAllAsync(html, /<style\b[^>]*>([\s\S]*?)<\/style>/gi, async (block, css) => {
		const inlined = await inlineCssUrls(css ?? "", entryDir, root);
		return inlined === css ? block : block.split(css!).join(inlined);
	});

	return { html, bytes: Buffer.byteLength(html, "utf8") };
}

// ---------------------------------------------------------------------------
// Gist transport (via the GitHub CLI, reusing the user's existing auth)
// ---------------------------------------------------------------------------

interface GistFile {
	content: string;
}

interface GistResult {
	id: string;
	htmlUrl: string;
}

async function ghApi(args: string[], body?: unknown): Promise<Record<string, unknown>> {
	let proc: ReturnType<typeof Bun.spawn>;
	try {
		proc = Bun.spawn(["gh", ...args], {
			stdin: body === undefined ? "ignore" : new Blob([JSON.stringify(body)]),
			stdout: "pipe",
			stderr: "pipe",
		});
	} catch {
		throw new Error("GitHub CLI `gh` not found. Install it (https://cli.github.com) and run `gh auth login`.");
	}
	const [out, err, code] = await Promise.all([
		new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
		new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
		proc.exited,
	]);
	if (code !== 0) {
		const message = (err.trim() || out.trim() || `gh exited ${code}`).split("\n")[0]!;
		if (/auth|login|401|unauthorized/i.test(message)) {
			throw new Error(`GitHub auth required: ${message}. Run \`gh auth login\` (needs the \`gist\` scope).`);
		}
		throw new Error(`gh api failed: ${message}`);
	}
	return out.trim() ? (JSON.parse(out) as Record<string, unknown>) : {};
}

async function putGist(
	files: Record<string, GistFile>,
	description: string,
	existingId?: string,
): Promise<GistResult> {
	const res = existingId
		? await ghApi(["api", "-X", "PATCH", `/gists/${existingId}`, "--input", "-"], { files, description })
		: await ghApi(["api", "-X", "POST", "/gists", "--input", "-"], { files, description, public: false });
	const id = String(res.id ?? "");
	const htmlUrl = String(res.html_url ?? "");
	if (!id) throw new Error("GitHub did not return a gist id.");
	return { id, htmlUrl };
}

// ---------------------------------------------------------------------------
// shares.json index (non-invasive: no per-artifact frontmatter changes)
// ---------------------------------------------------------------------------

export interface ShareRecord {
	kind: ShareKind;
	id: string;
	scope?: string;
	title: string;
	gist: string;
	url: string;
	gistUrl: string;
	sharedAt: string;
}

function indexPath(workspace: Workspace): string {
	return join(workspace.projectPath, "shares.json");
}

async function readShareIndex(workspace: Workspace): Promise<Record<string, ShareRecord>> {
	try {
		const parsed = JSON.parse(await readFile(indexPath(workspace), "utf8"));
		return parsed && typeof parsed === "object" ? (parsed as Record<string, ShareRecord>) : {};
	} catch {
		return {};
	}
}

async function writeShareIndex(workspace: Workspace, index: Record<string, ShareRecord>): Promise<void> {
	await atomicWrite(indexPath(workspace), `${JSON.stringify(index, null, 2)}\n`);
}

function shareKey(kind: ShareKind, scope: string, id: string): string {
	return `${kind}:${scope}:${id}`;
}

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------

interface Payload {
	files: Record<string, GistFile>;
	key: string;
	id: string;
	scope: string;
	title: string;
	warnings: string[];
}

async function buildPayload(workspace: Workspace, kind: ShareKind, ref: string): Promise<Payload> {
	const sharedAt = nowIso();
	const generator = `agent-board@${pkgVersion()}`;

	if (kind === "design") {
		const frame = await getWireframe(workspace, ref);
		const { html, bytes } = await inlineBundle(frame.dir, frame.meta.entry);
		const meta = {
			v: 1,
			kind,
			id: frame.meta.id,
			title: frame.meta.title,
			scope: frame.scope,
			status: frame.meta.status,
			category: frame.meta.category,
			htmlFile: "index.html",
			generator,
			sharedAt,
		};
		const warnings: string[] = [];
		if (bytes > 1_000_000) {
			warnings.push(
				`Inlined design is ${(bytes / 1e6).toFixed(1)} MB; large gists load slowly and the API may truncate them. A lighter bundle (or --target pages, coming soon) is better.`,
			);
		}
		return {
			files: {
				"share.json": { content: JSON.stringify(meta, null, 2) },
				"index.html": { content: html },
			},
			key: shareKey(kind, frame.scope, frame.meta.id),
			id: frame.meta.id,
			scope: frame.scope,
			title: frame.meta.title,
			warnings,
		};
	}

	const doc =
		kind === "task"
			? await getTask(workspace, ref)
			: kind === "spec"
				? await getSpec(workspace, ref)
				: await getKnowledge(workspace, ref);
	const scope = kind === "task" ? workspace.goalSlug : (doc as { scope: string }).scope;
	const bodyFile = `${doc.meta.id}.md`;
	const status = "status" in doc.meta ? doc.meta.status : undefined;
	const kindLabel = "kind" in doc.meta ? doc.meta.kind : undefined;
	const category = "category" in doc.meta ? doc.meta.category : undefined;
	const meta = {
		v: 1,
		kind,
		id: doc.meta.id,
		title: doc.meta.title,
		scope,
		status,
		noteKind: kindLabel,
		category,
		bodyFile,
		generator,
		sharedAt,
	};
	return {
		files: {
			"share.json": { content: JSON.stringify(meta, null, 2) },
			[bodyFile]: { content: `# ${doc.meta.title}\n\n${doc.body.trim()}\n` },
		},
		key: shareKey(kind, scope, doc.meta.id),
		id: doc.meta.id,
		scope,
		title: doc.meta.title,
		warnings: [],
	};
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ShareResult {
	kind: ShareKind;
	title: string;
	gistId: string;
	gistUrl: string;
	viewerUrl: string;
	updated: boolean;
	warnings: string[];
}

export async function shareArtifact(
	workspace: Workspace,
	kind: ShareKind,
	ref: string,
	options: { target?: string } = {},
): Promise<ShareResult> {
	const target = options.target ?? "gist";
	if (target !== "gist") {
		throw new Error(`--target ${target} is not implemented yet. v1 supports --target gist (default).`);
	}

	const payload = await buildPayload(workspace, kind, ref);
	const index = await readShareIndex(workspace);
	const existing = index[payload.key];
	const description = `agent-board share: ${payload.title} (${kind})`;

	let result: GistResult;
	let updated = false;
	if (existing?.gist) {
		try {
			result = await putGist(payload.files, description, existing.gist);
			updated = true;
		} catch {
			result = await putGist(payload.files, description);
		}
	} else {
		result = await putGist(payload.files, description);
	}

	const url = viewerUrl(result.id);
	index[payload.key] = {
		kind,
		id: payload.id,
		scope: payload.scope,
		title: payload.title,
		gist: result.id,
		url,
		gistUrl: result.htmlUrl,
		sharedAt: nowIso(),
	};
	await writeShareIndex(workspace, index);

	return {
		kind,
		title: payload.title,
		gistId: result.id,
		gistUrl: result.htmlUrl,
		viewerUrl: url,
		updated,
		warnings: payload.warnings,
	};
}

export async function listShares(workspace: Workspace): Promise<ShareRecord[]> {
	const index = await readShareIndex(workspace);
	return Object.values(index).sort((a, b) => (b.sharedAt ?? "").localeCompare(a.sharedAt ?? ""));
}

export async function removeShare(
	workspace: Workspace,
	kind: ShareKind,
	ref: string,
): Promise<{ removed: boolean; gist?: string }> {
	const index = await readShareIndex(workspace);
	const entry = Object.entries(index).find(
		([key, record]) => record.kind === kind && (record.id === ref || key.endsWith(`:${ref}`)),
	);
	if (!entry) return { removed: false };
	const [key, record] = entry;
	try {
		await ghApi(["api", "-X", "DELETE", `/gists/${record.gist}`]);
	} catch {
		// The gist may already be gone; drop it from the index regardless.
	}
	delete index[key];
	await writeShareIndex(workspace, index);
	return { removed: true, gist: record.gist };
}

export function isDefaultViewer(): boolean {
	return (process.env.AGENT_BOARD_SHARE_VIEWER ?? DEFAULT_VIEWER_BASE) === DEFAULT_VIEWER_BASE;
}

export function openUrl(url: string): void {
	const command =
		process.platform === "darwin"
			? ["open", url]
			: process.platform === "win32"
				? ["cmd", "/c", "start", "", url]
				: ["xdg-open", url];
	try {
		Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
	} catch {
		// Opening a browser is best-effort.
	}
}
