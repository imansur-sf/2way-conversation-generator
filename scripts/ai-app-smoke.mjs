import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const port = 3194;
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server.js'], {
  env:{ ...process.env, PORT:String(port), APP_ENV:'smoke', APP_VERSION:'2.0.0-smoke' },
  stdio:['ignore', 'pipe', 'pipe']
});
let output = '';
server.stdout.on('data', chunk => { output += chunk; });
server.stderr.on('data', chunk => { output += chunk; });

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function waitForService() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch(`${baseUrl}/api/health`)).ok) return; } catch {}
    await wait(150);
  }
  throw new Error(`Smoke server did not start: ${output}`);
}

async function generateJourney({ channels, expectedInitialSender, useCase }) {
  const requestId = crypto.randomUUID();
  const response = await fetch(`${baseUrl}/api/scenario-jobs`, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'X-Request-Id':requestId, 'X-Idempotency-Key':requestId },
    body:JSON.stringify({ companyName:'Example Company', website:'https://example.com', useCase, channels })
  });
  assert.equal(response.status, 202, 'AI job must be accepted');
  const created = await response.json();
  assert.ok(created.poll, 'AI job must return a polling URL');
  for (let attempt = 0; attempt < 70; attempt += 1) {
    await wait(900);
    const poll = await fetch(`${baseUrl}${created.poll}`);
    assert.equal(poll.status, 200, 'AI job must remain retrievable');
    const job = await poll.json();
    if (job.status === 'failed') throw new Error(`AI job failed: ${job.error}`);
    if (job.status !== 'completed') continue;
    assert.equal(job.draft.initialSender, expectedInitialSender, 'AI must preserve the requested opening speaker');
    for (const channel of channels) assert.ok(job.draft?.scenarios?.[channel]?.turns?.length, `AI job must return editable ${channel} turns`);
    assert.equal(typeof job.requirements?.complete, 'boolean', 'AI job must return requirement coverage');
    return job;
  }
  throw new Error('AI job must complete within the smoke-test window');
}

try {
  await waitForService();
  const companyFirst = await generateJourney({
    channels:['sms','rcs','whatsapp','email'],
    expectedInitialSender:'company',
    useCase:'Example Company sends an invitation. A customer named Avery asks for the details. A sales representative named Jordan joins the thread with next steps.'
  });
  const customerFirst = await generateJourney({
    channels:['email'],
    expectedInitialSender:'customer',
    useCase:'A customer named Morgan sends the first message asking Example Company about an invitation. Example Company responds and connects Morgan with sales representative Riley for next steps.'
  });
  console.log(`AI application matrix: OK (company-first ${companyFirst.durationMs}ms; customer-first ${customerFirst.durationMs}ms)`);
} finally {
  server.kill('SIGTERM');
  await Promise.race([once(server, 'exit'), wait(1_000)]);
}
