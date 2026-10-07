# Two-phase delivery and rollback ledger

Approved October 7, 2026. This execution plan consolidates the audit into **two phases**. Internal commits and tests are checkpoints, not additional delivery phases.

## Rollback checkpoints

| Checkpoint | Git reference | Runtime reference | Status |
| --- | --- | --- | --- |
| Production before Phase 1 | `rollback/quality-baseline-2026-10-07` at `d8d8e2d6ade2118c192f2cf053d59ae5ab19e32d` | `saasysolutions-2way-generator` release **v180**, succeeded; release ID `bb8ab77b-991b-48f7-904f-5595aa5a9be0`; eligible for rollback | Verified 2026-10-07T23:22Z |
| Existing local work before Phase 1 | `rollback/quality-workspace-2026-10-07` | Not deployed | Snapshot includes existing export-filename change and audit report |
| Phase 1 complete / before Phase 2 | `rollback/quality-phase1-2026-10-07` | Record staging/production release if deployed | Pending verification |
| Phase 2 complete | `rollback/quality-phase2-2026-10-07` | Record staging/production release if deployed | Pending verification |

Implementation branch: `codex/quality-two-phase-2026-10-07`. Production main must not advance automatically while either phase is unverified. Checkpoints are annotated Git tags pushed to GitHub; tags alone do not change the deployed main branch.

## Phase 1 — Protect data and make playback/export reliable

- [ ] Baseline and local-work checkpoints published and verified remotely.
- [ ] Truthful saving, revision-aware hydration, retained migration sources, atomic import, recoverable history.
- [ ] Targeted asynchronous image updates and cancellable reply timers; independent channel content.
- [ ] Safe branded HTML; hardened static/asset endpoints, bounded generation admission and request identity.
- [ ] Consistent email content and snippets; safe export serialization, complete image manifest and precise export warnings.
- [ ] Behavioral regression harness completes; real downloaded files work without a server.
- [ ] Review, verify, commit and publish Phase 1 rollback point before Phase 2 starts.

## Phase 2 — Improve relevance, rendering and maintainability

- [ ] Explicit dialogue/name preservation, final AI requirements validation, channel-specific generation and honest fallback reporting.
- [ ] Stable jobs/idempotency, unified provider/release smoke configuration and safe release diagnostics.
- [ ] Responsive preview fit, Editor/Preview navigation, accessible controls and reliable image framing.
- [ ] Clear save/restore semantics and actionable content/asset QA.
- [ ] Extract touched boundaries into testable modules; CI, documentation and release gates.
- [ ] Review, verify, commit and publish Phase 2 rollback point.

## Rollback procedure and data safeguards

Code rollback is a deliberate release operation, not a reset of a dirty checkout. Use the immutable checkpoint as the source for a recovery branch/build; retain newer commits. For production, the verified pre-change release is v180. Re-check Heroku rollback eligibility immediately before a rollback. Never expose configuration secrets in this ledger.

**Browser data is not restored by Git/Heroku rollback.** Do not delete legacy/durable records while migrating. Preserve original records until the replacement validates and commits; test interruption/quota failures and old-build compatibility. Use disposable scenario fixtures for tests, never reset a real user's storage. A new cloud database or paid storage service is outside these changes and requires a separate product decision.

## Verification log

- Baseline GitHub main verified at `d8d8e2d6ade2118c192f2cf053d59ae5ab19e32d`.
- Heroku v180 verified current/succeeded and rollback-eligible.
- Existing local HTML edit only changes export filenames to include the channel; preserved in the workspace snapshot.
- Implementation/test results will be appended before each checkpoint.
