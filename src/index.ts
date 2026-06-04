#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "commander";
import { createKnowledge, createSpec, getKnowledge, getSpec, listKnowledge, listSpecs, parseScope, writeKnowledgeBody, writeSpecBody } from "./documents.js";
import { createFlow, FlowRunError, listFlows, parseFlowRuntime, parseFlowTemplate, parsePositiveInt, readFlowScript, runFlow, watchFlowRun, writeFlowScript } from "./flow.js";
import { gitState } from "./git.js";
import { createGoal, initWorkspace, installGlobalSkills, listGoals, listProjects, migrateWorkspace, resolveWorkspace, skillsDoctor, useGoal, workspaceForGoal } from "./workspace.js";
import { appendEvidence, claimTask, createTask, getTask, linkTaskSpec, linkTasks, listTasks, parsePriority, parseStatus, pickNextTask, resolveTaskRef, setTaskStatus, unblockTask, updateTask, writeTaskBody } from "./tasks.js";
import { formatVerifyEvidence, parseVerifyCommands, runVerify } from "./verify.js";
import type { TaskFile, Workspace } from "./types.js";
import { table } from "./utils.js";

const program = new Command();

program
	.name("agent-board")
	.description("Markdown task board and execution contract for coding agents")
	.version("0.3.0")
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

const flow = program.command("flow").description("Create and run local multi-agent flows");

flow
	.command("new")
	.argument("<name>")
	.description("Create a project flow script")
	.option("--template <template>", "Flow template: default, feature, review, or fix", "default")
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
	.command("run")
	.argument("<target>")
	.description("Run a flow script by name/path, or run an ad-hoc Codex flow")
	.option("--input <text>", "Input passed to a flow script")
	.option("--task <task-id>", "Append flow evidence to a task")
	.option("--runtime <runtime>", "Agent runtime: codex, claude, or opencode", process.env.AGENT_BOARD_FLOW_RUNTIME ?? "codex")
	.option("--concurrency <n>", "Maximum concurrent agents", "3")
	.option("--agents <n>", "Agent count for ad-hoc flow runs", "3")
	.option("--verbose", "Print raw agent stderr")
	.action(async (target, options) => {
		await main(async () => {
			const opts = readOptions<{
				input?: string;
				task?: string;
				runtime: string;
				concurrency: string;
				agents: string;
				verbose?: boolean;
			}>(options);
			const workspace = await currentOrInitWorkspace();
			let result;
			try {
				result = await runFlow(workspace, {
					target,
					input: opts.input,
					taskId: opts.task,
					runtime: parseFlowRuntime(opts.runtime),
					concurrency: parsePositiveInt(opts.concurrency, "--concurrency"),
					agents: parsePositiveInt(opts.agents, "--agents"),
					verbose: opts.verbose,
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
			console.log(`Flow run ${result.runId}`);
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

async function readInputSource(source: string): Promise<string> {
	if (source === "-") return new Response(Bun.stdin.stream()).text();
	return readFile(source, "utf-8");
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
