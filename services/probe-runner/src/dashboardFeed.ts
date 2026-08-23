import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "./config.js";
import type { PortProbeRunPayload } from "./port.js";

// The local control-room dashboard (apps/dashboard) polls this file — it's a
// read-only mirror of exactly what we post to Port, so the demo can show the
// decision logic without squinting at terminal scrollback. Approve/Resolve
// stay in Port; this page only observes.
const FEED_PATH = path.join(repoRoot, "apps", "dashboard", "data", "runs.json");
const MAX_RUNS_KEPT = 50;

export function writeDashboardFeed(payload: PortProbeRunPayload): void {
  let previous: PortProbeRunPayload[] = [];
  try {
    const parsed = JSON.parse(readFileSync(FEED_PATH, "utf-8"));
    if (Array.isArray(parsed)) previous = parsed;
  } catch {
    // First run or unreadable feed — start fresh.
  }

  const runs = [payload, ...previous].slice(0, MAX_RUNS_KEPT);
  mkdirSync(path.dirname(FEED_PATH), { recursive: true });
  writeFileSync(FEED_PATH, JSON.stringify(runs, null, 2));
  console.log(`[dashboard] run recorded in ${path.relative(repoRoot, FEED_PATH)}`);
}
