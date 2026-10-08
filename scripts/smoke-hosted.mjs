import assert from 'node:assert/strict';

assert.ok(process.env.BASE_URL,'Set BASE_URL to the authorized deployment URL.');
assert.ok(process.env.EXPECTED_VERSION,'Set EXPECTED_VERSION explicitly; the smoke test does not assume a release.');
assert.ok(process.env.EXPECTED_ENV,'Set EXPECTED_ENV explicitly; the smoke test does not assume an environment.');
const target=new URL(process.env.BASE_URL);
assert.ok(['https:','http:'].includes(target.protocol)&&!target.username&&!target.password,'Use an HTTP(S) URL without embedded credentials.');
const health=await fetch(new URL('/api/health',target),{signal:AbortSignal.timeout(10000)});
assert.equal(health.status,200,'The health endpoint must respond successfully');
const payload=await health.json();
assert.equal(payload.ok,true);
assert.equal(payload.version,process.env.EXPECTED_VERSION);
assert.equal(payload.environment,process.env.EXPECTED_ENV);
assert.equal(payload.ai?.configured,payload.aiConfigured,'Health must consistently describe configuration, not assume readiness');
if(process.env.EXPECTED_MODEL)assert.equal(payload.ai?.model,process.env.EXPECTED_MODEL);
const page=await fetch(target,{signal:AbortSignal.timeout(10000)});
assert.equal(page.status,200,'The builder page must be available');
assert.match(await page.text(),/Two-Way Experience Studio/);
console.log(JSON.stringify({event:'hosted_smoke_passed',baseUrl:target.origin,version:payload.version,environment:payload.environment,ai:payload.ai,providerRequests:0}));
