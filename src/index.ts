#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "commander";
import { createKnowledge, createSpec, getSpec, listKnowledge, listSpecs, parseScope } from "./documents.js";
import { createGoal, initWorkspace, installGlobalSkills, listGoals, listProjects, migrateWorkspace, resolveWorkspace, runsDir, useGoal, workspaceForGoal } from "./workspace.js";
import { createTask, getTask, linkTaskSpec, linkTasks, listTasks, parsePriority, parseStatus, pickNextTask, resolveTaskRef, setTaskStatus, unblockTask } from "./tasks.js";
import type { TaskFile, Workspace } from "./types.js";
import { table } from "./utils.js";
import { listWorkflows, readWorkflow } from "./workflow.js";
import { runWorkflow } from "./runner.js";

const program = new Command();

program
	.name("agent-board")
	.description("Markdown task board and workflow runner for coding agents")
	.version("0.1.0")
	.allowUnknownOption(true);

program
	.command("init")
	.description("Initialize an agent-board project binding for this repo")
	.option("--project <slug>", "Project slug")
	.action(async (options) => {
		await main(async () => {
			const opts = readOptions<{ project?: string }>(options);
			const { workspace, warnings } = await initWorkspace(process.cwd(), opts.project);
			console.log(`Initialized ${workspace.projectSlug}`);
			console.log(`Project: ${workspace.projectPath}`);
			console.log(`Goal: ${workspace.goalSlug}`);
			console.log(`Repo: ${workspace.repoPath}`);
			for (const warning of warnings) console.warn(`Warning: ${warning}`);
		});
	});

program
	.command("migrate")
	.description("Migrate an old flat project into the home-only goal layout")
	.option("--project <slug>", "Project slug")
	.action(async (options) => {
		await main(async () => {
			const opts = readOptions<{ project?: string }>(options);
			const { workspace, migrated } = await migrateWorkspace(process.cwd(), opts.project);
			console.log(`Migrated ${workspace.projectSlug}`);
			console.log(migrated.length ? `Moved: ${migrated.join(", ")}` : "Nothing to migrate.");
		});
	});

program
	.command("projects")
	.description("List registered projects")
	.action(async () => {
		await main(async () => {
			const projects = await listProjects();
			if (!projects.length) {
				console.log("No projects.");
				return;
			}
			console.log(
				table([
					["Project", "Repo"],
					...projects.map((project) => [project.slug, project.repo_path]),
				]),
			);
		});
	});

program
	.command("goals")
	.description("List goals for the current project")
	.action(async () => {
		await main(async () => {
			const workspace = currentWorkspace();
			const goals = await listGoals(workspace);
			if (!goals.length) {
				console.log("No goals.");
				return;
			}
			console.log(
				table([
					["Active", "Goal", "Title"],
					...goals.map((goal) => [goal.active ? "*" : "", goal.id, goal.title]),
				]),
			);
		});
	});

const goal = program.command("goal").description("Manage project goals");

goal
	.command("new")
	.argument("<title>")
	.option("--id <slug>", "Goal slug")
	.description("Create a goal")
	.action(async (title, options) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const created = await createGoal(workspace, title, options.id);
			console.log(`Created goal ${created.id}`);
		});
	});

goal
	.command("use")
	.argument("<goal-id>")
	.description("Set active goal for the current project")
	.action(async (id) => {
		await main(async () => {
			const workspace = currentWorkspace();
			await useGoal(workspace, id);
			console.log(`Using goal ${id}`);
		});
	});

program
	.command("tasks")
	.description("List tasks")
	.option("--status <status>", "Filter by status")
	.option("--all", "Include done tasks")
	.action(async (options) => {
		await main(async () => {
			if (options.status) parseStatus(options.status);
			const workspace = currentWorkspace();
			const tasks = (await listTasks(workspace)).filter((task) => {
				if (options.status) return task.meta.status === options.status;
				return options.all || task.meta.status !== "done";
			});
			if (tasks.length === 0) {
				console.log("No tasks.");
				return;
			}
			console.log(
				table([
					["ID", "Status", "Priority", "Assignee", "Title"],
					...tasks.map((task) => [
						task.meta.id,
						task.meta.status,
						task.meta.priority,
						task.meta.assignee || "-",
						task.meta.title,
					]),
				]),
			);
		});
	});

program
	.command("status")
	.description("Show project goal status")
	.action(async () => {
		await main(async () => {
			const workspace = currentWorkspace();
			const tasks = await listTasks(workspace);
			const counts = new Map<string, number>();
			for (const task of tasks) counts.set(task.meta.status, (counts.get(task.meta.status) ?? 0) + 1);
			console.log(`Project: ${workspace.projectSlug}`);
			console.log(`Goal: ${workspace.goalSlug}`);
			console.log(
				["todo", "ready", "in_progress", "blocked", "review", "done"]
					.map((status) => `${status}: ${counts.get(status) ?? 0}`)
					.join("  "),
			);
			const blocked = tasks.filter((task) => task.meta.status === "blocked");
			const active = tasks.filter((task) => task.meta.status === "in_progress");
			const next = pickNextTask(tasks);
			if (active.length) console.log(`\nIn progress:\n${active.map((task) => `- ${task.meta.id}: ${task.meta.title}`).join("\n")}`);
			if (blocked.length) console.log(`\nBlocked:\n${blocked.map((task) => `- ${task.meta.id}: ${task.meta.blocked_by.at(-1) ?? task.meta.title}`).join("\n")}`);
			if (next) console.log(`\nNext: ${next.meta.id} (${next.meta.priority}) ${next.meta.title}`);
		});
	});

program
	.command("next")
	.description("Show the next ready task")
	.action(async () => {
		await main(async () => {
			const workspace = currentWorkspace();
			const task = pickNextTask(await listTasks(workspace));
			if (!task) {
				console.log("No ready or todo tasks.");
				return;
			}
			console.log(`${task.meta.id} (${task.meta.status}, ${task.meta.priority}) ${task.meta.title}`);
		});
	});

program
	.command("show")
	.argument("<task-id>")
	.description("Show a task Markdown file")
	.action(async (id) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const task = await getTask(workspace, id);
			console.log(await readFile(task.path, "utf-8"));
		});
	});

program
	.command("new")
	.argument("<title>")
	.description("Create a task in the active goal")
	.option("--status <status>", "Initial status", "todo")
	.option("--priority <priority>", "Priority", "normal")
	.action(async (title, options) => {
		await main(async () => {
			parseStatus(options.status);
			parsePriority(options.priority);
			const workspace = currentWorkspace();
			const task = await createTask(workspace, {
				title,
				status: options.status,
				priority: options.priority,
			});
			console.log(`Created ${task.meta.id}`);
		});
	});

const spec = program.command("spec").description("Manage specs across overlay scopes");

spec
	.command("new")
	.argument("<title>")
	.option("--scope <scope>", "global, project, or goal", "project")
	.description("Create a spec")
	.action(async (title, options) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const scope = parseScope(options.scope);
			const doc = await createSpec(workspace, title, scope);
			console.log(`Created spec ${scope}/${doc.meta.id}`);
		});
	});

spec
	.command("list")
	.option("--scope <scope>", "global, project, or goal")
	.description("List specs")
	.action(async (options) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const scope = options.scope ? parseScope(options.scope) : undefined;
			const specs = await listSpecs(workspace, scope);
			if (specs.length === 0) {
				console.log("No specs.");
				return;
			}
			console.log(
				table([
					["Scope", "ID", "Status", "Title"],
					...specs.map((doc) => [
						doc.scope,
						doc.meta.id,
						doc.meta.status ?? "-",
						doc.meta.title,
					]),
				]),
			);
		});
	});

spec
	.command("show")
	.argument("<spec-id>")
	.description("Show a spec")
	.action(async (id) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const doc = await getSpec(workspace, id);
			console.log(await readFile(doc.path, "utf-8"));
		});
	});

const knowledge = program
	.command("knowledge")
	.description("Manage knowledge notes across overlay scopes");

knowledge
	.command("add")
	.argument("<title>")
	.option("--kind <kind>", "Knowledge kind: decision, note, gotcha", "note")
	.option("--scope <scope>", "global, project, or goal", "project")
	.description("Add a knowledge note")
	.action(async (title, options) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const scope = parseScope(options.scope);
			const doc = await createKnowledge(workspace, title, options.kind, scope);
			console.log(`Created knowledge ${scope}/${doc.meta.id}`);
		});
	});

knowledge
	.command("list")
	.option("--scope <scope>", "global, project, or goal")
	.description("List knowledge notes")
	.action(async (options) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const scope = options.scope ? parseScope(options.scope) : undefined;
			const docs = await listKnowledge(workspace, scope);
			if (docs.length === 0) {
				console.log("No knowledge.");
				return;
			}
			console.log(
				table([
					["Scope", "ID", "Kind", "Title"],
					...docs.map((doc) => [
						doc.scope,
						doc.meta.id,
						doc.meta.kind ?? "note",
						doc.meta.title,
					]),
				]),
			);
		});
	});

program
	.command("claim")
	.argument("<task-id>")
	.description("Claim a task")
	.option("--agent <name>", "Agent name", process.env.USER ?? "agent")
	.action(async (id, options) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const task = await setTaskStatus(workspace, id, "in_progress", {
				assignee: options.agent,
			});
			console.log(`Claimed ${task.meta.id}`);
		});
	});

program
	.command("block")
	.argument("<task-id>")
	.argument("<reason>")
	.description("Mark a task as blocked")
	.action(async (id, reason) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const task = await setTaskStatus(workspace, id, "blocked", {
				blockReason: reason,
			});
			console.log(`Blocked ${task.meta.id}`);
		});
	});

program
	.command("ready")
	.argument("<task-id>")
	.description("Mark a task ready")
	.action(async (id) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const task = await setTaskStatus(workspace, id, "ready");
			console.log(`Ready ${task.meta.id}`);
		});
	});

program
	.command("unblock")
	.argument("<task-id>")
	.description("Clear blockers and mark a task ready")
	.action(async (id) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const task = await unblockTask(workspace, id);
			console.log(`Unblocked ${task.meta.id}`);
		});
	});

program
	.command("link")
	.argument("<task-id>")
	.option("--blocks <task-id>", "Mark the source task as blocking another task")
	.option("--spec <spec-id>", "Link a task to a spec")
	.description("Link task dependencies and specs")
	.action(async (id, options) => {
		await main(async () => {
			const workspace = currentWorkspace();
			if (!options.blocks && !options.spec) {
				throw new Error("Use --blocks <task-id> or --spec <spec-id>.");
			}
			if (options.blocks) {
				await linkTasks(workspace, id, options.blocks);
				console.log(`Linked ${id} blocks ${options.blocks}`);
			}
			if (options.spec) {
				const from = resolveTaskRef(workspace, id);
				await getSpec(from.workspace, options.spec);
				await linkTaskSpec(from.workspace, from.id, options.spec);
				console.log(`Linked ${id} to spec ${options.spec}`);
			}
		});
	});

program
	.command("plan")
	.option("--related", "Include related projects")
	.description("Show ready work, blockers, and dependency lanes")
	.action(async (options) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const workspaces = [workspace];
			if (options.related) {
				for (const related of workspace.project.related_projects) {
					workspaces.push(workspaceForGoal(workspace, related, resolveWorkspace(process.cwd(), { projectSlug: related }).goalSlug));
				}
			}
			const plans = await Promise.all(workspaces.map(async (item) => ({
				workspace: item,
				tasks: await listTasks(item),
			})));
			const done = new Set<string>();
			for (const plan of plans) {
				for (const task of plan.tasks) {
					if (task.meta.status === "done") {
						done.add(taskKey(plan.workspace, task.meta.id));
						if (plan.workspace.projectSlug === workspace.projectSlug && plan.workspace.goalSlug === workspace.goalSlug) {
							done.add(task.meta.id);
						}
					}
				}
			}

			for (const plan of plans) {
				printPlanSection(plan.workspace, plan.tasks, done, workspace);
			}
		});
	});

program
	.command("review")
	.argument("<task-id>")
	.description("Mark a task as ready for review")
	.action(async (id) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const task = await setTaskStatus(workspace, id, "review");
			console.log(`Review ${task.meta.id}`);
		});
	});

program
	.command("done")
	.argument("<task-id>")
	.description("Mark a task as done")
	.option("--force", "Close even with unchecked acceptance criteria")
	.action(async (id, options) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const task = await setTaskStatus(workspace, id, "done", {
				force: options.force,
			});
			console.log(`Done ${task.meta.id}`);
		});
	});

program
	.command("workflows")
	.description("List workflows from goal/project/global overlays")
	.action(async () => {
		await main(async () => {
			const workspace = currentWorkspace();
			const workflows = await listWorkflows(workspace);
			console.log(workflows.length ? workflows.join("\n") : "No workflows.");
		});
	});

program
	.command("run")
	.argument("<task-id>")
	.option("--workflow <name>", "Workflow name")
	.option("--agent <codex|claude>", "Override all workflow agents")
	.description("Run a task workflow")
	.action(async (id, options) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const task = await getTask(workspace, id);
			const workflowName = options.workflow ?? task.meta.workflow ?? "dev";
			const workflow = await readWorkflow(workspace, workflowName);
			const run = await runWorkflow({
				workspace,
				task,
				workflow,
				agentOverride: options.agent,
			});
			console.log(`\nRun ${run.status}: ${run.id}`);
		});
	});

program
	.command("runs")
	.argument("[task-id]")
	.description("List workflow runs for the active goal")
	.action(async (taskId) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const { readdir, readFile } = await import("node:fs/promises");
			const dirs = await readdir(runsDir(workspace)).catch(() => []);
			const rows = [["Run", "Task", "Workflow", "Status"]];
			for (const dir of dirs.sort()) {
				const raw = await readFile(join(runsDir(workspace), dir, "run.json"), "utf-8").catch(() => "");
				if (!raw) continue;
				const run = JSON.parse(raw) as { id: string; taskId: string; workflow: string; status: string };
				if (taskId && run.taskId !== taskId) continue;
				rows.push([run.id, run.taskId, run.workflow, run.status]);
			}
			console.log(rows.length > 1 ? table(rows) : "No runs.");
		});
	});

program
	.command("logs")
	.argument("<run-id>")
	.option("--step <step-id>", "Step id")
	.description("Show run logs")
	.action(async (runId, options) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const runPath = join(runsDir(workspace), runId);
			const run = JSON.parse(await readFile(join(runPath, "run.json"), "utf-8")) as {
				steps: { id: string; stdoutPath: string; stderrPath: string }[];
			};
			const steps = options.step
				? run.steps.filter((step) => step.id === options.step)
				: run.steps;
			for (const step of steps) {
				console.log(`\n# ${step.id} stdout\n`);
				console.log(await readFile(step.stdoutPath, "utf-8").catch(() => ""));
				console.log(`\n# ${step.id} stderr\n`);
				console.log(await readFile(step.stderrPath, "utf-8").catch(() => ""));
			}
		});
	});

const skills = program.command("skills").description("Manage agent-board skill links");

skills
	.command("install")
	.description("Install global Claude and agents skill symlinks")
	.action(async () => {
		await main(async () => {
			const warnings = await installGlobalSkills();
			console.log("Installed agent-board skills");
			for (const warning of warnings) console.warn(`Warning: ${warning}`);
		});
	});

function currentWorkspace(): Workspace {
	const options = cliScopeOverrides();
	return resolveWorkspace(process.cwd(), {
		projectSlug: options.project,
		goalSlug: options.goal,
	});
}

function cliScopeOverrides(): { project?: string; goal?: string } {
	const result: { project?: string; goal?: string } = {};
	for (let i = 2; i < process.argv.length; i++) {
		const arg = process.argv[i]!;
		if (arg === "--project") result.project = process.argv[++i];
		else if (arg.startsWith("--project=")) result.project = arg.slice("--project=".length);
		else if (arg === "--goal") result.goal = process.argv[++i];
		else if (arg.startsWith("--goal=")) result.goal = arg.slice("--goal=".length);
	}
	return result;
}

function readOptions<T extends Record<string, unknown>>(value: T | { opts(): T }): T {
	return typeof (value as { opts?: unknown }).opts === "function"
		? (value as { opts(): T }).opts()
		: value as T;
}

function printPlanSection(
	workspace: Workspace,
	tasks: TaskFile[],
	done: Set<string>,
	base: Workspace,
): void {
	const label = workspace.projectSlug === base.projectSlug && workspace.goalSlug === base.goalSlug
		? `${workspace.projectSlug}/${workspace.goalSlug}`
		: `${workspace.projectSlug}/${workspace.goalSlug} (related)`;
	const ready = tasks.filter(
		(task) =>
			task.meta.status === "ready" &&
			task.meta.depends_on.every((dep) => done.has(resolveDependencyKey(workspace, dep))),
	);
	const blocked = tasks.filter(
		(task) =>
			task.meta.status === "blocked" ||
			task.meta.depends_on.some((dep) => !done.has(resolveDependencyKey(workspace, dep))),
	);
	const lanes = ready.filter((task) => task.meta.blocks.length === 0);

	console.log(`Project: ${label}`);
	console.log("\nReady");
	console.log(
		ready.length
			? ready.map((task) => `- ${task.meta.id}: ${task.meta.title}`).join("\n")
			: "- none",
	);
	console.log("\nBlocked");
	console.log(
		blocked.length
			? blocked.map((task) => {
					const deps = task.meta.depends_on.filter((dep) => !done.has(resolveDependencyKey(workspace, dep)));
					const reason = task.meta.blocked_by.at(-1) ?? (deps.length ? `waiting on ${deps.join(", ")}` : "blocked");
					return `- ${task.meta.id}: ${reason}`;
				}).join("\n")
			: "- none",
	);
	console.log("\nParallelizable");
	console.log(
		lanes.length
			? lanes.map((task) => `- ${task.meta.id}: ${task.meta.title}`).join("\n")
			: "- none",
	);
	console.log("\nDependency Lanes");
	const edges = tasks.filter((task) => task.meta.blocks.length > 0);
	console.log(
		edges.length
			? edges.map((task) => `- ${task.meta.id} -> ${task.meta.blocks.join(", ")}`).join("\n")
			: "- none",
	);
}

function resolveDependencyKey(workspace: Workspace, ref: string): string {
	if (ref.startsWith("task:")) return ref;
	return taskKey(workspace, ref);
}

function taskKey(workspace: Workspace, id: string): string {
	return `task:${workspace.projectSlug}/${workspace.goalSlug}/${id}`;
}

async function main(fn: () => Promise<void>): Promise<void> {
	try {
		await fn();
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}

program.parse();
