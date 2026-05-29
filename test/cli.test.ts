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

	test("link --blocks to a missing target fails without mutating the source", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agent-board-link-"));
		const home = await mkdtemp(join(tmpdir(), "agent-board-home-"));
		const env = { ...process.env, AGENT_BOARD_HOME: home };
		const taskPath = join(home, "projects", "demo", "goals", "main", "tasks", "source-task.md");

		await run(cwd, env, ["init", "--project", "demo"]);
		await run(cwd, env, ["new", "Source Task", "--status", "ready"]);
		const before = await readFile(taskPath, "utf-8");

		const failure = await runFail(cwd, env, ["link", "source-task", "--blocks", "does-not-exist"]);
		expect(failure).toContain("Task not found: does-not-exist");

		const after = await readFile(taskPath, "utf-8");
		expect(after).toBe(before);
		expect(lineValue(after, "blocks: ")).toBe("[]");
	});

	test("reads and writes task, spec, and knowledge bodies through subcommands", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agent-board-body-"));
		const home = await mkdtemp(join(tmpdir(), "agent-board-home-"));
		const env = { ...process.env, AGENT_BOARD_HOME: home };

		await run(cwd, env, ["init", "--project", "demo"]);
		await run(cwd, env, ["new", "Body Task", "--status", "ready"]);
		const taskBody = await run(cwd, env, ["task", "cat", "body-task"]);
		expect(taskBody).toContain("## Goal");
		expect(taskBody).not.toContain("---");

		expect(await runWithInput(cwd, env, ["task", "write", "body-task", "--from", "-"], "## Goal\n\nUpdated from stdin.\n")).toContain(
			"Wrote task body-task",
		);
		expect(await run(cwd, env, ["task", "cat", "body-task"])).toContain("Updated from stdin");
		expect(await run(cwd, env, ["show", "body-task"])).toContain('title: "Body Task"');

		await runWithInput(
			cwd,
			env,
			["task", "write", "body-task", "--from", "-"],
			"## Goal\n\nVerified body.\n\n## Acceptance Criteria\n\n- [x] Define success criteria.\n\n## Verify\n\n```sh\ntrue\n```\n",
		);
		expect(await run(cwd, env, ["verify", "body-task"])).toContain("Verified body-task");
		expect(await run(cwd, env, ["show", "body-task"])).toContain("verified_sha:");
		await runWithInput(
			cwd,
			env,
			["task", "write", "body-task", "--from", "-"],
			"## Goal\n\nChanged after verify.\n",
		);
		const rewrittenTask = await run(cwd, env, ["show", "body-task"]);
		expect(rewrittenTask).toContain('verified: ""');
		expect(rewrittenTask).toContain('verified_sha: ""');

		await run(cwd, env, ["spec", "new", "Driver Spec"]);
		const specBodyPath = join(cwd, "spec-body.md");
		await writeFile(specBodyPath, "## Context\n\nDriver body.\n");
		expect(await run(cwd, env, ["spec", "cat", "driver-spec"])).not.toContain("---");
		expect(await run(cwd, env, ["spec", "write", "driver-spec", "--from", specBodyPath])).toContain(
			"Wrote spec project/driver-spec",
		);
		expect(await run(cwd, env, ["spec", "cat", "driver-spec"])).toContain("Driver body");
		expect(await run(cwd, env, ["spec", "show", "driver-spec"])).toContain('title: "Driver Spec"');

		await run(cwd, env, ["knowledge", "add", "Driver Note", "--kind", "decision"]);
		const knowledgeBodyPath = join(cwd, "knowledge-body.md");
		await writeFile(knowledgeBodyPath, "## Decision\n\nUse subcommands as the store boundary.\n");
		expect(await run(cwd, env, ["knowledge", "cat", "driver-note"])).not.toContain("---");
		expect(await run(cwd, env, ["knowledge", "write", "driver-note", "--from", knowledgeBodyPath])).toContain(
			"Wrote knowledge project/driver-note",
		);
		expect(await run(cwd, env, ["knowledge", "cat", "driver-note"])).toContain("store boundary");
		expect(await run(cwd, env, ["knowledge", "list"])).toContain("driver-note");
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

	test("migrate moves only tasks and does not duplicate project specs", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agent-board-cli-"));
		const home = await mkdtemp(join(tmpdir(), "agent-board-home-"));
		const env = { ...process.env, AGENT_BOARD_HOME: home };
		const project = join(home, "projects", "demo");

		await run(cwd, env, ["init", "--project", "demo"]);
		await run(cwd, env, ["spec", "new", "Keep Spec"]);
		await mkdir(join(project, "tasks"), { recursive: true });
		await writeFile(
			join(project, "tasks", "legacy-task.md"),
			`---\nid: "legacy-task"\ntitle: "Legacy Task"\nstatus: "ready"\npriority: "normal"\ncreated: "2026-05-16T00:00:00.000Z"\nupdated: "2026-05-16T00:00:00.000Z"\n---\n\n## Goal\n\nLegacy task.\n`,
		);

		await run(cwd, env, ["migrate", "--project", "demo"]);

		expect(existsSync(join(project, "tasks"))).toBe(false);
		expect(existsSync(join(project, "goals", "main", "tasks", "legacy-task.md"))).toBe(true);
		const specList = await run(cwd, env, ["spec", "list"]);
		expect(specList.match(/keep-spec/g)?.length ?? 0).toBe(1);
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

	test("parallel status mutations on the same task stay serialized and valid", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agent-board-mutrace-"));
		const home = await mkdtemp(join(tmpdir(), "agent-board-home-"));
		const env = { ...process.env, AGENT_BOARD_HOME: home };
		await gitInit(cwd);
		await run(cwd, env, ["init", "--project", "demo"]);
		await run(cwd, env, ["new", "Mutate task", "--status", "ready"]);
		const path = join(home, "projects", "demo", "goals", "main", "tasks", "mutate-task.md");

		const [a, b] = await Promise.all([
			runFail(cwd, env, ["block", "mutate-task", "waiting"]),
			runFail(cwd, env, ["ready", "mutate-task"]),
		]);
		const outputs = [a, b];
		const winners = outputs.filter((out) => /Blocked mutate-task|Ready mutate-task/.test(out));
		expect(winners.length).toBeGreaterThanOrEqual(1);
		for (const out of outputs) {
			if (!winners.includes(out)) expect(out).toMatch(/lock held/);
		}

		// No lost update / clobbered frontmatter: exactly one frontmatter block,
		// a single valid status, and the file still parses cleanly.
		const file = await readFile(path, "utf-8");
		expect(file.startsWith("---\n")).toBe(true);
		expect(file.split("\n---\n").length).toBe(2);
		const status = lineValue(file, "status: ").replaceAll('"', "");
		expect(["blocked", "ready"]).toContain(status);
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
		expect(created).toContain("Template: default");
		expect(created).toContain("Next: inspect or edit the script");
		const flowPath = lineValue(created, "Script: ");
		expect(await readFile(flowPath, "utf-8")).toContain("export default async function flow");
		expect(await run(cwd, env, ["flow", "cat", "audit-repo"])).toContain("researcher");
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
		expect(summary).toContain("- researcher: read,");
		expect(summary).toContain("- synthesizer: read,");
		expect(summary).toContain("## Controller Next");
		expect(events).not.toContain("Mock codex response");
		expect(agentFiles.length).toBeGreaterThan(0);
		expect(await readFile(join(runPath, "agents", agentFiles[0]!), "utf-8")).toContain("Mock codex response");
		expect(await run(cwd, env, ["flow", "show", basename(dirname(summaryPath))])).toContain("## Controller Next");
		expect(await readFile(join(home, "projects", "demo", "goals", "main", "tasks", "flow-task.md"), "utf-8")).toContain("[flow]");

		const replacementPath = join(cwd, "replacement-flow.mjs");
		await writeFile(replacementPath, "export default async function flow() {\n\treturn \"replacement\";\n}\n");
		expect(await run(cwd, env, ["flow", "write", "audit-repo", "--from", replacementPath])).toContain(
			"Wrote flow audit-repo",
		);
		expect(await run(cwd, env, ["flow", "cat", "audit-repo"])).toContain("replacement");

		const readmePath = join(cwd, "README.md");
		await writeFile(readmePath, "keep me");
		const pathWrite = await runFail(cwd, env, ["flow", "write", readmePath, "--from", replacementPath]);
		expect(pathWrite).toContain("Expected a project flow name");
		expect(await readFile(readmePath, "utf-8")).toBe("keep me");
	});

	test("flow run emits throttled streaming telemetry without real Codex", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agent-board-flow-telemetry-"));
		const home = await mkdtemp(join(tmpdir(), "agent-board-home-"));
		const env = {
			...process.env,
			AGENT_BOARD_HOME: home,
			AGENT_BOARD_FLOW_MOCK: "1",
			// Time throttle wide enough that the fast text stream coalesces into a
			// single delta, then spaced activity beats land in later windows.
			AGENT_BOARD_FLOW_THROTTLE_MS: "50",
			AGENT_BOARD_FLOW_MOCK_ACTIVITY: "1",
			AGENT_BOARD_FLOW_MOCK_DELAY_MS: "120",
		};

		await run(cwd, env, ["init", "--project", "demo"]);
		const output = await run(cwd, env, [
			"flow",
			"run",
			"Audit the repository for streaming telemetry",
			"--agents",
			"1",
		]);
		const summaryPath = lineValue(output, "Summary: ");
		const runPath = dirname(summaryPath);
		const raw = await readFile(join(runPath, "events.jsonl"), "utf-8");
		const events = raw
			.split("\n")
			.filter((line) => line.length > 0)
			.map((line) => JSON.parse(line) as Record<string, unknown>);

		const deltas = events.filter((event) => event.type === "agent_delta");
		const heartbeats = events.filter((event) => event.type === "agent_heartbeat");
		const finishes = events.filter((event) => event.type === "agent_finish");

		// Both progress event types are written, proving the stream telemetry path.
		expect(deltas.length).toBeGreaterThan(0);
		expect(heartbeats.length).toBeGreaterThan(0);

		// No raw token spam: a large agent output coalesces into very few deltas.
		for (const finish of finishes) {
			const agentName = finish.name;
			const agentChars = finish.chars as number;
			const agentDeltas = deltas.filter((event) => event.name === agentName);
			expect(agentChars).toBeGreaterThan(100);
			expect(agentDeltas.length).toBeGreaterThanOrEqual(1);
			expect(agentDeltas.length).toBeLessThanOrEqual(3);
			// The final delta reports the full running length, never the full text.
			expect(agentDeltas.at(-1)!.chars).toBe(agentChars);
		}

		// Previews are short tails, so persistent logs never carry the full output.
		for (const delta of deltas) {
			expect((delta.preview as string).length).toBeLessThanOrEqual(83);
		}
		expect(raw).not.toContain("Mock codex response");

		// Diagnostics stay a separate, filtered channel (no token deltas leak in).
		expect(existsSync(join(runPath, "diagnostics.jsonl"))).toBe(false);
		const agentFiles = await readdir(join(runPath, "agents"));
		expect(await readFile(join(runPath, "agents", agentFiles[0]!), "utf-8")).toContain(
			"Mock codex response",
		);
	});

	test("flow watch tails a finished run's events and exits", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agent-board-flow-watch-"));
		const home = await mkdtemp(join(tmpdir(), "agent-board-home-"));
		const env = { ...process.env, AGENT_BOARD_HOME: home };

		await run(cwd, env, ["init", "--project", "demo"]);

		// Pre-write a synthetic, already-complete run (no real Codex): events.jsonl
		// holds the full lifecycle and summary.md exists, so watch renders the
		// backlog and exits immediately instead of polling forever.
		const runId = "2026-05-29-watch-demo";
		const runPath = join(home, "projects", "demo", "goals", "main", "flows", "runs", runId);
		await mkdir(runPath, { recursive: true });
		const events = [
			{ ts: "2026-05-29T10:00:00.000Z", type: "log", message: "flow started: audit" },
			{ ts: "2026-05-29T10:00:00.100Z", type: "agent_start", name: "researcher", mode: "read", promptChars: 42 },
			{ ts: "2026-05-29T10:00:01.200Z", type: "agent_delta", name: "researcher", chars: 120, preview: "inspecting files" },
			{ ts: "2026-05-29T10:00:01.700Z", type: "agent_heartbeat", name: "researcher", chars: 120 },
			{ ts: "2026-05-29T10:00:02.500Z", type: "agent_finish", name: "researcher", mode: "read", durationMs: 2400, outputPath: join(runPath, "agents", "01-researcher.md"), chars: 340, diagnostics: 0 },
		];
		await writeFile(join(runPath, "events.jsonl"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
		await writeFile(join(runPath, "summary.md"), "# Flow Run\n\n## Summary\n\nDone.\n");

		const output = await run(cwd, env, ["flow", "watch", runId]);
		expect(output).toContain("log: flow started: audit");
		expect(output).toContain("researcher: start (read)");
		expect(output).toContain("researcher: 120 chars  inspecting files");
		expect(output).toContain("researcher: working (120 chars)");
		expect(output).toContain("researcher: done in 2400ms (340 chars)");
		expect(output).toContain(`Flow run ${runId} finished`);

		// Unknown run ids fail cleanly rather than hanging on a missing dir.
		const missing = await runFail(cwd, env, ["flow", "watch", "no-such-run"]);
		expect(missing).toContain("Flow run not found: no-such-run");
	});

	test("creates flow templates and validates template names", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agent-board-flow-template-"));
		const home = await mkdtemp(join(tmpdir(), "agent-board-home-"));
		const env = { ...process.env, AGENT_BOARD_HOME: home, AGENT_BOARD_FLOW_MOCK: "1" };

		await run(cwd, env, ["init", "--project", "demo"]);
		const cases = [
			["default", "critic"],
			["feature", "planner"],
			["review", "risk-reviewer"],
			["fix", "reproducer"],
		] as const;

		for (const [template, marker] of cases) {
			const output = await run(cwd, env, [
				"flow",
				"new",
				`${template} flow`,
				"--template",
				template,
			]);
			expect(output).toContain(`Template: ${template}`);
			const path = lineValue(output, "Script: ");
			expect(await readFile(path, "utf-8")).toContain(marker);
		}

		const escaped = await run(cwd, env, [
			"flow",
			"new",
			"weird ${goal}",
			"--template",
			"feature",
		]);
		expect(await readFile(lineValue(escaped, "Script: "), "utf-8")).toContain(
			'const flowName = "weird ${goal}"',
		);

		const invalid = await runFail(cwd, env, ["flow", "new", "Bad Flow", "--template", "unknown"]);
		expect(invalid).toContain("Invalid flow template");
		expect(existsSync(join(home, "projects", "demo", "flows", "bad-flow.mjs"))).toBe(false);

		const collision = await runFail(cwd, env, ["flow", "new", "fix flow"]);
		expect(collision).toContain("Flow already exists");
		const overwritten = await run(cwd, env, ["flow", "new", "fix flow", "--force", "--template", "fix"]);
		expect(overwritten).toContain("Template: fix");

		const runOutput = await run(cwd, env, ["flow", "run", "fix-flow", "--input", "Fix command boundary"]);
		const summary = await readFile(lineValue(runOutput, "Summary: "), "utf-8");
		expect(summary).toContain("Mock codex response");
		expect(summary).toContain("reproducer");
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

async function runWithInput(
	cwd: string,
	env: Record<string, string | undefined>,
	args: string[],
	input: string,
): Promise<string> {
	const proc = Bun.spawn(["bun", cli, ...args], {
		cwd,
		env,
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	proc.stdin.write(input);
	proc.stdin.end();
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
