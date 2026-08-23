import { readFileSync } from "node:fs";
import { repoRoot } from "./config.js";

export interface DeployState {
  lastDeployAt: string;
  note?: string;
}

// deploy-state.json is written by apps/demo-app/scripts/record-deploy.mjs
// after every `npm run deploy` (which runs `vercel --prod`). It's the only
// signal decision.ts has for "was there a recent frontend change" — see
// CLAUDE.md §1 for why that matters for false-positive-vs-incident scoring.
export function loadDeployState(): DeployState | null {
  try {
    const raw = readFileSync(`${repoRoot}/deploy-state.json`, "utf-8");
    return JSON.parse(raw) as DeployState;
  } catch {
    return null;
  }
}
