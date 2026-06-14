import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { parseFrontmatter, stringifyFrontmatter } from "../src/markdown.js";
import { createSpec } from "../src/documents.js";
import { gitState } from "../src/git.js";
import { atomicWrite, findWorktreeMainRoot } from "../src/utils.js";
import { resolveWorkspace } from "../src/workspace.js";
import { createTask, linkTaskSpec, linkTasks, listTasks, pickNextTask } from "../src/tasks.js";
import { formatVerifyEvidence, parseVerifyCommands, runVerify } from "../src/verify.js";
import { DEFAULT_FLOW_AGENT_MODE, DEFAULT_FLOW_AGENT_TIMEOUT_MS, modeToPermission, parseCodexMcpMode, parseDurationMs, parseStructuredOutput, prepareCodexFlowEnvironment, resolveCodexAcpBin, runLimited } from "../src/flow.js";
import type { Workspace } from "../src/types.js";
import { Command } from "commander";
import { findDrift } from "../src/skills-audit.js";
import { inlineBundle, parseShareKind } from "../src/share.js";

describe("markdown frontmatter", () => {
	test("parses and stringifies simple task metadata", () => {
		const doc = parseFrontmatter<Record<string, unknown>>(`---
id: "add-cli"
title: "Add CLI"
status: "ready"
skills: ["agent-board"]
blocked_by: []
relates_to: ["spec"]
---

Body
`);
		expect(doc.meta.id).toBe("add-cli");
		expect(doc.meta.relates_to).toEqual(["spec"]);
		expect(doc.meta.skills).toEqual(["agent-board"]);
		expect(stringifyFrontmatter(doc.meta, doc.body, ["id", "title"])).toContain(
			'id: "add-cli"',
		);
	});
});

describe("tasks", () => {
	test("generates unique slugs and picks ready high priority first", async () => {
		const workspace = await tempWorkspace();
		await createTask(workspace, { title: "Add CLI", status: "todo" });
		await createTask(workspace, {
			title: "Add CLI",
			status: "ready",
			priority: "high",
		});

		const tasks = await listTasks(workspace);
		expect(tasks.map((task) => task.meta.id)).toEqual(["add-cli", "add-cli-2"]);
		expect(pickNextTask(tasks)?.meta.id).toBe("add-cli-2");
	});

	test("defaults PM metadata and links task graph/specs", async () => {
		const workspace = await tempWorkspace();
		const first = await createTask(workspace, {
			title: "Research API",
			status: "ready",
		});
		const second = await createTask(workspace, {
			title: "Implement API",
			status: "ready",
		});
		const spec = await createSpec(workspace, "API Plan");

		await linkTasks(workspace, first.meta.id, second.meta.id);
		await linkTaskSpec(workspace, second.meta.id, spec.meta.id);

		const tasks = await listTasks(workspace);
		const updatedFirst = tasks.find((task) => task.meta.id === first.meta.id)!;
		const updatedSecond = tasks.find((task) => task.meta.id === second.meta.id)!;
		expect(updatedFirst.meta.skills).toEqual([]);
		expect(updatedFirst.meta.blocks).toEqual([second.meta.id]);
		expect(updatedSecond.meta.depends_on).toEqual([first.meta.id]);
		expect(updatedSecond.meta.specs).toEqual([spec.meta.id]);
	});
});

describe("git", () => {
	test("detects branch and detached HEAD", async () => {
		const dir = await mkdtemp(join(tmpdir(), "agent-board-git-unit-"));
		const g = (args: string[]) =>
			Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" }).exited;
		await g(["init", "-b", "main"]);
		await g(["config", "user.email", "t@t.t"]);
		await g(["config", "user.name", "t"]);
		await writeFile(join(dir, "a.txt"), "a");
		await g(["add", "."]);
		await g(["commit", "-m", "one"]);
		await writeFile(join(dir, "b.txt"), "b");
		await g(["add", "."]);
		await g(["commit", "-m", "two"]);

		const onBranch = await gitState(dir);
		expect(onBranch.isRepo).toBe(true);
		expect(onBranch.detached).toBe(false);
		expect(onBranch.branch).toBe("main");

		await g(["checkout", "HEAD~1"]);
		const detached = await gitState(dir);
		expect(detached.detached).toBe(true);
		expect(detached.branch).toBe(null);
	});

	test("reports non-git directories", async () => {
		const dir = await mkdtemp(join(tmpdir(), "agent-board-nogit-"));
		expect((await gitState(dir)).isRepo).toBe(false);
	});
});

describe("atomic write", () => {
	test("writes content and leaves no temp file behind", async () => {
		const dir = await mkdtemp(join(tmpdir(), "agent-board-atomic-"));
		const path = join(dir, "file.txt");
		await atomicWrite(path, "hello");
		expect(await readFile(path, "utf-8")).toBe("hello");
		await atomicWrite(path, "world");
		expect(await readFile(path, "utf-8")).toBe("world");
		expect(await readdir(dir)).toEqual(["file.txt"]);
	});
});

describe("verify", () => {
	test("parses fenced commands and preserves commas", () => {
		const body = ["## Verify", "", "```sh", "bun run check-types", "turbo run test --filter=admin,framework", "```"].join("\n");
		expect(parseVerifyCommands(body)).toEqual([
			"bun run check-types",
			"turbo run test --filter=admin,framework",
		]);
	});

	test("returns no commands for empty or absent blocks", () => {
		expect(parseVerifyCommands("## Verify\n\n<!-- none -->\n")).toEqual([]);
		expect(parseVerifyCommands("## Goal\n\nNothing here.\n")).toEqual([]);
	});

	test("surfaces output tail for failed commands, keeps passing one-line", async () => {
		const results = await runVerify(process.cwd(), [
			"echo hello-pass",
			"echo boom-marker >&2; exit 3",
		]);
		expect(results[0]!.exitCode).toBe(0);
		expect(results[1]!.exitCode).toBe(3);
		const evidence = formatVerifyEvidence(results, "2026-05-29T00:00:00.000Z", null);
		expect(evidence).toContain("- `echo hello-pass` exit=0");
		expect(evidence).toContain("- `echo boom-marker >&2; exit 3` exit=3");
		expect(evidence).toContain("boom-marker");
		expect(evidence).not.toContain("hello-pass\n```");
	});

	test(
		"kills a hanging command on timeout and records it as failure",
		async () => {
			process.env.AGENT_BOARD_VERIFY_TIMEOUT_MS = "200";
			try {
				const results = await runVerify(process.cwd(), ["sleep 30"]);
				expect(results[0]!.exitCode).toBe(124);
				expect(results[0]!.output).toContain("timed out after");
			} finally {
				delete process.env.AGENT_BOARD_VERIFY_TIMEOUT_MS;
			}
		},
		// Headroom over bun's 5s default: kill + bounded drain is ~1.2s worst
		// case, but CI runners spawn slowly.
		15_000,
	);

	test(
		"timeout evidence does not hang when a child keeps the pipes open",
		async () => {
			process.env.AGENT_BOARD_VERIFY_TIMEOUT_MS = "200";
			try {
				const started = Date.now();
				// The backgrounded sleep inherits stdout/stderr and outlives the
				// killed sh, so stream EOF never arrives; only the bounded drain
				// lets runVerify return.
				const results = await runVerify(process.cwd(), ["sleep 30 & sleep 30"]);
				expect(results[0]!.exitCode).toBe(124);
				expect(results[0]!.output).toContain("timed out after");
				expect(Date.now() - started).toBeLessThan(10_000);
			} finally {
				delete process.env.AGENT_BOARD_VERIFY_TIMEOUT_MS;
			}
		},
		15_000,
	);
});

describe("flow agent mode", () => {
	test("maps read to auto-reject and write to auto-allow, defaulting to read", () => {
		expect(DEFAULT_FLOW_AGENT_MODE).toBe("read");
		expect(modeToPermission("read")).toBe("auto-reject");
		expect(modeToPermission("write")).toBe("auto-allow");
		expect(modeToPermission(DEFAULT_FLOW_AGENT_MODE)).toBe("auto-reject");
	});

	test("parses activity watchdog durations", () => {
		expect(DEFAULT_FLOW_AGENT_TIMEOUT_MS).toBe(7_200_000);
		expect(parseDurationMs("250ms", "--agent-timeout")).toBe(250);
		expect(parseDurationMs("180s", "--agent-timeout")).toBe(180_000);
		expect(parseDurationMs("60m", "--agent-timeout")).toBe(3_600_000);
		expect(parseDurationMs("120m", "--agent-timeout")).toBe(7_200_000);
		expect(() => parseDurationMs("0", "--agent-timeout")).toThrow("--agent-timeout");
		expect(() => parseDurationMs("1h", "--agent-timeout")).toThrow("--agent-timeout");
	});
});

describe("flow Codex ACP override", () => {
	test("resolves AGENT_BOARD_CODEX_ACP_BIN when set", async () => {
		const dir = await mkdtemp(join(tmpdir(), "agent-board-codex-acp-"));
		const bin = join(dir, "codex-acp");
		await writeFile(bin, "");
		const previous = process.env.AGENT_BOARD_CODEX_ACP_BIN;
		try {
			process.env.AGENT_BOARD_CODEX_ACP_BIN = bin;
			expect(resolveCodexAcpBin()).toEqual({ path: bin, source: "env" });

			process.env.AGENT_BOARD_CODEX_ACP_BIN = " ";
			expect(resolveCodexAcpBin()?.source).not.toBe("env");
		} finally {
			if (previous === undefined) delete process.env.AGENT_BOARD_CODEX_ACP_BIN;
			else process.env.AGENT_BOARD_CODEX_ACP_BIN = previous;
		}
	});

	test("rejects a missing AGENT_BOARD_CODEX_ACP_BIN path", () => {
		const previous = process.env.AGENT_BOARD_CODEX_ACP_BIN;
		try {
			process.env.AGENT_BOARD_CODEX_ACP_BIN = join(tmpdir(), "missing-codex-acp");
			expect(() => resolveCodexAcpBin()).toThrow("AGENT_BOARD_CODEX_ACP_BIN");
		} finally {
			if (previous === undefined) delete process.env.AGENT_BOARD_CODEX_ACP_BIN;
			else process.env.AGENT_BOARD_CODEX_ACP_BIN = previous;
		}
	});

	test("isolates Codex home without copying global MCP servers", async () => {
		const workspace = await tempWorkspace();
		const sourceHome = await mkdtemp(join(tmpdir(), "agent-board-codex-source-"));
		const boardHome = await mkdtemp(join(tmpdir(), "agent-board-home-"));
		await writeFile(join(sourceHome, "auth.json"), '{"token":"test"}\n');
		await writeFile(
			join(sourceHome, "config.toml"),
			[
				"[features]",
				"rmcp_client = true",
				"",
				"[mcp_servers.linear]",
				'url = "https://mcp.linear.app/mcp"',
				"",
			].join("\n"),
		);
		const saved = saveEnv(["CODEX_HOME", "AGENT_BOARD_HOME", "AGENT_BOARD_FLOW_CODEX_HOME"]);
		try {
			process.env.CODEX_HOME = sourceHome;
			process.env.AGENT_BOARD_HOME = boardHome;
			const result = await prepareCodexFlowEnvironment(workspace, {
				runtime: "codex",
				codexMcpMode: "isolated",
			});
			const targetHome = result.env.CODEX_HOME!;
			expect(targetHome).toContain(join(boardHome, "codex-flow-home", workspace.projectSlug));
			expect(await readFile(join(targetHome, "auth.json"), "utf-8")).toBe('{"token":"test"}\n');
			const config = await readFile(join(targetHome, "config.toml"), "utf-8");
			expect(config).toContain("rmcp_client = false");
			expect(config).toContain(`[projects.${JSON.stringify(workspace.repoPath)}]`);
			expect(config).not.toContain("mcp_servers");
			expect(result.diagnostics.join("\n")).toContain("isolated CODEX_HOME");
		} finally {
			restoreEnv(saved);
		}
	});

	test("Codex MCP mode parser accepts isolated and inherit", () => {
		expect(parseCodexMcpMode("isolated")).toBe("isolated");
		expect(parseCodexMcpMode("inherit")).toBe("inherit");
		expect(() => parseCodexMcpMode("global")).toThrow("Invalid Codex MCP mode");
	});
});

describe("flow structured output", () => {
	const schema = {
		type: "object",
		additionalProperties: false,
		properties: {
			title: { type: "string" },
			severity: { type: "string", enum: ["high", "low"] },
			count: { type: "integer" },
		},
		required: ["title", "severity", "count"],
	} as const;

	test("parses and validates fenced JSON", () => {
		expect(parseStructuredOutput('```json\n{"title":"A","severity":"high","count":2}\n```', schema)).toEqual({
			title: "A",
			severity: "high",
			count: 2,
		});
	});

	test("rejects schema drift", () => {
		expect(() =>
			parseStructuredOutput('{"title":"A","severity":"medium","count":2,"extra":true}', schema),
		).toThrow("Structured output failed schema validation");
	});
});

describe("runLimited", () => {
	test("stops scheduling new tasks once one fails", async () => {
		let started = 0;
		const tasks = Array.from({ length: 6 }, (_unused, index) => async () => {
			started++;
			if (index === 0) throw new Error("boom");
			return index;
		});

		await expect(runLimited(tasks, 1)).rejects.toThrow("boom");
		expect(started).toBe(1);
	});

	test("lets in-flight workers finish but pulls no new tasks after a failure", async () => {
		let started = 0;
		const tasks = Array.from({ length: 6 }, (_unused, index) => async () => {
			started++;
			if (index === 0) throw new Error("boom");
			await Bun.sleep(1);
			return index;
		});

		await expect(runLimited(tasks, 2)).rejects.toThrow("boom");
		expect(started).toBe(2);
		expect(started).toBeLessThan(tasks.length);
	});
});

describe("skill drift audit", () => {
	function fixture(): Command {
		const program = new Command();
		const foo = program.command("foo").option("--bar <v>", "bar");
		foo.command("baz").option("--qux", "qux");
		return program;
	}

	test("accepts real commands and flags", () => {
		const program = fixture();
		expect(findDrift("`agent-board foo --bar x`", program)).toEqual([]);
		expect(findDrift("`agent-board foo baz --qux`", program)).toEqual([]);
	});

	test("flags a stale command name", () => {
		const issues = findDrift("`agent-board nope`", fixture());
		expect(issues.map((issue) => [issue.kind, issue.token])).toEqual([["unknown-command", "nope"]]);
	});

	test("flags a stale flag on a real command", () => {
		const issues = findDrift("`agent-board foo --gone`", fixture());
		expect(issues.map((issue) => [issue.kind, issue.token])).toEqual([["unknown-flag", "--gone"]]);
	});

	test("ignores prose and placeholders, only checks code context", () => {
		expect(findDrift("Use agent-board foo to orchestrate things.", fixture())).toEqual([]);
		expect(findDrift("`agent-board foo <subcommand>`", fixture())).toEqual([]);
	});
});

describe("worktree resolution", () => {
	test("resolves a linked worktree to its main checkout via commondir", async () => {
		const base = await mkdtemp(join(tmpdir(), "agent-board-wt-"));
		const main = join(base, "main");
		const wt = join(base, "wt");
		await mkdir(join(main, ".git", "worktrees", "wt"), { recursive: true });
		await writeFile(join(main, ".git", "worktrees", "wt", "commondir"), "../..\n");
		await mkdir(wt, { recursive: true });
		await writeFile(join(wt, ".git"), `gitdir: ${join(main, ".git", "worktrees", "wt")}\n`);

		// Detected from the worktree root and from any (even not-yet-created) subdir.
		expect(findWorktreeMainRoot(wt)).toEqual({ worktreeRoot: wt, mainRoot: main });
		expect(findWorktreeMainRoot(join(wt, "src", "deep"))).toEqual({ worktreeRoot: wt, mainRoot: main });
		// The main checkout has a .git directory, not a pointer file.
		expect(findWorktreeMainRoot(main)).toBeNull();
	});

	test("resolves a relative gitdir pointer without a commondir file", async () => {
		const base = await mkdtemp(join(tmpdir(), "agent-board-wt-rel-"));
		const main = join(base, "main");
		const wt = join(base, "wt");
		await mkdir(join(main, ".git", "worktrees", "wt"), { recursive: true });
		await mkdir(wt, { recursive: true });
		await writeFile(join(wt, ".git"), "gitdir: ../main/.git/worktrees/wt");
		expect(findWorktreeMainRoot(wt)).toEqual({ worktreeRoot: wt, mainRoot: main });
	});

	test("rejects submodule pointers and non-git directories", async () => {
		const base = await mkdtemp(join(tmpdir(), "agent-board-wt-sub-"));
		const sub = join(base, "sub");
		await mkdir(sub, { recursive: true });
		await writeFile(join(sub, ".git"), `gitdir: ${join(base, "main", ".git", "modules", "sub")}\n`);
		expect(findWorktreeMainRoot(sub)).toBeNull();
		expect(findWorktreeMainRoot(join(base, "plain"))).toBeNull();
	});

	test("resolves a home-board project from a worktree and routes repoPath to it", async () => {
		const base = await mkdtemp(join(tmpdir(), "agent-board-wt-ws-"));
		const home = join(base, "home");
		const repo = join(base, "repo");
		const wt = join(base, "repo-wt");
		const projectPath = join(home, "projects", "demo");
		await mkdir(join(projectPath, "goals", "main"), { recursive: true });
		await writeFile(
			join(home, "registry.json"),
			JSON.stringify({ projects: { demo: { slug: "demo", repo_path: repo, project_path: projectPath } } }),
		);
		await writeFile(
			join(projectPath, "project.json"),
			JSON.stringify({
				slug: "demo",
				repo_path: repo,
				active_goal: "main",
				created: "2026-01-01T00:00:00.000Z",
				updated: "2026-01-01T00:00:00.000Z",
			}),
		);
		await mkdir(join(repo, ".git", "worktrees", "wt"), { recursive: true });
		await writeFile(join(repo, ".git", "worktrees", "wt", "commondir"), "../..\n");
		await mkdir(wt, { recursive: true });
		await writeFile(join(wt, ".git"), `gitdir: ${join(repo, ".git", "worktrees", "wt")}\n`);

		const saved: Record<string, string | undefined> = {};
		for (const key of ["AGENT_BOARD_HOME", "AGENT_BOARD_PROJECT", "AGENT_BOARD_GOAL", "AGENT_BOARD_REPO"]) {
			saved[key] = process.env[key];
			delete process.env[key];
		}
		process.env.AGENT_BOARD_HOME = home;
		try {
			const workspace = resolveWorkspace(wt);
			expect(workspace.projectSlug).toBe("demo");
			// Git operations target the worktree the agent works in...
			expect(workspace.repoPath).toBe(wt);
			// ...while the main checkout keeps resolving to the canonical repo.
			expect(resolveWorkspace(repo).repoPath).toBe(repo);
		} finally {
			for (const [key, value] of Object.entries(saved)) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		}
	});

	test("names known projects and routing overrides when nothing matches", async () => {
		const base = await mkdtemp(join(tmpdir(), "agent-board-wt-miss-"));
		const home = join(base, "home");
		const elsewhere = join(base, "elsewhere");
		await mkdir(home, { recursive: true });
		await mkdir(elsewhere, { recursive: true });
		await writeFile(
			join(home, "registry.json"),
			JSON.stringify({ projects: { demo: { slug: "demo", repo_path: join(base, "repo"), project_path: join(home, "projects", "demo") } } }),
		);

		const saved: Record<string, string | undefined> = {};
		for (const key of ["AGENT_BOARD_HOME", "AGENT_BOARD_PROJECT", "AGENT_BOARD_GOAL", "AGENT_BOARD_REPO"]) {
			saved[key] = process.env[key];
			delete process.env[key];
		}
		process.env.AGENT_BOARD_HOME = home;
		try {
			expect(() => resolveWorkspace(elsewhere)).toThrow(/No agent-board project found for .*elsewhere/);
			expect(() => resolveWorkspace(elsewhere)).toThrow(/Known projects in .*registry\.json: demo/);
			expect(() => resolveWorkspace(elsewhere)).toThrow(/--project <slug> or set AGENT_BOARD_PROJECT/);
		} finally {
			for (const [key, value] of Object.entries(saved)) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		}
	});
});

async function tempWorkspace(): Promise<Workspace> {
	const cwd = await mkdtemp(join(tmpdir(), "agent-board-cwd-"));
	const root = await mkdtemp(join(tmpdir(), "agent-board-root-"));
	const projectPath = join(root, "projects", "test");
	const goalPath = join(projectPath, "goals", "main");
	for (const dir of ["workflows", "specs", "knowledge"]) {
		await mkdir(join(root, dir), { recursive: true });
		await mkdir(join(projectPath, dir), { recursive: true });
		await mkdir(join(goalPath, dir), { recursive: true });
	}
	for (const dir of ["tasks", "runs"]) {
		await mkdir(join(goalPath, dir), { recursive: true });
	}
	return {
		root,
		mode: "home",
		projectSlug: "test",
		projectPath,
		repoPath: cwd,
		goalSlug: "main",
		goalPath,
		cwd,
		project: {
			slug: "test",
			repo_path: cwd,
			active_goal: "main",
			related_projects: [],
			created: new Date().toISOString(),
			updated: new Date().toISOString(),
		},
	};
}

function saveEnv(keys: string[]): Record<string, string | undefined> {
	const saved: Record<string, string | undefined> = {};
	for (const key of keys) saved[key] = process.env[key];
	return saved;
}

function restoreEnv(saved: Record<string, string | undefined>): void {
	for (const [key, value] of Object.entries(saved)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
}

describe("share", () => {
	test("parseShareKind accepts kinds and rejects others", () => {
		expect(parseShareKind("design")).toBe("design");
		expect(parseShareKind("knowledge")).toBe("knowledge");
		expect(() => parseShareKind("flow")).toThrow(/Invalid kind/);
	});

	test("inlineBundle inlines local assets, leaves external refs, guards traversal", async () => {
		const root = await mkdtemp(join(tmpdir(), "agent-board-share-"));
		const bundle = join(root, "bundle");
		await mkdir(bundle);
		await writeFile(join(root, "secret.txt"), "TOPSECRET");
		await writeFile(join(bundle, "kit.css"), ".hero{background:url(bg.svg)}");
		await writeFile(join(bundle, "bg.svg"), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
		await writeFile(join(bundle, "app.jsx"), "const answer = 42;");
		await writeFile(join(bundle, "pic.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));
		await writeFile(
			join(bundle, "index.html"),
			[
				'<link rel="stylesheet" href="kit.css">',
				'<script src="app.jsx" type="text/babel"></script>',
				'<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>',
				'<img src="pic.png">',
				'<img src="../secret.txt">',
			].join("\n"),
		);

		const { html, bytes } = await inlineBundle(bundle, "index.html");

		// Local stylesheet → inline <style>, and its url(bg.svg) → data URL
		expect(html).toContain("<style>");
		expect(html).not.toContain('href="kit.css"');
		expect(html).toContain("data:image/svg+xml;base64,");
		// Local script → inline content, original type attribute preserved
		expect(html).toContain("const answer = 42;");
		expect(html).toContain('type="text/babel"');
		expect(html).not.toContain('src="app.jsx"');
		// External script untouched
		expect(html).toContain("https://unpkg.com/react@18/umd/react.production.min.js");
		// Local image → data URL
		expect(html).toContain("data:image/png;base64,");
		// Path traversal is refused: ref stays, secret is never embedded
		expect(html).toContain('src="../secret.txt"');
		expect(html).not.toContain("TOPSECRET");
		expect(bytes).toBe(Buffer.byteLength(html, "utf8"));
	});
});
