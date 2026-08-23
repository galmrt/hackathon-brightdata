// Zero-dependency static server for the Watchtower control room.
// Run: node server.mjs  →  http://localhost:4173
// Serves index.html plus data/runs.json (written by services/probe-runner
// after every run) with caching disabled so the page's poll always sees the
// latest run.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.DASHBOARD_PORT || 4173;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const relative = urlPath === "/" ? "index.html" : urlPath.slice(1);
  const filePath = path.join(root, relative);
  if (!filePath.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      "content-type": TYPES[path.extname(filePath)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    // data/runs.json legitimately doesn't exist before the first probe run —
    // the page treats 404 as "no runs yet".
    res.writeHead(404, { "content-type": "application/json" }).end("null");
  }
}).listen(PORT, () => {
  console.log(`[dashboard] control room at http://localhost:${PORT}`);
});
