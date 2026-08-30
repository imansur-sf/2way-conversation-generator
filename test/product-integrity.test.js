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

test('branded email omits a broken or missing logo instead of showing a placeholder', () => {
  assert.ok(html.includes("logo=String(scenario.emailLogo||'').trim()"), 'only an explicitly configured email logo is rendered');
  assert.ok(html.includes("this.closest('.scenario-email-mark')?.remove()"), 'a failed logo image removes its visual container');
});

test('branded email treats the logo and company name as one centered identity lockup', () => {
  for (const marker of ['scenario-email-identity', 'scenario-email-preheader', 'width:48px', 'height:48px']) {
    assert.ok(html.includes(marker), `expected centered branded-email identity treatment: ${marker}`);
  }
});

test('builder stays vertically focused and conversation blocks can collapse', () => {
  for (const marker of ['overflow-x:hidden!important', 'decorateCollapsibleBlocks', 'data-collapse-step', 'Recipient input', 'Company response']) {
    assert.ok(html.includes(marker), `expected builder-flow improvement: ${marker}`);
  }
});

test('AI company identity uses one selected logo across sender and email surfaces', () => {
  for (const marker of ['company-logo-avatar', "avatarKind='company-logo'", 'Use as logo & sender avatar', 'Proposed logo → company sender avatar and branded email header']) {
    assert.ok(html.includes(marker), `expected unified AI identity behavior: ${marker}`);
  }
});

test('every editable image uses the compact add, change, remove, or URL workflow', () => {
  for (const marker of ['image-asset-control', 'data-image-upload', 'data-image-url-apply', 'normalizeImageSource', "label:'Company avatar'", "label:'Card image'", "label:'Hero image'"]) {
    assert.ok(html.includes(marker), `expected unified image-control behavior: ${marker}`);
  }
});

test('AI setup separates the active company logo from campaign hero options', () => {
  for (const marker of ['Company logo</strong>', 'Email hero options</strong>', 'data-ai-logo-select', 'data-ai-hero-select', 'The blue outline marks the logo currently used', 'The blue outline marks the hero currently used']) {
    assert.ok(html.includes(marker), `expected separate AI visual selection: ${marker}`);
  }
});

test('AI logo choices remain stable after selecting a different option', () => {
  for (const marker of ['logoOptionUrls', 'renderAiSetupWithStableLogoChoices', 'Original AI logo', 'generateAiDraftWithFreshLogoChoices']) {
    assert.ok(html.includes(marker), `expected stable AI logo-choice state: ${marker}`);
  }
});

test('QA starts minimized and tests a recipient message without routing dropdown jargon', () => {
  for (const marker of ['Testing &amp; Quality Assurance', 'data-qa-toggle', 'data-qa-turn', 'Test recipient message', 'Keyword match → company response', 'const isCollapsed=step.collapsed!==false']) {
    assert.ok(html.includes(marker), `expected compact QA and collapsed flow controls: ${marker}`);
  }
});

test('SMS, RCS, and WhatsApp use an in-phone keyboard with channel-specific send controls', () => {
  for (const marker of ['phone-keyboard', 'keyboard-open', 'keyboardIcons', 'messageSend', 'whatsappSend', 'addPhoneKeyboard', 'cubic-bezier(.22,1,.36,1)']) {
    assert.ok(html.includes(marker), `expected animated phone-keyboard behavior: ${marker}`);
  }
  assert.ok(html.includes("isWhatsapp?keyboardIcons.whatsappSend:keyboardIcons.messageSend"), 'WhatsApp and Messages use distinct send icons');
});

test('conversation cards use one drag-and-drop reorderer across every channel', () => {
  for (const marker of ['conversation-drag-handle', 'decorateConversationDragDrop', 'reorderConversationSteps', 'data-conversation-drag', 'pointerdown', 'Conversation message reordered']) {
    assert.ok(html.includes(marker), `expected conversation drag-and-drop behavior: ${marker}`);
  }
  assert.ok(html.includes("tools.querySelectorAll('[data-move]').forEach(button=>button.remove())"), 'legacy arrow controls are removed when drag controls are added');
});

test('server keeps request-size, timeout, and rate-limit safeguards enabled', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  for (const marker of ['requestLimitBytes', 'requestTimeoutMs', 'withinRateLimit', 'safeUrl', 'privateIp']) {
    assert.ok(server.includes(marker), `expected server safeguard: ${marker}`);
  }
});
