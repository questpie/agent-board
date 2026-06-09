import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, readdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import type { WorkspaceMode } from "./types.js";

// Write via a temp file + atomic rename so a concurrent reader never observes a
// truncated/partial file (e.g. `plan --related` reading another project mid-write).
export async function atomicWrite(path: string, content: string): Promise<void> {
	const tmp = `${path}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
	await writeFile(tmp, content);
	await rename(tmp, path);
}

const BOARD_DIR_NAME = ".agent-board";

// The canonical shared board, ignoring the AGENT_BOARD_HOME override. Used as
// the boundary that findLocalRoot must never treat as a repo-local board.
export function getDefaultHomeRoot(): string {
	return join(homedir(), BOARD_DIR_NAME);
}

// The shared board root: explicit override wins, else ~/.agent-board.
export function getHomeRoot(): string {
	return process.env.AGENT_BOARD_HOME ?? getDefaultHomeRoot();
}

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

// Walk up from cwd looking for a repo-local `.agent-board/` directory (like git
// finding `.git`). Stops at the home directory so the shared ~/.agent-board is
// never mistaken for a local board of every repo that lives under $HOME.
export function findLocalRoot(cwd: string): string | null {
	const home = resolve(homedir());
	let dir = resolve(cwd);
	while (dir !== home) {
		const candidate = join(dir, BOARD_DIR_NAME);
		if (isDirectory(candidate)) return candidate;
		const parent = dirname(dir);
		if (parent === dir) break; // filesystem root
		dir = parent;
	}
	return null;
}

export interface WorktreeInfo {
	worktreeRoot: string; // top level of the linked worktree (the dir holding the `.git` file)
	mainRoot: string; // top level of the main checkout the worktree belongs to
}

// Walk up from cwd looking for a `.git` entry. A linked git worktree marks its
// root with a `.git` FILE pointing at `<main>/.git/worktrees/<name>`; follow
// that pointer (and its `commondir` file) back to the main checkout. Returns
// null for a main checkout (`.git` directory), a submodule (gitdir points at
// `modules/`, no `commondir`), or a cwd outside git entirely.
export function findWorktreeMainRoot(cwd: string): WorktreeInfo | null {
	let dir = resolve(cwd);
	while (true) {
		const marker = join(dir, ".git");
		try {
			const stat = statSync(marker);
			if (stat.isDirectory()) return null;
			if (stat.isFile()) return parseWorktreeMarker(dir, marker);
		} catch {
			// no .git entry here; keep walking up
		}
		const parent = dirname(dir);
		if (parent === dir) return null; // filesystem root
		dir = parent;
	}
}

function parseWorktreeMarker(worktreeRoot: string, marker: string): WorktreeInfo | null {
	let contents: string;
	try {
		contents = readFileSync(marker, "utf-8");
	} catch {
		return null;
	}
	const match = contents.match(/^gitdir:\s*(.+?)\s*$/m);
	if (!match) return null;
	const gitdir = resolve(worktreeRoot, match[1]!);
	// `commondir` points from the per-worktree gitdir back to the shared .git
	// dir. Submodule gitdirs (`.git/modules/<name>`) have none, so they fall
	// through to the layout check below and are rejected there.
	try {
		const common = readFileSync(join(gitdir, "commondir"), "utf-8").trim();
		return { worktreeRoot, mainRoot: dirname(resolve(gitdir, common)) };
	} catch {
		// fall through to the canonical layout <main>/.git/worktrees/<name>
	}
	const worktreesDir = dirname(gitdir);
	if (basename(worktreesDir) !== "worktrees" || basename(dirname(worktreesDir)) !== ".git") return null;
	return { worktreeRoot, mainRoot: dirname(dirname(worktreesDir)) };
}

// Resolve which board governs this cwd, and how. Precedence:
//   1. AGENT_BOARD_HOME env (explicit escape hatch)  → home mode
//   2. a `.agent-board/` found above cwd             → local mode
//      (inside a linked git worktree, the main checkout's board replaces the
//      worktree's own committed copy — that copy is a stale snapshot, and
//      writing to it would fork task state per worktree)
//   3. the main checkout's `.agent-board/`, when cwd is in a linked worktree
//      that has no board of its own                  → local mode
//   4. ~/.agent-board                                → home mode (default)
export function resolveRoot(cwd: string): { root: string; mode: WorkspaceMode } {
	const override = process.env.AGENT_BOARD_HOME;
	if (override) return { root: override, mode: "home" };
	const local = findLocalRoot(cwd);
	const worktree = findWorktreeMainRoot(cwd);
	if (worktree && (!local || local === join(worktree.worktreeRoot, BOARD_DIR_NAME))) {
		const mainBoard = join(worktree.mainRoot, BOARD_DIR_NAME);
		if (isDirectory(mainBoard)) return { root: mainBoard, mode: "local" };
	}
	if (local) return { root: local, mode: "local" };
	return { root: getDefaultHomeRoot(), mode: "home" };
}

export function slugify(value: string): string {
	const slug = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || "task";
}

export async function uniqueSlug(
	dir: string,
	base: string,
	extension = ".md",
): Promise<string> {
	let candidate = slugify(base);
	let index = 2;
	while (existsSync(join(dir, `${candidate}${extension}`))) {
		candidate = `${slugify(base)}-${index}`;
		index++;
	}
	return candidate;
}

export function nowIso(): string {
	return new Date().toISOString();
}

export async function ensureDir(path: string): Promise<void> {
	await mkdir(path, { recursive: true });
}

export async function listFiles(dir: string, ext?: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
	const files = entries
		.filter((entry) => entry.isFile() && (!ext || entry.name.endsWith(ext)))
		.map((entry) => join(dir, entry.name));
	return files.sort();
}

export function projectSlugFromCwd(cwd: string): string {
	return slugify(basename(cwd));
}

export function table(rows: string[][]): string {
	if (rows.length === 0) return "";
	const widths = rows[0]!.map((_, col) =>
		Math.max(...rows.map((row) => row[col]?.length ?? 0)),
	);
	return rows
		.map((row) =>
			row.map((cell, col) => cell.padEnd(widths[col] ?? 0)).join("  ").trimEnd(),
		)
		.join("\n");
}
