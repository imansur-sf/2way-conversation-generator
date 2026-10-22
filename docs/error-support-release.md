# Error support guidance release — October 13, 2026

The user requested that error troubleshooting include: “If troubleshooting doesn’t resolve the error, feel free to Slack Imran Mansur to look into the issue.” The user then explicitly requested deployment.

Production release source is isolated from the unrelated generation changes in the working checkout. Candidate `70165552faf8d5646bd110a4639de77c724f6fdd` is based on production source `35bf1fb1e6486d4a194a01f77dcb66c9bc6672bc`. Error guidance covers AI generation/application, imports, sharing, image uploads/URLs/cropping, exporting, startup and storage failures. Success notifications retain their existing text. Most temporary error notices use a ten-second display duration.

- Local candidate tests: 192/192 passed.
- Full CI quality gate: https://github.com/imansur-sf/2way-conversation-generator/actions/runs/38432345023 — passed all seven test groups. Narrow SMS screenshot reviewed.
- Staging v57: build `ac78b4b6-7f29-4330-873a-52e3d13d4c6d`, release `828d3e84-0a1a-4705-9ff6-42718491f9d0`; exact candidate source verified. Running web dyno returned HTTP 200 health with `ok: true`, environment `staging`, version `2.0.0`, and served HTML containing the support guidance. External HTTPS access from this execution host reset the connection; runtime verification used Heroku run:inside.
- Rollback tag: `rollback/pre-error-support-2026-10-13`, published at the previous production source. Previous production v181 is the release rollback point.
- GitHub main fast-forwarded to the exact candidate; automatic Heroku production build `0fa38bb8-816b-4b79-ac81-c5c29fc00101` started.

No AI provider requests, environment changes or user-storage resets were performed. Existing downloaded demos must be regenerated for updated messages.

Production v182 succeeded: build `0fa38bb8-816b-4b79-ac81-c5c29fc00101`, release `15ce51eb-f634-4b42-b9c4-38a0c39cf719`, exact source `70165552faf8d5646bd110a4639de77c724f6fdd`. Web dyno `web-6d96878549-xj6cb` is up on v182. Its loopback health returned HTTP 200, `ok: true`, environment `production`, version `1.1.0`; both served builder HTML and modern JS contain the new support wording. Runtime check exited successfully.
