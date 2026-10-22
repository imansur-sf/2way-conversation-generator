const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createAccountsProxy } = require('../server/accounts-proxy.cjs');

async function listen(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}
async function fixture(t, upstreamHandler, options = {}) {
  const upstream = await listen(t, upstreamHandler);
  const proxy = createAccountsProxy({ baseUrl: upstream, ...options });
  return listen(t, async (req, res) => { if (!await proxy(req, res)) { res.writeHead(404); res.end(); } });
}

test('accounts proxy preserves project payloads, identity and retry headers without cookies', async t => {
  let observed;
  const base = await fixture(t, async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    observed = { path: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() };
    res.writeHead(201, { 'Content-Type': 'application/json', 'Set-Cookie': 'secret=1', 'Retry-After': '2' });
    res.end('{"project":{"id":"3","revision":"1"}}');
  });
  const body = JSON.stringify({ tool: 'twoway', payload: { image: 'data:image/png;base64,AAAA' } });
  const response = await fetch(base + '/projects?tool=twoway', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer original', 'Idempotency-Key': 'twoway_retry_12345678', Cookie: 'private=1' }, body });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('retry-after'), '2');
  assert.equal(observed.path, '/projects?tool=twoway');
  assert.equal(observed.headers.authorization, 'Bearer original');
  assert.equal(observed.headers['idempotency-key'], 'twoway_retry_12345678');
  assert.equal(observed.headers.cookie, undefined);
  assert.equal(observed.body, body);
});

test('proxy route and method allowlist prevents arbitrary upstream access', async t => {
  let calls = 0;
  const base = await fixture(t, (req, res) => { calls++; res.end('ok'); });
  for (const path of ['/feedback/unknown', '/api-keys', '/auth/unknown', '/projects/0', '/projects/1/export', '/projects//evil']) assert.equal((await fetch(base + path)).status, 404);
  assert.equal((await fetch(base + '/auth/verify')).status, 405);
  assert.equal((await fetch(base + '/saasy-auth.js', { method: 'POST' })).status, 405);
  assert.equal(calls, 0);
  assert.equal((await fetch(base + '/saasy-auth.js')).status, 200);
  assert.equal((await fetch(base + '/auth/config')).status, 200);
  assert.equal((await fetch(base + '/auth/verify', { method: 'POST', body: '{}' })).status, 200);
});

test('proxy rejects redirect and reports timeouts without following login', async t => {
  let redirectCalls = 0;
  const redirect = await fixture(t, (req, res) => { redirectCalls++; res.writeHead(302, { Location: '/other', 'Set-Cookie': 'session=bad' }); res.end(); });
  const response = await fetch(redirect + '/auth/config');
  assert.equal(response.status, 502); assert.equal(redirectCalls, 1);
  assert.equal(response.headers.get('location'), null);
  const stalled = await fixture(t, () => {}, { timeoutMs: 25 });
  assert.equal((await fetch(stalled + '/auth/config')).status, 502);
});

test('bounded bodies allow projects above normal auth limit and reject oversized requests', async t => {
  let calls = 0;
  const base = await fixture(t, (req, res) => { calls++; req.resume(); req.on('end', () => res.end('{}')); });
  assert.equal((await fetch(base + '/projects', { method: 'POST', body: 'x'.repeat(2 * 1024 * 1024) })).status, 200);
  assert.equal((await fetch(base + '/auth/verify', { method: 'POST', body: 'x'.repeat(1024 * 1024 + 1) })).status, 413);
  assert.equal((await fetch(base + '/projects', { method: 'POST', body: 'x'.repeat(20 * 1024 * 1024 + 1) })).status, 413);
  assert.equal(calls, 1);
});

test('proxy validates the configured fixed accounts origin', () => {
  for (const baseUrl of ['file:///tmp/secret', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?target=bad']) assert.throws(() => createAccountsProxy({ baseUrl }));
});

test('proxy preserves expired-session and revision-conflict responses', async t => {
  const base = await fixture(t, (req, res) => {
    const expired = req.url === '/projects';
    res.writeHead(expired ? 401 : 409, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(expired ? { error: 'invalid_token' } : { error: 'revision_conflict', revision: '4' }));
  });
  const expired = await fetch(base + '/projects');
  assert.equal(expired.status, 401); assert.deepEqual(await expired.json(), { error: 'invalid_token' });
  const conflict = await fetch(base + '/projects/7');
  assert.equal(conflict.status, 409); assert.deepEqual(await conflict.json(), { error: 'revision_conflict', revision: '4' });
});

test('proxy enforces byte limit for chunked bodies without Content-Length', async t => {
  let calls = 0;
  const base = await fixture(t, (req, res) => { calls++; res.end('{}'); });
  const result = await new Promise((resolve, reject) => {
    const req = http.request(base + '/auth/verify', { method: 'POST' }, res => {
      let body = ''; res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.write('x'.repeat(700000)); req.end('x'.repeat(700000));
  });
  assert.equal(result.status, 413); assert.equal(result.body.error, 'payload_too_large'); assert.equal(calls, 0);
});


test('Studio feedback proxy pins its namespace and keeps attachments private', async t => {
  const observed = [];
  const base = await fixture(t, async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    observed.push({path:req.url,body:Buffer.concat(chunks).toString(),headers:req.headers});
    res.writeHead(200, {'Content-Type':'image/png','Set-Cookie':'bad=1','Content-Disposition':'inline; filename="screen.png"'}); res.end('image');
  });
  const posted = await fetch(base + '/feedback', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({description:'studio'})});
  assert.equal(posted.status, 200); assert.equal(observed[0].path, '/feedback?tool=twoway');
  assert.equal(JSON.parse(observed[0].body).tool,'twoway');
  assert.equal((await fetch(base + '/feedback/inbox?tool=upg')).status,400);
  assert.equal((await fetch(base + '/feedback?tool=twoway&tool=twoway',{method:'POST',body:'{}'})).status,400);
  assert.equal((await fetch(base + '/feedback',{method:'POST',body:'{"tool":"lpg"}'})).status,400);
  const id='11111111-1111-4111-8111-111111111111';
  const attachment = await fetch(base + '/feedback/inbox/' + id + '/attachments/' + id);
  assert.equal(attachment.status,200);assert.equal(attachment.headers.get('set-cookie'),null);
  assert.equal(attachment.headers.get('cache-control'),'private, no-store');
  assert.match(attachment.headers.get('content-security-policy'),/sandbox/);
  assert.equal(attachment.headers.get('x-content-type-options'),'nosniff');
  assert.equal((await fetch(base + '/feedback',{method:'POST',body:'x'.repeat(5*1024*1024+1)})).status,413);
  assert.equal(observed.length,2);
});
