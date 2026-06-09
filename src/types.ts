export const STATUSES = [
	"todo",
	"ready",
	"in_progress",
	"blocked",
	"review",
	"done",
] as const;

export type TaskStatus = (typeof STATUSES)[number];

export const PRIORITIES = ["high", "normal", "low"] as const;

export type TaskPriority = (typeof PRIORITIES)[number];

export interface TaskMeta {
	id: string;
	title: string;
	status: TaskStatus;
	priority: TaskPriority;
	assignee: string;
	branch: string;
	skills: string[];
	specs: string[];
	depends_on: string[];
	blocks: string[];
	blocked_by: string[];
	relates_to: string[];
	created: string;
	updated: string;
	verified: string;
	verified_sha: string;
}

export interface TaskFile {
	path: string;
	meta: TaskMeta;
	body: string;
}

export type OverlayScope = "global" | "project" | "goal";

// Where a board lives. "home" is the shared ~/.agent-board (multi-project,
// registry-indexed). "local" is a single-project .agent-board/ inside a repo,
// discovered by walking up from cwd and meant to be git-versioned with the repo.
export type WorkspaceMode = "home" | "local";

export interface RegistryProject {
	slug: string;
	repo_path: string;
	project_path: string;
}

export interface Registry {
	projects: Record<string, RegistryProject>;
}

export interface ProjectConfig {
	slug: string;
	// Absolute repo path. Stored for home boards; omitted for local boards
	// (derived from the board's own location) so project.json stays portable.
	repo_path?: string;
	active_goal: string;
	related_projects: string[];
	created: string;
	updated: string;
}

export interface Workspace {
	root: string;
	mode: WorkspaceMode;
	projectSlug: string;
	projectPath: string;
	repoPath: string;
	goalSlug: string;
	goalPath: string;
	cwd: string;
	project: ProjectConfig;
}
