# Two-phase delivery and rollback ledger

Approved October 7, 2026. This execution plan consolidates the audit into **two phases**. Internal commits and tests are checkpoints, not additional delivery phases.

## Rollback checkpoints

| Checkpoint | Git reference | Runtime reference | Status |
| --- | --- | --- | --- |
| Production before Phase 1 | `rollback/quality-baseline-2026-10-07` at `d8d8e2d6ade2118c192f2cf053d59ae5ab19e32d` | `saasysolutions-2way-generator` release **v180**, succeeded; release ID `bb8ab77b-991b-48f7-904f-5595aa5a9be0`; eligible for rollback | Verified 2026-10-07T23:22Z |
| Existing local work before Phase 1 | `rollback/quality-workspace-2026-10-07` | Not deployed | Snapshot includes existing export-filename change and audit report |
| Staging before candidate verification | Existing staging code `aba6c237` (release description) | `twoway-studio-v2-staging` release **v47**, succeeded/current; release ID `0eed1c0c-0912-48d7-809d-e4c31214678b`; eligible for rollback | Verified 2026-10-08 UTC; no staging deployment performed yet |
| Phase 1 complete / before Phase 2 | `rollback/quality-phase1-2026-10-07` | Not deployed; production remains v180, staging v47 | All Phase 1 CI groups passed on `0bb90c5`; tag includes this ledger update |
| Phase 2 complete | `rollback/quality-phase2-2026-10-07` | Record staging/production release if deployed | Pending verification |

Implementation branch: `codex/quality-two-phase-2026-10-07`. Production main must not advance automatically while either phase is unverified. Checkpoints are annotated Git tags pushed to GitHub; tags alone do not change the deployed main branch.

## Phase 1 — Protect data and make playback/export reliable

- [x] Baseline and local-work checkpoints published and verified remotely.
- [x] Truthful saving, revision-aware hydration, retained migration sources, atomic import, recoverable history.
- [x] Targeted asynchronous image updates and cancellable reply timers; independent channel content.
- [x] Safe branded HTML; hardened static/asset endpoints, bounded generation admission and request identity.
- [x] Consistent email content and snippets; safe export serialization, complete image manifest and precise export warnings.
- [x] Behavioral regression harness completes; real downloaded files work without a server.
- [x] Review, verify, commit and publish Phase 1 rollback point before Phase 2 starts.

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
- Initial checkpoint tags and implementation branch published to GitHub. Workspace checkpoint commit: `762d8a3`. Production main/release remain unchanged.
- Phase 1 candidate: 109 code-level tests passed before final independent-review repairs. Browser-specific state and export suites passed their scoped cases, but the long integrated browser run is not yet verified.
- Local managed Chrome terminates automated debugging with `DevTools remote debugging is disallowed by the system admin`. No policy changes or bypasses were attempted. The feature branch adds a GitHub Actions test gate using Playwright's dedicated Chromium; production deployment is not part of that workflow.
- Phase 1 review repairs completed: preserve unsupported future storage envelopes before legacy migration; warn about unsaved edits in read-only recovery; retain asynchronous RCS reply-action image ownership. The updated code-level suite passes **113/113**. Completion checkpoint still waits for the integrated browser gate.
- The first CI run passed code-level and browser security checks, then exposed a shared-link save-order race. Candidate `35e8c20` saves shared scenarios after startup normalization/rendering and adds a deterministic regression (**114/114** code-level checks). Browser groups now run independently so one failure cannot hide other results. [Verification run 37705279331](https://github.com/imansur-sf/2way-conversation-generator/actions/runs/37705279331) passed code-level, browser security, state reliability, and downloaded-export integrity checks. Integrated playback stopped on a test setup omission: its email export fixture had not opened manual editing before clicking the hidden bottom Export button. That setup is corrected; the full integration result remains pending. Phase 1 is not yet complete and production has not changed.
- [Run 37708981984](https://github.com/imansur-sf/2way-conversation-generator/actions/runs/37708981984) passed every browser group, including all ten integrated workflows and fourteen actual downloaded-file cases. The gate exposed and helped repair shared-startup save ordering and channel-snapshot normalization; fixture-only corrections now select scenarios by ID, wait for actual save acknowledgements and settled carousel transitions, and independently report each workflow.
- Final review found a new-response constructor omitted a default later added during rendering, producing a false pending-save state. Commit `0bb90c5` initializes that default before saving. Eight regression cases failed before the repair and pass afterward; the complete local suite is **129/129**. Final [run 37709459519](https://github.com/imansur-sf/2way-conversation-generator/actions/runs/37709459519) **passed all groups**: code, browser security, state reliability, offline exports, and all ten integrated workflows.
- Production main and both Heroku environments remain unchanged. Phase 2 work starts only after the Phase 1 checkpoint is published.
