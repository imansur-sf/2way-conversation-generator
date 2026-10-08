# Two-Way Experience Studio

Two-Way Experience Studio builds interactive SMS, RCS, WhatsApp, and email demos. This is the production codebase; major changes are verified on an isolated branch and the separate staging app before production promotion. See the [two-phase delivery ledger](docs/two-phase-delivery.md) for current verification and rollback points.

## Environments

- **Offline export:** Downloaded HTML must work without a server.
- **Local hosted:** `npm start` provides the API required for AI generation and remote image loading.
- **Release candidate:** Validate the candidate in an isolated Heroku app before promoting the same commit to production.

Current production URL: `https://saasysolutions-2way-generator-d5d5517bce22.holly-virginia.herokuapp-internal.com/`

The production app runs in a Heroku Private Space. Its trusted-IP policy means it is available only from an approved corporate network or VPN egress range.

See [the code map](docs/2.0-code-map.md) for the module boundaries and compatibility approach.

## Local setup

1. Use Node 20 or newer (CI uses Node 22).
2. Run `npm ci --ignore-scripts`.
3. Configure `GEMINI_API_KEY` and the approved `GEMINI_MODEL` in your local environment when testing AI generation. See `.env.example`; do not commit credentials.
4. Run `npm test`.
5. Run `npm start`, then open `http://localhost:3000`.

The server reads environment variables directly. Load `.env` through your shell or local environment manager; `.env` is intentionally not committed.

## Hosted smoke test

After deploying the staging app:

```sh
BASE_URL=https://YOUR-RELEASE-CANDIDATE.herokuapp.com EXPECTED_ENV=staging EXPECTED_VERSION=YOUR_APP_VERSION node scripts/smoke-hosted.mjs
```

This confirms that the deployment serves the builder and matches the expected `APP_ENV` and `APP_VERSION`, without sending an AI request. Optionally set `EXPECTED_MODEL` to assert the configured model. Verify the exact source commit separately against Heroku release/build metadata; `APP_VERSION` is an application label, not necessarily a commit ID.

To exercise the complete AI job path, explicitly authorize the bounded live smoke against staging. It submits **two fixed synthetic prompts**, with at most **four provider requests total** (one initial attempt and one repair/retry per prompt). A fallback result does not pass. This can incur provider usage:

```sh
ALLOW_LIVE_AI=1 BASE_URL=https://YOUR-RELEASE-CANDIDATE.herokuapp.com EXPECTED_ENV=staging EXPECTED_VERSION=YOUR_APP_VERSION node scripts/ai-app-smoke.mjs
```

From an authorized staging runtime, omit `BASE_URL` to start a temporary local smoke server using that runtime's existing configuration. Add `SMOKE_REPORT=1` only when you want the fixed synthetic dialogue/checks printed for manual quality review. Keys are never printed. The optional `scripts/gemini-provider-smoke.mjs` also requires `ALLOW_LIVE_AI=1` and sends exactly one additional provider request; it is not a substitute for application acceptance.

## Release rules

1. Preserve a Git tag and Heroku release rollback point before every production deployment.
2. Valid legacy browser saves can be migrated, but original legacy records are retained for recovery. They are **not** continuously overwritten with new-format edits. Unsupported future records are protected from replacement. Never clear real users’ storage as a deployment step.
3. Do not commit credentials, downloaded scenarios containing sensitive information, or generated exports.
4. Require the [CI browser gate](docs/testing.md), staging checks, bounded live-AI acceptance, and manual review before production promotion. CI alone is not a release or a guarantee of every possible workflow.
5. Configure `GEMINI_API_KEY` directly in Heroku before running AI acceptance tests. Do not copy or display a credential through source control or shell output.
6. Keep `GEMINI_MODEL` pinned to a model enabled for the production Google project and validate it with the live acceptance test before cutover.

## Current storage boundary

Scenario saves are **device- and browser-profile-local**, primarily in IndexedDB with a small local-storage fallback where it fits. Save status is acknowledged only for the revision actually written. A successful database save does not require a second cache copy. Oversized or blocked storage can still fail; keep the page open and export scenario JSON to rescue work when warned.

Each scenario retains independent channel variants. A save includes those variants and creates a restore point; an additional named restore point is optional, not a separate requirement for saving. Up to three restore points are retained per scenario. Scenario JSON is an editable backup; downloaded interactive HTML is a playback artifact for the selected channel, not a workspace backup.

Private/incognito sessions, clearing site data, changing profiles/devices, and browser storage eviction can remove or hide local work. Editing the same workspace in multiple tabs is not a supported collaborative workflow; concurrent-writer conflict resolution is not yet implemented. Export JSON regularly for important work.

Generation jobs are bounded, process-local and transient. Completed records expire after 15 minutes; a process restart loses job records. Adding multiple server processes requires shared job/idempotency storage. A cloud scenario library or multi-user collaboration would also need an explicitly approved database, object storage, access-control and retention design; this update does not provision those services.
