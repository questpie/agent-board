import { existsSync, lstatSync } from "node:fs";
import { mkdtemp, mkdir, readdir, readFile, utimes, writeFile } from "node:fs/promises";
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
			"agent-board-design-review",
			"agent-board-design-wireframe",
			"agent-board-maintenance",
			"agent-board-research",
			"agent-board-worker",
		]);
		expect(
			(await readdir(join(home, "skills", "agent-board", "references"))).sort(),
		).toEqual([
			"config.md",
			"flow-orchestration.md",
			"organization.md",
			"pm-orchestrator.md",
			"research-workflow.md",
			"review-workflow.md",
			"task-workflow.md",
		]);
	});

	test("init --local creates a flat repo board discovered by walking up", async () => {
		const repo = await mkdtemp(join(tmpdir(), "agent-board-local-"));
		const env = noHomeEnv();

		expect(await run(repo, env, ["init", "--local", "--project", "demo"])).toContain(
			"Initialized demo (local)",
		);

		// Flat layout in the repo: no projects/<slug> wrapper, no registry, no skills copy.
		const board = join(repo, ".agent-board");
		expect(existsSync(join(board, "project.json"))).toBe(true);
		expect(existsSync(join(board, "goals", "main", "tasks"))).toBe(true);
		expect(existsSync(join(board, "projects"))).toBe(false);
		expect(existsSync(join(board, "registry.json"))).toBe(false);
		expect(existsSync(join(board, "skills"))).toBe(false);
		expect(existsSync(join(board, ".gitignore"))).toBe(true);

		// project.json stays portable: the machine-specific repo_path is derived, not stored.
		const project = JSON.parse(await readFile(join(board, "project.json"), "utf-8"));
		expect(project.slug).toBe("demo");
		expect(project.repo_path).toBeUndefined();

		// Commands resolve the local board, even from a nested subdirectory.
		expect(await run(repo, env, ["new", "Add CLI", "--status", "ready"])).toContain("Created add-cli");
		const sub = join(repo, "src", "deep");
		await mkdir(sub, { recursive: true });
		expect(await run(sub, env, ["tasks"])).toContain("add-cli");
		expect(existsSync(join(board, "goals", "main", "tasks", "add-cli.md"))).toBe(true);
	});

	test("local board default doc lists do not duplicate the flat global/project overlay", async () => {
		const repo = await mkdtemp(join(tmpdir(), "agent-board-local-docs-"));
		const env = noHomeEnv();

		await run(repo, env, ["init", "--local", "--project", "demo"]);
		await run(repo, env, ["spec", "new", "Local Spec", "--scope", "project"]);
		await run(repo, env, ["knowledge", "add", "Local Note", "--kind", "note", "--scope", "global"]);

		const specs = await run(repo, env, ["spec", "list"]);
		const knowledge = await run(repo, env, ["knowledge", "list"]);
		expect(specs.match(/\blocal-spec\b/g)?.length ?? 0).toBe(1);
		expect(knowledge.match(/\blocal-note\b/g)?.length ?? 0).toBe(1);
		expect(specs).toContain("project");
		expect(knowledge).toContain("project");

		const explicitGlobal = await run(repo, env, ["knowledge", "list", "--scope", "global"]);
		expect(explicitGlobal.match(/\blocal-note\b/g)?.length ?? 0).toBe(1);
		expect(explicitGlobal).toContain("global");
	});

	test("wireframe import stores an HTML design board in agent-board", async () => {
		const repo = await mkdtemp(join(tmpdir(), "agent-board-wireframe-"));
		const env = noHomeEnv();
		const source = join(repo, "design-source");
		await mkdir(source, { recursive: true });
		await writeFile(join(source, "index.html"), "<!doctype html><div>Demo board</div><script type=\"text/babel\" src=\"screen.jsx\"></script>");
		await writeFile(join(source, "screen.jsx"), "window.DemoBoard = true;");

		await run(repo, env, ["init", "--local", "--project", "demo"]);
		const out = await run(repo, env, [
			"wireframe",
			"import",
			source,
			"--title",
			"Demo Board",
			"--scope",
			"global",
			"--category",
			"design",
		]);
		expect(out).toContain("Created wireframe global/demo-board");
		expect(out).toContain("Preview: agent-board web");
		expect(existsSync(join(repo, ".agent-board", "wireframes", "demo-board", "index.html"))).toBe(true);
		expect(existsSync(join(repo, ".agent-board", "wireframes", "demo-board", "screen.jsx"))).toBe(true);

		const list = await run(repo, env, ["wireframe", "list"]);
		expect(list.match(/\bdemo-board\b/g)?.length ?? 0).toBe(1);
		expect(list).toContain("project");
		expect(list).toContain("design");
		expect(await run(repo, env, ["design", "list", "--scope", "global"])).toContain("global  demo-board");
		expect(await run(repo, env, ["wireframe", "show", "demo-board"])).toContain('entry: "index.html"');
	});

	test("resolves a home-board project from inside a linked git worktree", async () => {
		const repo = await mkdtemp(join(tmpdir(), "agent-board-wt-home-"));
		const home = await mkdtemp(join(tmpdir(), "agent-board-home-"));
		const env = { ...process.env, AGENT_BOARD_HOME: home };
		await gitInit(repo);
		await run(repo, env, ["init", "--project", "demo"]);
		await run(repo, env, ["new", "Worktree Task", "--status", "ready"]);

		const wt = join(dirname(repo), `${basename(repo)}-wt`);
		await gitWorktreeAdd(repo, wt);

		// The worktree is a sibling of repo_path, yet commands resolve without --project.
		expect(await run(wt, env, ["tasks"])).toContain("worktree-task");
	});

	test("routes a linked worktree to the main checkout's local board", async () => {
		const repo = await mkdtemp(join(tmpdir(), "agent-board-wt-local-"));
		const env = noHomeEnv();
		await gitInit(repo);
		await run(repo, env, ["init", "--local", "--project", "demo"]);
		// Commit the board so the worktree checkout carries its own (stale) copy.
		await gitCommitAll(repo, "board");
		const wt = join(dirname(repo), `${basename(repo)}-wt`);
		await gitWorktreeAdd(repo, wt);
		expect(existsSync(join(wt, ".agent-board", "project.json"))).toBe(true);

		await run(wt, env, ["new", "From Worktree", "--status", "ready"]);

		// The write lands in the main checkout's board, not the worktree's copy.
		expect(existsSync(join(repo, ".agent-board", "goals", "main", "tasks", "from-worktree.md"))).toBe(true);
		expect(existsSync(join(wt, ".agent-board", "goals", "main", "tasks", "from-worktree.md"))).toBe(false);
	});

	test("unresolved project error names known projects and overrides", async () => {
		const repo = await mkdtemp(join(tmpdir(), "agent-board-known-"));
		const home = await mkdtemp(join(tmpdir(), "agent-board-home-"));
		const elsewhere = await mkdtemp(join(tmpdir(), "agent-board-elsewhere-"));
		const env = { ...process.env, AGENT_BOARD_HOME: home };
		await run(repo, env, ["init", "--project", "demo"]);

		const output = await runFail(elsewhere, env, ["tasks"]);
		expect(output).toContain("No agent-board project found for");
		expect(output).toContain("demo");
		expect(output).toContain("--project <slug>");
		expect(output).toContain("AGENT_BOARD_PROJECT");
	});

	test("goal use is guarded for agents; explicit goal overrides do not mutate active goal", async () => {
		const repo = await mkdtemp(join(tmpdir(), "agent-board-goal-guard-"));
		const home = await mkdtemp(join(tmpdir(), "agent-board-home-"));
		const env = { ...process.env, AGENT_BOARD_HOME: home };
		const projectPath = join(home, "projects", "demo", "project.json");

		await run(repo, env, ["init", "--project", "demo"]);
		await run(repo, env, ["goal", "new", "Auth Goal", "--id", "auth"]);

		const nonInteractive = await runFail(repo, env, ["goal", "use", "auth"]);
		expect(nonInteractive).toContain("Refusing to change shared active goal from main to auth in non-interactive mode");
		expect(nonInteractive).toContain("Use --goal auth or AGENT_BOARD_GOAL=auth");

		expect(await run(repo, env, ["status", "--goal", "auth"])).toContain("Goal: auth");
		expect(JSON.parse(await readFile(projectPath, "utf-8")).active_goal).toBe("main");

		await run(repo, env, ["new", "Busy Task", "--status", "ready"]);
		await run(repo, env, ["claim", "busy-task", "--agent", "worker-1"]);
		const runPath = join(home, "projects", "demo", "goals", "main", "flows", "runs", "2026-06-11-open-run");
		await mkdir(runPath, { recursive: true });
		await writeFile(join(runPath, "events.jsonl"), `${JSON.stringify({ ts: "2026-06-11T10:00:00.000Z", type: "agent_start", name: "worker" })}\n`);
		const activeWork = await runFail(repo, env, ["goal", "use", "auth"]);
		expect(activeWork).toContain("main has active work");
		expect(activeWork).toContain("1 in-progress task (worker-1)");
		expect(activeWork).toContain("1 incomplete flow run");

		expect(await run(repo, env, ["goal", "use", "auth", "--force"])).toContain("Using goal auth");
		expect(JSON.parse(await readFile(projectPath, "utf-8")).active_goal).toBe("auth");
	});

	test("relocate --to local moves a home board into the repo and cleans up home", async () => {
		const repo = await mkdtemp(join(tmpdir(), "agent-board-reloc-"));
		const home = await mkdtemp(join(tmpdir(), "agent-board-home-"));
		const homeEnv = { ...process.env, AGENT_BOARD_HOME: home };

		await run(repo, homeEnv, ["init", "--project", "demo"]);
		await run(repo, homeEnv, ["new", "Home Task", "--status", "ready"]);
		const source = join(repo, "wireframe-source");
		await mkdir(source, { recursive: true });
		await writeFile(join(source, "index.html"), "<!doctype html><div>Home wireframe</div>");
		await run(repo, homeEnv, ["wireframe", "import", source, "--title", "Home Wireframe"]);

		const out = await run(repo, homeEnv, ["relocate", "--to", "local", "--cleanup"]);
		expect(out).toContain("Relocated demo -> local");
		expect(out).toContain("Source removed.");

		// The task moved into the repo board; the home project and its registry entry are gone.
		const board = join(repo, ".agent-board");
		expect(existsSync(join(board, "goals", "main", "tasks", "home-task.md"))).toBe(true);
		expect(existsSync(join(board, "wireframes", "home-wireframe", "index.html"))).toBe(true);
		expect(existsSync(join(home, "projects", "demo"))).toBe(false);
		expect(JSON.parse(await readFile(join(home, "registry.json"), "utf-8")).projects.demo).toBeUndefined();

		// Without the env override, the relocated board is discovered by walking up.
		expect(await run(repo, noHomeEnv(), ["tasks"])).toContain("home-task");
	});

	test("relocate --to local warns when shared home global docs will be hidden", async () => {
		const repo = await mkdtemp(join(tmpdir(), "agent-board-reloc-global-"));
		const home = await mkdtemp(join(tmpdir(), "agent-board-home-"));
		const env = { ...process.env, AGENT_BOARD_HOME: home };

		await run(repo, env, ["init", "--project", "demo"]);
		await run(repo, env, ["spec", "new", "Shared Contract", "--scope", "global"]);
		await run(repo, env, ["knowledge", "add", "Shared Note", "--kind", "note", "--scope", "global"]);

		const out = await run(repo, env, ["relocate", "--to", "local"]);
		expect(out).toContain("Warning: Shared home overlay not copied");
		expect(out).toContain("1 global spec");
		expect(out).toContain("1 global knowledge note");
		expect(existsSync(join(home, "specs", "shared-contract.md"))).toBe(true);
		expect(await run(repo, noHomeEnv(), ["spec", "list"])).not.toContain("shared-contract");
	});

	test("init --local anchors the board at the git root, not the subdir", async () => {
		const repo = await mkdtemp(join(tmpdir(), "agent-board-local-git-"));
		await gitInit(repo);
		const sub = join(repo, "packages", "app");
		await mkdir(sub, { recursive: true });
		const env = noHomeEnv();

		expect(await run(sub, env, ["init", "--local", "--project", "demo"])).toContain(
			"Initialized demo (local)",
		);
		// The board lives at the git toplevel even though init ran from a subdirectory.
		expect(existsSync(join(repo, ".agent-board", "project.json"))).toBe(true);
		expect(existsSync(join(sub, ".agent-board"))).toBe(false);

		// And it is discovered from the subdir by walking up.
		expect(await run(sub, env, ["new", "Root Task", "--status", "ready"])).toContain("Created root-task");
		expect(existsSync(join(repo, ".agent-board", "goals", "main", "tasks", "root-task.md"))).toBe(true);
	});

	test("skills check confirms bundled docs match the live CLI", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agent-board-drift-"));
		// Pure doc-vs-CLI audit: needs no workspace, touches no home board.
		expect(await run(cwd, noHomeEnv(), ["skills", "check"])).toContain("No drift");
	});

	test("web server serves a local board over HTTP", async () => {
		const repo = await mkdtemp(join(tmpdir(), "agent-board-web-"));
		const env = noHomeEnv();
		await run(repo, env, ["init", "--local", "--project", "webdemo"]);
		await run(repo, env, ["new", "Web Task", "--status", "ready"]);
		await run(repo, env, ["spec", "new", "Web Spec", "--scope", "project"]);
		await run(repo, env, ["knowledge", "add", "Web Note", "--kind", "note", "--scope", "global"]);
		const wireframeSource = join(repo, "web-wireframe-source");
		await mkdir(wireframeSource, { recursive: true });
		await writeFile(join(wireframeSource, "index.html"), "<!doctype html><div>Web Wireframe</div><script type=\"text/babel\" src=\"screen.jsx\"></script>");
		await writeFile(join(wireframeSource, "screen.jsx"), "window.WebWireframe = true;");
		await run(repo, env, ["wireframe", "import", wireframeSource, "--title", "Web Wireframe", "--category", "design"]);
		const runsRoot = join(repo, ".agent-board", "goals", "main", "flows", "runs");
		const liveRun = "2026-06-11-live-flow";
		const staleRun = "2026-06-10-stale-flow";
		const doneRun = "2026-06-09-done-flow";
		await mkdir(join(runsRoot, liveRun), { recursive: true });
		await writeFile(
			join(runsRoot, liveRun, "events.jsonl"),
			[
				{ ts: "2026-06-11T10:00:00.000Z", type: "agent_start", name: "researcher", mode: "read" },
				{ ts: "2026-06-11T10:00:01.000Z", type: "agent_delta", name: "researcher", chars: 42, preview: "live preview from streaming telemetry" },
			].map((event) => JSON.stringify(event)).join("\n") + "\n",
		);
		await mkdir(join(runsRoot, staleRun), { recursive: true });
		const staleEventsPath = join(runsRoot, staleRun, "events.jsonl");
		await writeFile(
			staleEventsPath,
			[
				{ ts: "2026-06-10T10:00:00.000Z", type: "agent_start", name: "critic", mode: "read" },
				{ ts: "2026-06-10T10:00:01.000Z", type: "agent_delta", name: "critic", chars: 20, preview: "old preview" },
			].map((event) => JSON.stringify(event)).join("\n") + "\n",
		);
		const old = new Date(Date.now() - 30 * 60 * 1000);
		await utimes(staleEventsPath, old, old);
		await mkdir(join(runsRoot, doneRun), { recursive: true });
		await writeFile(
			join(runsRoot, doneRun, "events.jsonl"),
			[
				{ ts: "2026-06-09T10:00:00.000Z", type: "agent_start", name: "synth", mode: "read" },
				{ ts: "2026-06-09T10:00:02.000Z", type: "agent_finish", name: "synth", chars: 80 },
			].map((event) => JSON.stringify(event)).join("\n") + "\n",
		);
		await writeFile(join(runsRoot, doneRun, "summary.md"), "# Flow Run\n\nDone.\n");

		// A real starting port (parsePositiveInt rejects 0); the server falls back to
		// a free port on collision and prints the actual URL, which the test parses.
		const proc = Bun.spawn(["bun", cli, "web", "--no-open", "--port", "47352"], {
			cwd: repo,
			env,
			stdout: "pipe",
			stderr: "pipe",
		});
		try {
			const url = await waitForWebUrl(proc.stdout as ReadableStream<Uint8Array>);
			const res = await fetch(`${url}/api/board`);
			const body = (await res.json()) as {
				projects: Array<{ slug: string }>;
				tasks: Array<{ meta: { id: string } }>;
				specs: Array<{ scope: string; meta: { id: string } }>;
				knowledge: Array<{ scope: string; meta: { id: string } }>;
				wireframes: Array<{ scope: string; meta: { id: string }; url: string }>;
				runs: Array<{ id: string; status: string; active: boolean; runningAgents: number; preview?: string }>;
				current: { project: string };
			};
			// The local board is discovered and served with no registry, no env.
			expect(body.projects.map((p) => p.slug)).toContain("webdemo");
			expect(body.tasks.map((t) => t.meta.id)).toContain("web-task");
			expect(body.specs.filter((s) => s.meta.id === "web-spec").length).toBe(1);
			expect(body.knowledge.filter((k) => k.meta.id === "web-note").length).toBe(1);
			expect(body.knowledge.find((k) => k.meta.id === "web-note")?.scope).toBe("project");
			const wireframe = body.wireframes.find((w) => w.meta.id === "web-wireframe");
			expect(wireframe).toMatchObject({ scope: "project" });
			expect(await (await fetch(new URL(wireframe!.url, url))).text()).toContain("Web Wireframe");
			expect(await (await fetch(new URL(wireframe!.url.replace(/\/[^/]*$/, "/screen.jsx"), url))).text()).toContain("WebWireframe");
			expect(body.current.project).toBe("webdemo");
			expect(body.runs.find((run) => run.id === liveRun)).toMatchObject({
				status: "running",
				active: true,
				runningAgents: 1,
				preview: "live preview from streaming telemetry",
			});
			expect(body.runs.find((run) => run.id === staleRun)).toMatchObject({
				status: "stale",
				active: false,
				runningAgents: 1,
				preview: "old preview",
			});
			expect(body.runs.find((run) => run.id === doneRun)).toMatchObject({
				status: "done",
				active: false,
			});

			const detail = await fetch(`${url}/api/flow-run?id=${liveRun}`);
			const detailBody = (await detail.json()) as { status: string; preview?: string; agents: Array<{ lastActivity?: string }> };
			expect(detailBody.status).toBe("running");
			expect(detailBody.preview).toBe("live preview from streaming telemetry");
			expect(detailBody.agents[0]?.lastActivity).toBe("2026-06-11T10:00:01.000Z");
		} finally {
			proc.kill();
			await proc.exited;
		}
	});

	test("nudge adds an idempotent block, preserves content, and removes cleanly", async () => {
		const repo = await mkdtemp(join(tmpdir(), "agent-board-nudge-"));
		await gitInit(repo);
		const env = noHomeEnv();
		await writeFile(join(repo, "CLAUDE.md"), "# My Project\n\nExisting notes.\n");

		const out = await run(repo, env, ["nudge"]);
		expect(out).toContain("CLAUDE.md: updated"); // existing file, block appended
		expect(out).toContain("AGENTS.md: created"); // new file

		const claude = await readFile(join(repo, "CLAUDE.md"), "utf-8");
		expect(claude).toContain("# My Project"); // original content preserved
		expect(claude).toContain("Existing notes.");
		expect(claude).toContain("## Agent Board");
		expect(await readFile(join(repo, "AGENTS.md"), "utf-8")).toContain("## Agent Board");

		// Idempotent: a refresh does not duplicate the block.
		await run(repo, env, ["nudge"]);
		expect((await readFile(join(repo, "CLAUDE.md"), "utf-8")).match(/agent-board:start/g)?.length).toBe(1);

		// Removal leaves the original content intact.
		expect(await run(repo, env, ["nudge", "--remove"])).toContain("CLAUDE.md: removed");
		const removed = await readFile(join(repo, "CLAUDE.md"), "utf-8");
		expect(removed).not.toContain("agent-board:start");
		expect(removed).toContain("Existing notes.");
	});

	test("CLI hints to add the nudge when missing in a repo, then stays quiet", async () => {
		const repo = await mkdtemp(join(tmpdir(), "agent-board-hint-"));
		await gitInit(repo);
		const env = noHomeEnv();
		await run(repo, env, ["init", "--local", "--project", "demo"]);

		// status surfaces the tip while CLAUDE.md/AGENTS.md lack the block.
		expect(await run(repo, env, ["status"])).toContain("run `agent-board nudge`");

		// once the nudge is present, the tip is gone.
		await run(repo, env, ["nudge"]);
		expect(await run(repo, env, ["status"])).not.toContain("agent-board nudge");
	});

	test("manages goals, scoped specs, scoped knowledge, links, and plan output", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agent-board-cli-"));
		const home = await mkdtemp(join(tmpdir(), "agent-board-home-"));
		const env = { ...process.env, AGENT_BOARD_HOME: home };

		await run(cwd, env, ["init", "--project", "demo"]);
		expect(await run(cwd, env, ["goal", "new", "Auth Goal", "--id", "auth"])).toContain(
			"Created goal auth",
		);
		expect(await run(cwd, env, ["goal", "use", "auth", "--force"])).toContain("Using goal auth");
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

	test("records progress checkpoints on task evidence", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agent-board-progress-"));
		const home = await mkdtemp(join(tmpdir(), "agent-board-home-"));
		const env = { ...process.env, AGENT_BOARD_HOME: home };
		const taskPath = join(home, "projects", "demo", "goals", "main", "tasks", "progress-task.md");

		await run(cwd, env, ["init", "--project", "demo"]);
		await run(cwd, env, ["new", "Progress Task", "--status", "ready"]);

		expect(await run(cwd, env, [
			"progress",
			"progress-task",
			"inspected parser paths",
			"--agent",
			"worker-1",
		])).toContain("Progress progress-task");

		expect(await runWithInput(cwd, env, [
			"progress",
			"progress-task",
			"--from",
			"-",
			"--agent",
			"worker-2",
		], "line one\nline two\n")).toContain("Progress progress-task");

		const task = await readFile(taskPath, "utf-8");
		expect(task).toContain("## Evidence");
		expect(task).toContain("[progress]");
		expect(task).toContain("by worker-1: inspected parser paths");
		expect(task).toContain("by worker-2:\n  line one\n  line two");
		expect(await runFail(cwd, env, ["progress", "progress-task"])).toContain(
			"Progress message cannot be empty",
		);
	});

	test("maintenance reports stale work, broken links, and consolidation candidates without mutating", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agent-board-maintenance-"));
		const home = await mkdtemp(join(tmpdir(), "agent-board-home-"));
		const env = { ...process.env, AGENT_BOARD_HOME: home };
		const taskPath = join(home, "projects", "demo", "goals", "main", "tasks", "stale-task.md");

		await run(cwd, env, ["init", "--project", "demo"]);
		await run(cwd, env, ["new", "Stale Task", "--status", "ready"]);
		await run(cwd, env, ["claim", "stale-task", "--agent", "worker-1"]);
		await run(cwd, env, ["spec", "new", "API Plan"]);
		await run(cwd, env, ["spec", "new", "API Plan"]);
		await run(cwd, env, ["knowledge", "add", "Retry Gotcha", "--kind", "gotcha"]);
		await run(cwd, env, ["knowledge", "add", "Retry Gotcha", "--kind", "gotcha"]);

		const oldIso = "2026-01-01T00:00:00.000Z";
		const task = await readFile(taskPath, "utf-8");
		await writeFile(
			taskPath,
			task
				.replace(/updated: ".*?"/, `updated: "${oldIso}"`)
				.replace("specs: []", 'specs: ["missing-spec"]')
				.replace("depends_on: []", 'depends_on: ["missing-task"]'),
		);

		const runPath = join(home, "projects", "demo", "goals", "main", "flows", "runs", "2026-01-01-stale-run");
		await mkdir(runPath, { recursive: true });
		const eventsPath = join(runPath, "events.jsonl");
		await writeFile(eventsPath, `${JSON.stringify({ ts: oldIso, type: "agent_start", name: "reader", mode: "read" })}\n`);
		const old = new Date("2026-01-01T00:00:00.000Z");
		await utimes(eventsPath, old, old);

		const output = await run(cwd, env, ["maintenance", "--stale-after", "1m"]);
		expect(output).toContain("Maintenance report (read-only): demo/main");
		expect(output).toContain("stale-task");
		expect(output).toContain("2026-01-01-stale-run");
		expect(output).toContain("missing-task");
		expect(output).toContain("missing-spec");
		expect(output).toContain("api-plan");
		expect(output).toContain("retry-gotcha");
		expect(output).toContain("No changes were made");

		const json = JSON.parse(await run(cwd, env, ["maintenance", "--json", "--stale-after", "1m"]));
		expect(json.staleClaims.map((issue: { id: string }) => issue.id)).toContain("stale-task");
		expect(json.flowRuns.map((issue: { id: string }) => issue.id)).toContain("2026-01-01-stale-run");
		expect(json.brokenLinks.map((issue: { ref: string }) => issue.ref).sort()).toEqual([
			"missing-spec",
			"missing-task",
		]);
		expect(json.specConsolidation.duplicates[0].items.length).toBe(2);
		expect(json.knowledgeConsolidation.duplicates[0].items.length).toBe(2);
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
			AGENT_BOARD_FLOW_AGENT_TIMEOUT: "60m",
			// Time throttle wide enough that the fast text stream coalesces into a
			// single delta, then spaced activity beats land in later windows.
			AGENT_BOARD_FLOW_THROTTLE_MS: "50",
			AGENT_BOARD_FLOW_IDLE_HEARTBEAT_MS: "30",
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
		expect(output).toContain("Live progress:");
		expect(output).toContain("researcher: start (read)");
		expect(output).toContain("researcher: working");
		expect(output).toContain("active, no text");
		expect(output).toContain("waiting, no stream");
		expect(output).toContain("Flow run");
		expect(output).toContain("finished");
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
		for (const heartbeat of heartbeats) {
			expect(typeof heartbeat.quietMs).toBe("number");
			expect(heartbeat.timeoutMs).toBe(3_600_000);
			expect(typeof heartbeat.streamIdleMs).toBe("number");
		}
		expect(heartbeats.some((heartbeat) => heartbeat.streamIdleMs === 0)).toBe(true);
		expect(heartbeats.some((heartbeat) => (heartbeat.streamIdleMs as number) > 0)).toBe(true);

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

	test("runs big-job flow primitives with metadata, pipeline, and structured output", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "agent-board-flow-big-"));
		const home = await mkdtemp(join(tmpdir(), "agent-board-home-"));
		const env = {
			...process.env,
			AGENT_BOARD_HOME: home,
			AGENT_BOARD_FLOW_MOCK: "1",
			AGENT_BOARD_FLOW_MOCK_JSON: '{"summary":"ok","count":1}',
		};

		await run(cwd, env, ["init", "--project", "demo"]);
		const scriptPath = join(cwd, "big-flow.mjs");
		await writeFile(
			scriptPath,
			`
export const meta = {
	name: "big-flow",
	description: "Exercise staged structured flow primitives.",
	phases: [
		{ title: "Evaluate", detail: "two schema agents" },
		{ title: "Rollup", detail: "plain JS synthesis" },
	],
};

const schema = {
	type: "object",
	additionalProperties: false,
	properties: {
		summary: { type: "string" },
		count: { type: "integer" },
	},
	required: ["summary", "count"],
};

export default async function flow({ agent, pipeline, parallel }) {
	const rows = await pipeline(
		["alpha", "beta"],
		(item) => agent("Return JSON for " + item, { phase: "Evaluate", label: "eval:" + item, schema }),
		(result, original) => ({ original, summary: result.json.summary, count: result.json.count }),
	);
	const rolled = await parallel(rows, async (row) => row.original + ":" + row.count);
	return { rows, rolled };
}
`,
		);
		await run(cwd, env, ["flow", "write", "big-flow", "--from", scriptPath]);

		const output = await run(cwd, env, ["flow", "run", "big-flow", "--concurrency", "2"]);
		const summaryPath = lineValue(output, "Summary: ");
		const runPath = dirname(summaryPath);
		const summary = await readFile(summaryPath, "utf-8");
		const events = (await readFile(join(runPath, "events.jsonl"), "utf-8"))
			.split("\n")
			.filter((line) => line.length > 0)
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		const agentFiles = await readdir(join(runPath, "agents"));

		expect(summary).toContain("## Flow Metadata");
		expect(summary).toContain("- Name: big-flow");
		expect(summary).toContain("- Evaluate: two schema agents");
		expect(summary).toContain('"original": "alpha"');
		expect(summary).toContain("json:");
		expect(events.some((event) => event.type === "agent_start" && event.phase === "Evaluate" && event.label === "eval:alpha")).toBe(true);
		expect(agentFiles.filter((file) => file.endsWith(".json")).length).toBe(2);
		expect(await readFile(join(runPath, "agents", agentFiles.find((file) => file.endsWith(".json"))!), "utf-8")).toContain('"summary": "ok"');
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

		const runOutput = await run(cwd, env, [
			"flow",
			"run",
			"fix-flow",
			"--input",
			"Fix command boundary",
			"--no-watch",
		]);
		expect(runOutput).toContain("Watch: agent-board flow watch");
		expect(runOutput).not.toContain("Live progress:");
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

function noHomeEnv(): Record<string, string | undefined> {
	const env = { ...process.env };
	delete env.AGENT_BOARD_HOME;
	return env;
}

async function waitForWebUrl(stdout: ReadableStream<Uint8Array>): Promise<string> {
	const reader = stdout.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		for (let i = 0; i < 200; i++) {
			const { value, done } = await reader.read();
			if (value) buffer += decoder.decode(value, { stream: true });
			const match = buffer.match(/http:\/\/\S+/);
			if (match) return match[0];
			if (done) break;
		}
	} finally {
		reader.releaseLock();
	}
	throw new Error(`web server printed no URL: ${buffer}`);
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

async function gitCommitAll(dir: string, message: string): Promise<void> {
	const g = (args: string[]) =>
		Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" }).exited;
	await g(["add", "."]);
	await g(["commit", "-m", message]);
}

async function gitWorktreeAdd(repo: string, path: string): Promise<void> {
	await Bun.spawn(["git", "-C", repo, "worktree", "add", path], {
		stdout: "pipe",
		stderr: "pipe",
	}).exited;
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
