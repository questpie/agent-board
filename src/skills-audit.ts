import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import {
	bootstrapSkillAgents,
	bootstrapSkillReadme,
	configSkillReadme,
	designReviewSkillAgents,
	designReviewSkillReadme,
	designWireframeSkillAgents,
	designWireframeSkillReadme,
	flowSkillAgents,
	flowSkillReadme,
	flowOrchestrationSkillReadme,
	grillSkillAgents,
	grillSkillReadme,
	implementSkillAgents,
	implementSkillReadme,
	maintenanceSkillAgents,
	maintenanceSkillReadme,
	organizationReference,
	pmOrchestratorSkillReadme,
	researchSkillAgents,
	researchSkillReadme,
	researchWorkflowSkillReadme,
	reviewWorkflowSkillReadme,
	skillAgents,
	skillReadme,
	specSkillAgents,
	specSkillReadme,
	taskWorkflowReference,
	workerSkillAgents,
	workerSkillReadme,
} from "./skills.js";

export interface DriftIssue {
	source: string;
	kind: "unknown-command" | "unknown-flag";
	token: string;
	invocation: string;
}

interface CliSurface {
	commands: Set<string>;
	flagsByCommand: Map<string, Set<string>>;
	rootFlags: Set<string>;
}

const SKILL_DOCS: ReadonlyArray<{ source: string; text: string }> = [
	{ source: "agent-board/SKILL.md", text: skillReadme },
	{ source: "agent-board/AGENTS.md", text: skillAgents },
	{ source: "agent-board-bootstrap/SKILL.md", text: bootstrapSkillReadme },
	{ source: "agent-board-bootstrap/AGENTS.md", text: bootstrapSkillAgents },
	{ source: "agent-board-spec/SKILL.md", text: specSkillReadme },
	{ source: "agent-board-spec/AGENTS.md", text: specSkillAgents },
	{ source: "agent-board-flow/SKILL.md", text: flowSkillReadme },
	{ source: "agent-board-flow/AGENTS.md", text: flowSkillAgents },
	{ source: "agent-board-grill/SKILL.md", text: grillSkillReadme },
	{ source: "agent-board-grill/AGENTS.md", text: grillSkillAgents },
	{ source: "agent-board-implement/SKILL.md", text: implementSkillReadme },
	{ source: "agent-board-implement/AGENTS.md", text: implementSkillAgents },
	{ source: "agent-board-worker/SKILL.md", text: workerSkillReadme },
	{ source: "agent-board-worker/AGENTS.md", text: workerSkillAgents },
	{ source: "agent-board-research/SKILL.md", text: researchSkillReadme },
	{ source: "agent-board-research/AGENTS.md", text: researchSkillAgents },
	{ source: "agent-board-maintenance/SKILL.md", text: maintenanceSkillReadme },
	{ source: "agent-board-maintenance/AGENTS.md", text: maintenanceSkillAgents },
	{ source: "agent-board-design-wireframe/SKILL.md", text: designWireframeSkillReadme },
	{ source: "agent-board-design-wireframe/AGENTS.md", text: designWireframeSkillAgents },
	{ source: "agent-board-design-review/SKILL.md", text: designReviewSkillReadme },
	{ source: "agent-board-design-review/AGENTS.md", text: designReviewSkillAgents },
	{ source: "references/config.md", text: configSkillReadme },
	{ source: "references/organization.md", text: organizationReference },
	{ source: "references/task-workflow.md", text: taskWorkflowReference },
	{ source: "references/pm-orchestrator.md", text: pmOrchestratorSkillReadme },
	{ source: "references/flow-orchestration.md", text: flowOrchestrationSkillReadme },
	{ source: "references/research-workflow.md", text: researchWorkflowSkillReadme },
	{ source: "references/review-workflow.md", text: reviewWorkflowSkillReadme },
];

// User-facing repo docs (README.md plus top-level docs/*.md) get the same
// drift guard as the bundled skill docs. They are not shipped to npm
// ("files": ["src"]), so an installed CLI finds nothing here and audits only
// the bundled strings. docs/internal/ holds historical material (RFCs,
// research notes) and is deliberately excluded by the non-recursive listing.
export function collectRepoDocs(): ReadonlyArray<{ source: string; text: string }> {
	const root = fileURLToPath(new URL("..", import.meta.url));
	const docs: Array<{ source: string; text: string }> = [];
	const readme = join(root, "README.md");
	if (existsSync(readme)) docs.push({ source: "README.md", text: readFileSync(readme, "utf8") });
	const docsDir = join(root, "docs");
	if (existsSync(docsDir)) {
		const names = readdirSync(docsDir, { withFileTypes: true })
			.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
			.map((entry) => entry.name)
			.sort();
		for (const name of names) {
			docs.push({ source: `docs/${name}`, text: readFileSync(join(docsDir, name), "utf8") });
		}
	}
	return docs;
}

// Validate that every `agent-board ...` command and flag referenced in the
// bundled skill docs still exists in the live CLI. The commander program is the
// single source of truth, so a renamed/removed command or flag surfaces here as
// drift instead of silently misleading an agent that follows the skill.
export function auditSkillDrift(
	program: Command,
	extraDocs: ReadonlyArray<{ source: string; text: string }> = [],
): DriftIssue[] {
	const surface = collectCliSurface(program);
	const issues: DriftIssue[] = [];
	const seen = new Set<string>();
	for (const doc of [...SKILL_DOCS, ...extraDocs]) {
		for (const issue of driftInText(doc.text, doc.source, surface)) {
			const key = `${issue.source}|${issue.kind}|${issue.token}|${issue.invocation}`;
			if (seen.has(key)) continue;
			seen.add(key);
			issues.push(issue);
		}
	}
	return issues;
}

// Test/debug seam: run the same drift check over arbitrary text.
export function findDrift(text: string, program: Command): DriftIssue[] {
	return driftInText(text, "<text>", collectCliSurface(program));
}

function driftInText(text: string, source: string, surface: CliSurface): DriftIssue[] {
	const issues: DriftIssue[] = [];
	for (const invocation of extractInvocations(text)) {
		issues.push(...checkInvocation(invocation, source, surface));
	}
	return issues;
}

// Flatten the commander tree into the set of valid command paths ("spec",
// "spec new", "flow run", ...) and, per path, the long flags allowed there
// (its own options plus everything inherited from ancestors and the root).
function collectCliSurface(program: Command): CliSurface {
	const commands = new Set<string>();
	const flagsByCommand = new Map<string, Set<string>>();
	const rootFlags = new Set<string>([...optionLongs(program), "--help", "--version"]);
	const walk = (cmd: Command, prefix: string, inherited: Set<string>): void => {
		for (const sub of cmd.commands) {
			const path = prefix ? `${prefix} ${sub.name()}` : sub.name();
			const flags = new Set<string>([...inherited, ...optionLongs(sub), "--help"]);
			commands.add(path);
			flagsByCommand.set(path, flags);
			for (const alias of sub.aliases()) {
				const aliasPath = prefix ? `${prefix} ${alias}` : alias;
				commands.add(aliasPath);
				flagsByCommand.set(aliasPath, flags);
				walk(sub, aliasPath, flags);
			}
			walk(sub, path, flags);
		}
	};
	walk(program, "", rootFlags);
	return { commands, flagsByCommand, rootFlags };
}

function optionLongs(cmd: Command): string[] {
	return cmd.options.map((option) => option.long).filter((long): long is string => Boolean(long));
}

// Only inspect invocations in code context (inline code spans and fenced
// blocks), never prose, so a sentence like "controlling agent-board work" is
// not misread as a command.
function extractInvocations(text: string): string[] {
	const out: string[] = [];
	const add = (segment: string): void => {
		const trimmed = segment.trim();
		if (trimmed.startsWith("agent-board ")) out.push(trimmed.slice("agent-board".length).trim());
	};
	for (const fence of text.matchAll(/```[\s\S]*?```/g)) {
		for (const line of fence[0].split("\n")) {
			const idx = line.indexOf("agent-board ");
			if (idx >= 0) add(line.slice(idx));
		}
	}
	for (const inline of text.matchAll(/`([^`\n]+)`/g)) {
		add(inline[1] ?? "");
	}
	return out;
}

function checkInvocation(invocation: string, source: string, surface: CliSurface): DriftIssue[] {
	const issues: DriftIssue[] = [];
	const snippet = `agent-board ${invocation}`.trim();
	// Drop trailing comments / shell separators so values and prose don't leak in.
	const segment = invocation.split(/\s+#|[|;&]/)[0] ?? invocation;
	const tokens = segment.trim().split(/\s+/).filter(Boolean);
	const first = tokens[0];
	if (!first) return issues;

	let path = "";
	for (const token of tokens) {
		if (isPlaceholderOrFlag(token)) break;
		const candidate = path ? `${path} ${token}` : token;
		if (!surface.commands.has(candidate)) break;
		path = candidate;
	}

	// A leading real word that resolves to no command is a stale command name.
	if (path === "" && !isPlaceholderOrFlag(first)) {
		issues.push({ source, kind: "unknown-command", token: first, invocation: snippet });
		return issues;
	}

	const allowed = path ? surface.flagsByCommand.get(path)! : surface.rootFlags;
	for (const token of tokens) {
		const flag = normalizeFlag(token);
		if (!flag || flag === "--help" || flag === "--version") continue;
		if (!allowed.has(flag)) {
			issues.push({ source, kind: "unknown-flag", token: flag, invocation: snippet });
		}
	}
	return issues;
}

// Tokens that are not literal command words: flags, <placeholders>, $vars,
// quoted strings, [optional] groups, and slash-shorthands like "cat/write".
function isPlaceholderOrFlag(token: string): boolean {
	return /^[-<$"'[]/.test(token) || token.includes("/");
}

function normalizeFlag(token: string): string | null {
	if (!token.startsWith("--")) return null;
	const flag = token.split("=")[0]!;
	if (flag === "--" || /[<>${}'"]/.test(flag)) return null;
	return flag;
}
