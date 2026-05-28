# RFC: agent-board execution contract

> **Implementation status (2026-05-28):** **v0.2.0** — PR1 (execution core: `git.ts`, `verify.ts`, `TaskMeta` `branch`/`verified`/`verified_sha`, claim guards, verify-gated `done`, `--force --reason`) **and** PR3 (skills split `agent-board`/`-worker`/`-research`, Cursor `~/.cursor/skills/` install, `skills doctor`, `dev` workflow → `agent-board-worker`). **v0.2.1** — multi-agent concurrency hardening (§5b): atomic writes, atomic claim lock, unique run ids, `AGENT_BOARD_REPO` worktree override. Installed via the bun-linked global binary; tests pass, typecheck clean. **Remaining:** PR2 (`export`/`next --context`) and Phase B. Cursor paths verified against [cursor.com/docs/skills](https://cursor.com/docs/skills).

**Status:** Draft for review
**Author:** Claude (planning pass)
**Companion:** [research-execution-contract-from-questpie-session.md](research-execution-contract-from-questpie-session.md)
**Repo:** `agent-board` v0.1.0 — file-based `~/.agent-board`, Bun/TS, `commander`
**Date:** 2026-05-28

---

## 0. TL;DR

The research brief is **correct on every code-level gap** (validated below). The board is a strong task graph + workflow runner but has no execution contract: no git awareness, no verify gate, no evidence, no agent prompt export, no claim guards.

This RFC recommends building the **CLI enforcement core first** (git + verify + task-meta, the user-scoped PR1), then export/claim-guards (PR2), then the skills split + Cursor install (PR3). The brief argues skills-first; §1.1 reconciles why enforcement-core-first is the right *PR* ordering even though skills are the primary *integration*.

**One finding overrides the brief's proposed schema:** the existing frontmatter parser cannot represent `verify: [{ cmd: "..." }]` (it serializes to `["[object Object]"]`), and commas inside any inline-list value are mis-split (`--filter=a,b` → two items). Verify **commands therefore live in a `## Verify` body block**, not frontmatter; only scalar pass-stamps (`branch`, `verified`, `verified_sha`) go in `TaskMeta`. Evidence proof in §2.1.

---

## 1. Validation against current `src/`

Every gap in brief §4 was checked against the actual code. All confirmed.

| Brief claim | Status | Evidence in code |
|---|---|---|
| `TaskMeta` has no `branch`/`verify`/`evidence`/`size` | ✅ Confirmed | [types.ts:16](../src/types.ts) — fields end at `relates_to`/`created`/`updated` |
| `done` only checks `hasUncheckedCriteria()`; `--force` no reason | ✅ Confirmed | [tasks.ts:128](../src/tasks.ts), [index.ts:448](../src/index.ts) — only `--force` flag |
| Runner sets `in_progress` with `force: true` | ✅ Confirmed | [runner.ts:14](../src/runner.ts) |
| `writeSummary()` logs only exit codes | ✅ Confirmed | [runner.ts:235](../src/runner.ts) — `exit=${step.exitCode}` lines |
| `git.ts` does not exist | ✅ Confirmed | no file in `src/` |
| `verify.ts` does not exist | ✅ Confirmed | no file in `src/` |
| Skills install links `.claude` + `.agents`, not Cursor | ✅ Confirmed | [workspace.ts:189-190](../src/workspace.ts) |
| No `export` / `worker-pack` / `next --context` | ✅ Confirmed | [index.ts:174](../src/index.ts) `next` prints one line |
| `claim` has no deps/assignee/status guards | ✅ Confirmed | [index.ts:322](../src/index.ts) → `setTaskStatus(in_progress)` only |

**Additional findings the brief did not capture:**

1. **Frontmatter parser cannot hold structured verify** (§2.1) — the single most important design constraint.
2. **Snapshot tests pin the skills layout.** [cli.test.ts:40-49](../test/cli.test.ts) asserts the exact `skills/` dir list and `references/` file list. Any skill split or new reference file **breaks these tests** — another reason to keep skills out of PR1.
3. **Runner spawns agents at `workspace.cwd`, not `workspace.repoPath`** ([runner.ts:106](../src/runner.ts)). Verify should run from `repoPath` for determinism (they are usually equal, but not guaranteed — `cwd` is `process.cwd()`, `repoPath` is the registered root).
4. **No existing test calls `claim` or `done`.** Adding guards to those paths will not break the current suite (baseline: **11 pass, typecheck clean**).
5. **`renderPrompt` already assembles task + specs + knowledge + guidance** ([workflow.ts:65](../src/workflow.ts)). `export` should reuse this machinery, not reimplement context loading.

---

### 1.1 Sequencing: skills-first (brief) vs enforcement-core-first (this RFC)

The brief (§5, §13) argues **skills must ship before git/verify** — "agents need to know the rules; CLI then enforces." That product thesis is right: skills are how Cursor/Claude/Codex load behavior, and the session failed because *workers never loaded the skill*.

But the **first PR** scope is the enforcement core, for four concrete reasons:

1. **The skills reference commands that must exist first.** A worker skill that says "run `agent-board verify <id>`" is a lie until `verify` ships. Building the verbs first means the skill rewrite can point at real, tested commands.
2. **Enforcement core is independently testable and low-risk.** git/verify/meta are pure additions behind feature-gated behavior (no verify block = old behavior). No snapshot tests touched.
3. **Skills split is high-churn.** It breaks the layout snapshot tests ([cli.test.ts:40-49](../test/cli.test.ts)), touches install paths, and depends on an *unverified* Cursor skills directory (§3, Q2). Worth doing carefully in its own PR.
4. **The two layers ship within one cycle.** "Enforcement first" is a *PR* ordering, not a release ordering. PR1→PR2→PR3 all land in Phase A; agents get both layers together.

**Net:** skills are the primary integration; the enforcement primitives are the prerequisite. Build verbs (PR1–2), then teach them (PR3). The risk to manage is that enforcement without skills is *silently inert* for delegated workers — so PR3 must not slip.

---

## 2. Design decisions

### 2.1 Verify command storage — **body `## Verify` block, not frontmatter** (decisive)

The brief proposes `verify: [{ cmd: "bun run check-types" }]`. Empirical test against [markdown.ts](../src/markdown.ts):

```
input  meta.verify = [{ cmd: "bun run check-types" }, { cmd: "bun test" }]
output verify: ["[object Object]", "[object Object]"]        ← objects destroyed
```

`formatValue` ([markdown.ts:83](../src/markdown.ts)) does `JSON.stringify(String(item))` per element; objects become `"[object Object]"`. **Object arrays are impossible** without rewriting the parser.

String arrays round-trip, but commas break them:

```
input  verify: ["turbo run check --filter=a,b"]
output parsed back = ['"turbo run check --filter=a', 'b"']    ← split on comma
```

`parseScalar` splits inline `[...]` on `,`. Turbo/Nx filters (`--filter=a,b`) are exactly the monorepo case the brief calls out (Q10). So inline frontmatter arrays are unsafe for commands.

**Decision:** verify **commands** live in the task body under a `## Verify` fenced block — one command per line:

````markdown
## Verify

```sh
bun run check-types
turbo run test --filter=@questpie/admin,@questpie/framework
```
````

This mirrors the existing `## Acceptance Criteria` body-parse pattern (`hasUncheckedCriteria`, [tasks.ts:247](../src/tasks.ts)), is immune to commas/quotes/objects, is human-editable, and co-locates with `## Evidence`. **No verify block, or an empty one, = zero commands = today's behavior** (AC-only gate). The default task template ships the heading with a comment and no fence, so fresh tasks parse to zero commands and the gate stays dormant until someone fills it in.

Machine-readable **pass-state** goes in frontmatter as scalars (safe): `verified` (ISO timestamp of last all-pass) and `verified_sha` (HEAD at verify time, for P1 freshness checks).

> **Alternative considered:** keep `verify` as a frontmatter string array and switch the array *writer* from inline `[...]` to block-list (`  - "cmd"`) form, which the parser reads comma-safely. Rejected for PR1: it changes serialization for *all* arrays (`blocks`, `depends_on`, …), churning every existing task file. Revisit only if structured per-command options (name, cwd, optional) are ever needed.

### 2.2 Git module — detection, not mutation

`git.ts` is **read-only**: it observes state and reports; it never checks out, commits, or stashes (those are the agent's job and are high-blast-radius). Plumbing confirmed empirically:

| Need | Command | Detached-HEAD result |
|---|---|---|
| is repo | `git rev-parse --is-inside-work-tree` | exit 128 if not a repo |
| branch | `git symbolic-ref --quiet --short HEAD` | **exit 1, empty** → detached |
| head sha | `git rev-parse HEAD` | sha |
| dirty | `git status --porcelain` | non-empty if dirty |

```ts
export interface GitState {
  isRepo: boolean;
  branch: string | null;   // null ⇒ detached HEAD
  detached: boolean;
  head: string | null;
  dirty: boolean;
}
export async function gitState(repoPath: string): Promise<GitState>;
```

**Guards (Q7):** detached HEAD on `claim` is a **hard block** (`--allow-detached` escape) — it was the proven failure (7 off-branch commits). Dirty tree is a **warning only** — claiming writes no code; a dirty tree is normal WIP. Branch mismatch (`task.branch` set, current branch differs) is a **warning** in PR1 (auto-checkout is too side-effecting to do silently).

Guards only fire when `isRepo` is true, so non-git projects are unaffected.

### 2.3 Verify module — run from `repoPath`, stamp on pass

```ts
export interface VerifyResult { cmd: string; exitCode: number; output: string; }
export function parseVerifyCommands(body: string): string[];     // from ## Verify fence
export async function runVerify(repoPath: string, cmds: string[]): Promise<VerifyResult[]>;
```

- Each command runs via `Bun.spawn(["sh", "-c", cmd], { cwd: repoPath })` — shell so `bun run x && y` and filters work; `repoPath` (not `cwd`) for determinism (§1 finding 3).
- All exit 0 → stamp `meta.verified = nowIso()`, `meta.verified_sha = head`, append a pass entry to `## Evidence`.
- Any non-zero → do **not** stamp; append a failure entry (cmd + exit + tail of output); command exits non-zero so the agent sees red.
- **Arbitrary command execution is by design** — the same trust model as `npm`/`bun` scripts, and the config skill already states "agent-board is not a security boundary." Commands are the user's own, in their own repo. No injection surface beyond what the user authored.

### 2.4 Done gate — additive, dormant by default

`setTaskStatus(..., "done", ...)` ([tasks.ts:120](../src/tasks.ts)) gains a verify check layered on the existing AC check:

```
if status == done and not force:
    if hasUncheckedCriteria(body):                    → reject (unchanged)
    if parseVerifyCommands(body).length and !verified: → reject "run agent-board verify <id> first"
```

`--force` bypasses both but **requires `--reason`** when a verify gate is being skipped; the reason is logged to `## Evidence` as `- [forced] done <iso> by <agent>: <reason>`. Tasks with no `## Verify` block behave exactly as today — **full backward compatibility** (Q11).

### 2.5 Evidence format — markdown in the task body (Q9)

Evidence lives in a `## Evidence` section of the task file, appended via the existing `appendSection` helper ([tasks.ts:252](../src/tasks.ts)). Rationale: one auditable source of truth, survives manual edits, matches existing patterns, no `evidence.json` to keep in sync. Heavy logs (full verify stdout, git diff-stat) still go under `runs/<id>/` so the task file stays scannable.

### 2.6 Backward compatibility (Q11)

- New `TaskMeta` fields (`branch`, `verified`, `verified_sha`) default to `""` in `normalizeTaskMeta` ([tasks.ts:215](../src/tasks.ts)); old task files load unchanged.
- Fields added to `TASK_ORDER` ([tasks.ts:9](../src/tasks.ts)) for stable placement; lazily written on next save (additive, non-destructive).
- Verify and git gates are **inert unless configured** (no `## Verify` block / non-git repo). No data migration; the existing `migrate` command is untouched.

---

## 3. Phased plan

### Phase A — P0 execution contract (the focus)

| PR | Title | Files | Gates added |
|---|---|---|---|
| **PR1** | Execution contract core | `git.ts` (new), `verify.ts` (new), `types.ts`, `tasks.ts`, `index.ts`, tests | git detached guard on claim; verify gate on done; evidence; `--force --reason` |
| **PR2** | Worker pack & claim guards | `export.ts` (new), `tasks.ts` (`claimTask` deps/assignee guards), `index.ts` (`export`, `next --context`) | deps-done + assignee-conflict guards; one-command worker prompt |
| **PR3** | Skills split + Cursor + doctor | `skills.ts`, `workspace.ts`, `index.ts`, default workflow YAML, tests | `agent-board` / `-worker` / `-research` skills; Cursor install path; `skills doctor` |

PR1 is specified in detail in §5.

### Phase B — P1 orchestration quality

- Rich run summary + git snapshot artifacts in `runs/<id>/git/{head,branch,log,diff-stat}.txt` ([runner.ts:235](../src/runner.ts) rewrite).
- Verify **freshness**: compare `verified_sha` to current HEAD at `done`; warn/block on stale (commits since verify) unless `--allow-stale`.
- Task templates (`--template fix|spike|research`) + size hint; `agent-board lint-tasks` warns on L-sized tasks with no children.
- `status --oneline`; `project link --related` CLI for `related_projects`.
- Mode injection: `renderStepGuidance` ([workflow.ts:343](../src/workflow.ts)) emits `Mode: worker|orchestrator` + forbidden actions.

### Phase C — P2 platform (backlog)

MCP server, `HANDOFF.md` goal snapshot, `sprint:` field + filter, shell completion.

---

## 4. Answers to research questions (§8)

**Skills (primary integration):**

1. **One skill vs split?** **Split** — `agent-board` (orchestrator, default), `agent-board-worker`, `agent-board-research`. The session failed precisely because workers loaded the orchestrator skill that says "do not implement." Trigger precision beats monolith convenience. Maintenance stays low because shared depth lives in `references/` generated from `src/skills.ts` constants. Each `SKILL.md` < 200 lines.
2. **Cursor path: global vs project vs both?** **Both, global primary.** ✅ **Verified** against [cursor.com/docs/skills](https://cursor.com/docs/skills): Cursor auto-discovers skills from `~/.cursor/skills/` **and `~/.agents/skills/`** (global) plus `.cursor/skills/` and `.agents/skills/` (project, recursive). The brief's `~/.cursor/skills-cursor` is **wrong**. Crucially, agent-board *already* links `~/.agents/skills/agent-board` ([workspace.ts:190](../src/workspace.ts)) — so Cursor global discovery likely already works today; the session failure was more about content (orchestrator-only, no worker split) than path. PR3 adds an explicit `~/.cursor/skills/agent-board` symlink (belt-and-suspenders) and `init --cursor-skills` for project `.cursor/skills/`. There is **no separate `triggers` frontmatter field** — Cursor (like Claude Code) uses `description` for relevance, so trigger keywords go *in* the description.
3. **Require a skill id on `run`?** **Validate + warn by default; hard-fail only opt-in** (`--strict-skills` or workflow `require_skills: true`). Warning when a step references an unknown/uninstalled skill nudges correctness without breaking existing workflows.
4. **Export → Cursor/Claude mapping?** A single self-contained markdown block (§2 PR2): Mode, Task (+branch), mandatory sequence, AC, Verify, linked specs, project/goal knowledge, `repo:AGENTS.md`, git rules. For Cursor it is the Task-tool prompt body; for Claude Code it pipes as the `-p` initial prompt. Must require no external file reads to start.
5. **Skill length vs references?** **Short `SKILL.md` (<200 lines) + `references/` for depth.** Triggers and the mandatory worker sequence must be *in* `SKILL.md` (agents act on what is loaded); rationale and recipes go in references.

**CLI / enforcement (second):**

6. **Verify on every `done` or only when defined?** **Only when a `## Verify` block is non-empty.** Never invent commands. No block → AC-only gate as today. Zero-config backward compat.
7. **Git strictness — block dirty tree on claim, or warn?** **Block detached HEAD (hard, `--allow-detached`); warn on dirty tree.** Detached is the proven failure; dirty is normal WIP and claiming writes nothing.
8. **Force for orchestrator only?** **Allow for anyone, require `--reason`, log to `## Evidence`.** The CLI has no role identity yet, so "orchestrator-only" cannot be enforced honestly until mode/role injection lands (Phase B/C). Capture the audit trail now; restrict by role later.
9. **Evidence: markdown vs `evidence.json`?** **Markdown in task body** (§2.5). One source of truth; heavy logs stay in `runs/<id>/`.
10. **Monorepo: is `repo_path` root enough for turborepo?** **Yes** — turbo/nx run from root with `--filter`. The comma-in-filter parser bug is exactly why commands live in the body block, not frontmatter (§2.1). Per-command `cwd` is a Phase B nicety, not needed for turborepo. Note: switch verify's working dir from `cwd` to `repoPath` (§1 finding 3).
11. **Backward compat / migration?** **No migration needed** (§2.6). Additive scalar fields default empty; gates inert unless configured; lazy-write on save.

---

## 5. First PR scope — execution contract core

**Branch:** `feat/execution-contract-core`
**Goal:** git-aware `claim` + verify-gated `done` + evidence, fully backward compatible, no skills churn.

### 5.1 New file `src/git.ts`

```ts
import { resolve } from "node:path";

export interface GitState {
  isRepo: boolean;
  branch: string | null;  // null ⇒ detached
  detached: boolean;
  head: string | null;
  dirty: boolean;
}

async function git(repoPath: string, args: string[]): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn(["git", "-C", resolve(repoPath), ...args], {
    stdout: "pipe", stderr: "pipe",
  });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { code, out: out.trim() };
}

export async function gitState(repoPath: string): Promise<GitState> {
  const inside = await git(repoPath, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.code !== 0 || inside.out !== "true") {
    return { isRepo: false, branch: null, detached: false, head: null, dirty: false };
  }
  const sym = await git(repoPath, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const head = await git(repoPath, ["rev-parse", "HEAD"]);
  const status = await git(repoPath, ["status", "--porcelain"]);
  const detached = sym.code !== 0;
  return {
    isRepo: true,
    branch: detached ? null : sym.out,
    detached,
    head: head.code === 0 ? head.out : null,
    dirty: status.out.length > 0,
  };
}
```

### 5.2 New file `src/verify.ts`

```ts
import { resolve } from "node:path";

export interface VerifyResult { cmd: string; exitCode: number; output: string; }

// Extract commands from the first fenced block under "## Verify".
export function parseVerifyCommands(body: string): string[] {
  const section = /## Verify\b([\s\S]*?)(?:\n## |\n?$)/.exec(body)?.[1] ?? "";
  const fence = /```[a-z]*\n([\s\S]*?)```/.exec(section)?.[1] ?? "";
  return fence.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
}

export async function runVerify(repoPath: string, cmds: string[]): Promise<VerifyResult[]> {
  const results: VerifyResult[] = [];
  for (const cmd of cmds) {
    const proc = Bun.spawn(["sh", "-c", cmd], {
      cwd: resolve(repoPath), stdout: "pipe", stderr: "pipe", env: process.env,
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
    ]);
    results.push({ cmd, exitCode: code, output: (stdout + stderr).slice(-4000) });
  }
  return results;
}
```

### 5.3 `src/types.ts` — `TaskMeta` extensions

```ts
export interface TaskMeta {
  // …existing fields…
  branch: string;        // target branch for worker commits ("" = unset)
  verified: string;      // ISO timestamp of last all-pass verify ("" = never)
  verified_sha: string;  // HEAD sha at last verify ("" = unknown)
}
```

### 5.4 `src/tasks.ts` — defaults, order, template, guards, gate

- `normalizeTaskMeta`: add `branch`, `verified`, `verified_sha` with `typeof raw.x === "string" ? raw.x : ""` defaults.
- `TASK_ORDER`: insert `"branch"` after `"workflow"`; `"verified"`, `"verified_sha"` after `"updated"`.
- `createTask` body template: append a dormant verify placeholder (no fence ⇒ zero commands):

  ```
  ## Verify

  <!-- Add one shell command per line inside a ```sh block. Runner executes these before done. -->
  ```
- New `claimTask(workspace, id, opts: { agent: string; allowDetached?: boolean })`:
  - reject if status ∉ {`todo`, `ready`} (idempotent re-claim by same agent from `in_progress` allowed);
  - reject if any `depends_on` is not `done` (resolve cross-project refs via `resolveTaskRef`), listing unmet deps;
  - if `gitState(repoPath).detached && !allowDetached` → reject with `--allow-detached` hint;
  - warn (don't block) on dirty tree and on `branch`-mismatch;
  - then `setTaskStatus(in_progress, { assignee })` (no `force`). *(Assignee-conflict guard is PR2.)*
- `setTaskStatus` done-gate: after the AC check, if `parseVerifyCommands(body).length && !meta.verified && !force` → throw "run `agent-board verify <id>` first or `done --force --reason`". Thread a `reason` option; when `force` skips a verify gate, require `reason` and `appendSection(body, "Evidence", "- [forced] done … : <reason>")`.

### 5.5 `src/index.ts` — wire commands

- `claim` → call `claimTask`; add `--allow-detached`.
- New `verify <task-id>`: load task, `parseVerifyCommands`, `runVerify(repoPath)`, append pass/fail to `## Evidence`, stamp `verified`/`verified_sha` on all-pass, exit non-zero on any failure.
- `done` → add `--reason <text>`; pass `force`+`reason` into `setTaskStatus`.

### 5.6 Tests — `test/cli.test.ts` + `test/unit.test.ts`

Reuse the existing `run(cwd, env, args)` + `AGENT_BOARD_HOME` harness. Add a git fixture:

```ts
async function initGitRepo(dir: string) {
  const g = (args: string[]) => Bun.spawn(["git", "-C", dir, ...args]).exited;
  await g(["init"]); await g(["config", "user.email", "t@t.t"]); await g(["config", "user.name", "t"]);
  await writeFile(join(dir, "f.txt"), "a"); await g(["add", "."]); await g(["commit", "-m", "one"]);
  await writeFile(join(dir, "g.txt"), "b"); await g(["add", "."]); await g(["commit", "-m", "two"]);
}
```

| # | Test | Asserts |
|---|---|---|
| 1 | claim on detached HEAD blocked | `run(...["claim", id])` throws; mentions `--allow-detached` |
| 2 | claim with `--allow-detached` on detached | succeeds; status `in_progress` |
| 3 | claim blocked by unfinished dep | dep not done → reject lists the dep |
| 4 | verify pass → stamps + evidence | `verified` set in frontmatter; `## Evidence` contains pass line |
| 5 | verify fail blocks done | failing cmd → `done` rejects; `done --force --reason "x"` closes + logs reason |
| 6 | **backward compat** | task with no `## Verify` block closes via `done` exactly as today |
| 7 (unit) | `gitState` detached detection | `branch === null && detached` in a detached fixture |
| 8 (unit) | `parseVerifyCommands` | extracts fenced commands incl. one with a comma `--filter=a,b` intact |

Test #8 is the regression guard for the §2.1 finding — it proves commands with commas survive because they live in the body, not an inline frontmatter list.

### 5.7 Out of scope for PR1 (explicit)

`export.ts`, `next --context`, assignee-conflict guard → **PR2**. Skills split, Cursor install, `skills doctor`, workflow YAML `[agent-board-worker]` → **PR3**. Run-summary/git-snapshot rewrite → Phase B. Keeping these out preserves the layout snapshot tests and keeps PR1 reviewable.

---

## 5b. Concurrency model (multi-agent, shipped v0.2.1)

agent-board is file-based, so concurrent agents are safe only where state is partitioned. Validated against both real usage patterns: (a) 4 agents across 4 separate repos, (b) 2 agents in one repo on different goals.

### Partitioned vs shared state

| State | Path | Partition key | Concurrency |
|---|---|---|---|
| Tasks, runs | `goals/<goal>/{tasks,runs}` | goal | safe across goals |
| Specs, knowledge, workflows | overlay scope | scope | safe at goal/project; global is shared |
| `project.json` `active_goal` | `projects/<slug>` | project | **shared mutable** — don't `goal use` concurrently |
| `registry.json` | root | global | **shared** — init one project at a time |
| Git working tree | `repo_path` | project (one tree!) | **shared** unless per-agent worktree |

### Guarantees added in v0.2.1

1. **Atomic writes** — every board write is temp-file + `rename`, so a concurrent reader (`plan --related` across projects) never sees a torn/partial file. ([utils.ts](../src/utils.ts) `atomicWrite`)
2. **Atomic claim** — `claim` takes an `O_EXCL` lock on `<task>.md.lock`; two agents racing the same task → exactly one claims, the other is told to retry. Stale locks (>30s) are reclaimed. ([tasks.ts](../src/tasks.ts) `withTaskLock`)
3. **Unique run ids** — `runId` carries a random suffix, so parallel runs of the same task+workflow can't collide on the run folder. ([runner.ts](../src/runner.ts))
4. **Per-agent repo via `AGENT_BOARD_REPO`** — git guards and verify run in this path instead of `project.repo_path`, so each agent can point at its own git worktree. ([workspace.ts](../src/workspace.ts) `resolveWorkspace`)

### Recommended setup per scenario

**4 agents / 4 repos:** nothing special — separate projects are isolated. Just don't run two `init`s simultaneously.

**2 agents / 1 repo / 2 goals** — give each a worktree and pin via env, never `goal use`:

```sh
# agent A
git worktree add ../repo-goalA -b feat/goalA
AGENT_BOARD_PROJECT=myproj AGENT_BOARD_GOAL=goalA AGENT_BOARD_REPO="$PWD/../repo-goalA" agent ...
# agent B
git worktree add ../repo-goalB -b feat/goalB
AGENT_BOARD_PROJECT=myproj AGENT_BOARD_GOAL=goalB AGENT_BOARD_REPO="$PWD/../repo-goalB" agent ...
```

Board state is goal-isolated; the worktrees keep checkouts/branches isolated.

### Known residual limits

- `updateTask`/`setTaskStatus` are still last-write-wins on the same task file (only `claim` is locked); two agents editing the *same* task can lose updates. Mitigation: orchestrator assigns distinct tasks.
- `registry.json` init is atomic-write but still read-modify-write — a lost update is possible if two `init`s race the same instant. Mitigation: sequential init.
- No per-goal `repo_path` in config yet; worktree routing is env-only. A future `agent-board worktree <goal>` helper could automate worktree + branch + env.

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Enforcement ships but workers never load skills → gates inert for delegated work | PR3 must not slip; workflow implement step → `agent-board-worker`; `export` block names the skill (PR2) |
| Cursor skills path | ✅ Resolved — verified `~/.cursor/skills/` + `~/.agents/skills/` (Q2); `~/.agents/skills/agent-board` already linked, so Cursor coverage exists today |
| `## Verify` placeholder accidentally gates fresh tasks | Template ships heading + comment, **no code fence** ⇒ `parseVerifyCommands` returns `[]`; covered by test #6 |
| Verify executes arbitrary shell | By design (npm/bun-script trust model); documented; run from `repoPath` only |
| Switching verify cwd to `repoPath` differs from runner's `cwd` | Document; they are equal in the common case; `repoPath` is the deterministic choice |

---

## 7. Success criteria (re-run the 28-task session)

| Metric | Session actual | Target | Enforced by |
|---|---|---|---|
| Detached-HEAD commits | 7 | 0 | git guard on `claim` (PR1) |
| `done --force` without reason | many | 0 | `--reason` required + logged (PR1) |
| Tasks closed without verify log | most | 0 when verify defined | done gate (PR1) |
| Manual `.private/*-prompt.md` | yes | optional | `export` (PR2) |
| Subagent loads correct skill | no | yes | skills split + Cursor install (PR3) |

---

## 8. Optional: GitHub issues to file

Ready for `gh issue create`. Labels suggested in brackets.

1. **[P0] git.ts: detect detached HEAD / dirty / branch** — read-only `gitState(repoPath)`; plumbing in §5.1. *(PR1)* `[execution-contract]`
2. **[P0] verify.ts: `## Verify` body block + `agent-board verify`** — parse fenced commands, run from `repoPath`, append evidence, stamp `verified`. *(PR1)* `[execution-contract]`
3. **[P0] TaskMeta: add `branch`, `verified`, `verified_sha`** — defaults + `TASK_ORDER` + template placeholder; backward compatible. *(PR1)* `[execution-contract]`
4. **[P0] done gate: require verify pass when `## Verify` defined; `--force --reason`** — layered on AC check; logs reason to evidence. *(PR1)* `[execution-contract]`
5. **[P0] claim guards: detached block + deps-done** — `claimTask` with `--allow-detached`. *(PR1, assignee-conflict in PR2)* `[execution-contract]`
6. **[P0] export.ts: `agent-board export <task> --format worker` + `next --context`** — self-contained worker prompt reusing `renderContext`. *(PR2)* `[skills][export]`
7. **[P0] Skills split: orchestrator / worker / research + triggers** — three skills from `src/skills.ts`; update layout snapshot tests. *(PR3)* `[skills]`
8. **[P0] Cursor skills install + `skills doctor`** — add `~/.cursor/skills/agent-board` symlink (verified path); `init --cursor-skills` for project `.cursor/skills/`; doctor lists which runtimes have the skill linked (`~/.claude`, `~/.agents`, `~/.cursor`). *(PR3)* `[skills][cursor]`
9. **[P0] Workflows reference `agent-board-worker` on implement steps** — `dev` implement step prompt → "Follow agent-board-worker." *(PR3)* `[skills][workflows]`
10. **[P1] Rich run summary + git snapshot artifacts** — `runs/<id>/git/*`; outcome/changed-files/follow-ups sections. *(Phase B)* `[runner]`
11. **[P1] Verify freshness: compare `verified_sha` to HEAD at done** — warn/block on stale; `--allow-stale`. *(Phase B)* `[execution-contract]`
12. **[P1] Task templates + `lint-tasks` size warning; `status --oneline`; `project link`** *(Phase B)* `[orchestration]`
13. **[P2] MCP server, HANDOFF.md sync, sprint field, completion** *(Phase C)* `[platform]`

---

*Validated against agent-board v0.1.0 @ `main` (11 tests pass, typecheck clean). Frontmatter and git findings reproduced empirically on 2026-05-28.*
