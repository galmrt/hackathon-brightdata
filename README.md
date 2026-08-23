# Watchtower — Self-Healing Global Probe Network

*Built in one day for the "Zero Downtime" hackathon (Port + Bright Data + SigNoz).*

Synthetic monitoring that probes a demo app from multiple regions through **Bright Data's proxy network** — and can tell apart two failures that look identical to a naive health check:

| | Cosmetic drift | Real incident |
|---|---|---|
| **Signal** | All regions fail the **same** assertions, right after a deploy | Regions **disagree**, or no recent deploy |
| **Response** | Draft a repair → human approves in **Port** → self-heal assertions → re-verify | Escalate immediately. **Refuse** to auto-heal |

That disambiguation is the deliverable: a monitor that silently "heals" itself to match broken content is worse than no monitoring at all.

## How it decides

Simple, explainable scoring (`services/probe-runner/src/decision.ts`): cross-region agreement on the same failures → 0.6 confidence it's drift; a frontend deploy inside the correlation window (recorded by `npm run deploy`) → 0.95. Only ≥ 0.9 becomes an `auto-heal-candidate`; any partial region disagreement hard-escalates regardless.

Even then, nothing auto-executes. A human clicks **Approve auto-heal** in Port, then `npm run heal`:
re-verifies failures are **unanimous** across all regions → re-derives each expectation from the live page → aborts on structural breakage or render-bug artifacts (`[object Object]`, unrendered templates…) → shows an old→new diff → heals `probes/demo-app.assertions.json` → re-verifies green.

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

1. **Drift**: ship a cosmetic change (`npm run deploy`) → all regions fail together → `auto-heal-candidate` 95% → Approve in Port → heal → green → Resolve. ✅ self-healed
2. **Incident**: `WATCHTOWER_BREAK_REGION=ap-south npm run dev` breaks one region's fetched HTML → 1/3 fails → `escalate` 0%, no repair drafted, heal refuses to run. 🚨 paged instead

Both acts rehearsed end to end against live services. The fault lever is an honest demo device — the proxy zone is currently single-country (`nl` only), so a real per-region failure can't be produced naturally; the lever exercises the same decision path and is loudly labeled on the span.

## Sponsor tech, honestly

- **Bright Data**: every fetch goes through a real Datacenter zone with per-country routing — it collapses "build a global probe fleet" into one username parameter. The drafted repair description is shaped for BD's (human-gated) self-heal flow, but since our probes are our own assertion engine, our own code executes the heal.
- **Port**: system of record + human gate. Incidents carry the repair description; Approve/Decline/Resolve action history is the audit trail. Port deliberately holds no credentials to call back into the runner.
- **SigNoz/OTel**: one span per region per assertion; SigNoz cloud ingestion errored on hackathon day, so the exporter falls back to console output until an endpoint is set.
