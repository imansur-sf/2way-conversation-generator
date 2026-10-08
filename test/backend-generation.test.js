const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const test = require('node:test');
const {CHANNELS, normalizeControls, storyBrief, explicitTurns, generationPolicy, validateAndNormalizeDraft, promptFallback, draftPrompt, draftResponseSchema} = require('../server/draft-contract.cjs');
const {aiConfig, providerHealth, MAX_PROVIDER_ATTEMPTS} = require('../server/ai-config.cjs');

const root = path.resolve(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const request = (extra = {}) => ({companyName:'Example', website:'https://example.com/', useCase:'Demonstrate a helpful conversation.', channels:['sms'], ...extra});
const evidence = {url:'https://example.com/', title:'Example', description:'Synthetic reference page', text:'Synthetic reference page', headings:[], links:['https://example.com/details'], emails:['support@example.com'], candidates:[{url:'https://example.com/logo.svg',role:'logo'},{url:'https://example.com/hero.png',role:'hero'}]};
function draft(channels = ['sms']) {
  return {schemaVersion:2, companyName:'Example', initialSender:'company', logoUrl:'https://example.com/logo.svg', scenarios:Object.fromEntries(channels.map(channel=>[channel, {
    title:`${channel} invitation`, sender:'Example', subject:channel==='email'?'Your invitation details':'',
    turns:[{speaker:'company',text:`Welcome to Example via ${channel}.`, ...(channel==='email'?{presentation:{kind:'email',mode:'plain'}}:{})},{speaker:'customer',text:'Please share the details.',mode:'prefill',options:[]}]
  }]))};
}
function loadPipeline(responses, env = {}) {
  const calls = [], network = [], logs=[], requireHere=createRequire(path.join(root,'server.js'));
  const context=vm.createContext({
    require:name=>name==='node:http'?{createServer(){return {listen(){}};}}:requireHere(name),
    __dirname:root,process:{env:{APP_ENV:'test',GEMINI_API_KEY:'synthetic-offline-key',...env}},
    console:{log(value){logs.push(value);},error(value){logs.push(value);},warn(){}},Buffer,URL,AbortController,queueMicrotask,
    setTimeout:(callback,delay)=>setTimeout(callback,delay===350?0:delay),clearTimeout,
    fetch:async(url,options)=>{
      calls.push({url,headers:options.headers,body:JSON.parse(options.body)});
      const next=responses[Math.min(calls.length-1,responses.length-1)];
      if(next instanceof Error)throw next;
      if(next?.httpStatus)return new Response(next.errorBody===undefined?'':typeof next.errorBody==='string'?next.errorBody:JSON.stringify(next.errorBody),{status:next.httpStatus});
      return {ok:true,json:async()=>next?.envelope || {candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(next)}]}}]}};
    },
  });
  vm.runInContext(`${serverSource}\nthis.api={parseJson,generateScenarioDraft,validateDraftRequest,startGenerationJob,publicJob,draftCache,generationJobs,active:()=>activeGenerations,health:()=>providerHealth(aiSettings,providerObservation)};`,context);
  context.fetchRemote=async url=>{network.push(url);return {url:'https://example.com/',contentType:'text/html',body:Buffer.from('<title>Example</title><link rel="icon" href="/logo.svg"><meta property="og:image" content="/hero.png"><a href="/details">Details</a><a href="mailto:support@example.com">Contact</a><p>Synthetic reference page.</p>')};};
  return {...context.api,context,calls,network,logs};
}

test('actual provider JSON parser accepts fenced whitespace and rejects surrounding prose',async()=>{
  const pipeline=loadPipeline([]);
  for(const value of ['{"ok":true}','```json\n{"ok":true}\n```','```JSON\r\n  {"ok":true}\r\n```','```\n{"ok":true}\n```','  ```json\t {"ok":true}\n```  '])assert.deepEqual(clone(pipeline.parseJson(value)),{ok:true});
  for(const value of ['Here is the result: {"ok":true}','```json\n{"ok":true}\n``` trailing prose','```json\\s{"ok":true}```'])assert.throws(()=>pipeline.parseJson(value),{code:'gemini_bad_json'});
  const fenced=loadPipeline([{envelope:{candidates:[{finishReason:'STOP',content:{parts:[{text:'```json\n'+JSON.stringify(draft())+'\n```'}]}}]}}]);
  const result=await fenced.generateScenarioDraft(request(),'fenced');
  assert.equal(result.source.mode,'provider');assert.equal(fenced.calls.length,1);assert.equal(fenced.draftCache.size,1);
});
test('named role labels preserve dialogue without treating bare capitalization as persona evidence',()=>{
  for(const label of ['Customer named Avery says','Customer called María O’Neill responds','Customer Avery:','Customer Support:']) {
    const useCase=`${label} "Please keep these exact words." Company: "Of course."`;
    const brief=storyBrief(request({useCase}));
    assert.deepEqual(brief.scriptedTurns.map(({speaker,text})=>({speaker,text})),[{speaker:'customer',text:'Please keep these exact words.'},{speaker:'company',text:'Of course.'}]);
    assert.equal(brief.expectedMessageCount,2);assert.equal(brief.initialSender,'customer');
    assert.equal(brief.persona.customerName,label.includes('named')?'Avery':label.includes('called')?'María O’Neill':'');
  }
  const unquoted=storyBrief(request({useCase:'Customer named Avery: Keep this.\nCompany Acme: Certainly.'}));
  assert.deepEqual(unquoted.scriptedTurns.map(turn=>turn.text),['Keep this.','Certainly.']);assert.equal(unquoted.persona.customerName,'Avery');
  const nested=explicitTurns('Company: “The customer named Avery says ‘Yes, please’ to confirm.” Customer Avery: “I agree.”');
  assert.equal(nested.length,2);assert.equal(nested[0].text,'The customer named Avery says ‘Yes, please’ to confirm.');
  for(const useCase of ['Customer Support responds "Welcome."','Customer Requests information.','An Agent Answers Questions.']) {
    const brief=storyBrief(request({useCase}));assert.equal(brief.persona.customerName,'');assert.equal(brief.persona.representativeName,'');assert.equal(brief.scriptedTurns.length,0);
  }
  const input=request({useCase:'Customer named Avery says "Please keep these exact words." Company: "Of course."'});
  const validated=validateAndNormalizeDraft(draft(),input,evidence).draft;
  assert.equal(validated.persona.customerName,'Avery');assert.equal(validated.scenarios.sms.turns[0].text,'Please keep these exact words.');
});
test('role verbs and capitalized role nouns are not invented personal names',()=>{
  for(const useCase of ['Customer says "Hello." Company responds "Welcome."','The customer responds to an invitation.','Customer Support responds. Customer Requests information.','An Agent Answers Questions.','Customer Success sends an update.']) {
    const brief=storyBrief(request({useCase}));
    assert.equal(brief.persona.customerName,'');assert.equal(brief.persona.representativeName,'');
  }
});
test('explicit names retain Unicode, apostrophes and structured input precedence',()=>{
  const brief=storyBrief(request({useCase:'A customer named María O’Neill asks about details. An account executive called Zoë de la Cruz responds.',persona:{customerName:'李 明'}}));
  assert.deepEqual(brief.persona,{customerName:'李 明',representativeName:'Zoë de la Cruz',representativeRole:'account executive'});
  assert.equal(brief.facts.find(item=>item.field==='customerName').origin,'user-input');
  assert.equal(brief.facts.find(item=>item.field==='representativeName').origin,'explicit-prompt');
  assert.equal(storyBrief(request({useCase:'A customer, Sean, replies.'})).persona.customerName,'Sean');
  assert.equal(storyBrief(request({useCase:'Customer (Avery) says "Hi."'})).persona.customerName,'Avery');
});
test('quoted role wording inside dialogue is never parsed as another turn',()=>{
  for(const useCase of [
    'Company: "The customer says \'Yes, please\' to confirm."\nCustomer: "I agree."',
    'Company says “The customer says ‘Yes, please’ to confirm.” Customer says “I agree.”',
  ]) {const turns=explicitTurns(useCase);assert.equal(turns.length,2);assert.match(turns[0].text,/customer says/);assert.equal(turns[1].text,'I agree.');}
  assert.equal(explicitTurns("Customer says 'I'm ready, O'Neill.' Company says 'Welcome.'")[0].text,"I'm ready, O'Neill.");
  const quotedInstruction=storyBrief(request({useCase:'Company says "A customer named Alex asked for 9 messages." Customer says "I am Sam."'}));
  assert.equal(quotedInstruction.persona.customerName,'');assert.equal(quotedInstruction.expectedMessageCount,2,'quoted content is not a generation-count instruction');
});
test('invalid controls and conflicting exact dialogue fail before provider or job admission',()=>{
  const pipeline=loadPipeline([draft()]);
  for(const expectedMessageCount of [1,13,3.5,'4',NaN])assert.throws(()=>pipeline.startGenerationJob(request({controls:{expectedMessageCount}}),'r'),{code:'invalid_controls'});
  for(const controls of [{initialSender:'agent'},{initialSender:false},{initialSender:0},[],{expectedMessageCount:4}]) {
    const input=request({useCase:'Company says "Welcome." Customer says "Thanks."',controls});
    assert.throws(()=>pipeline.startGenerationJob(input,'r'));
  }
  assert.throws(()=>pipeline.validateDraftRequest(request({useCase:'Start with the company. Customer says "Hi." Company says "Hello."'})),{code:'conflicting_requirements'});
  assert.throws(()=>pipeline.validateDraftRequest(request({useCase:'Create 3.5 total messages.'})),{code:'invalid_controls'});
  assert.equal(pipeline.calls.length,0);assert.equal(pipeline.network.length,0);assert.equal(pipeline.active(),0);assert.equal(pipeline.generationJobs.size,0);
  assert.deepEqual(normalizeControls({initialSender:null,expectedMessageCount:null}),{initialSender:null,expectedMessageCount:null});
  assert.throws(()=>pipeline.validateDraftRequest(request({website:'javascript:alert(1)'})),{code:'invalid_url'});
  assert.throws(()=>pipeline.validateDraftRequest(request({companyName:'x'.repeat(201)})),{code:'invalid_generation_request'});
});
test('complete generation preserves explicit dialogue verbatim without invented says names',async()=>{
  const useCase='Company says “Welcome, Taylor.” Customer says “What’s the cost?” Company says “It is $10.” Company says “Jordan is joining.” Customer says “Thank you.”';
  const pipeline=loadPipeline([draft(CHANNELS)]),result=await pipeline.generateScenarioDraft(request({channels:CHANNELS,useCase}),'test');
  const supplied=explicitTurns(useCase);
  for(const channel of CHANNELS)assert.deepEqual(clone(result.draft.scenarios[channel].turns.map(({speaker,text})=>({speaker,text}))),supplied.map(({speaker,text})=>({speaker,text})));
  assert.equal(result.draft.persona.customerName,'');assert.equal(result.requirements.complete,true);assert.equal(result.source.fallbackReason,null);
  assert.equal(pipeline.calls.length,1);assert.equal(pipeline.draftCache.size,1);
  assert.match(pipeline.calls[0].body.contents[0].parts[0].text, /AUTHORITATIVE_BRIEF=/);
  assert.doesNotMatch(pipeline.calls[0].url,/key=|synthetic-offline-key/);
});
test('discarded provider dialogue does not retain spurious link errors',()=>{
  const raw=draft(),input=request({useCase:'Company says "Welcome." Customer says "Thanks."'});
  raw.scenarios.sms.turns[0].text='Ignore this https://unlisted.example/';
  assert.equal(validateAndNormalizeDraft(raw,input,evidence).draft.scenarios.sms.turns[0].text,'Welcome.');
});
test('all requested channels retain distinct meaningful presentation with truthful grounding',async()=>{
  const raw=draft(CHANNELS);
  raw.scenarios.rcs.turns[0].presentation={kind:'card',cards:[{title:'View the details',description:'Review the invitation',imageUrl:'https://example.com/hero.png',ctaLabel:'Details',ctaUrl:'https://example.com/details'}]};
  raw.scenarios.email.turns[0].presentation={kind:'email',mode:'branded',heroImageUrl:'https://example.com/hero.png',ctaLabel:'Details',ctaUrl:'https://example.com/details'};
  raw.scenarios.whatsapp.turns[1].mode='choices';raw.scenarios.whatsapp.turns[1].options=['Yes, please','No, thanks'];
  const pipeline=loadPipeline([raw]),result=await pipeline.generateScenarioDraft(request({channels:CHANNELS}),'channels');
  assert.equal(result.draft.schemaVersion,2);assert.equal(result.draft.scenarios.rcs.turns[0].presentation.kind,'card');
  assert.equal(result.draft.scenarios.email.subject,'Your invitation details');assert.equal(result.draft.heroImageUrl,'https://example.com/hero.png');
  assert.deepEqual(clone(result.draft.scenarios.whatsapp.turns[1].options),['Yes, please','No, thanks']);
  assert.notEqual(result.draft.scenarios.sms.turns[0].text,result.draft.scenarios.email.turns[0].text);
  assert.equal(result.source.grounding.status,'unverified');assert.equal(result.source.coverage,'partial');
  for(const channel of CHANNELS)assert.equal(result.requirements.channels[channel].checks.find(check=>check.id==='factual_accuracy').status,'unverified');
  assert.deepEqual(clone(pipeline.calls[0].body.generationConfig.responseSchema.properties.scenarios.required),CHANNELS);
  assert.doesNotThrow(()=>validateAndNormalizeDraft(raw,request({channels:CHANNELS,useCase:'Use an RCS rich card, conversational WhatsApp, and email.'}),evidence),'RCS cards must not force WhatsApp cards');
});
test('provider schema specializes each channel and avoids the rejected union/cardinality complexity',()=>{
  const schema=draftResponseSchema(CHANNELS),scenarios=schema.properties.scenarios;
  assert.deepEqual(scenarios.required,CHANNELS);
  assert.deepEqual(Object.keys(scenarios.properties),CHANNELS);
  for(const field of ['schemaVersion','companyName','initials','emailAddress','logoUrl','heroImageUrl','brandColor','brandSecondaryColor','initialSender'])assert.ok(schema.properties[field],field);
  for(const channel of CHANNELS){
    const scenario=scenarios.properties[channel],turn=scenario.properties.turns.items,presentation=turn.properties.presentation;
    assert.deepEqual(turn.required,['speaker','text']);assert.deepEqual(turn.properties.speaker.enum,['company','customer']);
    assert.deepEqual(turn.properties.mode.enum,['prefill','choices']);assert.equal(turn.properties.options.items.type,'STRING');
    assert.deepEqual(scenario.required,channel==='email'?['title','subject','turns']:['title','turns']);
    if(channel==='sms'){
      assert.deepEqual(presentation.properties.kind.enum,['text']);assert.deepEqual(Object.keys(presentation.properties),['kind']);
    }else if(channel==='email'){
      assert.deepEqual(presentation.properties.kind.enum,['text','email']);assert.deepEqual(presentation.properties.mode.enum,['plain','branded']);
      assert.deepEqual(Object.keys(presentation.properties),['kind','mode','preheader','heroImageUrl','ctaLabel','ctaUrl']);
      assert.equal(scenario.properties.subject.type,'STRING');
    }else{
      assert.deepEqual(presentation.properties.kind.enum,['text','card','carousel']);assert.deepEqual(Object.keys(presentation.properties),['kind','cards']);
      assert.deepEqual(Object.keys(presentation.properties.cards.items.properties),['title','description','imageUrl','ctaLabel','ctaUrl']);
    }
    if(channel!=='email'){assert.equal(scenario.properties.subject,undefined);assert.equal(scenario.properties.preheader,undefined);}
  }
  let nodes=0,optional=0;
  function inspect(node){
    nodes++;assert.equal(node.minItems,undefined);assert.equal(node.maxItems,undefined);
    for(const field of node.required||[])assert.ok(node.properties?.[field],field);
    optional+=Object.keys(node.properties||{}).filter(field=>!node.required?.includes(field)).length;
    for(const child of Object.values(node.properties||{}))inspect(child);if(node.items)inspect(node.items);
  }
  inspect(schema);
  // The rejected schema had 115 nodes, 70 optional fields and 4,764 bytes.
  assert.equal(nodes,80);assert.equal(optional,39);assert.ok(JSON.stringify(schema).length<3500);
  assert.deepEqual(Object.keys(draftResponseSchema(['email']).properties.scenarios.properties),['email']);
});
test('generation sends request-aware modes and explicit empty-image enums through both attempts',async()=>{
  const good=draft(CHANNELS);good.logoUrl='';good.scenarios.rcs.turns[0].presentation={kind:'card',cards:[{title:'Invitation details',description:'Ask for details.',imageUrl:''}]};
  const bad=clone(good);bad.scenarios.sms.turns[1].mode='free';bad.scenarios.email.turns[1].mode='free';bad.scenarios.rcs.turns[0].presentation.cards[0].imageUrl='https://invented.example/card.png';bad.logoUrl='https://invented.example/logo.png';
  const pipeline=loadPipeline([bad,good]);
  pipeline.context.fetchRemote=async()=>({url:'https://example.com/',contentType:'text/html',body:Buffer.from('<title>Example</title><p>No published images.</p>')});
  const result=await pipeline.generateScenarioDraft(request({channels:CHANNELS,controls:{initialSender:'company',expectedMessageCount:2},useCase:'A customer asks for details. Use an RCS rich card.'}),'request-policy');
  assert.equal(pipeline.calls.length,2);assert.equal(result.source.mode,'provider');assert.equal(pipeline.draftCache.size,1);
  assert.equal(result.draft.logoUrl,'');assert.equal(result.draft.scenarios.rcs.turns[0].presentation.cards[0].imageUrl,'');
  for(const call of pipeline.calls){
    const schema=call.body.generationConfig.responseSchema,prompt=call.body.contents[0].parts[0].text;
    const policy=JSON.parse(prompt.match(/^GENERATION_POLICY=(.+)$/m)[1]);
    assert.deepEqual(policy,{customerModes:['prefill','choices'],imageUrls:[''],imageEnumConstrained:true});
    for(const channel of CHANNELS)assert.deepEqual(schema.properties.scenarios.properties[channel].properties.turns.items.properties.mode.enum,['prefill','choices']);
    assert.deepEqual(schema.properties.logoUrl.enum,['']);assert.deepEqual(schema.properties.heroImageUrl.enum,['']);
    assert.deepEqual(schema.properties.scenarios.properties.rcs.properties.turns.items.properties.presentation.properties.cards.items.properties.imageUrl.enum,['']);
    assert.deepEqual(schema.properties.scenarios.properties.email.properties.turns.items.properties.presentation.properties.heroImageUrl.enum,['']);
    assert.match(prompt,/NO approved images/);assert.match(prompt,/not a request for a free-input UI/);assert.match(prompt,/rich card can have title\/description and no image/);
  }
  const repair=JSON.parse(pipeline.calls[1].body.contents[0].parts[0].text.match(/^CORRECT_THESE_VALIDATION_ISSUES=(.+)$/m)[1]);
  assert.equal(repair.filter(item=>item.code==='unrequested_free_input').length,2);assert.equal(repair.filter(item=>item.code==='unlisted_url').length,2);
});
test('source-listed and explicit image URLs remain literal, deterministic choices; requested free input stays available',async()=>{
  const supplied='https://assets.example/selected.png?size=large&version=2';
  const input=request({channels:CHANNELS,useCase:`Use this supplied image ${supplied} and open-ended customer input.`});
  const policy=generationPolicy(input,evidence,storyBrief(input));
  assert.deepEqual(policy.customerModes,['prefill','free','choices']);assert.equal(policy.imageEnumConstrained,true);
  assert.deepEqual(policy.imageUrls,['',supplied,'https://example.com/logo.svg','https://example.com/hero.png']);
  assert.deepEqual(generationPolicy(input,evidence,storyBrief(input)),policy);
  const raw=draft(CHANNELS);raw.logoUrl=supplied;raw.scenarios.rcs.turns[0].presentation={kind:'card',cards:[{title:'Details',imageUrl:'https://example.com/hero.png'}]};
  for(const channel of CHANNELS)raw.scenarios[channel].turns[1]={speaker:'customer',text:'',mode:'free',options:[]};
  const pipeline=loadPipeline([raw]),result=await pipeline.generateScenarioDraft(input,'selected-images');
  assert.equal(pipeline.calls.length,1);assert.equal(result.draft.logoUrl,supplied);
  const schema=pipeline.calls[0].body.generationConfig.responseSchema;
  assert.deepEqual(schema.properties.logoUrl.enum,policy.imageUrls);
  assert.deepEqual(schema.properties.scenarios.properties.sms.properties.turns.items.properties.mode.enum,['prefill','free','choices']);
  assert.equal(result.draft.scenarios.sms.turns[1].mode,'free');
});
test('image enum overflow retains every explicit source in the prompt and final validation without rejecting requests',async()=>{
  const sources=Array.from({length:7},(_,index)=>`https://assets.example/image-${index}.png`);
  const longUrl='https://assets.example/selected.png?signature='+'a'.repeat(1600);
  for(const supplied of [sources,[longUrl]]){
    const input=request({channels:CHANNELS,useCase:'Demonstrate a helpful conversation using these supplied references: '+supplied.join(' ')});
    const policy=generationPolicy(input,evidence,storyBrief(input)),schema=draftResponseSchema(CHANNELS,policy),prompt=draftPrompt(input,evidence,storyBrief(input),[],policy);
    assert.equal(policy.imageEnumConstrained,false);assert.equal(schema.properties.logoUrl.enum,undefined);assert.equal(schema.properties.logoUrl.type,'STRING');
    assert.ok(JSON.stringify(schema).length<3500,'overflow does not expand the accepted schema topology');
    for(const url of supplied){assert.ok(policy.imageUrls.includes(url));assert.ok(prompt.includes(url));}
    const raw=draft(CHANNELS);raw.logoUrl=supplied.at(-1);
    const pipeline=loadPipeline([raw]);assert.doesNotThrow(()=>pipeline.validateDraftRequest(input));
    const result=await pipeline.generateScenarioDraft(input,'overflow');assert.equal(result.draft.logoUrl,supplied.at(-1));assert.equal(pipeline.calls.length,1);
    const sent=pipeline.calls[0].body;assert.equal(sent.generationConfig.responseSchema.properties.logoUrl.enum,undefined);
    for(const url of supplied)assert.ok(sent.contents[0].parts[0].text.includes(url));
    const malicious=clone(raw);malicious.logoUrl='https://not-listed.example/logo.png';
    const rejected=loadPipeline([malicious]);await assert.rejects(rejected.generateScenarioDraft(input,'overflow-invalid'),error=>error.code==='draft_invalid'&&error.issues.some(item=>item.code==='unlisted_url'));
    assert.equal(rejected.calls.length,2);assert.equal(rejected.draftCache.size,0);
  }
});
test('server still rejects oversized turns, reply choices and carousels with simplified provider schema',async()=>{
  const turns=draft();turns.scenarios.sms.turns=Array.from({length:13},(_,index)=>({speaker:index%2?'customer':'company',text:'Message'}));
  const choices=draft();choices.scenarios.sms.turns[1]={speaker:'customer',text:'Choose.',mode:'choices',options:Array.from({length:7},(_,index)=>`Choice ${index}`)};
  const cards=draft(['rcs']);cards.scenarios.rcs.turns[0].presentation={kind:'carousel',cards:Array.from({length:5},(_,index)=>({title:`Card ${index}`}))};
  for(const [raw,channels,code] of [[turns,['sms'],'invalid_turn_count'],[choices,['sms'],'invalid_options'],[cards,['rcs'],'invalid_cards']]){
    const pipeline=loadPipeline([raw]);
    await assert.rejects(pipeline.generateScenarioDraft(request({channels}),'strict-bounds'),error=>error.code==='draft_invalid'&&error.issues.some(item=>item.code===code));
    assert.equal(pipeline.calls.length,MAX_PROVIDER_ATTEMPTS);assert.equal(pipeline.draftCache.size,0);
  }
});
test('empty objects, missing channels and empty company text never succeed or enter cache',async()=>{
  const empty=draft();empty.scenarios.sms.turns[0].text='';
  for(const raw of [{},empty,{...draft(),scenarios:{email:draft(['email']).scenarios.email}}]) {
    const pipeline=loadPipeline([raw]);await assert.rejects(pipeline.generateScenarioDraft(request(),'invalid'),{code:'draft_invalid'});
    assert.equal(pipeline.calls.length,2);assert.equal(pipeline.draftCache.size,0);
  }
});
test('final validation checks exact counts and named facts separately for every channel',()=>{
  const raw=draft(CHANNELS),input=request({channels:CHANNELS,persona:{customerName:'Avery'}});
  raw.scenarios.sms.turns[0].text='Hello Avery.';
  assert.throws(()=>validateAndNormalizeDraft(raw,input,evidence),error=>error.code==='draft_invalid'&&error.issues.some(item=>item.channel==='email'&&item.code==='missing_required_fact'));
  for(const count of [3,5]) {
    const candidate=draft();candidate.scenarios.sms.turns=Array.from({length:count},(_,index)=>({speaker:index%2?'customer':'company',text:'Message'}));
    assert.throws(()=>validateAndNormalizeDraft(candidate,request({controls:{expectedMessageCount:4}}),evidence),error=>error.issues.some(item=>item.code==='count_mismatch'));
  }
});
test('invalid final output gets one targeted repair and never a third provider attempt',async()=>{
  const pipeline=loadPipeline([{},draft()]);const result=await pipeline.generateScenarioDraft(request(),'repair');
  assert.equal(result.requirements.complete,true);assert.equal(pipeline.calls.length,2);assert.match(pipeline.calls[1].body.contents[0].parts[0].text,/CORRECT_THESE_VALIDATION_ISSUES=/);
  const broken=loadPipeline([{envelope:{candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'{}'}]}}]}}]);
  await assert.rejects(broken.generateScenarioDraft(request(),'truncated'),{code:'gemini_incomplete'});assert.equal(broken.calls.length,MAX_PROVIDER_ATTEMPTS);
});
test('provider timeout fallback preserves a complete script and is identified and never cached',async()=>{
  const timeout=Object.assign(new Error('synthetic timeout'),{name:'AbortError'}),pipeline=loadPipeline([timeout]);
  const result=await pipeline.generateScenarioDraft(request({useCase:'Company says "Welcome." Customer says "Thank you."',channels:['sms','email']}),'fallback');
  assert.equal(result.source.mode,'prompt-fallback');assert.equal(result.source.fallbackReason,'gemini_timeout');assert.equal(result.source.stage,'provider');
  assert.equal(result.requirements.complete,true);assert.match(result.requirements.warnings.join(' '),/not a successful AI/);assert.equal(pipeline.calls.length,2);assert.equal(pipeline.draftCache.size,0);
});
test('auth, missing model and safety failures are not masked by fallback',async()=>{
  for(const [raw,code] of [[{httpStatus:403},'gemini_auth_failed'],[{httpStatus:404},'gemini_model_not_found'],[{envelope:{promptFeedback:{blockReason:'SAFETY'}}},'gemini_blocked']]) {
    const pipeline=loadPipeline([raw]);await assert.rejects(pipeline.generateScenarioDraft(request({useCase:'Company says "Hi." Customer says "Hello."'}),'failed'),{code});assert.equal(pipeline.calls.length,1);assert.equal(pipeline.draftCache.size,0);
  }
});
test('provider HTTP diagnostics are bounded, allowlisted and never log upstream free text',async()=>{
  const sensitive='synthetic-offline-key PRIVATE_PROMPT https://private.example/?key=secret';
  const body={error:{status:'INVALID_ARGUMENT',message:`Response schema has too many states. ${sensitive}`,details:[{fieldViolations:[
    {field:'generation_config.response_schema.properties[0].value.items.max_items',description:sensitive},
    {field:'contents.parts.text',description:sensitive},{field:sensitive,description:sensitive},
  ]}]}};
  const pipeline=loadPipeline([{httpStatus:400,errorBody:body}]);
  await assert.rejects(pipeline.generateScenarioDraft(request(),'provider-error'),error=>error.code==='gemini_bad_request'&&error.issues[0].code==='provider_schema_complexity');
  assert.equal(pipeline.calls.length,1);assert.equal(pipeline.draftCache.size,0);
  const entry=pipeline.logs.map(value=>JSON.parse(value)).find(value=>value.event==='gemini_request_failed');
  assert.deepEqual(clone(entry.diagnostic),{category:'schema_complexity',body:'parsed',fields:['generation_config.response_schema.properties[0].value.items.max_items'],status:'INVALID_ARGUMENT'});
  assert.doesNotMatch(pipeline.logs.join('\n'),/PRIVATE_PROMPT|synthetic-offline-key|private\.example|key=secret|contents\.parts/);
  for (const [errorBody,expected] of [['x'.repeat(16385),'oversized'],['not json','malformed'],[{error:{status:sensitive,message:sensitive}},'parsed']]) {
    const invalid=loadPipeline([{httpStatus:400,errorBody}]);await assert.rejects(invalid.generateScenarioDraft(request(),'bounded'),{code:'gemini_bad_request'});
    const diagnostic=invalid.logs.map(value=>JSON.parse(value)).find(value=>value.event==='gemini_request_failed').diagnostic;
    assert.equal(diagnostic.body,expected);assert.equal(diagnostic.category,'unknown');assert.equal(diagnostic.status,undefined);assert.equal(invalid.calls.length,1);
    assert.doesNotMatch(invalid.logs.join('\n'),/PRIVATE_PROMPT|synthetic-offline-key|private\.example/);
  }
});
test('supported image-only cards and explicitly open-ended input are not mistaken for empty output',()=>{
  const raw=draft(['rcs']);raw.scenarios.rcs.turns[0].text='';raw.scenarios.rcs.turns[0].presentation={kind:'card',cards:[{title:'Invitation',imageUrl:'https://example.com/hero.png'}]};
  assert.equal(validateAndNormalizeDraft(raw,request({channels:['rcs']}),evidence).draft.scenarios.rcs.turns[0].text,'');
  const free=draft();free.scenarios.sms.turns[1]={speaker:'customer',text:'',mode:'free',options:[]};
  assert.equal(validateAndNormalizeDraft(free,request({useCase:'The customer uses open-ended input.'}),evidence).draft.scenarios.sms.turns[1].mode,'free');
  assert.throws(()=>validateAndNormalizeDraft(free,request(),evidence),{code:'draft_invalid'});
});
test('unlisted URLs, unsupported rich media, competing HTML bodies and missing email subjects fail',()=>{
  const cases=[];
  const link=draft();link.logoUrl='https://unlisted.example/logo.png';cases.push([link,request(),'unlisted_url']);
  const smsCard=draft();smsCard.scenarios.sms.turns[0].presentation={kind:'card',cards:[{title:'Card'}]};cases.push([smsCard,request(),'unsupported_presentation']);
  const email=draft(['email']);email.scenarios.email.subject='';cases.push([email,request({channels:['email']}),'invalid_text']);
  const html=draft(['email']);html.scenarios.email.turns[0].presentation.bodyHtml='<b>Second body</b>';cases.push([html,request({channels:['email']}),'competing_body']);
  for(const [raw,input,code] of cases)assert.throws(()=>validateAndNormalizeDraft(raw,input,evidence),error=>error.issues.some(item=>item.code===code));
});
test('plain-text request does not force rich cards or invent email contact/CTA',()=>{
  const raw=draft(['email']);raw.emailAddress='invented@example.com';raw.heroImageUrl='https://example.com/hero.png';
  const result=validateAndNormalizeDraft(raw,request({channels:['email'],useCase:'Use plain text only.'}),evidence);
  assert.equal(result.draft.emailAddress,'');assert.equal(result.draft.heroImageUrl,'');assert.equal(result.draft.scenarios.email.turns[0].presentation.ctaUrl,'');assert.equal(result.requirements.warnings.length,1);
});
test('natural-language starter preserves named context without claiming verified facts',()=>{
  const input=request({companyName:'NCSA',useCase:'NCSA sends an invitation about a Baseball Recruiting event. A customer, Sean, asks about cost and group tickets. Sean wants to learn more about IMG Academy, and a sales rep named Jake joins.'});
  const result=promptFallback(input,evidence,storyBrief(input));assert.ok(result);
  const transcript=result.draft.scenarios.sms.turns.map(turn=>turn.text).join('\n');
  for(const value of ['Sean','Baseball Recruiting event','cost','group tickets','IMG Academy','Jake'])assert.ok(transcript.includes(value),value);
  assert.equal(promptFallback(request(),evidence,storyBrief(request())),null,'an unrelated generic fallback is not successful completion');
});
test('cache and idempotency fingerprint includes persona and explicit controls',async()=>{
  const pipeline=loadPipeline([draft()]),input=request();
  const first=await pipeline.generateScenarioDraft(input,'first'),second=await pipeline.generateScenarioDraft(input,'second');assert.equal(pipeline.calls.length,1);assert.equal(first.source.requestFingerprint,second.source.requestFingerprint);
  const normalized=pipeline.validateDraftRequest(request({channels:['sms','sms'],persona:{customerName:'Avery'},controls:{expectedMessageCount:4}}));
  assert.deepEqual(clone(normalized.channels),['sms']);assert.equal(normalized.persona.customerName,'Avery');assert.equal(normalized.controls.expectedMessageCount,4);
  const pending=loadPipeline([draft()]);const original=pending.startGenerationJob(input,'r','stable','client');
  assert.throws(()=>pending.startGenerationJob({...input,persona:{customerName:'Avery'}},'r2','stable','client'),{code:'idempotency_conflict'});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(original.job.status,'completed');
});
test('health and shared config distinguish key presence from observed provider success',async()=>{
  assert.equal(aiConfig({}).model,'gemini-3.5-flash');assert.equal(aiConfig({GEMINI_MODEL:'custom-model'}).model,'custom-model');
  assert.equal(providerHealth(aiConfig({})).status,'not-configured');
  const pipeline=loadPipeline([draft()],{GEMINI_MODEL:'custom-model'});assert.equal(pipeline.health().status,'unverified');assert.equal(pipeline.calls.length,0);
  await pipeline.generateScenarioDraft(request(),'health');assert.equal(pipeline.health().status,'previous-success');assert.equal(pipeline.health().model,'custom-model');assert.match(pipeline.calls[0].url,/custom-model:generateContent$/);
  assert.equal(draftResponseSchema(['sms']).properties.schemaVersion.type,'INTEGER');assert.equal(draftResponseSchema(['sms']).properties.schemaVersion.enum,undefined);
});

test('failed jobs expose actionable validation issues and release their admission slot',async()=>{
  const pipeline=loadPipeline([{}]);
  const {job}=pipeline.startGenerationJob(request(),'failed-job','failed-key','synthetic-client');
  for(let attempt=0;attempt<20&&['queued','running'].includes(job.status);attempt++)await new Promise(resolve=>setTimeout(resolve,2));
  assert.equal(job.status,'failed');assert.equal(pipeline.active(),0);assert.equal(pipeline.calls.length,2);
  const publicResult=JSON.parse(JSON.stringify(pipeline.publicJob(job)));
  assert.equal(publicResult.error,'draft_invalid');assert.ok(publicResult.issues.some(item=>item.code==='invalid_schema'));assert.equal(publicResult.draft,undefined);
  const replay=pipeline.startGenerationJob(request(),'retry','failed-key','synthetic-client');assert.equal(replay.reused,true);assert.equal(replay.job,job);assert.equal(pipeline.calls.length,2);
});
