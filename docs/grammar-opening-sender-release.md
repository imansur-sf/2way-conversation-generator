# Grammar and first-sender production release — October 13, 2026

TaskCreate/TaskUpdate were unavailable; this ledger records completion.

- [x] Isolate grammar/sender fixes from pending narrative/branding changes and unrelated local edits.
- [x] Preserve concurrent production support-guidance release `70165552` in the candidate.
- [x] Publish immutable rollback tags and verify production release eligibility.
- [x] Pass all 195 local code-level tests and full CI browser groups.
- [x] Inspect narrow-screen sender screenshot and exercise both sender patterns with the live staging provider.
- [x] Deploy the combined candidate and verify actual production release, process, health, served control and prompt parsing.

Deployed source: `39798bcd12641253767038926a2c3e859f5affe8`, published on GitHub main. Active production release **v184**, ID `a3b37069-70bd-4cc4-bda6-74e28837404c`, current/succeeded. Web process `web-6988997544-r644q` is up. Heroku also created successful v183 from the same source; v184 superseded it. Explicit Build API build `96961163-ad55-45f8-9610-fae0ed9eb262` succeeded for this SHA. Production health and builder smoke pass with the existing `APP_VERSION=1.1.0`, environment `production`, configured model `gemini-3.5-flash`; configuration was not changed. The initial health assertion incorrectly expected staging's version label and was corrected to the preserved production value.

Rollback: production **v182**, release `15ce51eb-f634-4b42-b9c4-38a0c39cf719`, source `70165552faf8d5646bd110a4639de77c724f6fdd`, remains eligible. Annotated tag `rollback/pre-grammar-sender-v182-2026-10-13` is published. The earlier v181/35bf1fb1 rollback tag is also retained.

Final CI: [run 38435519453](https://github.com/imansur-sf/2way-conversation-generator/actions/runs/38435519453), exact source `39798bc`, succeeded for code-level, security, saved-state, downloaded exports, integrated playback, AI application, responsive/accessibility and artifact groups. The earlier run on `21b9a12` also passed. A superseded browser run caught a test-fixture omission: after reload, the setup-method chooser must be handled before reopening AI controls. This was fixed rather than weakening the visibility assertion. Narrow-screen screenshot confirms the labelled native sender select appears above the description, fits its viewport and persists the choice.

Staging: build `0cf8a6ad-7f5e-4719-9051-e3853c5d2ddf` deployed `21b9a12` as v58, release `f97c7719-d3b6-47b9-8e97-5653650e75dd`. Health/builder checks passed. Two fixed live AI jobs used exactly two provider calls: the original Priority Waste description with a synthetic example.com website generated a company-first RCS conversation in one attempt; the customer-first email generated Morgan/Riley's four-turn plain email in one attempt. No fallback or repair was used. The later merge preserved identical server, parser and provider-configuration source files. The user explicitly requested immediate production deployment and remaining tests afterward; the final combined CI completed successfully following deployment.

Content limitation: the Priority Waste live result supplied a prefilled rating of 5, rather than all five tappable rating options. A stricter survey-choice acceptance assertion therefore failed; the completed draft was inspected from cache, with unchanged provider success timestamp and no additional provider call. Sender order and grammar fixes are verified, but full survey semantics are not claimed. The rating-button omission remains separate from this deployment. The second originally planned email job passed its full acceptance checks. No further replacement AI jobs were submitted.

Production zero-provider checks against the running deployed parser confirm both straight and curly apostrophe versions of the exact description produce no scripted dialogue, retain Lauren's name and infer company-first. The deployed builder serves the new sender-control label. No live production AI request, credential/model change or browser-storage reset was performed. Existing local work was preserved.
