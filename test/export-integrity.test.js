const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../assets/export-runtime.js'), 'utf8');
const context = { window:{}, document:{ querySelector:() => null } };
vm.runInNewContext(source, context);
const api = context.window.TwoWayStandalone;

test('standalone JSON round-trips replacement tokens and script-closing literals', () => {
  const value = { id:'</script><script>example</script>', text:'$& $` $\' assets/gmail/gmail-logo.png \u2028 \u2029' };
  const json = api.safeJson(value);
  assert.doesNotMatch(json, /</);
  assert.deepEqual(JSON.parse(json), value);
});

test('standalone data contains exactly the selected channel and preserves blank values', () => {
  const original = { id:'example', channel:'email', scenarioMode:'multi', emailBody:'', steps:[{ text:'', emailHtml:'' }], variants:{ sms:{ steps:[{ text:'unselected' }] }, email:{ steps:[{ text:'saved but stale' }] } } };
  const selected = api.activeChannelScenario(original);
  assert.equal(selected.channel, 'email');
  assert.equal(selected.scenarioMode, 'single');
  assert.equal(selected.variants, undefined);
  assert.equal(selected.emailBody, '');
  assert.equal(selected.steps[0].text, '');
  assert.equal(selected.steps[0].emailHtml, '');
  assert.ok(original.variants.sms, 'preparing a download must not mutate the saved scenario');
});

test('ordinary builder assets retain their original URLs without an export registry', () => {
  assert.equal(api.assetUrl('assets/gmail/gmail-logo.png'), 'assets/gmail/gmail-logo.png');
  assert.equal(api.assetUrl('data:image/png;base64,example'), 'data:image/png;base64,example');
});
