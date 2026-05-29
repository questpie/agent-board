import { existsSync, lstatSync } from "node:fs";
import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";

const cli = join(import.meta.dir, "..", "src", "index.ts");

describe("cli", () => {
	test("initializes home-only workspace", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agent-board-cli-"));
		const home = await mkdtemp(join(tmpdir(), "agent-board-home-"));
		const env = { ...process.env, AGENT_BOARD_HOME: home };

		expect(await run(cwd, env, ["init", "--project", "demo"])).toContain(
			"Initialized demo",
		);
		expect(existsSync(join(cwd, ".agent"))).toBe(false);
		expect(JSON.parse(await readFile(join(home, "registry.json"), "utf-8")).projects.demo.repo_path).toContain(cwd.split("/").at(-1)!);
		expect(await run(cwd, env, ["new", "Add CLI", "--status", "ready"])).toContain(
			"Created add-cli",
		);
		expect(await run(cwd, env, ["tasks"])).toContain("add-cli");
		expect((await readdir(join(home, "projects", "demo", "goals", "main"))).sort()).toContain("tasks");
		expect((await readdir(join(home, "skills"))).sort()).toEqual([
			"agent-board",
			"agent-board-research",
			"agent-board-worker",
		]);
		expect(
			(await readdir(join(home, "skills", "agent-board", "references"))).sort(),
		).toEqual([
			"config.md",
			"flow-orchestration.md",
			"pm-orchestrator.md",
			"research-workflow.md",
			"review-workflow.md",
			"task-workflow.md",
		]);
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
		expect(lstatSync(join(osHome, ".cursor", "skills", "agent-board")).isSymbolicLink()).toBe(true);
		expect(lstatSync(join(osHome, ".agents", "skills", "agent-board-worker")).isSymbolicLink()).toBe(true);
		expect(lstatSync(join(osHome, ".cursor", "skills", "agent-board-research")).isSymbolicLink()).toBe(true);
	});

	test("migrates old flat project data into the main goal", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agent-board-cli-"));
		const home = await mkdtemp(join(tmpdir(), "agent-board-home-"));
		const project = join(home, "projects", "demo");
		await mkdir(join(project, "tasks"), { recursive: true });
		await mkdir(join(project, "specs"), { recursive: true });
		await mkdir(join(project, "knowledge"), { recursive: true });
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
		const output = await run(cwd, { ...process.env, AGENT_BOARD_HOME: home }, ["migrate", "--project", "demo"]);
		expect(output).toContain("Migrated demo");
		expect(await readFile(join(project, "goals", "main", "tasks", "old-task.md"), "utf-8")).toContain("Old Task");
	});

	test("claim guards detached HEAD and unfinished dependencies", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agent-board-git-"));
		const home = await mkdtemp(join(tmpdir(), "agent-board-home-"));
		const env = { ...process.env, AGENT_BOARD_HOME: home };
		await gitInit(cwd);
		await run(cwd, env, ["init", "--project", "demo"]);
		await run(cwd, env, ["new", "Blocker", "--status", "ready"]);
		await run(cwd, env, ["new", "Dependent", "--status", "ready"]);
		await run(cwd, env, ["new", "Solo", "--status", "ready"]);
		await run(cwd, env, ["link", "blocker", "--blocks", "dependent"]);

		const depFail = await runFail(cwd, env, ["claim", "dependent", "--agent", "w"]);
		expect(depFail).toContain("unfinished dependencies");
		expect(depFail).toContain("blocker");

		expect(await run(cwd, env, ["claim", "blocker", "--agent", "w"])).toContain("Claimed blocker");

		await gitDetach(cwd);
		const detachedFail = await runFail(cwd, env, ["claim", "solo", "--agent", "w"]);
		expect(detachedFail).toContain("detached");
		expect(await run(cwd, env, ["claim", "solo", "--agent", "w", "--allow-detached"])).toContain(
			"Claimed solo",
		);
	});

	test("verify gate blocks done until pass, and force requires a reason", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agent-board-verify-"));
		const home = await mkdtemp(join(tmpdir(), "agent-board-home-"));
		const env = { ...process.env, AGENT_BOARD_HOME: home };
		await run(cwd, env, ["init", "--project", "demo"]);
		const taskPath = (id: string) =>
			join(home, "projects", "demo", "goals", "main", "tasks", `${id}.md`);

		await run(cwd, env, ["new", "Pass task", "--status", "ready"]);
		await setVerify(taskPath("pass-task"), "true");
		const passNoVerify = await runFail(cwd, env, ["done", "pass-task"]);
		expect(passNoVerify).toContain("no recorded pass");
		expect(await run(cwd, env, ["verify", "pass-task"])).toContain("Verified pass-task");
		expect(await readFile(taskPath("pass-task"), "utf-8")).toContain("## Evidence");
		expect(await run(cwd, env, ["done", "pass-task"])).toContain("Done pass-task");

		await run(cwd, env, ["new", "Fail task", "--status", "ready"]);
		await setVerify(taskPath("fail-task"), "false");
		const verifyFail = await runFail(cwd, env, ["verify", "fail-task"]);
		expect(verifyFail).toContain("Verify failed");
		expect(await runFail(cwd, env, ["done", "fail-task"])).toContain("no recorded pass");
		expect(await runFail(cwd, env, ["done", "fail-task", "--force"])).toContain("requires --reason");
		expect(await run(cwd, env, ["done", "fail-task", "--force", "--reason", "ci flaky"])).toContain(
			"Done fail-task",
		);
		expect(await readFile(taskPath("fail-task"), "utf-8")).toContain("ci flaky");

		// Backward compat: a task with the default (empty) ## Verify block closes once AC is checked.
		await run(cwd, env, ["new", "Compat task", "--status", "ready"]);
		await checkCriteria(taskPath("compat-task"));
		expect(await run(cwd, env, ["done", "compat-task"])).toContain("Done compat-task");
	});

	test("parallel claims on the same task: exactly one wins", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agent-board-race-"));
		const home = await mkdtemp(join(tmpdir(), "agent-board-home-"));
		const env = { ...process.env, AGENT_BOARD_HOME: home };
		await gitInit(cwd);
		await run(cwd, env, ["init", "--project", "demo"]);
		await run(cwd, env, ["new", "Race task", "--status", "ready"]);

		const [a, b] = await Promise.all([
			runFail(cwd, env, ["claim", "race-task", "--agent", "a"]),
			runFail(cwd, env, ["claim", "race-task", "--agent", "b"]),
		]);
		const outputs = [a, b];
		expect(outputs.filter((out) => out.includes("Claimed race-task")).length).toBe(1);
		const loser = outputs.find((out) => !out.includes("Claimed race-task"))!;
		expect(loser).toMatch(/lock held|already claimed/);
	});

	test("AGENT_BOARD_REPO routes git guards to the override repo", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agent-board-mainrepo-"));
		const worktree = await mkdtemp(join(tmpdir(), "agent-board-wt-"));
		const home = await mkdtemp(join(tmpdir(), "agent-board-home-"));
		await gitInit(cwd);
		await gitInit(worktree);
		await gitDetach(worktree);
		const env = { ...process.env, AGENT_BOARD_HOME: home };
		await run(cwd, env, ["init", "--project", "demo"]);
		await run(cwd, env, ["new", "Override task", "--status", "ready"]);

		const blocked = await runFail(cwd, { ...env, AGENT_BOARD_REPO: worktree }, [
			"claim",
			"override-task",
			"--agent",
			"a",
		]);
		expect(blocked).toContain("detached");
	});

	test("creates and runs a project flow script with mock Codex", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agent-board-flow-"));
		const home = await mkdtemp(join(tmpdir(), "agent-board-home-"));
		const env = { ...process.env, AGENT_BOARD_HOME: home, AGENT_BOARD_FLOW_MOCK: "1" };

		await run(cwd, env, ["init", "--project", "demo"]);
		const created = await run(cwd, env, ["flow", "new", "Audit Repo"]);
		expect(created).toContain("Created flow audit-repo");
		expect(created).toContain("Next: edit the script");
		const flowPath = lineValue(created, "Script: ");
		expect(await readFile(flowPath, "utf-8")).toContain("export default async function flow");
		expect(await run(cwd, env, ["flow", "list"])).toContain("audit-repo");

		await run(cwd, env, ["new", "Flow Task", "--status", "ready"]);
		const output = await run(cwd, env, [
			"flow",
			"run",
			"audit-repo",
			"--input",
			"Improve test coverage",
			"--task",
			"flow-task",
			"--concurrency",
			"2",
		]);
		expect(output).toContain("Flow run");
		expect(output).toContain("Next: read Summary first");
		const summaryPath = lineValue(output, "Summary: ");
		const summary = await readFile(summaryPath, "utf-8");
		const runPath = dirname(summaryPath);
		const events = await readFile(join(runPath, "events.jsonl"), "utf-8");
		const agentFiles = await readdir(join(runPath, "agents"));
		expect(summary).toContain("Runtime: codex");
		expect(summary).toContain("Mock codex response");
		expect(summary).toContain("## Controller Next");
		expect(events).not.toContain("Mock codex response");
		expect(agentFiles.length).toBeGreaterThan(0);
		expect(await readFile(join(runPath, "agents", agentFiles[0]!), "utf-8")).toContain("Mock codex response");
		expect(await run(cwd, env, ["flow", "show", basename(dirname(summaryPath))])).toContain("## Controller Next");
		expect(await readFile(join(home, "projects", "demo", "goals", "main", "tasks", "flow-task.md"), "utf-8")).toContain("[flow]");
	});

	test("flow run validates task id before starting agents", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agent-board-flow-task-"));
		const home = await mkdtemp(join(tmpdir(), "agent-board-home-"));
		const env = { ...process.env, AGENT_BOARD_HOME: home, AGENT_BOARD_FLOW_MOCK: "1" };

		await run(cwd, env, ["init", "--project", "demo"]);
		const output = await runFail(cwd, env, [
			"flow",
			"run",
			"Audit the repository",
			"--task",
			"missing-task",
		]);

		expect(output).toContain("Task not found: missing-task");
		expect(existsSync(join(home, "projects", "demo", "goals", "main", "flows", "runs"))).toBe(false);
	});

	test("flow run auto-initializes a workspace for ad-hoc goals", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agent-board-flow-auto-"));
		const home = await mkdtemp(join(tmpdir(), "agent-board-home-"));
		const output = await run(
			cwd,
			{ ...process.env, AGENT_BOARD_HOME: home, AGENT_BOARD_FLOW_MOCK: "1" },
			["flow", "run", "Audit the repository", "--agents", "1"],
		);

		expect(output).toContain("Initialized agent-board-flow-auto");
		expect(output).toContain("Flow run");
		expect(JSON.parse(await readFile(join(home, "registry.json"), "utf-8")).projects).not.toEqual({});
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

function lineValue(output: string, prefix: string): string {
	const line = output.split("\n").find((item) => item.startsWith(prefix));
	if (!line) throw new Error(`Missing output line: ${prefix}`);
	return line.slice(prefix.length);
}

async function runFail(
	cwd: string,
	env: Record<string, string | undefined>,
	args: string[],
): Promise<string> {
	const proc = Bun.spawn(["bun", cli, ...args], { cwd, env, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	await proc.exited;
	return stdout + stderr;
}

async function gitInit(dir: string): Promise<void> {
	const g = (args: string[]) =>
		Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" }).exited;
	await g(["init", "-b", "main"]);
	await g(["config", "user.email", "t@t.t"]);
	await g(["config", "user.name", "t"]);
	await writeFile(join(dir, "f.txt"), "a");
	await g(["add", "."]);
	await g(["commit", "-m", "one"]);
	await writeFile(join(dir, "g.txt"), "b");
	await g(["add", "."]);
	await g(["commit", "-m", "two"]);
}

async function gitDetach(dir: string): Promise<void> {
	await Bun.spawn(["git", "-C", dir, "checkout", "HEAD~1"], {
		stdout: "pipe",
		stderr: "pipe",
	}).exited;
}

async function setVerify(path: string, cmd: string): Promise<void> {
	let body = await readFile(path, "utf-8");
	body = body.replace("- [ ] Define success criteria.", "- [x] Define success criteria.");
	body = body.replace(/## Verify[\s\S]*$/, `## Verify\n\n\`\`\`sh\n${cmd}\n\`\`\`\n`);
	await writeFile(path, body);
}

async function checkCriteria(path: string): Promise<void> {
	const body = await readFile(path, "utf-8");
	await writeFile(
		path,
		body.replace("- [ ] Define success criteria.", "- [x] Define success criteria."),
	);
}
