# Branding-only recovery

Requested October 11, 2026. Baseline: production-tested `35bf1fb` plus documentation through `494f24c`. Production is not changed by this work. TaskCreate/TaskUpdate are unavailable; this file records progress.

- [x] Preserve bounded, website-sourced branding independently of dialogue generation, including failed jobs and polling deadlines.
- [x] Offer explicit branding-only manual creation with asset choices, original failure details, independent channel variants, and no overwrite of existing scenarios.
- [ ] Verify extraction, error/retry/stale-request handling, manual creation, saving and offline export; publish test evidence before any production promotion.

Scope: branding recovery only. Opening-speaker/topic parsing identified in the preceding diagnosis is a separate pending fix. No AI-generated dialogue or inferred benefits will be presented as successful content in the branding-only path. Website/image availability is not guaranteed; failures must remain visible.

Initial local verification: 204 code-level checks pass. Backend tests cover running/failed/completed jobs, failed scraping, missing images, partial evidence, provider errors, uncached fallback, and synchronous errors without real provider calls. Frontend tests cover request binding, safe embedded assets, blank independent flows and both opening speakers. Browser/real-offline-export checks and independent review are pending. Managed local browser automation remains unavailable; use the existing isolated CI browser gate on the feature branch, not production.
