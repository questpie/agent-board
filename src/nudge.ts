import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { atomicWrite } from "./utils.js";
import { gitRoot } from "./git.js";

// Agent instruction files that pick up project-level guidance. CLAUDE.md is read
// by Claude Code; AGENTS.md is the cross-tool convention (Codex, Cursor, ...).
const NUDGE_FILES = ["CLAUDE.md", "AGENTS.md"] as const;

const START = "<!-- agent-board:start (managed block — edit outside these markers) -->";
const END = "<!-- agent-board:end -->";
// Match the block regardless of the exact start-marker text, so the markers can
// evolve without orphaning old blocks.
const REGION = /<!-- agent-board:start[\s\S]*?agent-board:end -->/;
const REGION_WITH_PADDING = /\n*<!-- agent-board:start[\s\S]*?agent-board:end -->\n*/;

const NUDGE_BODY = `## Agent Board

This repo uses **agent-board** as the durable store for goals, specs, tasks, knowledge, flow evidence, and board hygiene. Keep plans and decisions on the board, not only in chat. Reach for the bundled skills: \`agent-board\` (router/orchestrator), \`agent-board-bootstrap\` (new work interview), \`agent-board-research\` (current docs/repo discovery), \`agent-board-spec\` (spec/task graph), \`agent-board-flow\` (closed-loop execution), \`agent-board-implement\` or legacy \`agent-board-worker\` (one task), \`agent-board-grill\` (adversarial review), and \`agent-board-maintenance\` (cleanup/archive). Run \`agent-board status\` before planning.`;

function block(): string {
	return `${START}\n${NUDGE_BODY}\n${END}`;
}

export interface NudgeResult {
	file: string;
	action: "created" | "updated" | "unchanged" | "removed" | "absent";
}

// Add, refresh, or remove the managed agent-board nudge in the repo's CLAUDE.md
// and AGENTS.md. Targets the git root (so it lands at the repo root even from a
// subdir), or cwd when not in a git work tree.
export async function applyNudge(
	cwd: string,
	options: { remove?: boolean } = {},
): Promise<{ root: string; results: NudgeResult[] }> {
	const root = (await gitRoot(cwd)) ?? resolve(cwd);
	const results: NudgeResult[] = [];
	for (const file of NUDGE_FILES) {
		results.push(await applyNudgeFile(join(root, file), file, options.remove ?? false));
	}
	return { root, results };
}

// Report whether the repo's instruction files already carry the nudge block, so
// the CLI can hint (not auto-write) when it is missing. isRepo is false outside a
// git work tree, where we stay quiet.
export async function nudgeStatus(
	cwd: string,
): Promise<{ root: string; isRepo: boolean; missing: string[] }> {
	const root = await gitRoot(cwd);
	const base = root ?? resolve(cwd);
	const missing: string[] = [];
	for (const file of NUDGE_FILES) {
		const path = join(base, file);
		const content = existsSync(path) ? await readFile(path, "utf-8") : "";
		if (!REGION.test(content)) missing.push(file);
	}
	return { root: base, isRepo: root !== null, missing };
}

async function applyNudgeFile(path: string, file: string, remove: boolean): Promise<NudgeResult> {
	const existing = existsSync(path) ? await readFile(path, "utf-8") : null;

	if (remove) {
		if (existing === null || !REGION.test(existing)) return { file, action: "absent" };
		const stripped = existing.replace(REGION_WITH_PADDING, "\n").replace(/\n{3,}/g, "\n\n").trimEnd();
		await atomicWrite(path, stripped ? `${stripped}\n` : "");
		return { file, action: "removed" };
	}

	const desired = block();
	if (existing === null) {
		await atomicWrite(path, `${desired}\n`);
		return { file, action: "created" };
	}
	if (REGION.test(existing)) {
		const next = existing.replace(REGION, desired);
		if (next === existing) return { file, action: "unchanged" };
		await atomicWrite(path, next);
		return { file, action: "updated" };
	}
	const separator = existing.endsWith("\n") ? "\n" : "\n\n";
	await atomicWrite(path, `${existing}${separator}${desired}\n`);
	return { file, action: "updated" };
}
