// preview.js — minimal previewable host for the design-board slice.
//   run: bun preview.js   →  http://localhost:4849
// Serves the bundle and applies edit patches to index.html on disk via
// HTMLRewriter, so a text/image edit round-trips into the source file. Under
// `agent-board web` this same patch contract is served by the real server,
// which writes into wireframes/<id>/ (git-versioned).
import { readdir } from "node:fs/promises";

const DIR = import.meta.dir;
const PORT = 4849;
const SAFE = /^[\w-]+$/; // screen / key are slugs; reject anything else.
const IMG = /\.(png|jpe?g|webp|gif|svg|avif)$/i;

Bun.serve({
  port: PORT,
  async fetch(req) {
    const u = new URL(req.url);

    if (req.method === "PUT" && u.pathname === "/__edit") {
      let p;
      try { p = await req.json(); } catch { return new Response("bad json", { status: 400 }); }
      const { screen, key, kind, value } = p || {};
      if (!SAFE.test(screen || "")) return new Response("bad patch", { status: 400 });
      const file = DIR + "/index.html";
      const html = await Bun.file(file).text();

      // Structural/layout edit: swap one screen's inner HTML (the client is the
      // DOM authority for reorder / gap / direction).
      if (kind === "layout") {
        const inner = p.html;
        if (typeof inner !== "string" || inner.length > 512 * 1024)
          return new Response("bad layout", { status: 400 });
        let hit = false;
        const out = new HTMLRewriter()
          .on(`[data-screen="${screen}"]`, {
            element(el) { hit = true; el.setInnerContent(inner, { html: true }); },
          })
          .transform(html);
        if (!hit) return new Response("screen not found", { status: 404 });
        await Bun.write(file, out);
        return new Response("ok");
      }

      if (!SAFE.test(key || "") || (kind !== "text" && kind !== "image"))
        return new Response("bad patch", { status: 400 });
      let hit = false;
      const out = new HTMLRewriter()
        .on(`[data-screen="${screen}"] [data-key="${key}"]`, {
          element(el) {
            hit = true;
            if (kind === "text") el.setInnerContent(String(value ?? ""));
            else el.setAttribute("style", value ? `--img:url("${String(value).replace(/"/g, "%22")}")` : "");
          },
        })
        .transform(html);
      if (!hit) return new Response("node not found", { status: 404 });
      await Bun.write(file, out);
      return new Response("ok");
    }

    // List the board's media — image files in assets/.
    if (req.method === "GET" && u.pathname === "/__assets") {
      const names = await readdir(DIR + "/assets").catch(() => []);
      return Response.json({ assets: names.filter((n) => IMG.test(n)).map((n) => "assets/" + n).sort() });
    }

    // Upload an image into assets/ (?name=<filename>), returns its relative path.
    if (req.method === "PUT" && u.pathname === "/__upload") {
      const raw = u.searchParams.get("name") || "image.png";
      const ext = (raw.match(/\.[a-z0-9]+$/i) || [""])[0].toLowerCase();
      if (!IMG.test(ext)) return new Response("bad type", { status: 400 });
      const base = raw.replace(/\.[a-z0-9]+$/i, "").replace(/[^a-zA-Z0-9_-]/g, "-").replace(/^-+|-+$/g, "") || "image";
      let name = base + ext;
      for (let i = 2; await Bun.file(DIR + "/assets/" + name).exists(); i++) name = base + "-" + i + ext;
      await Bun.write(DIR + "/assets/" + name, await req.arrayBuffer());
      return Response.json({ path: "assets/" + name });
    }

    const path = u.pathname === "/" ? "/index.html" : u.pathname;
    const f = Bun.file(DIR + path);
    if (!(await f.exists())) return new Response("not found", { status: 404 });
    return new Response(f);
  },
});
console.log("preview on http://localhost:" + PORT);
