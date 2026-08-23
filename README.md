# Watchtower — Self-Healing Global Probe Network

*Built in one day for the "Zero Downtime" hackathon (Port + Bright Data + SigNoz).*

Synthetic monitoring that probes a demo app from multiple regions through **Bright Data's proxy network** — and can tell apart two failures that look identical to a naive health check:

| | Stale assertions (false positive) | Real incident |
|---|---|---|
| **Signal** | All regions fail the **same** assertions, right after a deploy | Regions **disagree**, or no recent deploy |
| **Response** | Draft a repair → human approves in **Port** → self-heal assertions → re-verify | Escalate immediately. **Refuse** to auto-heal |

**The problem**: when a production check fails, something must decide whether the *monitor* went stale or the *app* broke — the two cases are identical to the check itself, and today that triage is a human's job. Guess wrong one way and false alarms erode trust in the pager; guess wrong the other way and you "fix" the check to match a broken page — a monitor that certifies outages as healthy is worse than no monitoring at all. Watchtower automates the triage and gates self-repair on it. That decision is the deliverable, not the healing.

## How it decides

Simple, explainable scoring (`services/probe-runner/src/decision.ts`): cross-region agreement on the same failures → 0.6 confidence it's a false positive; a frontend deploy inside the correlation window (recorded by `npm run deploy`) → 0.95. Only ≥ 0.9 becomes an `auto-heal-candidate`; any partial region disagreement hard-escalates regardless.

Even then, nothing auto-executes. A human clicks **Approve auto-heal** in Port, then `npm run heal`:
re-verifies failures are **unanimous** across all regions → re-derives each expectation from the live page → aborts on structural breakage or render-bug artifacts (`[object Object]`, unrendered templates…) → shows an old→new diff → heals `probes/demo-app.assertions.json` → re-verifies green.

## What's automated — and what deliberately isn't

**Automated**: multi-region fetch through Bright Data's proxy; structural assertions; OTel spans; Port ingestion; the triage decision itself (agreement + deploy-recency scoring, with human-readable reasons); incident creation; drafting the repair description; and the repair once triggered — re-fetch all regions, unanimity gates, re-derive expectations from the live page, diff, write, re-verify. No human ever edits an expectation by hand.

**Human by design**: clicking **Approve auto-heal** in Port (the system proposes, never applies unapproved); triggering `npm run heal` after approval (Port holds no credentials to call the runner — in production this is one webhook from the Port action to a heal service); clicking **Resolve incident**; committing the healed file (git is the audit trail); responding to escalations.

**Not claimed**: probe runs are triggered on demand in the demo, not cron-scheduled (the runner is schedule-ready). Heal fixes the monitor's expectations (`probes/demo-app.assertions.json`), never application code — a real incident always gets a human. Bright Data's own self-heal is likewise human-gated (describe → generated diff → review → save); we mirror that shape, not exceed it.

## Flow

```
demo app (Vercel) ◄── fetched per region via Bright Data proxy
                          │
                   probe-runner: assert → score → OTel spans
                          │
        ┌─────────────────┴─────────────────┐
  control room (local,              Port: ProbeRun + Incident
  read-only, localhost:4173)        entities, human Approve/Resolve
                                            │
                                     npm run heal (human-triggered)
```

## Repo layout

```
apps/demo-app/          # tiny public app we probe (Vercel, stable data-testid hooks)
apps/dashboard/         # local read-only control room (npm run ui)
probes/                 # regions + structural assertions (the artifact that heals)
services/probe-runner/  # probe execution, scoring, repair drafting, healer
port/                   # Port blueprints, webhook mapping, actions (see port/README.md)
```

## Running it

```bash
cp .env.example .env            # Bright Data zone creds + Port webhook (documented inline)
cd services/probe-runner && npm install
npm run dev                     # one probe run: fetch → assert → score → dashboard + Port
npm run ui                      # control room at http://localhost:4173
npm run heal                    # only after Approve auto-heal in Port
```

## The two-act demo

1. **Stale assertions**: ship a frontend redesign (`npm run deploy`) → all regions fail together → `auto-heal-candidate` 95% → Approve in Port → heal → green → Resolve. ✅ self-healed
2. **Incident**: `WATCHTOWER_BREAK_REGION=ap-south npm run dev` breaks one region's fetched HTML → 1/3 fails → `escalate` 0%, no repair drafted, heal refuses to run. 🚨 paged instead

Both acts rehearsed end to end against live services. The fault lever is an honest demo device — the proxy zone is currently single-country (`nl` only), so a real per-region failure can't be produced naturally; the lever exercises the same decision path and is loudly labeled on the span.

## Sponsor tech, honestly

- **Bright Data**: every fetch goes through a real Datacenter zone with per-country routing — it collapses "build a global probe fleet" into one username parameter. The drafted repair description is shaped for BD's (human-gated) self-heal flow, but since our probes are our own assertion engine, our own code executes the heal.
- **Port**: system of record + human gate. Incidents carry the repair description; Approve/Decline/Resolve action history is the audit trail. Port deliberately holds no credentials to call back into the runner.
- **SigNoz/OTel**: one span per region per assertion; SigNoz cloud ingestion errored on hackathon day, so the exporter falls back to console output until an endpoint is set.
