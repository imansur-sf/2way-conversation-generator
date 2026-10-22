// Contract double for SaaSy Accounts: no real account, email, database, or AI use.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import axe from 'axe-core';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {browserOptions} from './browser-options.mjs';
import {editor,selectView} from './workspace-helpers.mjs';
const require=createRequire(import.meta.url),{createAccountsProxy}=require('../server/accounts-proxy.cjs');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const projects=new Map(),keys=new Map(),requests=[];let nextId=1,loseCreate=false,loseUpdate=false,expire=false,holdList=null,holdSave=null,saveEntered=()=>{};
const account='a@salesforce.com',other='b@salesforce.com';
function widget(){
  const email=()=>localStorage.getItem('saasy_auth_email');
  async function api(url,options={}){
    const response=await fetch(url,{...options,headers:{'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('saasy_auth_token'),...options.headers}}),body=await response.json();
    if(!response.ok){if(response.status===401)localStorage.removeItem('saasy_auth_token');throw Object.assign(new Error(body.error),{code:body.error,status:response.status})}return body;
  }
  window.SaasyAuth={getFeedbackSession:tool=>api('/feedback/session?tool='+tool),listFeedback:opts=>api('/feedback/inbox?tool='+opts.tool),getEmail:email,isSignedIn:()=>Boolean(localStorage.getItem('saasy_auth_token')),signOut(){localStorage.removeItem('saasy_auth_token');localStorage.removeItem('saasy_auth_email')},signIn({expectedEmail}={}){
    return new Promise((resolve,reject)=>{const overlay=document.createElement('div');overlay.id='test-auth-overlay';overlay.style='position:fixed;inset:0;z-index:999999;background:white;padding:50px';overlay.innerHTML='<label>Account <input type="email"></label><button>Continue sign-in</button>';const input=overlay.querySelector('input');input.value=expectedEmail||window.__nextAccount||'a@salesforce.com';input.readOnly=Boolean(expectedEmail);overlay.querySelector('button').onclick=()=>{localStorage.setItem('saasy_auth_email',input.value);localStorage.setItem('saasy_auth_token',input.value);overlay.remove();resolve()};document.body.append(overlay)});
  },listProjects:({tool})=>api('/projects?tool='+tool).then(x=>x.projects),loadProject:id=>api('/projects/'+id).then(x=>x.project),deleteProject:id=>api('/projects/'+id,{method:'DELETE'}),saveProject(options){const {id,tool,name,payload,sourceUrl,expectedRevision,idempotencyKey}=options;return api('/projects'+(id?'/'+id:''),{method:id?'PUT':'POST',headers:id?{}:{'Idempotency-Key':idempotencyKey},body:JSON.stringify({tool,name,payload,sourceUrl,expectedRevision})}).then(x=>x.project)}};
}
const upstream=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://test');res.setHeader('Content-Type','application/json');
  if(url.pathname==='/saasy-auth.js'){res.setHeader('Content-Type','text/javascript');res.end(`(${widget.toString()})()`);return}
  const owner=req.headers.authorization?.replace('Bearer ','');requests.push({owner,method:req.method,path:req.url});
  const json=(status,body)=>{res.writeHead(status);res.end(JSON.stringify(body))};
  if(expire&&!url.pathname.startsWith('/feedback')){expire=false;json(401,{error:'invalid_token'});return}
  if(url.pathname==='/feedback/session'){json(200,{email:owner||null,admin:owner==='imansur@salesforce.com'});return}
  if(url.pathname==='/feedback/inbox'){json(owner==='imansur@salesforce.com'?200:403,owner==='imansur@salesforce.com'?{items:[],total:0,unreadCount:0,pageSize:25}:{error:'forbidden'});return}
  if(![account,other,'imansur@salesforce.com'].includes(owner)){json(401,{error:'invalid_token'});return}
  if(req.method==='GET'&&url.pathname==='/projects'){if(holdList)await holdList;json(200,{projects:[...projects.values()].filter(p=>p.owner===owner&&p.tool===url.searchParams.get('tool'))});return}
  const id=url.pathname.split('/')[2],current=projects.get(id);
  if(req.method==='GET'){json(current?.owner===owner?200:404,current?.owner===owner?{project:current}:{error:'not_found'});return}
  let body='';for await(const chunk of req)body+=chunk;const data=body?JSON.parse(body):{};
  if(req.method==='POST'){
    if(holdSave){saveEntered();await holdSave;}
    const key=owner+':'+req.headers['idempotency-key'];
    if(keys.has(key)){json(200,{project:projects.get(keys.get(key))});return}
    const id=String(nextId++),project={id,owner,tool:data.tool,name:data.name,payload:data.payload,source_url:data.sourceUrl,revision:1,updated_at:new Date().toISOString()};projects.set(id,project);keys.set(key,id);
    if(loseCreate){loseCreate=false;json(502,{error:'network_failed'});return}json(201,{project});return;
  }
  if(current?.owner!==owner){json(404,{error:'not_found'});return}
  if(req.method==='DELETE'){projects.delete(id);json(200,{ok:true});return}
  if(data.expectedRevision!==current.revision){json(409,{error:'revision_conflict'});return}
  Object.assign(current,{name:data.name,payload:data.payload,source_url:data.sourceUrl,revision:current.revision+1});
  if(loseUpdate){loseUpdate=false;json(502,{error:'network_failed'});return}json(200,{project:current});
});
await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
const proxy=createAccountsProxy({baseUrl:`http://127.0.0.1:${upstream.address().port}`});
const server=createServer(async(req,res)=>{
  if(await proxy(req,res))return;
  const pathname=new URL(req.url,'http://test').pathname;
  if(pathname==='/seed'){res.end('<!doctype html><title>Cloud fixtures</title>');return}
  const file=path.resolve(root,'.'+(pathname==='/'?'/interactive-simulator-builder.html':pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(404).end();return}
  try{res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(await readFile(file))}catch{res.writeHead(404).end()}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch(browserOptions),errors=[],results=[];
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',d=>d.accept());
await context.route('**/*',route=>!/^https?:/.test(route.request().url())||new URL(route.request().url()).origin===base?route.continue():route.abort());
const image='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="blue"/></svg>').toString('base64');
const variant=channel=>({channel,brandName:'Fixture Company',smsAddress:'Fixture Company',avatar:image,emailLogo:image,emailHeroImage:image,subject:'Fixture',steps:[{id:channel+'1',author:'brand',kind:channel==='rcs'?'rich':'text',text:channel+' content',cardImage:image},{id:channel+'2',author:'customer',kind:'free',text:'Reply',options:[],reusableSet:false}]});
const fixture={id:'cloud-fixture',name:'Browser recovery',scenarioMode:'multi',...variant('sms'),variants:Object.fromEntries(['sms','rcs','whatsapp','email'].map(c=>[c,variant(c)]))};
const key='two-way-experience-studio-v2-scenarios';
const activeSnapshot=payload=>payload.workspace.scenarios.find(s=>s.id===payload.workspace.activeId);
async function boot(p=page){await p.goto(base);await p.evaluate(()=>window.__twoWayScenarioInitialization);await p.waitForFunction(()=>Boolean(window.SaasyAuth));await p.locator('.studio-rail').waitFor()}
async function rename(name){await (await editor(page,'#scenarioName')).fill(name);await page.waitForFunction(()=>document.querySelector('#saveState').textContent==='Saved on this device')}
async function cloudClick(p,action){
  if(action==='recovery'){if(!await p.locator('.v2-header-menu').evaluate(n=>n.open))await p.locator('.v2-header-menu>summary').click()}
  else if(action==='auth'&&await p.locator('[data-cloud="signin"]').isVisible()){await p.locator('[data-cloud="signin"]').click();return}
  else if(!await p.locator('.cloud-menu').evaluate(n=>n.open))await p.locator('.cloud-menu>summary').click();
  await p.locator(`[data-cloud="${action}"]`).click();
}
async function signIn(owner=account){await page.evaluate(owner=>window.__nextAccount=owner,owner);await cloudClick(page,'auth');await page.locator('#test-auth-overlay button').click();await page.waitForFunction(()=>window.SaasyAuth.isSignedIn()&&!document.querySelector('.cloud-menu').hidden)}
async function save(name,asNew=false){await cloudClick(page,'save');await page.locator('#cloud-project-name').fill(name);await page.locator(asNew?'[data-save-new]':'#cloud-save-form [type="submit"]').click()}
async function saved(){await page.waitForFunction(()=>!document.querySelector('#cloud-save-form').closest('dialog').open&&document.querySelector('.cloud-status').textContent.startsWith('Saved to cloud:'))}
async function readBackup(){return page.evaluate(async()=>{const req=indexedDB.open('two-way-experience-studio-scenarios-v1',1);const db=await new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=reject});return new Promise(resolve=>{const r=db.transaction('scenario-state').objectStore('scenario-state').get('cloud-replacement-backups');r.onsuccess=()=>resolve(r.result)})})}
async function storageSwitch(owner){await page.evaluate(owner=>{if(owner){localStorage.setItem('saasy_auth_email',owner);localStorage.setItem('saasy_auth_token',owner)}else{localStorage.removeItem('saasy_auth_email');localStorage.removeItem('saasy_auth_token')}window.dispatchEvent(new StorageEvent('storage',{key:'saasy_auth_email'}))},owner)}
try{
  await page.goto(base+'/seed');await page.evaluate(({key,fixture})=>localStorage.setItem(key,JSON.stringify({version:2,savedAt:200,activeId:fixture.id,scenarios:[fixture]})),{key,fixture});await boot();await (await editor(page,'#scenarioSelect')).selectOption(fixture.id);
  await rename('Signed-out local edit');await boot();assert.equal(await page.locator('#scenarioName').inputValue(),'Signed-out local edit');assert.equal(projects.size,0);results.push('signed-out autosave and reload');

  await mkdir(path.join(root,'test-results/cloud'),{recursive:true});
  await page.addScriptTag({content:axe.source});
  for(const width of [320,375,768,1440]){
    await page.setViewportSize({width,height:1000});await page.waitForTimeout(60);
    const bounds=await page.locator('.appbar').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1,`Toolbar fits ${width}px`);assert.equal(await page.locator('#presentation').evaluate(n=>Boolean(n.closest('details'))),false);assert.equal(await page.locator('#topExport').evaluate(n=>Boolean(n.closest('details'))),false);
    const audit=await page.evaluate(()=>axe.run({include:[['.cloud-account']]},{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}));assert.deepEqual(audit.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[]);
    await page.screenshot({path:path.join(root,`test-results/cloud/projects-${width}.png`)});
  }
  if(!await page.locator('.v2-header-menu').evaluate(n=>n.open))await page.locator('.v2-header-menu>summary').click();await page.locator('#feedback-open').click();await page.locator('#feedback-dialog').waitFor({state:'visible'});assert.equal(await page.locator('#feedback-inbox-open').isVisible(),false);await page.locator('#feedback-dialog [data-feedback-close]').first().click();
  await cloudClick(page,'recovery');
  const audit=await page.evaluate(()=>axe.run({include:[['dialog[open]']]},{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}));assert.deepEqual(audit.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[]);
  await page.keyboard.press('Escape');results.push('responsive account menu and accessible recovery dialog');
  await signIn();await page.locator('.cloud-menu>summary').click();await page.evaluate(()=>axe.run({include:[['.cloud-menu']]},{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}})).then(a=>assert.deepEqual(a.violations.map(v=>v.id),[]));await page.screenshot({path:path.join(root,'test-results/cloud/account-menu.png')});assert.equal(projects.size,0);assert.equal(await page.locator('#scenarioName').inputValue(),'Signed-out local edit');
  await save('Cloud workspace');await saved();assert.equal(projects.size,1);const first=projects.get('1');assert.equal(first.tool,'twoway');assert.equal(Object.keys(activeSnapshot(first.payload).variants).length,4);assert.equal(activeSnapshot(first.payload).variants.rcs.steps[0].cardImage,image);results.push('explicit cloud creation retains all channels and assets');await cloudClick(page,'list');await page.locator('.cloud-project-list li').first().waitFor();await page.evaluate(()=>axe.run({include:[['.cloud-project-panel']]},{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}})).then(a=>assert.deepEqual(a.violations.map(v=>v.id),[]));await page.screenshot({path:path.join(root,'test-results/cloud/my-projects.png')});await page.locator('.cloud-project-panel [data-close]').click();
  await rename('Update cloud');await save('Cloud workspace');await saved();assert.equal(projects.size,1);assert.equal(projects.get('1').revision,2);
  await rename('Lost update response');loseUpdate=true;await save('Cloud workspace');await page.waitForFunction(()=>document.querySelector('#cloud-save-form .cloud-dialog-error').textContent==='network_failed');await page.locator('#cloud-save-form [type="submit"]').click();await saved();assert.equal(projects.get('1').revision,3);results.push('updates and lost successful update responses');
  await save('Copy',true);await saved();assert.equal(projects.size,2);
  await rename('Retry across reload');loseCreate=true;await save('Retry copy',true);await page.waitForFunction(()=>document.querySelector('#cloud-save-form .cloud-dialog-error').textContent==='network_failed');assert.equal(projects.size,3);await boot();await rename('Newer during uncertain save');await save('Retry copy');await saved();assert.equal(projects.size,3);assert.equal(await page.locator('#scenarioName').inputValue(),'Newer during uncertain save');assert.match(await page.locator('.cloud-status').textContent(),/Newer changes/);results.push('Save as New and idempotent create retry across reload');
  await rename('My concurrent edit');projects.get('3').revision++;await save('Retry copy');await page.waitForFunction(()=>document.querySelector('#cloud-save-form .cloud-dialog-error').textContent.includes('changed elsewhere'));assert.equal(activeSnapshot(projects.get('3').payload).name,'Retry across reload');await page.locator('#cloud-save-form [data-close]').click();results.push('revision conflict keeps local edits');
  await cloudClick(page,'list');await page.locator('.cloud-project-list li').first().waitFor();await page.locator('[aria-label="Load Cloud workspace"]').click();await page.waitForFunction(()=>document.querySelector('.cloud-status').textContent.startsWith('Loaded'));
  assert.equal(await page.locator('#scenarioName').inputValue(),'Lost update response');const backups=await readBackup();assert.equal(activeSnapshot(backups[0].payload).name,'My concurrent edit');results.push('load archives full replaced workspace before applying');
  await cloudClick(page,'recovery');await page.locator('.cloud-backup-list button').first().click();await page.waitForFunction(()=>document.querySelector('.cloud-status').textContent.startsWith('Loaded local backup'));assert.equal(await page.locator('#scenarioName').inputValue(),'My concurrent edit');results.push('replacement backup restores editor');
  expire=true;await save('After expiry');await page.locator('#test-auth-overlay button').waitFor();assert.equal(await page.locator('#test-auth-overlay input').inputValue(),account);await page.locator('#test-auth-overlay button').click();await saved();results.push('expired session renews original identity outside native modal');
  await cloudClick(page,'auth');assert.equal(await page.locator('#scenarioName').inputValue(),'My concurrent edit');assert.equal(await page.locator('.cloud-project-list li').count(),0);assert.equal(await page.locator('.cloud-email').textContent(),'');await boot();assert.equal(await page.locator('#scenarioName').inputValue(),'My concurrent edit');results.push('sign-out clears private UI and preserves local recovery across reload');
  await signIn(other);await save('Other account copy');await page.waitForFunction(()=>document.querySelector('#cloud-save-form .cloud-dialog-error').textContent.includes('account changed'));await page.locator('[data-save-new]').click();await saved();assert.equal([...projects.values()].filter(p=>p.owner===other).length,1);results.push('account switch requires explicit Save as New');
  let release;holdList=new Promise(resolve=>release=resolve);await cloudClick(page,'list');await page.waitForTimeout(100);await storageSwitch(account);release();holdList=null;await page.waitForTimeout(150);assert.equal(await page.locator('.cloud-project-list li').count(),0);assert.equal(await page.locator('.cloud-dialog[open]').count(),0);results.push('late list response cannot repopulate after account switch');
  const malformed=structuredClone(projects.get('1'));malformed.id=String(nextId++);malformed.name='Malformed review';malformed.payload.workspace.aiSetup.source={imageCandidates:{}};projects.set(malformed.id,malformed);
  await cloudClick(page,'list');await page.locator('[aria-label="Load Malformed review"]').click();await page.waitForFunction(()=>document.querySelector('.cloud-project-list').previousElementSibling.textContent.includes('invalid review'));assert.equal(await page.locator('#scenarioName').inputValue(),'My concurrent edit');await page.locator('.cloud-dialog[open] [data-close]').click();results.push('malformed cloud data rejected without editor replacement');
  await page.evaluate(()=>{window.__originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(key==='cloud-replacement-backups')throw new DOMException('Synthetic full backup storage','QuotaExceededError');return window.__originalPut.call(this,value,key)}});
  await cloudClick(page,'list');await page.locator('[aria-label="Load Cloud workspace"]').click();await page.waitForFunction(()=>document.querySelector('.cloud-project-list').previousElementSibling.textContent.includes('replacement backup could not be saved'));assert.equal(await page.locator('#scenarioName').inputValue(),'My concurrent edit');await page.locator('.cloud-dialog[open] [data-close]').click();await page.evaluate(()=>IDBObjectStore.prototype.put=window.__originalPut);results.push('failed replacement backup blocks load and keeps editor');
  let releaseSave;holdSave=new Promise(resolve=>releaseSave=resolve);const requestSent=new Promise(resolve=>saveEntered=resolve);const countBefore=projects.size;await save('In-flight account A',true);await requestSent;await storageSwitch(null);releaseSave();holdSave=null;await page.waitForFunction(()=>document.querySelector('.cloud-status').textContent.includes('account changed'));assert.equal(await page.locator('.cloud-email').textContent(),'');assert.equal(await page.locator('#scenarioName').inputValue(),'My concurrent edit');assert.equal(projects.size,countBefore+1);results.push('in-flight save remains owned by initiating account after sign-out');
  const ewc=require('./fixtures/ewc.cjs'),contract=require('../server/draft-contract.cjs'),brief=contract.storyBrief(ewc.request),review=contract.validateAndNormalizeDraft(ewc.rawDraft,ewc.request,{url:ewc.request.website,candidates:[]},brief);
  const aiProject=structuredClone(projects.get('1'));aiProject.id=String(nextId++);aiProject.name='Completed AI review';aiProject.payload.workspace.settings={previewScale:'.7',setupMode:'review',generationControls:{sender:'company',total:'6',customerName:'Original customer',representativeName:'Original rep',representativeRole:'Advisor'}};
  aiProject.payload.workspace.aiSetup={companyName:ewc.request.companyName,website:ewc.request.website,useCase:ewc.request.useCase,channels:{sms:true,rcs:true,whatsapp:true,email:true},draft:review.draft,requirements:review.requirements,source:{mode:'provider',requestedChannels:ewc.request.channels,url:ewc.request.website,title:'Synthetic EWC fixture',imageCandidates:[],brief},requestSnapshot:ewc.request};projects.set(aiProject.id,aiProject);
  // Another browser profile loads the same persistent mock backend project.
  const second=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),p2=await second.newPage();await second.route('**/*',route=>!/^https?:/.test(route.request().url())||new URL(route.request().url()).origin===base?route.continue():route.abort());await p2.goto(base+'/seed');await p2.evaluate(owner=>{localStorage.setItem('saasy_auth_email',owner);localStorage.setItem('saasy_auth_token',owner)},account);await boot(p2);await cloudClick(p2,'list');p2.on('dialog',d=>d.accept());await p2.locator('[aria-label="Load Cloud workspace"]').click();await p2.waitForFunction(()=>document.querySelector('.cloud-status').textContent.startsWith('Loaded'));assert.equal(await p2.locator('#scenarioName').inputValue(),'Lost update response');results.push('cloud load in a separate browser profile');
  await cloudClick(p2,'list');await p2.locator('[aria-label="Load Completed AI review"]').click();await p2.locator('.ai-review').waitFor();assert.equal(await p2.locator('#previewScale').inputValue(),'.7');await p2.locator('.v2-requirements').waitFor();
  await cloudClick(p2,'save');await p2.locator('#cloud-save-form [type="submit"]').click();await p2.waitForFunction(()=>!document.querySelector('#cloud-save-form').closest('dialog').open&&document.querySelector('.cloud-status').textContent.startsWith('Saved to cloud:'));assert.equal(projects.get(aiProject.id).payload.workspace.settings.generationControls.customerName,'Original customer');
  await boot(p2);await p2.locator('.ai-review').waitFor();await p2.locator('.v2-requirements').waitFor();await (await editor(p2,'#regenerateAiDraft')).click();assert.equal(await p2.locator('[data-v2-opening-sender]').inputValue(),'company');assert.equal(await p2.locator('[data-v2-message-total]').inputValue(),'6');assert.equal(await p2.locator('[data-v2-customer-name]').inputValue(),'Original customer');await second.close();results.push('completed AI review, precision settings, cloud round trip and local reload');
  await storageSwitch('imansur@salesforce.com');await page.locator('#feedback-inbox-open').waitFor({state:'visible'});assert.deepEqual(await page.locator('#feedback-inbox-open').evaluate(n=>[n.previousElementSibling.className,n.nextElementSibling.id]),['cloud-account','reset']);await page.locator('.cloud-menu>summary').click();assert.equal(await page.locator('.cloud-account-name').textContent(),'imansur');await page.screenshot({path:path.join(root,'test-results/cloud/admin-menu.png')});await page.screenshot({path:path.join(root,'test-results/cloud/admin-toolbar.png'),clip:{x:540,y:0,width:900,height:340}});
  await page.locator('#feedback-inbox-open').click();await page.locator('#feedback-inbox-dialog').waitFor({state:'visible'});await page.locator('#feedback-inbox-dialog [data-feedback-inbox-close]').first().click();await cloudClick(page,'auth');await page.waitForFunction(()=>document.querySelector('#feedback-inbox-open').hidden);assert.equal(await page.locator('#feedback-inbox-list').textContent(),'');results.push('studio feedback in Troubleshoot and verified admin Inbox between account and Start Over');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:results.length,results,projectRequests:requests.length},null,2));
}catch(error){console.error(JSON.stringify({results,errors,status:await page.locator('.cloud-status').textContent(),rcs:projects.get('1')?.payload.workspace.scenarios[0].variants.rcs.steps},null,2));throw error}finally{await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>upstream.close(resolve))}
