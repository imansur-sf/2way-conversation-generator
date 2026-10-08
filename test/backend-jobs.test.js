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

test('script limits reject unsupported content instead of silently truncating it', () => {
  const {explicitTurns,storyBrief}=require('../server/draft-contract.cjs');
  assert.throws(()=>explicitTurns(Array.from({length:13},(_,index)=>(index%2?'Customer':'Company')+' says "Message '+index+'."').join(' ')),{code:'invalid_dialogue'});
  assert.throws(()=>explicitTurns('Company says "'+'x'.repeat(1801)+'"'),{code:'invalid_dialogue'});
  assert.throws(()=>explicitTurns('Company says "Unclosed quotation'),{code:'invalid_dialogue'});
  const brief=storyBrief({companyName:'Example',useCase:'Start the conversation with the customer. Create exactly 4 total messages.'});
  assert.equal(brief.initialSender,'customer');assert.equal(brief.expectedMessageCount,4);
});

test('generation jobs deduplicate retried requests and expose aggregate health metrics', () => {
  for (const marker of ['const idempotencyJobs = new Map()', 'const draftCache = new Map()', 'scenario_draft_cache_hit', 'function publicGenerationMetrics()', "request.headers['x-idempotency-key'] || request.headers['x-request-id']", 'reused:true', 'averageDurationMs']) {
    assert.ok(server.includes(marker), `expected resilient generation behavior: ${marker}`);
  }
});
