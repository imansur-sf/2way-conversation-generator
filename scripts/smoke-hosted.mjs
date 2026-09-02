import assert from 'node:assert/strict';

const baseUrl = process.env.BASE_URL;
assert.ok(baseUrl, 'Set BASE_URL to the deployed 2.0 app URL, for example https://your-app.herokuapp.com');
const target = new URL(baseUrl);
const health = await fetch(new URL('/api/health', target));
assert.equal(health.status, 200, 'The health endpoint must respond successfully');
const payload = await health.json();
assert.equal(payload.ok, true, 'Health response must report ok');
assert.equal(payload.version, '2.0.0', 'Hosted app must be the 2.0 deployment');
assert.equal(payload.environment, 'staging', 'Hosted smoke test must target staging');
const page = await fetch(target);
assert.equal(page.status, 200, 'The builder page must be available');
const html = await page.text();
assert.match(html, /Two-Way Experience Studio/, 'The builder shell must render');
console.log(JSON.stringify({ event: 'hosted_smoke_passed', baseUrl: target.origin, aiConfigured: payload.aiConfigured }));
