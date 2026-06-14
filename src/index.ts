#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { createKnowledge, createSpec, getKnowledge, getSpec, listKnowledge, listSpecs, parseScope, setKnowledgeCategory, setSpecCategory, writeKnowledgeBody, writeSpecBody } from "./documents.js";
import { createFlow, DEFAULT_FLOW_AGENT_TIMEOUT_MS, discoverFlowModels, FlowRunError, listFlowRuntimes, listFlows, parseCodexMcpMode, parseDurationMs as parseFlowDurationMs, parseFlowRuntime, parseFlowTemplate, parsePositiveInt, readFlowScript, runFlow, watchFlowRun, writeFlowScript } from "./flow.js";
import { gitState } from "./git.js";
import { createGoal, initWorkspace, installGlobalSkills, listGoals, listProjects, migrateWorkspace, relocateWorkspace, resolveWorkspace, skillsDoctor, useGoal, workspaceForGoal } from "./workspace.js";
import { appendEvidence, appendTaskProgress, claimTask, createTask, getTask, linkTaskSpec, linkTasks, listTasks, parsePriority, parseStatus, pickNextTask, resolveTaskRef, setTaskStatus, unblockTask, updateTask, writeTaskBody } from "./tasks.js";
import { formatVerifyEvidence, parseVerifyCommands, runVerify } from "./verify.js";
import { auditSkillDrift, collectRepoDocs } from "./skills-audit.js";
import { applyNudge, nudgeStatus } from "./nudge.js";
import { buildMaintenanceReport, parseDurationMs, type MaintenanceReport } from "./maintenance.js";
import type { TaskFile, Workspace, WorkspaceMode } from "./types.js";
import { table } from "./utils.js";
import { startWebServer } from "./web.js";
import { getWireframe, importWireframe, listWireframes } from "./wireframes.js";
import { archiveRecord, listArchivedRecords, parseArchiveKind, restoreArchivedRecord } from "./archive.js";
import { isDefaultViewer, listShares, openUrl, parseShareKind, removeShare, shareArtifact, SHARE_KINDS } from "./share.js";

const program = new Command();

program
	.name("agent-board")
	.description("Markdown task board and execution contract for coding agents")
	.version(JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8")).version)
	.allowUnknownOption(true);

program
	.command("init")
	.description("Initialize an agent-board project binding for this repo")
	.option("--project <slug>", "Project slug")
	.option("--local", "Store the board in the repo (.agent-board/, git-versioned)")
	.option("--global", "Store the board in home (~/.agent-board), shared across repos [default]")
	.action(async (options) => {
		await main(async () => {
			const opts = readOptions<{ project?: string; local?: boolean; global?: boolean }>(options);
			const mode = resolveInitMode(opts);
			const { workspace, warnings } = await initWorkspace(process.cwd(), { projectSlug: opts.project, mode });
			console.log(`Initialized ${workspace.projectSlug} (${workspace.mode})`);
			console.log(`Board: ${workspace.projectPath}`);
			console.log(`Goal: ${workspace.goalSlug}`);
			console.log(`Repo: ${workspace.repoPath}`);
			for (const warning of warnings) console.warn(`Warning: ${warning}`);
			await maybeNudgeHint();
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
	.command("relocate")
	.description("Move the board between home (~/.agent-board) and the repo (.agent-board/)")
	.requiredOption("--to <where>", "Destination: 'local' (in repo) or 'home' (shared)")
	.option("--cleanup", "Delete the source copy after moving (default: keep it as a backup)")
	.option("--project <slug>", "Project slug to relocate (home source)")
	.action(async (options) => {
		await main(async () => {
			const opts = readOptions<{ to: string; cleanup?: boolean; project?: string }>(options);
			const to: WorkspaceMode | null =
				opts.to === "local" ? "local" : opts.to === "home" ? "home" : null;
			if (!to) throw new Error("--to must be 'local' or 'home'");
			const result = await relocateWorkspace(process.cwd(), {
				to,
				cleanup: opts.cleanup ?? false,
				projectSlug: opts.project,
			});
			console.log(`Relocated ${result.slug} -> ${result.to}`);
			console.log(`From: ${result.from}`);
			console.log(`To:   ${result.target}`);
			console.log(result.copied.length ? `Copied: ${result.copied.join(", ")}` : "Copied: nothing");
			if (result.cleaned) console.log("Source removed.");
			else if (result.backup) console.log(`Backup kept: ${result.backup} (re-run with --cleanup to remove)`);
			for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
			if (result.to === "local") {
				console.log("Next: commit .agent-board/ with the repo — other clones pick it up automatically, no env needed.");
			}
		});
	});

program
	.command("nudge")
	.description("Add or refresh the agent-board usage nudge in CLAUDE.md and AGENTS.md")
	.option("--remove", "Remove the managed nudge block instead of adding it")
	.action(async (options) => {
		await main(async () => {
			const opts = readOptions<{ remove?: boolean }>(options);
			const { root, results } = await applyNudge(process.cwd(), { remove: opts.remove ?? false });
			console.log(`Nudge target: ${root}`);
			for (const result of results) console.log(`  ${result.file}: ${result.action}`);
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
	.option("--force", "Change the shared active goal even from a non-interactive agent session")
	.description("Set active goal for the current project")
	.action(async (id, options) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const opts = readOptions<{ force?: boolean }>(options);
			await useGoal(workspace, id, { force: opts.force, interactive: process.stdin.isTTY });
			console.log(`Using goal ${id}`);
		});
	});

program
	.command("tasks")
	.description("List tasks")
	.option("--status <status>", "Filter by status")
	.option("--all", "Include done tasks")
	.option("--archived", "Include archived tasks")
	.action(async (options) => {
		await main(async () => {
			if (options.status) parseStatus(options.status);
			const workspace = currentWorkspace();
			const tasks = (await listTasks(workspace, { includeArchived: options.archived })).filter((task) => {
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
			await maybeNudgeHint();
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

const task = program.command("task").description("Read and write task body content");

task
	.command("cat")
	.argument("<task-id>")
	.description("Print a task body without frontmatter")
	.action(async (id) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const taskFile = await getTask(workspace, id);
			console.log(taskFile.body.trimEnd());
		});
	});

task
	.command("write")
	.argument("<task-id>")
	.requiredOption("--from <file|->", "Read replacement body from a file or stdin")
	.description("Replace a task body while preserving frontmatter")
	.action(async (id, options) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const body = await readInputSource(options.from);
			const taskFile = await writeTaskBody(workspace, id, body);
			console.log(`Wrote task ${taskFile.meta.id}`);
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
	.option("--category <name>", "Group the spec under a category")
	.description("Create a spec")
	.action(async (title, options) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const scope = parseScope(options.scope);
			const doc = await createSpec(workspace, title, scope, options.category);
			console.log(`Created spec ${scope}/${doc.meta.id}`);
		});
	});

spec
	.command("list")
	.option("--scope <scope>", "global, project, or goal")
	.option("--category <name>", "Filter by category")
	.option("--archived", "Include archived specs")
	.description("List specs")
	.action(async (options) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const scope = options.scope ? parseScope(options.scope) : undefined;
			const specs = (await listSpecs(workspace, scope, { includeArchived: options.archived })).filter(
				(doc) => !options.category || doc.meta.category === options.category,
			);
			if (specs.length === 0) {
				console.log("No specs.");
				return;
			}
			console.log(
				table([
					["Scope", "ID", "Category", "Status", "Title"],
					...specs.map((doc) => [
						doc.scope,
						doc.meta.id,
						doc.meta.category ?? "-",
						doc.meta.status ?? "-",
						doc.meta.title,
					]),
				]),
			);
		});
	});

spec
	.command("categorize")
	.argument("<spec-id>")
	.argument("<category>")
	.description("Set or change a spec category")
	.action(async (id, category) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const doc = await setSpecCategory(workspace, id, category);
			console.log(`Categorized spec ${doc.scope}/${doc.meta.id} -> ${doc.meta.category ?? "(none)"}`);
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

spec
	.command("cat")
	.argument("<spec-id>")
	.description("Print a spec body without frontmatter")
	.action(async (id) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const doc = await getSpec(workspace, id);
			console.log(doc.body.trimEnd());
		});
	});

spec
	.command("write")
	.argument("<spec-id>")
	.requiredOption("--from <file|->", "Read replacement body from a file or stdin")
	.description("Replace a spec body while preserving frontmatter")
	.action(async (id, options) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const body = await readInputSource(options.from);
			const doc = await writeSpecBody(workspace, id, body);
			console.log(`Wrote spec ${doc.scope}/${doc.meta.id}`);
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
	.option("--category <name>", "Group the note under a category")
	.description("Add a knowledge note")
	.action(async (title, options) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const scope = parseScope(options.scope);
			const doc = await createKnowledge(workspace, title, options.kind, scope, options.category);
			console.log(`Created knowledge ${scope}/${doc.meta.id}`);
		});
	});

knowledge
	.command("list")
	.option("--scope <scope>", "global, project, or goal")
	.option("--category <name>", "Filter by category")
	.option("--archived", "Include archived knowledge notes")
	.description("List knowledge notes")
	.action(async (options) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const scope = options.scope ? parseScope(options.scope) : undefined;
			const docs = (await listKnowledge(workspace, scope, { includeArchived: options.archived })).filter(
				(doc) => !options.category || doc.meta.category === options.category,
			);
			if (docs.length === 0) {
				console.log("No knowledge.");
				return;
			}
			console.log(
				table([
					["Scope", "ID", "Kind", "Category", "Title"],
					...docs.map((doc) => [
						doc.scope,
						doc.meta.id,
						doc.meta.kind ?? "note",
						doc.meta.category ?? "-",
						doc.meta.title,
					]),
				]),
			);
		});
	});

knowledge
	.command("categorize")
	.argument("<knowledge-id>")
	.argument("<category>")
	.description("Set or change a knowledge category")
	.action(async (id, category) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const doc = await setKnowledgeCategory(workspace, id, category);
			console.log(`Categorized knowledge ${doc.scope}/${doc.meta.id} -> ${doc.meta.category ?? "(none)"}`);
		});
	});

knowledge
	.command("cat")
	.argument("<knowledge-id>")
	.description("Print a knowledge body without frontmatter")
	.action(async (id) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const doc = await getKnowledge(workspace, id);
			console.log(doc.body.trimEnd());
		});
	});

knowledge
	.command("write")
	.argument("<knowledge-id>")
	.requiredOption("--from <file|->", "Read replacement body from a file or stdin")
	.description("Replace a knowledge body while preserving frontmatter")
	.action(async (id, options) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const body = await readInputSource(options.from);
			const doc = await writeKnowledgeBody(workspace, id, body);
			console.log(`Wrote knowledge ${doc.scope}/${doc.meta.id}`);
		});
	});

const wireframe = program
	.command("wireframe")
	.alias("design")
	.description("Manage HTML design board wireframes");

wireframe
	.command("import")
	.argument("<directory>")
	.option("--title <title>", "Wireframe title")
	.option("--scope <scope>", "global, project, or goal", "project")
	.option("--category <name>", "Group the wireframe under a category")
	.option("--status <status>", "Wireframe status", "draft")
	.option("--entry <path>", "HTML entry file inside the bundle")
	.description("Import a zero-build HTML wireframe bundle into the board")
	.action(async (directory, options) => {
		await main(async () => {
			const opts = readOptions<{ title?: string; scope: string; category?: string; status?: string; entry?: string }>(options);
			const workspace = currentWorkspace();
			const scope = parseScope(opts.scope);
			const doc = await importWireframe(workspace, directory, {
				title: opts.title,
				scope,
				category: opts.category,
				status: opts.status,
				entry: opts.entry,
			});
			console.log(`Created wireframe ${scope}/${doc.meta.id}`);
			console.log(`Entry: ${doc.meta.entry}`);
			console.log(`Bundle: ${doc.dir}`);
			console.log("Preview: agent-board web");
		});
	});

wireframe
	.command("list")
	.option("--scope <scope>", "global, project, or goal")
	.option("--category <name>", "Filter by category")
	.description("List wireframes")
	.action(async (options) => {
		await main(async () => {
			const opts = readOptions<{ scope?: string; category?: string }>(options);
			const workspace = currentWorkspace();
			const scope = opts.scope ? parseScope(opts.scope) : undefined;
			const docs = (await listWireframes(workspace, scope)).filter(
				(doc) => !opts.category || doc.meta.category === opts.category,
			);
			if (docs.length === 0) {
				console.log("No wireframes.");
				return;
			}
			console.log(
				table([
					["Scope", "ID", "Category", "Status", "Entry", "Title"],
					...docs.map((doc) => [
						doc.scope,
						doc.meta.id,
						doc.meta.category ?? "-",
						doc.meta.status ?? "-",
						doc.meta.entry,
						doc.meta.title,
					]),
				]),
			);
		});
	});

wireframe
	.command("show")
	.argument("<wireframe-id>")
	.description("Show a wireframe metadata file")
	.action(async (id) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const doc = await getWireframe(workspace, id);
			console.log(await readFile(doc.path, "utf-8"));
		});
	});

wireframe
	.command("cat")
	.argument("<wireframe-id>")
	.description("Print a wireframe notes body without frontmatter")
	.action(async (id) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const doc = await getWireframe(workspace, id);
			console.log(doc.body.trimEnd());
		});
	});

program
	.command("claim")
	.argument("<task-id>")
	.description("Claim a task (guards detached HEAD and unfinished dependencies)")
	.option("--agent <name>", "Agent name", process.env.USER ?? "agent")
	.option("--allow-detached", "Allow claiming on a detached HEAD")
	.action(async (id, options) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const { task, warnings } = await claimTask(workspace, id, {
				agent: options.agent,
				allowDetached: options.allowDetached,
			});
			console.log(`Claimed ${task.meta.id}`);
			for (const warning of warnings) console.warn(`Warning: ${warning}`);
		});
	});

program
	.command("progress")
	.argument("<task-id>")
	.argument("[message...]", "Progress checkpoint text")
	.description("Append a progress checkpoint to a task's Evidence section")
	.option("--from <file|->", "Read progress text from a file or stdin")
	.option("--agent <name>", "Agent name", process.env.USER ?? "agent")
	.action(async (id, messageParts, options) => {
		await main(async () => {
			const opts = readOptions<{ from?: string; agent?: string }>(options);
			const inline = Array.isArray(messageParts) ? messageParts.join(" ") : "";
			const message = opts.from ? await readInputSource(opts.from) : inline;
			const workspace = currentWorkspace();
			const task = await appendTaskProgress(workspace, id, {
				message,
				agent: opts.agent,
			});
			console.log(`Progress ${task.meta.id}`);
		});
	});

program
	.command("verify")
	.argument("<task-id>")
	.description("Run the task's ## Verify commands from the repo root and record evidence")
	.action(async (id) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const task = await getTask(workspace, id);
			const cmds = parseVerifyCommands(task.body);
			if (!cmds.length) {
				console.log(`No verify commands in the ## Verify block for ${id}.`);
				return;
			}
			console.log(`Running ${cmds.length} verify command(s) in ${workspace.repoPath}`);
			const results = await runVerify(workspace.repoPath, cmds);
			for (const result of results) {
				console.log(`- ${result.cmd} -> exit ${result.exitCode}`);
			}
			const state = await gitState(workspace.repoPath);
			const timestamp = new Date().toISOString();
			const allPass = results.every((result) => result.exitCode === 0);
			await updateTask(workspace, id, (current) => {
				current.body = appendEvidence(
					current.body,
					formatVerifyEvidence(results, timestamp, state.head),
				);
				if (allPass) {
					current.meta.verified = timestamp;
					current.meta.verified_sha = state.head ?? "";
				}
			});
			if (!allPass) throw new Error(`Verify failed for ${id}.`);
			console.log(`Verified ${id}`);
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
	.option("--force", "Close even with unchecked criteria or failing/absent verify")
	.option("--reason <text>", "Reason for forcing (logged as evidence)")
	.action(async (id, options) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const task = await setTaskStatus(workspace, id, "done", {
				force: options.force,
				reason: options.reason,
			});
			console.log(`Done ${task.meta.id}`);
		});
	});

const archiveCmd = program.command("archive").description("Archive, list, and restore board records without deleting them");

for (const kind of ["task", "spec", "knowledge", "flow-run"] as const) {
	archiveCmd
		.command(kind)
		.argument("<id>")
		.requiredOption("--reason <text>", "Reason for archiving")
		.option("--superseded-by <ref>", "Replacement task/spec/knowledge/flow reference")
		.description(`Archive a ${kind}`)
		.action(async (id, options) => {
			await main(async () => {
				const opts = readOptions<{ reason: string; supersededBy?: string }>(options);
				const workspace = currentWorkspace();
				const record = await archiveRecord(workspace, kind, id, {
					reason: opts.reason,
					supersededBy: opts.supersededBy,
				});
				console.log(`Archived ${record.kind} ${record.scope}/${record.id}`);
				console.log(`Reason: ${record.reason}`);
				if (record.supersededBy) console.log(`Superseded by: ${record.supersededBy}`);
			});
		});
}

archiveCmd
	.command("list")
	.option("--kind <kind>", "Filter by kind: task, spec, knowledge, or flow-run")
	.description("List archived board records")
	.action(async (options) => {
		await main(async () => {
			const opts = readOptions<{ kind?: string }>(options);
			const workspace = currentWorkspace();
			const kind = opts.kind ? parseArchiveKind(opts.kind) : undefined;
			const records = await listArchivedRecords(workspace, kind);
			if (!records.length) {
				console.log("No archived records.");
				return;
			}
			console.log(
				table([
					["Kind", "Scope", "ID", "Archived", "Reason", "Superseded By"],
					...records.map((record) => [
						record.kind,
						record.scope,
						record.id,
						record.archivedAt || "-",
						record.reason || "-",
						record.supersededBy || "-",
					]),
				]),
			);
		});
	});

archiveCmd
	.command("restore")
	.argument("<kind>", "task, spec, knowledge, or flow-run")
	.argument("<id>")
	.description("Restore an archived board record")
	.action(async (kindValue, id) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const kind = parseArchiveKind(kindValue);
			const restored = await restoreArchivedRecord(workspace, kind, id);
			console.log(`Restored ${restored.kind} ${restored.id}`);
		});
	});

const flow = program.command("flow").description("Create and run local multi-agent flows");

flow
	.command("new")
	.argument("<name>")
	.description("Create a project flow script")
	.option(
		"--template <template>",
		"Flow template: default, feature, review, fix, design, task-graph, refactor, hygiene, grill, or safe-workflow",
		"default",
	)
	.option("--force", "Overwrite an existing flow")
	.action(async (name, options) => {
		await main(async () => {
			const opts = readOptions<{ force?: boolean; template: string }>(options);
			const template = parseFlowTemplate(opts.template);
			const workspace = await currentOrInitWorkspace();
			const created = await createFlow(workspace, name, { force: opts.force, template });
			console.log(`Created flow ${created.name}`);
			console.log(`Template: ${template}`);
			console.log(`Script: ${created.path}`);
			console.log("Next: inspect or edit the script, summarize its phases to the user, then run:");
			console.log(`agent-board flow cat ${created.name}`);
			console.log(`agent-board flow run ${created.name} --input "<scope>"`);
		});
	});

flow
	.command("list")
	.description("List project flow scripts")
	.action(async () => {
		await main(async () => {
			const workspace = await currentOrInitWorkspace();
			const flows = await listFlows(workspace);
			if (!flows.length) {
				console.log("No flows.");
				return;
			}
			console.log(
				table([
					["Flow", "Path"],
					...flows.map((item) => [item.name, item.path]),
				]),
			);
		});
	});

flow
	.command("runtimes")
	.description("List local agent runtimes detected through spawn-agent")
	.action(async () => {
		await main(async () => {
			const runtimes = await listFlowRuntimes();
			console.log(
				table([
					["Runtime", "Available", "Display Name"],
					...runtimes.map((runtime) => [
						runtime.runtime,
						runtime.available ? "yes" : "no",
						runtime.displayName,
					]),
				]),
			);
		});
	});

flow
	.command("models")
	.requiredOption("--runtime <runtime>", "Agent runtime to inspect")
	.description("Discover model selector options exposed by a local runtime")
	.action(async (options) => {
		await main(async () => {
			const opts = readOptions<{ runtime: string }>(options);
			const workspace = await currentOrInitWorkspace();
			const runtime = parseFlowRuntime(opts.runtime);
			const discovery = await discoverFlowModels(workspace, runtime);
			if (discovery.warning) console.log(`Warning: ${discovery.warning}`);
			if (!discovery.configs.length) {
				console.log(`No model selector exposed by ${runtime}. Check the runtime's official docs for model configuration.`);
				return;
			}
			for (const config of discovery.configs) {
				console.log(`Model config: ${config.configId} (${config.name})`);
				console.log(`Current: ${config.currentValue || "-"}`);
				if (!config.choices.length) {
					console.log("Options: runtime did not enumerate choices.");
					continue;
				}
				console.log(
					table([
						["Value", "Name", "Group"],
						...config.choices.map((choice) => [
							choice.value,
							choice.name,
							choice.group ?? "-",
						]),
					]),
				);
			}
		});
	});

flow
	.command("run")
	.argument("<target>")
	.description("Run a flow script by name/path, or run an ad-hoc Codex flow")
	.option("--input <text>", "Input passed to a flow script")
	.option("--task <task-id>", "Append flow evidence to a task")
	.option("--runtime <runtime>", "Agent runtime: codex, claude, cursor, copilot, gemini, opencode, droid, or pi", process.env.AGENT_BOARD_FLOW_RUNTIME ?? "codex")
	.option("--model <model>", "Runtime model id/alias to request when ACP exposes a model selector")
	.option("--concurrency <n>", "Maximum concurrent agents", "3")
	.option("--agents <n>", "Agent count for ad-hoc flow runs", "3")
	.option("--agent-timeout <duration>", "Per-agent inactivity watchdog: e.g. 15m, 120m", process.env.AGENT_BOARD_FLOW_AGENT_TIMEOUT ?? `${DEFAULT_FLOW_AGENT_TIMEOUT_MS}ms`)
	.option("--codex-mcp <mode>", "Codex MCP config mode: isolated or inherit", process.env.AGENT_BOARD_FLOW_CODEX_MCP ?? "isolated")
	.option("--verbose", "Print raw agent stderr")
	.option("--no-watch", "Do not print live per-agent progress while the flow runs")
	.action(async (target, options) => {
		await main(async () => {
			const opts = readOptions<{
				input?: string;
				task?: string;
				runtime: string;
				model?: string;
				concurrency: string;
				agents: string;
				agentTimeout: string;
				codexMcp: string;
				verbose?: boolean;
				watch?: boolean;
			}>(options);
			const workspace = await currentOrInitWorkspace();
			let started = false;
			let result;
			try {
				result = await runFlow(workspace, {
					target,
					input: opts.input,
					taskId: opts.task,
					runtime: parseFlowRuntime(opts.runtime),
					model: opts.model,
					concurrency: parsePositiveInt(opts.concurrency, "--concurrency"),
					agents: parsePositiveInt(opts.agents, "--agents"),
					agentTimeoutMs: parseFlowDurationMs(opts.agentTimeout, "--agent-timeout"),
					codexMcpMode: parseCodexMcpMode(opts.codexMcp),
					verbose: opts.verbose,
					onRunStart: (run) => {
						started = true;
						console.log(`Flow run ${run.runId}`);
						console.log(`Run dir: ${run.runPath}`);
						if (opts.watch === false) {
							console.log(`Watch: agent-board flow watch ${run.runId}`);
						} else {
							console.log("Live progress:");
						}
					},
					onEventLine: opts.watch === false ? undefined : (line) => console.log(line),
				});
			} catch (error) {
				if (error instanceof FlowRunError) {
					console.log(`Flow run ${error.runId} failed`);
					console.log(`Summary: ${error.summaryPath}`);
					console.log(`Agent outputs: ${join(error.runPath, "agents")}`);
					console.log(`Diagnostics: ${join(error.runPath, "diagnostics.jsonl")}`);
					console.log("Next: read failed Summary first; inspect diagnostics only if needed.");
				}
				throw error;
			}
			if (!started) console.log(`Flow run ${result.runId}`);
			else console.log(`Flow run ${result.runId} finished`);
			console.log(`Summary: ${result.summaryPath}`);
			console.log(`Agent outputs: ${join(result.runPath, "agents")}`);
			console.log(`Diagnostics: ${join(result.runPath, "diagnostics.jsonl")}`);
			console.log("Next: read Summary first; inspect agent outputs or diagnostics only if needed.");
		});
	});

flow
	.command("cat")
	.argument("<name>")
	.description("Print a project flow script")
	.action(async (name) => {
		await main(async () => {
			const workspace = await currentOrInitWorkspace();
			const script = await readFlowScript(workspace, name);
			console.log(script.body.trimEnd());
		});
	});

flow
	.command("write")
	.argument("<name>")
	.requiredOption("--from <file|->", "Read replacement script from a file or stdin")
	.description("Create or replace a project flow script")
	.action(async (name, options) => {
		await main(async () => {
			const workspace = await currentOrInitWorkspace();
			const body = await readInputSource(options.from);
			const script = await writeFlowScript(workspace, name, body);
			console.log(`Wrote flow ${script.name}`);
			console.log(`Script: ${script.path}`);
		});
	});

flow
	.command("show")
	.argument("<run-id>")
	.description("Show a flow run summary")
	.action(async (id) => {
		await main(async () => {
			const workspace = await currentOrInitWorkspace();
			const summaryPath = join(workspace.goalPath, "flows", "runs", id, "summary.md");
			console.log(await readFile(summaryPath, "utf-8"));
		});
	});

flow
	.command("watch")
	.argument("<run-id>")
	.description("Tail a flow run's events.jsonl and exit when it finishes or on Ctrl-C")
	.action(async (id) => {
		await main(async () => {
			const workspace = await currentOrInitWorkspace();
			const controller = new AbortController();
			const onSigint = () => controller.abort();
			process.on("SIGINT", onSigint);
			try {
				const result = await watchFlowRun(workspace, id, { signal: controller.signal });
				if (result.finished) {
					console.log(`Flow run ${result.runId} finished`);
					console.log(`Summary: ${join(result.runPath, "summary.md")}`);
				} else {
					console.log(`Stopped watching flow run ${result.runId}`);
				}
			} finally {
				process.off("SIGINT", onSigint);
			}
		});
	});

program
	.command("maintenance")
	.description("Read-only board maintenance report for stale work, flow cleanup candidates, and consolidation")
	.option("--stale-after <duration>", "Age threshold for stale claims and runs, e.g. 30m, 24h, 7d", "24h")
	.option("--dry-run", "Only report findings; never mutate board state", true)
	.option("--json", "Print the raw JSON report")
	.action(async (options) => {
		await main(async () => {
			const opts = readOptions<{ staleAfter: string; dryRun?: boolean; json?: boolean }>(options);
			if (opts.dryRun === false) {
				throw new Error("maintenance is read-only for now; omit destructive cleanup and retry actions.");
			}
			const workspace = currentWorkspace();
			const report = await buildMaintenanceReport(workspace, {
				staleAfterMs: parseDurationMs(opts.staleAfter),
			});
			if (opts.json) {
				console.log(JSON.stringify(report, null, 2));
				return;
			}
			printMaintenanceReport(report);
		});
	});

const skills = program.command("skills").description("Manage agent-board skill links");

skills
	.command("install")
	.description("Install global Claude, agents, and Cursor skill symlinks")
	.action(async () => {
		await main(async () => {
			const warnings = await installGlobalSkills();
			console.log("Installed agent-board skills");
			for (const warning of warnings) console.warn(`Warning: ${warning}`);
		});
	});

skills
	.command("doctor")
	.description("Show which runtimes have agent-board skills linked")
	.action(async () => {
		await main(async () => {
			const statuses = await skillsDoctor();
			console.log(
				table([
					["Skill", "Runtime", "State", "Path"],
					...statuses.map((status) => [status.skill, status.runtime, status.state, status.path]),
				]),
			);
		});
	});

skills
	.command("check")
	.description("Check that bundled skill docs and repo docs (README, docs/*.md) still match the live CLI (drift guard)")
	.action(async () => {
		await main(async () => {
			const issues = auditSkillDrift(program, collectRepoDocs());
			if (issues.length === 0) {
				console.log("No drift: skill docs and repo docs match the CLI.");
				return;
			}
			for (const issue of issues) {
				console.error(`[${issue.source}] ${issue.kind}: ${issue.token}  (in "${issue.invocation}")`);
			}
			throw new Error(`Found ${issues.length} doc/CLI drift issue(s). Update src/skills.ts or the repo docs.`);
		});
	});

const shareCmd = program
	.command("share")
	.description("Share one board artifact as a public link (secret gist + hosted viewer)");

for (const kind of SHARE_KINDS) {
	shareCmd
		.command(`${kind} <id>`)
		.description(`Share a ${kind} as a secret gist rendered by the hosted viewer`)
		.option("--target <target>", "Publish target: gist (default)", "gist")
		.option("--open", "Open the share link in a browser")
		.action(async (id, options) => {
			await main(async () => {
				const opts = readOptions<{ target?: string; open?: boolean }>(options);
				const workspace = currentWorkspace();
				const result = await shareArtifact(workspace, kind, id, { target: opts.target });
				console.log(`${result.updated ? "Updated" : "Shared"} ${kind}: ${result.title}`);
				console.log(`Link: ${result.viewerUrl}`);
				console.log(`Gist: ${result.gistUrl} (secret)`);
				for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
				if (isDefaultViewer()) {
					console.log(
						"Note: the Link renders once the board's GitHub Pages viewer (docs/share) is enabled; until then share the Gist URL.",
					);
				}
				if (opts.open) openUrl(result.viewerUrl);
			});
		});
}

shareCmd
	.command("list")
	.description("List artifacts shared from this project")
	.action(async () => {
		await main(async () => {
			const workspace = currentWorkspace();
			const shares = await listShares(workspace);
			if (!shares.length) {
				console.log("No shares.");
				return;
			}
			console.log(
				table([
					["Kind", "ID", "Title", "Link"],
					...shares.map((share) => [share.kind, share.id, share.title, share.url]),
				]),
			);
		});
	});

shareCmd
	.command("rm")
	.argument("<kind>", "design, spec, task, or knowledge")
	.argument("<id>")
	.description("Delete a share and its backing gist")
	.action(async (kindValue, id) => {
		await main(async () => {
			const workspace = currentWorkspace();
			const kind = parseShareKind(kindValue);
			const result = await removeShare(workspace, kind, id);
			console.log(
				result.removed
					? `Removed share for ${kind} ${id} (gist ${result.gist})`
					: `No share found for ${kind} ${id}.`,
			);
		});
	});

program
	.command("web")
	.description("Start a local read-only web viewer for the board")
	.option("--port <n>", "Port to listen on", "4317")
	.option("--host <host>", "Host to bind", "127.0.0.1")
	.option("--no-open", "Do not open the browser automatically")
	.action(async (options) => {
		await main(async () => {
			const opts = readOptions<{ port: string; host: string; open: boolean }>(options);
			await startWebServer({
				port: parsePositiveInt(opts.port, "--port"),
				host: opts.host,
				open: opts.open !== false,
			});
		});
	});

function currentWorkspace(): Workspace {
	const options = cliScopeOverrides();
	return resolveWorkspace(process.cwd(), {
		projectSlug: options.project,
		goalSlug: options.goal,
	});
}

async function currentOrInitWorkspace(): Promise<Workspace> {
	try {
		return currentWorkspace();
	} catch (error) {
		if (!(error instanceof Error) || !error.message.includes("No agent-board project found")) {
			throw error;
		}
		const { workspace } = await initWorkspace(process.cwd());
		console.warn(`Initialized ${workspace.projectSlug}`);
		return workspace;
	}
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

function installScopeOverrideOptions(command: Command): void {
	for (const child of command.commands) installScopeOverrideOptionsForCommand(child);
}

function installScopeOverrideOptionsForCommand(command: Command): void {
	addOptionIfMissing(command, "--project <slug>", "Project slug override");
	addOptionIfMissing(command, "--goal <slug>", "Goal slug override");
	for (const child of command.commands) installScopeOverrideOptionsForCommand(child);
}

function addOptionIfMissing(
	command: Command,
	flags: string,
	description: string,
): void {
	const long = flags.match(/--[a-z-]+/)?.[0];
	if (!long || command.options.some((option) => option.long === long)) return;
	command.option(flags, description);
}

function readOptions<T extends Record<string, unknown>>(value: T | { opts(): T }): T {
	return typeof (value as { opts?: unknown }).opts === "function"
		? (value as { opts(): T }).opts()
		: value as T;
}

function resolveInitMode(opts: { local?: boolean; global?: boolean }): WorkspaceMode {
	if (opts.local && opts.global) throw new Error("Use either --local or --global, not both.");
	if (opts.local) return "local";
	if (opts.global) return "home";
	// Interactive humans get to choose; non-interactive callers (agents, CI)
	// default to the shared home board to preserve existing behavior.
	if (process.stdin.isTTY && typeof prompt === "function") {
		const answer = prompt(
			"Where should this board live? [1] this repo (.agent-board, git-versioned)  [2] home (~/.agent-board) [default]:",
		);
		if (answer?.trim() === "1") return "local";
	}
	return "home";
}

// Non-fatal hint: when running inside a repo whose CLAUDE.md/AGENTS.md don't
// mention agent-board, tell the agent to run `agent-board nudge`. We never write
// the files automatically — the agent does, after seeing this.
async function maybeNudgeHint(): Promise<void> {
	try {
		const status = await nudgeStatus(process.cwd());
		if (!status.isRepo || status.missing.length === 0) return;
		const files = status.missing.join(" and ");
		const verb = status.missing.length > 1 ? "don't" : "doesn't";
		console.error(
			`Tip: ${files} ${verb} mention agent-board — run \`agent-board nudge\` so agents use the board for tasks, specs, and knowledge.`,
		);
	} catch {
		// A hint must never break the command.
	}
}

async function readInputSource(source: string): Promise<string> {
	if (source === "-") return new Response(Bun.stdin.stream()).text();
	return readFile(source, "utf-8");
}

function printMaintenanceReport(report: MaintenanceReport): void {
	console.log(`Maintenance report (read-only): ${report.project}/${report.goal}`);
	console.log(`Generated: ${report.generated}`);
	console.log(`Stale threshold: ${formatDuration(report.staleAfterMs)}`);

	console.log("\nStale Claims");
	console.log(
		report.staleClaims.length
			? table([
					["Task", "Assignee", "Age", "Updated", "Title"],
					...report.staleClaims.map((issue) => [
						issue.id,
						issue.assignee,
						formatDuration(issue.ageMs),
						issue.updated,
						issue.title,
					]),
				])
			: "- none",
	);

	console.log("\nFlow Runs Needing Attention");
	console.log(
		report.flowRuns.length
			? table([
					["Run", "Status", "Age", "Reason"],
					...report.flowRuns.map((issue) => [
						issue.id,
						issue.status,
						formatDuration(issue.ageMs),
						issue.reason,
					]),
				])
			: "- none",
	);

	console.log("\nBroken Links");
	console.log(
		report.brokenLinks.length
			? table([
					["Task", "Field", "Ref", "Reason"],
					...report.brokenLinks.map((issue) => [
						issue.taskId,
						issue.field,
						issue.ref,
						issue.reason,
					]),
				])
			: "- none",
	);

	printConsolidationSection("Spec Consolidation", report.specConsolidation);
	printConsolidationSection("Knowledge Consolidation", report.knowledgeConsolidation);
	console.log("\nNo changes were made. Review findings before editing, retrying, or deleting anything.");
}

function printConsolidationSection(
	title: string,
	section: MaintenanceReport["specConsolidation"],
): void {
	console.log(`\n${title} - Duplicate Titles`);
	console.log(
		section.duplicates.length
			? section.duplicates
					.map((group) => {
						const rows = group.items.map((item) => `${item.scope}/${item.id}`);
						return `- ${group.key}: ${rows.join(", ")}`;
					})
					.join("\n")
			: "- none",
	);
	console.log(`\n${title} - Needs Review`);
	console.log(
		section.needsReview.length
			? table([
					["Doc", "Reason", "Category", "Updated", "Title"],
					...section.needsReview.map((issue) => [
						`${issue.scope}/${issue.id}`,
						issue.reason,
						issue.category || "-",
						issue.updated,
						issue.title,
					]),
				])
			: "- none",
	);
}

function formatDuration(ms: number): string {
	const abs = Math.max(0, Math.round(ms));
	const minute = 60_000;
	const hour = 60 * minute;
	const day = 24 * hour;
	if (abs >= day) return `${Math.round(abs / day)}d`;
	if (abs >= hour) return `${Math.round(abs / hour)}h`;
	if (abs >= minute) return `${Math.round(abs / minute)}m`;
	if (abs >= 1000) return `${Math.round(abs / 1000)}s`;
	return `${abs}ms`;
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

installScopeOverrideOptions(program);
program.parse();
