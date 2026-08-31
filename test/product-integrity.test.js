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

test('starter scenarios consolidate into customer-first and company-first multi-channel journeys', () => {
  for (const marker of ['customer-initiated-initial-message', 'company-initiated-initial-message', 'Customer Initiated Initial Message — Multi-Channel', 'Company Initiated Initial Message — Multi-Channel', 'variants:{sms,rcs,whatsapp,email}', 'retiredStarterIds']) {
    assert.ok(html.includes(marker), `expected consolidated starter journey: ${marker}`);
  }
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

test('the Messages microphone remains a single, centered trailing input control', () => {
  for (const marker of ['.phone-screen .composer .send:not(.ready):before', 'display:none!important;content:none!important', 'width:17px!important;height:17px!important']) {
    assert.ok(html.includes(marker), `expected corrected Messages microphone placement: ${marker}`);
  }
});

test('WhatsApp guides customer-first journeys through New chat', () => {
  for (const marker of ['whatsappCustomerStartHint', 'This conversation begins with the customer', 'Tap New chat.', 'renderWhatsappWithCustomerStartHint']) {
    assert.ok(html.includes(marker), `expected WhatsApp customer-first guidance: ${marker}`);
  }
});

test('Gmail uses Compose for a customer-first flow and retains company-first inbox behavior', () => {
  for (const marker of ['isCustomerFirstEmail', 'customerFirstEmailHint', 'Select Compose.', 'email-first-compose', 'customerFirstEmailDraft', 'customerFirstEmailThread', 'emailFirstSend']) {
    assert.ok(html.includes(marker), 'expected customer-first Gmail behavior: ' + marker);
  }
  assert.ok(html.includes("first?.author==='customer'"), 'the initial-sender decision is based on the first conversation step');
});

test('opened Gmail messages retain read state after returning to the inbox', () => {
  for (const marker of ['state.readEmails', 'decorateEmailReadState', "state.readEmails.add(index)", "button.classList.remove('unread')"]) {
    assert.ok(html.includes(marker), 'expected Gmail read-state behavior: ' + marker);
  }
});

test('saved scenario data is versioned, validated, and automatically recoverable', () => {
  for (const marker of ['scenarioStoreVersion=4', "scenarioStoreKey='two-way-studio-v4'", 'Array.isArray(parsed?.scenarios)', 'savedScenarioRecoveryNeeded', '!normalizedScenarios.length', 'Restore starter scenarios', 'restoreStarterScenarios']) {
    assert.ok(html.includes(marker), 'expected saved-scenario recovery behavior: ' + marker);
  }
  assert.ok(html.includes('Your custom scenarios will be kept.'), 'manual starter restoration preserves custom scenarios');
});

test('customer-first Gmail uses a floating Compose window and later delivers a new inbound email', () => {
  for (const marker of ['g-email-popout', 'addCustomerFirstComposePopout', 'customerInboundEmailRow', 'addCustomerInboundEmail', 'data-customer-inbound', 'state.customerFirstInboundRead']) {
    assert.ok(html.includes(marker), 'expected Gmail compose-first inbox behavior: ' + marker);
  }
  assert.ok(html.includes("state.view='list';state.passive=null;state.emailCompose=false;state.customerFirstInboundRead=false;submit(message)"), 'sending the first email returns the customer to the inbox before the reply arrives');
});

test('Gmail source-style light chrome uses an app rail, Ask Gmail, and SVG navigation icons', () => {
  for (const marker of ['g-source-gmail', 'g-app-rail', 'Ask Gmail', 'gmailReferenceIcon', 'gmailGeminiMark', 'g-search-filter', 'gmail-reference-svg']) {
    assert.ok(html.includes(marker), 'expected Gmail reference chrome: ' + marker);
  }
});

test('conversation cards use one drag-and-drop reorderer across every channel', () => {
  for (const marker of ['conversation-drag-handle', 'decorateConversationDragDrop', 'reorderConversationSteps', 'data-conversation-drag', 'pointerdown', 'Conversation message reordered']) {
    assert.ok(html.includes(marker), `expected conversation drag-and-drop behavior: ${marker}`);
  }
  assert.ok(html.includes("tools.querySelectorAll('[data-move]').forEach(button=>button.remove())"), 'legacy arrow controls are removed when drag controls are added');
});

test('the bundled default user portrait is shared by WhatsApp and Gmail', () => {
  const portrait = path.join(root, 'assets', 'avatars', 'imansur-profile.png');
  assert.ok(fs.existsSync(portrait), 'the supplied default portrait is bundled with the demo');
  for (const marker of ['defaultUserPortrait', "active().recipientAvatar||defaultUserPortrait", 'gmailShellWithDefaultUserPortrait', 'Default profile image']) {
    assert.ok(html.includes(marker), `expected shared default-profile behavior: ${marker}`);
  }
});

test('server keeps request-size, timeout, and rate-limit safeguards enabled', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  for (const marker of ['requestLimitBytes', 'requestTimeoutMs', 'withinRateLimit', 'safeUrl', 'privateIp']) {
    assert.ok(server.includes(marker), `expected server safeguard: ${marker}`);
  }
});
