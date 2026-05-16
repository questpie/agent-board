import { existsSync, lstatSync } from "node:fs";
import { chmod, mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";

const cli = join(import.meta.dir, "..", "src", "index.ts");

describe("cli", () => {
	test("initializes home-only workspace and runs workflow with fake agents", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agent-board-cli-"));
		const home = await mkdtemp(join(tmpdir(), "agent-board-home-"));
		const bin = await mkdtemp(join(tmpdir(), "agent-board-bin-"));
		await writeFile(join(cwd, "AGENTS.md"), "Repo rules");
		await writeFakeAgent(join(bin, "codex"), "codex");
		await writeFakeAgent(join(bin, "claude"), "claude");

		const env = {
			...process.env,
			AGENT_BOARD_HOME: home,
			PATH: `${bin}:${process.env.PATH}`,
		};

		expect(await run(cwd, env, ["init", "--project", "demo"])).toContain(
			"Initialized demo",
		);
		expect(existsSync(join(cwd, ".agent"))).toBe(false);
		expect(JSON.parse(await readFile(join(home, "registry.json"), "utf-8")).projects.demo.repo_path).toContain(cwd.split("/").at(-1)!);
		expect(await run(cwd, env, ["new", "Add CLI", "--status", "ready"])).toContain(
			"Created add-cli",
		);
		expect(await run(cwd, env, ["tasks"])).toContain("add-cli");
		expect((await readdir(join(home, "workflows"))).sort()).toEqual([
			"dev.yml",
			"research.yml",
			"triage.yml",
			"validate.yml",
		]);
		expect((await readdir(join(home, "projects", "demo", "goals", "main"))).sort()).toContain("tasks");
		expect((await readdir(join(home, "skills"))).sort()).toEqual(["agent-board"]);
		expect(
			(await readdir(join(home, "skills", "agent-board", "references"))).sort(),
		).toEqual([
			"config.md",
			"pm-orchestrator.md",
			"research-workflow.md",
			"review-workflow.md",
			"task-workflow.md",
		]);

		const output = await run(cwd, env, [
			"run",
			"add-cli",
			"--workflow",
			"dev",
		]);
		expect(output).toContain("Run started:");
		expect(output).toContain("Logs: agent-board logs");
		expect(output).toContain("Run completed");

		const runs = await run(cwd, env, ["runs", "add-cli"]);
		expect(runs).toContain("completed");

		const task = await readFile(
			join(home, "projects", "demo", "goals", "main", "tasks", "add-cli.md"),
			"utf-8",
		);
		expect(task).toContain('status: "in_progress"');
		const runId = (await readdir(join(home, "projects", "demo", "goals", "main", "runs")))[0]!;
		const logs = await run(cwd, env, ["logs", runId.slice(0, 16), "--step", "implement"]);
		expect(logs).toContain("codex called");
		const prompt = await readFile(
			join(
				home,
				"projects",
				"demo",
				"goals",
				"main",
				"runs",
				runId,
				"implement",
				"prompt.md",
			),
			"utf-8",
		);
		expect(prompt).toContain("## Recommended Skills");
		expect(prompt).toContain("agent-board");
		expect(prompt).toContain("## repo:AGENTS.md");
		expect(prompt).toContain("## task:demo/main/add-cli");
	});

	test("manages goals, scoped specs, scoped knowledge, links, and plan output", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agent-board-cli-"));
		const home = await mkdtemp(join(tmpdir(), "agent-board-home-"));
		const env = { ...process.env, AGENT_BOARD_HOME: home };

		await run(cwd, env, ["init", "--project", "demo"]);
		expect(await run(cwd, env, ["goal", "new", "Auth Goal", "--id", "auth"])).toContain(
			"Created goal auth",
		);
		expect(await run(cwd, env, ["goal", "use", "auth"])).toContain("Using goal auth");
		expect(await run(cwd, env, ["goals"])).toContain("*       auth");
		expect(await run(cwd, env, ["spec", "new", "Auth Plan"])).toContain(
			"Created spec project/auth-plan",
		);
		expect(await run(cwd, env, ["spec", "new", "Auth Spike", "--scope", "goal"])).toContain(
			"Created spec goal/auth-spike",
		);
		expect(await run(cwd, env, ["knowledge", "add", "Use markdown", "--kind", "decision", "--scope", "global"])).toContain(
			"Created knowledge global/use-markdown",
		);
		await run(cwd, env, ["new", "Research auth", "--status", "ready"]);
		await run(cwd, env, ["new", "Implement auth", "--status", "ready"]);
		expect(await run(cwd, env, ["link", "research-auth", "--blocks", "implement-auth"])).toContain(
			"Linked research-auth blocks implement-auth",
		);
		expect(await run(cwd, env, ["link", "implement-auth", "--spec", "auth-plan"])).toContain(
			"Linked implement-auth to spec auth-plan",
		);
		const plan = await run(cwd, env, ["plan"]);
		expect(plan).toContain("Project: demo/auth");
		expect(plan).toContain("research-auth");
		expect(plan).toContain("waiting on research-auth");
		expect(await run(cwd, env, ["block", "implement-auth", "waiting for research"])).toContain(
			"Blocked implement-auth",
		);
		expect(await run(cwd, env, ["unblock", "implement-auth"])).toContain(
			"Unblocked implement-auth",
		);
		expect(await run(cwd, env, ["spec", "list"])).toContain("project  auth-plan");
		expect(await run(cwd, env, ["spec", "list"])).toContain("goal     auth-spike");
		expect(await run(cwd, env, ["knowledge", "list"])).toContain("global");
	});

	test("uses workflow overlay precedence", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agent-board-cli-"));
		const home = await mkdtemp(join(tmpdir(), "agent-board-home-"));
		const bin = await mkdtemp(join(tmpdir(), "agent-board-bin-"));
		await writeFakeAgent(join(bin, "codex"), "codex");
		const env = {
			...process.env,
			AGENT_BOARD_HOME: home,
			PATH: `${bin}:${process.env.PATH}`,
		};

		await run(cwd, env, ["init", "--project", "demo"]);
		await writeWorkflow(join(home, "projects", "demo", "workflows", "quick.yml"), "project prompt");
		await writeWorkflow(join(home, "projects", "demo", "goals", "main", "workflows", "quick.yml"), "goal prompt");
		await run(cwd, env, ["new", "Overlay test", "--status", "ready"]);
		await run(cwd, env, ["run", "overlay-test", "--workflow", "quick"]);
		const runId = (await readdir(join(home, "projects", "demo", "goals", "main", "runs")))[0]!;
		const prompt = await readFile(
			join(home, "projects", "demo", "goals", "main", "runs", runId, "one", "prompt.md"),
			"utf-8",
		);
		expect(prompt).toContain("goal prompt");
		expect(prompt).not.toContain("project prompt");
	});

	test("shows related project work in plan", async () => {
		const cwdA = await mkdtemp(join(tmpdir(), "agent-board-a-"));
		const cwdB = await mkdtemp(join(tmpdir(), "agent-board-b-"));
		const home = await mkdtemp(join(tmpdir(), "agent-board-home-"));
		const env = { ...process.env, AGENT_BOARD_HOME: home };

		await run(cwdA, env, ["init", "--project", "alpha"]);
		await run(cwdB, env, ["init", "--project", "beta"]);
		await writeFile(
			join(home, "projects", "alpha", "project.json"),
			JSON.stringify({
				slug: "alpha",
				repo_path: cwdA,
				active_goal: "main",
				related_projects: ["beta"],
				created: new Date().toISOString(),
				updated: new Date().toISOString(),
			}, null, 2),
		);
		await run(cwdB, env, ["new", "Beta task", "--status", "ready"]);
		const plan = await run(cwdA, env, ["plan", "--related"]);
		expect(plan).toContain("Project: beta/main (related)");
		expect(plan).toContain("beta-task");
	});

	test("installs global skill links without overwriting existing paths", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agent-board-cli-"));
		const home = await mkdtemp(join(tmpdir(), "agent-board-home-"));
		const osHome = await mkdtemp(join(tmpdir(), "agent-board-os-home-"));
		await mkdir(join(osHome, ".claude", "skills"), { recursive: true });
		await writeFile(join(osHome, ".claude", "skills", "agent-board"), "mine");

		const output = await run(
			cwd,
			{ ...process.env, AGENT_BOARD_HOME: home, HOME: osHome },
			["skills", "install"],
		);
		expect(output).toContain("Skipped existing path");
		expect(await readFile(join(osHome, ".claude", "skills", "agent-board"), "utf-8")).toBe("mine");
		const agentsLink = join(osHome, ".agents", "skills", "agent-board");
		expect(lstatSync(agentsLink).isSymbolicLink()).toBe(true);
	});

	test("migrates old flat project data into the main goal", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agent-board-cli-"));
		const home = await mkdtemp(join(tmpdir(), "agent-board-home-"));
		const project = join(home, "projects", "demo");
		await mkdir(join(project, "tasks"), { recursive: true });
		await mkdir(join(project, "specs"), { recursive: true });
		await mkdir(join(project, "knowledge"), { recursive: true });
		await mkdir(join(project, "runs"), { recursive: true });
		await mkdir(join(project, "workflows"), { recursive: true });
		await writeFile(
			join(project, "tasks", "old-task.md"),
			`---
id: "old-task"
title: "Old Task"
status: "ready"
priority: "normal"
created: "2026-05-16T00:00:00.000Z"
updated: "2026-05-16T00:00:00.000Z"
---

## Goal

Old task.
`,
		);
		await writeFile(
			join(project, "workflows", "old.yml"),
			`name: old
context:
  - AGENTS.md
  - .agent/tasks/{{task.id}}.md
  - .agent/specs
  - .agent/knowledge
steps:
  - id: one
    prompt: |
      ok
`,
		);

		const output = await run(cwd, { ...process.env, AGENT_BOARD_HOME: home }, ["migrate", "--project", "demo"]);
		expect(output).toContain("Migrated demo");
		expect(await readFile(join(project, "goals", "main", "tasks", "old-task.md"), "utf-8")).toContain("Old Task");
		const workflow = await readFile(join(project, "goals", "main", "workflows", "old.yml"), "utf-8");
		expect(workflow).toContain("task:current");
		expect(workflow).toContain("specs:goal");
		expect(workflow).toContain("knowledge:goal");
	});
});

async function run(
	cwd: string,
	env: Record<string, string | undefined>,
	args: string[],
): Promise<string> {
	const proc = Bun.spawn(["bun", cli, ...args], {
		cwd,
		env,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (exitCode !== 0) throw new Error(`${stdout}\n${stderr}`);
	return stdout + stderr;
}

async function writeFakeAgent(path: string, name: string): Promise<void> {
	await writeFile(
		path,
		`#!/usr/bin/env bun
console.log("${name} called");
console.log(process.argv.slice(2).join(" ").slice(0, 80));
`,
	);
	await chmod(path, 0o755);
}

async function writeWorkflow(path: string, text: string): Promise<void> {
	await writeFile(
		path,
		`name: quick
default_agent: codex
context:
  - task:current
steps:
  - id: one
    prompt: |
      ${text}
`,
	);
}
