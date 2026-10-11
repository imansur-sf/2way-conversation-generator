# Generation controls and narrative fidelity release

Approved October 11, 2026. Implementation branch: `codex/generation-recovery-release-2026-10-11`, starting from verified branding recovery plus documentation (`d56d6bc`). TaskCreate/TaskUpdate tools are unavailable; this ledger tracks the work.

## Phase 1 — implementation and verification

- [x] Fix opening-sender inference for company aliases and later customer replies, retaining explicit controls and supplied dialogue.
- [x] Separate verbatim dialogue from descriptive requirements; retain bounded sequence, actor, numeric-fact, and requirement checks without claiming universal semantic or factual verification.
- [x] Replace repeated technical errors with contextual guidance and an action that opens/focuses the appropriate Generation control without changing it. Guidance distinguishes the failed request's settings from newer unsent edits; timeout, incomplete and unreadable responses have distinct causes.
- [x] Keep the verified branding-only recovery path, original failure details, saved inputs, and existing scenarios intact.
- [ ] Add regressions for the exact EWC brief, both opening senders, natural paraphrases, exact dialogue, genuine missing/contradictory requirements, all four channels, errors, persistence, and offline exports. Require independent review and full CI.

## Phase 2 — protected deployment

- [x] Preserve immutable production Git rollback reference. GitHub production `main` was read and confirmed as `35bf1fb1e6486d4a194a01f77dcb66c9bc6672bc` before implementation. Annotated tag `rollback/pre-generation-recovery-2026-10-11` was published at that commit; Heroku release verification remains pending.
- [ ] Re-authenticate Heroku and verify current successful production/staging release identity and rollback eligibility. Historical production v181/staging v55 are not a substitute for fresh verification. Initial CLI read failed with `HEROKU_NONINTERACTIVE_LOGIN`; user was asked to sign in, without sharing credentials.
- [ ] Deploy the exact CI-verified candidate to staging, retain environment configuration, and perform bounded synthetic live-provider acceptance plus safe health checks. Managed browser policies must not be bypassed; use isolated CI browser evidence and clearly report any remaining live-browser limitation.
- [ ] Recheck production rollback state, promote the approved candidate without force pushes, and verify actual Heroku build/release/health. A GitHub push alone is not deployment confirmation.

No production deployment has been made by this release work. Existing user scenarios and browser storage must not be reset.

## Verification notes

- Local code-level suite: 238 passing tests. Independent review identified a stale-control guidance claim plus four backend cue-matching edge cases (adverbs, conflicting timing/polarity, unrelated time periods, non-benefit membership questions); fixes and regression cases are included. Final reviewer verification and full CI pending.
- The exact EWC description is paired with a synthetic `example.com` website for deterministic backend-to-browser tests, not a claim that its benefits were verified from a company site. All four previews and actual offline downloads exercise both customer replies and consecutive company handoff turns.
- Staging live smoke supports `SMOKE_SUITE=narrative`: the EWC alias/auto-controls brief replaces the standard first sample, retaining the two-job / at-most-four-provider-request budget, followed by customer-first email. Explicit authorization, staging environment and exact release identity are required. No live provider requests have been made yet.
