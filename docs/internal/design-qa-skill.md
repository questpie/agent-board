# DRAFT — `agent-board-design-qa` skill

> Internal RFC / review artifact. `docs/internal/` is not shipped to npm
> (`files: ["src","docs/*.md"]` is non-recursive) and is excluded from the skill
> drift audit. This file is the human-readable source of truth for the skill
> text; it is ported into `src/skills.ts` by a one-shot script (extracting the
> `SKILL_START`/`AGENTS_START` marker blocks), then registered in
> `src/skills-audit.ts` and materialized in `src/workspace.ts`.
>
> Design contract (decided with the user):
> - Phase 1 lives as an agent-board skill; the stable measurement primitive is
>   extracted into qprobe later, after dogfooding.
> - Reuse whatever browser/preview capability the harness already exposes
>   (Claude Code `preview_*`, Codex, qprobe, Playwright). This skill is the
>   missing *framework*, not new browser infrastructure.
> - HOW (method/thresholds) is shared; WHAT (tokens/breakpoints/components) is
>   read per-repo on the spot; MEASURE is a dumb reused capability.
> - A reference is just an image in — no baked-in Figma engine.

## SKILL.md

<!-- SKILL_START -->
---
name: agent-board-design-qa
description: "QA the IMPLEMENTED, running web UI by MEASURING it, not eyeballing screenshots: catch wrapped text, off-center button labels, misalignment, off-token shadows/spacing, low contrast, and — when a reference exists — pixel-fidelity drift. Reuses the harness's own preview/browser tools and adds the missing framework. Use after implementing or changing UI, for pixel-perfect / 1:1 work, or when asked whether a design 'looks right'. Pairs with agent-board-design-review (which reviews the mockup). Triggers: design qa, visual qa, pixel-perfect, 1:1, does this look right, polish the UI, fix the layout, text wrapping, misalignment, off-center, contrast, design tokens, visual check."
---

# Agent Board · Design QA

Use this skill to QA the IMPLEMENTED, running web UI — the design analog of running the tests, not reading them. You MEASURE the rendered page and fix in code; the screenshot is your proof, never your judge. This is the post-implementation gate that pairs with `agent-board-design-review` (which critiques the mockup before code).

## Measure, don't perceive

A screenshot that "looks fine" is the trap. Vision models downsample every image to a fixed budget, so a 2px misalignment, a silently truncated label, an off-token shadow, or a slightly off-center button vanish before the model ever sees them — frontier models score under 50% on fine-grained visual perception versus ~96% for humans. So do not judge quality by looking. Derive findings from the DOM and CSSOM, where the numbers are exact, and reserve the screenshot for evidence and for the small residual that genuinely resists measurement.

Split of responsibility:

- HOW (this skill): the method, the thresholds, the layer order, the finding format. Portable across repos.
- WHAT (the repo): the design system — spacing scale, color/radius/shadow tokens, breakpoints, component library. Read it from THIS repo every run; generic thresholds are only the floor.
- MEASURE (a dumb capability): open the page, eval JS, screenshot. Reused from your harness — never rebuilt here.

## Capability contract (works on any harness)

This skill needs three capabilities from whatever harness you are on — Claude Code, Codex, qprobe, raw Playwright. Bind each to the tool yours exposes; do not build new browser infrastructure:

1. Eval JS in the page — Claude Code `preview_eval`, qprobe `qprobe browser eval`, Playwright `page.evaluate`.
2. Screenshot — `preview_screenshot`, `qprobe browser screenshot`.
3. Set the viewport — `preview_resize`, `qprobe browser resize`.

If none is available, wiring one up is the first step; the rest of the loop assumes these three.

## Loop

1. Target. Read the task and its spec: `agent-board show <task-id>`, then `agent-board spec cat <spec-id>`. Note the required screens, states, and breakpoints. If a visual reference exists (a mockup via `agent-board web`, a Figma export, or a screenshot), keep its image for step 7 — the reference is just an image; where it comes from is your call.
2. Read this repo's design system. Find the token source (Tailwind/theme config, CSS custom properties, the component library) and extract the spacing scale, the color/radius/shadow tokens, and the real breakpoints. These are the WHAT you measure against.
3. Render at the repo's real breakpoints (its own `sm`/`md`/`lg`, not invented numbers). Set the viewport, load the page, let it settle.
4. Measure (deterministic, no vision). Inject the scan below via your eval capability, at each breakpoint. It returns located, measured findings: horizontal overflow, clipped/overflowing content, silently truncated text, collapsed (zero-height) content, sibling overlap, near-miss misalignment, tiny tap targets, sub-16px input fonts.
5. Token conformance. Snapshot computed styles (color, background-color, border-color, box-shadow, border-radius, gap, padding, margin) across the visible tree and flag any value not in the repo's token set — off-token colors, off-grid spacing, magic-number shadows/radii. This is where an "ugly shadow" usually lives: a one-off blur nobody chose.
6. Contrast and a11y heuristics. Inject axe-core from a CDN and run it; surface color-contrast, accessible-name, and target-size violations. Low contrast is a real "looks cheap" signal, not just an a11y nit.
7. Reference diff — only when a reference image exists. Screenshot the page at the reference's viewport and diff it: a perceptual pixel diff (pixelmatch / odiff / Playwright `toHaveScreenshot`, YIQ + anti-aliasing on, threshold ~0.2) for drift, plus an onion-skin overlay (reference at 50% opacity over the screenshot) for alignment — misalignment shows up as ghosting. This is the 1:1 layer.
8. Vision LAST, residual only. For what truly resists measurement — an ugly shadow that passed the token check, optical (not mathematical) alignment, overall balance — screenshot a CROP of that region (never the full page; crops keep the detail the downsampler destroys) and judge it against a short, explicit rubric. The verdict is advisory: it may add a finding, never overturn a measured one.
9. Fix in code, then re-run from step 3 until the measured layers are clean. You are fixing real located defects, not chasing a vibe. Attach the final screenshot as proof.
10. Record on the board. Blocking defects become tasks: `agent-board new "<fix>" --status ready`. Reusable traps become knowledge: `agent-board knowledge add "<gotcha>" --kind gotcha --category design`. Tie them to the spec with `agent-board link <task-id> --spec <spec-id>`.

## The scan (the one portable primitive)

A dumb measurer: it returns numbers, it does not judge. Inject it with your eval capability at each breakpoint; it returns an array of findings. Tune the magic numbers (spacing base, min tap target) to the repo's tokens in step 2, and scope `document.body` to a container on large pages.

```js
(function () {
  var vw = document.documentElement.clientWidth || window.innerWidth;
  if (!vw) return [{ layer: "meta", severity: "warn", selector: "html", viewport: 0, prop: "viewport", measured: "0", expected: "> 0", message: "viewport width is 0 - page not laid out yet; retry after load" }];
  var out = [];
  function sel(el) {
    if (el.id) return "#" + el.id;
    var parts = [], n = el, depth = 0;
    while (n && n.nodeType === 1 && depth < 4) {
      var p = n.tagName.toLowerCase();
      if (n.classList && n.classList.length) p += "." + Array.prototype.slice.call(n.classList, 0, 2).join(".");
      parts.unshift(p);
      n = n.parentElement; depth++;
    }
    return parts.join(" > ");
  }
  function visible(el) {
    var r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && parseFloat(s.opacity) > 0 && !el.ownerSVGElement;
  }
  function add(layer, sev, el, prop, measured, expected, msg) {
    out.push({ layer: layer, severity: sev, selector: sel(el), viewport: vw, prop: prop, measured: measured, expected: expected, message: msg });
  }
  var all = Array.prototype.slice.call(document.body.querySelectorAll("*")).filter(visible);
  for (var i = 0; i < all.length; i++) {
    var el = all[i], r = el.getBoundingClientRect(), s = getComputedStyle(el);
    var tag = el.tagName.toLowerCase();
    var parentOver = el.parentElement && el.parentElement.getBoundingClientRect().right > vw + 2;
    if (r.right > vw + 2 && !parentOver) add("geometry", "blocking", el, "right", Math.round(r.right) + "px", "<= " + vw + "px", "extends " + Math.round(r.right - vw) + "px past the viewport (horizontal overflow)");
    if (el.scrollWidth > el.clientWidth + 1 && s.overflowX !== "auto" && s.overflowX !== "scroll" && tag !== "select") add("geometry", "warn", el, "scrollWidth", el.scrollWidth + "px", "<= " + el.clientWidth + "px", "content overflows its box by " + (el.scrollWidth - el.clientWidth) + "px");
    if (s.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1 && !el.title && !el.getAttribute("aria-label")) add("geometry", "warn", el, "text", "truncated", "title or aria-label", "ellipsis-truncated text with no title/aria-label");
    if (el.children.length === 0 && (el.textContent || "").trim().length > 0 && r.height < 1) add("geometry", "warn", el, "height", Math.round(r.height) + "px", "> 0", "has text but renders at zero height (collapsed)");
    var interactive = (tag === "a" || tag === "button" || tag === "select" || tag === "textarea") || el.getAttribute("role") === "button" || (tag === "input" && el.type !== "hidden");
    if (interactive && (r.width < 44 || r.height < 44)) add("a11y", "warn", el, "size", Math.round(r.width) + "x" + Math.round(r.height), ">= 44x44", "tap target smaller than 44x44");
    if ((tag === "input" || tag === "textarea" || tag === "select") && parseFloat(s.fontSize) < 16) add("a11y", "polish", el, "fontSize", s.fontSize, ">= 16px", "input font under 16px (causes mobile zoom-on-focus)");
  }
  var parents = all.filter(function (p) { return p.children.length > 1; });
  for (var j = 0; j < parents.length; j++) {
    var kids = Array.prototype.filter.call(parents[j].children, visible);
    if (kids.length < 2) continue;
    var lefts = kids.map(function (k) { return Math.round(k.getBoundingClientRect().left); });
    var counts = {};
    lefts.forEach(function (v) { counts[v] = (counts[v] || 0) + 1; });
    var dom = null, best = 0;
    for (var key in counts) { if (counts[key] > best) { best = counts[key]; dom = parseInt(key, 10); } }
    if (dom !== null && best >= 2) {
      for (var a = 0; a < kids.length; a++) {
        var d = lefts[a] - dom;
        if (d !== 0 && Math.abs(d) <= 4) add("geometry", "warn", kids[a], "left", lefts[a] + "px", dom + "px", "left edge off by " + d + "px from its siblings (near-miss misalignment)");
      }
    }
    for (var x = 0; x < kids.length; x++) {
      for (var y = x + 1; y < kids.length; y++) {
        var ra = kids[x].getBoundingClientRect(), rb = kids[y].getBoundingClientRect();
        var ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        var oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (ox > 2 && oy > 2) add("geometry", "warn", kids[y], "overlap", Math.round(ox) + "x" + Math.round(oy) + "px", "no overlap", "overlaps a sibling by " + Math.round(ox) + "x" + Math.round(oy) + "px");
      }
    }
  }
  return out.slice(0, 200);
})()
```

Hardening (learned from dogfooding the scanner on a real board UI): read the viewport from document.documentElement.clientWidth and bail if it is 0 (the eval context may not be laid out yet, which otherwise flags every element as overflowing); report only the OUTERMOST overflowing element, not every descendant of it; skip elements inside an svg (ownerSVGElement), whose internal paths/shapes are geometry not layout and produce pure noise; ignore native select content-overflow (it clips option text by design). Detect overlap by pairwise rect intersection of siblings, NOT by comparing a parent's area to the sum of its children's areas — the area method is unsound and gives false positives.

## Finding format

Every layer — scan, tokens, a11y, diff, vision — emits the same shape so findings sort and act uniformly:

`{ layer, severity, selector, viewport, prop, measured, expected, message, fix }`

- `layer`: geometry | tokens | a11y | diff | vision
- `severity`: blocking | warn | polish
- `selector`: a click-to-find CSS path
- `measured` / `expected`: the numbers (e.g. measured "blur 17px", expected "one of 0/1/2/4/8/16")
- `fix`: the concrete code change

## Output

A verdict per breakpoint, then an ordered list of findings (blocking first, polish last). Each names the selector, the viewport, the measured value, the rule it breaks, and a fix. Close with residual risk and the layers you did not run (no reference, vision skipped, etc.).

## Don't

- Don't eyeball a screenshot and call it reviewed — that is the exact failure this skill exists to fix.
- Don't assert exact pixels or colors from a downsampled screenshot; read them from the DOM/CSSOM.
- Don't invent thresholds the repo's tokens already define; the token set is the truth, generic numbers are the floor.
- Don't let the vision judge overturn a measured finding; it is advisory, runs on crops, and runs last.
- Don't build new browser infrastructure; bind to the harness's preview/browser tools.
- Don't bake in a Figma engine; a reference is just an image in.
<!-- SKILL_END -->

## AGENTS.md

<!-- AGENTS_START -->
# Agent Board Design QA Rules

- QA the IMPLEMENTED running UI by MEASURING it; never judge quality from a screenshot — vision misses 2px misalignment, silent truncation, and off-token shadows.
- Reuse the harness's own browser tools (Claude Code `preview_*`, qprobe `browser`, Playwright); do not build new browser infrastructure.
- HOW is this skill (method, thresholds, layer order); WHAT is the repo (tokens, breakpoints, components) — read the design system every run and measure against it.
- Layer order: DOM geometry scan -> token conformance -> axe-core contrast/a11y -> reference pixel-diff + overlay (only when a reference image exists) -> vision judge LAST, on crops, advisory only.
- A reference is just an image in (Figma export/MCP or a mockup screenshot); no baked-in Figma engine.
- Fix in code and re-run until the measured layers are clean; the screenshot is proof, not the judge.
- Record blocking defects as tasks (`agent-board new`) and reusable traps as knowledge (`agent-board knowledge add --kind gotcha --category design`); link findings to the spec.
<!-- AGENTS_END -->
