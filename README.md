# Two-Way Experience Studio

This repository is the production release candidate for the Two-Way Experience Studio. It retains compatibility with browser-saved 1.0 scenarios while providing the validated modern workspace and AI-generation improvements.

## Environments

- **Offline export:** Downloaded HTML must work without a server.
- **Local hosted:** `npm start` provides the API required for AI generation and remote image loading.
- **Release candidate:** Validate the candidate in an isolated Heroku app before promoting the same commit to production.

Current production URL: `https://saasysolutions-2way-generator-d5d5517bce22.holly-virginia.herokuapp-internal.com/`

The production app runs in a Heroku Private Space. Its trusted-IP policy means it is available only from an approved corporate network or VPN egress range.

See [the code map](docs/2.0-code-map.md) for the module boundaries and compatibility approach.

## Local setup

1. Use Node 20 or newer.
2. Copy `.env.example` to `.env` and set `GEMINI_API_KEY` when testing AI generation.
3. Run `npm test`.
4. Run `npm start`, then open `http://localhost:3000`.

The server reads environment variables directly. Load `.env` through your shell or local environment manager; `.env` is intentionally not committed.

## Hosted smoke test

After deploying the staging app:

```sh
BASE_URL=https://YOUR-RELEASE-CANDIDATE.herokuapp.com node scripts/smoke-hosted.mjs
```

This confirms that the deployed service is staging 2.0, serves the builder, and exposes health/AI configuration status without sending an AI request.

To exercise the complete AI job path after a key/model change, run this inside the deployed app. It sends one fixed, non-sensitive acceptance prompt and prints no key or response copy:

```sh
heroku run --app YOUR-RELEASE-CANDIDATE -- /bin/sh -lc "npm run test:ai:live"
```

## AI review safeguards

The AI setup accepts optional precision controls for the opening sender and exact total message count. Along with the user’s prompt, the server validates named people, topics, handoffs, quoted/ordered turns, and the requested total before the draft reaches review. The builder’s Scenario QA panel then reports the actual company/customer counts, starting sender, empty company messages, sequential company delivery, and unavailable images before preview or export.

## Release rules

1. Preserve a Git tag and Heroku release rollback point before every production deployment.
2. The application imports valid 1.0 browser saves on first use and mirrors saves in the 1.0 format during the stabilization window. Do not delete the legacy browser keys during that window.
3. Do not commit credentials, downloaded scenarios containing sensitive information, or generated exports.
4. Run unit tests, local manual checks, hosted smoke checks, AI acceptance scenarios, and exported-HTML checks before production promotion.
5. Configure `GEMINI_API_KEY` directly in Heroku before running AI acceptance tests. Do not copy or display a credential through source control or shell output.
6. Keep `GEMINI_MODEL` pinned to a model enabled for the production Google project and validate it with the live acceptance test before cutover.

## Current storage boundary

2.0 protects in-progress scenarios with local storage, IndexedDB mirroring, version snapshots, JSON import/export, and standalone exports. Generation jobs are intentionally transient: they are capped in memory and expire after 15 minutes. This is reliable for a single staging session, but it is not multi-user cloud persistence.

Before a production release, choose and provision a managed database and object storage owned by the production environment. That decision determines user access controls, retention, backup policy, and cost, so this staging rebuild does not silently create those services.
