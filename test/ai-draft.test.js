const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const ai = require('../assets/ai-draft.js');
const channels = ['sms','rcs','whatsapp','email'];
const literal = 'José O’Neil: $& $` </script>\nZoë is joining now.';
const persona = {customerName:'José O’Neil',representativeName:'Zoë',representativeRole:'Advisor'};
function fixture() {
  return {schemaVersion:2,companyName:'Synthetic Co',initialSender:'company',persona:{...persona},emailAddress:'hello@example.test',scenarios:Object.fromEntries(channels.map(channel=>[channel,{title:`${channel} draft`,subject:channel==='email'?'Exact subject':undefined,turns:[{speaker:'company',text:literal,presentation:channel==='email'?{kind:'email',mode:'plain'}:{kind:'text'}},{speaker:'customer',text:'Yes, please',mode:'choices',options:['Yes, please','No, thanks']},{speaker:'company',text:'Exact handoff',presentation:channel==='email'?{kind:'email',mode:'branded'}:{kind:'text'}}]}]))};
}
function result(draft=fixture()) {
  return {draft,source:{mode:'provider',requestedChannels:channels,coverage:'complete',brief:{persona,scriptedTurns:[]}},requirements:{complete:true,channels:Object.fromEntries(channels.map(channel=>[channel,{status:'passed',checks:[{label:'Message shape',status:'passed'},{label:'Factual accuracy',status:'unverified'}]}]))}};
}
test('v2 mapping preserves exact text, names, sequence, choices and email mode without invented CTA',()=>{
  const draft=fixture(),before=JSON.stringify(draft);
  for(const channel of channels){const scenario=ai.toScenario(channel,draft);assert.deepEqual(scenario.steps.map(step=>step.text),draft.scenarios[channel].turns.map(turn=>turn.text));assert.deepEqual(scenario.steps.map(step=>step.author),['brand','customer','brand']);assert.deepEqual(scenario.steps[1].options,['Yes, please','No, thanks']);assert.deepEqual(scenario.persona,persona);assert.ok(scenario.steps.every(step=>typeof step.reusableSet==='boolean'));if(channel==='email'){assert.equal(scenario.emailBody,literal);assert.equal(scenario.emailMode,'plain');assert.equal(scenario.steps[2].emailMode,'branded');assert.equal(scenario.emailCtaLabel,'');assert.equal(scenario.emailHeroImage,'')}}
  assert.equal(JSON.stringify(draft),before);
});
function emailRenderer(scenario) {
  const lines=fs.readFileSync(require.resolve('../interactive-simulator-builder.html'),'utf8').split('\n');
  const context={active:()=>scenario,bubble:()=>'',esc:value=>String(value??''),link:value=>String(value??''),safeActionUrl:value=>value,emailAccent:()=>'#0176D3',richEmailHtml:value=>value.emailHtml??value.emailBody??'',plainEmailPreviewText:value=>value};
  vm.runInNewContext([
    lines.filter(line=>line.includes('function emailContentMarkup(row,scenario)')).at(-1),
    lines.find(line=>line.includes('function effectiveEmailContent(')),
    lines.find(line=>line.includes('const emailContentMarkupWithPerResponseDesign=')),
    lines.find(line=>line.includes('const bubbleWithPerResponseEmailDesign=')),
  ].join('\n'),context);
  return context;
}
test('email renderer uses each branded turn’s metadata, not the opening email’s assets',()=>{
  for(const openingMode of ['plain','branded']){
    const draft=fixture(),turns=draft.scenarios.email.turns;
    turns[0].presentation={kind:'email',mode:openingMode,heroImageUrl:'https://example.test/opening.png',preheader:'OPENING PREHEADER',ctaLabel:'Opening details',ctaUrl:'https://example.test/opening'};
    turns[2].presentation={kind:'email',mode:'branded',heroImageUrl:'https://example.test/later.png',preheader:'LATER PREHEADER',ctaLabel:'Later details',ctaUrl:'https://example.test/later'};
    const scenario=ai.toScenario('email',draft),before=JSON.stringify(scenario),render=emailRenderer(scenario),opening=render.emailContentMarkup({},scenario),later=render.bubble(scenario.steps[2]);
    if(openingMode==='branded'){assert.match(opening,/https:\/\/example.test\/opening.png/);assert.match(opening,/href="https:\/\/example.test\/opening"/);}else assert.doesNotMatch(opening,/scenario-email-hero|scenario-email-cta/);
    assert.match(later,/https:\/\/example.test\/later.png/);assert.match(later,/LATER PREHEADER/);assert.match(later,/href="https:\/\/example.test\/later"/);assert.doesNotMatch(later,/opening.png|OPENING PREHEADER|href="https:\/\/example.test\/opening"/);
    scenario.steps[2].emailMode='plain';assert.doesNotMatch(render.bubble(scenario.steps[2]),/scenario-email-hero|scenario-email-cta|PREHEADER/);scenario.steps[2].emailMode='branded';assert.equal(JSON.stringify(scenario),before);
  }
});
test('explicit empty per-turn email assets stay cleared; absent legacy fields keep shared assets',()=>{
  const draft=fixture(),turns=draft.scenarios.email.turns;
  turns[0].presentation={kind:'email',mode:'branded',heroImageUrl:'https://example.test/opening.png',preheader:'OPENING PREHEADER',ctaLabel:'Opening details',ctaUrl:'https://example.test/opening'};
  turns[2].presentation={kind:'email',mode:'branded',heroImageUrl:'',preheader:'',ctaLabel:'',ctaUrl:''};
  const scenario=ai.toScenario('email',draft),render=emailRenderer(scenario),later=scenario.steps[2];
  assert.doesNotMatch(render.bubble(later),/opening.png|OPENING PREHEADER|scenario-email-hero|scenario-email-cta/);
  later.emailCtaLabel='Label retained while URL is cleared';assert.match(render.bubble(later),/href="#"/);assert.doesNotMatch(render.bubble(later),/href="https:\/\/example.test\/opening"/);
  later.emailCtaLabel='Legacy details';for(const key of ['emailHeroImage','emailPreheader','emailCtaUrl','emailLayout'])delete later[key];
  const legacy=render.bubble(later);assert.match(legacy,/opening.png/);assert.match(legacy,/OPENING PREHEADER/);assert.match(legacy,/href="https:\/\/example.test\/opening"/);
});
test('rich RCS and WhatsApp presentations and image-only messages survive',()=>{
  const draft=fixture();
  for(const channel of ['rcs','whatsapp']){
    draft.scenarios[channel].turns[0]={speaker:'company',text:'',presentation:{kind:'card',cards:[{title:'',description:'',imageUrl:'https://example.test/offer.png',ctaLabel:'',ctaUrl:''}]}};
    draft.scenarios[channel].turns[2].presentation={kind:'carousel',cards:[{title:'First',description:'Exact description',imageUrl:'https://example.test/first.png',ctaLabel:'Details',ctaUrl:'https://example.test/details'},{title:'Second'}]};
    const scenario=ai.toScenario(channel,draft);assert.equal(scenario.steps.length,3);assert.equal(scenario.steps[0].kind,'rich');assert.equal(scenario.steps[0].cardImage,'https://example.test/offer.png');assert.equal(scenario.steps[0].text,'');assert.equal(scenario.steps[2].cards[0].description,'Exact description');assert.equal(scenario.steps[2].kind,'carousel');
  }
});
test('WhatsApp rich and carousel cards omit empty CTAs and retain trimmed nonempty labels',()=>{
  const lines=fs.readFileSync(require.resolve('../interactive-simulator-builder.html'),'utf8').split('\n'),context={state:{},esc:value=>String(value??''),link:value=>String(value??''),safeActionUrl:value=>value,ensureCarouselCards:step=>step.cards};
  vm.runInNewContext([lines.find(line=>line.includes('function waCardMarkup(')),lines.find(line=>line.includes('function whatsappBubble('))].join('\n'),context);
  const message=(kind,label)=>kind==='rich'?{id:'rich',author:'brand',kind,text:'Offer',cardTitle:'A card',cardCta:label,cardUrl:'https://example.test/details'}:{id:'carousel',author:'brand',kind,text:'Offers',cards:[{id:'first',title:'First',cta:label,url:'https://example.test/details'},{id:'second',title:'Second',cta:label,url:'https://example.test/details'}]};
  for(const kind of ['rich','carousel']){
    for(const label of [undefined,'',' \t\n '])assert.doesNotMatch(context.whatsappBubble(message(kind,label)),/<a\b|Learn more|↗/);
    const rendered=context.whatsappBubble(message(kind,'  View details  '));
    assert.equal((rendered.match(/<a\b/g)||[]).length,kind==='rich'?1:2);
    assert.match(rendered,/<a href="https:\/\/example.test\/details" target="_blank">View details ↗<\/a>/);
    assert.doesNotMatch(rendered,/>  View details/);
  }
});
test('malformed provider content is rejected instead of repaired',()=>{
  for(const mutate of [draft=>delete draft.scenarios.rcs,draft=>draft.scenarios.sms.turns[0].speaker='unknown',draft=>draft.scenarios.sms.turns[0].text='',draft=>draft.scenarios.email.subject='',draft=>draft.initialSender='customer',draft=>draft.persona.customerName=123,draft=>draft.scenarios.sms.turns[0].presentation={kind:'card',cards:[{title:'Unsupported'}]},draft=>draft.scenarios.rcs.turns[0].presentation={kind:'card',cards:[{title:'Unsafe',ctaUrl:'javascript:alert(1)'}]}]){const draft=fixture();mutate(draft);assert.throws(()=>ai.validate(draft,channels),{code:'invalid_draft'})}
  const oneWay=fixture();oneWay.scenarios.sms.turns=oneWay.scenarios.sms.turns.filter(turn=>turn.speaker==='company');assert.throws(()=>ai.validate(oneWay,['sms']),{code:'invalid_draft'});
});
test('result validation binds channels, structured controls, supplied dialogue and persona',()=>{
  const request={channels,companyName:' Synthetic Co ',controls:{initialSender:'company',expectedMessageCount:3},persona};
  assert.deepEqual(ai.validateResult(result(),request),channels);
  for(const mutate of [response=>response.source.requestedChannels=['sms'],response=>response.draft.persona.customerName='Renamed',response=>response.requirements.channels.rcs.status='failed',response=>response.source.brief.scriptedTurns=[{speaker:'company',text:'Different supplied text'}]]){const response=result();mutate(response);assert.throws(()=>ai.validateResult(response,request),{code:'invalid_draft'})}
  assert.throws(()=>ai.validateResult(result(),{...request,controls:{expectedMessageCount:4}}),{code:'invalid_draft'});
  const inconsistent=result();inconsistent.requirements.channels.sms.checks[0].status='failed';assert.throws(()=>ai.validateResult(inconsistent,request),{code:'invalid_draft'});
  const renamed=result();renamed.draft.companyName='Different Co';assert.throws(()=>ai.validateResult(renamed,request),/company name/);
});
test('client validation provides actionable sender/count issue metadata without accepting mismatches',()=>{
  const {format}=require('../assets/ai-error-guidance.js');
  const request={channels,controls:{initialSender:'customer',expectedMessageCount:4},persona};
  assert.throws(()=>ai.validateResult(result(),request),error=>{
    assert.equal(error.code,'invalid_draft');
    assert.deepEqual(error.issues.map(issue=>[issue.code,issue.field,issue.channel]),[['sender_mismatch','initialSender','sms'],['count_mismatch','expectedMessageCount','sms']]);
    assert.equal(error.issues[0].expectedSender,'customer');assert.equal(error.issues[1].expectedMessageCount,4);
    const guidance=format(error,request);assert.equal(guidance.actions.length,2);assert.match(guidance.actions[0].text,/For this attempt.*was set to Customer opens/);assert.match(guidance.actions[1].text,/For this attempt.*was set to 4/);
    return true;
  });
  const inferred=result();inferred.source.brief.initialSender='customer';
  assert.throws(()=>ai.validateResult(inferred,{channels}),error=>{assert.equal(error.issues[0].expectedSender,'customer');assert.match(format(error,{channels}).actions[0].text,/choose Customer opens/);return true;});
});
test('client validation identifies each changed persona field and handles malformed values safely',()=>{
  const {format}=require('../assets/ai-error-guidance.js');
  const targets={customerName:'customer-name',representativeName:'representative-name',representativeRole:'representative-role'};
  for(const [field,target] of Object.entries(targets)){
    const response=result(),request={channels,persona};response.draft.persona[field]='Changed';
    assert.throws(()=>ai.validateResult(response,request),error=>{assert.equal(error.code,'invalid_draft');assert.equal(error.issues[0].code,'persona_mismatch');assert.equal(error.issues[0].field,field);const guidance=format(error,request);assert.equal(guidance.controlTarget,target);assert.match(guidance.actions[0].text,/For this attempt, you supplied an entry/);return true;});
    assert.throws(()=>ai.validateResult(result(),{channels,persona:{[field]:42}}),error=>{assert.equal(error.code,'invalid_draft');assert.equal(error.issues[0].code,'invalid_persona');assert.equal(error.issues[0].field,field);return true;});
    const malformed=result();malformed.draft.persona=null;assert.throws(()=>ai.validateResult(malformed,request),{code:'invalid_draft'});
  }
  assert.deepEqual(ai.validateResult(result(),{channels,persona:null}),channels);
});
test('client script integrity errors target the brief and never relax verbatim matching',()=>{
  const {format}=require('../assets/ai-error-guidance.js');
  for(const scriptedTurns of [[{speaker:'company',text:'Not what was supplied.'}],[{speaker:'company',text:'Changed opening.'},{speaker:'customer',text:'Changed reply.'},{speaker:'company',text:'Changed close.'}],[null]]){
    const response=result();response.source.brief.scriptedTurns=scriptedTurns;
    assert.throws(()=>ai.validateResult(response,{channels}),error=>{assert.equal(error.code,'invalid_draft');assert.equal(error.issues[0].code,'dialogue_mismatch');assert.equal(error.issues[0].channel,'sms');assert.equal(error.issues[0].field,'scriptedTurns');const guidance=format(error,{channels});assert.equal(guidance.actions[0].target,'brief');assert.equal(guidance.controlTarget,undefined);return true;});
  }
});
test('backend-validated single quoted line and ordered multi-line dialogue pass the frontend unchanged',()=>{
  const contract=require('../server/draft-contract.cjs');
  for(const useCase of ['Company says "Welcome." Continue the conversation.','Company: Welcome.\nCompany: Zoë is joining.\nCustomer: Thank you.']){
    const request={companyName:'Synthetic Co',website:'https://example.test',channels:['sms'],useCase,controls:{initialSender:null,expectedMessageCount:null},persona:{customerName:'',representativeName:'',representativeRole:''}},brief=contract.storyBrief(request);
    const turns=brief.scriptedTurns.length>1?brief.scriptedTurns:[{speaker:'company',text:'Welcome.'},{speaker:'customer',text:'Thank you.',mode:'prefill'},{speaker:'company',text:'How can I help?'}];
    const normalized=contract.validateAndNormalizeDraft({schemaVersion:2,companyName:'Synthetic Co',initialSender:'company',scenarios:{sms:{title:'Quoted line',turns}}},request,{url:request.website,candidates:[],links:[],emails:[]},brief);
    const response={...normalized,source:{mode:'provider',requestedChannels:['sms'],coverage:'partial',brief}};
    assert.deepEqual(ai.validateResult(response,request),['sms']);assert.deepEqual(ai.toScenario('sms',response.draft).steps.map(step=>[step.author,step.text]),response.draft.scenarios.sms.turns.map(turn=>[turn.speaker==='company'?'brand':'customer',turn.text]));
  }
});
test('array choices survive saved-scenario normalization and legacy comma lists remain readable',()=>{
  assert.deepEqual(ai.options(['Yes, please','Line one\nline two']),['Yes, please','Line one\nline two']);assert.deepEqual(ai.options('Yes, No'),['Yes','No']);
  const html=fs.readFileSync(require.resolve('../interactive-simulator-builder.html'),'utf8'),source=html.split('\n').find(line=>line.includes('function normalizeJourneyStep(')),context={crypto};vm.runInNewContext(source+';this.normalize=normalizeJourneyStep;',context);
  const normalized=context.normalize({id:'choice',author:'customer',kind:'prefilled',text:'',options:['Yes, please','No, thanks']},0);assert.deepEqual([...normalized.options],['Yes, please','No, thanks']);
});
test('structured controls never mutate the prompt and reject fractional totals',()=>{
  const values={'[data-v2-message-total]':'3','[data-v2-opening-sender]':'customer','[data-v2-customer-name]':'José O’Neil'},document={querySelector:selector=>({value:values[selector]||''})};
  assert.deepEqual(ai.readControls(document).controls,{initialSender:'customer',expectedMessageCount:3});values['[data-v2-message-total]']='2.5';assert.throws(()=>ai.readControls(document),/whole number/);
});
test('invalid local controls identify the offending user setting rather than blaming generation',()=>{
  const {format}=require('../assets/ai-error-guidance.js');
  const values={'[data-v2-message-total]':'2.5'},document={querySelector:selector=>({value:values[selector]||''})};
  assert.throws(()=>ai.readControls(document),error=>{assert.equal(error.code,'invalid_draft');assert.equal(error.issues[0].code,'invalid_count');assert.equal(error.issues[0].origin,'user-input');assert.equal(format(error).controlTarget,'message-total');return true;});
  values['[data-v2-message-total]']='';values['[data-v2-opening-sender]']='unlisted';
  assert.throws(()=>ai.readControls(document),error=>{assert.equal(error.issues[0].code,'invalid_sender');assert.equal(error.issues[0].origin,'user-input');const guidance=format(error);assert.equal(guidance.controlTarget,'opening-sender');assert.match(guidance.summary,/Choose a valid opening sender/);assert.doesNotMatch(guidance.summary,/AI did not follow/);return true;});
});
test('QA treats rich/image content as meaningful and does not claim export or factual verification',()=>{
  const scenario={channel:'rcs',steps:[{id:'card',author:'brand',kind:'rich',text:'',cardImage:'https://example.test/card.png'},{id:'input',author:'customer',kind:'free',reusableSet:true,text:''},{id:'response',author:'brand',kind:'text',text:'Reply'}]};
  const review=ai.reviewScenario(scenario);assert.deepEqual(review.issues,[]);assert.match(review.routing,/may be alternatives/);assert.match(review.note,/verify assets during export/);
});
test('fallback notices report cause and partial coverage without inventing names',()=>{
  const text=ai.fallbackMessage({fallbackReason:'gemini_rate_limited',coverage:'partial'});assert.match(text,/rate limit/);assert.match(text,/partial/);assert.doesNotMatch(text,/slow|named people/);assert.match(ai.fallbackMessage({fallbackReason:'gemini_bad_json'}),/unreadable/);
});

function brandingFixture(){
  const request={companyName:'Synthetic Co',website:'https://example.test/',channels:[...channels],controls:{initialSender:null}};
  return {request,branding:{schemaVersion:1,mode:'website-only',companyName:request.companyName,requestedWebsite:request.website,requestedChannels:[...channels],source:{url:request.website,title:'Synthetic website',partial:false,assets:'unverified'},imageCandidates:[{url:'https://example.test/logo.png',role:'logo'},{url:'https://example.test/hero.png',role:'hero'}]}};
}
test('branding recovery binds website, identity and channels and never imports provider dialogue',()=>{
  const {request,branding}=brandingFixture();
  const checked=ai.validateBranding({...branding,draft:fixture(),turns:[{text:'Do not import'}]},request);
  assert.equal(checked.draft,undefined);assert.equal(checked.turns,undefined);
  assert.doesNotThrow(()=>ai.validateBranding(branding,{...request,website:'https://example.test'}));
  for(const mutate of [value=>value.requestedWebsite='https://other.test/',value=>value.requestedChannels=['sms'],value=>value.requestedChannels.push('sms'),value=>value.companyName='Someone else',value=>value.source.assets='verified',value=>value.source.partial=undefined,value=>value.source.title='x'.repeat(301),value=>value.imageCandidates.push(value.imageCandidates[0]),value=>value.imageCandidates[0].url='javascript:alert(1)',value=>value.imageCandidates[0].url='https://user:password@example.test/logo.png',value=>value.imageCandidates[0].url='https://example.test/'+ 'a'.repeat(2048)]){
    const changed=JSON.parse(JSON.stringify(branding));mutate(changed);assert.throws(()=>ai.validateBranding(changed,request),{code:'invalid_draft'});
  }
  checked.imageCandidates[0].url='changed';assert.notEqual(branding.imageCandidates[0].url,'changed');
});
test('branding defaults are evidence-based and allow explicit customer-first manual setup',()=>{
  const {request,branding}=brandingFixture();
  assert.deepEqual(ai.brandingSelection(branding,request),{companyName:'Synthetic Co',initialSender:'company',logoUrl:branding.imageCandidates[0].url,heroImageUrl:branding.imageCandidates[1].url});
  request.controls.initialSender='customer';assert.equal(ai.brandingSelection(branding,request).initialSender,'customer');
  branding.companyName=request.companyName='';branding.imageCandidates=[{url:'https://example.test/photo.png',role:'image'}];
  const selection=ai.brandingSelection(branding,request);assert.equal(selection.companyName,'');assert.equal(selection.logoUrl,'');assert.equal(selection.heroImageUrl,'');
});
test('branding-only scenarios contain independent empty flows and embedded assets for every channel',()=>{
  const {request,branding}=brandingFixture(),selection=ai.brandingSelection(branding,request),image='data:image/png;base64,aGVsbG8=';
  let sequence=0;const variants=channels.map(channel=>ai.brandingScenario(channel,branding,selection,{avatar:image,hero:image,id:()=>`manual-${++sequence}`,failureReason:'Provider timed out.'}));
  for(const scenario of variants){
    assert.equal(scenario.generatedByAi,false);assert.equal(scenario.avatar,image);assert.equal(scenario.emailAddress,'');assert.ok(scenario.steps.every(step=>step.text===''));assert.deepEqual(scenario.steps.map(step=>step.author),['brand','customer']);assert.equal(scenario.brandingRecovery.failureReason,'Provider timed out.');
    assert.equal(scenario.steps[1].kind,'free');assert.equal(scenario.steps[1].reusableSet,false);
    if(['rcs','whatsapp'].includes(scenario.channel)){assert.equal(scenario.steps[0].cardImage,image);assert.equal(scenario.steps[0].cardCta,'');}
    if(scenario.channel==='email'){assert.equal(scenario.emailHeroImage,image);assert.equal(scenario.steps[0].emailLogo,image);assert.equal(scenario.subject,'');assert.equal(scenario.steps[0].emailPreheader,'');}
  }
  variants[0].steps[0].text='SMS edit';assert.equal(variants[1].steps[0].text,'');
  selection.initialSender='customer';const email=ai.brandingScenario('email',branding,selection,{avatar:image,hero:image});assert.deepEqual(email.steps.map(step=>step.author),['customer','brand']);assert.equal(email.steps[1].emailHeroImage,image);
});
test('branding manual creation omits unavailable images and rejects unembedded remote images',()=>{
  const {request,branding}=brandingFixture(),selection=ai.brandingSelection(branding,request);
  const scenario=ai.brandingScenario('rcs',branding,selection,{assetWarnings:['Logo unavailable']});
  assert.equal(scenario.avatar,'');assert.equal(scenario.steps[0].kind,'text');assert.deepEqual(scenario.brandingRecovery.assetWarnings,['Logo unavailable']);
  for(const avatar of ['https://example.test/logo.png','javascript:alert(1)','data:text/html;base64,aaaa'])assert.throws(()=>ai.brandingScenario('sms',branding,selection,{avatar}),{code:'invalid_draft'});
  assert.throws(()=>ai.brandingScenario('email',branding,{...selection,companyName:' '}),{code:'invalid_draft'});
});
test('branding recovery accepts every image type supported by the guarded asset endpoint, including favicons',()=>{
  const {supportedImageTypes}=require('../server/security.cjs'),{request,branding}=brandingFixture(),selection=ai.brandingSelection(branding,request);
  for(const mime of supportedImageTypes){const avatar=`data:${mime};base64,aGVsbG8=`;assert.equal(ai.brandingScenario('sms',branding,selection,{avatar}).avatar,avatar,mime);}
});
test('manual recovery notice tolerates malformed imported metadata and escapes valid details',()=>{
  const html=fs.readFileSync(require.resolve('../interactive-simulator-builder.html'),'utf8'),source=html.slice(html.indexOf('    function renderAiBrandingRecovery(panel){'),html.indexOf('    async function applyAiBranding(){'));
  const render=recovery=>{
    const notes=[],panel={querySelector:selector=>selector==='.setup-assistant'?{append:note=>notes.push(note)}:null};
    const context={state:{setupMode:'manual',aiSetup:{}},active:()=>({brandingRecovery:recovery}),document:{createElement:()=>({})},esc:value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')};
    vm.runInNewContext(html.split('\n').find(line=>line.trim().startsWith('function withErrorSupport('))+'\n'+source,context);context.renderAiBrandingRecovery(panel);return notes[0]?.innerHTML||'';
  };
  for(const assetWarnings of ['unexpected',42,{},null,[null,42,{},'IMAGE WARNING']])assert.match(render({failureReason:{bad:'value'},assetWarnings}),/The scenario could not be generated/);
  for(const invalid of ['unexpected metadata',42,[],null])assert.equal(render(invalid),'');
  const output=render({failureReason:'<script>failure</script>',assetWarnings:['<img src=x onerror=alert(1)>']});assert.doesNotMatch(output,/<script>|<img/);assert.match(output,/&lt;script&gt;failure/);assert.match(output,/&lt;img/);
});
