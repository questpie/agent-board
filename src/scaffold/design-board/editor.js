// editor — turns the static screens into a direct-manipulation surface while
// edit mode is on, and persists each change as a patch through window.boardHost.
// No rendered->source mapping is needed: the content is static, so the DOM node
// the user edits IS the source node the host rewrites on disk.
(() => {
  const host = window.boardHost;
  const root = document.querySelector("[data-board]") || document.body;
  const texts = [...root.querySelectorAll('[data-edit="text"]')];
  const images = [...root.querySelectorAll('[data-edit="image"]')];

  const patchBase = (el) => {
    const screen = el.closest("[data-screen]")?.dataset.screen;
    const key = el.dataset.key;
    return screen && key ? { screen, key } : null;
  };
  const flash = (el) => { el.classList.add("saved"); setTimeout(() => el.classList.remove("saved"), 600); };
  const fail = (el, e) => { el.style.outline = "2px solid #b00020"; console.error("[editor]", e); };
  const currentUrl = (el) => (el.style.getPropertyValue("--img").match(/url\(["']?(.*?)["']?\)/) || [])[1] || "";

  // ── text leaves: contentEditable, persist on blur ──
  texts.forEach((el) => {
    el.addEventListener("focus", () => { el.dataset._orig = el.textContent.trim(); });
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); el.blur(); } });
    el.addEventListener("blur", async () => {
      const base = patchBase(el);
      const value = el.textContent.trim();
      if (!base || value === el.dataset._orig) return;
      try { await host.write({ ...base, kind: "text", value }); el.dataset._orig = value; flash(el); }
      catch (e) { fail(el, e); }
    });
  });

  // ── image leaves: inline picker — board media / upload / URL ──
  let picker = null;
  let target = null;

  const ensurePicker = () => {
    if (picker) return picker;
    const style = document.createElement("style");
    style.textContent =
      ".be-pick{position:fixed;z-index:10000;width:320px;max-width:calc(100vw - 16px);background:#fff;" +
      "border:1px solid #e7e3dc;border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.18);padding:12px;" +
      "font:13px -apple-system,BlinkMacSystemFont,sans-serif;color:#1c1b19}" +
      ".be-pick .lab{font-weight:600;margin-bottom:8px}" +
      ".be-pick .media{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px;" +
      "max-height:132px;overflow:auto}" +
      ".be-pick .media .t{aspect-ratio:1;border-radius:6px;border:1px solid #e7e3dc;cursor:pointer;" +
      "background:#f0eee9 center/cover no-repeat}" +
      ".be-pick .media .t:hover{outline:2px solid #d97757;outline-offset:-1px}" +
      ".be-pick .media .empty{grid-column:1/-1;color:#6b6760;font-size:12px;padding:4px 2px}" +
      ".be-pick input[type=url]{width:100%;box-sizing:border-box;border:1px solid #e7e3dc;border-radius:8px;" +
      "padding:9px 10px;font:inherit;margin-bottom:10px}" +
      ".be-pick .row{display:flex;gap:8px;align-items:center}" +
      ".be-pick .sp{flex:1}" +
      ".be-pick button,.be-pick .up{appearance:none;border:0;border-radius:8px;padding:8px 14px;font:inherit;" +
      "font-weight:600;cursor:pointer}" +
      ".be-pick .up{background:#f0eee9;color:#1c1b19}" +
      ".be-pick .apply{background:#d97757;color:#fff}" +
      ".be-pick .remove{background:transparent;color:#b00020;padding:8px 6px}";
    document.head.appendChild(style);

    picker = document.createElement("div");
    picker.className = "be-pick be-chrome";
    picker.style.display = "none";
    picker.innerHTML =
      '<div class="lab">Replace image</div>' +
      '<div class="media" aria-label="Board media"></div>' +
      '<input type="url" placeholder="https://… image URL" />' +
      '<div class="row">' +
        '<label class="up">Upload<input type="file" accept="image/*" hidden /></label>' +
        '<span class="sp"></span>' +
        '<button type="button" class="remove">Remove</button>' +
        '<button type="button" class="apply">Apply</button>' +
      "</div>";
    document.body.appendChild(picker);

    const input = picker.querySelector("input[type=url]");
    picker.querySelector(".apply").addEventListener("click", () => commit(input.value.trim()));
    picker.querySelector(".remove").addEventListener("click", () => commit(""));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(input.value.trim()); }
      else if (e.key === "Escape") close();
    });
    // Upload → board assets/, then use the returned relative path.
    picker.querySelector("input[type=file]").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      try { commit(await host.uploadAsset(file)); }
      catch (err) { if (target) fail(target, err); }
    });
    // Dismiss on outside click (but not when clicking another editable image).
    document.addEventListener("mousedown", (e) => {
      if (picker.style.display !== "none" && !picker.contains(e.target) && !e.target.closest('[data-edit="image"]')) close();
    });
    return picker;
  };

  // Fill the media grid from the board's asset library (click a thumb to pick).
  const populateMedia = async () => {
    const grid = picker.querySelector(".media");
    let assets = [];
    try { assets = await host.listAssets(); } catch (e) {}
    if (!assets.length) {
      grid.innerHTML = '<div class="empty">No media yet — upload or paste a URL.</div>';
      return;
    }
    grid.innerHTML = "";
    for (const path of assets) {
      const t = document.createElement("div");
      t.className = "t";
      t.title = path;
      t.style.backgroundImage = `url("${path}")`;
      t.addEventListener("click", () => commit(path));
      grid.appendChild(t);
    }
  };

  const openPicker = (el) => {
    const p = ensurePicker();
    target = el;
    const input = p.querySelector("input[type=url]");
    input.value = currentUrl(el);
    const r = el.getBoundingClientRect();
    p.style.display = "block";
    p.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 328)) + "px";
    p.style.top = Math.max(8, Math.min(r.bottom + 8, window.innerHeight - p.offsetHeight - 8)) + "px";
    populateMedia();
    input.focus();
    input.select();
  };

  const close = () => { if (picker) picker.style.display = "none"; target = null; };

  const commit = async (url) => {
    const el = target;
    close();
    if (!el) return;
    el.style.setProperty("--img", url ? `url("${url}")` : "");
    const base = patchBase(el);
    if (!base) return;
    try { await host.write({ ...base, kind: "image", value: url }); flash(el); }
    catch (e) { fail(el, e); }
  };

  images.forEach((el) => {
    el.addEventListener("click", () => { if (window.boardStage?.editing) openPicker(el); });
  });

  // ── layout editing: per-container toolbar (direction / gap / padding) +
  //    child reorder (move up/down). All chrome lives in body overlays
  //    (class be-chrome), never in screen content, so a screen serializes
  //    clean. Each op mutates the live DOM, then persists the screen's clean
  //    inner HTML (kind:"layout") — the client owns structural edits.
  // The spacing ladder is read from the tokens at runtime (tokens.css is the
  // single source of truth) — never a hardcoded copy, so re-theming the scale
  // keeps the stepper correct.
  const SPACE = ["--space-1", "--space-2", "--space-3", "--space-4", "--space-5", "--space-6", "--space-8"];
  const spaceLadder = () => SPACE.map((v) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(v)) || 0);
  const nearestStep = (px, ladder) => {
    let bi = 0, bd = Infinity;
    ladder.forEach((v, i) => { const d = Math.abs(v - px); if (d < bd) { bd = d; bi = i; } });
    return bi;
  };

  const cleanScreenHtml = (screenEl) => {
    const clone = screenEl.cloneNode(true);
    clone.querySelectorAll(".be-chrome").forEach((n) => n.remove());
    clone.querySelectorAll("[contenteditable]").forEach((n) => n.removeAttribute("contenteditable"));
    clone.querySelectorAll(".saved").forEach((n) => n.classList.remove("saved"));
    clone.querySelectorAll("*").forEach((n) => {
      [...n.attributes].forEach((a) => { if (a.name.startsWith("data-_")) n.removeAttribute(a.name); });
      if (n.getAttribute("class") === "") n.removeAttribute("class");
      if (n.getAttribute("style") === "") n.removeAttribute("style");
    });
    return clone.innerHTML;
  };

  const persistLayout = async (screenEl, flashEl) => {
    if (!screenEl || !screenEl.dataset.screen) return;
    try { await host.write({ screen: screenEl.dataset.screen, kind: "layout", html: cleanScreenHtml(screenEl) }); flash(flashEl || screenEl); }
    catch (e) { fail(flashEl || screenEl, e); }
  };

  let layTool = null, layContainer = null, layChild = null, layHideT = null, layOn = false;

  const stepSpace = (el, prop, dir) => {
    const ladder = spaceLadder();
    const cur = parseFloat(getComputedStyle(el)[prop === "gap" ? "gap" : "paddingTop"]) || 0;
    const i = Math.max(0, Math.min(SPACE.length - 1, nearestStep(cur, ladder) + dir));
    el.style[prop] = `var(${SPACE[i]})`;
  };
  const toggleDir = (el) => {
    if (el.classList.contains("stack")) el.classList.replace("stack", "row");
    else if (el.classList.contains("row")) el.classList.replace("row", "stack");
  };
  // After a structural move the moved element's indentation text nodes are left
  // behind (siblings serialize joined as `</div><div>`). reflow re-normalizes
  // ONLY the container's whitespace-only direct text nodes, sampling the authored
  // child + closing indent from the live DOM, so the serialized screen stays
  // clean and the diff is just the reorder. It never touches element content.
  const trailingWs = (node) => {
    if (!node || node.nodeType !== 3) return null;
    const m = node.nodeValue.match(/\n([ \t]*)$/);
    return m ? "\n" + m[1] : null;
  };
  const reflow = (container) => {
    let childIndent = null;
    for (const n of container.childNodes) {
      if (n.nodeType === 3) { const w = trailingWs(n); if (w) { childIndent = w; break; } }
    }
    if (!childIndent) return; // compact / inline-authored container — leave as-is
    const closeIndent = trailingWs(container.previousSibling) || childIndent;
    [...container.childNodes].forEach((n) => { if (n.nodeType === 3 && !n.nodeValue.trim()) n.remove(); });
    [...container.children].forEach((el) => container.insertBefore(document.createTextNode(childIndent), el));
    container.appendChild(document.createTextNode(closeIndent));
  };
  const moveChild = (child, dir) => {
    const p = child.parentElement;
    if (dir < 0 && child.previousElementSibling) p.insertBefore(child, child.previousElementSibling);
    else if (dir > 0 && child.nextElementSibling) p.insertBefore(child.nextElementSibling, child);
    else return;
    reflow(p);
  };

  const positionLayTool = (container) => {
    if (!layTool) return;
    const r = container.getBoundingClientRect();
    layTool.style.left = Math.max(8, Math.min(r.right - layTool.offsetWidth, window.innerWidth - layTool.offsetWidth - 8)) + "px";
    layTool.style.top = Math.max(8, r.top - 32) + "px";
  };

  const hideLayTool = () => {
    if (layHideT) clearTimeout(layHideT);
    layHideT = setTimeout(() => {
      if (layTool) layTool.removeAttribute("data-show");
      layContainer = layChild = null;
    }, 120);
  };

  const ensureLayTool = () => {
    if (layTool) return layTool;
    const style = document.createElement("style");
    style.textContent =
      ".be-laytool{position:fixed;z-index:10001;display:none;gap:2px;align-items:center;" +
      "background:#1c1b19;color:#fff;border-radius:999px;padding:4px;" +
      "font:12px -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.3)}" +
      ".be-laytool[data-show]{display:inline-flex}" +
      ".be-laytool button{appearance:none;border:0;background:transparent;color:#fff;cursor:pointer;" +
      "height:24px;min-width:24px;padding:0 7px;border-radius:999px;font:inherit}" +
      ".be-laytool button:hover{background:rgba(255,255,255,.16)}" +
      ".be-laytool .sep{width:1px;height:16px;background:rgba(255,255,255,.2);margin:0 3px}" +
      ".be-laytool .lbl{opacity:.55;font-size:10px;padding:0 1px 0 4px}";
    document.head.appendChild(style);

    layTool = document.createElement("div");
    layTool.className = "be-laytool be-chrome";
    layTool.innerHTML =
      '<button data-act="up" title="Move up">↑</button>' +
      '<button data-act="down" title="Move down">↓</button>' +
      '<span class="sep"></span>' +
      '<button data-act="dir" title="Toggle direction (stack ↔ row)">⤢</button>' +
      '<span class="lbl">gap</span><button data-act="gap-" title="Less gap">−</button><button data-act="gap+" title="More gap">+</button>' +
      '<span class="lbl">pad</span><button data-act="pad-" title="Less padding">−</button><button data-act="pad+" title="More padding">+</button>';
    document.body.appendChild(layTool);

    layTool.addEventListener("mouseenter", () => { if (layHideT) clearTimeout(layHideT); });
    layTool.addEventListener("mouseleave", hideLayTool);
    layTool.addEventListener("click", (e) => {
      const act = e.target && e.target.dataset ? e.target.dataset.act : null;
      if (!act) return;
      const container = layContainer, child = layChild;
      const screen = (container || child) && (container || child).closest("[data-screen]");
      if (act === "up" && child) moveChild(child, -1);
      else if (act === "down" && child) moveChild(child, 1);
      else if (act === "dir" && container) toggleDir(container);
      else if (act === "gap-" && container) stepSpace(container, "gap", -1);
      else if (act === "gap+" && container) stepSpace(container, "gap", 1);
      else if (act === "pad-" && container) stepSpace(container, "padding", -1);
      else if (act === "pad+" && container) stepSpace(container, "padding", 1);
      else return;
      persistLayout(screen, container || child);
      if (container) requestAnimationFrame(() => positionLayTool(container));
    });
    return layTool;
  };

  const showLayFor = (target) => {
    const container = target.closest(".stack, .row");
    if (!container || !root.contains(container) || !container.closest("[data-screen]")) { hideLayTool(); return; }
    ensureLayTool();
    if (layHideT) { clearTimeout(layHideT); layHideT = null; }
    layContainer = container;
    let child = target;
    while (child && child.parentElement !== container) child = child.parentElement;
    layChild = child && child.parentElement === container ? child : null;
    const canMove = !!layChild && container.children.length > 1;
    layTool.querySelector('[data-act="up"]').style.display = canMove ? "" : "none";
    layTool.querySelector('[data-act="down"]').style.display = canMove ? "" : "none";
    layTool.setAttribute("data-show", "");
    positionLayTool(container);
  };

  const onLayMove = (e) => {
    if (!layOn) return;
    if (e.target.closest && e.target.closest("[data-screen]")) showLayFor(e.target);
    else if (!(e.target.closest && e.target.closest(".be-laytool"))) hideLayTool();
  };

  // ── react to the stage's edit-mode toggle ──
  const apply = (on) => {
    layOn = on;
    texts.forEach((el) => {
      if (on) el.setAttribute("contenteditable", "plaintext-only");
      else el.removeAttribute("contenteditable");
    });
    if (on) {
      root.addEventListener("mouseover", onLayMove);
    } else {
      root.removeEventListener("mouseover", onLayMove);
      hideLayTool();
      close();
    }
  };
  document.addEventListener("board:editmode", (e) => apply(e.detail.on));
  apply(false);
})();
