# Optional accounts and cloud projects

The studio is fully usable without signing in. Existing automatic browser saving and recovery remain active for everyone. The existing Save all changes control saves locally and creates a restore point. It does not upload a project.

Sign In becomes a username disclosure after authentication. Save Project and My Projects live in that account menu; local replacement backups remain available to guests under Troubleshoot → Local recovery. See [the account toolbar and feedback integration](account-toolbar.md).

Sign In uses the shared SaaSy Accounts widget. Signing in or out never replaces the editor or uploads local work. Save Project explicitly creates or updates a cloud project; Save as New makes a separate copy. My Projects lists, loads, and deletes only `twoway` projects owned by the verified signed-in identity. Deleting a cloud project does not remove the editor or its local recovery.

## Data boundaries

- The primary browser store remains `two-way-experience-studio-scenarios-v1` / `scenario-state` / `current`, with the existing small localStorage fallback, legacy recovery, acknowledgement ordering, and per-scenario restore points. Optional workspace settings and completed AI review data are additive fields; older records still load.
- A cloud project contains all scenarios, all independent channel variants, selected scenario/channel, preview scale, setup mode, AI form inputs, completed AI review/branding data, and embedded uploaded assets. It uses `format: twoway-project`, `version: 1`. Live AI requests, credentials, playback progress, and local restore-point history are excluded. Existing externally linked assets remain links, with their existing availability requirements.
- Cloud saves are limited to 19 MiB of UTF-8 JSON under the existing Accounts 20 MiB request limit. Images are never silently dropped to fit. Local storage and the open editor remain intact after a failed cloud save.
- Before replacing the workspace, loading archives a full local snapshot and its restore-point history. The three most recent replacement backups are available through Local recovery, even signed out. A failed archive blocks replacement. Cloud loads start their own restore-point history; restoring a local replacement backup restores its history as well.
- Browser-local work is shared by people using the same browser profile. It survives sign-out and account switches; signing out is not a local-data deletion operation. Signing out clears private cloud lists, cached cloud UI data, and the active cloud association. A draft originating from another account requires an explicit Save as New to copy into the current account.

## Failure and concurrency behavior

Cloud operations fence the initiating identity and workspace generation. Late results cannot attach a different account's project or replace a workspace edited during a fetch. Session renewal is restricted to the initiating email. Native project dialogs are suspended while the shared authentication overlay is open.

Creates persist their original snapshot and idempotency key before dispatch. An interrupted response is retried with that exact snapshot, including after reload; newer editor changes remain local until the next explicit save. Resolve an uncertain save before loading another cloud project. Updates send the expected revision. An update retry accepts an already-committed result only if name, source URL, and canonical payload exactly match; otherwise a conflict offers Save as New or loading the current server revision. No automatic conflict overwrite occurs.

Browser recovery records contain no authentication credentials. Retry snapshots remain local to permit reconciliation with their original account; they are not displayed in another account's project list. Local saves are always labelled as device-local; only an acknowledged cloud response gets “Saved to cloud.”

## Shared service and rollout

SaaSy Accounts is the existing provider and PostgreSQL store; no new paid service is provisioned. Shared changes add `twoway` to project-specific validation and expand the existing projects table constraint. API-key and generation-job tool namespaces remain unchanged.

Apply the Accounts schema migration and deploy its project-validator change before enabling the studio release. No migration or deployment is performed by the studio. Its server proxies the shared widget, supported authentication routes, and projects routes to `SAASY_ACCOUNTS_URL` (default: the existing shared service). Requests are bounded, time-limited, marked no-store, and never forward cookies or upstream redirects.

## Verification

`npm test` includes format round trips, UTF-8 limits, invalid records, existing local-recovery regressions, and proxy boundaries. `npm run test:cloud` uses Playwright and a synthetic accounts contract double through the actual proxy; it sends no real email, accounts request, or AI generation. The quality workflow runs this suite alongside existing browser checks. Staging acceptance with the real Accounts service remains a release requirement.
