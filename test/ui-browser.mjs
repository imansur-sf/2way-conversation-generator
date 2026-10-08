import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import axe from 'axe-core';
import { browserOptions } from './browser-options.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'test-results/ui');await mkdir(output,{recursive:true});
const exportDirectory=await mkdtemp(path.join(tmpdir(),'two-way-ui-exports-'));
const key='two-way-experience-studio-v2-scenarios';
const image=`data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="600"><rect width="1500" height="600" fill="#165c84"/><circle cx="750" cy="300" r="220" fill="#b8e6ed"/><text x="750" y="320" text-anchor="middle" font-size="80" fill="#153b55">Preview fixture</text></svg>')}`;
const variants=Object.fromEntries(['sms','rcs','whatsapp','email'].map(channel=>[channel,{channel,brandName:'Example Company',smsAddress:'Example Company',emailAddress:'hello@example.test',initials:'EC',avatar:'',subject:'Your next step',emailBody:'A deterministic email preview.',steps:[{id:`${channel}-opening`,author:'brand',kind:channel==='rcs'?'rich':'text',text:'Welcome. How can we help?',cardTitle:'Explore the next step',cardDescription:'A deterministic image and editable card.',cardImage:channel==='rcs'?image:'',cardCta:'',cardUrl:'',matchTerms:'',options:''},{id:`${channel}-input`,author:'customer',kind:'free',text:'',options:'',reusableSet:false},{id:`${channel}-reply`,author:'brand',kind:'text',text:'We can help with that.',matchTerms:'',options:''}]}]));
const fixture={id:'ui-fixture',name:'UI regression fixture',schemaVersion:2,scenarioMode:'multi',variants,...variants.sms};
const server=createServer(async(request,response)=>{
  const pathname=new URL(request.url,'http://localhost').pathname;
  if(pathname==='/seed'){response.setHeader('Content-Type','text/html');response.end('<!doctype html><title>UI fixture</title>');return}
  const target=path.resolve(root,`.${pathname==='/'?'/interactive-simulator-builder.html':pathname}`);
  if(!target.startsWith(`${root}${path.sep}`)){response.writeHead(403).end();return}
  try{response.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[path.extname(target)]||'application/octet-stream');response.end(await readFile(target))}catch{response.writeHead(404).end()}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch(browserOptions),manifest=[],failures=[];
async function fresh(viewport={width:1440,height:1000}){
  const context=await browser.newContext({viewport,reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
  page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>!/^https?:/.test(route.request().url())||new URL(route.request().url()).origin===base?route.continue():route.abort());
  await page.goto(`${base}/seed`);await page.evaluate(({key,fixture})=>localStorage.setItem(key,JSON.stringify({version:2,savedAt:200,activeId:fixture.id,scenarios:[fixture]})),{key,fixture});
  await page.goto(base);await page.evaluate(()=>window.__twoWayScenarioInitialization);
  if(await page.locator('#chooseManual').isVisible())await page.locator('#chooseManual').click();
  await page.locator('#scenarioSelect').selectOption(fixture.id);
  return {context,page,errors};
}
async function settle(page){
  await page.evaluate(()=>{window.__uiFitSample=null;window.__uiFitStable=0});
  await page.waitForFunction(()=>{
    const stage=document.querySelector('#stage'),device=stage?.querySelector('.phone,.gmail');if(!device||!device.getClientRects().length)return false;
    const box=device.getBoundingClientRect(),scale=Number(stage.dataset.previewScale),sample=JSON.stringify([stage.clientWidth,stage.clientHeight,box.x,box.y,box.width,box.height,scale]);
    const matches=scale>0&&Math.abs(box.width-device.offsetWidth*scale)<.1&&Math.abs(box.height-device.offsetHeight*scale)<.1;
    window.__uiFitStable=matches&&sample===window.__uiFitSample?window.__uiFitStable+1:0;window.__uiFitSample=sample;
    return window.__uiFitStable>=2;
  },null,{polling:'raf',timeout:3000}).catch(async error=>{throw new Error(`Preview fit did not converge: ${JSON.stringify(await metrics(page))}`,{cause:error})});
}
async function panel(page,name){const tab=page.locator(`[data-workspace-panel="${name}"]`);if(await tab.isVisible())await tab.click()}
async function saved(page){await page.waitForFunction(()=>document.querySelector('#saveState')?.textContent==='Saved on this device')}
async function metrics(page){return page.evaluate(()=>{
  const stage=document.querySelector('#stage'),device=stage.querySelector('.phone,.gmail'),header=document.querySelector('.appbar'),rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}},style=getComputedStyle(stage);
  return {stage:rect(stage),device:rect(device),natural:{width:device.offsetWidth,height:device.offsetHeight},padding:{x:parseFloat(style.paddingLeft),y:parseFloat(style.paddingTop)},scale:Number(stage.dataset.previewScale),mode:stage.dataset.previewFit,computedTransform:getComputedStyle(device).transform,inlineTransform:device.style.transform,scaleVariable:style.getPropertyValue('--v2-device-scale'),selectedPanel:document.querySelector('[data-workspace-panel][aria-selected="true"]')?.dataset.workspacePanel,canvasCount:stage.querySelectorAll('.v2-preview-canvas').length,horizontalOverflow:document.documentElement.scrollWidth-innerWidth,headerOverflow:header?header.scrollWidth-header.clientWidth:0};
})}
function assertFit(value){
  assert.equal(value.canvasCount,1,'There must be one sizing canvas');assert.ok(value.horizontalOverflow<=1,'The workspace must not overflow horizontally');assert.ok(value.headerOverflow<=1,'Header controls must remain in the viewport');
  assert.ok(value.device.width>0&&value.device.height>0,'The selected preview must be visible');
  assert.ok(Math.abs(value.device.width-value.natural.width*value.scale)<.1&&Math.abs(value.device.height-value.natural.height*value.scale)<.1,'Rendered device scale must match the fit controller');
  assert.ok(value.device.x>=value.stage.x-1&&value.device.y>=value.stage.y-1,'Auto-fit must not clip the leading edge');
  assert.ok(value.device.right<=value.stage.right+1&&value.device.bottom<=value.stage.bottom+1,'Auto-fit must fit both dimensions');
  assert.ok(Math.abs(value.device.width/value.device.height-value.natural.width/value.natural.height)<.001,'Scaling must preserve device aspect ratio');
}
async function scopedAxe(page,selectors){
  await page.addScriptTag({content:axe.source});
  const result=await page.evaluate(selectors=>axe.run({include:selectors.map(selector=>[selector])},{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}),selectors);
  return {violations:result.violations.map(({id,impact,tags,nodes})=>({id,impact,criteria:tags.filter(tag=>/^wcag\d{3,}/.test(tag)),nodes:nodes.map(({target,failureSummary})=>({target,failureSummary}))})),incomplete:result.incomplete.map(({id,tags})=>({id,criteria:tags.filter(tag=>/^wcag\d{3,}/.test(tag))})),passes:result.passes.length};
}
async function run(name,work){console.log(`START UI: ${name}`);try{await work();console.log(`PASS UI: ${name}`)}catch(error){failures.push(new Error(`${name}: ${error.message}`,{cause:error}));console.error(`FAIL UI: ${name}`,error.stack)}}
try{
  for(const [name,viewport] of Object.entries({desktop:{width:1440,height:1000},laptop:{width:1280,height:720},tablet:{width:820,height:1180},narrow:{width:390,height:844},landscape:{width:844,height:390}}))await run(`fit-${name}`,async()=>{
    const {context,page,errors}=await fresh(viewport);
    try{for(const channel of ['sms','rcs','whatsapp','email'])await run(`fit-${name}-${channel}`,async()=>{
      await panel(page,'editor');await page.locator(`[data-channel="${channel}"]`).click();await page.locator('#previewScale').selectOption('auto');await panel(page,'preview');await settle(page);
      const value=await metrics(page),row={name,viewport,channel,...value,errors:[...errors],screenshot:`${name}-${channel}.png`};manifest.push(row);
      await page.screenshot({path:path.join(output,row.screenshot)});assertFit(value);assert.deepEqual(errors,[]);
      if(channel==='sms'){row.axe=await scopedAxe(page,['.appbar','.v2-workspace-tabs','.v2-preview-mode']);assert.deepEqual(row.axe.violations,[],'Changed workspace controls must pass the scoped automated rules')}
      if(name==='desktop'&&channel==='rcs'){row.imageHintsAxe=await scopedAxe(page,['.builder .image-asset-hint']);assert.deepEqual(row.imageHintsAxe.violations,[],'Image guidance must remain readable on its own surface')}
      if(['desktop','narrow','landscape'].includes(name)){
        await page.locator(channel==='email'?'[data-email="0"]':channel==='whatsapp'?'[data-wa-thread="wa-main"]':'[data-thread="sms-main"]').click();await settle(page);
        const conversation={name:`${name}-conversation`,viewport,channel,...await metrics(page),contentOverflow:await page.locator('#stage .mailview,#stage .mailbody,#stage .scenario-email-header,#stage .transcript,#stage .wa-chat-body').evaluateAll(nodes=>nodes.map(node=>({className:node.className,overflow:node.scrollWidth-node.clientWidth}))),screenshot:`${name}-${channel}-conversation.png`};manifest.push(conversation);
        await page.screenshot({path:path.join(output,conversation.screenshot)});assertFit(conversation);assert.ok(conversation.contentOverflow.every(item=>item.overflow<=1),`Conversation content must fit horizontally: ${JSON.stringify(conversation.contentOverflow)}`);
        if(channel==='rcs')await page.locator('#stage .card-img__asset').waitFor();
      }
      for(const [mode,scale] of [['.85',.85],['.7',.7],['1',1]]){await page.locator('#previewScale').selectOption(mode);await settle(page);assert.equal((await metrics(page)).scale,scale,'Manual zoom must remain exact')}
    })}finally{await context.close()}
  });
  await run('tabs-keyboard-and-phone-keys',async()=>{
    const {context,page,errors}=await fresh({width:390,height:844});
    try{
      await page.locator('#scenarioName').fill('Retained editor draft');await saved(page);
      await page.evaluate(()=>{window.__retainedBuilder=document.querySelector('.builder');window.__retainedStage=document.querySelector('#stage')});
      await page.locator('#workspace-tab-editor').focus();await page.keyboard.press('ArrowRight');
      assert.equal(await page.locator('#workspace-tab-preview').getAttribute('aria-selected'),'true');assert.equal(await page.locator('.builder').evaluate(node=>node.hidden&&node.inert),true);
      await page.keyboard.press('ArrowLeft');assert.equal(await page.locator('#scenarioName').inputValue(),'Retained editor draft');
      assert.equal(await page.evaluate(()=>window.__retainedBuilder===document.querySelector('.builder')&&window.__retainedStage===document.querySelector('#stage')),true);
      await panel(page,'preview');await page.locator('[data-thread="sms-main"]').click();await page.locator('#phoneInput').focus();await page.locator('[data-keyboard-shift]').click();await page.locator('[data-key="a"]').click();assert.equal(await page.locator('#phoneInput').inputValue(),'A');
      await page.locator('[data-keyboard-backspace]').click();assert.equal(await page.locator('#phoneInput').inputValue(),'');
      const keyboardAxe=await scopedAxe(page,['.phone-keyboard']);manifest.push({name:'keyboard',axe:keyboardAxe,errors});assert.deepEqual(keyboardAxe.violations,[]);
      await settle(page);assertFit(await metrics(page));await page.screenshot({path:path.join(output,'narrow-keyboard.png')});
      await panel(page,'editor');const stamp=await page.locator('#localSaveDetails').getAttribute('data-saved-at');assert.ok(Number(stamp)>0);assert.match(await page.locator('#localSaveDetails').textContent(),/Device-local only/);
      const download=await Promise.all([page.waitForEvent('download'),page.locator('#localSaveDetails button').click()]).then(([value])=>value);assert.match(download.suggestedFilename(),/\.json$/);
      assert.deepEqual(errors,[]);
    }finally{await context.close()}
  });
  await run('crop-draft-cancel-undo-commit',async()=>{
    const {context,page,errors}=await fresh();
    try{
      await page.locator('[data-channel="rcs"]').click();await saved(page);
      const disclosure=page.locator('[data-collapse-step="rcs-opening"]');if(await disclosure.getAttribute('aria-expanded')==='false'){await disclosure.click();await saved(page)}
      const trigger=page.locator('[data-image-step="rcs-opening"] [data-image-adjust]');await trigger.click();
      const dialog=page.locator('dialog.rcs-image-cropper'),initial=await page.evaluate(key=>localStorage.getItem(key),key);
      await dialog.locator('[data-rcs-crop-x]').fill('80');await dialog.locator('[data-rcs-crop-x]').press('Tab');
      await dialog.locator('[data-rcs-crop-scale]').fill('140');await dialog.locator('[data-rcs-crop-scale]').press('Tab');
      assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),initial,'Draft crop must not write browser storage');
      await dialog.locator('[data-rcs-crop-reset]').click();assert.equal(await dialog.locator('[data-rcs-crop-x]').inputValue(),'50');
      await dialog.locator('[data-rcs-crop-undo]').click();assert.equal(await dialog.locator('[data-rcs-crop-x]').inputValue(),'80');
      await dialog.locator('[data-rcs-crop-done]').focus();await page.keyboard.press('Tab');assert.equal(await dialog.locator('.rcs-image-cropper__close').evaluate(node=>node===document.activeElement),true,'Tab from Done must wrap to the first dialog control');
      await page.keyboard.press('Shift+Tab');assert.equal(await dialog.locator('[data-rcs-crop-done]').evaluate(node=>node===document.activeElement),true,'Shift+Tab must wrap to the final dialog control');
      await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert.equal(await trigger.evaluate(node=>node===document.activeElement),true);assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),initial);
      await trigger.click();await dialog.locator('[data-rcs-crop-fit="contain"]').click();await dialog.locator('[data-rcs-crop-cancel]').click();assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),initial);
      await trigger.click();await dialog.locator('[data-rcs-crop-fit="contain"]').click();await dialog.click({position:{x:2,y:2}});await dialog.waitFor({state:'detached'});assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),initial);
      await trigger.click();await dialog.locator('[data-rcs-crop-x]').fill('75');await dialog.locator('[data-rcs-crop-x]').press('Tab');
      await dialog.locator('[data-rcs-crop-scale]').fill('140');await dialog.locator('[data-rcs-crop-scale]').press('Tab');
      await dialog.locator('[data-rcs-source-info]').filter({hasText:'1500 × 600'}).waitFor();
      const cropAxe=await scopedAxe(page,['dialog.rcs-image-cropper']);manifest.push({name:'crop-dialog',axe:cropAxe,errors});await page.screenshot({path:path.join(output,'crop-dialog.png')});assert.deepEqual(cropAxe.violations,[]);
      await dialog.locator('[data-rcs-crop-done]').click();await saved(page);
      const stored=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).scenarios.find(item=>item.id==='ui-fixture').variants.rcs.steps[0],key);assert.equal(stored.imagePositionX,75);assert.equal(stored.imageScale,1.4);assert.equal(stored.cardImage,image);assert.deepEqual(errors,[]);
    }finally{await context.close()}
  });
  for(const channel of ['sms','rcs','whatsapp','email'])await run(`standalone-autofit-${channel}`,async()=>{
    const {context,page,errors}=await fresh({width:1280,height:720});
    try{
      await page.locator(`[data-channel="${channel}"]`).click();await saved(page);
      const download=await Promise.all([page.waitForEvent('download'),page.locator('#topExport').click()]).then(([value])=>value);
      const file=path.join(exportDirectory,`standalone-${channel}.html`);await download.saveAs(file);
      const exported=await context.newPage(),exportErrors=[],dependencies=[];exported.on('pageerror',error=>exportErrors.push(error.message));exported.on('request',request=>{if(/^(https?:|file:)/.test(request.url())&&request.url()!==`file://${file}`)dependencies.push(request.url())});
      await exported.goto(`file://${file}`);await exported.evaluate(()=>window.__twoWayScenarioInitialization);await exported.setViewportSize({width:390,height:600});await settle(exported);
      const value=await metrics(exported);manifest.push({name:'standalone',viewport:{width:390,height:600},channel,...value,errors:exportErrors,dependencies});assertFit(value);assert.deepEqual(exportErrors,[]);assert.deepEqual(dependencies,[],'Standalone UI must remain offline');await exported.screenshot({path:path.join(output,`standalone-${channel}.png`)});await exported.close();
      assert.deepEqual(errors,[])}finally{await context.close()}
  });
}finally{await writeFile(path.join(output,'manifest.json'),JSON.stringify({scope:'Changed workspace controls, phone keyboard, and existing crop dialog; not a full WCAG audit',manifest,failures:failures.map(error=>error.message)},null,2));await browser.close();await new Promise(resolve=>server.close(resolve))}
if(failures.length)throw new AggregateError(failures,`${failures.length} UI regression groups failed`);
