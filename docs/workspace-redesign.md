# Focused workspace redesign

The workspace now has five navigation destinations: Scenario, Identity, Conversation, Export, and Build with AI. The scenario name and selected channel stay above the editor, with a separate live-preview toolbar. The original top-left SaaSy Solutions logo and blue header remain intact.

`assets/v2/workspace-shell.js` moves the existing controls once and selects their containing view. The original scenario renderer, input handlers, persistence, generation jobs, channel variants, and simulator continue to own their data and behavior. `TwoWayWorkspace` is a narrow bridge for reading a workspace summary and changing the existing manual/AI setup mode. Switching modes retains the AI brief and draft.

`assets/studio-polish.css` contains the workspace styling. The shell does not mount in exported demos. The export runtime uses its existing allowlist and shipped template; the added workspace JavaScript is not an offline playback dependency.

Navigation supports keyboard activation, arrow-key movement in the rail, and the existing Alt+1–4 shortcuts. View transitions are brief and cancel when another view is selected. Reduced-motion users get immediate static changes. Hidden views leave their controls mounted, and switching between manual views preserves field values and caret positions. Important recovery warnings remain with the recovered scenario's conversation.

On narrow displays the rail becomes a compact navigation bar, alongside the existing Editor/Preview switching. Gmail responds to the preview container width, keeping Compose available in a compact icon sidebar where space permits. Presentation and export sizing continue to use the existing preview controller.

## Verification

- `npm test`: existing code-level checks.
- `npm run test:browser`: security, persistence, offline export, integrated editing, mocked AI, responsive UI, and workspace suites.
- `npm run test:workspace`: focused navigation/draft-continuity, per-view accessibility, 200% text reflow, and direct local-file checks.

Tests navigate through actual workspace buttons and disclosure summaries. Existing persistence, content, export, and playback assertions are retained. Tests use temporary browser profiles and synthetic scenarios, never a user's Chrome profile. Browser screenshots and real workflow testing are required before deployment; a generated design concept is not verification of the shipped UI.
