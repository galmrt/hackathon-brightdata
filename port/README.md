# Port setup

This directory is the version-controlled export point for Port config, per the repo layout in `CLAUDE.md` §2. As of this session, nothing here has been applied to a live Port workspace yet — `PORT_WEBHOOK_URL` in `.env` is still empty, so `services/probe-runner/src/port.ts` skips the webhook post and just warns (see `CLAUDE.md` status note). Everything below is prepared for import, not confirmed against a live workspace.

## What's here

- `blueprints/probe.json` — one entity per configured target (`probes/demo-app.assertions.json`).
- `blueprints/probe-run.json` — one entity per `services/probe-runner` execution. Matches the `PortProbeRunPayload` shape posted by `src/port.ts` (`ProbeRunSummary & { decision: DecisionResult }` from `src/decision.ts`).
- `blueprints/incident.json` — opened whenever a probe run's `decision != "healthy"`. Carries the human-approval state machine for both branches described in `CLAUDE.md` §1/§4 (`auto-heal-candidate` vs `escalate`).
- `webhook-mapping.json` — **draft, unverified**. Sketches the JQ entity-mapping Port's "Ingest Data → Webhook" integration expects, so the probe-runner payload lands as `watchtowerProbeRun` (and, when relevant, `watchtowerIncident`) entities. Written from the payload shape on our side, not confirmed against Port's actual accepted schema — expect to correct it once there's a live webhook data source to test against.

## To apply (manual, needs the Port workspace from the workshop)

1. In Port → **Builder**, create each blueprint in `blueprints/` (paste the JSON directly in the blueprint's JSON editor, or `PATCH /v1/blueprints` if using a `PORT_CLIENT_ID`/`PORT_CLIENT_SECRET`/API token — none of which exist in `.env` yet).
2. In Port → **Data sources → Ingest Data → Webhook**, create a webhook data source; Port will hand back the ingestion URL — that's what `PORT_WEBHOOK_URL` should be set to.
3. Configure that webhook's entity mapping using `webhook-mapping.json` as a starting point, then fix this file to match whatever Port actually accepted (mapping syntax details are easy to get subtly wrong without a live workspace to test against — don't trust this file blindly).
4. Set `PORT_WEBHOOK_URL` in `.env` and re-run `services/probe-runner` — no code changes needed, `src/port.ts` already posts the full decision payload.
5. Once real entities show up, re-export the (possibly-edited) blueprints from Port's Builder back into `blueprints/` so this directory stays the source of truth, per `CLAUDE.md` §2.

## Deliberately not built yet (Phase 4, per `CLAUDE.md` §5)

- The **Action** that lets a human approve/decline an auto-heal candidate in Port (drives the `open → auto_heal_pending_approval → auto_heal_approved/declined → resolved` status transitions on `watchtowerIncident`).
- The **Automation** that actually opens an incident from an ingested `watchtowerProbeRun` (today the webhook mapping in step 3 would create both entities directly on ingestion, which is a reasonable starting point, but a real automation step is where the agent-drafted repair description gets generated and attached).
