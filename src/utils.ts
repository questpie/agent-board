import { existsSync, statSync } from "node:fs";
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

// Resolve which board governs this cwd, and how. Precedence:
//   1. AGENT_BOARD_HOME env (explicit escape hatch) → home mode
//   2. a `.agent-board/` found above cwd            → local mode
//   3. ~/.agent-board                               → home mode (default)
export function resolveRoot(cwd: string): { root: string; mode: WorkspaceMode } {
	const override = process.env.AGENT_BOARD_HOME;
	if (override) return { root: override, mode: "home" };
	const local = findLocalRoot(cwd);
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
