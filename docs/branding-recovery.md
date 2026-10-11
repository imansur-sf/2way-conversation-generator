# Branding-only recovery

Requested October 11, 2026. Baseline: production-tested `35bf1fb` plus documentation through `494f24c`. Production is not changed by this work. TaskCreate/TaskUpdate are unavailable; this file records progress.

- [x] Preserve bounded, website-sourced branding independently of dialogue generation, including failed jobs and polling deadlines.
- [x] Offer explicit branding-only manual creation with asset choices, original failure details, independent channel variants, and no overwrite of existing scenarios.
- [x] Verify extraction, error/retry/stale-request handling, manual creation, saving and offline export; publish test evidence before any production promotion.

Scope: branding recovery only. Opening-speaker/topic parsing identified in the preceding diagnosis is a separate pending fix. No AI-generated dialogue or inferred benefits will be presented as successful content in the branding-only path. Website/image availability is not guaranteed; failures must remain visible.

Local verification: 206 code-level checks pass. Backend tests cover running/failed/completed jobs, failed scraping, missing images, partial evidence, provider errors, uncached fallback, and synchronous errors without real provider calls. Frontend tests cover request binding, safe embedded assets (including favicons), blank independent flows, both opening speakers, and safe rendering of malformed imported recovery metadata. Independent review is clear after correcting favicon handling, stale-request application, and imported notice validation.

Browser verification uses the existing isolated CI gate on `codex/branding-recovery-2026-10-11`; managed local browser automation remains unavailable. Production and staging deployments are unchanged. Candidate `89280f85ba29c229ba8dc959dc911ba46c6c87b4` passed the complete [quality gate, run 38170871989](https://github.com/imansur-sf/2way-conversation-generator/actions/runs/38170871989): code-level regression, browser security, state reliability, downloaded export integrity, integrated playback, AI draft/recovery, and responsive editing/accessibility controls. Tests use synthetic data and mocked AI/image failures; no real Gemini request or live deployment was performed.

The final recovery browser checks include partial image failure with visible remediation, rejected stale inputs and late asset completions, no discovered images, and a real client polling deadline with branding available from the still-running job. Manual creation, reload, and offline HTML downloads passed for SMS, RCS, WhatsApp and email. Independent review of the final imported-metadata guard is clear.

Earlier browser runs confirmed the complete main recovery flow, saving/reload, and real offline exports for all four channels, alongside the existing security, state, playback and responsive UI checks. Recovery test fixtures were corrected to wait for asynchronous image embedding, retain the real post-bootstrap starter-scenario baseline, and open the error-details disclosure before checking its visible content. These corrections do not weaken the checks: successful recovery must add exactly one scenario without modifying any existing records, and rejected recovery must leave the baseline unchanged.
