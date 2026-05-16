import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { readScopedDocuments, resolveSpecRefs } from "./documents.js";
import type { OverlayScope, TaskFile, Workflow, WorkflowItem, WorkflowStep, Workspace } from "./types.js";
import { overlayDir } from "./workspace.js";

export async function listWorkflows(workspace: Workspace): Promise<string[]> {
	const { readdir } = await import("node:fs/promises");
	const names = new Set<string>();
	for (const scope of ["global", "project", "goal"] as OverlayScope[]) {
		const entries = await readdir(overlayDir(workspace, scope, "workflows")).catch(() => []);
		for (const entry of entries) {
			if (entry.endsWith(".yml") || entry.endsWith(".yaml")) {
				names.add(entry.replace(/\.ya?ml$/, ""));
			}
		}
	}
	return [...names].sort();
}

export async function readWorkflow(
	workspace: Workspace,
	name: string,
): Promise<Workflow> {
	const path = findWorkflowPath(workspace, name);
	const content = await readFile(path, "utf-8");
	return parseWorkflow(content);
}

export function parseWorkflow(input: string): Workflow {
	const lines = input.replace(/\r\n/g, "\n").split("\n");
	const workflow: Workflow = { name: "", skills: [], context: [], steps: [] };

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		if (!line.trim() || line.trimStart().startsWith("#")) continue;

		if (line.startsWith("name:")) workflow.name = scalar(line.slice(5));
		else if (line.startsWith("description:")) workflow.description = scalar(line.slice(12));
		else if (line.startsWith("default_agent:")) workflow.default_agent = scalar(line.slice(14));
		else if (line.startsWith("skills:")) {
			workflow.skills = readInlineOrBlockList(lines, i, line.slice(7), 2);
			if (line.trim() === "skills:") {
				const result = readStringList(lines, i + 1, 2);
				i = result.index - 1;
			}
		}
		else if (line === "context:") {
			const result = readStringList(lines, i + 1, 2);
			workflow.context = result.items;
			i = result.index - 1;
		} else if (line === "steps:") {
			const result = readSteps(lines, i + 1);
			workflow.steps = result.steps;
			i = result.index - 1;
		}
	}

	if (!workflow.name) throw new Error("Workflow is missing name");
	if (workflow.steps.length === 0) throw new Error("Workflow has no steps");
	return workflow;
}

export async function renderPrompt(input: {
	workspace: Workspace;
	task: TaskFile;
	runPath: string;
	workflow: Workflow;
	step: WorkflowStep;
}): Promise<string> {
	const vars = {
		"task.id": input.task.meta.id,
		"task.title": input.task.meta.title,
		"task.status": input.task.meta.status,
		"workspace.path": input.workspace.projectPath,
		"repo.path": input.workspace.repoPath,
		"project.id": input.workspace.projectSlug,
		"goal.id": input.workspace.goalSlug,
		"run.path": input.runPath,
	};
	const prompt = renderTemplate(input.step.prompt ?? "", vars);
	const context = await renderContext(input.workspace, input.task, input.runPath, input.workflow.context, vars);
	const skills = unique([
		...input.task.meta.skills,
		...input.workflow.skills,
		...input.step.skills,
	]);
	const guidance = renderStepGuidance({
		role: input.step.role,
		intent: input.step.intent,
		skills,
		taskId: input.task.meta.id,
		projectSlug: input.workspace.projectSlug,
		goalSlug: input.workspace.goalSlug,
	});
	return `${prompt.trim()}\n\n${guidance}\n\n${context}`.trimEnd() + "\n";
}

function findWorkflowPath(workspace: Workspace, name: string): string {
	for (const scope of ["goal", "project", "global"] as OverlayScope[]) {
		for (const ext of [".yml", ".yaml"]) {
			const path = join(overlayDir(workspace, scope, "workflows"), `${name}${ext}`);
			if (existsSync(path)) return path;
		}
	}
	throw new Error(`Workflow not found: ${name}`);
}

function readStringList(
	lines: string[],
	start: number,
	indent: number,
): { items: string[]; index: number } {
	const items: string[] = [];
	let i = start;
	for (; i < lines.length; i++) {
		const line = lines[i]!;
		if (!line.trim()) continue;
		if (countIndent(line) < indent) break;
		const marker = `${" ".repeat(indent)}- `;
		if (!line.startsWith(marker)) break;
		items.push(scalar(line.slice(marker.length)));
	}
	return { items, index: i };
}

function readInlineOrBlockList(
	lines: string[],
	index: number,
	raw: string,
	indent: number,
): string[] {
	const trimmed = raw.trim();
	if (trimmed) return parseInlineList(trimmed);
	return readStringList(lines, index + 1, indent).items;
}

function readSteps(
	lines: string[],
	start: number,
): { steps: WorkflowItem[]; index: number } {
	const steps: WorkflowItem[] = [];
	let i = start;
	for (; i < lines.length; i++) {
		const line = lines[i]!;
		if (!line.trim()) continue;
		if (!line.startsWith("  - ")) break;

		const step: Partial<WorkflowStep> & { parallel?: WorkflowStep[] } = {
			skills: [],
		};
		const rest = line.slice(4);
		if (rest.startsWith("id:")) step.id = scalar(rest.slice(3));
		i++;
		for (; i < lines.length; i++) {
			const child = lines[i]!;
			if (!child.trim()) continue;
			if (child.startsWith("  - ")) {
				i--;
				break;
			}
			if (!child.startsWith("    ")) break;
			const trimmed = child.slice(4);
			if (trimmed.startsWith("role:")) step.role = scalar(trimmed.slice(5));
			else if (trimmed.startsWith("agent:")) step.agent = scalar(trimmed.slice(6));
			else if (trimmed.startsWith("intent:")) step.intent = scalar(trimmed.slice(7));
			else if (trimmed.startsWith("skills:")) {
				step.skills = readInlineOrBlockList(lines, i, trimmed.slice(7), 6);
				if (trimmed === "skills:") {
					const result = readStringList(lines, i + 1, 6);
					i = result.index - 1;
				}
			}
			else if (trimmed.startsWith("prompt: |")) {
				const block = readBlock(lines, i + 1, 6);
				step.prompt = block.value;
				i = block.index - 1;
			} else if (trimmed === "parallel:") {
				const parallel = readParallelSteps(lines, i + 1);
				step.parallel = parallel.steps;
				i = parallel.index - 1;
			}
		}
		if (!step.id) throw new Error("Workflow step missing id");
		if (step.parallel) steps.push({ id: step.id, parallel: step.parallel });
		else steps.push(step as WorkflowStep);
	}
	return { steps, index: i };
}

function readParallelSteps(
	lines: string[],
	start: number,
): { steps: WorkflowStep[]; index: number } {
	const steps: WorkflowStep[] = [];
	let i = start;
	for (; i < lines.length; i++) {
		const line = lines[i]!;
		if (!line.trim()) continue;
		if (!line.startsWith("      - ")) break;
		const step: Partial<WorkflowStep> = {};
		const rest = line.slice(8);
		if (rest.startsWith("id:")) step.id = scalar(rest.slice(3));
		i++;
		for (; i < lines.length; i++) {
			const child = lines[i]!;
			if (!child.trim()) continue;
			if (child.startsWith("      - ")) {
				i--;
				break;
			}
			if (!child.startsWith("        ")) break;
			const trimmed = child.slice(8);
			if (trimmed.startsWith("role:")) step.role = scalar(trimmed.slice(5));
			else if (trimmed.startsWith("agent:")) step.agent = scalar(trimmed.slice(6));
			else if (trimmed.startsWith("intent:")) step.intent = scalar(trimmed.slice(7));
			else if (trimmed.startsWith("skills:")) {
				step.skills = readInlineOrBlockList(lines, i, trimmed.slice(7), 10);
				if (trimmed === "skills:") {
					const result = readStringList(lines, i + 1, 10);
					i = result.index - 1;
				}
			}
			else if (trimmed.startsWith("prompt: |")) {
				const block = readBlock(lines, i + 1, 10);
				step.prompt = block.value;
				i = block.index - 1;
			}
		}
		if (!step.id) throw new Error("Workflow parallel step missing id");
		steps.push({ skills: [], ...step } as WorkflowStep);
	}
	return { steps, index: i };
}

function readBlock(
	lines: string[],
	start: number,
	indent: number,
): { value: string; index: number } {
	const out: string[] = [];
	let i = start;
	for (; i < lines.length; i++) {
		const line = lines[i]!;
		if (!line.trim()) {
			out.push("");
			continue;
		}
		if (countIndent(line) < indent) break;
		out.push(line.slice(indent));
	}
	return { value: out.join("\n").trimEnd(), index: i };
}

async function renderContext(
	workspace: Workspace,
	task: TaskFile,
	runPath: string,
	entries: string[],
	vars: Record<string, string>,
): Promise<string> {
	const sections = ["# Context"];
	for (const entry of entries) {
		const rendered = renderTemplate(entry, vars);
		const section = await renderContextEntry(workspace, task, runPath, rendered);
		if (section) sections.push(section);
	}
	sections.push(`\n## Run Folder\n\n${runPath}`);
	return sections.join("\n");
}

async function renderContextEntry(
	workspace: Workspace,
	task: TaskFile,
	runPath: string,
	entry: string,
): Promise<string> {
	if (entry.startsWith("repo:")) {
		const repoEntry = entry.slice("repo:".length);
		const path = join(workspace.repoPath, repoEntry);
		const text = await readContextPath(path);
		return text ? `\n## repo:${repoEntry}\n\n${text}` : "";
	}
	if (entry === "task:current") {
		const text = await readContextPath(task.path);
		return text ? `\n## task:${workspace.projectSlug}/${workspace.goalSlug}/${task.meta.id}\n\n${text}` : "";
	}
	if (entry === "specs:linked") {
		const docs = await resolveSpecRefs(workspace, task.meta.specs);
		if (!docs.length) return "";
		return `\n## specs:linked\n\n${docs.map((doc) => renderDocumentContext(doc.scope, doc.meta.id, doc.body)).join("\n\n")}`;
	}
	if (entry.startsWith("specs:")) {
		const scope = parseScopeAlias(entry, "specs");
		const docs = await readScopedDocuments(workspace, "specs", scope);
		return docs.length ? `\n## specs:${scope}\n\n${docs.map((doc) => renderDocumentContext(scope, doc.meta.id, doc.body)).join("\n\n")}` : "";
	}
	if (entry.startsWith("knowledge:")) {
		const scope = parseScopeAlias(entry, "knowledge");
		const docs = await readScopedDocuments(workspace, "knowledge", scope);
		return docs.length ? `\n## knowledge:${scope}\n\n${docs.map((doc) => renderDocumentContext(scope, doc.meta.id, doc.body)).join("\n\n")}` : "";
	}
	if (entry === "runs:current") {
		const text = await readContextPath(runPath);
		return text ? `\n## runs:current\n\n${text}` : `\n## runs:current\n\n${runPath}`;
	}
	const path = join(workspace.repoPath, entry);
	const text = await readContextPath(path);
	return text ? `\n## ${relative(workspace.repoPath, path) || entry}\n\n${text}` : "";
}

async function readContextPath(path: string): Promise<string> {
	const { stat, readdir, readFile } = await import("node:fs/promises");
	const info = await stat(path).catch(() => null);
	if (!info) return "";
	if (info.isFile()) return readFile(path, "utf-8");
	if (!info.isDirectory()) return "";
	const files = (await readdir(path, { withFileTypes: true }))
		.filter((entry) => entry.isFile() && /\.(md|log|txt|json)$/.test(entry.name))
		.map((entry) => join(path, entry.name))
		.sort();
	const parts = await Promise.all(
		files.map(async (file) => `### ${file.split("/").at(-1)}\n\n${await readFile(file, "utf-8")}`),
	);
	return parts.join("\n\n");
}

function renderDocumentContext(scope: OverlayScope, id: string, body: string): string {
	return `### ${scope}/${id}\n\n${body}`;
}

function parseScopeAlias(entry: string, prefix: "specs" | "knowledge"): OverlayScope {
	const scope = entry.slice(prefix.length + 1);
	if (scope === "global" || scope === "project" || scope === "goal") return scope;
	throw new Error(`Invalid context alias: ${entry}`);
}

function renderTemplate(value: string, vars: Record<string, string>): string {
	return value.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, key: string) => vars[key.trim()] ?? "");
}

function renderStepGuidance(input: {
	role?: string;
	intent?: string;
	skills: string[];
	taskId: string;
	projectSlug: string;
	goalSlug: string;
}): string {
	const lines = ["# Agent Board Run Guidance", ""];
	lines.push(`Project: ${input.projectSlug}`);
	lines.push(`Goal: ${input.goalSlug}`);
	lines.push(`Task: ${input.taskId}`);
	if (input.role) lines.push(`Role: ${input.role}`);
	if (input.intent) lines.push(`Intent: ${input.intent}`);
	if (input.skills.length) {
		lines.push("", "## Recommended Skills", "");
		for (const skill of input.skills) lines.push(`- ${skill}`);
	}
	lines.push(
		"",
		"## Useful Commands",
		"",
		"- `agent-board status`",
		"- `agent-board plan --related`",
		"- `agent-board tasks`",
		"- `agent-board spec new <title> --scope project`",
		"- `agent-board knowledge add <title> --kind note --scope project`",
		"- `agent-board link <from-task> --blocks <to-task>`",
		"- `agent-board block <task-id> \"<reason>\"`",
	);
	return lines.join("\n");
}

function scalar(value: string): string {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function countIndent(line: string): number {
	return line.length - line.trimStart().length;
}

function parseInlineList(raw: string): string[] {
	if (!raw) return [];
	if (raw.startsWith("[") && raw.endsWith("]")) {
		const inner = raw.slice(1, -1).trim();
		if (!inner) return [];
		return inner.split(",").map((item) => scalar(item.trim())).filter(Boolean);
	}
	return [scalar(raw)].filter(Boolean);
}

function unique(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))];
}
