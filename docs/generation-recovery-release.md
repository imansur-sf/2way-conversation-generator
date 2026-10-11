# Generation controls and narrative fidelity release

Approved October 11, 2026. Implementation branch: `codex/generation-recovery-release-2026-10-11`, starting from verified branding recovery plus documentation (`d56d6bc`). TaskCreate/TaskUpdate tools are unavailable; this ledger tracks the work.

## Phase 1 — implementation and verification

- [x] Fix opening-sender inference for company aliases and later customer replies, retaining explicit controls and supplied dialogue.
- [x] Separate verbatim dialogue from descriptive requirements; retain bounded sequence, actor, numeric-fact, and requirement checks without claiming universal semantic or factual verification.
- [x] Replace repeated technical errors with contextual guidance and an action that opens/focuses the appropriate Generation control without changing it. Guidance distinguishes the failed request's settings from newer unsent edits; timeout, incomplete and unreadable responses have distinct causes.
- [x] Keep the verified branding-only recovery path, original failure details, saved inputs, and existing scenarios intact.
- [x] Add regressions for the exact EWC brief, both opening senders, natural paraphrases, exact dialogue, genuine missing/contradictory requirements, all four channels, errors, persistence, and offline exports. Independent review and full CI passed.

## Phase 2 — protected deployment

- [x] Preserve immutable production Git rollback reference. GitHub production `main` was read and confirmed as `35bf1fb1e6486d4a194a01f77dcb66c9bc6672bc` before implementation and again after login. Annotated tag `rollback/pre-generation-recovery-2026-10-11` was published and locally verified at that commit.
- [x] Re-authenticate Heroku and verify current successful production/staging release identity and rollback eligibility. After the user restored login, fresh CLI reads confirmed production **v181**, release `d55b76d3-7cd2-47b0-bc1a-048824cc09b8`, `Deploy 35bf1fb1`, current/succeeded/eligible for rollback; staging **v55**, release `230f1a2e-44bf-4e45-b9b4-159c467fa4c1`, same source, current/succeeded/eligible for rollback. Staging web process `web-5df557b9d8-pwds2` was up on v55. No credentials were shared or configuration changed.
- [x] Deploy the exact CI-verified candidate to staging, retain environment configuration, and verify health and release identity. Managed browser policies were not bypassed; isolated CI provides browser evidence, not an actual live-browser UI verification.
- [ ] Pass bounded synthetic live-provider acceptance. Two staging jobs were submitted: EWC four-channel auto-sender failed with `gemini_timeout`; the separately submitted, originally planned customer-first email sample passed. The combined release gate remains failed; no replacement EWC job was submitted.
- [ ] Recheck production rollback state, promote the approved candidate without force pushes, and verify actual Heroku build/release/health. A GitHub push alone is not deployment confirmation.

No production deployment has been made by this release work. Promotion is held at the failed live-provider acceptance gate. Existing user scenarios and browser storage were not reset.

## Verification notes

- Local code-level suite: 240 passing tests, including the original EWC auto-sender request through the application pipeline with a mocked provider (no repair/fallback). Independent review identified a stale-control guidance claim plus five backend cue-matching edge cases (adverbs, conflicting timing/polarity, unrelated time periods, non-benefit membership questions, and qualified benefits exclusions); fixes and regression cases are included. Final reviewer verification passed with no remaining code-review blockers.
- Exact runtime candidate: `3adf6e856d25e0b3facd9563b5f977e153f692e2`. [Full CI run 38175388416](https://github.com/imansur-sf/2way-conversation-generator/actions/runs/38175388416) succeeded: code-level, browser security, browser state reliability, downloaded export integrity, integrated builder/playback, AI draft fidelity/application, and responsive/accessibility-control suites. Screenshots of generation guidance and branding recovery were inspected. The earlier superseded run was cancelled by the final push; it is not the release gate.
- The exact EWC description is paired with a synthetic `example.com` website for deterministic backend-to-browser tests, not a claim that its benefits were verified from a company site. All four previews and actual offline downloads exercise both customer replies and consecutive company handoff turns.
- Staging live smoke supports `SMOKE_SUITE=narrative`: the EWC alias/auto-controls brief replaces the standard first sample, retaining the two-job / at-most-four-provider-request budget, followed by customer-first email. Explicit authorization, staging environment and exact release identity are required. The October 11 live results are recorded below; they do not pass the combined gate.
- Earlier read-only Heroku release checks returned `HEROKU_NONINTERACTIVE_LOGIN`. Login was subsequently restored by the user; a GitHub feature-branch push alone was not treated as deployment.

## Staging acceptance — October 11, 2026

Heroku build `7a269e82-4727-4a4b-b39c-e8205754ca8f` succeeded from exact CI-verified source `3adf6e856d25e0b3facd9563b5f977e153f692e2`, deploying staging **v56**, release `82dbc2d8-dd99-4fa2-a781-ba5dce6ec94f`, current/succeeded. Its web process `web-67f877778f-bbrpq` passed the existing hosted smoke against its loopback server: health and builder HTML both returned HTTP 200, version `2.0.0`, environment `staging`, configured model `gemini-3.5-flash`. This health check made zero provider requests. Configuration and credentials were not changed.

The original EWC brief was submitted once using `SMOKE_SUITE=narrative` against that running staging process. The server returned failed status with `gemini_timeout` and no validation issues. The script stopped before submitting its second sample. This is a provider-attempt failure, not the smoke polling deadline; the app currently allows 20 seconds per attempt and at most two attempts. The final error identifies the last failure, not the reason for the first retry. A filtered log read did not return historical retry evidence, so the exact first-attempt cause is not asserted.

The originally planned customer-first email sample was then submitted independently for diagnosis, with the same staging/version/model guards, same synthetic inputs, one job, and no replacement jobs. Job `f0922475-5d1d-4eac-b23c-29d594f3b732` completed in **11,169 ms** with `source.mode: provider`, one provider attempt, no fallback, and complete structural/explicit-constraint validation. The actual four-turn email was reviewed: Morgan requests information; Example Company acknowledges Morgan and introduces Riley; Morgan responds; Riley identifies themselves as the sales representative and offers next steps. Both names, customer-first order, company sender identity and plain email presentation were retained. No invented dates, prices, offers or contact details appeared; factual grounding remains explicitly unverified.

The final staging health metrics confirm exactly **two jobs started, one completed, one failed, zero fallbacks and zero active jobs**. The two-job / at-most-four-provider-request budget was retained. Successful customer-first generation confirms usable provider credentials at that time but does not establish reliable four-channel EWC generation. No further provider requests were made.

Read-only follow-up inspection identified a timeout-classification gap: a response-body abort can become `gemini_bad_json`, unlike a pre-header abort. This gap does not explain the observed final timeout by itself. Recommended follow-up is safe per-attempt timing/stage diagnostics and correct timeout classification, followed by coordinated provider/job/browser/smoke deadlines if measured results justify a change; do not weaken validation, fabricate fallback success, lower output tokens, or change model credentials to force acceptance.

At final verification, production GitHub `main` remained `35bf1fb1e6486d4a194a01f77dcb66c9bc6672bc`, and Heroku production remained current/succeeded **v181**, still eligible for rollback. Staging's sole web process was up on v56. Production promotion remains pending resolution and successful verification of the live timeout.
