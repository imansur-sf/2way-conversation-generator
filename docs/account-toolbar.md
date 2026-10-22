# Account toolbar

The studio uses the Unified Profile Generator account-menu pattern. Signed out, the toolbar shows Sign In. Signed in, it shows an initial, username, and dropdown containing the verified account email, Save Project, My Projects, and Sign Out. My Projects replaces the disclosure with a compact, nonmodal list containing project dates, Load, Delete, refresh, and close controls.

Present and Export HTML remain direct toolbar actions. Start Over restarts the preview using the existing reset action; it does not delete scenarios or local recovery. Troubleshoot replaces Menu and contains Local recovery, Recover builder, and Feedback. Local and cloud saving retain their existing boundaries and account-switch protections.

Feedback Inbox is a direct toolbar button between the account control and Start Over. It remains hidden until the feedback service verifies `imansur@salesforce.com` as the admin. The backend checks this same identity on every inbox, detail, attachment, update, and delete request; client-side visibility is not the access-control boundary. Sign-out and account changes immediately clear private inbox UI.

Feedback reuses the existing shared SaaSy Accounts feedback service: guest submissions, optional screenshots, compression, retry keys, and the existing private admin inbox. The studio proxy pins requests to `twoway`. Feedback drafts contain only explicit form input and app/version/screen context, never an automatic editor snapshot or credentials.

The original Accounts sibling checkout predates the deployed feedback tool-isolation implementation. The coordinated implementation was prepared against current shared `origin/main` commit `bab6f1e5e8f5698bb9acca5c57e60e6de6116283`, retaining the existing isolation migration and adding only the `twoway` registration. [The shared patch](shared-accounts-twoway.patch) preserves these changes independently of the temporary verification checkout. It includes both cloud-project and feedback registration; apply it to the up-to-date shared service after reconciling any existing local `twoway` project edits. Run its schema migration and deploy Accounts before releasing this studio. Do not deploy the older sibling checkout over the current service.

No deployment or production migration was performed for this toolbar change. LPG and UPG frontend files were not changed.

Verification: `npm test`, `npm run test:cloud`, `npm run test:feedback`, and `node test/workspace-browser.mjs`. The browser suites use synthetic accounts and feedback; they do not submit real feedback or read a real admin inbox.
