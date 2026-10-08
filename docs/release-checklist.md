# Candidate verification and release checklist

Use the original production repository and URL for normal development. The separate `twoway-studio-v2-staging` Heroku app is the test environment for major changes, not a second independently maintained implementation.

## Before deployment

1. Record the exact candidate commit and verify the working tree contains no uncommitted release changes.
2. Require successful code, security, persistence, offline-export, AI-application, and UI browser gates for that code. Review screenshots and failures; passing a source-string assertion alone is not behavioral evidence.
3. Publish an annotated rollback tag. Record the target Heroku app's current successful release ID, version, source commit and rollback eligibility in the delivery ledger. Re-check immediately before deploying; another release may have happened since the earlier audit.
4. Preserve environment-specific settings. Do not copy production credentials into staging, print secrets, change the configured Gemini model without validation, or enable production auto-deploy for an unverified branch.
5. Back up important demo work using **Export scenario JSON**. Tests must use disposable fixtures and never reset real users' browser data.

## Verify the same candidate on staging

- Build from the exact committed source. Do not force-push unrelated staging Git history just to transport a candidate; use a supported build/deploy flow.
- Verify the successful release and safe health/build identity. A successful GitHub push does not itself confirm a successful Heroku deployment.
- Run the hosted smoke with explicit expected environment and release identity. Key presence means configured, not a proven healthy AI provider.
- Run a bounded live-provider acceptance using fixed synthetic content. Review the returned dialogue, speaker/order/count, channel presentation and fallback source—not only HTTP status. Record the exact request budget and results; mock tests do not establish live-model quality.
- Open staging from an authorized network. Check SMS, RCS, WhatsApp and Email on desktop and a narrow layout; type, upload/change an image, switch channels, save/reload, adjust/cancel a crop, and replay both opening-sender patterns.
- Download actual HTML and test it offline. Check reset, focus/present, future replies and images; a download offered with explicit missing-asset warnings is not a fully self-contained success.

## Production promotion

Promote only the verified candidate after approval. Record the production release, then repeat health/build identity and critical user-journey checks. Do not treat a green CI run or a staging release as production completion.

## Rollback

Use the recorded Heroku release or a recovery build from the immutable Git checkpoint. Retain newer commits and deployment evidence; do not reset a dirty checkout or rewrite shared history.

**Code rollback is not browser-data rollback.** Original legacy records are retained, but an older build may not understand newer data fields or the newest stored revision. Keep JSON backups of important work and do not clear browser stores during a rollback. Verify old/new schema behavior with a disposable copy before advising users to recover.

## Explicit limits

The automated browser gate uses Chromium and synthetic fixtures. Safari/Firefox, real mobile hardware, screen-reader behavior and live-provider relevance require separate evidence. The app does not provide cloud scenario storage or concurrent multi-tab editing. Generation jobs and idempotency are process-local; do not scale to multiple processes without shared job storage.
