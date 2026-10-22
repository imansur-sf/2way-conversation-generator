const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const {format} = require('../assets/ai-error-guidance.js');
const failure = (issues, code = 'draft_invalid') => ({code, message:code, requestId:'request-123', issues});
const visible = value => [value.summary, ...value.actions.map(action => action.text)].join(' ');

test('EWC repeated channel failures become two next steps, retaining all original details', () => {
  const issues = ['sms','rcs','whatsapp','email'].flatMap(channel => [
    {code:'sender_mismatch', channel, expectedSender:'company', field:'initialSender', message:'The company must open the conversation.'},
    {code:'missing_required_fact', channel, message:`Customer question supplied in the brief is missing from ${channel} dialogue.`},
    {code:'sender_mismatch', channel, message:'Channel opening speaker disagrees with the shared opening sender.'},
  ]);
  const request = {companyName:'EWC', useCase:'Express Wash Concepts sends out message reminding a current customer that their membership is set to renew in 14 days. Customer responds with a question about what all the membership includes.'};
  const result = format(failure(issues), request);
  assert.equal(result.actions.length, 2);
  assert.match(result.actions[0].text, /Who sends the first message.*choose Company opens/);
  assert.equal(result.controlTarget, 'opening-sender');
  assert.equal(result.actions[0].label, 'Review first sender');
  assert.doesNotMatch(visible(result), /Customer question supplied|sms dialogue|shared opening sender/);
  assert.deepEqual(result.details.issues, issues);
  assert.equal(result.details.requestId, 'request-123');
  assert.equal(result.details.code, 'draft_invalid');
});
test('legacy sender messages cannot dictate an unverified opening sender', () => {
  const result = format(failure([{message:'The customer must open the conversation.'},{message:'Channel opening speaker disagrees with the shared opening sender.'}]));
  assert.equal(result.actions.length, 1);
  assert.match(result.actions[0].text, /Company opens or Customer opens to match your intended first message/);
  assert.doesNotMatch(result.actions[0].text, /choose Customer opens, then/);
  const contradictory = format(failure([{code:'sender_mismatch',expectedSender:'company'}, {code:'sender_mismatch',expectedSender:'customer'}]));
  assert.match(contradictory.actions[0].text, /Company opens or Customer opens/);
});
test('an already selected valid opening sender is retained, not arbitrarily changed', () => {
  for (const initialSender of ['company','customer']) {
    const result = format(failure([{code:'sender_mismatch',expectedSender:initialSender}]), {controls:{initialSender}});
    assert.match(result.summary, /AI did not follow your selected opening sender/);
    assert.match(result.actions[0].text, /For this attempt.*was set to/);
    assert.match(result.actions[0].text, /Review the current setting and keep that selection if it is still intended/);
    assert.doesNotMatch(result.actions[0].text, /choose|change|clear|is already set/i);
  }
});
test('sender and count input conflicts take priority over provider mismatch advice', () => {
  const result = format(failure([{code:'sender_mismatch'},{code:'count_mismatch'},{code:'sender_conflict'},{code:'count_conflict'}], 'conflicting_requirements'), {controls:{initialSender:'company',expectedMessageCount:4}});
  assert.equal(result.actions.length, 2);
  assert.match(result.actions[0].text, /agree with the first Company:\/Customer: message/);
  assert.match(result.actions[1].text, /same total.*written brief.*supplied dialogue/);
  assert.doesNotMatch(visible(result), /keep that selection if it is still intended/);
});
test('count guidance respects exact selections and trusted expected totals', () => {
  const selected = format(failure([{code:'count_mismatch',expectedMessageCount:5}]), {controls:{expectedMessageCount:5}});
  assert.match(selected.summary, /AI did not follow your selected message total/);
  assert.match(selected.actions[0].text, /For this attempt.*was set to 5.*keep that total if it is still intended/);
  assert.equal(selected.controlTarget, 'message-total');
  const inferred = format(failure([{code:'count_mismatch',expectedMessageCount:5}]));
  assert.match(inferred.actions[0].text, /enter 5 to match/);
  const invalid = format(failure([{code:'invalid_count'}], 'invalid_controls'));
  assert.match(invalid.actions[0].text, /whole number from 2 to 12/);
  const local = format({code:'invalid_draft',message:'Exact message total must be a whole number from 2 to 12.'});
  assert.equal(local.controlTarget, 'message-total');
});
test('invalid sender and generic invalid controls target the actual disclosure', () => {
  for (const code of ['invalid_sender','invalid_controls']) {
    const result = format({code});
    assert.equal(result.controlTarget, 'opening-sender');
    assert.match(result.actions[0].label, /Review first sender/);
  }
  const generated = format(failure([{code:'invalid_sender',message:'Draft opening sender is required.'}]), {controls:{initialSender:'company'}});
  assert.match(generated.summary, /AI did not follow your selected opening sender/);
  assert.match(generated.actions[0].text, /For this attempt.*was set to Company opens.*keep that selection if it is still intended/);
});
test('script errors route to the brief without inventing a dialogue control', () => {
  for (const code of ['invalid_dialogue','dialogue_mismatch']) {
    const result = format(failure([{code}]));
    assert.equal(result.actions[0].target, 'brief');
    assert.equal(result.controlTarget, undefined);
    assert.match(result.actions[0].text, /Company:\/Customer:/);
    assert.doesNotMatch(result.actions[0].text, /Generation controls/);
  }
  assert.match(format({code:'invalid_dialogue'}).actions[0].text, /close quotation marks.*12 nonempty.*1,800/);
  assert.match(format({code:'dialogue_mismatch'}).actions[0].text, /same script.*Do not change the wording/);
});
test('persona failures route each name or role correctly without discarding explicit values', () => {
  const fields = {customerName:'customer-name',representativeName:'representative-name',representativeRole:'representative-role'};
  for (const [field,target] of Object.entries(fields)) {
    const issue = {code:'missing_required_fact',field,message:`${field} is missing`};
    const unset = format(failure([issue]));
    assert.equal(unset.actions[0].target, target);
    assert.match(unset.actions[0].text, /Enter the intended value/);
    const selected = format(failure([issue]), {persona:{[field]:'Already specified'}});
    assert.match(selected.actions[0].text, /For this attempt, you supplied an entry.*Review the current entry and keep it if it is still intended/);
    const invalid = format(failure([{...issue,code:'invalid_persona'}], 'invalid_persona'));
    assert.match(invalid.actions[0].text, /up to 160 characters/);
  }
  assert.equal(format(failure([{code:'missing_required_fact',message:'Customer supplied in the brief is missing from sms dialogue.'}])).controlTarget, 'customer-name');
  assert.equal(format(failure([{code:'missing_required_fact',message:'Customer question supplied in the brief is missing from sms dialogue.'}])).controlTarget, undefined);
});
test('sequence and missing content failures consolidate to a brief action, not unrelated controls', () => {
  const result = format(failure(['missing_requirement','contradicted_requirement','requirement_order','missing_rich_presentation','missing_speaker'].map(code => ({code}))));
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].target, 'brief');
  assert.match(result.actions[0].text, /same brief.*missing requirement.*place in the conversation/);
  assert.equal(result.controlTarget, undefined);
});
test('provider timeouts and busy responses offer retry guidance, not speculative setting changes', () => {
  for (const code of ['generation_timeout','gemini_timeout','gemini_incomplete','gemini_bad_json','generation_busy','remote_busy','rate_limited','gemini_rate_limited']) {
    const result = format({code});
    assert.equal(result.controlTarget, undefined);
    assert.equal(result.actions[0].target, undefined);
    assert.doesNotMatch(visible(result), /smaller|shorter|Opening sender|Exact message total/);
    assert.match(visible(result), /again/);
  }
});
test('incomplete and unreadable provider responses are not misreported as timeouts', () => {
  for (const code of ['generation_timeout','gemini_timeout']) assert.match(format({code}).summary, /before the deadline/);
  const incomplete = format({code:'gemini_incomplete'}), unreadable = format({code:'gemini_bad_json'});
  assert.match(incomplete.summary, /stopped before completing the scenario/);
  assert.match(unreadable.summary, /response the builder could not read/);
  for (const result of [incomplete,unreadable]) assert.doesNotMatch(result.summary, /deadline|timed? out|in time|too long/i);
});
test('credential and model failures identify service ownership, not irrelevant generation controls', () => {
  for (const code of ['llm_not_configured','gemini_auth_failed','gemini_model_not_found','gemini_bad_request']) {
    const result = format({code});
    assert.match(result.summary, /service needs attention from the tool owner/);
    assert.match(result.actions[0].text, /request ID and Technical details/);
    assert.equal(result.controlTarget, undefined);
  }
});
test('website and image failures point to their own remedies', () => {
  for (const code of ['invalid_url','blocked_url','blocked_host','not_html','too_large','request_timeout','website_fetch_failed','upstream_status','bad_redirect','too_many_redirects','empty_body']) {
    const result = format({code});
    assert.equal(result.actions[0].target, 'website');
    assert.equal(result.controlTarget, undefined);
    assert.match(result.actions[0].text, /public/);
  }
  const result = format(failure([{code:'unlisted_url',message:'Logo: https://example.test/image.png'}]));
  assert.match(result.actions[0].text, /Technical details.*replacement.*manual editor/);
  assert.equal(result.controlTarget, undefined);
  assert.equal(result.details.issues[0].message, 'Logo: https://example.test/image.png');
});
test('generic, changed request, blocked request and missing-input cases remain actionable', () => {
  for (const code of ['scenario_generation_failed','gemini_failed','draft_invalid','invalid_draft','idempotency_conflict','gemini_blocked','missing_required_fields','conflicting_requirements']) {
    const result = format({code});
    assert.ok(result.summary.length);
    assert.ok(result.actions.length);
    assert.ok(result.actions.every(action => action.text.length));
    assert.match(result.summary, /Your entries are kept/);
  }
});
test('untrusted errors stay plain technical data, never generated markup, actions or selectors', () => {
  const malicious = '<img src=x onerror="alert(1)"></script><script>alert(1)</script>';
  const original = {code:malicious,message:malicious,requestId:malicious,issues:[{code:'sender_mismatch',message:malicious,field:malicious,expectedSender:malicious},{code:'count_mismatch',expectedMessageCount:malicious},{code:'missing_required_fact',field:malicious}]};
  const before = JSON.stringify(original), result = format(original, {controls:{initialSender:malicious,expectedMessageCount:malicious},persona:{customerName:malicious}});
  assert.doesNotMatch(visible(result), /<|onerror|alert\(/);
  assert.ok(result.actions.every(action => !action.target || ['opening-sender','message-total','brief'].includes(action.target)));
  assert.equal(result.details.message, malicious);
  assert.deepEqual(result.details.issues, original.issues);
  assert.equal(JSON.stringify(original), before);
});
test('actions are bounded while technical details retain every original channel failure', () => {
  const issues = [{code:'sender_conflict'},{code:'count_conflict'},{code:'invalid_dialogue'},...['customerName','representativeName','representativeRole'].map(field=>({code:'missing_required_fact',field})),{code:'missing_requirement'}];
  const result = format(failure(issues));
  assert.equal(result.actions.length, 4);
  assert.deepEqual(result.details.issues, issues);
  assert.equal(format({}, {requestId:'fallback-request-id'}).details.requestId, 'fallback-request-id');
});
test('the same pure formatter works in browser and Node', () => {
  const context = {window:{}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/ai-error-guidance.js'),'utf8'), context);
  assert.equal(JSON.stringify(context.window.TwoWayAiErrorGuidance.format({code:'generation_timeout'})), JSON.stringify(format({code:'generation_timeout'})));
});
test('guidance focus resolves rehydrated controls at click time and never changes their values', () => {
  const source = fs.readFileSync(require.resolve('../assets/v2-modern.js'),'utf8');
  const start = source.indexOf('  const focusGenerationGuidance =');
  const end = source.indexOf("  document.addEventListener('click', event => {", start);
  assert.ok(start > 0 && end > start);
  let hydrated = 0, reducedMotion = true;
  const context = {hydrateGenerationControls:() => hydrated++, announce:() => {}, matchMedia:() => ({matches:reducedMotion})};
  const navigation = source.match(/  const navigationBehavior =.*;/)[0];
  vm.runInNewContext(navigation + '\n' + source.slice(start,end) + '\nglobalThis.focusGuidance = focusGenerationGuidance;', context);
  const makeField = value => ({value, focused:0, scrolled:0, controls:{open:false}, closest(){return this.controls;}, scrollIntoView(options){this.scrolled++;this.behavior=options.behavior;}, focus(){this.focused++;}});
  let field = makeField('company');
  const root = {querySelector(selector){assert.equal(selector, '#setupAssistant [data-v2-opening-sender]');return field;}};
  context.focusGuidance(root, 'opening-sender');
  assert.equal(field.controls.open, true);
  assert.equal(field.focused, 1);
  assert.equal(field.value, 'company');
  assert.equal(field.behavior, 'auto');
  const previous = field;
  reducedMotion = false;
  field = makeField('customer');
  context.focusGuidance(root, 'opening-sender');
  assert.equal(previous.focused, 1);
  assert.equal(field.focused, 1);
  assert.equal(field.value, 'customer');
  assert.equal(field.behavior, 'smooth');
  field = makeField('company');
  field.controls = null;
  context.focusGuidance(root, 'opening-sender');
  assert.equal(field.focused, 1);
  assert.equal(field.value, 'company');
  context.focusGuidance(root, '[arbitrary-selector]');
  assert.equal(hydrated, 3);
});
