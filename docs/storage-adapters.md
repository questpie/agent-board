# Storage Drivers

`agent-board` should stay simple: agents talk to explicit `agent-board`
subcommands, and those subcommands talk to one configured store driver.

The driver can persist state in local Markdown, Linear, S3/R2 through a
file/blob API, a database, or a custom HTTP API. Controller and worker agents
should not care. They keep using the same CLI contract.

## Core Principle

The CLI is the write boundary.

```txt
agent/controller/worker
  -> agent-board subcommand
    -> StoreDriver
      -> filesystem | Linear API | files-sdk/R2/S3 | database | custom API
```

There is no separate first-class sync system in the base design. If a backend
mirrors somewhere else, that is an implementation detail of the driver.

## What This Means

- Agents should create, read, update, claim, verify, and close board state
  through `agent-board` subcommands.
- Filesystem paths printed by the current local driver are conveniences, not the
  long-term contract.
- A non-filesystem driver must not require agents to open a vendor UI or write
  raw provider records.
- Store adapters should preserve the same task/spec/knowledge/flow semantics.
- The default driver remains `filesystem` under `~/.agent-board`.

The more operations we expose as precise subcommands, the easier it is to store
the board anywhere.

## StoreDriver Shape

The driver should be one primitive interface, not many subsystems:

```ts
interface StoreDriver {
	getProject(ref: ProjectRef): Promise<ProjectRecord>;
	listGoals(project: ProjectRef): Promise<GoalRecord[]>;
	getGoal(ref: GoalRef): Promise<GoalRecord>;
	putGoal(input: PutGoalInput): Promise<GoalRecord>;

	listTasks(scope: GoalRef, filter?: TaskFilter): Promise<TaskRecord[]>;
	getTask(ref: TaskRef): Promise<TaskRecord>;
	putTask(input: PutTaskInput, options?: WriteOptions): Promise<TaskRecord>;
	claimTask(ref: TaskRef, input: ClaimInput): Promise<TaskRecord>;
	appendTaskEvidence(ref: TaskRef, input: EvidenceInput): Promise<TaskRecord>;

	listSpecs(scope: OverlayRef): Promise<DocumentRecord[]>;
	getSpec(ref: DocumentRef): Promise<DocumentRecord>;
	putSpec(input: PutDocumentInput, options?: WriteOptions): Promise<DocumentRecord>;

	listKnowledge(scope: OverlayRef): Promise<DocumentRecord[]>;
	getKnowledge(ref: DocumentRef): Promise<DocumentRecord>;
	putKnowledge(input: PutDocumentInput, options?: WriteOptions): Promise<DocumentRecord>;

	listFlows(scope: ProjectRef): Promise<FlowRecord[]>;
	getFlow(ref: FlowRef): Promise<FlowRecord>;
	putFlow(input: PutFlowInput, options?: WriteOptions): Promise<FlowRecord>;

	createFlowRun(input: CreateFlowRunInput): Promise<FlowRunRecord>;
	appendFlowRunOutput(ref: FlowRunRef, input: FlowRunOutput): Promise<void>;
	getFlowRun(ref: FlowRunRef): Promise<FlowRunRecord>;
}
```

`WriteOptions` carries the concurrency primitive:

```ts
interface WriteOptions {
	ifVersion?: string;
	idempotencyKey?: string;
}
```

Every driver needs one of these strategies:

- real compare-and-set writes with `version` or `etag`
- real locks for claim operations
- a single writer API that serializes mutations

If a provider cannot support that, it can still be useful for single-agent local
work or flow artifacts, but it should not be advertised as safe for concurrent
task claims.

## Command Boundary Audit

These commands already express durable board transitions well:

| State | Existing commands |
| --- | --- |
| projects/goals | `init`, `projects`, `goals`, `goal new`, `goal use` |
| task lifecycle | `new`, `tasks`, `status`, `show`, `claim`, `block`, `ready`, `unblock`, `review`, `verify`, `done` |
| task graph | `link --blocks`, `link --spec`, `plan`, `next` |
| specs/knowledge create/read | `spec new`, `spec list`, `spec show`, `knowledge add`, `knowledge list` |
| flows run/read/write | `flow new`, `flow list`, `flow cat`, `flow write`, `flow run`, `flow show` |

The store-driver refactor starts by making body/script operations explicit:

| Resource | Command boundary |
| --- | --- |
| task body | `agent-board task cat <id>`, `agent-board task write <id> --from <file|->` |
| spec body | `agent-board spec cat <id>`, `agent-board spec write <id> --from <file|->` |
| knowledge body | `agent-board knowledge cat <id>`, `agent-board knowledge write <id> --from <file|->` |
| flow script | `agent-board flow cat <name>`, `agent-board flow write <name> --from <file|->` |

For the filesystem driver these commands can still read/write Markdown files.
For Linear/API/R2/DB they become the portable mutation API.

## Driver Examples

| Driver | Storage model |
| --- | --- |
| `filesystem` | Current Markdown layout under `~/.agent-board`. Zero config. |
| `linear` | Tasks as Linear issues, evidence as comments, specs/knowledge/flows as issue descriptions, docs, or comments controlled by the driver. |
| `files` | Markdown and flow outputs as objects through a file/blob SDK over local/S3/R2/GCS/Azure. Requires conditional writes for concurrent use. |
| `database` | Tables/documents for tasks/specs/knowledge/flows with real transactions and locks. |
| `api` | Hosted agent-board API that implements the same driver operations. |

The CLI should not grow separate commands like `sync linear` as a required user
workflow. If we want Linear-backed storage, configure `store.driver = "linear"`
and keep using `agent-board new`, `agent-board claim`, `agent-board done`, and
`agent-board flow run`.

## Linear Driver

Linear can be a real driver if the adapter owns the mapping:

| agent-board | Linear-backed implementation |
| --- | --- |
| goal | project, cycle, label, or parent issue chosen by driver config |
| task | issue |
| status | workflow state |
| assignee | Linear assignee or bot-owned metadata |
| priority | issue priority |
| specs/knowledge | issue description, project document, or bot-managed comment |
| evidence | bot-managed comments with stable markers |
| flow run | bot-managed comment or attachment link |

The driver must store stable ids in metadata so renames are not destructive:

```txt
agent-board.project=agent-board
agent-board.goal=flow-mvp
agent-board.task=implement-flow-run
agent-board.version=<provider-version>
```

If Linear cannot provide safe claim locking directly, the driver should either
use a single-writer API path or clearly report that concurrent claims are not
safe for that configuration.

## Files SDK / S3 / R2 Driver

[`files-sdk`](https://files-sdk.dev/) is interesting as the implementation
layer for a `files` driver because it can give one API over local files, S3, R2,
GCS, Azure, and similar stores.

Suggested object layout:

```txt
registry.json
projects/<project>/project.json
projects/<project>/goals/<goal>/goal.md
projects/<project>/goals/<goal>/tasks/<task>.md
projects/<project>/specs/<spec>.md
projects/<project>/knowledge/<note>.md
projects/<project>/flows/<flow>.mjs
projects/<project>/goals/<goal>/flows/runs/<run>/summary.md
projects/<project>/goals/<goal>/flows/runs/<run>/agents/<agent>.md
```

This keeps Markdown portable while letting the driver swap storage providers.
The hard requirement is conditional write support. Without ETag/version-style
updates, the driver can lose concurrent edits or allow double claims.

## Configuration Sketch

Keep configuration to one store block:

```toml
[store]
driver = "filesystem"
root = "~/.agent-board"
```

Other examples:

```toml
[store]
driver = "linear"
team = "ENG"
project = "Agent Board"

[store]
driver = "files"
provider = "r2"
bucket = "agent-board"
prefix = "questpie"

[store]
driver = "api"
url = "https://agent-board.internal"
```

`agent-board status` should print the active driver once non-filesystem drivers
exist.

## Implementation Path

1. Treat existing subcommands as the public contract.
2. Add the missing write/read subcommands for task/spec/knowledge/flow bodies.
3. Extract the current filesystem code into `FileStoreDriver` with no behavior
   change.
4. Route CLI commands through `StoreDriver`.
5. Add one non-filesystem driver only after the interface is proven by the
   filesystem driver. The likely first choices are `files` for R2/S3-style object
   storage or `linear` for Autopilot/team task visibility.

This keeps the design primitive: one CLI, one driver, one set of semantics.
