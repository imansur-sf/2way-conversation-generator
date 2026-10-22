# Dialogue apostrophe correction

TaskCreate/TaskUpdate tools are unavailable in this session; this file records the implementation and verification steps.

- [x] Diagnose the false `invalid_dialogue` error from ordinary possessive prose.
- [x] Correct quote recognition and cover prose, names, contractions, genuine dialogue, and genuinely unfinished quotes.
- [x] Run scoped backend checks and the complete local code-level suite.

The quoted-dialogue parser previously interpreted the straight apostrophe in `company's AI agent` as an opening single quote after the company role. An unmatched apostrophe raised the closing-quote error; a second possessive could silently turn prose into exact dialogue. The correction ignores single-quote openings immediately following a Unicode letter, combining mark, or number, requires a role word boundary, and preserves internal word apostrophes for both straight and curly single-quoted messages. Submitted text is not rewritten.

Regression cases cover the reported Priority Waste description with both apostrophe styles, multiple possessives, every supported role, contractions, named speakers containing apostrophes, quoted messages with internal apostrophes, and unfinished scripted quotes. Request validation uses the actual backend entry point with a mocked network/provider and verifies no network calls during input validation. This does not establish which character the affected user actually submitted or verify live AI generation.

Validation: 61 scoped backend tests passed; all 242 local code-level tests passed; `git diff --check` passed. No live provider requests or deployment were made. Existing unrelated workspace edits were retained.
