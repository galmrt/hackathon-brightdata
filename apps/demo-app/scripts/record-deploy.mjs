#!/usr/bin/env node
// Writes deploy-state.json at the repo root with the current timestamp.
// Run this right after `vercel --prod` so probe-runner's deploy-recency
// signal (see services/probe-runner/src/decision.ts) reflects reality —
// it's the "recent frontend deploy" half of the false-positive-vs-incident scoring
// described in CLAUDE.md §1.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const note = process.argv.slice(2).join(" ") || null;

const state = {
  lastDeployAt: new Date().toISOString(),
  ...(note ? { note } : {}),
};

writeFileSync(
  path.join(repoRoot, "deploy-state.json"),
  JSON.stringify(state, null, 2) + "\n",
);

console.log(`[record-deploy] wrote deploy-state.json: lastDeployAt=${state.lastDeployAt}`);
