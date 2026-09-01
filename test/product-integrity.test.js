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
  for (const marker of ['scenarioMode', 'variants', 'captureJourneyVariant', 'projectJourneyVariant', 'addJourneyChannel', 'Apply to ${scenario?.name||\'this scenario\'}']) {
    assert.ok(html.includes(marker), `expected multi-channel scenario support: ${marker}`);
  }
  assert.ok(html.includes('Switching never overwrites another channel’s flow.'), 'the builder explains independent channel editing');
});

test('versioned saves capture the active multi-channel variant before rendering', () => {
  const finalPersist = html.lastIndexOf('persist=function(){captureJourneyVariant();try{localStorage.setItem(scenarioStoreKey');
  assert.ok(finalPersist > html.indexOf('function captureJourneyVariant'), 'the final persistence implementation captures the projected channel variant');
  assert.ok(html.indexOf('captureJourneyVariant();try{localStorage.setItem', finalPersist) === finalPersist + 'persist=function(){'.length, 'capture happens before writing the versioned scenario record');
});

test('AI applies to the active named scenario by default, with a separate-scenario escape hatch', () => {
  for (const marker of ['Apply to ${scenario?.name||\'this scenario\'}', 'createAiScenarioSeparately', 'Create separately', 'applyAiDraft=async function({separate=false}={})', 'destination=separate?', 'Object.keys(target).forEach(key=>delete target[key])', 'state.scenarios.push(journey)']) {
    assert.ok(html.includes(marker), `expected clear AI scenario destination behavior: ${marker}`);
  }
  assert.ok(html.includes('Choose Create separately to keep this scenario unchanged.'), 'the review explains that the secondary action preserves the current scenario');
});

test('AI uses one explicit initial sender across every channel, including email', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  for (const marker of ['"initialSender":"company"', 'Use "company" as initialSender when the company opens with outreach', 'customerMessage:clean(scenario.customerMessage)', "initialSender:clean(raw?.initialSender).toLowerCase()==='customer'?'customer':'company'"]) {
    assert.ok(server.includes(marker), `expected AI draft sender contract: ${marker}`);
  }
  for (const marker of ["customerFirst=draft.initialSender==='customer'", "author:'brand',kind:'text',text:config.initialBody||config.initialMessage||config.fallbackResponse", "emailBody:customerFirst?'':config.initialBody", 'aiCustomerStep(config,true)', 'aiBrandResponseSteps(config)']) {
    assert.ok(html.includes(marker), `expected shared sender behavior in the channel converter: ${marker}`);
  }
});

test('AI preserves ordered scripted customer turns and defaults their supplied copy to composer prefills', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  for (const marker of ['Preserve every explicitly provided line and its order in turns.', 'Any supplied customer wording must use mode "prefill".', 'function turns(value)', 'turns:turns(scenario.turns)']) {
    assert.ok(server.includes(marker), `expected scripted AI-turn contract: ${marker}`);
  }
  for (const marker of ['scriptedStepsFromAi', "turn.mode==='free'?'free':turn.mode==='choices'?'prefilled':'prefill'", 'scenario.steps=turns', 'reusableSet:mode===\'free\'']) {
    assert.ok(html.includes(marker), `expected scripted AI-turn mapping: ${marker}`);
  }
});

test('AI generation uses a compact per-channel contract and retries malformed JSON once', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  for (const marker of ["const channel = channels[0] || 'sms'", 'Return exactly this compact JSON shape', 'maxOutputTokens:attempt ? 2200 : 2800', "['gemini_bad_json','gemini_failed'].includes(error?.code)", "event:'gemini_invalid_json'", "error?.name === 'TypeError'"]) {
    assert.ok(server.includes(marker), `expected resilient AI generation: ${marker}`);
  }
});

test('customer response modes distinguish typing, composer prefills, and intentional choice bubbles', () => {
  for (const marker of ['customerResponseModeEditor', 'Type in phone', 'Prefill message', 'Reply choices', 'Message to prefill', 'Scripted sequence', "['prefill','prefilled'].includes(step.kind)", 'state.composerPrefillToken']) {
    assert.ok(html.includes(marker), `expected customer response mode: ${marker}`);
  }
  assert.ok(html.includes("pending.kind==='prefill')state.composer=pending.text||''"), 'a message prefill is placed into the live composer');
});

test('help content is mounted in a viewport-safe document popover instead of being clipped by cards', () => {
  for (const marker of ['ruleHelpPopover', 'placeRuleHelpPopover', 'wireRuleHelpPopovers', "copy.hidden=true", "ruleHelpPopover.hidden=true", "role','tooltip'"]) {
    assert.ok(html.includes(marker), `expected safe help popover behavior: ${marker}`);
  }
});

test('email response styling is controlled per company response with compact shared assets', () => {
  for (const marker of ['email-identity-assets', 'Company email assets', 'emailAssetCard', 'data-email-asset-url-apply', 'email-response-toggle', 'data-response-mode', 'response-rich-editor', 'renderBuilderWithPerResponseEmailDesign', "$('#emailDesigner')?.remove()", 'bubbleWithPerResponseEmailDesign']) {
    assert.ok(html.includes(marker), `expected per-response email design behavior: ${marker}`);
  }
  assert.ok(html.includes('Customer replies remain plain Gmail text.'), 'customer responses are deliberately kept as plain-text email');
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
  for (const marker of ['scenarioStoreVersion=4', "scenarioStoreKey='two-way-studio-v4'", 'Array.isArray(parsed?.scenarios)', 'bootstrapScenario', 'supportedBootstrapChannels', 'savedScenarioRecoveryNeeded', '!normalizedScenarios.length', 'Restore starter scenarios', 'restoreStarterScenarios']) {
    assert.ok(html.includes(marker), 'expected saved-scenario recovery behavior: ' + marker);
  }
  assert.ok(html.includes('Your custom scenarios will be kept.'), 'manual starter restoration preserves custom scenarios');
});

test('startup validates saved scenarios before the first render and has a one-time reset fallback', () => {
  for (const marker of ['bootstrapRecoveryFlag', 'recoverFromBootstrapFailure', "localStorage.removeItem('two-way-studio-v4')", "localStorage.removeItem('two-way-studio-v3')", "window.addEventListener('error'", 'bootstrapRendered=true']) {
    assert.ok(html.includes(marker), 'expected refresh-time blank-state prevention: ' + marker);
  }
  assert.ok(html.indexOf('function bootstrapScenario') < html.indexOf('function renderBuilder()'), 'saved records are normalized before the first builder render');
  assert.ok(html.indexOf('readThreads:new Set()') < html.indexOf('function renderSms(){const s=active()'), 'the initial phone renderer has its read-state dependency immediately available');
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

test('interactive HTML downloads are standalone active-channel browser experiences', () => {
  for (const marker of ['downloadStandaloneHtml', 'inlineStandaloneAssets', 'export-channel-${esc(channel)}', 'html.replace(/<body\\b[^>]*>/i', 'scenarios:[selected]', 'emailPresentationHint', 'Gmail preview', 'full-screen, browser-tab Gmail experience']) {
    assert.ok(html.includes(marker), `expected standalone export behavior: ${marker}`);
  }
  assert.ok(html.includes(".export .builder,.export .appbar,.export .preview-info"), 'exports remove builder and presenter chrome');
  assert.ok(html.includes("document.body.classList.remove('presentation','email-presentation')"), 'leaving presentation removes email-only presentation state');
});

test('regenerating an AI draft returns to the editable prompt without auto-generating', () => {
  for (const marker of ['returnAiDraftToEditor', 'Draft cleared. Update the prompt', "state.setupMode='ai'", "ai.draft=null", 'regenerateAiDraft']) {
    assert.ok(html.includes(marker), `expected editable AI regeneration behavior: ${marker}`);
  }
  const regenerate = html.slice(html.indexOf('function returnAiDraftToEditor'), html.indexOf('const generateAiDraftWithFreshLogoChoices'));
  assert.ok(!regenerate.includes('generateAiDraft()'), 'returning to the prompt must not immediately submit another generation request');
});

test('selected builder images show a contained visual thumbnail', () => {
  for (const marker of ['image-asset-preview', 'image-asset-preview-fallback', 'Image unavailable', "onerror=\"this.parentElement.classList.add('is-unavailable')\""]) {
    assert.ok(html.includes(marker), `expected visible selected-image preview: ${marker}`);
  }
});

test('conversation card disclosures use a stable one-click Customer/Company handler', () => {
  for (const marker of ['decorateCollapsibleBlocksWithStableLabels', "label=step.author==='brand'?'Company response':'Customer input'", 'previous.replaceWith(toggle)', 'event.stopPropagation()', "step.collapsed=!(step.collapsed!==false)"]) {
    assert.ok(html.includes(marker), `expected stable conversation disclosure behavior: ${marker}`);
  }
});

test('conversation reordering is self-contained and preserves open editors', () => {
  for (const marker of ['conversationCards(container)', "card.dataset.stepBlock=scenario.steps[index].id", 'preserveConversationDisclosureState', "step.collapsed=block.classList.contains('is-collapsed')", "handle.addEventListener('pointerdown'", "document.addEventListener('pointermove'", 'conversation-drag-ghost', 'conversation-drop-indicator', 'showInsertion(target)', 'reorderConversationSteps(origin?.dataset.stepBlock,targetId,after)']) {
    assert.ok(html.includes(marker), `expected reliable conversation drag behavior: ${marker}`);
  }
  assert.ok(html.includes('tools.querySelectorAll(\'[data-move]\').forEach(button=>button.remove())'), 'legacy reordering arrows are removed while collapse and delete controls stay on the right');
});

test('server keeps request-size, timeout, and rate-limit safeguards enabled', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  for (const marker of ['requestLimitBytes', 'requestTimeoutMs', 'withinRateLimit', 'safeUrl', 'privateIp']) {
    assert.ok(server.includes(marker), `expected server safeguard: ${marker}`);
  }
});
