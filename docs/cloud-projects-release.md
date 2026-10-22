# Cloud projects release — October 22, 2026

TaskCreate/TaskUpdate are unavailable; this ledger records deployment state.

- [x] Inspect existing autosave, SaaSy Accounts, and deployed source ancestry.
- [x] Implement optional cloud projects and the approved account/feedback toolbar.
- [x] Preserve existing production grammar, opening-sender and support fixes.
- [x] Pass scoped-candidate code and browser gates.
- [x] Verify shared Accounts deployment and disposable ownership/idempotency checks.
- [x] Publish rollback checkpoint and verify exact staging candidate.
- [x] Record bounded provider failure, isolate unrelated AI changes, verify cloud acceptance, and promote the scoped candidate.
- [x] Verify production runtime and record release evidence.

Preflight production: successful v186, release `75cda4db-d11b-46ff-91e9-d20ec3bb2929`, source `42760e01`, rollback eligible. Staging v60, release `d4589ca7-351a-4858-ad7f-dce342a9e4c3`, source `21b9a12e`. Preserve all environment/model settings. Tests use synthetic browser profiles and fixtures; no user browser storage or real feedback is reset or submitted.

Scope correction: the initial candidate3ba83dd included older, held narrative/branding recovery changes from this working branch. Its bounded staging acceptance stopped on the first synthetic job with `gemini_timeout`; no replacement or production provider request was made. These unrelated AI changes are excluded from the final cloud release. Production draft-contract, client AI mapping, live-smoke script, and all generation handlers are restored byte-for-byte from42760e01; server.js adds only the Accounts import/route. Original pending work remains recoverable at3ba83dd. Current provider readiness is not claimed. No timeout/model/credential setting was changed to pass the gate.

Scoped validation:207 code tests and18 cloud browser scenarios pass, including completed AI review and local restoration. Shared Accounts releasev33 (ba22c44) succeeded with migration and synthetic ownership/idempotency/revision/cleanup checks. The initial stagingv61 passed health and live widget/config/guest-session/private-route checks; the scoped candidate must replace it before promotion.

Final deployment: source `cb6bc4d638f94c7744af76ab9b73676227ed6de7`, production **v187**, successful release `b051ea67-2354-4ee3-9460-e24a3904b512`, build `0e330c78-34ad-4a84-bc22-ec044bd7f357`, web `web-7459d99fd7-fx7mf` up. Production main fast-forwarded to exactly this candidate. Staging **v62**, release `dbd483eb-d2f4-4485-be78-00466c51cc4d`, build `a24091e3-efbf-4aba-8cd7-dc4be72b7f3a`, verified the same source before promotion.

[Exact-candidate CI](https://github.com/imansur-sf/2way-conversation-generator/actions/runs/39748765135) passed all code, security, persistence, cloud, feedback, offline export, integrated playback, AI application, UI/accessibility and workspace groups. The same full suite passed locally:207 code tests,18 cloud browser scenarios, guest/admin feedback checks. Isolated Chromium profiles were used throughout. No user local drafts were reset.

Production runtime smoke passed health/builder with preserved version1.1.0, production environment, and gemini-3.5-flash configuration. Live proxy verification passed widget/auth config/guest feedback session200 and unauthenticated projects/inbox401. Served cloud/feedback toolbar assets are present. Shared Accounts **v33**, commit `ba22c44ce45c0ef40efdcb2b072fe30a77f391a5`, build `d2058a86-6c6e-483b-9971-a03ad83b2d29`, completed its additive migration and disposable project CRUD/ownership/idempotency/revision tests; all smoke records were removed. No real feedback was submitted.

Rollback checkpoint: published annotated `rollback/pre-cloud-projects-v186-2026-10-22` at42760e01; prior successful production v186 remains the recorded rollback release. Accounts rollback tag `rollback/twoway-accounts-v32-2026-10-22` atbab6f1e5. Do not clear browser recovery during rollback. No model, timeout, credential or environment configuration changed.

Limits: hosted private-space verification ran through trusted web-dyno loopback. Visual/browser interactions were tested using the exact source and dedicated local/CI Chromium, not a user's authenticated production browser. The single bounded staging narrative job failed with gemini_timeout on the excluded candidate, so current AI-provider readiness remains unverified; no additional or production provider jobs were submitted. This cloud release preserves production AI behavior byte-for-byte except the independent Accounts route dispatch.
