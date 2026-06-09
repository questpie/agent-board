import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import htm from "htm";
import { marked } from "marked";

const html = htm.bind(createElement);
marked.setOptions({ gfm: true, breaks: false });

const STATUS_ORDER = ["todo", "ready", "in_progress", "blocked", "review", "done"];

const cls = (...xs) => xs.filter(Boolean).join(" ");
const shortSha = (s) => (s ? String(s).slice(0, 7) : "");
const fmtDate = (s) =>
	s ? new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtTime = (s) => (s ? new Date(s).toLocaleTimeString(undefined, { hour12: false }) : "");

async function api(path, params) {
	const url = new URL(path, location.origin);
	for (const [k, v] of Object.entries(params || {})) if (v != null && v !== "") url.searchParams.set(k, v);
	const res = await fetch(url);
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data?.error || res.statusText);
	return data;
}

/* ---------- Icons ---------- */
const Svg = (path, extra) =>
	html`<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
		stroke-linecap="round" stroke-linejoin="round">${path}${extra || null}</svg>`;
const Icon = {
	overview: () => Svg(html`<rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />`),
	goals: () => Svg(html`<circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.4" fill="currentColor" />`),
	tasks: () => Svg(html`<path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />`),
	specs: () => Svg(html`<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h6" />`),
	knowledge: () => Svg(html`<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />`),
	flows: () => Svg(html`<circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="12" r="2.5" /><path d="M8.5 6H14a3 3 0 0 1 3 3M8.5 18H14a3 3 0 0 0 3-3" />`),
	refresh: () => Svg(html`<path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />`),
	folder: () => Svg(html`<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z" />`),
};

/* ---------- Brand mark (QUESTPIE symbol) ---------- */
function Mark({ size = 26 }) {
	return html`<svg class="brand-mark" width=${size} height=${size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
		<path d="M22 10V2H2V22H10" stroke="currentColor" stroke-width="2" stroke-linecap="square" />
		<path d="M23 13H13V23H23V13Z" fill="var(--primary)" />
	</svg>`;
}

/* ---------- Canonical issue-status icons (DESIGN.md §8) ---------- */
const STATUS_GLYPH = {
	todo: html`<circle cx="12" cy="12" r="8" />`,
	ready: html`<circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />`,
	in_progress: html`<circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none" />`,
	blocked: html`<circle cx="12" cy="12" r="8" /><path d="M8.4 12h7.2" />`,
	review: html`<circle cx="12" cy="12" r="8" /><path d="M8.5 12.3l2.4 2.4 4.6-5.1" />`,
	done: html`<circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" /><path d="M8 12.4l2.7 2.7 5.3-6" stroke="var(--background)" stroke-width="2.2" />`,
};
function StatusIcon({ status, size = 14 }) {
	return html`<svg class="sticon" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
		stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style=${{ color: `var(--st-${status})` }} aria-hidden="true">
		${STATUS_GLYPH[status] || STATUS_GLYPH.todo}
	</svg>`;
}

/* ---------- Small components ---------- */
function StatusBadge({ status }) {
	return html`<span class="badge status" style=${{ "--st": `var(--st-${status})` }}>
		<${StatusIcon} status=${status} size=${12} />${String(status).replace("_", " ")}</span>`;
}
function PriorityBadge({ priority }) {
	if (!priority || priority === "normal") return null;
	return html`<span class=${cls("badge", `prio-${priority}`)}>${priority}</span>`;
}
function Markdown({ source }) {
	const htmlStr = useMemo(() => marked.parse(source || ""), [source]);
	return html`<div class="markdown" dangerouslySetInnerHTML=${{ __html: htmlStr }} />`;
}
function Chips({ label, items, onPick }) {
	if (!items || !items.length) return null;
	return html`<div>
		<div class="section-label">${label}</div>
		<div class="chips">
			${items.map(
				(it) => html`<span key=${it} class=${cls("chip", !onPick && "static")}
					onClick=${onPick ? () => onPick(it) : null}>${it}</span>`,
			)}
		</div>
	</div>`;
}

/* ---------- Sidebar ---------- */
function Sidebar({ board, tab, setTab, sel, setSel, onRefresh, spinning }) {
	const counts = {
		tasks: board.tasks.length,
		specs: board.specs.length,
		knowledge: board.knowledge.length,
		flows: board.runs.length + board.flows.length,
	};
	const project = sel.project ?? board.current.project;
	const goal = sel.goal ?? board.current.goal;
	const nav = [
		["overview", "Overview", null],
		["goals", "Goals", board.goals.length],
		["tasks", "Tasks", counts.tasks],
		["specs", "Specs", counts.specs],
		["knowledge", "Knowledge", counts.knowledge],
		["flows", "Flows", counts.flows],
	];
	return html`<aside class="sidebar">
		<div class="brand">
			<${Mark} size=${26} />
			<div class="brand-name">agent-board<small>read-only viewer</small></div>
		</div>

		<div class="picker">
			<label>Project</label>
			<select class="control" value=${project}
				onChange=${(e) => setSel({ project: e.target.value, goal: undefined })}>
				${board.projects.map((p) => html`<option key=${p.slug} value=${p.slug}>${p.slug}</option>`)}
			</select>
			<label>Goal</label>
			<select class="control" value=${goal}
				onChange=${(e) => setSel((s) => ({ ...s, goal: e.target.value }))}>
				${board.goals.map(
					(g) => html`<option key=${g.id} value=${g.id}>${g.title}${g.active ? " (active)" : ""}</option>`,
				)}
			</select>
		</div>

		<nav class="nav">
			${nav.map(
				([id, label, count]) => html`<div key=${id} class=${cls("nav-item", tab === id && "active")}
					onClick=${() => setTab(id)}>
					${Icon[id]()}
					<span class="label">${label}</span>
					${count != null ? html`<span class="count">${count}</span>` : null}
				</div>`,
			)}
		</nav>

		<div class="sidebar-foot">
			<button class="refresh" data-spin=${String(spinning)} onClick=${onRefresh}>
				${Icon.refresh()}<span>Refresh</span>
			</button>
			<div class="repo-path">${board.current.repo}</div>
		</div>
	</aside>`;
}

/* ---------- Overview ---------- */
function Overview({ board, go }) {
	const counts = {};
	for (const s of STATUS_ORDER) counts[s] = 0;
	for (const t of board.tasks) counts[t.meta.status] = (counts[t.meta.status] ?? 0) + 1;
	const next =
		board.tasks.find((t) => t.meta.status === "ready") ||
		board.tasks.find((t) => t.meta.status === "todo");
	const inProgress = board.tasks.filter((t) => t.meta.status === "in_progress");
	const blocked = board.tasks.filter((t) => t.meta.status === "blocked");
	const runs = board.runs.slice(0, 6);

	const TaskRowMini = (t) => html`<div key=${t.meta.id} class="card-row" onClick=${() => go("tasks", t.meta.id)}>
		<${StatusBadge} status=${t.meta.status} />
		<span class="t">${t.meta.title}</span>
		<span class="i">${t.meta.assignee || ""}</span>
	</div>`;

	return html`<div class="overview">
		<div class="stat-grid">
			${STATUS_ORDER.map(
				(s) => html`<div key=${s} class="stat">
					<div class="n">${counts[s]}</div>
					<div class="l"><${StatusIcon} status=${s} size=${13} />${s.replace("_", " ")}</div>
				</div>`,
			)}
		</div>

		${next
			? html`<div>
					<div class="section-label">Next up</div>
					<div class="next-task" onClick=${() => go("tasks", next.meta.id)}>
						<div class="run-head">
							<${StatusBadge} status=${next.meta.status} />
							<${PriorityBadge} priority=${next.meta.priority} />
						</div>
						<div class="nt-title">${next.meta.title}</div>
						<div class="detail-id">${next.meta.id}</div>
					</div>
				</div>`
			: null}

		<div class="cards">
			<div class="card">
				<h3>In progress · ${inProgress.length}</h3>
				${inProgress.length ? inProgress.map(TaskRowMini) : html`<div class="muted">Nothing in progress.</div>`}
				${blocked.length
					? html`<h3 style=${{ marginTop: "6px" }}>Blocked · ${blocked.length}</h3>${blocked.map(TaskRowMini)}`
					: null}
			</div>
			<div class="card">
				<h3>Recent flow runs · ${board.runs.length}</h3>
				${runs.length
					? runs.map(
							(r) => html`<div key=${r.id} class="card-row" onClick=${() => go("flows", r.id)}>
								<span class="t">${r.id}</span>
								${r.active
									? html`<span class="live"><span class="pulse" />live</span>`
									: html`<span class="muted">${r.agents} agents</span>`}
							</div>`,
						)
					: html`<div class="muted">No flow runs yet.</div>`}
			</div>
		</div>
	</div>`;
}

/* ---------- Goals ---------- */
function GoalsTab({ current, active, onOpen }) {
	const [data, setData] = useState(null);
	const [error, setError] = useState(null);
	useEffect(() => {
		setData(null);
		setError(null);
		api("/api/goals", { project: current.project })
			.then(setData)
			.catch((e) => setError(e.message));
	}, [current.project]);
	if (error) return html`<div class="error-banner">${error}</div>`;
	if (!data) return html`<div class="placeholder">Loading goals…</div>`;
	return html`<div class="overview">
		<div class="goals-grid">
			${data.goals.map((g) => html`<${GoalCard} key=${g.id} g=${g} active=${g.id === active} onOpen=${onOpen} />`)}
		</div>
	</div>`;
}

function GoalCard({ g, active, onOpen }) {
	const pct = g.total ? Math.round((g.counts.done / g.total) * 100) : 0;
	const segs = STATUS_ORDER.filter((s) => g.counts[s] > 0);
	const remaining = segs.filter((s) => s !== "done");
	return html`<div class=${cls("goal-card", active && "active")} onClick=${() => onOpen(g.id)}>
		<div class="goal-top">
			<div class="goal-title">${g.title}</div>
			${active ? html`<span class="badge">active</span>` : null}
		</div>
		<div class="detail-id">${g.id}</div>
		${g.total
			? html`<div class="progress">
						${segs.map((s) => html`<span key=${s} style=${{ width: `${(g.counts[s] / g.total) * 100}%`, background: `var(--st-${s})` }} title=${`${s.replace("_", " ")}: ${g.counts[s]}`} />`)}
					</div>
					<div class="goal-stats">
						<span class="goal-pct">${pct}%</span>
						<span class="muted">${g.counts.done}/${g.total} done</span>
						<span class="spacer" />
						${remaining.map(
							(s) => html`<span key=${s} class="gchip" title=${s.replace("_", " ")}>
								<span class="dot" style=${{ background: `var(--st-${s})` }} />${g.counts[s]}</span>`,
						)}
					</div>`
			: html`<div class="muted" style=${{ padding: "4px 0" }}>No tasks yet.</div>`}
		<div class="goal-foot">
			<span class="muted">${g.total} task${g.total === 1 ? "" : "s"}</span>
			<span class="muted">·</span>
			<span class="muted">${g.runs} flow run${g.runs === 1 ? "" : "s"}</span>
		</div>
	</div>`;
}

/* ---------- Tasks ---------- */
function TasksTab({ board, selId, setSelId, go }) {
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState(null);
	const counts = {};
	for (const t of board.tasks) counts[t.meta.status] = (counts[t.meta.status] ?? 0) + 1;
	const tasks = board.tasks.filter((t) => {
		if (filter && t.meta.status !== filter) return false;
		if (query) {
			const q = query.toLowerCase();
			return t.meta.title.toLowerCase().includes(q) || t.meta.id.toLowerCase().includes(q);
		}
		return true;
	});
	const selected = board.tasks.find((t) => t.meta.id === selId);

	return html`<div class="split">
		<div class="list-pane">
			<div class="list-tools">
				<input class="search" placeholder="Search tasks…" value=${query}
					onInput=${(e) => setQuery(e.target.value)} />
				<div class="filters">
					<button class=${cls("filter", !filter && "on")} onClick=${() => setFilter(null)}>All ${board.tasks.length}</button>
					${STATUS_ORDER.filter((s) => counts[s]).map(
						(s) => html`<button key=${s} class=${cls("filter", filter === s && "on")} onClick=${() => setFilter(s)}>
							<${StatusIcon} status=${s} size=${13} />${s.replace("_", " ")} ${counts[s]}</button>`,
					)}
				</div>
			</div>
			<div class="rows">
				${tasks.map(
					(t) => html`<div key=${t.meta.id} class=${cls("row", t.meta.id === selId && "sel")}
						onClick=${() => setSelId(t.meta.id)}>
						<div class="row-top">
							<span class="row-title">${t.meta.title}</span>
							<${PriorityBadge} priority=${t.meta.priority} />
						</div>
						<div class="row-meta">
							<${StatusBadge} status=${t.meta.status} />
							<span class="row-id">${t.meta.id}</span>
						</div>
					</div>`,
				)}
				${tasks.length ? null : html`<div class="muted" style=${{ padding: "16px" }}>No matching tasks.</div>`}
			</div>
		</div>
		<div class="detail-pane">
			${selected ? html`<${TaskDetail} board=${board} task=${selected} setSelId=${setSelId} go=${go} />`
				: html`<div class="placeholder">Select a task to read it.</div>`}
		</div>
	</div>`;
}

function TaskDetail({ board, task, setSelId, go }) {
	const m = task.meta;
	const ids = new Set(board.tasks.map((t) => t.meta.id));
	const jump = (id) => (ids.has(id) ? setSelId(id) : null);
	const fields = [
		["Assignee", m.assignee || "—"],
		["Branch", m.branch || "—", true],
		["Created", fmtDate(m.created)],
		["Updated", fmtDate(m.updated)],
		["Verified", m.verified ? fmtDate(m.verified) : "—"],
		["Verified SHA", m.verified_sha ? shortSha(m.verified_sha) : "—", true],
	];
	return html`<article>
		<div class="detail-head">
			<div class="detail-badges">
				<${StatusBadge} status=${m.status} />
				<${PriorityBadge} priority=${m.priority} />
				${(m.skills || []).map((s) => html`<span key=${s} class="badge kind">${s}</span>`)}
			</div>
			<h2>${m.title}</h2>
			<div class="detail-id">${m.id}</div>
		</div>
		<div class="field-grid">
			${fields.map(
				([k, v, mono]) => html`<div key=${k} class="field">
					<span class="k">${k}</span><span class=${cls("v", mono && "mono")}>${v}</span></div>`,
			)}
		</div>
		<${Chips} label="Depends on" items=${m.depends_on} onPick=${jump} />
		<${Chips} label="Blocks" items=${m.blocks} onPick=${jump} />
		<${Chips} label="Blocked by" items=${m.blocked_by} onPick=${jump} />
		<${Chips} label="Specs" items=${m.specs} onPick=${(id) => go("specs", id)} />
		<${Chips} label="Relates to" items=${m.relates_to} onPick=${jump} />
		<div class="section-label">Details</div>
		<${Markdown} source=${task.body} />
	</article>`;
}

/* ---------- Docs (specs / knowledge) ---------- */
function DocsTab({ items, kind, selId, setSelId }) {
	const [query, setQuery] = useState("");
	const list = items.filter((d) => {
		if (!query) return true;
		const q = query.toLowerCase();
		return d.meta.title.toLowerCase().includes(q) || d.meta.id.toLowerCase().includes(q);
	});
	const selected = items.find((d) => d.meta.id === selId);
	return html`<div class="split">
		<div class="list-pane">
			<div class="list-tools">
				<input class="search" placeholder=${`Search ${kind}…`} value=${query}
					onInput=${(e) => setQuery(e.target.value)} />
			</div>
			<div class="rows">
				${list.map(
					(d) => html`<div key=${`${d.scope}/${d.meta.id}`} class=${cls("row", d.meta.id === selId && "sel")}
						onClick=${() => setSelId(d.meta.id)}>
						<div class="row-top"><span class="row-title">${d.meta.title}</span></div>
						<div class="row-meta">
							<span class="badge scope">${d.scope}</span>
							${d.meta.kind && kind === "knowledge" ? html`<span class="badge kind">${d.meta.kind}</span>` : null}
							${d.meta.status ? html`<span class="badge">${d.meta.status}</span>` : null}
							<span class="row-id">${d.meta.id}</span>
						</div>
					</div>`,
				)}
				${list.length ? null : html`<div class="muted" style=${{ padding: "16px" }}>No ${kind}.</div>`}
			</div>
		</div>
		<div class="detail-pane">
			${selected
				? html`<article>
						<div class="detail-head">
							<div class="detail-badges">
								<span class="badge scope">${selected.scope}</span>
								${selected.meta.kind ? html`<span class="badge kind">${selected.meta.kind}</span>` : null}
								${selected.meta.status ? html`<span class="badge">${selected.meta.status}</span>` : null}
							</div>
							<h2>${selected.meta.title}</h2>
							<div class="detail-id">${selected.meta.id} · updated ${fmtDate(selected.meta.updated)}</div>
						</div>
						<${Markdown} source=${selected.body} />
					</article>`
				: html`<div class="placeholder">Select a ${kind.replace(/s$/, "")} to read it.</div>`}
		</div>
	</div>`;
}

/* ---------- Flows ---------- */
function FlowsTab({ board, sel, selRun, setSelRun, selFlow, setSelFlow, onLiveTick }) {
	const [sub, setSub] = useState("runs");
	return html`<div class="detail-pane" style=${{ padding: "20px 28px 80px" }}>
		<div class="subtabs">
			<button class=${cls("subtab", sub === "runs" && "on")} onClick=${() => setSub("runs")}>Runs · ${board.runs.length}</button>
			<button class=${cls("subtab", sub === "scripts" && "on")} onClick=${() => setSub("scripts")}>Scripts · ${board.flows.length}</button>
		</div>
		${sub === "runs"
			? html`<div class="split" style=${{ height: "calc(100vh - 180px)", border: "1px solid var(--border-soft)", borderRadius: "12px", overflow: "hidden" }}>
					<div class="list-pane">
						<div class="rows" style=${{ paddingTop: "10px" }}>
							${board.runs.length
								? board.runs.map(
										(r) => html`<div key=${r.id} class=${cls("row", r.id === selRun && "sel")} onClick=${() => setSelRun(r.id)}>
											<div class="row-top"><span class="row-title" style=${{ fontFamily: "var(--mono)", fontSize: "12.5px" }}>${r.id}</span></div>
											<div class="row-meta">
												${r.active
													? html`<span class="live"><span class="pulse" />live</span>`
													: html`<span class="badge">${r.hasSummary ? "done" : "stopped"}</span>`}
												<span class="muted" style=${{ fontSize: "11px" }}>${r.agents} agents</span>
											</div>
										</div>`,
									)
								: html`<div class="muted" style=${{ padding: "16px" }}>No flow runs.</div>`}
						</div>
					</div>
					<div class="detail-pane">
						${selRun
							? html`<${RunDetail} key=${selRun} sel=${sel} runId=${selRun} onLiveTick=${onLiveTick} />`
							: html`<div class="placeholder">Select a run.</div>`}
					</div>
				</div>`
			: html`<div class="split" style=${{ height: "calc(100vh - 180px)", border: "1px solid var(--border-soft)", borderRadius: "12px", overflow: "hidden" }}>
					<div class="list-pane">
						<div class="rows" style=${{ paddingTop: "10px" }}>
							${board.flows.length
								? board.flows.map(
										(f) => html`<div key=${f.name} class=${cls("row", f.name === selFlow && "sel")} onClick=${() => setSelFlow(f.name)}>
											<div class="row-top"><span class="row-title">${f.name}</span></div>
										</div>`,
									)
								: html`<div class="muted" style=${{ padding: "16px" }}>No flow scripts.</div>`}
						</div>
					</div>
					<div class="detail-pane">
						${selFlow ? html`<${FlowScript} key=${selFlow} sel=${sel} name=${selFlow} />` : html`<div class="placeholder">Select a flow script.</div>`}
					</div>
				</div>`}
	</div>`;
}

function FlowScript({ sel, name }) {
	const [body, setBody] = useState(null);
	const [error, setError] = useState(null);
	useEffect(() => {
		setBody(null);
		setError(null);
		api("/api/flow", { project: sel.project, goal: sel.goal, name })
			.then((d) => setBody(d.body))
			.catch((e) => setError(e.message));
	}, [sel.project, sel.goal, name]);
	if (error) return html`<div class="error-banner">${error}</div>`;
	if (body == null) return html`<div class="placeholder">Loading…</div>`;
	return html`<article>
		<div class="detail-head"><h2 style=${{ fontFamily: "var(--mono)", fontSize: "18px" }}>${name}</h2></div>
		<${Markdown} source=${"```js\n" + body + "\n```"} />
	</article>`;
}

function RunDetail({ sel, runId, onLiveTick }) {
	const [run, setRun] = useState(null);
	const [error, setError] = useState(null);
	const live = run?.agents?.some((a) => a.status === "running");

	const load = useCallback(() => {
		api("/api/flow-run", { project: sel.project, goal: sel.goal, id: runId })
			.then(setRun)
			.catch((e) => setError(e.message));
	}, [sel.project, sel.goal, runId]);

	useEffect(() => {
		setRun(null);
		setError(null);
		load();
	}, [load]);

	useEffect(() => {
		if (!live) return;
		const t = setInterval(() => {
			load();
			onLiveTick?.();
		}, 2500);
		return () => clearInterval(t);
	}, [live, load, onLiveTick]);

	if (error) return html`<div class="error-banner">${error}</div>`;
	if (!run) return html`<div class="placeholder">Loading run…</div>`;

	const timeline = run.events.filter((e) => e.type && e.type !== "agent_delta" && e.type !== "agent_heartbeat");

	return html`<article>
		<div class="detail-head">
			<div class="run-head">
				<h2 style=${{ fontFamily: "var(--mono)", fontSize: "17px" }}>${run.id}</h2>
				${live ? html`<span class="live"><span class="pulse" />live</span>` : null}
			</div>
		</div>

		<div class="section-label">Agents · ${run.agents.length}</div>
		<div class="agent-list">
			${run.agents.map((a) => html`<${AgentItem} key=${a.name} sel=${sel} runId=${run.id} agent=${a} files=${run.agentFiles} />`)}
		</div>

		${run.summary
			? html`<div class="section-label">Summary</div><${Markdown} source=${run.summary} />`
			: html`<div class="muted" style=${{ marginTop: "20px" }}>No summary yet — run still in progress or stopped.</div>`}

		<div class="section-label">Timeline</div>
		<div class="timeline">
			${timeline.map(
				(e, i) => html`<div class="tl-row" key=${i}>
					<span class="ts">${fmtTime(e.ts)}</span>
					<span class="who">${e.name || (e.type === "log" ? "log" : "")}</span>
					<span>${e.message || e.type.replace("agent_", "")}</span>
				</div>`,
			)}
		</div>
	</article>`;
}

function AgentItem({ sel, runId, agent, files }) {
	const [open, setOpen] = useState(false);
	const [content, setContent] = useState(null);
	const file = useMemo(
		() => files.find((f) => f.endsWith(`-${agent.name}.md`)) || files.find((f) => f.includes(agent.name)),
		[files, agent.name],
	);
	useEffect(() => {
		if (!open || content != null || !file) return;
		api("/api/flow-run-file", { project: sel.project, goal: sel.goal, id: runId, name: file })
			.then((d) => setContent(d.content))
			.catch((e) => setContent(`*Failed to load: ${e.message}*`));
	}, [open, content, file, sel.project, sel.goal, runId]);
	const color =
		agent.status === "done" ? "var(--success)" : agent.status === "error" ? "var(--destructive)" : "var(--info)";
	return html`<div class="agent">
		<div class="agent-bar" onClick=${() => file && setOpen((o) => !o)}>
			<span class="badge status" style=${{ "--st": color }}>
				<span style=${{ width: "7px", height: "7px", borderRadius: "999px", background: "currentColor" }} />${agent.status}</span>
			<span class="name">${agent.name}</span>
			${agent.mode ? html`<span class="badge kind">${agent.mode}</span>` : null}
			<span class="chars">${agent.chars ? `${agent.chars.toLocaleString()} ch` : ""}</span>
		</div>
		${!open && agent.preview ? html`<div class="agent-preview">${agent.preview}</div>` : null}
		${open
			? html`<div class="agent-body">
					${content == null ? html`<div class="muted">Loading…</div>` : html`<${Markdown} source=${content} />`}
				</div>`
			: null}
	</div>`;
}

/* ---------- App root ---------- */
function App() {
	const [board, setBoard] = useState(null);
	const [error, setError] = useState(null);
	const [spinning, setSpinning] = useState(false);
	const [sel, setSelState] = useState({ project: undefined, goal: undefined });
	const [tab, setTab] = useState("overview");
	const [selTask, setSelTask] = useState(null);
	const [selSpec, setSelSpec] = useState(null);
	const [selKnow, setSelKnow] = useState(null);
	const [selRun, setSelRun] = useState(null);
	const [selFlow, setSelFlow] = useState(null);
	const selRef = useRef(sel);
	selRef.current = sel;

	const load = useCallback(async (next, spin) => {
		if (spin) setSpinning(true);
		try {
			const data = await api("/api/board", { project: next.project, goal: next.goal });
			setBoard(data);
			setError(null);
		} catch (e) {
			setError(e.message);
		} finally {
			setSpinning(false);
		}
	}, []);

	useEffect(() => {
		load(sel, false);
	}, [sel, load]);

	const setSel = useCallback((updater) => {
		setSelState((prev) => {
			const nextSel = typeof updater === "function" ? updater(prev) : updater;
			setSelTask(null);
			setSelSpec(null);
			setSelKnow(null);
			setSelRun(null);
			setSelFlow(null);
			return nextSel;
		});
	}, []);

	const go = useCallback((nextTab, id) => {
		setTab(nextTab);
		if (nextTab === "tasks") setSelTask(id);
		else if (nextTab === "specs") setSelSpec(id);
		else if (nextTab === "knowledge") setSelKnow(id);
		else if (nextTab === "flows") setSelRun(id);
	}, []);

	const openGoal = useCallback(
		(goalId) => {
			setSel((prev) => ({ project: prev.project ?? board?.current.project, goal: goalId }));
			setTab("overview");
		},
		[board, setSel],
	);

	const liveTick = useCallback(() => load(selRef.current, false), [load]);

	// Poll the board while on the flows tab and a run is live.
	useEffect(() => {
		if (tab !== "flows" || !board?.runs?.some((r) => r.active)) return;
		const t = setInterval(() => load(selRef.current, false), 4000);
		return () => clearInterval(t);
	}, [tab, board, load]);

	if (error && !board) {
		return html`<div class="error-banner">
			<strong>Could not load board.</strong><br />${error}<br /><br />
			Run <code>agent-board init</code> inside a repo, then refresh.
		</div>`;
	}
	if (!board) return html`<div class="boot">Loading board…</div>`;

	const current = { project: sel.project ?? board.current.project, goal: sel.goal ?? board.current.goal };
	const titles = { overview: "Overview", goals: "Goals", tasks: "Tasks", specs: "Specs", knowledge: "Knowledge", flows: "Flows" };

	return html`<div class="layout">
		<${Sidebar} board=${board} tab=${tab} setTab=${setTab} sel=${sel} setSel=${setSel}
			onRefresh=${() => load(sel, true)} spinning=${spinning} />
		<main class="main">
			<div class="topbar">
				<h1>${titles[tab]}</h1>
				<span class="sub">${board.current.project} / ${board.current.goal}</span>
			</div>
			<div class="content">
				${tab === "overview" ? html`<${Overview} board=${board} go=${go} />` : null}
				${tab === "goals" ? html`<${GoalsTab} current=${current} active=${board.current.goal} onOpen=${openGoal} />` : null}
				${tab === "tasks" ? html`<${TasksTab} board=${board} selId=${selTask} setSelId=${setSelTask} go=${go} />` : null}
				${tab === "specs" ? html`<${DocsTab} items=${board.specs} kind="specs" selId=${selSpec} setSelId=${setSelSpec} />` : null}
				${tab === "knowledge" ? html`<${DocsTab} items=${board.knowledge} kind="knowledge" selId=${selKnow} setSelId=${setSelKnow} />` : null}
				${tab === "flows"
					? html`<${FlowsTab} board=${board} sel=${current} selRun=${selRun} setSelRun=${setSelRun}
							selFlow=${selFlow} setSelFlow=${setSelFlow} onLiveTick=${liveTick} />`
					: null}
			</div>
		</main>
	</div>`;
}

createRoot(document.getElementById("root")).render(html`<${App} />`);
