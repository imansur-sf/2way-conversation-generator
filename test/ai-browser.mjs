import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {browserOptions} from './browser-options.mjs';

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
  if(await page.locator('#chooseManual').isVisible())await page.locator('#chooseManual').click();
  // The seed starts in the legacy browser backup. Establish an acknowledged
  // durable baseline through the real save control before testing AI mutations.
  await page.locator('#save').click();await saved(page);
  await page.locator('#switchToAi').click();await page.locator('.v2-generation-controls').waitFor();
  return {context,page,requests,errors};
}
async function requestDraft(page,selected,{named=true,prompt='Build three messages for each selected channel.'}={}){
  await page.locator('#aiCompanyName').fill('Synthetic Co');await page.locator('#aiWebsite').fill('https://example.test');await page.locator('#aiUseCase').fill(prompt);
  for(const channel of channels)await page.locator(`[data-ai-channel="${channel}"]`).setChecked(selected.includes(channel));
  await page.locator('.v2-generation-controls summary').click();await page.locator('[data-v2-opening-sender]').selectOption('company');await page.locator('[data-v2-message-total]').fill('3');
  if(named){await page.locator('[data-v2-customer-name]').fill(persona.customerName);await page.locator('[data-v2-representative-name]').fill(persona.representativeName);await page.locator('[data-v2-representative-role]').fill(persona.representativeRole);}
  await page.locator('#generateAiDraft').click();
}
async function saved(page){await page.waitForFunction(()=>document.querySelector('#saveState')?.textContent==='Saved on this device');return page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);}
async function recovered(page){
  // Image embedding happens before the new scenario is saved. The previous
  // scenario's already-saved status is not an acknowledgement of this creation.
  await page.waitForFunction(key=>{const record=JSON.parse(localStorage.getItem(key));return record?.activeId!=='ai-target'&&record?.scenarios.length===2},key);
  return saved(page);
}
async function playback(page,channel,emailExpected=emailDefaults){
  await page.locator('[data-v2-preview-reset]').click();
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
  const artifact=await Promise.all([page.waitForEvent('download'),page.locator('#export').click()]).then(([download])=>download),file=path.join(directory,`${channel}.html`);await artifact.saveAs(file);
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
try{
  browser=await chromium.launch(browserOptions);
  {
    const {context,page,requests,errors}=await fresh(request=>responseFor(request));
    const prompt='Deliberate prompt: José O’Neil meets Zoë. Preserve punctuation, commas, and channel-specific presentations.';
    await requestDraft(page,channels,{prompt});
    await page.locator('[data-ai-channel="whatsapp"]').uncheck(); // Editing the form cannot mutate the in-flight request/result channel set.
    await page.locator('.ai-review').waitFor();assert.equal(requests.length,1);assert.deepEqual(requests[0].channels,channels);assert.equal(requests[0].useCase,prompt);assert.deepEqual(requests[0].persona,persona);assert.deepEqual(requests[0].controls,{initialSender:'company',expectedMessageCount:3});
    assert.match(await page.locator('.v2-requirements').innerText(),/Factual accuracy: Not verified/);assert.doesNotMatch(await page.locator('.ai-review').innerText(),/Prompt contract verified/);
    await page.evaluate(()=>document.dispatchEvent(new CustomEvent('twoway:ai-draft',{detail:{requestId:'stale',requirements:{channels:{sms:{checks:[{label:'STALE_EVENT',status:'passed'}]}}}}})));
    assert.doesNotMatch(await page.locator('.v2-requirements').innerText(),/STALE_EVENT/);
    await page.locator('#applyAiDraft').click();const record=await saved(page),scenario=record.scenarios.find(item=>item.id==='ai-target');assert.deepEqual(Object.keys(scenario.variants),channels);assert.equal(scenario.name,'Original destination');
    assert.deepEqual(scenario.variants.sms.steps[1].options,['Yes, please','No, thanks']);assert.equal(scenario.variants.rcs.steps[0].text,'');assert.equal(scenario.variants.email.steps[0].emailMode,'plain');assert.equal(scenario.variants.email.steps[2].emailMode,'branded');
    for(const channel of channels){if(channel!=='sms'){await page.locator(`[data-channel="${channel}"]`).click();await saved(page);}await playback(page,channel);await offlineExport(context,page,channel);console.log(`PASS AI ${channel}: applied content, comma choices, offline download and playback`);}
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
    await requestDraft(page,['email']);await page.locator('.ai-review').waitFor();await page.locator('#applyAiDraft').click();await saved(page);
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
    await page.locator('#regenerateAiDraft').click();assert.equal(await page.locator('#aiUseCase').inputValue(),prompt);assert.equal(requests.length,1);assert.equal(await page.locator('.v2-requirements').count(),0);
    assert.deepEqual(errors,[]);await context.close();console.log('PASS fallback provenance, unknown identity, regenerate preserves prompt');
  }
  {
    const {context,page,errors}=await fresh(request=>({status:'failed',error:'draft_invalid',issues:[{message:'The requested opening sender was not preserved.'}],branding:brandingFor(request)}));
    await mockBrandingAssets(context);const before=(await saved(page)).scenarios.find(item=>item.id==='ai-target');
    await requestDraft(page,channels);await page.locator('#useAiBranding').waitFor();
    assert.match(await page.locator('.ai-error').innerText(),/opening sender/);assert.equal(await page.locator('#applyAiDraft').count(),0);
    await mkdir('test-results',{recursive:true});await page.locator('.ai-brand-recovery').screenshot({path:'test-results/branding-recovery.png'});
    await page.locator('#recovery-initialSender').selectOption('customer');await page.locator('#useAiBranding').click();
    const record=await recovered(page),scenario=record.scenarios.find(item=>item.id===record.activeId);
    assert.notEqual(scenario.id,'ai-target');assert.deepEqual(record.scenarios.find(item=>item.id==='ai-target'),before);assert.deepEqual(Object.keys(scenario.variants),channels);
    for(const variant of Object.values(scenario.variants)){assert.equal(variant.generatedByAi,false);assert.ok(variant.steps.every(step=>step.text===''));assert.equal(variant.steps[0].author,'customer');assert.match(variant.avatar,/^data:image\/png/);assert.match(variant.brandingRecovery.failureReason,/opening sender/);}
    assert.match(scenario.variants.rcs.steps[1].cardImage,/^data:image/);assert.match(scenario.variants.whatsapp.steps[1].cardImage,/^data:image/);assert.match(scenario.variants.email.steps[1].emailHeroImage,/^data:image/);
    assert.match(await page.locator('#setupAssistant').innerText(),/No dialogue was generated/);
    await page.reload();await page.evaluate(()=>window.__twoWayScenarioInitialization);if(await page.locator('#chooseManual').isVisible())await page.locator('#chooseManual').click();
    const acceptDialog=dialog=>dialog.accept();page.on('dialog',acceptDialog);
    for(const channel of channels){
      await page.locator(`[data-channel="${channel}"]`).click();
      const download=await Promise.all([page.waitForEvent('download'),page.locator('#export').click()]).then(([item])=>item),file=path.join(directory,`branding-${channel}.html`);await download.saveAs(file);
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
    await requestDraft(page,['email']);await page.locator('#useAiBranding').waitFor();await page.locator('#useAiBranding').click();
    const record=await recovered(page),scenario=record.scenarios.find(item=>item.id===record.activeId);assert.match(scenario.avatar,/^data:image/);assert.equal(scenario.emailHeroImage,'');assert.equal(scenario.steps[0].author,'brand');
    assert.match(scenario.brandingRecovery.assetWarnings.join(' '),/Header \/ card image.*omitted/);assert.match(await page.locator('#setupAssistant').innerText(),/provider took too long/);
    assert.deepEqual(errors,[]);await context.close();console.log('PASS branding-only asset failure: useful logo retained, failed hero omitted with specific warning');
  }
  {
    const {context,page,requests,errors}=await fresh(request=>requests.length===1?{status:'failed',error:'draft_invalid',branding:brandingFor(request)}:{status:'failed',error:'website_fetch_failed'});await mockBrandingAssets(context);
    await requestDraft(page,['rcs']);await page.locator('#useAiBranding').waitFor();await page.locator('#aiWebsite').fill('https://other.test');assert.equal(await page.locator('#useAiBranding').count(),0);
    await page.locator('#generateAiDraft').click();await page.locator('.ai-error').waitFor();await page.waitForFunction(()=>!document.querySelector('#generateAiDraft').disabled);
    assert.equal(await page.locator('#useAiBranding').count(),0);assert.match(await page.locator('#setupAssistant').innerText(),/No website branding is available/);assert.equal((await saved(page)).scenarios.length,1);
    assert.deepEqual(errors,[]);await context.close();console.log('PASS failed retry cannot retain another website’s branding');
  }
  {
    const {context,page,errors}=await fresh(request=>({status:'failed',error:'gemini_timeout',branding:brandingFor(request)}));let release;const gate=new Promise(resolve=>release=resolve);await mockBrandingAssets(context,{gate});
    await requestDraft(page,['sms']);await page.locator('#useAiBranding').waitFor();await page.locator('#useAiBranding').click();await page.locator('#aiWebsite').fill('https://changed.test');release();
    await page.waitForFunction(()=>document.querySelector('#appStatus')?.textContent.includes('branding selection, or destination changed'));assert.equal((await saved(page)).scenarios.length,1);assert.deepEqual(errors,[]);await context.close();console.log('PASS late branding asset completion cannot apply after its request changes');
  }
  {
    let releaseFailure;const gate=new Promise(resolve=>releaseFailure=resolve);
    const {context,page,errors}=await fresh(async request=>{await gate;return {status:'failed',error:'draft_invalid',branding:brandingFor(request)}});
    await requestDraft(page,['sms']);await page.locator('#aiCompanyName').fill('Changed company');await page.locator('#aiWebsite').fill('https://changed.test');await page.locator('[data-ai-channel="sms"]').uncheck();await page.locator('[data-ai-channel="email"]').check();releaseFailure();
    await page.locator('.ai-error').waitFor();assert.equal(await page.locator('#useAiBranding').count(),0);assert.equal((await saved(page)).scenarios.length,1);
    assert.deepEqual(errors,[]);await context.close();console.log('PASS edits made during generation reject old website branding when failure arrives');
  }
  {
    const {context,page,errors}=await fresh(request=>({status:'failed',error:'gemini_incomplete',branding:brandingFor(request,{empty:true})}));
    await requestDraft(page,['email']);await page.locator('#useAiBranding').waitFor();assert.match(await page.locator('.ai-brand-recovery').innerText(),/No image candidates were found/);
    await page.locator('#useAiBranding').click();const record=await recovered(page),scenario=record.scenarios.find(item=>item.id===record.activeId);assert.equal(scenario.avatar,'');assert.equal(scenario.emailHeroImage,'');assert.ok(scenario.steps.every(step=>step.text===''));
    assert.deepEqual(errors,[]);await context.close();console.log('PASS branding without discovered images is labeled honestly and creates only blank manual fields');
  }
  {
    const {context,page,errors}=await fresh(request=>({status:'running',branding:brandingFor(request)}));await mockBrandingAssets(context);
    await requestDraft(page,['sms']);await page.locator('#useAiBranding').waitFor({timeout:70000});assert.match(await page.locator('.ai-error').innerText(),/deadline/);
    await page.locator('#useAiBranding').click();const record=await recovered(page);assert.equal(record.scenarios.length,2);assert.match(record.scenarios.find(item=>item.id===record.activeId).avatar,/^data:image/);
    assert.deepEqual(errors,[]);await context.close();console.log('PASS browser polling deadline preserves branding from a running job without claiming AI success');
  }
}catch(error){
  if(latestPage&&!latestPage.isClosed()){console.error('AI browser failure:',await latestPage.evaluate(()=>({error:document.querySelector('.ai-error')?.textContent,save:document.querySelector('#saveState')?.textContent,review:document.querySelector('.v2-requirements')?.textContent,stage:document.querySelector('#stage')?.textContent?.slice(0,600)})).catch(()=>'<page unavailable>'));await latestPage.screenshot({path:'test-results/ai-browser-failure.png',fullPage:true}).catch(()=>{});}
  throw error;
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
