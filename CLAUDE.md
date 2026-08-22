# Watchtower — Self-Healing Global Probe Network

*Working title, rename freely. Built for the "Zero Downtime" hackathon (Port + Bright Data Scraper Studio + SigNoz).*

This file is the project's rules file. Claude Code (and any other coding assistant) should read this before doing any work in this repo and follow the conventions below automatically — including reusing the Bright Data scraper settings rather than re-deriving them each session.

## 1. What we're building

A synthetic-monitoring system that watches our own small demo app from multiple geographic regions using Bright Data as the probe network, and — critically — can tell apart two failure modes that look identical from a naive health check:

1. **Cosmetic drift**: the frontend shipped a redesign, a selector/assertion is now stale, but the app is fine. This should self-heal, with a human approving the fix before it goes to production.
2. **Real incident**: the app is actually broken for users in some or all regions. This should page a human immediately and must NOT be auto-"fixed" — silently healing a broken assertion to match broken content is worse than no monitoring at all.

The whole point of the build is the disambiguation logic between these two cases, using cross-region agreement + deploy-time correlation as the primary signals. See `/docs/architecture.md` (to be created) for the full writeup; the short version:

- All regions fail together + a recent frontend deploy → high confidence "drift" → auto-repair path (agent proposes fix via Bright Data Self-Healing, human approves in Port, re-verify, close incident).
- One region fails while others pass, or no recent deploy → low confidence "drift" → escalate immediately as a real incident, do not attempt auto-heal.

The demo has two acts: (1) ship a visible cosmetic change to the demo app, watch the system correctly auto-heal; (2) simulate a single-region failure, watch the system correctly refuse to auto-heal and page instead. Both acts matter — only showing act 1 is indistinguishable from every other "self-healing scraper" demo at this hackathon.

## 2. Planned repo layout

```
/apps/demo-app/            # tiny public-facing app we probe against (needs to be deployed publicly — Bright Data's proxies can't reach localhost)
/probes/                   # Bright Data Scraper Studio probe definitions, one per target/region config
/services/probe-runner/    # Node/TS script: runs probes on a schedule, computes region-agreement + deploy-correlation signals, emits OpenTelemetry traces
/port/                     # Port blueprints + workflow definitions (export from Port AI Builder, keep version-controlled)
/observability/            # OTel collector config, SigNoz dashboard JSON exports
/docs/                     # architecture notes, demo script, decision log
.env.example                # documents required env vars (never commit the real .env)
```

Status: `/apps/demo-app` and `.env.example` exist (Phase 1 done). `/probes` and `/services/probe-runner` are built, typecheck clean, and **verified end-to-end against live services** (Phase 2 done except SigNoz/Port — see §5): probe definitions for 3 regions (currently all routed through `country=nl`, see §4), structural assertions for the demo app's 5 `data-testid` elements, a runner that fetches through Bright Data's real proxy per region, runs the assertions, emits OTel spans, and posts to Port's webhook. Confirmed both the pass path (3/3 regions, 5/5 assertions, real HTTP through Bright Data) and the fail path (deliberately broken assertion → all regions FAIL, region agreement 0%, exit code 1). **SigNoz is deliberately deferred** — cloud setup hit a server error; self-hosting via Docker is the likely path but not yet done. This isn't a blocker: `services/probe-runner/src/otel.ts` already falls back to `ConsoleSpanExporter` when `SIGNOZ_ENDPOINT` is unset, and `services/probe-runner/src/port.ts` already skips-and-warns when `PORT_WEBHOOK_URL` is unset — both were built with this fallback from the start, so plugging in real SigNoz/Port values later needs no code changes. `/observability`, `/docs` still to be built per the plan in §5.

**Phase 3 done and verified live** (except the human-approval Action, which is Phase 4): `services/probe-runner/src/decision.ts` implements the region-agreement + deploy-recency scoring function from §1/§3 — cross-region agreement alone gives 0.6 confidence, a correlated deploy (via `deploy-state.json` at repo root, written by `apps/demo-app/scripts/record-deploy.mjs` after every `npm run deploy`) pushes it to 0.95, and only ≥0.9 clears the `auto-heal-candidate` threshold; any partial region disagreement hard-escalates regardless of deploy recency. `src/index.ts` logs the decision + reasons and includes it in the Port payload (`ProbeRunSummary & { decision: DecisionResult }`); exit code reflects `decision !== "healthy"`. **Port is live**: `watchtowerProbeRun` and `watchtowerIncident` blueprints created in Port's Builder from `/port/blueprints/*.json`, a webhook data source ("Watchtower probe runs") wired up with the mapping in `/port/webhook-mapping.json` (confirmed against Port's actual mapping-editor schema — a top-level array of `{blueprint, operation, filter, entity}`, corrected from an earlier guess), and `PORT_WEBHOOK_URL` set in `.env`. `services/probe-runner` posted twice against the real webhook with no error on our side: a healthy 3/3-pass run and a deliberately-broken-assertion run with a fresh deploy timestamp (`decision: auto-heal-candidate`, confidence 95%) — see `/port/README.md` for the mapping details.

**OPEN ISSUE, unresolved — pick this up first next session**: despite both posts succeeding (no `[port]` warning, no fatal error, correct exit codes), the user could not find any entities under either "Probe Runs" or "Probes" in Port's UI. "Probes" is expected to be empty (`watchtowerProbe` blueprint was deliberately never created, see `/port/README.md`) — but "Probe Runs" (`watchtowerProbeRun`) being empty is *not* expected and wasn't diagnosed. Working theory, untested: the webhook mapping shown as saved during setup may not actually be attached the same way real inbound webhook calls are processed (vs. the "Test mapping" dry-run, which did resolve entities correctly against a hand-crafted sample payload) — or the entities exist but the user was looking at the wrong catalog view (new blueprints don't automatically get a sidebar/catalog page in Port; entities may only be visible via the Builder page's entity count on the blueprint tile, or via search). Troubleshooting was interrupted mid-way by a Chrome-automation outage (tool-safety classifier repeatedly returned "claude-sonnet-5 is temporarily unavailable" on every `navigate` call) before either theory could be checked live. **Next step**: check the `watchtowerProbeRun` blueprint tile on Port's Builder page for an entity count, and separately check the webhook data source's delivery/event log for the 2 real POSTs from probe-runner — confirm whether they show success or a silent mapping error. **Still to build (Phase 4)**: the Port Action for a human to approve/decline an auto-heal candidate, and the automation step that generates the agent-drafted repair description.

## 3. Tech stack & conventions

- **Language**: TypeScript/Node.js everywhere (demo app, probe runner, decision logic) for consistency with Bright Data's CLI and the OpenTelemetry JS SDK.
- **Package manager**: npm. Don't introduce pnpm/yarn mid-hackathon.
- **Demo app**: keep it to 2-3 interactive elements (e.g. a "buy" button, a price element, a hero heading) — just enough surface area to assert against and to visibly break on purpose. Plain HTML/CSS/vanilla JS behind a minimal Express static server is preferable to a framework here; we don't need SSR or routing, and framework build steps are pure risk on a one-day clock. **Must be deployed somewhere public** (Vercel free tier is the fastest path) — Bright Data's regional proxies need a real public URL, not localhost.
  - **Deployed** (Phase 1, done): `apps/demo-app` is live at `https://watchtower-gilt.vercel.app` (Vercel project `galmrts-projects/watchtower`), also recorded as `DEMO_APP_URL` in `.env.example`. Elements use stable `data-testid` attributes (`hero-heading`, `product-card`, `price-value`, `buy-button`, `buy-status`) so structural probes survive a pure CSS class rename — that's the intended Act 1 cosmetic-drift surface.
  - **Vercel gotcha**: `apps/demo-app/vercel.json` must set `"framework": null`. Without it, Vercel's zero-config detection sees `express` in `package.json` + a root `server.js` and tries to build `public/` as a serverless Express entrypoint instead of serving it as static files, which fails with "No entrypoint found in output directory." `server.js` is for local dev only (`npm start`); production serves `public/` as static content via `outputDirectory`. Redeploy with `npx vercel --prod` from `apps/demo-app` (reuses the linked project, updates the same URL — do NOT use a plain `vercel deploy` without `--prod` for anything that needs a stable URL, since that mints a new unique URL each time and would break the Act 1 demo where probes must keep hitting the same URL across a redeploy).
- **Probe runner**: one script, run on a schedule (cron or manual trigger during demo), that (a) calls Bright Data for each configured region, (b) runs content assertions against the response, (c) emits one OpenTelemetry span per region per assertion, (d) posts a structured result to Port's workflow webhook.
- **Assertions**: prefer structural/semantic checks ("is there still an element that looks like the buy button, roughly here, with similar text") over a single brittle CSS selector — the whole thesis is that selectors alone are too fragile to trust blindly.
- **Decision logic**: keep it a simple, explainable scoring function (region-agreement + deploy-recency + content-diff heuristic), not a black box. Judges and operators should be able to see *why* it chose auto-heal vs. escalate — that's the actual deliverable, not the button.

## 4. Bright Data Scraper Studio settings

*(Fill in the real values during the workshop / after first auth — this section exists so every future session reuses the same settings instead of re-deriving them. Update this block, don't create a second one.)*

- **Two separate credentials — don't conflate them** (this bit us once already, see `services/probe-runner/src/proxy.ts`):
  - `BRIGHTDATA_API_TOKEN` — control-plane auth only (CLI / REST / Scraper Studio calls). Get it from Account settings → **Add API key** (shown once).
  - `BRIGHTDATA_ZONE_PASSWORD` — per-zone proxy password, from that zone's **Access Details** tab. This is what actually authenticates proxy traffic; the API token does **not** work here.
- Proxy zone: a **Datacenter** zone named `watchtower_probes` (customer ID `hl_cf3607f4`), confirmed live via the zone's own Access Details curl example. Datacenter (not residential/Web Unlocker) is the right call — we're only probing our own Vercel-hosted demo app, so there's no anti-bot/CAPTCHA to unblock, and datacenter is far cheaper and faster.
  - Proxy endpoint: `brd.superproxy.io:44445` (confirmed from the zone's Access Details example — do not assume the commonly-documented `22225`, that port didn't match our zone).
  - Username format: `brd-customer-<BRIGHTDATA_CUSTOMER_ID>-zone-<BRIGHTDATA_ZONE>-country-<cc>` (country suffix added by `probe-runner` per region from `probes/regions.json`).
  - **Country coverage is limited**: as of 2026-08-22, this zone only has IPs provisioned in Netherlands (`nl`) — swept ~30 country codes via curl and only `nl` (and the no-country default) returned `200`; everything else (including `us`/`gb`/`sg`) 400s with `client_10062: No IPs in selected country`. So `probes/regions.json` currently routes all three logical regions (`us-east`/`eu-west`/`ap-south`) through `country=nl` — the region ids stay distinct for scoring/demo purposes, but they are not physically geo-diverse network paths right now. If more countries get added to the zone later, restore real country codes there. This also means Act 2's single-region failure (§7) needs a deliberate fault-injection lever (e.g. a per-region query param the demo app breaks on command) rather than relying on genuine per-region network differences — not yet built.
- CLI: `@brightdata/cli` (confirm exact package name/install command from the workshop) — run scraper commands from the terminal, not the web dashboard, per the hackathon's Bright Data judging criteria.
- Output format: structured JSON, one record per (region, target URL, timestamp).
- Self-healing flow (confirmed from Bright Data docs — reflect this accurately, don't invent a fully-automatic version): a scraper's self-heal is **not** automatic detection+fix. The flow is: describe the problem in natural language (ideally pointing at what changed) → Bright Data generates a code diff (can take up to ~15 min) → review the diff → Accept/Decline → preview → explicitly click "Save to Production." Our agent step should generate that natural-language description from the SigNoz trace context, but a human still approves in Port before anything hits production. Do not build or claim a fully-unattended auto-fix — that's not how the tool works and overclaiming it will not survive a judge's follow-up question.

## 5. Build plan (phased against today's schedule)

- [~] **Workshops (10:00-11:00)**: Bright Data API token + a live Datacenter zone (`watchtower_probes`) confirmed working — see §4. **Still needed**: confirm SigNoz ingestion endpoint (self-hosted or cloud) and get an API key; create the Port workspace and skim AI Builder's Plan/Build modes.
- [x] **Phase 1 (11:00-12:00)**: scaffold `/apps/demo-app`, deploy it publicly (Vercel), confirm it's reachable. **Done** — live at `https://watchtower-gilt.vercel.app`, verified rendering correctly. See the Vercel gotcha note in §3.
- [x] **Phase 2 (12:00-13:00)**: `/probes` (regions + assertions) and `/services/probe-runner` built, typecheck clean, and run end-to-end against the live Bright Data proxy + live demo app — both pass and fail paths verified (see status note above). **Deferred, not blocking**: SigNoz dashboard (needs an ingestion endpoint — cloud hit a server error, self-hosted via Docker not yet set up; console span export covers the gap for now).
- [ ] **Phase 3 (13:00-14:00)**: model `Probe` / `ProbeRun` / `Incident` blueprints in Port; wire `services/probe-runner`'s existing webhook post directly to a Port workflow (`PORT_WEBHOOK_URL` — this is already the primary trigger path, doesn't require SigNoz); build the confidence-scoring workflow step. If SigNoz comes online later, a SigNoz-alert-based trigger can be added as a secondary path, but Port must not depend on it.
- [ ] **Pizza (14:00)** — keep going after.
- [ ] **Phase 4 (14:00-15:00)**: build both branches — auto-heal (agent drafts the repair prompt → Bright Data self-heal → human approves in Port → re-verify → close incident) and escalate (page a human, no auto-heal attempted).
- [ ] **Phase 5 (15:00-16:00)**: rehearse the two-act demo end to end — ship a cosmetic change and show correct auto-heal, then simulate a single-region failure and show correct escalation.
- [ ] **Phase 6 (16:00-17:00)**: polish the Port audit-trail view, finalize the SigNoz dashboard, record the 3-5 min demo video, write the README.
- [ ] **Submission (17:00+)**: GitHub repo with commit history + README, demo video.

## 6. Git workflow — commit every change

This repo's commit history is part of the submission's story: a clean, frequent commit log is a visible trace of the factory being built, and it's the fastest way for a judge (or future-you at 4:45pm) to reconstruct what happened and when. Rules:

1. **Commit after every meaningful unit of work** — a probe added, a dashboard built, a workflow wired, a bug fixed. Don't batch unrelated changes into one giant commit, and don't let more than ~30 minutes of work go uncommitted.
2. **Write imperative, present-tense messages** describing what changed and why it matters (`add region-agreement scoring to probe-runner`, not `wip` or `updates`). A short body line is welcome when the "why" isn't obvious from the subject.
3. **Never commit secrets.** `.env`, API tokens, and credentials must never be staged — check `git status` before every commit, and if anything named `.env*` or containing a key/token shows up, stop and double-check before adding.
4. **Small, focused commits over big dumps.** If a change touches the demo app, the probe runner, and the Port workflow all at once, prefer three commits over one where practical.
5. **Before any destructive git command** (`reset --hard`, `checkout --`, `clean -f`), run `git status` first and make sure nothing uncommitted would be lost.

## 7. Demo script (keep this current as the build evolves)

1. **Setup**: show the live Port dashboard, SigNoz dashboard, and the demo app side by side.
2. **Act 1 — drift**: ship a visible, deliberate frontend change to the demo app (rename a class, restructure a section). Watch SigNoz show correlated failures across all regions. Watch Port open an incident, compute high confidence for "drift," trigger the repair prompt, show the Bright Data diff, click approve. Watch the probe re-run green and the incident close.
3. **Act 2 — real incident**: simulate a single-region failure (point one region's check at something broken only for that region). Watch Port correctly refuse to auto-heal and escalate to a human instead. This is the part that proves the system isn't just "a scraper that fixes itself" — say that explicitly on camera.
4. **Close**: show the Port audit trail explaining *why* each decision was made, and the SigNoz dashboard telling the full story of both incidents.
