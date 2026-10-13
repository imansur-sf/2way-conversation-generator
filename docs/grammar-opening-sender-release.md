# Grammar and first-sender release — October 13, 2026

TaskCreate/TaskUpdate are unavailable; this ledger records deployment state.

- [x] Isolate the requested fixes on production source `35bf1fb1e6486d4a194a01f77dcb66c9bc6672bc`.
- [x] Run all 195 local code-level tests and diff checks.
- [ ] Pass the isolated CI browser gate and inspect screenshots.
- [ ] Verify staging build/release/health and bounded live-provider acceptance.
- [ ] Recheck production rollback state, deploy the verified candidate, and verify release/health.

Scope: correct apostrophe parsing, recognize company follow-ups/check-ins, avoid forcing actors from conditional sentences to open the conversation, and expose the existing labelled sender select above the description while retaining session storage and the request schema. Regression coverage includes the reported Priority Waste prompt and both apostrophe styles. The mocked generation completes with one provider attempt. Other uncommitted workspace changes and the pending branding/narrative release are excluded.

Preflight: GitHub main and production source remain `35bf1fb1`; production v181, release `d55b76d3-7cd2-47b0-bc1a-048824cc09b8`, web process up. Staging v56, release `82dbc2d8-dd99-4fa2-a781-ba5dce6ec94f`, web process up. Local browser execution lacks its dedicated Playwright Chromium installation, so browser evidence will come from the isolated CI gate. No managed Chrome settings or user storage are changed.
