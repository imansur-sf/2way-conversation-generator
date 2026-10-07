# Regression checks

Run from the repository root with Node 20 or newer:

```sh
npm ci --ignore-scripts
npm test
```

`npm test` checks inline script parsing, pinned sanitizer integrity, backend fetch/job limits, serialization, persistence/recovery races, and established product contracts. Source-marker checks remain for existing features; new failure-path coverage uses executable behavior tests.

## Browser gate

The **Studio quality gate** GitHub Actions workflow installs Playwright's dedicated Chromium, then runs `npm run test:browser`. It runs on pull requests and `codex/**` branches, without production credentials or a deployment step.

The browser gate runs these suites in order:

1. `test/security-browser.mjs`: imports, shared/saved markup, clipboard/drop sanitization, unsafe IDs/CTA schemes, custom HTML isolation.
2. `test/state-browser.mjs`: save/reload, hydration ordering, recovery, image ownership, delayed replies, invalid imports and storage failure.
3. `test/export-browser.mjs`: actual downloads in all channels/email modes, offline dependencies, future-message images, CSS/SVG/media, failure warnings and mandatory runtime assets.
4. `test/e2e-local.mjs`: migrations, email sequencing, editing, carousel/crop controls, channel switching/isolation, save and exported controls.

All scenarios and external-media responses are synthetic. Local servers use temporary test ports; tests do not read or reset real browser profiles. Remote AI calls are not part of this gate. A live-provider smoke and staging review remain separate release checks.

For a permitted local test environment, install the test browser with `npx playwright install chromium`, then run `npm run test:browser`. `CHROME_PATH` may select an explicitly permitted browser binary. **Do not change or bypass managed browser policies**; use CI when local automated debugging is restricted.

## Release rule

A green test gate is necessary, not proof that every possible scenario works. Do not promote production until the phase checkpoint is recorded, staging/provider smoke limitations are addressed, and the rollback release is verified. See [the delivery ledger](two-phase-delivery.md).
