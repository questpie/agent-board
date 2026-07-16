// board-stage — content-agnostic chrome shell. It owns NO content: it parses
// the static HTML inside the board root ([data-board]) and attaches logic — the
// Edit toggle, artboard captions, canvas chrome. Reusable across any board; the
// HTML is the data, this is just the smart parser + logic around it.
(() => {
  const root = document.querySelector("[data-board]") || document.body;

  // Toolbar (global chrome).
  const bar = document.createElement("div");
  bar.className = "be-chrome";
  bar.style.cssText =
    "position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999;" +
    "display:flex;gap:8px;align-items:center;background:#1c1b19;color:#fff;" +
    "padding:6px;border-radius:999px;font:13px/1 -apple-system,sans-serif;" +
    "box-shadow:0 6px 20px rgba(0,0,0,.25)";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.style.cssText =
    "appearance:none;border:0;color:inherit;font:inherit;padding:6px 14px;" +
    "border-radius:999px;cursor:pointer";

  let on = false;
  const paint = () => {
    toggle.textContent = on ? "✓ Editing" : "Edit";
    toggle.style.background = on ? "#d97757" : "transparent";
  };
  toggle.addEventListener("click", () => {
    on = !on;
    root.toggleAttribute("data-edit-on", on); // scoped to the board root
    paint();
    document.dispatchEvent(new CustomEvent("board:editmode", { detail: { on } }));
  });

  paint();
  bar.appendChild(toggle);
  document.body.appendChild(bar);

  // Artboard captions — wrap each screen within the root so a multi-screen board
  // reads like a canvas of named frames. Runtime-only chrome; source stays clean.
  const capStyle = document.createElement("style");
  capStyle.textContent =
    ".be-artboard{display:flex;flex-direction:column;gap:10px;align-items:flex-start}" +
    ".be-cap{font:12px ui-monospace,Menlo,monospace;color:var(--color-muted,#6b6760);padding-left:2px}";
  document.head.appendChild(capStyle);
  for (const screen of root.querySelectorAll(".screen[data-screen]")) {
    const art = document.createElement("div");
    art.className = "be-artboard be-chrome";
    const label = document.createElement("div");
    label.className = "be-cap";
    label.textContent = screen.dataset.title || screen.dataset.screen;
    screen.parentNode.insertBefore(art, screen);
    art.appendChild(label);
    art.appendChild(screen);
  }

  // Minimal public surface the editor reads (edit state + the parsed root).
  window.boardStage = { get editing() { return on; }, root };
})();
