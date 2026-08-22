import type { ProbeRunSummary } from "./runProbe.js";
import type { DeployState } from "./deployState.js";

export type Decision = "healthy" | "auto-heal-candidate" | "escalate";

export interface DecisionResult {
  decision: Decision;
  // Confidence (0..1) that a failure is cosmetic drift rather than a real
  // incident. Only meaningful when decision !== "healthy".
  confidence: number;
  reasons: string[];
  signals: {
    regionAgreement: number;
    allRegionsFailedTogether: boolean;
    recentDeploy: boolean;
    minutesSinceDeploy: number | null;
  };
}

// How fresh a deploy has to be to count as "correlated" with a failure.
const DEPLOY_RECENCY_THRESHOLD_MINUTES = 30;
// Both cross-region agreement AND deploy recency must hold to clear this —
// see CLAUDE.md §1: "all regions fail together + a recent deploy" is the
// only case that should ever auto-heal.
const AUTO_HEAL_CONFIDENCE_THRESHOLD = 0.9;

// Simple, explainable scoring function — see CLAUDE.md §3 ("Decision logic").
// Deliberately not a black box: every branch appends a human-readable reason
// so Port/SigNoz can show *why* a run was classified the way it was.
export function decide(
  summary: ProbeRunSummary,
  deployState: DeployState | null,
): DecisionResult {
  const reasons: string[] = [];
  const minutesSinceDeploy = deployState
    ? (Date.now() - Date.parse(deployState.lastDeployAt)) / 60_000
    : null;
  const recentDeploy =
    minutesSinceDeploy !== null && minutesSinceDeploy <= DEPLOY_RECENCY_THRESHOLD_MINUTES;
  const allRegionsFailedTogether = summary.regionAgreement === 0;

  if (summary.regionAgreement === 1) {
    return {
      decision: "healthy",
      confidence: 1,
      reasons: ["all regions passed all assertions"],
      signals: { regionAgreement: summary.regionAgreement, allRegionsFailedTogether: false, recentDeploy, minutesSinceDeploy },
    };
  }

  if (!allRegionsFailedTogether) {
    reasons.push(
      `only ${summary.regionsTotal - summary.regionsPassed}/${summary.regionsTotal} region(s) failed — ` +
        "cross-region disagreement rules out a global cosmetic change, this looks like a real regional incident",
    );
    return {
      decision: "escalate",
      confidence: 0,
      reasons,
      signals: { regionAgreement: summary.regionAgreement, allRegionsFailedTogether, recentDeploy, minutesSinceDeploy },
    };
  }

  reasons.push(
    "all regions failed together — consistent with a global frontend change, not a regional network/infra issue",
  );

  let confidence = 0.6;
  if (recentDeploy) {
    confidence = 0.95;
    reasons.push(
      `deploy detected ${minutesSinceDeploy!.toFixed(1)} min ago (within the ${DEPLOY_RECENCY_THRESHOLD_MINUTES}min correlation window) — strong correlation with a frontend change`,
    );
  } else {
    reasons.push(
      minutesSinceDeploy === null
        ? "no deploy timestamp on record — can't correlate this failure with a known change"
        : `last deploy was ${minutesSinceDeploy.toFixed(1)} min ago, outside the ${DEPLOY_RECENCY_THRESHOLD_MINUTES}min correlation window`,
    );
  }

  const decision: Decision =
    confidence >= AUTO_HEAL_CONFIDENCE_THRESHOLD ? "auto-heal-candidate" : "escalate";

  if (decision === "escalate") {
    reasons.push(
      "cross-region agreement alone isn't enough without a correlated deploy — escalating rather than risking a silent auto-heal of a real incident",
    );
  }

  return {
    decision,
    confidence,
    reasons,
    signals: { regionAgreement: summary.regionAgreement, allRegionsFailedTogether, recentDeploy, minutesSinceDeploy },
  };
}
