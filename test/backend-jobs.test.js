const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('AI generation uses a bounded, observable asynchronous job contract', () => {
  for (const marker of ['const generationJobs = new Map()', 'generationJobTtlMs', 'function startGenerationJob', 'function publicJob', "url.pathname === '/api/scenario-jobs'", "status:'queued'", "job.status='running'", "job.status='completed'", "job.status='failed'", 'X-Request-Id']) {
    assert.ok(server.includes(marker), `expected AI job behavior: ${marker}`);
  }
});

test('AI drafts expose prompt-requirement coverage and retry transient provider failures', () => {
  for (const marker of ['function requirementChecklist', 'requirementsComplete:requirements.complete', 'gemini_request_retrying', "['gemini_timeout','gemini_failed','gemini_bad_json','gemini_rate_limited']", 'for (let attempt = 0; attempt < 2; attempt += 1)', 'expectedMessageCount', 'scriptedTurnsSatisfied', 'initialSenderSatisfied']) {
    assert.ok(server.includes(marker), `expected generation quality gate: ${marker}`);
  }
});

test('the structured prompt contract preserves scripted order and repairs a requested message total', () => {
  const helpers = new Function(`${server.slice(server.indexOf('function fallbackTurns'), server.indexOf('function readJson'))};return { storyBrief, preserveExplicitTurns, enforceRequestedMessageCount };`)();
  const scripted = 'Company says "Welcome, Taylor." Customer says "What is the cost?" Company says "It is $10." Company says "Jordan from sales is joining this thread." Customer says "Great, thank you."';
  const brief = helpers.storyBrief(scripted, 'Northstar');
  assert.equal(brief.expectedMessageCount, 5);
  const incomplete = { companyName:'Northstar', scenarios:{ sms:{ turns:[{ speaker:'company', text:'Generic introduction.' },{ speaker:'customer', text:'Question.' }] } } };
  const preserved = helpers.preserveExplicitTurns(incomplete, scripted);
  assert.deepEqual(preserved.scenarios.sms.turns.map(turn => [turn.speaker, turn.text]), brief.scriptedTurns.map(turn => [turn.speaker, turn.text]));
  const countPrompt = 'Northstar sends an invitation. Create 7 total messages.';
  const short = { companyName:'Northstar', scenarios:{ sms:{ turns:[{ speaker:'company', text:'Join our event.' },{ speaker:'customer', text:'Can I learn more?' }] } } };
  const repaired = helpers.enforceRequestedMessageCount(short, countPrompt, 'Northstar');
  assert.equal(repaired.scenarios.sms.turns.length, 7);
  assert.ok(server.includes('countSatisfied'), 'the review contract must expose message-count validation');
  assert.equal(helpers.storyBrief('Start the conversation with the customer. Create exactly 4 total messages.', 'Northstar').initialSender, 'customer');
});

test('generation jobs deduplicate retried requests and expose aggregate health metrics', () => {
  for (const marker of ['const idempotencyJobs = new Map()', 'const draftCache = new Map()', 'scenario_draft_cache_hit', 'function publicGenerationMetrics()', "request.headers['x-idempotency-key'] || request.headers['x-request-id']", 'reused:true', 'averageDurationMs']) {
    assert.ok(server.includes(marker), `expected resilient generation behavior: ${marker}`);
  }
});
