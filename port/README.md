# Port setup

This directory is the version-controlled export point for Port config, per the repo layout in `CLAUDE.md` §2. **Confirmed working against the live Port workspace** — blueprints created, webhook data source wired, `PORT_WEBHOOK_URL` set in `.env`, and `services/probe-runner` has posted real runs for both the healthy path and an `auto-heal-candidate` incident path.

## What's here

- `blueprints/probe.json` — one entity per configured target (`probes/demo-app.assertions.json`). Not yet created in Port (optional — nothing currently relates to it).
- `blueprints/probe-run.json` — one entity per `services/probe-runner` execution. Matches the `PortProbeRunPayload` shape posted by `src/port.ts` (`ProbeRunSummary & { decision: DecisionResult }` from `src/decision.ts`). **Created in Port.**
- `blueprints/incident.json` — opened whenever a probe run's `decision != "healthy"`. Carries the human-approval state machine for both branches described in `CLAUDE.md` §1/§4 (`auto-heal-candidate` vs `escalate`). **Created in Port.**
- `webhook-mapping.json` — the JQ entity-mapping array, **confirmed against the live webhook's "Test mapping" step**: a top-level array of `{ blueprint, operation, filter, entity: { identifier, title, properties, relations } }` objects (Port's actual schema — note this differs from the nested `integration.config.mappings` shape docs elsewhere imply; the mapping editor's own JSON skeleton is the source of truth). **Applied and saved in Port.**

## How it's wired up

1. Blueprints `watchtowerProbeRun` and `watchtowerIncident` were created via Port's Builder (paste JSON → Edit JSON → Save).
2. A webhook data source ("Watchtower probe runs") was created under Data sources; its ingestion URL (`https://ingest.port.io/<webhookKey>`) is `PORT_WEBHOOK_URL` in `.env`.
3. Its mapping is `webhook-mapping.json`'s content, pasted into the mapping step and tested against a sample `auto-heal-candidate` payload before saving.
4. `services/probe-runner`'s existing webhook post (`src/port.ts`) needed no code changes — it already posts the full decision payload; setting `PORT_WEBHOOK_URL` was the only change required.
5. Verified live twice: a healthy 3/3-pass run (creates only a `watchtowerProbeRun` entity, `watchtowerIncident`'s filter excludes it) and a deliberately-broken-assertion run with a fresh `deploy-state.json` timestamp (creates both a `watchtowerProbeRun` and a `watchtowerIncident` entity, `status: auto_heal_pending_approval`).

If blueprints get edited further in Port's Builder, re-export them back into `blueprints/` so this directory stays the source of truth, per `CLAUDE.md` §2.

## Deliberately not built yet (Phase 4, per `CLAUDE.md` §5)

- The **Action** that lets a human approve/decline an auto-heal candidate in Port (drives the `open → auto_heal_pending_approval → auto_heal_approved/declined → resolved` status transitions on `watchtowerIncident`).
- The **Automation** that generates the agent-drafted repair description and attaches it to the incident (today the webhook mapping creates the incident directly on ingestion with `repairDescription` left empty — a reasonable starting point, but the actual repair-prompt generation from decision reasons is still manual).
- The `watchtowerProbe` blueprint isn't created in Port yet — nothing currently needs the `probe` relation on `watchtowerProbeRun`/`watchtowerIncident` to resolve, so it was skipped for now.
