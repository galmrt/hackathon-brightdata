# Port setup

This directory is the version-controlled export point for Port config, per the repo layout in `CLAUDE.md` §2. **Confirmed working against the live Port workspace** — blueprints created, webhook data source wired, `PORT_WEBHOOK_URL` set in `.env`, and `services/probe-runner` has posted real runs for both the healthy path and an `auto-heal-candidate` incident path.

## What's here

- `blueprints/probe.json` — one entity per configured target (`probes/demo-app.assertions.json`). Not yet created in Port (optional — nothing currently relates to it).
- `blueprints/probe-run.json` — one entity per `services/probe-runner` execution. Matches the `PortProbeRunPayload` shape posted by `src/port.ts` (`ProbeRunSummary & { decision: DecisionResult }` from `src/decision.ts`). **Created in Port.**
- `blueprints/incident.json` — opened whenever a probe run's `decision != "healthy"`. Carries the human-approval state machine for both branches described in `CLAUDE.md` §1/§4 (`auto-heal-candidate` vs `escalate`). **Created in Port.**
- `actions/*.json` — the Phase 4 human-in-the-loop self-service actions on `watchtowerIncident` (see "Actions" below). **Created in Port and verified live** — Approve auto-heal and Resolve incident were both executed against real incidents during the Phase 5 rehearsal.
- `webhook-mapping.json` — the JQ entity-mapping array, **confirmed against the live webhook's "Test mapping" step**: a top-level array of `{ blueprint, operation, filter, entity: { identifier, title, properties, relations } }` objects (Port's actual schema — note this differs from the nested `integration.config.mappings` shape docs elsewhere imply; the mapping editor's own JSON skeleton is the source of truth). **Applied and saved in Port.**

## How it's wired up

1. Blueprints `watchtowerProbeRun` and `watchtowerIncident` were created via Port's Builder (paste JSON → Edit JSON → Save).
2. A webhook data source ("Watchtower probe runs") was created under Data sources; its ingestion URL (`https://ingest.port.io/<webhookKey>`) is `PORT_WEBHOOK_URL` in `.env`.
3. Its mapping is `webhook-mapping.json`'s content, pasted into the mapping step and tested against a sample `auto-heal-candidate` payload before saving.
4. `services/probe-runner`'s existing webhook post (`src/port.ts`) needed no code changes — it already posts the full decision payload; setting `PORT_WEBHOOK_URL` was the only change required.
5. Verified live twice: a healthy 3/3-pass run (creates only a `watchtowerProbeRun` entity, `watchtowerIncident`'s filter excludes it) and a deliberately-broken-assertion run with a fresh `deploy-state.json` timestamp (creates both a `watchtowerProbeRun` and a `watchtowerIncident` entity, `status: auto_heal_pending_approval`).

If blueprints get edited further in Port's Builder, re-export them back into `blueprints/` so this directory stays the source of truth, per `CLAUDE.md` §2.

## Actions (Phase 4 — defined in repo, created in Port, verified live)

Three self-service day-2 actions on `watchtowerIncident`, all using Port's built-in **Upsert Entity** backend (`invocationMethod.type: "UPSERT_ENTITY"`) so no runner/webhook backend is needed for the status transitions:

- `actions/approve-auto-heal.json` — visible only while `status = auto_heal_pending_approval`; sets `status → auto_heal_approved` and stamps `approvedBy` from the executing user's email. This is the human gate before anything is submitted to Bright Data's self-heal flow.
- `actions/decline-auto-heal.json` — same visibility condition; sets `status → auto_heal_declined`. Takes an optional `declineReason` input which is deliberately **not** mapped onto the entity — Port's action-run history records inputs, and that run log is the audit trail.
- `actions/resolve-incident.json` — visible on any non-resolved incident; sets `status → resolved` and `resolvedAt` from `{{ .trigger.at }}`. Used after re-verifying (probe re-run green) on the heal branch, or after fixing the outage on the escalate branch.

To create them: Port Builder → Self-service → new action → Edit JSON → paste each file → Save. If Port's editor rejects a field name (their action schema has drifted before — see the webhook-mapping note above), trust the editor's own JSON skeleton and adjust, then re-export back into `actions/` so this stays the source of truth.

The **repair description** is drafted by the probe-runner itself (`services/probe-runner/src/repair.ts`) on the `auto-heal-candidate` branch only, posted in the webhook payload as `repairDescription`, and mapped into the incident by `webhook-mapping.json`. The updated mapping (including the `repairDescription` line) has been re-pasted into the live webhook and verified — a real incident landed with the description fully populated, newlines intact.

Demo tip: day-2 action buttons live on the incident entity's **profile page** (or the row's `...` menu in Catalog), not prominently on the Self-service page.

## Deliberately not built yet

- The `watchtowerProbe` blueprint isn't created in Port yet — nothing currently needs the `probe` relation on `watchtowerProbeRun`/`watchtowerIncident` to resolve, so it was skipped for now.
