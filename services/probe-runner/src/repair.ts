import type { ProbeRunSummary } from "./runProbe.js";
import type { DecisionResult } from "./decision.js";

// Drafts the natural-language problem description that Bright Data's
// self-heal flow takes as input (Scraper Studio doesn't auto-detect what
// changed — a human/agent describes it, BD generates a diff, a human
// approves; see CLAUDE.md §4). Only the auto-heal-candidate branch gets a
// description: drafting a "repair" for a real incident is exactly the
// failure mode this system exists to prevent.
export function draftRepairDescription(
  summary: ProbeRunSummary,
  decision: DecisionResult,
): string | null {
  if (decision.decision !== "auto-heal-candidate") {
    return null;
  }

  // All regions failed identically (that's what qualified this run as a
  // candidate), so any failing region describes the failure; use the first.
  const failingRegion = summary.results.find((r) => !r.allAssertionsPassed);
  const failedAssertions = failingRegion?.assertions.filter((a) => !a.passed) ?? [];

  const lines: string[] = [
    `The page at ${summary.targetUrl} shipped a frontend change ` +
      (decision.signals.minutesSinceDeploy !== null
        ? `about ${decision.signals.minutesSinceDeploy.toFixed(0)} minutes ago, `
        : "recently, ") +
      `and ${failedAssertions.length} of the scraper's structural checks now fail identically in all ${summary.regionsTotal} regions (the page itself returns HTTP ${failingRegion?.httpStatus ?? "?"}).`,
    "",
    "What broke, per element:",
    ...failedAssertions.map(
      (a) =>
        `- [data-testid="${a.testId}"] (${a.description}): ${a.reason}`,
    ),
    "",
    "Please update the scraper's selectors/extraction logic to match the page's new structure. " +
      "The elements' data-testid attributes and their semantic roles (hero heading, product card, price, buy button, buy status) are the stable contract — " +
      "re-locate each element by its role and current markup, and adjust any text/format expectations to what the page now renders. " +
      "Do not change what data is extracted, only how it is located.",
  ];

  return lines.join("\n");
}
