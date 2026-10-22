import { editor, revealEditor, selectView } from './workspace-helpers.mjs';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {browserOptions} from './browser-options.mjs';
import contract from '../server/draft-contract.cjs';
import ewc from './fixtures/ewc.cjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=await mkdtemp(path.join(tmpdir(),'two-way-ai-test-'));
const key='two-way-experience-studio-v2-scenarios';
const channels=['sms','rcs','whatsapp','email'];
const literal='José O’Neil — $& $` $\' </script> exact dialogue';
const persona={customerName:'José O’Neil',representativeName:'Zoë',representativeRole:'Advisor'};
const tinyImage=await readFile(path.join(root,'assets/gmail/refresh.png'));
const server=createServer(async(request,response)=>{
  const pathname=new URL(request.url,'http://localhost').pathname;
  if(pathname==='/seed'){response.setHeader('Content-Type','text/html');response.end('<!doctype html><title>Synthetic AI fixtures</title>');return;}
  const target=path.resolve(root,`.${pathname==='/'?'/interactive-simulator-builder.html':pathname}`);
  if(!target.startsWith(`${root}${path.sep}`)){response.writeHead(403).end();return;}
  try{const data=await readFile(target);response.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[path.extname(target)]||'application/octet-stream');response.end(data);}catch{response.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
let browser,latestPage;
const card=(title,suffix)=>({title,description:`${title} description`,imageUrl:`https://assets.ai.test/${suffix}.png`,ctaLabel:'',ctaUrl:''});
const laterEmailPresentation={kind:'email',mode:'branded',preheader:'Later email preheader',heroImageUrl:'https://assets.ai.test/later-email-hero.png',ctaLabel:'Later campaign details',ctaUrl:'https://example.test/later-campaign'};
const emailDefaults={openingMode:'plain',laterMode:'branded',laterAssets:true};
function responseFor(request,{fallback=false,unknown=false}={}){
  const scenarios=Object.fromEntries(request.channels.map(channel=>{
    const opening={speaker:'company',text:`${literal} ${channel}`,presentation:channel==='email'?{kind:'email',mode:'plain'}:{kind:'text'}};
    if(channel==='rcs'){opening.text='';opening.presentation={kind:'card',cards:[card('Image-led offer','opening')]};}
    if(channel==='whatsapp')opening.presentation={kind:'carousel',cards:[card('WhatsApp one','wa-one'),card('WhatsApp two','wa-two')]};
    const ending={speaker:'company',text:`End ${channel}: Zoë is joining now.`,presentation:channel==='email'?{...laterEmailPresentation}:{kind:'text'}};
    if(channel==='rcs')ending.presentation={kind:'carousel',cards:[card('Later first','future-one'),card('Later second','future-two')]};
    return [channel,{title:`Synthetic ${channel}`,sender:'Synthetic Co',subject:channel==='email'?'Exact email subject':undefined,turns:[opening,{speaker:'customer',text:'Yes, please',mode:'choices',options:['Yes, please','No, thanks']},ending]}];
  }));
  const identity=unknown?{customerName:'',representativeName:'',representativeRole:''}:persona;
  return {status:'completed',draft:{schemaVersion:2,companyName:'Synthetic Co',initialSender:'company',persona:identity,emailAddress:'hello@example.test',website:'https://example.test',logoUrl:'',heroImageUrl:'',scenarios},source:{mode:fallback?'prompt-fallback':'provider',fallbackReason:fallback?'gemini_rate_limited':null,stage:fallback?'provider':null,coverage:'partial',requestedChannels:[...request.channels],url:'https://example.test',title:'Synthetic research',imageCandidates:[],brief:{persona:identity,initialSender:'company',expectedMessageCount:3,scriptedTurns:[]}},requirements:{complete:true,channels:Object.fromEntries(request.channels.map(channel=>[channel,{status:'passed',checks:[{id:'structure',label:'Message structure',status:'passed'},{id:'factual_accuracy',label:'Factual accuracy',status:'unverified'}]}])),warnings:[]}};
}
function brandingFor(request,{empty=false}={}){
  return {schemaVersion:1,mode:'website-only',companyName:request.companyName.trim(),requestedWebsite:new URL(request.website).href,requestedChannels:[...request.channels],source:{url:new URL(request.website).href,title:'Synthetic website branding',partial:false,assets:'unverified'},imageCandidates:empty?[]:[{url:'https://assets.ai.test/recovery-logo.png',role:'logo'},{url:'https://assets.ai.test/recovery-hero.png',role:'hero'}]};
}
async function mockBrandingAssets(context,{failHero=false,gate}={}){
  await context.route(`${base}/api/asset?*`,async route=>{
    const query=new URL(route.request().url()).searchParams;
    if(!query.has('raw')&&gate)await gate;
    if(failHero&&query.get('url')?.includes('recovery-hero')){await route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({error:'remote_http_error'})});return;}
    await route.fulfill(query.has('raw')?{contentType:'image/png',body:tinyImage}:{contentType:'application/json',body:JSON.stringify({dataUrl:`data:image/png;base64,${tinyImage.toString('base64')}`})});
  });
}
async function fresh(makeResponse){
  const context=await browser.newContext({acceptDownloads:true,viewport:{width:1600,height:1100}}),requests=[];
  await context.route('https://**/*',route=>new URL(route.request().url()).hostname==='assets.ai.test'?route.fulfill({contentType:'image/png',body:tinyImage,headers:{'Access-Control-Allow-Origin':'*'}}):route.abort());
  await context.route(`${base}/api/scenario-jobs`,async route=>{const request=route.request().postDataJSON();requests.push(request);await route.fulfill({contentType:'application/json',body:JSON.stringify({id:`job-${requests.length}`,poll:`/api/scenario-jobs/job-${requests.length}`})});});
  let polls=0;
  await context.route(`${base}/api/scenario-jobs/*`,async route=>{polls++;const payload=polls%2===1?{status:'running'}:await makeResponse(requests.at(-1));await route.fulfill({contentType:'application/json',body:JSON.stringify(payload)});});
  const page=await context.newPage(),errors=[];latestPage=page;page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${base}/seed`);
  await page.evaluate(key=>localStorage.setItem(key,JSON.stringify({version:2,savedAt:1,activeId:'ai-target',scenarios:[{id:'ai-target',name:'Original destination',channel:'sms',brandName:'Original Co',smsAddress:'Original Co',steps:[{id:'original-company',author:'brand',kind:'text',text:'ORIGINAL_CONTENT',reusableSet:true},{id:'original-customer',author:'customer',kind:'free',text:'',reusableSet:false}]}]})),key);
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.evaluate(()=>window.__twoWayScenarioInitialization);
  if(await page.locator('#chooseManual').isVisible())await (await editor(page, '#chooseManual')).click();
  // The seed starts in the legacy browser backup. Establish an acknowledged
  // durable baseline through the real save control before testing AI mutations.
  await (await editor(page, '#save')).click();const baseline=await saved(page);
  await selectView(page, 'ai');await page.locator('.v2-generation-controls').waitFor();
  return {context,page,requests,errors,baseline};
}
async function requestDraft(page,selected,{named=true,prompt='Build three messages for each selected channel.',initialSender='company',companyName='Synthetic Co',website='https://example.test',messageTotal='3'}={}){
  await (await editor(page, '#aiCompanyName')).fill(companyName);await (await editor(page, '#aiWebsite')).fill(website);await (await editor(page, '#aiUseCase')).fill(prompt);
  for(const channel of channels)await (await editor(page, `[data-ai-channel="${channel}"]`)).setChecked(selected.includes(channel));
  await (await editor(page, '.v2-generation-controls summary')).click();await (await editor(page, '[data-v2-opening-sender]')).selectOption(initialSender);await (await editor(page, '[data-v2-message-total]')).fill(messageTotal);
  if(named){await (await editor(page, '[data-v2-customer-name]')).fill(persona.customerName);await (await editor(page, '[data-v2-representative-name]')).fill(persona.representativeName);await (await editor(page, '[data-v2-representative-role]')).fill(persona.representativeRole);}
  await (await editor(page, '#generateAiDraft')).click();
}
async function saved(page){await page.waitForFunction(()=>document.querySelector('#saveState')?.textContent==='Saved on this device');return page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);}
async function recovered(page){
  // Image embedding happens before the new scenario is saved. The previous
  // scenario's already-saved status is not an acknowledgement of this creation.
  await page.waitForFunction(key=>{const record=JSON.parse(localStorage.getItem(key));return record?.activeId!=='ai-target'&&record?.scenarios.some(scenario=>scenario.id===record.activeId&&scenario.brandingRecovery)},key);
  return saved(page);
}
async function playback(page,channel,emailExpected=emailDefaults){
  await (await editor(page, '[data-v2-preview-reset]')).click();
  const thread=channel==='email'?'[data-email="0"]':channel==='whatsapp'?'[data-wa-thread="wa-main"]':'[data-thread="sms-main"]';
  await page.locator(thread).click();
  if(channel==='whatsapp')assert.equal(await page.locator('#stage .wa-card a').count(),0,'Cards without CTA labels must not invent actions');
  if(channel==='email'){
    const opening=page.locator('#stage .mailbody');
    assert.equal(await opening.locator('.scenario-email').count(),emailExpected.openingMode==='branded'?1:0);
    if(emailExpected.openingMode==='branded'){
      assert.equal(await opening.locator('.scenario-email-preheader').textContent(),'Opening email preheader');
      assert.equal(await opening.locator('.scenario-email-cta').getAttribute('href'),'https://example.test/opening-campaign');
    }
  }
  const choices=page.locator(channel==='email'?'.email-reply-choices .chip':channel==='rcs'?'[data-rcs-reply]':'#transcript .chip');
  await choices.first().waitFor();assert.deepEqual(await choices.allTextContents(),['Yes, please','No, thanks']);
  await choices.first().click();await page.waitForFunction(channel=>document.querySelector('#stage')?.textContent.includes(`End ${channel}: Zoë is joining now.`),channel);
  assert.match(await page.locator('#stage').innerText(),/Yes, please/);
  assert.equal(await page.locator('#stage .ai-fallback-note, #stage .v2-requirements').count(),0);
  if(channel==='email'){
    const later=page.locator('#stage .email-thread-response').filter({hasText:'End email: Zoë is joining now.'});
    assert.equal(await later.locator('.scenario-email').count(),emailExpected.laterMode==='branded'?1:0);
    if(emailExpected.laterMode==='branded'&&emailExpected.laterAssets){
      assert.equal(await later.locator('.scenario-email-preheader').textContent(),laterEmailPresentation.preheader);
      assert.equal(await later.locator('.scenario-email-cta').textContent(),laterEmailPresentation.ctaLabel);
      assert.equal(await later.locator('.scenario-email-cta').getAttribute('href'),laterEmailPresentation.ctaUrl);
      assert.match(await later.locator('.scenario-email-hero').getAttribute('style'),page.url().startsWith('file:')?/data:image\//:/later-email-hero\.png/);
    }else{
      assert.equal(await later.locator('.scenario-email-hero, .scenario-email-cta').count(),0);
      assert.doesNotMatch(await later.innerText(),/Opening email preheader|Opening campaign details/);
    }
  }
}
async function offlineExport(context,page,channel,emailExpected=emailDefaults){
  const artifact=await Promise.all([page.waitForEvent('download'),(await editor(page, '#export')).click()]).then(([download])=>download),file=path.join(directory,`${channel}.html`);await artifact.saveAs(file);
  const exported=await context.newPage(),errors=[],requests=[];exported.setDefaultTimeout(15000);exported.on('pageerror',error=>errors.push(error.message));exported.on('request',request=>{if(/^(https?:|file:)/.test(request.url())&&request.url()!==`file://${file}`)requests.push(request.url());});
  await context.setOffline(true);await exported.goto(`file://${file}`,{waitUntil:'load'});await exported.waitForFunction(()=>!document.body.classList.contains('export-booting'));
  const data=JSON.parse(await exported.locator('#scenario-data').textContent()).scenarios[0];
  assert.deepEqual(data.steps[1].options,['Yes, please','No, thanks']);assert.equal(data.steps[2].text,`End ${channel}: Zoë is joining now.`);
  if(channel==='email'){
    assert.equal(data.steps[0].text,`${literal} email`);assert.equal(data.emailMode,emailExpected.openingMode);assert.equal(data.steps[2].emailMode,emailExpected.laterMode);
    if(emailExpected.openingMode==='plain')assert.equal(data.emailCtaLabel,'');
    if(emailExpected.laterAssets){assert.match(data.steps[2].emailHeroImage,/^data:image\//);assert.equal(data.steps[2].emailCtaUrl,laterEmailPresentation.ctaUrl);}
    else{assert.equal(data.steps[2].emailHeroImage,'');assert.equal(data.steps[2].emailCtaUrl,'');}
  }
  if(channel==='rcs'){assert.equal(data.steps[0].kind,'rich');assert.match(data.steps[0].cardImage,/^data:image\//);assert.ok(data.steps[2].cards.every(card=>card.image.startsWith('data:image/')));}
  if(channel==='whatsapp')assert.equal(data.steps[0].cards.length,2);
  await playback(exported,channel,emailExpected);await exported.waitForFunction(()=>[...document.querySelectorAll('#stage img')].every(image=>image.complete&&image.naturalWidth>0));
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);await exported.close();await context.setOffline(false);
}
async function ewcPlayback(page,channel){
  const turns=ewc.rawDraft.scenarios[channel].turns;
  await (await editor(page, '[data-v2-preview-reset]')).click();
  await page.locator(channel==='email'?'[data-email="0"]':channel==='whatsapp'?'[data-wa-thread="wa-main"]':'[data-thread="sms-main"]').click();
  for(const index of [1,3]){
    if(channel==='email')await (await editor(page, '#openEmailReply')).click();
    const input=page.locator(channel==='email'?'#emailInput':'#phoneInput');
    await input.fill(turns[index].text);await page.locator(channel==='email'?'#emailSend':'#phoneSend').click();
    await page.waitForFunction(text=>document.querySelector('#stage')?.textContent.includes(text),turns[index+1].text);
  }
  await page.waitForFunction(text=>document.querySelector('#stage')?.textContent.includes(text),turns.at(-1).text);
  const visible=await page.locator('#stage').innerText();for(const turn of turns)assert.ok(visible.includes(turn.text),`${channel} must retain every authored turn`);
}
try{
  browser=await chromium.launch(browserOptions);
  {
    const {context,page,errors}=await fresh(request=>responseFor(request));
    const sender=page.getByLabel('Who sends the first message?',{exact:true});
    assert.equal(await sender.count(),1);
    assert.equal(await sender.isVisible(),true);
    assert.equal(await page.locator('.v2-generation-controls').getAttribute('open'),null);
    assert.equal(await sender.evaluate(element=>Boolean(element.compareDocumentPosition(document.querySelector('#aiUseCase')) & Node.DOCUMENT_POSITION_FOLLOWING)),true);
    for(const value of ['company','customer','']) {
      await sender.selectOption(value);
      assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('two-way-experience-studio-v2-generation-controls')).sender),value);
    }
    await sender.selectOption('company');
    await page.reload({waitUntil:'domcontentloaded'});await page.evaluate(()=>window.__twoWayScenarioInitialization);
    if(await page.locator('#chooseManual').isVisible())await (await editor(page, '#chooseManual')).click();
    await selectView(page, 'ai');
    await sender.waitFor();assert.equal(await sender.inputValue(),'company');assert.equal(await sender.count(),1);
    assert.deepEqual(errors,[]);await context.close();console.log('PASS first sender is labelled, visible above the brief, and retained after reload');
  }
  {
    const {context,page,requests,errors}=await fresh(request=>{
      assert.deepEqual(request,ewc.request);const brief=contract.storyBrief(request);
      assert.equal(brief.initialSender,'company');const validated=contract.validateAndNormalizeDraft(ewc.rawDraft,request,{url:request.website,candidates:[]},brief);
      return {status:'completed',...validated,source:{mode:'provider',fallbackReason:null,requestedChannels:request.channels,url:request.website,title:'Synthetic EWC fixture',imageCandidates:[],brief}};
    });
    await requestDraft(page,channels,{named:false,prompt:ewc.useCase,initialSender:'',messageTotal:'',companyName:'EWC',website:ewc.request.website});
    await page.locator('.ai-review').waitFor();assert.equal(requests.length,1);await (await editor(page, '#applyAiDraft')).click();
    const record=await saved(page),scenario=record.scenarios.find(item=>item.id==='ai-target');
    for(const channel of channels){
      assert.deepEqual(scenario.variants[channel].steps.map(step=>step.text),ewc.rawDraft.scenarios[channel].turns.map(turn=>turn.text));
      if(channel!=='sms'){await (await editor(page, `[data-channel="${channel}"]`)).click();await saved(page);}
      await ewcPlayback(page,channel);
      const download=await Promise.all([page.waitForEvent('download'),(await editor(page, '#export')).click()]).then(([item])=>item),file=path.join(directory,`ewc-${channel}.html`);await download.saveAs(file);
      const exported=await context.newPage(),offlineRequests=[],exportErrors=[];exported.on('pageerror',error=>exportErrors.push(error.message));exported.on('request',request=>{if(/^(https?:|file:)/.test(request.url())&&request.url()!==`file://${file}`)offlineRequests.push(request.url())});
      await context.setOffline(true);await exported.goto(`file://${file}`,{waitUntil:'load'});await exported.waitForFunction(()=>!document.body.classList.contains('export-booting'));
      await ewcPlayback(exported,channel);assert.deepEqual(offlineRequests,[]);assert.deepEqual(exportErrors,[]);await exported.close();await context.setOffline(false);
    }
    assert.deepEqual(errors,[]);await context.close();console.log('PASS backend-validated EWC narrative: inferred company start, both customer replies, human handoff, all four previews and offline exports');
  }
  {
    const {context,page,requests,errors}=await fresh(request=>responseFor(request));
    const prompt='Deliberate prompt: José O’Neil meets Zoë. Preserve punctuation, commas, and channel-specific presentations.';
    await requestDraft(page,channels,{prompt});
    await (await editor(page, '[data-ai-channel="whatsapp"]')).uncheck(); // Editing the form cannot mutate the in-flight request/result channel set.
    await page.locator('.ai-review').waitFor();assert.equal(requests.length,1);assert.deepEqual(requests[0].channels,channels);assert.equal(requests[0].useCase,prompt);assert.deepEqual(requests[0].persona,persona);assert.deepEqual(requests[0].controls,{initialSender:'company',expectedMessageCount:3});
    assert.match(await page.locator('.v2-requirements').innerText(),/Factual accuracy: Not verified/);assert.doesNotMatch(await page.locator('.ai-review').innerText(),/Prompt contract verified/);
    await page.evaluate(()=>document.dispatchEvent(new CustomEvent('twoway:ai-draft',{detail:{requestId:'stale',requirements:{channels:{sms:{checks:[{label:'STALE_EVENT',status:'passed'}]}}}}})));
    assert.doesNotMatch(await page.locator('.v2-requirements').innerText(),/STALE_EVENT/);
    await (await editor(page, '#applyAiDraft')).click();const record=await saved(page),scenario=record.scenarios.find(item=>item.id==='ai-target');assert.deepEqual(Object.keys(scenario.variants),channels);assert.equal(scenario.name,'Original destination');
    assert.deepEqual(scenario.variants.sms.steps[1].options,['Yes, please','No, thanks']);assert.equal(scenario.variants.rcs.steps[0].text,'');assert.equal(scenario.variants.email.steps[0].emailMode,'plain');assert.equal(scenario.variants.email.steps[2].emailMode,'branded');
    for(const channel of channels){if(channel!=='sms'){await (await editor(page, `[data-channel="${channel}"]`)).click();await saved(page);}await playback(page,channel);await offlineExport(context,page,channel);console.log(`PASS AI ${channel}: applied content, comma choices, offline download and playback`);}
    assert.deepEqual(errors,[]);await context.close();
  }
  for(const laterMode of ['branded','plain']){
    const expected={openingMode:'branded',laterMode,laterAssets:laterMode==='plain'};
    const {context,page,errors}=await fresh(request=>{
      const response=responseFor(request),turns=response.draft.scenarios.email.turns;
      turns[0].presentation={kind:'email',mode:'branded',preheader:'Opening email preheader',heroImageUrl:'https://assets.ai.test/opening-email-hero.png',ctaLabel:'Opening campaign details',ctaUrl:'https://example.test/opening-campaign'};
      turns[2].presentation=laterMode==='plain'?{...laterEmailPresentation,mode:'plain'}:{kind:'email',mode:'branded',preheader:'',heroImageUrl:'',ctaLabel:'',ctaUrl:''};
      return response;
    });
    await requestDraft(page,['email']);await page.locator('.ai-review').waitFor();await (await editor(page, '#applyAiDraft')).click();await saved(page);
    await playback(page,'email',expected);await offlineExport(context,page,'email',expected);
    assert.deepEqual(errors,[]);await context.close();console.log(`PASS AI email: branded opening, ${laterMode} later message, explicit assets/clears, offline parity`);
  }
  {
    const {context,page,errors}=await fresh(request=>{const response=responseFor(request);delete response.draft.scenarios.rcs;return response;});
    const before=(await saved(page)).scenarios.find(item=>item.id==='ai-target');await requestDraft(page,['sms','rcs']);await page.locator('.ai-error').waitFor();assert.equal(await page.locator('#applyAiDraft').count(),0);assert.deepEqual((await saved(page)).scenarios.find(item=>item.id==='ai-target'),before);assert.deepEqual(errors,[]);await context.close();console.log('PASS invalid provider draft: original scenario unchanged');
  }
  {
    const {context,page,requests,errors}=await fresh(request=>responseFor(request,{fallback:true,unknown:true}));
    const prompt='Show an invitation and response. Do not invent a customer name.';await requestDraft(page,['sms'],{named:false,prompt});await page.locator('.ai-review').waitFor();
    assert.match(await page.locator('.ai-fallback-note').innerText(),/rate limit/);assert.doesNotMatch(await page.locator('.ai-fallback-note').innerText(),/slow|named people/);assert.match(await page.locator('.v2-requirements').innerText(),/Customer: Not specified/);
    await (await editor(page, '#regenerateAiDraft')).click();assert.equal(await page.locator('#aiUseCase').inputValue(),prompt);assert.equal(requests.length,1);assert.equal(await page.locator('.v2-requirements').count(),0);
    assert.deepEqual(errors,[]);await context.close();console.log('PASS fallback provenance, unknown identity, regenerate preserves prompt');
  }
  {
    const {context,page,errors,baseline}=await fresh(request=>({status:'failed',error:'draft_invalid',issues:[{message:'The requested opening sender was not preserved.'}],branding:brandingFor(request)}));
    await mockBrandingAssets(context);const before=(await saved(page)).scenarios.find(item=>item.id==='ai-target');
    await requestDraft(page,channels);await page.locator('#useAiBranding').waitFor();
    assert.match(await page.locator('.ai-error').innerText(),/opening sender/);assert.equal(await page.locator('#applyAiDraft').count(),0);
    await mkdir('test-results',{recursive:true});await page.locator('.ai-brand-recovery').screenshot({path:'test-results/branding-recovery.png'});
    await (await editor(page, '#recovery-initialSender')).selectOption('customer');await (await editor(page, '#useAiBranding')).click();
    const record=await recovered(page),scenario=record.scenarios.find(item=>item.id===record.activeId);
    assert.notEqual(scenario.id,'ai-target');assert.equal(record.scenarios.length,baseline.scenarios.length+1);assert.deepEqual(record.scenarios.filter(item=>item.id!==scenario.id),baseline.scenarios);assert.deepEqual(record.scenarios.find(item=>item.id==='ai-target'),before);assert.deepEqual(Object.keys(scenario.variants),channels);
    for(const variant of Object.values(scenario.variants)){assert.equal(variant.generatedByAi,false);assert.ok(variant.steps.every(step=>step.text===''));assert.equal(variant.steps[0].author,'customer');assert.match(variant.avatar,/^data:image\/png/);assert.match(variant.brandingRecovery.failureReason,/opening sender/);}
    assert.match(scenario.variants.rcs.steps[1].cardImage,/^data:image/);assert.match(scenario.variants.whatsapp.steps[1].cardImage,/^data:image/);assert.match(scenario.variants.email.steps[1].emailHeroImage,/^data:image/);
    await revealEditor(page, '.studio-recovery-slot .ai-brand-recovery');
    await page.locator('.studio-recovery-slot .ai-brand-recovery').waitFor({state:'visible'});
    assert.match(await page.locator('.studio-recovery-slot .ai-brand-recovery').innerText(),/No dialogue was generated/);
    await page.reload();await page.evaluate(()=>window.__twoWayScenarioInitialization);if(await page.locator('#chooseManual').isVisible())await (await editor(page, '#chooseManual')).click();
    const acceptDialog=dialog=>dialog.accept();page.on('dialog',acceptDialog);
    for(const channel of channels){
      await (await editor(page, `[data-channel="${channel}"]`)).click();
      const download=await Promise.all([page.waitForEvent('download'),(await editor(page, '#export')).click()]).then(([item])=>item),file=path.join(directory,`branding-${channel}.html`);await download.saveAs(file);
      const exported=await context.newPage(),offlineRequests=[];exported.on('request',request=>{if(/^https?:/.test(request.url()))offlineRequests.push(request.url())});
      await context.setOffline(true);await exported.goto(`file://${file}`,{waitUntil:'load'});await exported.waitForFunction(()=>!document.body.classList.contains('export-booting'));
      const data=JSON.parse(await exported.locator('#scenario-data').textContent()).scenarios[0];assert.equal(data.channel,channel);assert.match(data.avatar,/^data:image/);assert.equal(data.steps[0].author,'customer');assert.ok(data.steps.every(step=>step.text===''));assert.deepEqual(offlineRequests,[]);
      assert.equal(await exported.locator('.ai-brand-recovery:visible').count(),0,'Recovery notices are builder-only, not part of the simulated conversation');
      await exported.close();await context.setOffline(false);
    }
    page.off('dialog',acceptDialog);assert.deepEqual(errors,[]);await context.close();console.log('PASS branding-only recovery: separate scenario, both speaker modes, four independent channels, reload and offline exports');
  }
  {
    const {context,page,errors}=await fresh(request=>({status:'failed',error:'gemini_timeout',branding:brandingFor(request)}));await mockBrandingAssets(context,{failHero:true});
    await requestDraft(page,['email']);await page.locator('#useAiBranding').waitFor();await (await editor(page, '#useAiBranding')).click();
    const record=await recovered(page),scenario=record.scenarios.find(item=>item.id===record.activeId);assert.match(scenario.avatar,/^data:image/);assert.equal(scenario.emailHeroImage,'');assert.equal(scenario.steps[0].author,'brand');
    assert.match(scenario.brandingRecovery.assetWarnings.join(' '),/Header \/ card image.*omitted/);
    await (await editor(page, '.ai-brand-recovery summary')).click();
    const visibleStatus=await page.locator('.ai-brand-recovery').innerText();assert.match(visibleStatus,/did not finish a complete scenario before the deadline/);assert.match(visibleStatus,/gemini_timeout/);assert.match(visibleStatus,/Header \/ card image.*omitted/);
    assert.deepEqual(errors,[]);await context.close();console.log('PASS branding-only asset failure: useful logo retained, failed hero omitted with specific warning');
  }
  {
    const {context,page,requests,errors,baseline}=await fresh(request=>requests.length===1?{status:'failed',error:'draft_invalid',branding:brandingFor(request)}:{status:'failed',error:'website_fetch_failed'});await mockBrandingAssets(context);
    await requestDraft(page,['rcs']);await page.locator('#useAiBranding').waitFor();await (await editor(page, '#aiWebsite')).fill('https://other.test');assert.equal(await page.locator('#useAiBranding').count(),0);
    await (await editor(page, '#generateAiDraft')).click();await page.locator('.ai-error').waitFor();await page.waitForFunction(()=>!document.querySelector('#generateAiDraft').disabled);
    assert.equal(await page.locator('#useAiBranding').count(),0);assert.match(await page.locator('#setupAssistant').innerText(),/No website branding is available/);assert.deepEqual((await saved(page)).scenarios,baseline.scenarios);
    assert.deepEqual(errors,[]);await context.close();console.log('PASS failed retry cannot retain another website’s branding');
  }
  {
    const {context,page,errors,baseline}=await fresh(request=>({status:'failed',error:'gemini_timeout',branding:brandingFor(request)}));let release;const gate=new Promise(resolve=>release=resolve);await mockBrandingAssets(context,{gate});
    await requestDraft(page,['sms']);await page.locator('#useAiBranding').waitFor();await (await editor(page, '#useAiBranding')).click();await (await editor(page, '#aiWebsite')).fill('https://changed.test');release();
    await page.waitForFunction(()=>document.querySelector('#appStatus')?.textContent.includes('branding selection, or destination changed'));assert.deepEqual((await saved(page)).scenarios,baseline.scenarios);assert.deepEqual(errors,[]);await context.close();console.log('PASS late branding asset completion cannot apply after its request changes');
  }
  {
    let releaseFailure;const gate=new Promise(resolve=>releaseFailure=resolve);
    const {context,page,errors,baseline}=await fresh(async request=>{await gate;return {status:'failed',error:'draft_invalid',branding:brandingFor(request)}});
    await requestDraft(page,['sms']);await (await editor(page, '#aiCompanyName')).fill('Changed company');await (await editor(page, '#aiWebsite')).fill('https://changed.test');await (await editor(page, '[data-ai-channel="sms"]')).uncheck();await (await editor(page, '[data-ai-channel="email"]')).check();releaseFailure();
    await page.locator('.ai-error').waitFor();assert.equal(await page.locator('#useAiBranding').count(),0);assert.deepEqual((await saved(page)).scenarios,baseline.scenarios);
    assert.deepEqual(errors,[]);await context.close();console.log('PASS edits made during generation reject old website branding when failure arrives');
  }
  {
    const {context,page,errors}=await fresh(request=>({status:'failed',error:'gemini_incomplete',branding:brandingFor(request,{empty:true})}));
    await requestDraft(page,['email']);await page.locator('#useAiBranding').waitFor();assert.match(await page.locator('.ai-brand-recovery').innerText(),/No image candidates were found/);
    await (await editor(page, '#useAiBranding')).click();const record=await recovered(page),scenario=record.scenarios.find(item=>item.id===record.activeId);assert.equal(scenario.avatar,'');assert.equal(scenario.emailHeroImage,'');assert.ok(scenario.steps.every(step=>step.text===''));
    assert.deepEqual(errors,[]);await context.close();console.log('PASS branding without discovered images is labeled honestly and creates only blank manual fields');
  }
  {
    const prompt="Express Wash Concepts sends out message reminding a current customer that their membership is set to renew in 14 days. Customer responds with a question about what all the membership includes. EWC provides insight into the membership benefits, as well as notices that the customer hasn't signed up for the loyalty program that would also provide some additional benefits to their EWC membership. Customer still debates not renewing, to which EWC brings in a human rep on the same thread to explore options. Human agent offers the person a bonus of extra loyalty points for renewing, which they can use on the loyalty marketplace for additional discounts, events, and gift cards at partner organizations.";
    const originalIssues=channels.map(channel=>({channel,code:'sender_mismatch',expectedSender:'company',message:'The company must open the conversation.'}));
    originalIssues.push({code:'missing_requirement',requirementId:'loyalty',message:'Missing loyalty invitation <img src=x onerror="alert(1)">'});
    const {context,page,errors,baseline}=await fresh(request=>({status:'failed',error:'draft_invalid',issues:originalIssues,branding:brandingFor(request)}));
    await mockBrandingAssets(context);await requestDraft(page,channels,{prompt,initialSender:''});await page.locator('.ai-failure-guidance').waitFor();
    assert.equal(await page.locator('.ai-failure-guidance li').count(),2,'Four equivalent sender errors have one next step');
    assert.equal(await page.locator('.ai-error').count(),1);assert.doesNotMatch(await page.locator('.ai-error').innerText(),/must open.*must open/);
    assert.match(await page.locator('.ai-failure-guidance').innerText(),/choose Company opens/);
    assert.equal(await page.locator('.ai-failure-guidance img').count(),0,'Untrusted technical errors must remain text');
    const details=JSON.parse(await page.locator('.ai-failure-guidance pre').textContent());assert.deepEqual(details.issues,originalIssues);assert.ok(details.requestId);
    await (await editor(page, '[data-ai-guidance-target="opening-sender"]')).click();
    assert.equal(await page.locator('[data-v2-opening-sender]').isVisible(),true);assert.equal(await page.locator('[data-v2-opening-sender]').inputValue(),'');
    assert.equal(await page.evaluate(()=>document.activeElement?.hasAttribute('data-v2-opening-sender')),true);
    assert.equal(await page.locator('#aiUseCase').inputValue(),prompt);assert.deepEqual((await saved(page)).scenarios,baseline.scenarios);
    await (await editor(page, '.ai-failure-guidance details summary')).click();
    await mkdir('test-results',{recursive:true});await page.locator('#setupAssistant').screenshot({path:'test-results/generation-guidance.png'});
    await (await editor(page, '#generateAiDraft')).click();await page.waitForFunction(()=>!document.querySelector('.ai-failure-guidance'));await page.locator('.ai-failure-guidance').waitFor();
    assert.equal(await page.locator('.ai-failure-guidance').count(),1);assert.equal(await page.locator('#useAiBranding').count(),1);assert.deepEqual(errors,[]);await context.close();
    console.log('PASS EWC error recovery: deduplicated advice, controls focus without changes, escaped details, request ID, branding and retry');
  }
  for(const [issue,target,selector] of [[{code:'sender_mismatch',expectedSender:'company'},'opening-sender','[data-v2-opening-sender]'],[{code:'count_mismatch',expectedMessageCount:3},'message-total','[data-v2-message-total]'],[{code:'missing_required_fact',field:'representativeName'},'representative-name','[data-v2-representative-name]']]){
    const {context,page,errors}=await fresh(()=>({status:'failed',error:'draft_invalid',issues:[issue]}));await requestDraft(page,['email']);await page.locator('.ai-failure-guidance').waitFor();
    assert.match(await page.locator('.ai-failure-guidance').innerText(),/For this attempt/);const before=await page.locator(selector).inputValue();
    await (await editor(page, `[data-ai-guidance-target="${target}"]`)).click();assert.equal(await page.locator(selector).inputValue(),before);assert.equal(await page.evaluate(selector=>document.activeElement?.matches(selector),selector),true);
    assert.deepEqual(errors,[]);await context.close();
  }
  {
    let finish;const gate=new Promise(resolve=>{finish=resolve});
    const {context,page,errors}=await fresh(async()=>{await gate;return {status:'failed',error:'draft_invalid',issues:[{code:'sender_mismatch',expectedSender:'company'},{code:'count_mismatch',expectedMessageCount:3}]}});
    await requestDraft(page,['sms']);await (await editor(page, '.v2-generation-controls summary')).click();
    await (await editor(page, '[data-v2-opening-sender]')).selectOption('customer');await (await editor(page, '[data-v2-message-total]')).fill('6');finish();
    await page.locator('.ai-failure-guidance').waitFor();const advice=await page.locator('.ai-failure-guidance').innerText();assert.match(advice,/For this attempt.*was set to Company opens/);assert.match(advice,/For this attempt.*was set to 3/);
    await (await editor(page, '[data-ai-guidance-target="opening-sender"]')).click();assert.equal(await page.locator('[data-v2-opening-sender]').inputValue(),'customer');assert.equal(await page.locator('[data-v2-message-total]').inputValue(),'6');
    assert.deepEqual(errors,[]);await context.close();console.log('PASS failure advice distinguishes failed-request controls from newer unsent edits');
  }
  {
    const {context,page,errors,baseline}=await fresh(request=>({status:'running',branding:brandingFor(request)}));await mockBrandingAssets(context);
    await requestDraft(page,['sms']);await page.locator('#useAiBranding').waitFor({timeout:70000});assert.match(await page.locator('.ai-error').innerText(),/did not finish a complete scenario before the deadline/);assert.match(await page.locator('.ai-failure-guidance pre').textContent(),/generation_timeout/);
    await (await editor(page, '#useAiBranding')).click();const record=await recovered(page);assert.equal(record.scenarios.length,baseline.scenarios.length+1);assert.match(record.scenarios.find(item=>item.id===record.activeId).avatar,/^data:image/);
    assert.deepEqual(errors,[]);await context.close();console.log('PASS browser polling deadline preserves branding from a running job without claiming AI success');
  }
}catch(error){
  if(latestPage&&!latestPage.isClosed()){console.error('AI browser failure:',await latestPage.evaluate(()=>({error:document.querySelector('.ai-error')?.textContent,save:document.querySelector('#saveState')?.textContent,review:document.querySelector('.v2-requirements')?.textContent,stage:document.querySelector('#stage')?.textContent?.slice(0,600)})).catch(()=>'<page unavailable>'));await latestPage.screenshot({path:'test-results/ai-browser-failure.png',fullPage:true}).catch(()=>{});}
  throw error;
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
