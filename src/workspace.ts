import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, symlink } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import type { OverlayScope, ProjectConfig, Registry, RegistryProject, Workspace } from "./types.js";
import { atomicWrite, ensureDir, getHomeRoot, nowIso, projectSlugFromCwd, slugify } from "./utils.js";
import {
	configSkillReadme,
	flowOrchestrationSkillReadme,
	pmOrchestratorSkillReadme,
	researchSkillAgents,
	researchSkillReadme,
	researchWorkflowSkillReadme,
	reviewWorkflowSkillReadme,
	skillAgents,
	skillReadme,
	taskWorkflowReference,
	workerSkillAgents,
	workerSkillReadme,
} from "./skills.js";

const DEFAULT_GOAL = "main";

export const BUNDLED_SKILLS = ["agent-board", "agent-board-worker", "agent-board-research"] as const;

const SKILL_RUNTIMES = ["claude", "agents", "cursor"] as const;

export interface ResolveWorkspaceOptions {
	projectSlug?: string;
	goalSlug?: string;
}

export interface GoalInfo {
	id: string;
	title: string;
	active: boolean;
	path: string;
}

export async function initWorkspace(
	cwd: string,
	projectSlug = projectSlugFromCwd(cwd),
): Promise<{ workspace: Workspace; warnings: string[] }> {
	const root = getHomeRoot();
	const repoPath = resolve(cwd);
	const projectPath = join(root, "projects", projectSlug);
	const warnings: string[] = [];
	const now = nowIso();

	await ensureRootLayout(root);
	await ensureProjectLayout(projectPath);
	await installBundledSkills(root);

	const existing = await readProjectConfig(projectPath).catch(() => null);
	const project: ProjectConfig = {
		slug: projectSlug,
		repo_path: repoPath,
		active_goal: existing?.active_goal || DEFAULT_GOAL,
		related_projects: existing?.related_projects ?? [],
		created: existing?.created || now,
		updated: now,
	};
	await writeProjectConfig(projectPath, project);
	await upsertRegistryProject(root, {
		slug: projectSlug,
		repo_path: repoPath,
		project_path: projectPath,
	});
	await ensureGoal(projectPath, project.active_goal, project.active_goal === DEFAULT_GOAL ? "Main" : project.active_goal);

	return {
		workspace: resolveWorkspace(repoPath, {
			projectSlug,
			goalSlug: project.active_goal,
		}),
		warnings,
	};
}

export function resolveWorkspace(
	cwd: string,
	options: ResolveWorkspaceOptions = {},
): Workspace {
	const root = getHomeRoot();
	const projectSlug = options.projectSlug
		?? process.env.AGENT_BOARD_PROJECT
		?? resolveProjectSlug(root, cwd);
	const projectPath = join(root, "projects", projectSlug);
	const project = readProjectConfigSync(projectPath);
	const goalSlug = options.goalSlug
		?? process.env.AGENT_BOARD_GOAL
		?? project.active_goal
		?? DEFAULT_GOAL;
	const goalPath = join(projectPath, "goals", goalSlug);
	if (!existsSync(goalPath)) {
		throw new Error(`Goal not found: ${goalSlug}`);
	}
	return {
		root,
		projectSlug,
		projectPath,
		repoPath: process.env.AGENT_BOARD_REPO ? resolve(process.env.AGENT_BOARD_REPO) : project.repo_path,
		goalSlug,
		goalPath,
		cwd,
		project,
	};
}

export async function listProjects(root = getHomeRoot()): Promise<RegistryProject[]> {
	const registry = await readRegistry(root);
	return Object.values(registry.projects).sort((a, b) => a.slug.localeCompare(b.slug));
}

export async function listGoals(workspace: Workspace): Promise<GoalInfo[]> {
	const goalsRoot = join(workspace.projectPath, "goals");
	const entries = await readdir(goalsRoot, { withFileTypes: true }).catch(() => []);
	const goals = entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
	return Promise.all(
		goals.map(async (id) => ({
			id,
			title: await readGoalTitle(join(goalsRoot, id, "goal.md"), id),
			active: id === workspace.project.active_goal,
			path: join(goalsRoot, id),
		})),
	);
}

export async function createGoal(
	workspace: Workspace,
	title: string,
	id = slugify(title),
): Promise<GoalInfo> {
	const goalPath = await ensureGoal(workspace.projectPath, id, title);
	return {
		id,
		title,
		active: id === workspace.project.active_goal,
		path: goalPath,
	};
}

export async function useGoal(
	workspace: Workspace,
	id: string,
): Promise<ProjectConfig> {
	const goalPath = join(workspace.projectPath, "goals", id);
	if (!existsSync(goalPath)) throw new Error(`Goal not found: ${id}`);
	const next: ProjectConfig = {
		...workspace.project,
		active_goal: id,
		updated: nowIso(),
	};
	await writeProjectConfig(workspace.projectPath, next);
	return next;
}

export function overlayDir(
	workspace: Workspace,
	scope: OverlayScope,
	kind: "specs" | "knowledge",
): string {
	if (scope === "global") return join(workspace.root, kind);
	if (scope === "project") return join(workspace.projectPath, kind);
	return join(workspace.goalPath, kind);
}

export function taskDir(workspace: Workspace): string {
	return join(workspace.goalPath, "tasks");
}

export function workspaceForGoal(
	workspace: Workspace,
	projectSlug: string,
	goalSlug: string,
): Workspace {
	return resolveWorkspace(workspace.cwd, { projectSlug, goalSlug });
}

export async function installGlobalSkills(): Promise<string[]> {
	const root = getHomeRoot();
	const warnings: string[] = [];
	await ensureRootLayout(root);
	await installBundledSkills(root);
	for (const skill of BUNDLED_SKILLS) {
		const skillRoot = join(root, "skills", skill);
		for (const runtime of SKILL_RUNTIMES) {
			await linkIfSafe(skillRoot, join(homedir(), `.${runtime}`, "skills", skill), warnings);
		}
	}
	return warnings;
}

export interface SkillLinkStatus {
	skill: string;
	runtime: string;
	path: string;
	state: "linked" | "missing" | "other";
}

export async function skillsDoctor(): Promise<SkillLinkStatus[]> {
	const root = getHomeRoot();
	const statuses: SkillLinkStatus[] = [];
	for (const skill of BUNDLED_SKILLS) {
		const target = join(root, "skills", skill);
		for (const runtime of SKILL_RUNTIMES) {
			const linkPath = join(homedir(), `.${runtime}`, "skills", skill);
			let state: SkillLinkStatus["state"] = "missing";
			if (existsSync(linkPath)) {
				const stat = lstatSync(linkPath);
				state =
					stat.isSymbolicLink() && resolve(dirname(linkPath), readlinkSync(linkPath)) === target
						? "linked"
						: "other";
			}
			statuses.push({ skill, runtime, path: linkPath, state });
		}
	}
	return statuses;
}

export async function migrateWorkspace(
	cwd: string,
	projectSlug = projectSlugFromCwd(cwd),
): Promise<{ workspace: Workspace; migrated: string[] }> {
	const root = getHomeRoot();
	const projectPath = join(root, "projects", projectSlug);
	const repoPath = resolve(cwd);
	const migrated: string[] = [];
	await ensureRootLayout(root);
	await ensureProjectLayout(projectPath);
	await installBundledSkills(root);

	const existing = await readProjectConfig(projectPath).catch(() => null);
	const now = nowIso();
	const project: ProjectConfig = {
		slug: projectSlug,
		repo_path: existing?.repo_path || repoPath,
		active_goal: existing?.active_goal || DEFAULT_GOAL,
		related_projects: existing?.related_projects ?? [],
		created: existing?.created || now,
		updated: now,
	};
	await writeProjectConfig(projectPath, project);
	await upsertRegistryProject(root, {
		slug: projectSlug,
		repo_path: project.repo_path,
		project_path: projectPath,
	});

	const goalPath = await ensureGoal(projectPath, DEFAULT_GOAL, "Main");
	for (const name of ["tasks", "specs", "knowledge"] as const) {
		const from = join(projectPath, name);
		const to = join(goalPath, name);
		if (existsSync(from)) {
			await copyDirContents(from, to);
			migrated.push(name);
		}
	}

	return {
		workspace: resolveWorkspace(project.repo_path, {
			projectSlug,
			goalSlug: project.active_goal,
		}),
		migrated,
	};
}

async function ensureRootLayout(root: string): Promise<void> {
	for (const dir of ["projects", "specs", "knowledge", "skills"]) {
		await ensureDir(join(root, dir));
	}
	await writeIfMissing(join(root, "registry.json"), JSON.stringify({ projects: {} }, null, 2));
}

async function ensureProjectLayout(projectPath: string): Promise<void> {
	for (const dir of ["specs", "knowledge", "flows", "goals"]) {
		await ensureDir(join(projectPath, dir));
	}
}

async function ensureGoal(
	projectPath: string,
	id: string,
	title: string,
): Promise<string> {
	const goalPath = join(projectPath, "goals", id);
	for (const dir of ["tasks", "specs", "knowledge"]) {
		await ensureDir(join(goalPath, dir));
	}
	await writeIfMissing(join(goalPath, "goal.md"), `---\nid: "${id}"\ntitle: "${title}"\n---\n\n# ${title}\n`);
	await writeIfMissing(join(goalPath, "status.md"), `# Status\n`);
	return goalPath;
}

async function installBundledSkills(root: string): Promise<void> {
	const skillRoot = join(root, "skills", "agent-board");
	await ensureDir(join(skillRoot, "references"));
	await writeBundledSkill(join(skillRoot, "SKILL.md"), skillReadme);
	await writeBundledSkill(join(skillRoot, "AGENTS.md"), skillAgents);
	await writeBundledSkill(join(skillRoot, "references", "config.md"), configSkillReadme);
	await writeBundledSkill(join(skillRoot, "references", "flow-orchestration.md"), flowOrchestrationSkillReadme);
	await writeBundledSkill(join(skillRoot, "references", "pm-orchestrator.md"), pmOrchestratorSkillReadme);
	await writeBundledSkill(join(skillRoot, "references", "task-workflow.md"), taskWorkflowReference);
	await writeBundledSkill(join(skillRoot, "references", "research-workflow.md"), researchWorkflowSkillReadme);
	await writeBundledSkill(join(skillRoot, "references", "review-workflow.md"), reviewWorkflowSkillReadme);

	const workerRoot = join(root, "skills", "agent-board-worker");
	await ensureDir(workerRoot);
	await writeBundledSkill(join(workerRoot, "SKILL.md"), workerSkillReadme);
	await writeBundledSkill(join(workerRoot, "AGENTS.md"), workerSkillAgents);

	const researchRoot = join(root, "skills", "agent-board-research");
	await ensureDir(researchRoot);
	await writeBundledSkill(join(researchRoot, "SKILL.md"), researchSkillReadme);
	await writeBundledSkill(join(researchRoot, "AGENTS.md"), researchSkillAgents);
}

async function readProjectConfig(projectPath: string): Promise<ProjectConfig> {
	return JSON.parse(await readFile(join(projectPath, "project.json"), "utf-8")) as ProjectConfig;
}

function readProjectConfigSync(projectPath: string): ProjectConfig {
	const path = join(projectPath, "project.json");
	if (!existsSync(path)) {
		throw new Error("No agent-board project found. Run `agent-board init`.");
	}
	return JSON.parse(readFileSync(path, "utf-8")) as ProjectConfig;
}

async function writeProjectConfig(projectPath: string, project: ProjectConfig): Promise<void> {
	await atomicWrite(join(projectPath, "project.json"), JSON.stringify(project, null, 2));
}

async function readRegistry(root: string): Promise<Registry> {
	const path = join(root, "registry.json");
	if (!existsSync(path)) return { projects: {} };
	return JSON.parse(await readFile(path, "utf-8")) as Registry;
}

function readRegistrySync(root: string): Registry {
	const path = join(root, "registry.json");
	if (!existsSync(path)) return { projects: {} };
	return JSON.parse(readFileSync(path, "utf-8")) as Registry;
}

async function upsertRegistryProject(root: string, project: RegistryProject): Promise<void> {
	const registry = await readRegistry(root);
	registry.projects[project.slug] = project;
	await atomicWrite(join(root, "registry.json"), JSON.stringify(registry, null, 2));
}

function resolveProjectSlug(root: string, cwd: string): string {
	const registry = readRegistrySync(root);
	const current = resolve(cwd);
	const matches = Object.values(registry.projects)
		.filter((project) => isInside(current, project.repo_path))
		.sort((a, b) => b.repo_path.length - a.repo_path.length);
	const slug = matches[0]?.slug;
	if (!slug) throw new Error("No agent-board project found. Run `agent-board init`.");
	return slug;
}

function isInside(path: string, parent: string): boolean {
	const rel = relative(resolve(parent), resolve(path));
	return rel === "" || (!!rel && !rel.startsWith("..") && !rel.startsWith("/"));
}

async function linkIfSafe(
	target: string,
	linkPath: string,
	warnings: string[],
): Promise<void> {
	if (existsSync(linkPath)) {
		const stat = lstatSync(linkPath);
		if (stat.isSymbolicLink() && resolve(dirname(linkPath), readlinkSync(linkPath)) === target) {
			return;
		}
		warnings.push(`Skipped existing path: ${linkPath}`);
		return;
	}
	await mkdir(dirname(linkPath), { recursive: true });
	await symlink(target, linkPath, "dir");
}

async function copyDirContents(from: string, to: string): Promise<void> {
	await ensureDir(to);
	const entries = await readdir(from, { withFileTypes: true }).catch(() => []);
	for (const entry of entries) {
		const source = join(from, entry.name);
		const target = join(to, entry.name);
		if (entry.isDirectory()) {
			await copyDirContents(source, target);
		} else if (entry.isFile()) {
			await copyFile(source, target);
		}
	}
}

async function readGoalTitle(path: string, fallback: string): Promise<string> {
	const content = await readFile(path, "utf-8").catch(() => "");
	const match = /^title:\s*"?([^"\n]+)"?/m.exec(content);
	return match?.[1] ?? fallback;
}

async function writeIfMissing(path: string, content: string): Promise<void> {
	if (existsSync(path)) return;
	await atomicWrite(path, content);
}

async function writeBundledSkill(path: string, content: string): Promise<void> {
	await atomicWrite(path, content);
}
