const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'interactive-simulator-builder.html');
const html = fs.readFileSync(htmlPath, 'utf8');

test('builder script parses without a JavaScript syntax error', () => {
  const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  assert.doesNotThrow(() => new Function(script));
});

test('built-in scenarios retain their intended channel contracts', () => {
  const source = html.match(/<script id="scenario-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(source, 'scenario data is embedded');
  const { scenarios } = JSON.parse(source[1]);
  const channelFor = id => scenarios.find(scenario => scenario.id === id)?.channel;
  assert.equal(channelFor('recipient-initiated-sms'), 'sms');
  assert.equal(channelFor('company-initiated-rcs'), 'rcs');
  assert.equal(channelFor('email-marketing-agent-handoff'), 'email');
});

test('quality guardrails are included in the standalone export source', () => {
  for (const marker of ['routeLabMarkup', 'scenarioIssues', 'captureVersion', 'shareScenario', 'appStatus', 'presentationReset']) {
    assert.ok(html.includes(marker), `expected ${marker} quality guardrail`);
  }
});

test('multi-channel scenarios preserve independent channel variants', () => {
  for (const marker of ['scenarioMode', 'variants', 'captureJourneyVariant', 'projectJourneyVariant', 'addJourneyChannel', 'Create multi-channel scenario']) {
    assert.ok(html.includes(marker), `expected multi-channel scenario support: ${marker}`);
  }
  assert.ok(html.includes('Switching never overwrites another channel’s flow.'), 'the builder explains independent channel editing');
});

test('server keeps request-size, timeout, and rate-limit safeguards enabled', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  for (const marker of ['requestLimitBytes', 'requestTimeoutMs', 'withinRateLimit', 'safeUrl', 'privateIp']) {
    assert.ok(server.includes(marker), `expected server safeguard: ${marker}`);
  }
});
