# Storage Adapters

`agent-board` is local-first today: the canonical board lives in Markdown under
`~/.agent-board`. Keep that as the default. External systems should plug into the
same board contract instead of changing how controller agents reason about
goals, tasks, specs, knowledge, and flow runs.

This matters for Autopilot and team setups where the same board may need to
sync to Linear, object storage, a database, or a custom product API.

## Design Goals

- Humans keep using natural language; agents keep using the CLI contract.
- Local filesystem remains the zero-config backend.
- Markdown stays readable and portable, even when another store is primary.
- Claims, done gates, verify evidence, and flow artifacts preserve semantics
  across backends.
- External adapters are explicit. A broken Linear/S3/API sync must not corrupt
  the local board.

## Split The Problem

There are three separate storage concerns:

1. **BoardStore**: structured agent-board state.
   Projects, goals, tasks, specs, knowledge, links, claims, evidence, and status
   transitions live here.
2. **ArtifactStore**: large or append-only files.
   Flow summaries, per-agent outputs, diagnostics, logs, screenshots, patches,
   and other blobs live here.
3. **Sync/EventStore**: integration events.
   Records what changed so adapters can mirror state into Linear, S3, a DB, or
   a custom API idempotently.

Do not make object storage pretend to be a full task database unless it can
support the claim and conflict semantics below.

## BoardStore Contract

The first refactor should extract the current filesystem behavior behind a
small internal port without changing CLI behavior:

```ts
interface BoardStore {
	getProject(slug: string): Promise<ProjectRecord>;
	listGoals(project: string): Promise<GoalRecord[]>;
	getGoal(project: string, goal: string): Promise<GoalRecord>;

	listTasks(scope: TaskScope, filter?: TaskFilter): Promise<TaskRecord[]>;
	getTask(ref: TaskRef): Promise<TaskRecord>;
	createTask(input: CreateTaskInput): Promise<TaskRecord>;
	updateTask(ref: TaskRef, patch: TaskPatch, precondition?: WritePrecondition): Promise<TaskRecord>;

	claimTask(ref: TaskRef, claim: ClaimInput): Promise<TaskRecord>;
	appendEvidence(ref: TaskRef, entry: EvidenceEntry, precondition?: WritePrecondition): Promise<TaskRecord>;

	listSpecs(scope: OverlayScope): Promise<DocumentRecord[]>;
	getSpec(ref: DocumentRef): Promise<DocumentRecord>;
	upsertSpec(doc: DocumentRecord, precondition?: WritePrecondition): Promise<DocumentRecord>;

	listKnowledge(scope: OverlayScope): Promise<DocumentRecord[]>;
	upsertKnowledge(doc: DocumentRecord, precondition?: WritePrecondition): Promise<DocumentRecord>;
}
```

`WritePrecondition` is the important part. A backend must either support a real
compare-and-set primitive or route writes through a single writer. Two agents
must not both claim the same task.

Minimum preconditions:

- `version` or `etag` for read-modify-write updates
- exclusive claim lock for `claimTask`
- idempotency key for sync-created tasks/comments
- append-safe evidence writes

## ArtifactStore Contract

Flow runs and large outputs can use a simpler file/blob API:

```ts
interface ArtifactStore {
	write(key: string, body: BodyInit, metadata?: Record<string, string>): Promise<ArtifactRecord>;
	read(key: string): Promise<ArtifactBody>;
	head(key: string): Promise<ArtifactRecord | undefined>;
	list(prefix: string): AsyncIterable<ArtifactRecord>;
	delete(key: string): Promise<void>;
}
```

This is where provider-neutral file libraries are useful. Artifacts need
streaming, prefixes, metadata, and provider portability; they usually do not
need task-claim semantics.

## Adapter Shapes

| Adapter | Good For | Caution |
| --- | --- | --- |
| Filesystem | default local use, dogfooding, zero setup | single machine unless synced externally |
| Linear | team-visible tasks, status, assignment, review trail | map only stable fields; comments are not a lock service |
| S3/R2/GCS | portable artifacts and Markdown snapshots | needs ETag/conditional writes or an external lock for primary board state |
| SQLite/Postgres | Autopilot workers, dashboard/API, real locks and queries | adds service/config overhead |
| Custom API | productized hosted board, auth, multi-tenant policy | must expose the same BoardStore invariants |
| files-sdk-style blob layer | portable artifacts across many providers | not enough alone for task graph queries and claims |

## Linear Mapping

Start with Linear as a mirror, not the source of truth:

| agent-board | Linear |
| --- | --- |
| goal | project, cycle, label, or parent initiative |
| task | issue |
| status | issue workflow state |
| assignee | Linear assignee or bot label |
| priority | issue priority |
| specs | issue description links or project docs |
| evidence | comments with stable machine prefix |
| flow run | comment linking summary/artifacts |

Each synced object should carry a stable backlink:

```txt
agent-board.project=agent-board
agent-board.goal=flow-mvp
agent-board.task=implement-flow-run
agent-board.sync_id=<uuid>
```

That lets sync be idempotent and lets humans edit Linear without the adapter
confusing a renamed issue for a new task.

## S3 And Files SDK

Object storage is a strong fit for `ArtifactStore` and for board snapshots:

```txt
projects/<project>/goals/<goal>/tasks/<task>.md
projects/<project>/goals/<goal>/flows/runs/<run>/summary.md
projects/<project>/events/<date>.jsonl
```

[`files-sdk`](https://files-sdk.dev/) is worth tracking for this layer because
it provides a common API for S3, R2, GCS, Azure, filesystem, and other blob
stores; exposes upload, download, head, list, delete, metadata/etag-shaped
records; and includes ready-made AI tools for Vercel AI SDK/OpenAI/Claude-style
agents.

Use it first for artifacts or snapshots. Before using it as the primary
`BoardStore`, verify that the chosen provider path gives us conditional writes
or a lock primitive. Without that, two agents can race through claim or evidence
updates.

## Autopilot Path

For Autopilot, prefer this sequence:

1. Extract `FileBoardStore` behind the `BoardStore` interface. No behavior
   change, no config change.
2. Add a local event journal:

   ```txt
   ~/.agent-board/projects/<project>/events/YYYY-MM-DD.jsonl
   ```

   Every task/spec/knowledge/flow mutation emits a compact event.
3. Add `agent-board sync linear` as a mirror adapter. It reads events, upserts
   Linear issues/comments, and records sync cursors.
4. Add `ArtifactStore` for flow outputs. Start with filesystem, then S3/R2 via a
   blob adapter.
5. Add `ApiBoardStore` or `DbBoardStore` only when we need multi-machine
   concurrent writers.

This gives Autopilot useful integration early while preserving the local board
that agents can already operate today.

## Configuration Sketch

Keep configuration boring and explicit:

```toml
[store]
type = "filesystem"
root = "~/.agent-board"

[[sync]]
type = "linear"
mode = "mirror"
team = "ENG"

[artifacts]
type = "filesystem"
root = "~/.agent-board/artifacts"
```

Future examples:

```toml
[artifacts]
type = "s3"
bucket = "agent-board-artifacts"
prefix = "org/acme"

[store]
type = "api"
url = "https://agent-board.internal/api"
```

The CLI should print which store is active in `agent-board status` once
non-filesystem stores exist.

## Rules For Adapters

- Never hide conflicts. Surface them to the controller agent with paths, ids,
  and suggested next commands.
- Treat sync as retryable and idempotent.
- Keep generated comments/metadata clearly machine-owned.
- Do not require Linear/S3/API for the basic install path.
- Do not let spawned worker agents choose or reconfigure stores.
- Keep flow summaries compact even when raw artifacts live in object storage.
