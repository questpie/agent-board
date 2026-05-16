import { existsSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { homedir } from "node:os";

export function getHomeRoot(): string {
	return process.env.AGENT_BOARD_HOME ?? join(homedir(), ".agent-board");
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
