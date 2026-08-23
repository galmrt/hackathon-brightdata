import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import { request } from "undici";
import { loadAssertionSuite, loadRegions, repoRoot } from "./config.js";
import type { AssertionDef, AssertionSuite, Region } from "./config.js";
import { runAssertions } from "./assertions.js";
import type { AssertionResult } from "./assertions.js";
import { proxyAgentForRegion } from "./proxy.js";
import { FAULT_ENV_VAR, faultTargetRegionId } from "./fault.js";

// Repair executor — run manually right after a human clicks "Approve auto-heal"
// on the incident in Port (Port only has our ingest webhook, not the other way
// around, so the trigger is a CLI invocation; that also keeps the human in the
// loop). Our probes are our own assertion engine, so the artifact that actually
// breaks on cosmetic drift is probes/demo-app.assertions.json — this heals
// *that*: re-derives each failing expectation from the page's current reality,
// shows an old→new diff (mirroring Bright Data's review-the-diff beat), writes
// the file, and re-verifies green.
//
// Safety gate, same reasoning as decision.ts: healing only proceeds if the
// failure is still unanimous across ALL regions at heal time. Any partial
// disagreement means this might be a real regional incident — abort loudly and
// never touch the assertions.

const ASSERTIONS_FILE = path.join(repoRoot, "probes", "demo-app.assertions.json");

interface RegionCheck {
  region: Region;
  html: string;
  results: AssertionResult[];
}

async function fetchRegion(region: Region, targetUrl: string): Promise<string> {
  const dispatcher = proxyAgentForRegion(region);
  const response = await request(targetUrl, { dispatcher });
  if (response.statusCode !== 200) {
    throw new Error(`HTTP ${response.statusCode} from ${region.id}`);
  }
  return response.body.text();
}

async function checkAllRegions(
  regions: Region[],
  suite: AssertionSuite,
): Promise<RegionCheck[]> {
  return Promise.all(
    regions.map(async (region) => {
      const html = await fetchRegion(region, suite.targetUrl);
      return { region, html, results: runAssertions(html, suite.assertions) };
    }),
  );
}

function failedIds(check: RegionCheck): string[] {
  return check.results
    .filter((r) => !r.passed)
    .map((r) => r.id)
    .sort();
}

function abort(message: string): never {
  console.error(`[heal] ABORT: ${message}`);
  console.error("[heal] No changes were made to the assertion suite.");
  process.exit(1);
}

// Strings that are render/serialization bugs, not copy. A global JS failure
// (e.g. a component rendering "[object Object]") fails unanimously across all
// regions AND correlates with the buggy deploy itself, so it sails through
// every drift signal in decision.ts — the derivation step is the last
// automated gate before a human sees the diff. Adopting one of these would
// codify the bug into the monitor, so derivation hard-aborts instead.
const ERROR_ARTIFACT_PATTERNS: RegExp[] = [
  /\[object [A-Za-z]+\]/, // default Object toString: "[object Object]"
  /\bundefined\b/i,
  /\bnull\b/i,
  /\bNaN\b/, // exact case — distinctive, avoids names like "Nan"
  /^[A-Za-z.]*(Error|Exception)\b/, // "TypeError: x is not a function"
  /\{\{[^}]+\}\}/, // unrendered {{mustache}} placeholder
  /\$\{[^}]+\}/, // unrendered ${template} literal
];

function errorArtifactIn(text: string): string | null {
  for (const pattern of ERROR_ARTIFACT_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

// Generalize the element's current literal text into an anchored pattern:
// escape regex metacharacters, then let any digit run vary. "$24.99" becomes
// ^\$\d+\.\d+$ — same shape the page renders now, tolerant of future price
// changes, and readable in the diff.
function derivePatternFromText(text: string): string {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `^${escaped.replace(/\d+/g, "\\d+")}$`;
}

interface HealedChange {
  assertion: AssertionDef;
  field: "expectedTextIncludesAny" | "expectedPattern";
  oldValue: string;
  newValue: string;
  currentText: string;
}

function deriveFix(assertion: AssertionDef, html: string): HealedChange {
  // Re-read the element's current reality straight from the fetched HTML.
  const $ = cheerio.load(html);
  const el = $(`[data-testid="${assertion.testId}"]`);

  if (el.length === 0) {
    abort(
      `[data-testid="${assertion.testId}"] is missing from the page entirely. ` +
        "A vanished element is structural breakage, not re-derivable drift — a human needs to look at this.",
    );
  }
  const currentText = el.first().text().trim();

  const artifact = errorArtifactIn(currentText);
  if (artifact) {
    abort(
      `[data-testid="${assertion.testId}"] currently renders "${currentText}" — "${artifact}" ` +
        "looks like a render/serialization bug shipped to production, not intentional copy. " +
        "Refusing to adopt it as the new expectation; this needs a human, not a heal.",
    );
  }

  switch (assertion.kind) {
    case "text-contains-any": {
      if (currentText === "") {
        abort(
          `[data-testid="${assertion.testId}"] exists but its text is empty — refusing to "heal" an expectation down to nothing.`,
        );
      }
      return {
        assertion,
        field: "expectedTextIncludesAny",
        oldValue: JSON.stringify(assertion.expectedTextIncludesAny ?? []),
        newValue: JSON.stringify([currentText]),
        currentText,
      };
    }
    case "text-matches": {
      if (currentText === "") {
        abort(
          `[data-testid="${assertion.testId}"] exists but its text is empty — refusing to derive a pattern from nothing.`,
        );
      }
      return {
        assertion,
        field: "expectedPattern",
        oldValue: assertion.expectedPattern ?? "",
        newValue: derivePatternFromText(currentText),
        currentText,
      };
    }
    case "exists":
      // Unreachable when the element was found above, but keep the guard.
      abort(
        `assertion "${assertion.id}" is an existence check that failed — nothing to re-derive.`,
      );
      break;
    default:
      abort(`assertion "${assertion.id}" has unknown kind "${assertion.kind}".`);
  }
}

async function main() {
  if (faultTargetRegionId()) {
    abort(
      `the ${FAULT_ENV_VAR} fault-injection lever is active (=${faultTargetRegionId()}). ` +
        "Healing while a simulated fault is live would be healing fiction — unset it first.",
    );
  }

  const regions = loadRegions();
  const suite = loadAssertionSuite();

  console.log(`[heal] re-checking ${suite.targetUrl} from ${regions.length} region(s) before touching anything...`);

  const checks = await checkAllRegions(regions, suite).catch((error) =>
    abort(`could not re-fetch the page from every region (${error instanceof Error ? error.message : error}) — healing requires a full, current picture.`),
  );

  const failing = checks.filter((c) => failedIds(c).length > 0);

  if (failing.length === 0) {
    console.log("[heal] all regions pass all assertions — nothing to heal. Exiting without changes.");
    return;
  }

  // Safety gate 1: unanimity. Partial failure = possible real regional
  // incident; that path must never be "healed".
  if (failing.length !== checks.length) {
    abort(
      `only ${failing.length}/${checks.length} region(s) are failing right now. ` +
        "Partial cross-region disagreement looks like a real incident, not cosmetic drift — escalate to a human instead.",
    );
  }

  // Safety gate 2: the regions must be failing on the *same* assertions.
  const referenceIds = failedIds(checks[0]);
  for (const check of checks) {
    const ids = failedIds(check);
    if (ids.join(",") !== referenceIds.join(",")) {
      abort(
        `regions disagree on WHICH assertions fail (${checks[0].region.id}: [${referenceIds}] vs ${check.region.id}: [${ids}]) — not a uniform cosmetic change, refusing to heal.`,
      );
    }
  }

  console.log(
    `[heal] failure is unanimous: all ${checks.length} regions fail the same ${referenceIds.length} assertion(s) [${referenceIds.join(", ")}] — safe to re-derive expectations.`,
  );

  // Re-derive each failing expectation from the page as it renders right now.
  const reference = checks[0];
  const changes: HealedChange[] = referenceIds.map((id) => {
    const assertion = suite.assertions.find((a) => a.id === id)!;
    return deriveFix(assertion, reference.html);
  });

  console.log("\n[heal] proposed assertion changes (old → new):\n");
  for (const change of changes) {
    console.log(`  ${change.assertion.id} [data-testid="${change.assertion.testId}"]`);
    console.log(`    page now renders: "${change.currentText}"`);
    console.log(`    - ${change.field}: ${change.oldValue}`);
    console.log(`    + ${change.field}: ${change.newValue}\n`);
  }

  // Write back via the RAW file, not the loaded suite — loadAssertionSuite()
  // substitutes the real URL into targetUrl, and the "DEMO_APP_URL"
  // placeholder must survive in the committed file.
  const rawSuite = JSON.parse(readFileSync(ASSERTIONS_FILE, "utf-8")) as AssertionSuite;
  for (const change of changes) {
    const target = rawSuite.assertions.find((a) => a.id === change.assertion.id)!;
    if (change.field === "expectedTextIncludesAny") {
      target.expectedTextIncludesAny = JSON.parse(change.newValue) as string[];
    } else {
      target.expectedPattern = change.newValue;
    }
  }
  writeFileSync(ASSERTIONS_FILE, JSON.stringify(rawSuite, null, 2) + "\n");
  console.log(`[heal] wrote ${changes.length} updated assertion(s) to ${path.relative(repoRoot, ASSERTIONS_FILE)}`);

  // Re-verify: fresh fetch, updated suite, expect green everywhere.
  console.log("[heal] re-verifying with the healed assertions...");
  const healedSuite = loadAssertionSuite();
  const verify = await checkAllRegions(regions, healedSuite).catch((error) =>
    abort(`verification re-fetch failed (${error instanceof Error ? error.message : error}) — assertions file WAS updated; re-run the probe suite manually.`),
  );

  const stillFailing = verify.filter((c) => failedIds(c).length > 0);
  if (stillFailing.length > 0) {
    for (const check of stillFailing) {
      for (const r of check.results.filter((x) => !x.passed)) {
        console.error(`[heal]   still failing in ${check.region.id}: ${r.id} — ${r.reason}`);
      }
    }
    abort("healed assertions still fail — the page may be changing under us. Assertions file WAS updated; review the diff with `git diff probes/`.");
  }

  for (const check of verify) {
    console.log(`[heal] PASS ${check.region.id} — ${check.results.length}/${check.results.length} assertions passed`);
  }
  console.log("\n[heal] ✅ heal verified green in all regions.");
  console.log("[heal] next steps:");
  console.log("[heal]   1. `npm run dev` — record a healthy probe run in Port (and its OTel trace)");
  console.log("[heal]   2. click 'Resolve incident' on the incident in Port");
  console.log("[heal]   3. commit the updated probes/demo-app.assertions.json");
}

main().catch((error) => {
  console.error("[heal] fatal error:", error);
  process.exitCode = 1;
});
