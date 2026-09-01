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
  const finalPersist = html.lastIndexOf('persist=function(){captureJourneyVariant();if(isStandaloneExport)');
  assert.ok(finalPersist > html.indexOf('function captureJourneyVariant'), 'the final persistence implementation captures the projected channel variant');
  assert.ok(html.indexOf('captureJourneyVariant();if(isStandaloneExport)', finalPersist) === finalPersist + 'persist=function(){'.length, 'capture happens before export handling or writing the versioned scenario record');
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

test('AI honors a named company as the stated opening sender, including fallback drafts', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const helpers = new Function(`${server.slice(server.indexOf('function fallbackTurns'), server.indexOf('function readJson'))};return { requestedInitialSender, fallbackDraft, enforceRequestedInitialSender };`)();
  const useCase = 'NCSA sends a marketing communication about an upcoming Baseball Recruiting event. A customer, Sean, responds with questions about cost and group tickets.';
  assert.equal(helpers.requestedInitialSender(useCase, 'NCSA'), 'company');
  const fallback = helpers.fallbackDraft({ companyName:'NCSA', website:'https://ncsasports.org', useCase, evidence:{ title:'NCSA', candidates:[] } });
  assert.equal(fallback.initialSender, 'company');
  assert.equal(fallback.scenarios.sms.turns[0].speaker, 'company');
  const corrected = helpers.enforceRequestedInitialSender({ companyName:'NCSA', initialSender:'customer', scenarios:{ sms:{ initialMessage:'Join the NCSA Baseball Recruiting event.', turns:[{ speaker:'customer', text:'What does it cost?' },{ speaker:'company', text:'We can help with tickets.' }] } } }, useCase, 'NCSA');
  assert.equal(corrected.initialSender, 'company');
  assert.equal(corrected.scenarios.sms.turns[0].speaker, 'company');
});

test('AI preserves ordered scripted customer turns and defaults their supplied copy to composer prefills', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  for (const marker of ['Preserve every explicitly provided line and its order in turns.', 'Include every supplied turn, up to 12 turns', 'Copy explicitly quoted dialogue verbatim; do not shorten it.', 'function cleanPrompt', 'slice(0,12_000)', 'useCase = cleanPrompt(body.useCase)', 'function preserveExplicitTurns', 'scenario_draft_explicit_turns_preserved', 'return turns.slice(0,16)', 'value.slice(0,16)', 'Any supplied customer wording must use mode "prefill".', 'function turns(value)', 'turns:turns(scenario.turns)']) {
    assert.ok(server.includes(marker), `expected scripted AI-turn contract: ${marker}`);
  }
  for (const marker of ['scriptedStepsFromAi', "turn.mode==='free'?'free':turn.mode==='choices'?'prefilled':'prefill'", 'scenario.steps=turns', 'reusableSet:mode===\'free\'']) {
    assert.ok(html.includes(marker), `expected scripted AI-turn mapping: ${marker}`);
  }
});

test('AI generation uses one compact canonical request within the hosted timeout budget', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  for (const marker of ["const channel = channels[0] || 'sms'", 'Return exactly this compact JSON shape', 'requestTimeoutMs = 7_000', 'geminiRequestTimeoutMs = 20_000', 'maxOutputTokens:2400', 'function adaptCanonicalDraft', 'function fallbackDraft', "event:'scenario_draft_fallback'", "requests:1, channels", "channels:['sms']", "error?.name === 'TypeError'"]) {
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
  for (const marker of ['email-identity-assets', 'Company email assets', 'emailAssetCard', 'data-image-url-apply', 'email-response-toggle', 'data-response-mode', 'response-rich-editor', 'renderBuilderWithPerResponseEmailDesign', "$('#emailDesigner')?.remove()", 'bubbleWithPerResponseEmailDesign']) {
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

test('every editable image uses the direct upload, visible thumbnail, remove, or URL workflow', () => {
  for (const marker of ['image-asset-control', 'data-image-upload>Upload', 'data-image-thumbnail', 'data-image-url-apply', 'normalizeImageSource', 'loadImageFromUrl', 'identity-image-cell', "label:'Company avatar'", "label:'Card image'", "label:'Hero image'"]) {
    assert.ok(html.includes(marker), `expected unified image-control behavior: ${marker}`);
  }
  assert.ok(!html.includes('<div class="image-asset-sources"'), 'image URL controls must not reveal a redundant source menu');
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

test('QA summary counts every customer and company step, not only routing sets', () => {
  for (const marker of ['routeLabMarkupWithFullFlowCounts', "step.author==='customer'||step.author==='recipient'", "step.author==='brand'||step.author==='company'", 'customerCount} customer', 'companyCount} company']) {
    assert.ok(html.includes(marker), `expected full conversation counts in QA summary: ${marker}`);
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

test('guided sequences deliver every consecutive company message, while keyword routes choose one', () => {
  for (const marker of [
    'answers=routeByKeywords?[chooseResponse(set,text)].filter(Boolean):set.responses.filter(available)',
    'const deliver=(index=0)=>{state.visible.push(answers[index])',
    'if(index+1<answers.length){renderPreview();setTimeout(()=>deliver(index+1),900);return}',
    "Guided sequence: ${replies.length} company ${replies.length===1?'message will':'messages will'} appear in order.",
    'every following company message appears in order'
  ]) assert.ok(html.includes(marker), `expected guided multi-message behavior: ${marker}`);
});

test('the bundled default user portrait is shared by WhatsApp and Gmail', () => {
  const portrait = path.join(root, 'assets', 'avatars', 'imansur-profile.png');
  assert.ok(fs.existsSync(portrait), 'the supplied default portrait is bundled with the demo');
  for (const marker of ['defaultUserPortrait', "active().recipientAvatar||defaultUserPortrait", 'gmailShellWithDefaultUserPortrait', 'Default profile image']) {
    assert.ok(html.includes(marker), `expected shared default-profile behavior: ${marker}`);
  }
});

test('interactive HTML downloads are standalone active-channel browser experiences', () => {
  for (const marker of ['downloadStandaloneHtml', 'inlineStandaloneAssets', 'export-booting', 'releaseStandaloneExportBoot', 'export-channel-${esc(channel)}', 'html.replace(/<body\\b[^>]*>/i', 'scenarios:[selected]', 'emailPresentationHint', 'Gmail preview', 'full-screen, browser-tab Gmail experience', 'isStandaloneExport=document.body.classList.contains(\'export\')', 'if(!isStandaloneExport)try{saved=localStorage.getItem', 'if(isStandaloneExport){const saveState=$(\'#saveState\')', 'standalone-export-lock']) {
    assert.ok(html.includes(marker), `expected standalone export behavior: ${marker}`);
  }
  assert.ok(html.includes(".export .builder,.export .appbar,.export .preview-info"), 'exports remove builder and presenter chrome');
  assert.ok(html.includes("document.body.classList.remove('presentation','email-presentation')"), 'leaving presentation removes email-only presentation state');
});

test('standalone downloads use only their embedded scenario, not shared file storage', () => {
  const exportBootstrap = html.slice(html.indexOf("isStandaloneExport=document.body.classList.contains('export')"), html.indexOf('function bootstrapScenario'));
  assert.ok(!exportBootstrap.includes('saved=localStorage.getItem') || exportBootstrap.includes('if(!isStandaloneExport)try{saved=localStorage.getItem'), 'exports must skip shared localStorage during startup');
  assert.ok(html.includes('if(isStandaloneExport){const saveState=$(\'#saveState\')'), 'exports must not overwrite shared localStorage when interactions occur');
});

test('regenerating an AI draft returns to the editable prompt without auto-generating', () => {
  for (const marker of ['returnAiDraftToEditor', 'Draft cleared. Update the prompt', "state.setupMode='ai'", "ai.draft=null", 'regenerateAiDraft']) {
    assert.ok(html.includes(marker), `expected editable AI regeneration behavior: ${marker}`);
  }
  const regenerate = html.slice(html.indexOf('function returnAiDraftToEditor'), html.indexOf('const generateAiDraftWithFreshLogoChoices'));
  assert.ok(!regenerate.includes('generateAiDraft()'), 'returning to the prompt must not immediately submit another generation request');
});

test('selected builder images show a contained visual thumbnail', () => {
  for (const marker of ['image-asset-thumb', 'data-image-thumbnail', 'role="img"', "background-image:url('${esc(value)}')", 'background:#e6f1f9 center/cover no-repeat', 'snapshotEmbeddedBuilderThumbnails', "canvas.dataset.imageThumbnail='rendered-preview'", 'renderAllWithEmbeddedBuilderThumbnails']) {
    assert.ok(html.includes(marker), `expected visible selected-image preview: ${marker}`);
  }
});

test('AI review image candidates use a same-origin proxy and fail gracefully', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  for (const marker of ["url.searchParams.get('raw') === '1'", "'X-Content-Type-Options':'nosniff'", 'aiPreviewImageUrl', '/api/asset?raw=1&url=', 'proxyAiReviewImages', 'Image unavailable', 'embeddedAsset=async function(url){return embeddedAssetWithRemoteFallback(url)}']) {
    assert.ok(html.includes(marker) || server.includes(marker), `expected resilient AI image preview behavior: ${marker}`);
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

test('the email company-avatar control reuses the selected email logo when no separate avatar exists', () => {
  for (const marker of ["avatarValue=scenario.avatar||(!scenario.avatarDismissed&&scenario.channel==='email'?scenario.emailLogo:'')", 'scenario.avatarDismissed=!source', "label:'Company avatar'"]) {
    assert.ok(html.includes(marker), `expected linked email avatar behavior: ${marker}`);
  }
});

test('the final builder render applies Customer terminology after channel-specific markup is rebuilt', () => {
  for (const marker of [
    'renderBuilderWithFinalCustomerTerminology',
    'applyCustomerTerminology()',
    "if(addCustomer)addCustomer.textContent='+ Customer'",
    "if(addEmailCustomer)addEmailCustomer.textContent='+ Customer'"
  ]) {
    assert.ok(html.includes(marker), `expected final customer terminology normalization: ${marker}`);
  }
});

test('WhatsApp has one full-width editable You-profile control with no duplicate preview', () => {
  for (const marker of ['normalizeIdentityAssetPresentation', 'whatsapp-you-editor--unified', 'recipientAvatarDismissed', "label:'Your WhatsApp profile image'", "editor?.querySelector('.identity-preview')?.remove()"]) {
    assert.ok(html.includes(marker), `expected unified WhatsApp profile control: ${marker}`);
  }
});

test('Email distinguishes the Gmail sender avatar from the branded-email header logo', () => {
  for (const marker of ["heading.textContent='Sender avatar'", "copy.querySelector('span').textContent='Shown beside the sender in Gmail.'", 'function emailLogoAssetValue(s)', 'emailLogo:emailLogoAssetValue(scenario)', 'emailAssetCard(key,label,value,logo=false)']) {
    assert.ok(html.includes(marker), `expected distinct email identity roles: ${marker}`);
  }
});

test('email image assets show their current rendered image and use the same reliable URL loader', () => {
  for (const marker of ["const emailLogo=emailLogoAssetValue(s)", "emailAssetCard('emailLogo','Company logo',emailLogo,true)", 'imageAssetControlMarkup({id:`email-${key}`,key,value,label', 'bindImageAssetControls()', 'scenario.emailLogoDismissed=!source']) {
    assert.ok(html.includes(marker), `expected reliable email image asset behavior: ${marker}`);
  }
});

test('server keeps request-size, timeout, and rate-limit safeguards enabled', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  for (const marker of ['requestLimitBytes', 'requestTimeoutMs', 'withinRateLimit', 'safeUrl', 'privateIp']) {
    assert.ok(server.includes(marker), `expected server safeguard: ${marker}`);
  }
});
