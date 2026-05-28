import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { parseFrontmatter, stringifyFrontmatter } from "../src/markdown.js";
import { createSpec } from "../src/documents.js";
import { gitState } from "../src/git.js";
import { atomicWrite } from "../src/utils.js";
import { createTask, linkTaskSpec, linkTasks, listTasks, pickNextTask } from "../src/tasks.js";
import { parseVerifyCommands } from "../src/verify.js";
import { parseWorkflow, renderPrompt } from "../src/workflow.js";
import type { Workspace } from "../src/types.js";

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

describe("workflow", () => {
	test("parses sequential and parallel steps", () => {
		const workflow = parseWorkflow(`name: dev
default_agent: codex
skills: [agent-board]
context:
  - AGENTS.md
steps:
  - id: implement
    role: main
    prompt: |
      Do work.
  - id: review
    parallel:
      - id: code-review
        agent: claude
        intent: review
        skills: [agent-board]
        prompt: |
          Review.
`);
		expect(workflow.steps).toHaveLength(2);
		expect(workflow.skills).toEqual(["agent-board"]);
		expect("parallel" in workflow.steps[1]!).toBe(true);
		const review = workflow.steps[1]!;
		if (!("parallel" in review)) throw new Error("expected parallel step");
		expect(review.parallel[0]?.intent).toBe("review");
		expect(review.parallel[0]?.skills).toEqual(["agent-board"]);
	});

	test("renders prompt with context", async () => {
		const workspace = await tempWorkspace();
		await writeFile(join(workspace.cwd, "AGENTS.md"), "Repo rules");
		const task = await createTask(workspace, {
			title: "Render Prompt",
			status: "ready",
		});
		const workflow = parseWorkflow(`name: dev
context:
  - repo:AGENTS.md
  - task:current
skills:
  - agent-board
steps:
  - id: implement
    role: worker
    intent: implementation
    skills: [agent-board]
    prompt: |
      Work on {{task.title}} in {{run.path}}.
`);
		const prompt = await renderPrompt({
			workspace,
			task,
			workflow,
			step: workflow.steps[0] as any,
			runPath: join(workspace.goalPath, "runs", "run-1"),
		});
		expect(prompt).toContain("Work on Render Prompt");
		expect(prompt).toContain("Role: worker");
		expect(prompt).toContain("Intent: implementation");
		expect(prompt).toContain("- agent-board");
		expect(prompt).toContain("Repo rules");
		expect(prompt).toContain("Render Prompt");
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
