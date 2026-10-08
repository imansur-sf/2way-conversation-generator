import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
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
function responseFor(request,{fallback=false,unknown=false}={}){
  const scenarios=Object.fromEntries(request.channels.map(channel=>{
    const opening={speaker:'company',text:`${literal} ${channel}`,presentation:channel==='email'?{kind:'email',mode:'plain'}:{kind:'text'}};
    if(channel==='rcs'){opening.text='';opening.presentation={kind:'card',cards:[card('Image-led offer','opening')]};}
    if(channel==='whatsapp')opening.presentation={kind:'carousel',cards:[card('WhatsApp one','wa-one'),card('WhatsApp two','wa-two')]};
    const ending={speaker:'company',text:`End ${channel}: Zoë is joining now.`,presentation:channel==='email'?{kind:'email',mode:'branded'}:{kind:'text'}};
    if(channel==='rcs')ending.presentation={kind:'carousel',cards:[card('Later first','future-one'),card('Later second','future-two')]};
    return [channel,{title:`Synthetic ${channel}`,sender:'Synthetic Co',subject:channel==='email'?'Exact email subject':undefined,turns:[opening,{speaker:'customer',text:'Yes, please',mode:'choices',options:['Yes, please','No, thanks']},ending]}];
  }));
  const identity=unknown?{customerName:'',representativeName:'',representativeRole:''}:persona;
  return {status:'completed',draft:{schemaVersion:2,companyName:'Synthetic Co',initialSender:'company',persona:identity,emailAddress:'hello@example.test',website:'https://example.test',logoUrl:'',heroImageUrl:'',scenarios},source:{mode:fallback?'prompt-fallback':'provider',fallbackReason:fallback?'gemini_rate_limited':null,stage:fallback?'provider':null,coverage:'partial',requestedChannels:[...request.channels],url:'https://example.test',title:'Synthetic research',imageCandidates:[],brief:{persona:identity,initialSender:'company',expectedMessageCount:3,scriptedTurns:[]}},requirements:{complete:true,channels:Object.fromEntries(request.channels.map(channel=>[channel,{status:'passed',checks:[{id:'structure',label:'Message structure',status:'passed'},{id:'factual_accuracy',label:'Factual accuracy',status:'unverified'}]}])),warnings:[]}};
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
async function playback(page,channel){
  const thread=channel==='email'?'[data-email="0"]':channel==='whatsapp'?'[data-wa-thread="wa-main"]':'[data-thread="sms-main"]';
  await page.locator(thread).click();
  const choices=page.locator(channel==='email'?'.email-reply-choices .chip':channel==='rcs'?'[data-rcs-reply]':'#transcript .chip');
  await choices.first().waitFor();assert.deepEqual(await choices.allTextContents(),['Yes, please','No, thanks']);
  await choices.first().click();await page.waitForFunction(channel=>document.querySelector('#stage')?.textContent.includes(`End ${channel}: Zoë is joining now.`),channel);
  assert.match(await page.locator('#stage').innerText(),/Yes, please/);
  assert.equal(await page.locator('#stage .ai-fallback-note, #stage .v2-requirements').count(),0);
}
async function offlineExport(context,page,channel){
  const artifact=await Promise.all([page.waitForEvent('download'),page.locator('#export').click()]).then(([download])=>download),file=path.join(directory,`${channel}.html`);await artifact.saveAs(file);
  const exported=await context.newPage(),errors=[],requests=[];exported.setDefaultTimeout(15000);exported.on('pageerror',error=>errors.push(error.message));exported.on('request',request=>{if(/^(https?:|file:)/.test(request.url())&&request.url()!==`file://${file}`)requests.push(request.url());});
  await context.setOffline(true);await exported.goto(`file://${file}`,{waitUntil:'load'});await exported.waitForFunction(()=>!document.body.classList.contains('export-booting'));
  const data=JSON.parse(await exported.locator('#scenario-data').textContent()).scenarios[0];
  assert.deepEqual(data.steps[1].options,['Yes, please','No, thanks']);assert.equal(data.steps[2].text,`End ${channel}: Zoë is joining now.`);
  if(channel==='email'){assert.equal(data.steps[0].text,`${literal} email`);assert.equal(data.emailMode,'plain');assert.equal(data.emailCtaLabel,'');}
  if(channel==='rcs'){assert.equal(data.steps[0].kind,'rich');assert.match(data.steps[0].cardImage,/^data:image\//);assert.ok(data.steps[2].cards.every(card=>card.image.startsWith('data:image/')));}
  if(channel==='whatsapp')assert.equal(data.steps[0].cards.length,2);
  await playback(exported,channel);await exported.waitForFunction(()=>[...document.querySelectorAll('#stage img')].every(image=>image.complete&&image.naturalWidth>0));
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
}catch(error){
  if(latestPage&&!latestPage.isClosed()){console.error('AI browser failure:',await latestPage.evaluate(()=>({error:document.querySelector('.ai-error')?.textContent,save:document.querySelector('#saveState')?.textContent,review:document.querySelector('.v2-requirements')?.textContent,stage:document.querySelector('#stage')?.textContent?.slice(0,600)})).catch(()=>'<page unavailable>'));await latestPage.screenshot({path:'test-results/ai-browser-failure.png',fullPage:true}).catch(()=>{});}
  throw error;
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
