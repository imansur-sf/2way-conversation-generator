import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { browserOptions } from './browser-options.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const server=createServer(async(request,response)=>{
  const pathname=new URL(request.url,'http://localhost').pathname;
  if(pathname==='/seed'){response.setHeader('Content-Type','text/html');response.end('<!doctype html><title>Synthetic state fixtures</title>');return}
  const target=path.resolve(root,`.${pathname==='/'?'/interactive-simulator-builder.html':pathname}`);
  if(!target.startsWith(`${root}${path.sep}`)){response.writeHead(403).end();return}
  try{const content=await readFile(target);response.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[path.extname(target)]||'application/octet-stream');response.end(content)}catch{response.writeHead(404).end()}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch(browserOptions);
const key='two-way-experience-studio-v2-scenarios';
const scenario=(id,text=`${id} delayed reply`)=>({id,name:id,channel:'sms',schemaVersion:2,brandName:id,smsAddress:id,initials:id,avatar:'',steps:[{id:`${id}-input`,author:'customer',kind:'free',text:'',options:'',reusableSet:false},{id:`${id}-reply`,author:'brand',kind:'text',text,matchTerms:'',allowRepeat:true}]});
async function fresh(){
  const context=await browser.newContext();
  await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  const page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${base}/seed`);return {context,page,errors};
}
async function seed(page,scenarios,{savedAt=200,durable=null}={}){
  await page.evaluate(async({key,scenarios,savedAt,durable})=>{
    localStorage.setItem(key,JSON.stringify({version:2,savedAt,activeId:scenarios[0].id,scenarios}));
    localStorage.setItem('two-way-studio-v4','preserve this legacy record');
    if(durable)await new Promise((resolve,reject)=>{const request=indexedDB.open('two-way-experience-studio-scenarios-v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('scenario-state');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('scenario-state','readwrite');tx.objectStore('scenario-state').put(durable,'current');tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)}});
  },{key,scenarios,savedAt,durable});
}
async function boot(page,url=base){await page.goto(url,{waitUntil:'domcontentloaded'});await page.evaluate(()=>window.__twoWayScenarioInitialization);assert.equal(await page.locator('.builder').evaluate(node=>node.inert),false)}
async function manual(page){if(await page.locator('#chooseManual').isVisible())await page.locator('#chooseManual').click()}
async function record(page){return page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key)}
const results=[];
const selected=name=>!process.argv[2]||process.argv[2]===name;
try{
  if(selected('cache')){
    const {context,page,errors}=await fresh();
    await seed(page,[scenario('newer-cache')],{durable:{version:2,savedAt:100,activeId:'old-database',scenarios:[scenario('old-database')]}});
    await boot(page);assert.equal(await page.locator('#scenarioSelect').inputValue(),'newer-cache');
    await page.locator('#scenarioName').fill('Saved cache edit');
    await page.waitForFunction(()=>document.querySelector('#saveState')?.textContent==='Saved on this device');
    await boot(page);assert.equal(await page.locator('#scenarioName').inputValue(),'Saved cache edit');
    assert.equal(await page.evaluate(()=>localStorage.getItem('two-way-studio-v4')),'preserve this legacy record');
    assert.deepEqual(errors,[]);results.push('newer cache, successful save/reload, preserved legacy data');await context.close();
  }
  if(selected('share')){
    const {context,page,errors}=await fresh();
    await seed(page,[scenario('existing')],{durable:{version:2,savedAt:300,activeId:'existing',scenarios:[scenario('existing')]}});
    await context.addInitScript(()=>{const get=IDBObjectStore.prototype.get;IDBObjectStore.prototype.get=function(key){const request=get.call(this,key);if(this.name==='scenario-state')Object.defineProperty(request,'onsuccess',{set(handler){request.addEventListener('success',event=>setTimeout(()=>handler.call(request,event),250),{once:true})}});return request}});
    const payload=encodeURIComponent(Buffer.from(JSON.stringify(scenario('Shared import'))).toString('base64'));
    await boot(page,`${base}/#scenario=${payload}`);
    await page.waitForFunction(()=>document.querySelector('#saveState')?.textContent==='Saved on this device');
    assert.match(await page.locator('#scenarioName').inputValue(),/Shared import.*shared/);
    assert.ok((await record(page)).scenarios.some(item=>item.id==='existing'));
    await boot(page);assert.match(await page.locator('#scenarioName').inputValue(),/Shared import.*shared/);
    assert.deepEqual(errors,[]);results.push('delayed hydration retains shared-link import and existing scenarios');await context.close();
  }
  if(selected('image')){
    const {context,page,errors}=await fresh();await seed(page,[scenario('A'),scenario('B')]);await boot(page);await manual(page);
    let finishImage;const requested=new Promise(resolve=>{finishImage=resolve});let release;
    await context.route('**/api/asset?**',async route=>{finishImage();await new Promise(resolve=>release=resolve);await route.fulfill({json:{dataUrl:'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiLz4='}})});
    const control=page.locator('[data-image-asset][data-image-key="avatar"]');
    await control.locator('[data-image-url-open]').click();await control.locator('[data-image-url]').fill(`${base}/delayed-image.png`);await control.locator('[data-image-url-apply]').click();await requested;
    await page.locator('#scenarioSelect').selectOption('B');release();
    await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)).scenarios.find(item=>item.id==='A')?.avatar?.startsWith('data:image/'),key);
    const saved=await record(page);assert.equal(saved.scenarios.find(item=>item.id==='B').avatar,'');
    assert.deepEqual(errors,[]);results.push('delayed image remains assigned to initiating scenario');await context.close();
  }
  if(selected('runtime')){
    const {context,page,errors}=await fresh();await seed(page,[scenario('A','A SECRET REPLY'),scenario('B')]);await boot(page);await manual(page);
    await page.locator('#stage [data-start-main]').click();await page.locator('#phoneInput').fill('Hi');await page.locator('#phoneSend').click();await page.locator('#scenarioSelect').selectOption('B');
    await page.waitForTimeout(1200);assert.doesNotMatch(await page.locator('#stage').innerText(),/A SECRET REPLY/);
    const count=await page.locator('#scenarioSelect option').count();const before=await record(page);
    const dialog=page.waitForEvent('dialog').then(async event=>{assert.match(event.message(),/valid scenario JSON/);await event.accept()});
    await page.locator('#importScenarioFile').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({scenarios:[scenario('partial'),null]}))});await dialog;
    assert.equal(await page.locator('#scenarioSelect option').count(),count);assert.deepEqual(await record(page),before);
    assert.deepEqual(errors,[]);results.push('reply cancellation and atomic invalid import');await context.close();
  }
  if(selected('timeout')){
    const {context,page,errors}=await fresh();await seed(page,[scenario('Fallback')]);
    await context.addInitScript(()=>{Object.defineProperty(window,'indexedDB',{configurable:true,value:{open(){return {}}}});const nativeTimeout=window.setTimeout;window.setTimeout=(callback,delay,...args)=>nativeTimeout(callback,delay===5000?50:delay,...args)});
    await boot(page);await page.locator('#scenarioName').fill('Fallback saved');
    await page.waitForFunction(()=>document.querySelector('#saveState')?.textContent==='Saved in browser backup',null,{timeout:12000});
    assert.equal((await record(page)).scenarios.find(item=>item.id==='Fallback').name,'Fallback saved');
    assert.deepEqual(errors,[]);results.push('hung database releases editing and supports truthful cache fallback');await context.close();
  }
  if(selected('large')){
    const {context,page,errors}=await fresh();const large=scenario('Large');large.notes='x'.repeat(420001);await seed(page,[large]);const original=await record(page);
    await context.addInitScript(()=>Object.defineProperty(window,'indexedDB',{configurable:true,value:{open(){throw new DOMException('Storage unavailable','SecurityError')}}}));
    await boot(page);await page.locator('#scenarioName').fill('Unsaved large change');
    await page.waitForFunction(()=>document.querySelector('#saveState')?.textContent==='Save needs attention');
    assert.deepEqual(await record(page),original);assert.match(await page.locator('#storageNotice').innerText(),/were not saved/);
    assert.deepEqual(errors,[]);results.push('large failed save preserves original and reports unsaved');await context.close();
  }
  if(selected('ids')){
    const {context,page,errors}=await fresh(),malicious=scenario('Safe scenario');
    malicious.steps[0].id='opening"><img src=/missing onerror=window.__reviewMarker=true><i data-x="';
    await seed(page,[malicious]);await boot(page);await manual(page);
    assert.equal(await page.evaluate(()=>Boolean(window.__reviewMarker)),false);
    await page.locator('#scenarioName').fill('Normalized saved scenario');
    await page.waitForFunction(()=>document.querySelector('#saveState')?.textContent==='Saved on this device');
    for(const item of (await record(page)).scenarios)for(const step of item.steps||[])assert.match(step.id,/^[a-zA-Z0-9_-]+$/);
    const payload=encodeURIComponent(Buffer.from(JSON.stringify(malicious)).toString('base64'));
    await boot(page,`${base}/#scenario=${payload}`);
    assert.equal(await page.evaluate(()=>Boolean(window.__reviewMarker)),false);assert.deepEqual(errors,[]);
    results.push('saved and shared malicious IDs are normalized before rendering');await context.close();
  }
  console.log(JSON.stringify({passed:results.length,results},null,2));
}catch(error){console.error(JSON.stringify({completed:results,error:error.message},null,2));throw error;
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
