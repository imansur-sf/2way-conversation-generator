# Two-Way Experience Studio: quality audit and improvement plan

Date: October 7, 2026

## Recommendation

Keep the current product and improve it in small, tested releases. A wholesale rewrite is not necessary to address the most important problems. Prioritize unsafe HTML handling, save reliability, and export/content correctness before adding more features or redesigning the builder.

The ordinary conversations work in the tested paths, and several previously reported issues are now fixed. However, targeted failure tests found real defects that the existing passing test suite does not detect. In particular, there are conditions where work can be reported as saved without a surviving copy, delayed image operations can affect the wrong scenario, and an export can either omit images or fail to start.

This was an analysis-only engagement. No application fixes, commits, production deployments, real-user/production storage resets, or live AI requests were performed. Recovery tests used disposable synthetic storage. The only repository addition from this audit is this report. The pre-existing export-filename edit was preserved.

## Scope and confidence

- Production repository: `imansur-sf/2way-conversation-generator`, local checkout `/Users/imansur/claude/two-way-sms-email-generator/production-diagnosis`.
- Local HEAD and GitHub main both resolved to `d8d8e2d6ade2118c192f2cf053d59ae5ab19e32d`.
- Heroku reported successful production release **v180**, deploying `d8d8e2d6`.
- Local working copy differs by an existing change adding the channel to downloaded filenames. Behavioral tests used that working copy.
- Tests used synthetic data in isolated local Chrome contexts. No actual customer scenarios were edited or read from a user's browser profile.
- Browser findings are distinguished from source-function reproductions and static risks below.
- The production URL redirected to authentication from this environment. Authenticated production UI, actual Google-provider quality, Safari/Firefox, real mobile devices, and full manual assistive-technology coverage remain unverified.

“Test everything” should become an explicit maintained coverage matrix, not a claim that a finite audit proves every possible scenario safe. The release gates below define that matrix.

## What was tested

| Area | Result | Scope / limitation |
| --- | --- | --- |
| Existing unit/integrity suite | **70/70 passed** | Many frontend/backend checks assert source strings rather than user-visible behavior. Passing is not sufficient evidence of correctness. |
| Existing end-to-end suite | **Did not complete successfully** | It stopped in recovery testing at `test/e2e-local.mjs:58`, waiting for a `<select>` option to be visible. Options existed in the DOM. The run ultimately reported a closed browser. This is not a full regression pass. |
| SMS, RCS, WhatsApp, Email conversations | **Passed tested sequences** | Opening company message, two customer replies, both subsequent company replies, and prefilled messages. Synthetic five-step flows, not every routing branch. |
| Ordinary editor operations | **Passed tested paths in all four channels** | Company avatar Use URL field opens; local avatar upload, adding customer/company steps, and normal save/reload succeed. Email's bottom add-response buttons passed. These do not negate the failure-condition findings below. |
| RCS image adjustment and live editing | **Passed focused checks** | Editing a card title updated the preview; the existing adjustment dialog opened with a measured 580×232 (5:2) frame. Crop/export consistency still requires the larger acceptance matrix. |
| Downloaded HTML controls | **19/19 checks passed** | Actual `file://` exports: open, reset, focus, present/Escape in all four channels; basic replies in SMS/RCS/WhatsApp. Presentation is app presentation mode, not browser fullscreen. |
| Email content modes | **Failures reproduced** | Plain-text opening can show stale body; branded rich HTML and Custom HTML snippets can differ from the rendered email. |
| Export robustness | **Failures reproduced** | Literal-content serialization, closing-script identifier, missing later images, global text replacement, unrelated scenario metadata. |
| Save/import/state failures | **Seven source-function reproductions completed** | Simulated storage failures and asynchronous completions execute actual extracted application functions. A delayed-image wrong-scenario write was additionally reproduced in Chrome. |
| AI backend semantics | **Failures reproduced with mocked provider responses** | Complete local generation pipeline and job functions, not a live model-quality evaluation. |
| HTML security | **Browser reproduction confirmed** | Harmless marker execution through imported/shared branded email HTML. Custom HTML's sandbox blocked the same marker. |
| Rendering and accessibility | **Issues found** | Chrome/axe on rendered conversations; desktop plus laptop/tablet/narrow-screen checks. Not a formal accessibility certification. |

The existing suite's recovery wait should use an appropriate attached/count/content assertion rather than require a native option to be visibly painted. Its older storage-mirroring assertions also need reconciliation with the intended storage contract—not simply deletion to make tests green.

## Findings that should drive the first releases

### 1. P1 — Imported or shared branded email HTML can execute code

**Confirmed in Chrome.** The branded-email HTML sanitizer removes script tags and only some event-handler forms. A single-quoted handler survived and executed in the builder origin after both a scenario JSON import and opening a scenario share link. The proof set a harmless boolean; it did not access or transmit user data.

This matters because same-origin code can potentially access browser-saved scenarios. Exploitation requires a user to import/open attacker-controlled content. The separate **Custom HTML** mode remained inside its restrictive iframe sandbox and blocked the identical test; it should not be confused with this vulnerability.

**Fix:** Use a maintained DOM-based allowlist sanitizer consistently at rich-HTML import, sharing, editing, preview, and export boundaries. Restrict active elements, event attributes, and URL schemes. Preserve the Custom HTML sandbox. Add a compatible Content Security Policy as defense in depth.

**Acceptance:** Malicious markup in saved scenarios, imports, share links, previews, and exports cannot execute; normal bold/list/link formatting still works. Test single-, double-, and unquoted attributes, encoded URLs, SVG, and active embeds.

Source: [richEmailHtml](/Users/imansur/claude/two-way-sms-email-generator/production-diagnosis/interactive-simulator-builder.html:415), [share ingestion](/Users/imansur/claude/two-way-sms-email-generator/production-diagnosis/interactive-simulator-builder.html:403), [editor insertion](/Users/imansur/claude/two-way-sms-email-generator/production-diagnosis/interactive-simulator-builder.html:670).

### 2. P1 — A failed save can be reported as successful

**Confirmed using actual storage functions with simulated failure.** Above 420,000 serialized characters, `writeSmallLocalCache` removes the small local cache but returns the same result as a successful write. If IndexedDB also fails, `persist()` returns success, clears pending edits, and claims the small backup was saved—even though it does not exist.

There is also misleading copy in the opposite case: successful IndexedDB storage with a failed small cache is shown inside a banner saying changes were not saved.

**Fix:** Model storage outcomes explicitly: durable database saved, fallback saved, skipped due to size, and failed. Clear dirty state only for the exact revision successfully written to a real store. Show truthful persistent status, distinguish recovery-point failures from current-draft failures, and retain a one-click JSON rescue action.

**Acceptance:** Above/below the size boundary, quota errors, denied storage, IndexedDB failure, and reload are tested. “Saved” always means a reload can recover the corresponding revision. No failed save clears the unsaved warning.

Source: [cache write](/Users/imansur/claude/two-way-sms-email-generator/production-diagnosis/interactive-simulator-builder.html:883), [persistence](/Users/imansur/claude/two-way-sms-email-generator/production-diagnosis/interactive-simulator-builder.html:888).

### 3. P1 — Late startup recovery can replace newer work

**Confirmed source-function reproduction.** IndexedDB hydration replaces the current scenarios without comparing revisions or protecting edits/imports that happened while the read was pending. A delayed old record replaced both newer cached work and a newly loaded shared scenario.

**Fix:** Establish one initialization/reconciliation path; validate/migrate records first, compare revisions, and do not activate stale state after editing starts. Apply shared/imported scenarios after initial reconciliation, or merge them transactionally with an explicit policy. Never silently pick an older record merely because its request completed later.

**Acceptance:** Slow database + fast typing; slow database + share link/import; newer cache + older database; malformed durable data; and interrupted migration retain the newest valid work.

Source: [hydrateDurableScenarioState](/Users/imansur/claude/two-way-sms-email-generator/production-diagnosis/interactive-simulator-builder.html:892).

### 4. P1 — An image request can finish in the wrong scenario/channel

**Confirmed in Chrome and source-function tests.** Start applying an avatar URL in scenario A, switch to scenario B while it loads, then finish the request: B receives A's image. Image completion calls `active()` instead of retaining the initiating target. Upload completion follows the same target-selection pattern.

This can look like channel isolation or saving failed even when the synchronous channel-switch logic is correct.

**Fix:** Capture scenario ID, channel ID, step/card ID, and operation generation at the start. Apply only to that still-valid target. Ignore/cancel stale operations after replacement/deletion; do not let an older request overwrite a newer image choice.

**Acceptance:** Delayed URL and upload tests cover channel/scenario changes, deletion, two competing requests, and removing an image before an earlier request completes.

Source: [setImageAssetValue](/Users/imansur/claude/two-way-sms-email-generator/production-diagnosis/interactive-simulator-builder.html:531), [async controls](/Users/imansur/claude/two-way-sms-email-generator/production-diagnosis/interactive-simulator-builder.html:533).

### 5. P1 — Certain user content breaks standalone export

**Confirmed with actual downloads.** A literal `$&` in message text is interpreted by JavaScript's string-replacement mechanism while assembling the export. The generated file then has invalid scenario JSON and stays on its startup state. An accepted scenario ID containing a closing script tag independently breaks the inline script because that ID bypasses the data escaping.

**Fix:** Use safe data serialization and replacement callbacks, not user-controlled replacement strings. Keep selected IDs inside the safely encoded data payload rather than interpolating them into executable code. Validate the generated document before offering it as a successful export.

**Acceptance:** Round-trip literal dollar replacement tokens, closing-script text, quotes, backticks, emoji, Unicode, and imported IDs. Parse all executable script blocks and actually launch the downloaded file in a browser.

Source: [standalone assembly](/Users/imansur/claude/two-way-sms-email-generator/production-diagnosis/interactive-simulator-builder.html:716).

### 6. P1 — Export only packages some of the needed images

**Confirmed with actual downloads.** Exporting from the inbox omitted an email logo and an image used by a later reply. Those images were not in the currently rendered stage. The downloaded file attempted relative `file:///.../assets/...` paths; one image silently disappeared and another was broken. No missing-image warning was raised.

The exporter also replaces asset path strings across the entire HTML document, which can change literal message text. It clones hidden builder markup containing another scenario's name, and retains analytics/backup/bootstrap script references unnecessary to playback.

**Fix:** Build an asset manifest from the complete selected-channel scenario and playback UI, including future steps, CSS assets, branded HTML, and Custom HTML. Rewrite only typed asset fields and parsed attributes/CSS URLs. Generate a clean standalone shell with selected data only; do not clone the builder document.

**Acceptance:** Export from inbox and opened thread; traverse every branch/reply with networking disabled; verify image decoding. Literal message text is unchanged, unrelated scenario data is absent, and no builder/API dependencies are requested. Missing assets identify their exact channel/step/field and offer **Fix**, **Retry**, or an explicitly warned **Download anyway**.

Source: [asset discovery and assembly](/Users/imansur/claude/two-way-sms-email-generator/production-diagnosis/interactive-simulator-builder.html:713).

### 7. P1/P2 — Email previews still have multiple competing content sources

**Confirmed in browser previews/exports.** A plain opening email can display old scenario-level `emailBody` even though its inbox snippet uses updated first-step text. Custom HTML and branded rich HTML render their HTML but the inbox snippet prefers leftover `step.text`.

**Fix:** Create one mode-aware effective-message resolver used by the editor, inbox snippet, opened message, QA panel, and export. Define content precedence explicitly for plain, branded, and Custom HTML; derive plain snippets from the content actually rendered. An intentional blank should not revive stale text. Preserve explicit preheaders if offered as a separate user-controlled field.

**Acceptance:** For every mode, edit the opening and subsequent emails, switch modes, reload, import/export, and compare the effective content in every surface. Cover company-first and customer-first conversations and empty content.

Source: [snippet selection](/Users/imansur/claude/two-way-sms-email-generator/production-diagnosis/interactive-simulator-builder.html:428), [email row construction](/Users/imansur/claude/two-way-sms-email-generator/production-diagnosis/interactive-simulator-builder.html:431), [opening override](/Users/imansur/claude/two-way-sms-email-generator/production-diagnosis/interactive-simulator-builder.html:675).

### 8. P1 — AI repair can invent a name and replace the user's dialogue

**Confirmed through the complete local generation path with a mocked provider.** A prompt containing “Customer says” was interpreted as naming the customer “says.” Even when the mocked provider supplied the requested dialogue correctly, later repair replaced it with generic turns beginning “Hi says!” and returned success without a fallback explanation.

The backend also accepts an empty JSON object as a complete, cacheable zero-turn result. A request for exactly four messages can return five while reporting `complete=false` without rejecting the draft.

**Fix:** Treat explicit user dialogue and named facts as immutable constraints. Separate structured facts from instructions and scraped evidence. Validate schema and final semantic requirements after every transformation; never cache or label an invalid/empty draft successful. Show which constraints need attention and whether a fallback was used.

**Acceptance:** Quoted transcripts, unnamed customers, real names, apostrophes, Unicode, exact counts, starting sender, handoffs, malformed provider JSON, and empty replies have full-pipeline tests. No verb becomes a name; specified copy/order survives unchanged.

Source: [name extraction](/Users/imansur/claude/two-way-sms-email-generator/production-diagnosis/server.js:194), [repair pipeline](/Users/imansur/claude/two-way-sms-email-generator/production-diagnosis/server.js:428), [final result handling](/Users/imansur/claude/two-way-sms-email-generator/production-diagnosis/server.js:431).

### 9. P1/P2 — Backend boundaries need hardening

These are local mocked/source findings, not attacks against production:

- **Rate limiting:** 100 requests with a changing leftmost forwarded IP were accepted while the rightmost observed IP stayed constant. Heroku documents appending its observed IP on the right; the risk applies unless another trusted upstream strips/sanitizes incoming values. Use trusted-proxy-aware attribution and identity/session quotas. [Heroku routing documentation](https://devcenter.heroku.com/articles/http-routing).
- **Job admission:** 122 mocked never-finishing jobs all began. The map-size limit is not a concurrency limit, and an active job lost its polling record. Enforce a bounded queue/provider concurrency cap; never evict active records.
- **Idempotency:** Reusing a key with a different request body returns the earlier job. Bind keys to requester and request fingerprint, rejecting mismatches. Define restart/multi-instance behavior before scaling beyond a single process.
- **SVG proxy:** The raw asset endpoint returns an upstream scripted SVG unchanged on the application origin without document isolation. This is an active-document navigation risk; scripts do not run merely because an SVG is displayed in an ordinary image element. Response behavior was verified; browser exploitation was not attempted. Sanitize/rasterize or serve untrusted assets from an isolated origin.
- **Static serving:** A request to `/server.js` returns the complete source. No secret exposure was tested or claimed. Restrict static serving to public assets; deny internal files/dotfiles.
- **Remote fetches:** The IP classifier misses some nonpublic/mapped ranges; DNS validation and connection resolution are separate. Private-network access was not attempted. Add robust address classification, validated connection binding, redirect limits, and a total timeout including DNS.

Sources: [rate key](/Users/imansur/claude/two-way-sms-email-generator/production-diagnosis/server.js:39), [remote validation](/Users/imansur/claude/two-way-sms-email-generator/production-diagnosis/server.js:47), [jobs](/Users/imansur/claude/two-way-sms-email-generator/production-diagnosis/server.js:438), [asset endpoint](/Users/imansur/claude/two-way-sms-email-generator/production-diagnosis/server.js:527), [static files](/Users/imansur/claude/two-way-sms-email-generator/production-diagnosis/server.js:548).

### 10. P2 — Runtime, import, restore, and recovery consistency

Additional actual-source reproductions found:

- A pending company-reply timer can insert an old scenario's answer after switching/resetting. Use a runtime generation token and cancel pending callbacks.
- Reset can retain the editor's focused future message in the rendered thread. Separate “preview this edited step” from “play the conversation”; reset/present should start a clean playback state.
- Importing a set containing a valid scenario followed by an invalid entry partially mutates the workspace before reporting import failure. Validate/migrate the whole set, remap IDs, then apply atomically.

Static risks requiring integration tests:

- Recovery clears small local stores without a unified treatment of primary IndexedDB records.
- A separate legacy-backup reader can race a newer save at function level; actual full-app reachability is not established.
- There is no demonstrated multi-tab revision/conflict protection.
- Only three restore points are retained globally, although the restore selector is scenario-specific. Saving another scenario can prune the first scenario's history.

Sources: [reply scheduling](/Users/imansur/claude/two-way-sms-email-generator/production-diagnosis/interactive-simulator-builder.html:230), [imports](/Users/imansur/claude/two-way-sms-email-generator/production-diagnosis/interactive-simulator-builder.html:220), [editor-focused preview](/Users/imansur/claude/two-way-sms-email-generator/production-diagnosis/interactive-simulator-builder.html:840), [restore points](/Users/imansur/claude/two-way-sms-email-generator/production-diagnosis/interactive-simulator-builder.html:884), [legacy backup](/Users/imansur/claude/two-way-sms-email-generator/production-diagnosis/assets/v2/scenario-backup.js:36).

## Personalization and content-quality improvements

The current generation entry point forces an SMS-oriented prompt and then clones/adapts it into the requested channels. In the mocked email+RCS probe, the result had a default email subject, empty email-specific fields, and no rich cards. This is a confirmed capability gap, not evidence of a live model hallucination.

Recommended design:

1. **Shared story, independent channel content.** Store shared brand facts, recipient, intent, offer, and constraints explicitly. Generate each requested channel's presentation from that story. After creation, channel edits remain isolated unless the user deliberately chooses “Copy to another channel.”
2. **A persona and facts panel.** Company name, customer name/pronunciation if needed, role, location, product/service, offer, agent/handoff name, contact details, and demo clock. Never guess missing names from prose such as “customer responds.”
3. **Typed personalization tokens with preview values.** Show unresolved fields outside the simulation with “Set a sample value” or “Use this fallback.” Preserve tokens in the intended export mode, but avoid accidentally showing raw template syntax in a demo.
4. **Channel-specific output.** SMS gets concise text; RCS gets purposeful cards/actions; WhatsApp gets an appropriate message structure; email gets a relevant subject, optional preheader, body and CTA. Do not force rich media when the user requests plain text or exact dialogue.
5. **Grounded claims.** Separate user-supplied facts, website-supported facts, and unknowns. Current scraping only takes limited content from one page, so navigation can crowd out useful facts. If research fails but a complete user brief exists, offer to proceed from the brief with a clear notice. Validate generated links/images against allowed/source candidates.
6. **Honest review.** Replace generic “ready” assurances with specific checks: required facts found, unresolved placeholders, unmatched routing, empty responses, image availability, and whether export was actually validated.
7. **Realistic demo defaults.** Align recipient names, sender identity, avatar, subject, contact entries, and timestamps. Current Gmail examples include fixed dates with relative labels; a configurable demo clock would prevent contradictions.

Source: [generation channel selection](/Users/imansur/claude/two-way-sms-email-generator/production-diagnosis/server.js:421), [website extraction](/Users/imansur/claude/two-way-sms-email-generator/production-diagnosis/server.js:125), [QA panel](/Users/imansur/claude/two-way-sms-email-generator/production-diagnosis/assets/v2-modern.js:132).

## Rendering, image handling, and UI/UX improvements

### Fit the preview to the available space

Measured in Chrome at 1280×720, the SMS phone extended to about y=893 and WhatsApp to y=888: users must scroll to reach the bottom. At 390px width, the header's contents measured 506px wide; Gmail content measured 473px inside a 338px viewport. At tablet/narrow widths the long editor pushed the preview almost or completely below the initial viewport. These measurements are not claims about every user's browser.

**Improve:** Default to auto-fit using both available width and height, with manual zoom override. Keep preview actions below the app header and reachable. Use a resizable split view on desktop; use explicit Editor/Preview tabs on tablet/phone. Collapse secondary header actions into a menu. Keep the email shell responsive and make any intentional inner scrolling apparent.

Evidence: [laptop email screenshot](/private/tmp/twoway-audit-2026-10-07/email-1280.png), [narrow-screen header screenshot](/private/tmp/twoway-audit-2026-10-07/email-390.png).

### Extend the existing image adjustment experience

The code already includes an RCS image-adjustment dialog. Build on that rather than introduce a second crop system:

- Show the exact destination frame and title overlay, with clear **Fill/crop** versus **Fit entire image** choices.
- Offer reposition, zoom, reset, undo/cancel, and keyboard-operable adjustments. Preserve the original asset and crop settings independently per card/channel.
- Show source dimensions, destination ratio, effective crop, and a soft warning when upscaling is likely to look soft. Guidance should describe this simulator's layout, not imply one universal RCS ratio.
- Carry the same framing into preview, saved scenarios, restore points, and standalone exports.
- Extend equivalent framing to circular avatars and email hero images where appropriate; show background/letterboxing choices when fitting a portrait into a wide frame.
- Keep warnings and authoring labels outside the simulated phone/Gmail content.

### Simplify saving and editing confidence

- One primary **Save all changes** action for all channel variants. Autosave status visible near the editor, with last-successful time and clear device-local wording.
- **Create restore point** is an optional milestone, not a second ambiguous save button. Restore points should be scoped and labeled per scenario.
- Persistent save failure banner with the failing store/cause and an export rescue action; no subtle success-like failure state.
- Warn on leaving only when a user edit genuinely differs from the last successfully persisted revision. Do not mark channel navigation or rendering as edits.
- Optional cloud persistence is a separate product/security decision: account ownership, access control, retention, cost, backup policy, and migration need approval. Do not describe browser storage as a cloud backup.

### Accessibility and interaction quality

Rendered-screen axe checks found two unnamed simulated-keyboard controls (Shift and Backspace), an invalid ARIA label on signal bars, and contrast failures. Examples: SMS green reply text measured about 2.16:1; channel metadata about 2.78:1; some Gmail navigation text was also below the automated check's threshold. These are scoped findings, not an overall accessibility score.

**Improve:** Name icon-only controls, use correct decorative/semantic roles, adjust contrast while retaining recognizable channel styling, and test keyboard navigation, visible focus, modal escape/return-focus, image-adjustment alternatives, zoom, reduced motion, and screen-reader save/error announcements. Test editor and exported playback separately.

## Execution plan

Each phase should be a bounded change set with regression evidence. Security containment can ship independently of the broader redesign; do not hold it until all enhancements are complete.

The numbered phases describe workstreams, not a requirement to finish all backend hardening before repairing saves. Ship truthful save results and hydration protection as small urgent patches alongside security containment. Do not make them wait for a new storage architecture or schema migration.

### Phase 0 — Establish a trustworthy baseline

- [ ] Capture a Git rollback tag and the current Heroku release identity before subsequent implementation/deployment.
- [ ] Turn the confirmed failures above into permanent behavioral tests; use synthetic fixtures only.
- [ ] Repair the end-to-end harness, bounded timeouts, cleanup, and recovery assertions; require an actual completed exit status.
- [ ] Parameterize hosted smoke tests by expected environment/version. Current smoke assumes staging/2.0.0 while app metadata defaults to production/1.1.0.
- [ ] Record safe build/release ID in diagnostics so a user can tell which deployment loaded.

**Gate:** The baseline suite completes, known defects fail deterministically for the expected reason, and the existing 70 tests still pass. No production behavior change is required for this phase.

### Phase 1 — Security and backend resource containment

- [ ] Fix branded-email import/share/render sanitation and retain Custom HTML sandboxing.
- [ ] Restrict public files and isolate/sanitize untrusted SVG output.
- [ ] Correct proxy-aware quotas, bound expensive asset requests, and add real generation concurrency/backpressure.
- [ ] Close remote-address validation gaps with controlled local network tests; never probe private production resources.

**Gate:** Safe-marker security fixtures do not execute, normal supported content remains usable, internal files return 403/404, and excess jobs do not start provider work.

### Phase 2 — Saving and channel/scenario isolation

- [ ] Introduce a revisioned scenario store with explicit save outcomes and one recovery/migration contract.
- [ ] Reconcile startup sources before editing; prevent late reads from replacing newer state.
- [ ] Capture asynchronous image targets; cancel/ignore stale image and conversation callbacks.
- [ ] Make import atomic; scope restore history appropriately; add multi-tab conflict handling.
- [ ] Make save/dirty/recovery UI reflect acknowledged persisted revisions, not rendering activity.

**Gate:** Storage failure, oversized images, slow initialization, channel switching, competing edits, import, restore, and reload cannot silently lose or move work. Preserve original records until their replacements are validated and successfully committed; test interruption and quota failure during migration. Do not retire either IndexedDB source merely because new code loaded.

### Phase 3 — One content model for preview and export

- [ ] Implement the effective-message resolver across all email modes and other channel summaries.
- [ ] Replace unsafe export assembly with safely serialized data and a clean playback shell.
- [ ] Build the complete selected-channel asset manifest and structured URL rewriting.
- [ ] Add precise asset preflight with retry/fix/download-anyway choices.
- [ ] Separate editor-focused preview state from playback/reset/presentation state.

**Gate:** Text is identical where intended across editor, inbox/list, opened conversation, and export; later replies and images work offline; no unrelated scenario data is embedded; reset/focus/present continue to pass in all four exports.

### Phase 4 — Relevant AI and dependable generation jobs

- [ ] Add a shared typed request/result schema and final semantic acceptance gate.
- [ ] Preserve exact supplied dialogue; replace fragile name inference with explicit persona fields and safe parsing.
- [ ] Generate channel-specific presentation from shared facts without overwriting already customized variants.
- [ ] Bind idempotency to requester/content; preserve accepted jobs until completion and define restart behavior.
- [ ] Unify runtime/provider smoke configuration and distinguish key presence from actual provider readiness.
- [ ] Run an authorized, bounded live-provider evaluation in staging using non-sensitive prompts after offline tests pass.

**Gate:** A fixed evaluation set passes required speaker/count/fact constraints, empty output never succeeds, fallbacks are clearly identified, and all four generated channels are meaningfully usable. Review relevance manually; schema validity alone is insufficient.

Runtime/app defaults currently use `gemini-3.5-flash`, while the provider smoke defaults to `gemini-3.6-flash`. This proves configuration drift, not the deployed model value or a retirement outage. Use one configured model and validate it. Google supports schema-constrained output, but server-side semantic checks are still needed. [Google structured-output documentation](https://ai.google.dev/gemini-api/docs/structured-output).

### Phase 5 — Rendering, accessibility, and editing UX

- [ ] Add responsive auto-fit, a resizable desktop split, compact navigation, and narrow-screen Editor/Preview switching.
- [ ] Improve the existing image editor with true destination framing, quality guidance, undo/cancel, and consistent export treatment.
- [ ] Add persona/placeholder review and coherent demo timestamps.
- [ ] Resolve audited accessible names/roles/contrast; manually test keyboard, zoom, and screen readers.
- [ ] Replace vague QA readiness labels with actual check results and location-specific fix links.

**Gate:** Representative short/long content, portrait/wide images, long brand names, missing assets, and 200% zoom remain usable. Preview controls do not cover message content; builder-only notices never appear inside a simulated conversation.

### Phase 6 — Reduce regression risk incrementally

- [ ] Extract scenario schema/storage, conversation runtime, image pipeline, channel renderers, and exporter into tested modules one boundary at a time.
- [ ] Eliminate the chain of late function redefinitions after each extracted boundary has parity tests. The current large inline HTML file makes order-dependent regressions difficult to isolate.
- [ ] Replace source-marker-only assertions with behavior tests, keeping useful syntax/integrity checks as supplementary coverage.
- [ ] Add CI gating and scheduled/manual fixture sweeps as an explicit follow-up decision, not an unrequested automation.
- [ ] Update README, package metadata, environment names, storage documentation, and smoke scripts to reflect production versus staging accurately.
- [ ] Profile large scenarios before optimizing; repeated whole-document hydration and embedded image copies are suspects, not measured performance regressions from this audit.

**Gate:** Module extractions do not change saved-schema meaning or exported behavior. Documentation matches what the application actually guarantees.

## Release and rollback policy

Continue using the original 1.0 URL/repository as production and the separate 2.0 Heroku space for staging major changes. Avoid maintaining two independently diverging implementations of the same fix; validate a bounded patch on staging and promote that tested patch/commit to production with environment-specific configuration kept separate.

Before each release:

1. Run unit, integration, browser, and actual-download tests to completion.
2. Run authenticated staging smoke tests and the bounded AI evaluation where relevant.
3. Test migration with disposable copies of old-format, multi-channel, image-heavy, and malformed scenarios. Do not reset real user browser data as a test.
4. Capture rollback code/release references, deploy, and confirm the live release identifier—not just that GitHub received a push.
5. Recheck new-profile and existing-profile startup, save/reload, two-turn replies, and downloads on the production artifact.

**Important:** A Git or Heroku rollback restores application code, not a user's browser data. Storage migrations need preserved records, versioned schemas, and an explicit rollback/forward-recovery strategy. A deployment rollback must not make newer saved data unreadable or silently overwrite it.

This compatibility needs testing now: the current save code deletes the old v1 scenario/history mirrors, despite earlier comments and README text promising mirroring. Test the actual proposed rollback build against new saves; a Git tag alone does not establish data compatibility.

### Required acceptance matrix

- Four channels; company-first and customer-first; guided and keyword routing; no-match/fallback/repeat cases; multiple company responses after one customer reply.
- Email plain/branded/Custom HTML; mode changes; long text; opening and later replies; empty bodies/preheaders; no duplicated opening.
- RCS text/rich card/carousel; no CTA, blank/whitespace CTA, separate/centered CTA; one/many cards; swipe/buttons; no content overlap.
- Every avatar, logo, hero and card image source: upload, URL, remove, adjust; pending/failing requests; channel switch mid-operation; offline export.
- Save all, autosave, optional restore point, reload, legacy migration, quota/denied storage, slow database, multiple tabs, import/export/share, interrupted recovery.
- Actual standalone files opened without a server/network, from different initial builder views, traversing all fixture branches.
- Browser startup/console errors, keyboard/focus, accessibility scans, 1280×720 and larger desktops, tablet/narrow layout, 200% zoom; then Safari/Firefox and representative real devices.
- Mocked AI malformed output/errors/timeouts/429/retries/jobs; authorized staging live-provider relevance evaluation.

No claim of complete readiness should be made while any P1 regression above remains unaddressed. Less critical visual refinements can ship afterward without bundling them into risky all-at-once changes.

## Evidence and repeatability

Temporary audit fixtures and results are retained locally for follow-up; they contain synthetic data and are not part of the deployed application:

- [Rendered UI/axe runner](/private/tmp/twoway-ui-audit.cjs) and [results directory](/private/tmp/twoway-audit-2026-10-07).
- [Editor controls and delayed-image probe](/private/tmp/twoway-editor-audit.cjs).
- [Seven storage/state function probes](/private/tmp/twoway-state-audit.RXZ8au/probe.cjs).
- [Export content/asset probe](/private/tmp/export-integrity-audit.mjs) and [export controls probe](/private/tmp/export-controls-audit.mjs).
- [Backend findings, references, acceptance criteria](/private/tmp/backend-audit.k2zOyM/report.json), [backend results](/private/tmp/backend-audit.k2zOyM/results.json), and [safe-marker browser security probe](/private/tmp/backend-audit.k2zOyM/browser-security-probe.cjs).

Some broad browser runs were interrupted by browser closure. Findings are based on completed individual checks/reruns or separately reproduced functions, not an assertion that interrupted runs passed. Temporary runners should be converted into maintainable repository tests during Phase 0; they are not a substitute for that work.
