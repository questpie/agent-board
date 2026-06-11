import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import htm from "htm";
import { marked } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js";

const html = htm.bind(createElement);
marked.setOptions({ gfm: true, breaks: false });
marked.use(
	markedHighlight({
		langPrefix: "hljs language-",
		highlight(code, lang) {
			const language = lang && hljs.getLanguage(lang) ? lang : "plaintext";
			return hljs.highlight(code, { language }).value;
		},
	}),
);

const STATUS_ORDER = ["todo", "ready", "in_progress", "blocked", "review", "done"];
const STATUS_RANK = Object.fromEntries(STATUS_ORDER.map((status, index) => [status, index]));
const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };
const RUN_STATUS_RANK = { running: 0, stale: 1, error: 2, stopped: 3, done: 4 };

const cls = (...xs) => xs.filter(Boolean).join(" ");
const shortSha = (s) => (s ? String(s).slice(0, 7) : "");
const fmtDate = (s) =>
	s ? new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtTime = (s) => (s ? new Date(s).toLocaleTimeString(undefined, { hour12: false }) : "");
const fmtAgo = (s) => {
	if (!s) return "";
	const time = typeof s === "number" ? s : new Date(s).getTime();
	if (!Number.isFinite(time)) return "";
	const diff = Math.max(0, Date.now() - time);
	const minute = 60_000;
	const hour = 60 * minute;
	const day = 24 * hour;
	if (diff < minute) return "just now";
	if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
	if (diff < day) return `${Math.floor(diff / hour)}h ago`;
	return `${Math.floor(diff / day)}d ago`;
};

async function api(path, params) {
	const url = new URL(path, location.origin);
	for (const [k, v] of Object.entries(params || {})) if (v != null && v !== "") url.searchParams.set(k, v);
	const res = await fetch(url);
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data?.error || res.statusText);
	return data;
}

const timeValue = (value) => {
	if (!value) return 0;
	const time = typeof value === "number" ? value : new Date(value).getTime();
	return Number.isFinite(time) ? time : 0;
};
const textCompare = (a, b) => String(a || "").localeCompare(String(b || ""), undefined, { sensitivity: "base" });
function SortSelect({ value, onChange, options }) {
	return html`<select class="control sort-control" value=${value} onChange=${(e) => onChange(e.target.value)}>
		${options.map(([id, label]) => html`<option key=${id} value=${id}>${label}</option>`)}
	</select>`;
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
	wireframes: () => Svg(html`<rect x="3" y="4" width="18" height="14" rx="2" /><path d="M8 22h8" /><path d="M12 18v4" /><path d="M7 8h5" /><path d="M7 12h10" />`),
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
const RUN_STATUS_META = {
	running: { label: "running" },
	stale: { label: "stale" },
	stopped: { label: "stopped" },
	done: { label: "done" },
	error: { label: "error" },
};
function RunStatusBadge({ status, label }) {
	const key = RUN_STATUS_META[status] ? status : "stopped";
	return html`<span class=${cls("run-status", key)}>
		<span class="run-dot" />${label || RUN_STATUS_META[key].label}</span>`;
}
function PriorityBadge({ priority }) {
	if (!priority || priority === "normal") return null;
	return html`<span class=${cls("badge", `prio-${priority}`)}>${priority}</span>`;
}
function CatBadge({ category }) {
	if (!category) return null;
	return html`<span class="badge cat" title="category">
		<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
			stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="M3 11.5 11.5 3H20a1 1 0 0 1 1 1v8.5L12.5 21a2 2 0 0 1-2.8 0l-6.7-6.7a2 2 0 0 1 0-2.8Z" />
			<circle cx="7.5" cy="7.5" r="1.4" fill="currentColor" stroke="none" />
		</svg>${category}</span>`;
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
		wireframes: board.wireframes.length,
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
		["wireframes", "Wireframes", counts.wireframes],
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
	const tasks = board.tasks;
	const counts = {};
	for (const s of STATUS_ORDER) counts[s] = 0;
	for (const t of tasks) counts[t.meta.status] = (counts[t.meta.status] ?? 0) + 1;
	const total = tasks.length;
	const done = counts.done;
	const pct = total ? Math.round((done / total) * 100) : 0;
	const segs = STATUS_ORDER.filter((s) => counts[s] > 0);
	const goal = board.goals.find((g) => g.id === board.current.goal);
	const byStatus = (s) => tasks.filter((t) => t.meta.status === s);
	const next = byStatus("ready")[0] || byStatus("todo")[0];
	const runningRuns = board.runs.filter((r) => r.status === "running");
	const staleRuns = board.runs.filter((r) => r.status === "stale");

	const resources = [
		["tasks", "Tasks", total],
		["specs", "Specs", board.specs.length],
		["knowledge", "Knowledge", board.knowledge.length],
		["wireframes", "Wireframes", board.wireframes.length],
		["flows", "Flow runs", board.runs.length],
	].filter(([, , n]) => n > 0);

	const taskCards = [
		["in_progress", "In progress"],
		["blocked", "Blocked"],
		["review", "In review"],
		["ready", "Ready"],
	]
		.map(([s, label]) => ({ s, label, items: byStatus(s) }))
		.filter((c) => c.items.length);

	const empty = !total && !board.specs.length && !board.knowledge.length && !board.wireframes.length && !board.runs.length;

	const TaskRowMini = (t) => html`<div key=${t.meta.id} class="card-row" onClick=${() => go("tasks", t.meta.id)}>
		<${StatusIcon} status=${t.meta.status} size=${14} />
		<span class="t">${t.meta.title}</span>
		${t.meta.assignee ? html`<span class="i">${t.meta.assignee}</span>` : null}
		<${PriorityBadge} priority=${t.meta.priority} />
	</div>`;

	const capped = (items) => {
		const shown = items.slice(0, 7);
		return html`${shown.map(TaskRowMini)}
			${items.length > shown.length
				? html`<div class="card-row muted" onClick=${() => go("tasks", null)}>+ ${items.length - shown.length} more</div>`
				: null}`;
	};

	return html`<div class="overview">
		<div class="goal-header">
			<div class="gh-top">
				<div class="gh-id">
					<div class="eyebrow">Goal</div>
					<h2 class="gh-title">${goal?.title || board.current.goal}</h2>
				</div>
				${runningRuns.length || staleRuns.length
					? html`<div class="run-pills">
							${runningRuns.length ? html`<${RunStatusBadge} status="running" label=${`${runningRuns.length} running`} />` : null}
							${staleRuns.length ? html`<${RunStatusBadge} status="stale" label=${`${staleRuns.length} stale`} />` : null}
						</div>`
					: null}
			</div>
			${total
				? html`<div class="progress">
							${segs.map((s) => html`<span key=${s} style=${{ width: `${(counts[s] / total) * 100}%`, background: `var(--st-${s})` }} title=${`${s.replace("_", " ")}: ${counts[s]}`} />`)}
						</div>
						<div class="goal-stats">
							<span class="goal-pct">${pct}%</span>
							<span class="muted">${done}/${total} done</span>
							<span class="spacer" />
							${segs.map(
								(s) => html`<span key=${s} class="gchip" title=${s.replace("_", " ")}>
									<${StatusIcon} status=${s} size=${12} />${counts[s]}</span>`,
							)}
						</div>`
				: html`<div class="muted">No tasks in this goal yet.</div>`}
			${next && !byStatus("in_progress").length
				? html`<div class="gh-next" onClick=${() => go("tasks", next.meta.id)}>
						<span class="eyebrow">Next up</span>
						<${StatusIcon} status=${next.meta.status} size=${14} />
						<span class="gh-next-title">${next.meta.title}</span>
						<${PriorityBadge} priority=${next.meta.priority} />
					</div>`
				: null}
		</div>

		${empty
			? html`<div class="empty"><div class="big">This goal is empty.</div>Create tasks, specs, or knowledge to see them here.</div>`
			: null}

		${resources.length
			? html`<div class="stat-grid">
					${resources.map(
						([tab, label, n]) => html`<div key=${tab} class="stat clickable" onClick=${() => go(tab, null)}>
							<div class="n">${n}</div>
							<div class="l">${label}</div>
						</div>`,
					)}
				</div>`
			: null}

		${taskCards.length || board.runs.length
			? html`<div class="cards">
					${taskCards.map(
						(c) => html`<div key=${c.s} class="card">
							<h3><${StatusIcon} status=${c.s} size=${13} /> ${c.label} · ${c.items.length}</h3>
							${capped(c.items)}
						</div>`,
					)}
					${board.runs.length
						? html`<div class="card">
								<h3>Flow runs · ${board.runs.length}</h3>
								${board.runs.slice(0, 6).map(
									(r) => html`<div key=${r.id} class="card-row" onClick=${() => go("flows", r.id)}>
										<span class="t">${r.id}</span>
										<${RunStatusBadge} status=${r.status} />
										<span class="row-date">${fmtDate(r.updated)}</span>
									</div>`,
								)}
							</div>`
						: null}
				</div>`
			: null}
	</div>`;
}

/* ---------- Goals ---------- */
function GoalsTab({ current, active, onOpen }) {
	const [data, setData] = useState(null);
	const [error, setError] = useState(null);
	const [sort, setSort] = useState("updated_desc");
	useEffect(() => {
		setData(null);
		setError(null);
		api("/api/goals", { project: current.project })
			.then(setData)
			.catch((e) => setError(e.message));
	}, [current.project]);
	if (error) return html`<div class="error-banner">${error}</div>`;
	if (!data) return html`<div class="placeholder">Loading goals…</div>`;
	const goals = [...data.goals].sort((a, b) => {
		if (sort === "title_asc") return textCompare(a.title, b.title);
		if (sort === "open_desc") return (b.total - b.counts.done) - (a.total - a.counts.done) || textCompare(a.title, b.title);
		return timeValue(b.updated) - timeValue(a.updated) || textCompare(a.title, b.title);
	});
	return html`<div class="overview">
		<div class="list-actions standalone">
			<${SortSelect} value=${sort} onChange=${setSort} options=${[
				["updated_desc", "Updated newest"],
				["open_desc", "Open work"],
				["title_asc", "Title A-Z"],
			]} />
		</div>
		<div class="goals-grid">
			${goals.map((g) => html`<${GoalCard} key=${g.id} g=${g} active=${g.id === active} onOpen=${onOpen} />`)}
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
			${g.updated ? html`<span class="muted">·</span><span class="muted">updated ${fmtDate(g.updated)}</span>` : null}
		</div>
	</div>`;
}

/* ---------- Tasks ---------- */
function TasksTab({ board, selId, setSelId, go }) {
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState(null);
	const [sort, setSort] = useState("updated_desc");
	const counts = {};
	for (const t of board.tasks) counts[t.meta.status] = (counts[t.meta.status] ?? 0) + 1;
	const tasks = board.tasks.filter((t) => {
		if (filter && t.meta.status !== filter) return false;
		if (query) {
			const q = query.toLowerCase();
			return t.meta.title.toLowerCase().includes(q) || t.meta.id.toLowerCase().includes(q);
		}
		return true;
	}).sort((a, b) => {
		if (sort === "created_desc") return timeValue(b.meta.created) - timeValue(a.meta.created) || textCompare(a.meta.title, b.meta.title);
		if (sort === "status_asc") return (STATUS_RANK[a.meta.status] ?? 99) - (STATUS_RANK[b.meta.status] ?? 99) || textCompare(a.meta.title, b.meta.title);
		if (sort === "priority_asc") return (PRIORITY_RANK[a.meta.priority] ?? 99) - (PRIORITY_RANK[b.meta.priority] ?? 99) || timeValue(b.meta.updated) - timeValue(a.meta.updated);
		if (sort === "title_asc") return textCompare(a.meta.title, b.meta.title);
		return timeValue(b.meta.updated) - timeValue(a.meta.updated) || textCompare(a.meta.title, b.meta.title);
	});
	const selected = board.tasks.find((t) => t.meta.id === selId);

	return html`<div class="split">
		<div class="list-pane">
			<div class="list-tools">
				<input class="search" placeholder="Search tasks…" value=${query}
					onInput=${(e) => setQuery(e.target.value)} />
				<div class="list-actions">
					<${SortSelect} value=${sort} onChange=${setSort} options=${[
						["updated_desc", "Updated newest"],
						["created_desc", "Created newest"],
						["status_asc", "Status"],
						["priority_asc", "Priority"],
						["title_asc", "Title A-Z"],
					]} />
				</div>
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
							<span class="row-date">updated ${fmtDate(t.meta.updated)}</span>
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
const UNCATEGORIZED = " uncat";
function DocsTab({ items, kind, selId, setSelId }) {
	const [query, setQuery] = useState("");
	const [cat, setCat] = useState(null);
	const [sort, setSort] = useState("updated_desc");

	const categories = useMemo(() => {
		const map = new Map();
		let uncategorized = 0;
		for (const d of items) {
			if (d.meta.category) map.set(d.meta.category, (map.get(d.meta.category) ?? 0) + 1);
			else uncategorized++;
		}
		return { list: [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])), uncategorized };
	}, [items]);

	const list = items.filter((d) => {
		if (cat === UNCATEGORIZED && d.meta.category) return false;
		if (cat && cat !== UNCATEGORIZED && d.meta.category !== cat) return false;
		if (query) {
			const q = query.toLowerCase();
			return (
				d.meta.title.toLowerCase().includes(q) ||
				d.meta.id.toLowerCase().includes(q) ||
				(d.meta.category || "").toLowerCase().includes(q)
			);
		}
		return true;
	}).sort((a, b) => {
		if (sort === "created_desc") return timeValue(b.meta.created) - timeValue(a.meta.created) || textCompare(a.meta.title, b.meta.title);
		if (sort === "scope_asc") return textCompare(a.scope, b.scope) || textCompare(a.meta.title, b.meta.title);
		if (sort === "title_asc") return textCompare(a.meta.title, b.meta.title);
		if (sort === "status_asc") return textCompare(a.meta.status, b.meta.status) || textCompare(a.meta.title, b.meta.title);
		return timeValue(b.meta.updated) - timeValue(a.meta.updated) || textCompare(a.meta.title, b.meta.title);
	});
	const selected = items.find((d) => d.meta.id === selId);

	return html`<div class="split">
		<div class="list-pane">
			<div class="list-tools">
				<input class="search" placeholder=${`Search ${kind}…`} value=${query}
					onInput=${(e) => setQuery(e.target.value)} />
				<div class="list-actions">
					<${SortSelect} value=${sort} onChange=${setSort} options=${[
						["updated_desc", "Updated newest"],
						["created_desc", "Created newest"],
						["title_asc", "Title A-Z"],
						["scope_asc", "Scope"],
						["status_asc", "Status"],
					]} />
				</div>
				${categories.list.length
					? html`<div class="filters">
							<button class=${cls("filter", !cat && "on")} onClick=${() => setCat(null)}>All ${items.length}</button>
							${categories.list.map(
								([name, n]) => html`<button key=${name} class=${cls("filter", cat === name && "on")} onClick=${() => setCat(name)}>${name} ${n}</button>`,
							)}
							${categories.uncategorized
								? html`<button class=${cls("filter", cat === UNCATEGORIZED && "on")} onClick=${() => setCat(UNCATEGORIZED)}>uncategorized ${categories.uncategorized}</button>`
								: null}
						</div>`
					: null}
			</div>
			<div class="rows">
				${list.map(
					(d) => html`<div key=${`${d.scope}/${d.meta.id}`} class=${cls("row", d.meta.id === selId && "sel")}
						onClick=${() => setSelId(d.meta.id)}>
						<div class="row-top"><span class="row-title">${d.meta.title}</span></div>
						<div class="row-meta">
							<span class="badge scope">${d.scope}</span>
							${d.meta.kind && kind === "knowledge" ? html`<span class="badge kind">${d.meta.kind}</span>` : null}
							<${CatBadge} category=${d.meta.category} />
							${d.meta.status ? html`<span class="badge">${d.meta.status}</span>` : null}
							<span class="row-id">${d.meta.id}</span>
							<span class="row-date">updated ${fmtDate(d.meta.updated)}</span>
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
								<${CatBadge} category=${selected.meta.category} />
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

/* ---------- Wireframes ---------- */
function WireframesTab({ items, selId, setSelId }) {
	const [query, setQuery] = useState("");
	const [cat, setCat] = useState(null);
	const [sort, setSort] = useState("updated_desc");
	const categories = useMemo(() => {
		const map = new Map();
		let uncategorized = 0;
		for (const frame of items) {
			if (frame.meta.category) map.set(frame.meta.category, (map.get(frame.meta.category) ?? 0) + 1);
			else uncategorized++;
		}
		return { list: [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])), uncategorized };
	}, [items]);
	const list = items.filter((frame) => {
		if (cat === UNCATEGORIZED && frame.meta.category) return false;
		if (cat && cat !== UNCATEGORIZED && frame.meta.category !== cat) return false;
		if (query) {
			const q = query.toLowerCase();
			return (
				frame.meta.title.toLowerCase().includes(q) ||
				frame.meta.id.toLowerCase().includes(q) ||
				frame.meta.entry.toLowerCase().includes(q) ||
				(frame.meta.category || "").toLowerCase().includes(q)
			);
		}
		return true;
	}).sort((a, b) => {
		if (sort === "created_desc") return timeValue(b.meta.created) - timeValue(a.meta.created) || textCompare(a.meta.title, b.meta.title);
		if (sort === "scope_asc") return textCompare(a.scope, b.scope) || textCompare(a.meta.title, b.meta.title);
		if (sort === "title_asc") return textCompare(a.meta.title, b.meta.title);
		return timeValue(b.meta.updated) - timeValue(a.meta.updated) || textCompare(a.meta.title, b.meta.title);
	});
	const selected = items.find((frame) => frame.meta.id === selId);

	return html`<div class="split wireframe-split">
		<div class="list-pane">
			<div class="list-tools">
				<input class="search" placeholder="Search wireframes…" value=${query}
					onInput=${(e) => setQuery(e.target.value)} />
				<div class="list-actions">
					<${SortSelect} value=${sort} onChange=${setSort} options=${[
						["updated_desc", "Updated newest"],
						["created_desc", "Created newest"],
						["title_asc", "Title A-Z"],
						["scope_asc", "Scope"],
					]} />
				</div>
				${categories.list.length || categories.uncategorized
					? html`<div class="filters">
							<button class=${cls("filter", !cat && "on")} onClick=${() => setCat(null)}>All ${items.length}</button>
							${categories.list.map(
								([name, n]) => html`<button key=${name} class=${cls("filter", cat === name && "on")} onClick=${() => setCat(name)}>${name} ${n}</button>`,
							)}
							${categories.uncategorized
								? html`<button class=${cls("filter", cat === UNCATEGORIZED && "on")} onClick=${() => setCat(UNCATEGORIZED)}>uncategorized ${categories.uncategorized}</button>`
								: null}
						</div>`
					: null}
			</div>
			<div class="rows">
				${list.map(
					(frame) => html`<div key=${`${frame.scope}/${frame.meta.id}`} class=${cls("row", frame.meta.id === selId && "sel")}
						onClick=${() => setSelId(frame.meta.id)}>
						<div class="row-top"><span class="row-title">${frame.meta.title}</span></div>
						<div class="row-meta">
							<span class="badge scope">${frame.scope}</span>
							<${CatBadge} category=${frame.meta.category} />
							${frame.meta.status ? html`<span class="badge">${frame.meta.status}</span>` : null}
							<span class="row-id">${frame.meta.id}</span>
							<span class="row-date">updated ${fmtDate(frame.meta.updated)}</span>
						</div>
						<div class="row-subtle">${frame.meta.entry}</div>
					</div>`,
				)}
				${list.length ? null : html`<div class="muted" style=${{ padding: "16px" }}>No wireframes.</div>`}
			</div>
		</div>
		<div class="detail-pane wireframe-detail-pane">
			${selected
				? html`<article class="wireframe-detail">
						<div class="detail-head wireframe-head">
							<div>
								<div class="detail-badges">
									<span class="badge scope">${selected.scope}</span>
									<${CatBadge} category=${selected.meta.category} />
									${selected.meta.status ? html`<span class="badge">${selected.meta.status}</span>` : null}
								</div>
								<h2>${selected.meta.title}</h2>
								<div class="detail-id">${selected.meta.id} · ${selected.meta.entry} · updated ${fmtDate(selected.meta.updated)}</div>
							</div>
							<a class="frame-link" href=${selected.url} target="_blank" rel="noreferrer">Open</a>
						</div>
						<div class="wireframe-frame">
							<iframe title=${selected.meta.title} src=${selected.url} loading="lazy" />
						</div>
						${selected.body?.trim() ? html`<div class="section-label">Notes</div><${Markdown} source=${selected.body} />` : null}
					</article>`
				: html`<div class="placeholder">Select a wireframe to preview it.</div>`}
		</div>
	</div>`;
}

/* ---------- Flows ---------- */
function FlowsTab({ board, sel, selRun, setSelRun, selFlow, setSelFlow, onLiveTick }) {
	const [sub, setSub] = useState("runs");
	const [runFilter, setRunFilter] = useState(null);
	const [runSort, setRunSort] = useState("updated_desc");
	const runStatuses = ["running", "stale", "error", "stopped", "done"];
	const runCounts = Object.fromEntries(runStatuses.map((status) => [status, board.runs.filter((run) => run.status === status).length]));
	const visibleRuns = [...(runFilter ? board.runs.filter((run) => run.status === runFilter) : board.runs)].sort((a, b) => {
		if (runSort === "status_asc") return (RUN_STATUS_RANK[a.status] ?? 99) - (RUN_STATUS_RANK[b.status] ?? 99) || timeValue(b.updated) - timeValue(a.updated);
		if (runSort === "id_desc") return String(b.id).localeCompare(String(a.id));
		if (runSort === "agents_desc") return b.agents - a.agents || timeValue(b.updated) - timeValue(a.updated);
		return timeValue(b.updated) - timeValue(a.updated) || String(b.id).localeCompare(String(a.id));
	});
	return html`<div class="detail-pane" style=${{ padding: "20px 28px 80px" }}>
		<div class="subtabs">
			<button class=${cls("subtab", sub === "runs" && "on")} onClick=${() => setSub("runs")}>Runs · ${board.runs.length}</button>
			<button class=${cls("subtab", sub === "scripts" && "on")} onClick=${() => setSub("scripts")}>Scripts · ${board.flows.length}</button>
		</div>
		${sub === "runs"
			? html`<div class="run-filterbar">
					<button class=${cls("run-filter", !runFilter && "on")} onClick=${() => setRunFilter(null)}>All ${board.runs.length}</button>
					${runStatuses.filter((status) => runCounts[status]).map(
						(status) => html`<button key=${status} class=${cls("run-filter", runFilter === status && "on")} onClick=${() => setRunFilter(status)}>
							<${RunStatusBadge} status=${status} label=${`${RUN_STATUS_META[status].label} ${runCounts[status]}`} />
						</button>`,
					)}
					<${SortSelect} value=${runSort} onChange=${setRunSort} options=${[
						["updated_desc", "Updated newest"],
						["status_asc", "Status"],
						["agents_desc", "Agent count"],
						["id_desc", "Run ID"],
					]} />
				</div>
				<div class="split" style=${{ height: "calc(100vh - 226px)", border: "1px solid var(--border-subtle)", borderRadius: "12px", overflow: "hidden" }}>
					<div class="list-pane">
						<div class="rows" style=${{ paddingTop: "10px" }}>
							${visibleRuns.length
								? visibleRuns.map(
										(r) => html`<div key=${r.id} class=${cls("row", "run-row", r.id === selRun && "sel")} onClick=${() => setSelRun(r.id)}>
											<div class="row-top">
												<span class="row-title mono-title">${r.id}</span>
												<${RunStatusBadge} status=${r.status} />
											</div>
											<div class="row-meta">
												<span class="muted" style=${{ fontSize: "11px" }}>${r.agents} agents</span>
												${r.runningAgents ? html`<span class="muted" style=${{ fontSize: "11px" }}>${r.runningAgents} running</span>` : null}
												${r.errorAgents ? html`<span class="muted" style=${{ fontSize: "11px" }}>${r.errorAgents} error</span>` : null}
												<span class="row-date" title=${fmtAgo(r.updated)}>${fmtDate(r.updated)}</span>
											</div>
											${r.preview ? html`<div class="run-preview">${r.preview}</div>` : null}
										</div>`,
									)
								: html`<div class="muted" style=${{ padding: "16px" }}>${board.runs.length ? "No matching flow runs." : "No flow runs."}</div>`}
						</div>
					</div>
					<div class="detail-pane">
						${selRun
							? html`<${RunDetail} key=${selRun} sel=${sel} runId=${selRun} onLiveTick=${onLiveTick} />`
							: html`<div class="placeholder">Select a run.</div>`}
					</div>
				</div>`
			: html`<div class="split" style=${{ height: "calc(100vh - 180px)", border: "1px solid var(--border-subtle)", borderRadius: "12px", overflow: "hidden" }}>
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
		<div class="detail-head"><h2 style=${{ fontFamily: "var(--font-mono)", fontSize: "18px" }}>${name}</h2></div>
		<${Markdown} source=${"```js\n" + body + "\n```"} />
	</article>`;
}

function RunDetail({ sel, runId, onLiveTick }) {
	const [run, setRun] = useState(null);
	const [error, setError] = useState(null);
	const live = run?.status === "running";

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
	const noSummaryText =
		run.status === "stale"
			? `No summary yet. Last activity was ${fmtAgo(run.updated) || "not recorded"}; the run may have stopped without closing.`
			: run.status === "stopped"
				? "No summary yet. The run stopped before writing one."
				: "No summary yet. The run is still in progress.";

	return html`<article>
		<div class="detail-head">
			<div class="run-head">
				<h2 style=${{ fontFamily: "var(--font-mono)", fontSize: "17px" }}>${run.id}</h2>
				<${RunStatusBadge} status=${run.status} />
			</div>
			<div class="run-meta-line">
				<span>Updated ${fmtDate(run.updated)}</span>
				<span>${run.agents.length} agents</span>
				${run.runningAgents ? html`<span>${run.runningAgents} running</span>` : null}
				${run.errorAgents ? html`<span>${run.errorAgents} error</span>` : null}
			</div>
		</div>

		${run.preview ? html`<div class="section-label">Latest output</div><div class="latest-output">${run.preview}</div>` : null}

		<div class="section-label">Agents · ${run.agents.length}</div>
		<div class="agent-list">
			${run.agents.map((a) => html`<${AgentItem} key=${a.name} sel=${sel} runId=${run.id} agent=${a} files=${run.agentFiles} />`)}
		</div>

		${run.summary
			? html`<div class="section-label">Summary</div><${Markdown} source=${run.summary} />`
			: html`<div class="muted" style=${{ marginTop: "20px" }}>${noSummaryText}</div>`}

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
			${agent.lastActivity ? html`<span class="agent-time">${fmtDate(agent.lastActivity)}</span>` : null}
		</div>
		${agent.error ? html`<div class="agent-error">${agent.error}</div>` : null}
		${!open && agent.preview ? html`<div class="agent-preview">${agent.preview}</div>` : null}
		${open
			? html`<div class="agent-body">
					${content == null ? html`<div class="muted">Loading…</div>` : html`<${Markdown} source=${content} />`}
				</div>`
			: null}
	</div>`;
}

/* ---------- App root ---------- */
const TABS = ["overview", "goals", "tasks", "specs", "knowledge", "wireframes", "flows"];
function readHash() {
	const raw = (typeof location !== "undefined" ? location.hash : "").replace(/^#/, "");
	const slash = raw.indexOf("/");
	const tab = slash === -1 ? raw : raw.slice(0, slash);
	const id = slash === -1 ? null : decodeURIComponent(raw.slice(slash + 1)) || null;
	return { tab: TABS.includes(tab) ? tab : "overview", id };
}

function App() {
	const init = readHash();
	const [board, setBoard] = useState(null);
	const [error, setError] = useState(null);
	const [spinning, setSpinning] = useState(false);
	const [sel, setSelState] = useState({ project: undefined, goal: undefined });
	const [tab, setTab] = useState(init.tab);
	const [selTask, setSelTask] = useState(init.tab === "tasks" ? init.id : null);
	const [selSpec, setSelSpec] = useState(init.tab === "specs" ? init.id : null);
	const [selKnow, setSelKnow] = useState(init.tab === "knowledge" ? init.id : null);
	const [selWireframe, setSelWireframe] = useState(init.tab === "wireframes" ? init.id : null);
	const [selRun, setSelRun] = useState(init.tab === "flows" ? init.id : null);
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

	useEffect(() => {
		const id = tab === "tasks" ? selTask : tab === "specs" ? selSpec : tab === "knowledge" ? selKnow : tab === "wireframes" ? selWireframe : tab === "flows" ? selRun : null;
		const hash = id ? `#${tab}/${encodeURIComponent(id)}` : `#${tab}`;
		if (typeof history !== "undefined") history.replaceState(null, "", hash);
	}, [tab, selTask, selSpec, selKnow, selWireframe, selRun]);

	const setSel = useCallback((updater) => {
		setSelState((prev) => {
			const nextSel = typeof updater === "function" ? updater(prev) : updater;
			setSelTask(null);
			setSelSpec(null);
			setSelKnow(null);
			setSelWireframe(null);
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
		else if (nextTab === "wireframes") setSelWireframe(id);
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
	const titles = { overview: "Overview", goals: "Goals", tasks: "Tasks", specs: "Specs", knowledge: "Knowledge", wireframes: "Wireframes", flows: "Flows" };

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
				${tab === "wireframes" ? html`<${WireframesTab} items=${board.wireframes} selId=${selWireframe} setSelId=${setSelWireframe} />` : null}
				${tab === "flows"
					? html`<${FlowsTab} board=${board} sel=${current} selRun=${selRun} setSelRun=${setSelRun}
							selFlow=${selFlow} setSelFlow=${setSelFlow} onLiveTick=${liveTick} />`
					: null}
			</div>
		</main>
	</div>`;
}

createRoot(document.getElementById("root")).render(html`<${App} />`);
