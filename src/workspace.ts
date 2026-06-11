import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, stat, symlink } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { parseFrontmatter } from "./markdown.js";
import type { OverlayScope, ProjectConfig, Registry, RegistryProject, Workspace, WorkspaceMode } from "./types.js";
import { atomicWrite, ensureDir, findLocalRoot, findWorktreeMainRoot, getHomeRoot, listFiles, nowIso, projectSlugFromCwd, resolveRoot, slugify } from "./utils.js";
import { gitRoot } from "./git.js";
import {
	configSkillReadme,
	designReviewSkillAgents,
	designReviewSkillReadme,
	designWireframeSkillAgents,
	designWireframeSkillReadme,
	flowOrchestrationSkillReadme,
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
	taskWorkflowReference,
	workerSkillAgents,
	workerSkillReadme,
} from "./skills.js";

const DEFAULT_GOAL = "main";

const BOARD_DIR_NAME = ".agent-board";

// Committed into a local board so transient run artifacts (and atomic-write temp
// files) never get versioned alongside the board's durable state.
const LOCAL_GITIGNORE = [
	"# agent-board — transient run artifacts, safe to ignore",
	"goals/*/flows/runs/",
	"*.tmp.*",
	"",
].join("\n");

export const BUNDLED_SKILLS = ["agent-board", "agent-board-worker", "agent-board-research", "agent-board-maintenance", "agent-board-design-wireframe", "agent-board-design-review"] as const;

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

export interface InitWorkspaceOptions {
	projectSlug?: string;
	mode?: WorkspaceMode;
}

export async function initWorkspace(
	cwd: string,
	options: InitWorkspaceOptions = {},
): Promise<{ workspace: Workspace; warnings: string[] }> {
	if (options.mode === "local") return initLocalWorkspace(cwd, options.projectSlug);
	return initHomeWorkspace(cwd, options.projectSlug);
}

async function initHomeWorkspace(
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

// A repo-local board: a single project flattened into <repo>/.agent-board, with
// no projects/<slug> wrapper, no registry, and no skills copy (those stay global
// in home). repo_path is derived from the board's location, never stored, so the
// board is portable and git-versionable with the repo.
async function initLocalWorkspace(
	cwd: string,
	projectSlug?: string,
): Promise<{ workspace: Workspace; warnings: string[] }> {
	const repoPath = (await gitRoot(cwd)) ?? resolve(cwd);
	const root = join(repoPath, BOARD_DIR_NAME);
	const slug = projectSlug ?? projectSlugFromCwd(repoPath);
	const now = nowIso();

	await ensureProjectLayout(root);
	const existing = await readProjectConfig(root).catch(() => null);
	const project: ProjectConfig = {
		slug,
		active_goal: existing?.active_goal || DEFAULT_GOAL,
		related_projects: existing?.related_projects ?? [],
		created: existing?.created || now,
		updated: now,
	};
	await writeProjectConfig(root, project);
	await ensureGoal(root, project.active_goal, project.active_goal === DEFAULT_GOAL ? "Main" : project.active_goal);
	await writeIfMissing(join(root, ".gitignore"), LOCAL_GITIGNORE);

	const goalSlug = project.active_goal;
	return {
		workspace: {
			root,
			mode: "local",
			projectSlug: slug,
			projectPath: root,
			repoPath,
			goalSlug,
			goalPath: join(root, "goals", goalSlug),
			cwd: resolve(cwd),
			project,
		},
		warnings: [],
	};
}

export function resolveWorkspace(
	cwd: string,
	options: ResolveWorkspaceOptions = {},
): Workspace {
	const { root, mode } = resolveRoot(cwd);
	let projectSlug: string;
	let projectPath: string;
	let project: ProjectConfig;
	if (mode === "local") {
		projectPath = root;
		project = readProjectConfigSync(projectPath);
		projectSlug = options.projectSlug ?? project.slug;
	} else {
		projectSlug = options.projectSlug
			?? process.env.AGENT_BOARD_PROJECT
			?? resolveProjectSlug(root, cwd);
		projectPath = join(root, "projects", projectSlug);
		project = readProjectConfigSync(projectPath);
	}
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
		mode,
		projectSlug,
		projectPath,
		repoPath: resolveRepoPath(project, mode, root, cwd),
		goalSlug,
		goalPath,
		cwd,
		project,
	};
}

// AGENT_BOARD_REPO wins (explicit worktree routing), then the canonical repo:
// a stored repo_path for home boards, the board's parent dir for local boards.
// When cwd sits in a linked worktree of that canonical repo, git operations
// must target the worktree the agent actually works in, not the main checkout
// another agent may occupy.
function resolveRepoPath(project: ProjectConfig, mode: WorkspaceMode, root: string, cwd: string): string {
	if (process.env.AGENT_BOARD_REPO) return resolve(process.env.AGENT_BOARD_REPO);
	const canonical = project.repo_path
		? resolve(project.repo_path)
		: mode === "local"
			? dirname(root)
			: null;
	if (!canonical) return resolve(cwd);
	if (isInside(cwd, canonical)) return canonical;
	const worktree = findWorktreeMainRoot(cwd);
	if (worktree && isInside(worktree.mainRoot, canonical)) return worktree.worktreeRoot;
	return canonical;
}

export async function listProjects(cwd = process.cwd()): Promise<RegistryProject[]> {
	const { root, mode } = resolveRoot(cwd);
	if (mode === "local") {
		const project = await readProjectConfig(root).catch(() => null);
		if (!project) return [];
		return [{ slug: project.slug, repo_path: dirname(root), project_path: root }];
	}
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
	options: { force?: boolean; interactive?: boolean } = {},
): Promise<ProjectConfig> {
	const goalPath = join(workspace.projectPath, "goals", id);
	if (!existsSync(goalPath)) throw new Error(`Goal not found: ${id}`);
	const current = workspace.project.active_goal;
	if (current === id) return workspace.project;
	if (!options.force) {
		const activity = await goalActiveWork(workspace, current);
		if (activity.inProgressTasks > 0 || activity.incompleteFlowRuns > 0) {
			throw new Error(goalUseRefusal(workspace, current, id, activity));
		}
		if (!options.interactive) {
			throw new Error(goalUseRefusal(workspace, current, id));
		}
	}
	const next: ProjectConfig = {
		...workspace.project,
		active_goal: id,
		updated: nowIso(),
	};
	await writeProjectConfig(workspace.projectPath, next);
	return next;
}

interface GoalActiveWork {
	inProgressTasks: number;
	incompleteFlowRuns: number;
	assignees: string[];
}

async function goalActiveWork(workspace: Workspace, goalId: string): Promise<GoalActiveWork> {
	const goalPath = join(workspace.projectPath, "goals", goalId);
	const [inProgress, incompleteFlowRuns] = await Promise.all([
		inProgressTasks(join(goalPath, "tasks")),
		incompleteFlowRunCount(join(goalPath, "flows", "runs")),
	]);
	return { ...inProgress, incompleteFlowRuns };
}

async function inProgressTasks(tasksDir: string): Promise<{ inProgressTasks: number; assignees: string[] }> {
	const files = await listFiles(tasksDir, ".md");
	let inProgressTasks = 0;
	const assignees = new Set<string>();
	for (const file of files) {
		const raw = await readFile(file, "utf-8").catch(() => "");
		if (!raw) continue;
		try {
			const doc = parseFrontmatter<Record<string, unknown>>(raw);
			if (doc.meta.status !== "in_progress") continue;
			inProgressTasks++;
			if (typeof doc.meta.assignee === "string" && doc.meta.assignee.trim()) {
				assignees.add(doc.meta.assignee.trim());
			}
		} catch {}
	}
	return { inProgressTasks, assignees: [...assignees].sort((a, b) => a.localeCompare(b)) };
}

async function incompleteFlowRunCount(runsDir: string): Promise<number> {
	const entries = await readdir(runsDir, { withFileTypes: true }).catch(() => []);
	let count = 0;
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const runPath = join(runsDir, entry.name);
		const hasSummary = existsSync(join(runPath, "summary.md"));
		const hasEvents = await stat(join(runPath, "events.jsonl")).then(() => true, () => false);
		if (!hasSummary && hasEvents) count++;
	}
	return count;
}

function goalUseRefusal(
	workspace: Workspace,
	current: string,
	next: string,
	activity?: GoalActiveWork,
): string {
	const activeBits: string[] = [];
	if (activity?.inProgressTasks) {
		const assignees = activity.assignees.length ? ` (${activity.assignees.join(", ")})` : "";
		activeBits.push(`${activity.inProgressTasks} in-progress task${activity.inProgressTasks === 1 ? "" : "s"}${assignees}`);
	}
	if (activity?.incompleteFlowRuns) {
		activeBits.push(`${activity.incompleteFlowRuns} incomplete flow run${activity.incompleteFlowRuns === 1 ? "" : "s"}`);
	}
	const reason = activeBits.length
		? ` because ${current} has active work: ${activeBits.join(", ")}`
		: " in non-interactive mode";
	return [
		`Refusing to change shared active goal from ${current} to ${next}${reason}.`,
		`Use --goal ${next} or AGENT_BOARD_GOAL=${next} for agent work instead.`,
		"Pass --force only when intentionally changing the human default.",
	].join(" ");
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
		repo_path: project.repo_path ?? repoPath,
		project_path: projectPath,
	});

	const goalPath = await ensureGoal(projectPath, DEFAULT_GOAL, "Main");
	const legacyTasks = join(projectPath, "tasks");
	if (existsSync(legacyTasks)) {
		await copyDirContents(legacyTasks, join(goalPath, "tasks"));
		await rm(legacyTasks, { recursive: true, force: true });
		migrated.push("tasks");
	}

	return {
		workspace: resolveWorkspace(project.repo_path ?? repoPath, {
			projectSlug,
			goalSlug: project.active_goal,
		}),
		migrated,
	};
}

export interface RelocateResult {
	slug: string;
	to: WorkspaceMode;
	from: string;
	target: string;
	copied: string[];
	cleaned: boolean;
	backup: string | null;
	warnings: string[];
}

const RELOCATE_TREES = ["goals", "specs", "knowledge", "wireframes", "flows"] as const;

// Move a board between home (~/.agent-board/projects/<slug>) and a repo-local
// .agent-board/. Copies the durable trees, rewrites project.json for the target
// layout (drops repo_path for local, restores it for home), and either removes
// the source (cleanup) or leaves it as a backup.
export async function relocateWorkspace(
	cwd: string,
	options: { to: WorkspaceMode; cleanup?: boolean; projectSlug?: string },
): Promise<RelocateResult> {
	const cleanup = options.cleanup ?? false;
	return options.to === "local"
		? relocateToLocal(cwd, cleanup, options.projectSlug)
		: relocateToHome(cwd, cleanup);
}

async function relocateToLocal(cwd: string, cleanup: boolean, projectSlug?: string): Promise<RelocateResult> {
	const homeRoot = getHomeRoot();
	const slug = projectSlug ?? resolveProjectSlug(homeRoot, cwd);
	const source = join(homeRoot, "projects", slug);
	const home = await readProjectConfig(source).catch(() => null);
	if (!home) throw new Error(`No home board to relocate for project: ${slug}`);
	const warnings = await sharedGlobalOverlayWarnings(homeRoot);

	const repoPath = (await gitRoot(cwd)) ?? resolve(cwd);
	const target = join(repoPath, BOARD_DIR_NAME);
	if (existsSync(target)) throw new Error(`Local board already exists: ${target}`);

	await ensureProjectLayout(target);
	const copied = await copyTrees(source, target);
	const project: ProjectConfig = {
		slug,
		active_goal: home.active_goal,
		related_projects: home.related_projects ?? [],
		created: home.created,
		updated: nowIso(),
	};
	await writeProjectConfig(target, project);
	await writeIfMissing(join(target, ".gitignore"), LOCAL_GITIGNORE);

	let cleaned = false;
	if (cleanup) {
		await rm(source, { recursive: true, force: true });
		await removeRegistryProject(homeRoot, slug);
		cleaned = true;
	}
	return { slug, to: "local", from: source, target, copied, cleaned, backup: cleaned ? null : source, warnings };
}

async function relocateToHome(cwd: string, cleanup: boolean): Promise<RelocateResult> {
	const source = findLocalRoot(cwd);
	if (!source) throw new Error(`No local board found above: ${resolve(cwd)}`);
	const local = await readProjectConfig(source).catch(() => null);
	if (!local) throw new Error(`Local board is missing project.json: ${source}`);
	const warnings = await localOverlayWarnings(source);

	const slug = local.slug;
	const repoPath = dirname(source);
	const homeRoot = getHomeRoot();
	const target = join(homeRoot, "projects", slug);

	await ensureRootLayout(homeRoot);
	await ensureProjectLayout(target);
	const copied = await copyTrees(source, target);
	const project: ProjectConfig = {
		slug,
		repo_path: repoPath,
		active_goal: local.active_goal,
		related_projects: local.related_projects ?? [],
		created: local.created,
		updated: nowIso(),
	};
	await writeProjectConfig(target, project);
	await upsertRegistryProject(homeRoot, { slug, repo_path: repoPath, project_path: target });

	let cleaned = false;
	if (cleanup) {
		await rm(source, { recursive: true, force: true });
		cleaned = true;
	}
	return { slug, to: "home", from: source, target, copied, cleaned, backup: cleaned ? null : source, warnings };
}

async function sharedGlobalOverlayWarnings(homeRoot: string): Promise<string[]> {
	const [specs, knowledge, wireframes] = await Promise.all([
		listFiles(join(homeRoot, "specs"), ".md"),
		listFiles(join(homeRoot, "knowledge"), ".md"),
		listWireframeDirs(join(homeRoot, "wireframes")),
	]);
	const parts = [
		specs.length ? `${specs.length} global spec${specs.length === 1 ? "" : "s"}` : "",
		knowledge.length ? `${knowledge.length} global knowledge note${knowledge.length === 1 ? "" : "s"}` : "",
		wireframes.length ? `${wireframes.length} global wireframe${wireframes.length === 1 ? "" : "s"}` : "",
	].filter(Boolean);
	if (!parts.length) return [];
	return [
		`Shared home overlay not copied: ${parts.join(", ")} remain in ${homeRoot} and this local board will not see them by default.`,
	];
}

async function localOverlayWarnings(localRoot: string): Promise<string[]> {
	const [specs, knowledge, wireframes] = await Promise.all([
		listFiles(join(localRoot, "specs"), ".md"),
		listFiles(join(localRoot, "knowledge"), ".md"),
		listWireframeDirs(join(localRoot, "wireframes")),
	]);
	if (specs.length + knowledge.length + wireframes.length === 0) return [];
	return [
		"Local boards store global and project specs/knowledge/wireframes in the same directory; relocate writes them into the home project overlay, not the shared home global overlay.",
	];
}

async function listWireframeDirs(root: string): Promise<string[]> {
	const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
	return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

async function copyTrees(source: string, target: string): Promise<string[]> {
	const copied: string[] = [];
	for (const tree of RELOCATE_TREES) {
		const from = join(source, tree);
		if (!existsSync(from)) continue;
		await copyDirContents(from, join(target, tree));
		copied.push(tree);
	}
	return copied;
}

async function removeRegistryProject(root: string, slug: string): Promise<void> {
	const registry = await readRegistry(root);
	if (!registry.projects[slug]) return;
	delete registry.projects[slug];
	await atomicWrite(join(root, "registry.json"), JSON.stringify(registry, null, 2));
}

async function ensureRootLayout(root: string): Promise<void> {
	for (const dir of ["projects", "specs", "knowledge", "wireframes", "skills"]) {
		await ensureDir(join(root, dir));
	}
	await writeIfMissing(join(root, "registry.json"), JSON.stringify({ projects: {} }, null, 2));
}

async function ensureProjectLayout(projectPath: string): Promise<void> {
	for (const dir of ["specs", "knowledge", "wireframes", "flows", "goals"]) {
		await ensureDir(join(projectPath, dir));
	}
}

async function ensureGoal(
	projectPath: string,
	id: string,
	title: string,
): Promise<string> {
	const goalPath = join(projectPath, "goals", id);
	for (const dir of ["tasks", "specs", "knowledge", "wireframes"]) {
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
	await writeBundledSkill(join(skillRoot, "references", "organization.md"), organizationReference);
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

	const maintenanceRoot = join(root, "skills", "agent-board-maintenance");
	await ensureDir(maintenanceRoot);
	await writeBundledSkill(join(maintenanceRoot, "SKILL.md"), maintenanceSkillReadme);
	await writeBundledSkill(join(maintenanceRoot, "AGENTS.md"), maintenanceSkillAgents);

	const designWireframeRoot = join(root, "skills", "agent-board-design-wireframe");
	await ensureDir(designWireframeRoot);
	await writeBundledSkill(join(designWireframeRoot, "SKILL.md"), designWireframeSkillReadme);
	await writeBundledSkill(join(designWireframeRoot, "AGENTS.md"), designWireframeSkillAgents);

	const designReviewRoot = join(root, "skills", "agent-board-design-review");
	await ensureDir(designReviewRoot);
	await writeBundledSkill(join(designReviewRoot, "SKILL.md"), designReviewSkillReadme);
	await writeBundledSkill(join(designReviewRoot, "AGENTS.md"), designReviewSkillAgents);
}

async function readProjectConfig(projectPath: string): Promise<ProjectConfig> {
	return JSON.parse(await readFile(join(projectPath, "project.json"), "utf-8")) as ProjectConfig;
}

function readProjectConfigSync(projectPath: string): ProjectConfig {
	const path = join(projectPath, "project.json");
	if (!existsSync(path)) {
		throw new Error(
			`No agent-board project found: missing ${path}. Run \`agent-board init\` (or \`agent-board init --local\` for a repo board).`,
		);
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
	const slug = matchProjectByPath(registry, current)
		?? matchProjectByPath(registry, findWorktreeMainRoot(current)?.mainRoot);
	if (!slug) throw projectNotFoundError(root, current, registry);
	return slug;
}

function matchProjectByPath(registry: Registry, path: string | undefined): string | undefined {
	if (!path) return undefined;
	const matches = Object.values(registry.projects)
		.filter((project) => isInside(path, project.repo_path))
		.sort((a, b) => b.repo_path.length - a.repo_path.length);
	return matches[0]?.slug;
}

// Resolution failed: say where we looked and how to route to an existing
// project, instead of only suggesting `init` — which, run blindly from a
// worktree or an unrelated directory, would register a duplicate project.
function projectNotFoundError(root: string, cwd: string, registry: Registry): Error {
	const known = Object.keys(registry.projects).sort();
	const registryPath = join(root, "registry.json");
	const lines = [
		`No agent-board project found for ${cwd}.`,
		known.length
			? `Known projects in ${registryPath}: ${known.join(", ")}.`
			: `No projects registered in ${registryPath} yet.`,
		"If this directory belongs to a known project, pass --project <slug> or set AGENT_BOARD_PROJECT.",
		"Otherwise run `agent-board init` to register it as a new project.",
	];
	return new Error(lines.join("\n"));
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
