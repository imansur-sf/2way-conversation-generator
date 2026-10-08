const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { webcrypto } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'interactive-simulator-builder.html'), 'utf8');
const lines = html.split('\n');
const clone = value => JSON.parse(JSON.stringify(value));
function source(prefix) {
  const start = lines.findLastIndex(line => line.trim().startsWith(prefix));
  assert.ok(start >= 0, `source exists: ${prefix}`);
  let code = '';
  for (let index = start; index < lines.length; index++) {
    code += `${lines[index]}\n`;
    try { new vm.Script(code); return code; } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
  }
  throw new Error(`Incomplete source: ${prefix}`);
}
const fn = name => source(`${lines.some(line=>line.trim().startsWith(`async function ${name}(`))?'async ':''}function ${name}(`);
function storage() {
  const values = new Map();
  return { values, getItem:key=>values.get(key)||null, setItem:(key,value)=>values.set(key,String(value)), removeItem:key=>values.delete(key) };
}
const scenario = (id, text = 'Reply') => ({ id, name:id, channel:'sms', steps:[{id:`${id}-input`,author:'customer',kind:'free',reusableSet:false},{id:`${id}-reply`,author:'brand',kind:'text',text}] });
const tick = () => new Promise(resolve => setImmediate(resolve));
function environment(extra = {}) {
  const state = { scenarios:[scenario('A')], activeId:'A', channelEditPending:{scenarioId:'A',channel:'sms'} };
  const notices = [];
  const context = vm.createContext({
    state, notices, crypto:webcrypto, window:{}, localStorage:storage(), isStandaloneExport:false,
    scenarioStoreKey:'current', historyKey:'history', localStorageCacheLimit:420000, maxRestorePoints:3,
    durableScenarioRecord:'current', durableHistoryRecord:'history', durableSaveSequence:0, durableLastSavedAt:0,
    durableRecoveryRecord:null, durableRecoveryPromise:null, durableHydrated:false,
    saved:'', storedScenarios:[], scenarioHistory:[], bootstrapRecoveryWasUsed:false,
    active:()=>state.scenarios.find(item=>item.id===state.activeId),
    captureJourneyVariant(){}, rememberChannelSaveSignatures(){},
    showStorageNotice:(detail,outcome)=>notices.push({detail,outcome}),
    durableWrite:()=>Promise.resolve(), persist(){}, resetRuntime(){}, renderAll(){}, renderPreview(){},
    ensureJourneyState(){}, bindSaveAllControl(){}, announce(){}, $:()=>null,
    setTimeout, clearTimeout, ...extra,
  });
  vm.runInContext(fn('scenarioRecordTime')+fn('unsupportedScenarioRecord'),context);return context;
}
function installPersistence(context) {
  vm.runInContext([fn('readableBytes'),fn('storageFailureDetail'),fn('writeSmallLocalCache'),fn('preserveDurableRecoveryRecord'),fn('markBlockedScenarioEdit'),source('persist=function(){captureJourneyVariant();if(isStandaloneExport){const saveState=$(\'#saveState\');if(saveState)saveState.textContent=\'Standalone HTML\';return Promise.resolve(true)}')].join('\n'),context);
}
function installJourneys(context) {
  Object.assign(context,{journeyChannels:['sms','rcs','whatsapp','email'],journeyMeta:new Set(['id','name','scenarioMode','variants','channel']),cloneValue:clone,supportedBootstrapChannels:new Set(['sms','rcs','whatsapp','email'])});
  vm.runInContext(['normalizeScenarioIdentifiers','bootstrapScenario','journeyVariant','isJourneyVariant','normalizeJourneyStep','normalizeJourneyVariant','normalizeJourney','captureJourneyVariant','projectJourneyVariant','prepareScenarioImport'].map(fn).join('\n'),context);
}
function installStarterJourneys(context) {
  installJourneys(context);
  const seed=JSON.parse(html.match(/<script id="scenario-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  Object.assign(context,{seed,customerJourneyId:'customer-initiated-initial-message',companyJourneyId:'company-initiated-initial-message'});
  context.state.scenarios=clone(seed.scenarios);
  vm.runInContext(['starterSource','starterVariant','companyWhatsappStarter','buildCustomerFirstJourney','buildCompanyFirstJourney','ensureJourneyState','channelSaveSignature','rememberChannelSaveSignatures','hasPendingChannelEdits','switchJourneyChannel'].map(fn).join('\n'),context);
  context.state.scenarios=[context.buildCustomerFirstJourney(),context.buildCompanyFirstJourney()];
  context.state.activeId=context.state.scenarios[0].id;
  context.ensureJourneyState();context.rememberChannelSaveSignatures();
  context.renderAll=()=>context.ensureJourneyState();
}

test('starter multi-channel switches acknowledge the exact rendered revision without creating pending edits', async () => {
  const writes=[],context=environment({durableWrite:(key,value)=>{writes.push({key,value:clone(value)});return Promise.resolve()}});
  installStarterJourneys(context);installPersistence(context);
  const persist=context.persist;let saved;
  context.persist=()=>saved=persist();
  for(const channel of ['rcs','sms','whatsapp','email','rcs']){
    context.switchJourneyChannel(channel);await saved;
    const record=writes.filter(write=>write.key==='current').at(-1).value;
    assert.deepEqual(record.scenarios,clone(context.state.scenarios),`${channel}: rendering must not change the acknowledged revision`);
    assert.equal(context.state.unsavedScenarioChanges,false);assert.equal(context.notices.at(-1).outcome,'saved');
    assert.equal(context.hasPendingChannelEdits(),false);
    for(const journey of record.scenarios)for(const [key,variant] of Object.entries(journey.variants))assert.equal(variant.channel,key);
  }
});

test('Save all changes and its restore-point render acknowledge edited RCS and WhatsApp variants', async () => {
  const writes=[],context=environment({durableWrite:(key,value)=>{writes.push({key,value:clone(value)});return Promise.resolve()},flushFocusedBuilderEdit(){},setTimeout(){}});
  installStarterJourneys(context);installPersistence(context);
  vm.runInContext(fn('retainedScenarioHistory')+fn('persistScenarioHistory')+source('saveHistory=function(){return persistScenarioHistory()}')+source("captureVersion=function(label='Restore point')")+fn('saveAllChanges'),context);
  for(const channel of ['rcs','whatsapp']){
    context.switchJourneyChannel(channel);await tick();
    context.active().brandName=`${channel} saved brand`;
    if(channel==='whatsapp')context.active().avatar='data:image/png;base64,synthetic';
    context.saveAllChanges();await tick();
    const record=writes.filter(write=>write.key==='current').at(-1).value;
    assert.deepEqual(record.scenarios,clone(context.state.scenarios),`${channel}: restore-point rendering must not invalidate the save`);
    assert.equal(record.scenarios[0].variants[channel].brandName,`${channel} saved brand`);
    assert.equal(context.state.unsavedScenarioChanges,false);assert.equal(context.notices.at(-1).outcome,'saved');
    assert.deepEqual(clone(context.scenarioHistory[0].snapshot),record.scenarios[0]);
  }
});

test('saved channel signatures are unchanged by projecting an inactive variant', () => {
  const context=environment();installStarterJourneys(context);
  context.renderAll();assert.equal(context.state.unsavedScenarioChanges,undefined,'bootstrap normalization alone is not a user edit');
  for(const channel of ['sms','rcs','whatsapp','email']){
    const before=context.channelSaveSignature(context.active(),channel);
    context.captureJourneyVariant();context.projectJourneyVariant(context.active(),channel);
    assert.equal(context.channelSaveSignature(context.active()),before,`${channel}: viewing a saved variant is not an edit`);
    context.state.channelEditPending={scenarioId:context.active().id,channel};
    assert.equal(context.hasPendingChannelEdits(),false,'unchanged controls do not need a departure prompt');
  }
  context.active().brandName='A genuinely changed brand';assert.equal(context.hasPendingChannelEdits(),true);
});

test('render-stable starter saves still retain genuinely newer edits while acknowledgement is pending', async () => {
  let release;const context=environment({durableWrite:()=>new Promise(resolve=>release=resolve)});
  installStarterJourneys(context);installPersistence(context);
  const saved=context.persist();await tick();
  context.active().brandName='Changed after the saved snapshot';context.captureJourneyVariant();context.renderAll();
  release();await saved;
  assert.equal(context.state.unsavedScenarioChanges,true);assert.equal(context.state.lastScenarioSaveOutcome,'pending');
  assert.equal(context.notices.at(-1).outcome,'pending');assert.match(context.notices.at(-1).detail,/Newer changes still need saving/);
});

test('legacy, imported and shared multi-channel records retain a stable stored channel convention', async () => {
  for(const boundary of ['reload','import','shared']){
    const context=environment({supportedScenarioChannels:new Set(['sms','rcs','whatsapp','email']),scenarioMigrationDirty:false});
    installStarterJourneys(context);installPersistence(context);vm.runInContext(fn('normalizeScenario'),context);
    const input=clone(context.active());delete input.variants.sms.channel;delete input.variants.email.channel;
    const restored=boundary==='reload'?context.bootstrapScenario(input,0):boundary==='import'?context.prepareScenarioImport(input)[0]:context.normalizeScenario(input);
    context.state.scenarios=[restored];context.state.activeId=restored.id;context.renderAll();
    const saved=context.persist();context.renderAll();await saved;
    const record=JSON.parse(context.localStorage.getItem('current'));
    assert.deepEqual(record.scenarios,clone(context.state.scenarios),`${boundary}: save and normalization must agree`);
    assert.equal(context.state.unsavedScenarioChanges,false);
    for(const [channel,variant] of Object.entries(record.scenarios[0].variants))assert.equal(variant.channel,channel);
  }
});

test('future and unknown primary versions prevent every legacy migration write', () => {
  for(const version of [3,'future',null]){
    const context=environment({sessionStorage:storage(),bootstrapRecoverySkipLegacy:'skip',scenarioStoreVersion:1,v1ScenarioStoreKey:'legacy',v1LegacyScenarioStoreKey:'older',v2HistoryStoreKey:'history',v1HistoryStoreKey:'legacy-history'});
    const primary=JSON.stringify({version,workspaces:[{id:'future',content:'Keep byte-for-byte'}]});
    context.localStorage.setItem('current',primary);context.localStorage.setItem('legacy',JSON.stringify({version:4,scenarios:[scenario('legacy')]}));
    context.localStorage.setItem('legacy-history',JSON.stringify([{id:'restore'}]));
    vm.runInContext(source('const scenarioRecords=')+source('const scenarioHistoryRecords=')+source('const migrateV1BrowserData=')+'migrateV1BrowserData();',context);
    assert.equal(context.localStorage.getItem('current'),primary);assert.equal(context.localStorage.getItem('history'),null);
    context.localStorage.removeItem('current');vm.runInContext('migrateV1BrowserData();',context);
    assert.equal(JSON.parse(context.localStorage.getItem('current')).scenarios[0].id,'legacy','supported legacy migration remains available when primary is absent');
  }
});

test('unsupported records remain protected in recovery mode; blocked edits stay unsaved after rendering and warn on unload', async () => {
  for(const sourceStore of ['cache','database']){
    const original={version:3,workspaces:[{id:'future',content:'New format'}]},writes=[],listeners={};
    const context=environment({bootstrapRecoveryWasUsed:true,window:{addEventListener:(name,handler)=>listeners[name]=handler},durableRead:key=>Promise.resolve(key==='current'&&sourceStore==='database'?original:null),durableWrite:(key,value)=>{writes.push({key,value});return Promise.resolve()},renderBuilder(){}});
    if(sourceStore==='cache')context.localStorage.setItem('current',JSON.stringify(original));
    installJourneys(context);installPersistence(context);
    vm.runInContext(fn('hydrateDurableScenarioState')+fn('persistScenarioHistory')+fn('markChannelEditPending')+fn('renderAll')+source("window.addEventListener('beforeunload'"),context);
    await context.hydrateDurableScenarioState();assert.match(context.state.scenarioStorageReadOnly,/Saving is disabled/);assert.equal(context.state.unsavedScenarioChanges,undefined);
    context.state.scenarios[0].name='Tab-only edit';context.markChannelEditPending();
    assert.equal(context.state.unsavedScenarioChanges,true,'input/change guards edits even before persist runs');
    assert.equal(await context.persist(),false);assert.equal(await context.persistScenarioHistory(),false);
    assert.equal(context.state.unsavedScenarioChanges,true);assert.equal(context.state.lastScenarioSaveOutcome,'failed');assert.equal(context.window.__twoWayScenarioEdited,true);
    assert.equal(writes.length,0);assert.equal(context.localStorage.getItem('current'),sourceStore==='cache'?JSON.stringify(original):null);
    context.notices.length=0;context.renderAll();assert.equal(context.notices.at(-1).outcome,'blocked-edit','read-only warning is re-established after builder re-render');
    let prevented=false;const event={preventDefault(){prevented=true}};listeners.beforeunload(event);assert.equal(prevented,true);assert.equal(event.returnValue,'');
    const saveNode={},notice={classList:{add(){},remove(){}}};context.$=selector=>selector==='#saveState'?saveNode:selector==='#storageNotice'?notice:null;context.esc=value=>value;
    vm.runInContext(fn('showStorageNotice'),context);context.renderAll();assert.equal(saveNode.textContent,'Changes not saved');assert.match(notice.innerHTML,/not saved/);assert.match(notice.innerHTML,/export/i);
  }
});

test('oversized failed saves retain existing copies and remain unsaved', async () => {
  const context = environment({durableWrite:()=>Promise.reject(new Error('Database unavailable'))});
  context.localStorage.setItem('current','old backup');context.localStorage.setItem('two-way-studio-v4','legacy');
  context.state.scenarios[0].avatar='x'.repeat(420001);installPersistence(context);
  assert.equal(await context.persist(),false);
  assert.equal(context.localStorage.getItem('current'),'old backup');
  assert.equal(context.localStorage.getItem('two-way-studio-v4'),'legacy');
  assert.equal(context.state.unsavedScenarioChanges,true);
  assert.ok(context.state.channelEditPending);
  assert.equal(context.notices.at(-1).outcome,'failed');
  assert.doesNotMatch(context.notices.at(-1).detail,/backup was saved/);
});

test('a small-cache fallback acknowledges only the revision actually stored', async () => {
  const context=environment({durableWrite:()=>Promise.reject(new Error('Database unavailable'))});installPersistence(context);
  assert.equal(await context.persist(),true);
  assert.deepEqual(JSON.parse(context.localStorage.getItem('current')).scenarios,clone(context.state.scenarios));
  assert.equal(context.state.unsavedScenarioChanges,false);
  assert.equal(context.notices.at(-1).outcome,'fallback');
});

test('successful database-only save is not described as unsaved', async () => {
  const context=environment();context.localStorage.setItem=()=>{throw new Error('Quota exceeded')};installPersistence(context);
  assert.equal(await context.persist(),true);
  assert.equal(context.state.unsavedScenarioChanges,false);
  assert.equal(context.notices.at(-1).outcome,'saved');
  assert.match(context.notices.at(-1).detail,/Saved in the on-device database/);
});

test('an earlier acknowledgement cannot clear newer pending work', async () => {
  const completions=[];
  const context=environment({durableWrite:()=>new Promise(resolve=>completions.push(resolve))});installPersistence(context);
  const first=context.persist();await tick();
  context.state.scenarios[0].steps[1].text='Second revision';const second=context.persist();await tick();
  completions[0]();await first;
  assert.equal(context.state.unsavedScenarioChanges,true);
  completions[1]();await second;
  assert.equal(context.state.unsavedScenarioChanges,false);
});

test('recovery archives the original durable record before replacement', async () => {
  const writes=[],original={version:2,scenarios:[null]};
  const context=environment({durableRecoveryRecord:original,durableWrite:(key,value)=>{writes.push({key,value:clone(value)});return Promise.resolve()}});installPersistence(context);
  assert.equal(await context.persist(),true);
  assert.match(writes[0].key,/^recovery-/);assert.deepEqual(writes[0].value,original);assert.equal(writes[1].key,'current');
});

test('restore-point retention is per scenario and preserves legacy history storage', async () => {
  const context=environment();installPersistence(context);
  vm.runInContext(fn('retainedScenarioHistory')+fn('persistScenarioHistory'),context);
  context.localStorage.setItem('two-way-studio-version-history-v1','legacy history');
  context.scenarioHistory=[1,2,3,4].map(id=>({id:`A${id}`,scenarioId:'A'})).concat([{id:'B1',scenarioId:'B'}]);
  assert.equal(await context.persistScenarioHistory(),true);
  assert.deepEqual(Array.from(context.scenarioHistory,item=>item.id),['A1','A2','A3','B1']);
  assert.equal(context.localStorage.getItem('two-way-studio-version-history-v1'),'legacy history');
});

test('hydration chooses a newer cache over an older durable record', async () => {
  const cached=scenario('cached'),old=scenario('old');
  const context=environment({saved:JSON.stringify({savedAt:200,activeId:'cached',scenarios:[cached]}),storedScenarios:[cached],durableRead:key=>Promise.resolve(key==='current'?{savedAt:100,activeId:'old',scenarios:[old]}:null)});
  context.state.scenarios=[cached];context.state.activeId='cached';installJourneys(context);
  vm.runInContext(fn('hydrateDurableScenarioState'),context);await context.hydrateDurableScenarioState();
  assert.equal(context.state.activeId,'cached');assert.equal(context.state.scenarios[0].id,'cached');
});

test('late hydration does not replace work changed while reading', async () => {
  let release;
  const context=environment({durableRead:key=>key==='current'?new Promise(resolve=>release=resolve):Promise.resolve(null)});installJourneys(context);
  vm.runInContext(fn('hydrateDurableScenarioState'),context);const pending=context.hydrateDurableScenarioState();
  context.state.scenarios.push(scenario('shared'));context.state.activeId='shared';
  release({savedAt:100,activeId:'old',scenarios:[scenario('old')]});await pending;
  assert.equal(context.state.activeId,'shared');assert.equal(context.state.scenarios.length,2);
});

test('shared-link startup saves the fully normalized rendered revision after delayed hydration', async () => {
  let releaseRead;const writes=[],shared=scenario('Shared import'),existing=scenario('existing');
  const context=environment({
    saved:JSON.stringify({version:2,savedAt:200,scenarios:[existing]}),storedScenarios:[existing],
    durableRead:key=>key==='current'?new Promise(resolve=>releaseRead=resolve):Promise.resolve(null),
    durableWrite:(key,value)=>{writes.push({key,value:clone(value)});return Promise.resolve()},
    location:{hash:`#scenario=${encodeURIComponent(Buffer.from(JSON.stringify(shared)).toString('base64'))}`,pathname:'/',search:''},
    history:{replaceState(){}},URLSearchParams,atob,escape,sessionStorage:storage(),
    supportedScenarioChannels:new Set(['sms','rcs','whatsapp','email']),scenarioMigrationDirty:false,
    builderDuringStartup:null,bootstrapRendered:false,bootstrapPhase:'startup',bootstrapRecoveryFlag:'recovery',releaseStandaloneExportBoot(){},
    showBootstrapFailure(error){throw new Error(error.message)},reportBootstrapDiagnostic(){},
  });
  context.state.scenarios=[clone(existing)];context.state.activeId='existing';
  installJourneys(context);installPersistence(context);
  vm.runInContext(['normalizeScenario','ensureJourneyState','hydrateDurableScenarioState','loadSharedScenario','migrateRcsCardActions'].map(fn).join('\n'),context);
  context.renderAll=()=>context.ensureJourneyState();
  vm.runInContext(source('window.__twoWayScenarioInitialization=(async()=>{'),context);
  assert.equal(context.state.scenarios.length,1,'share import waits behind hydration');
  releaseRead({version:2,savedAt:300,activeId:'existing',scenarios:[existing]});
  await context.window.__twoWayScenarioInitialization;await tick();
  assert.equal(context.bootstrapRendered,true);assert.equal(context.state.scenarios.length,2);assert.equal(context.state.scenarios[0].id,'existing');
  assert.match(context.active().name,/Shared import.*shared/);assert.equal(context.active().scenarioMode,'single');
  const stored=writes.filter(write=>write.key==='current').at(-1).value;
  assert.deepEqual(stored.scenarios,clone(context.state.scenarios),'durable acknowledgement must describe the post-render revision');
  assert.deepEqual(JSON.parse(context.localStorage.getItem('current')).scenarios,stored.scenarios);
  assert.equal(context.state.unsavedScenarioChanges,false);assert.equal(context.notices.at(-1).outcome,'saved');
});

test('recovery bypasses durable state and retains it for preservation', async () => {
  const original={version:2,scenarios:[scenario('old')]};
  const context=environment({bootstrapRecoveryWasUsed:true,durableRead:key=>Promise.resolve(key==='current'?original:null)});installJourneys(context);
  vm.runInContext(fn('hydrateDurableScenarioState'),context);await context.hydrateDurableScenarioState();
  assert.equal(context.state.scenarios[0].id,'A');assert.equal(context.durableRecoveryRecord,original);
});

test('database-open timeout releases initialization and allows a later retry', async () => {
  const timers=[];let opens=0;
  const context=environment({window:{indexedDB:{}},indexedDB:{open(){opens++;return {}}},durableScenarioDatabase:'test',durableScenarioStore:'state',durableScenarioDbPromise:null,setTimeout:callback=>{timers.push(callback);return timers.length},clearTimeout(){}});
  vm.runInContext(fn('openDurableScenarioStore'),context);
  const first=context.openDurableScenarioStore();timers.shift()();await assert.rejects(first,/did not respond/);
  const second=context.openDurableScenarioStore();timers.shift()();await assert.rejects(second,/did not respond/);assert.equal(opens,2);
});

test('reset cancels every delayed company reply and clears focused-step preview', () => {
  const timers=new Map();let next=0;
  const context=environment({setTimeout:callback=>{timers.set(++next,callback);return next},clearTimeout:id=>timers.delete(id)});
  vm.runInContext(['responseSetAt','hasTerms','matchesTerms','chooseResponse','scheduleRuntimeDelivery','resetRuntime','advance','submit'].map(fn).join('\n'),context);
  context.resetRuntime();context.submit('Hi');const callback=[...timers.values()][0];
  context.state.scenarios.push(scenario('B'));context.state.activeId='B';context.state.livePreviewStepId='A-reply';context.resetRuntime();
  callback();assert.equal(context.state.visible.length,0);assert.equal(timers.size,0);assert.equal(context.state.livePreviewStepId,null);
});

test('carousel pointer gestures move from second to first card and back', () => {
  const handlers={},carousel={dataset:{rcsCarousel:'carousel'},addEventListener:(type,handler)=>handlers[type]=handler,setPointerCapture(){}};
  const context=environment({document:{querySelectorAll:()=>[carousel]},wirePhone(){}});
  context.state.scenarios[0].steps=[{id:'carousel',kind:'carousel',cards:[{id:'first'},{id:'second'}]}];context.state.carouselIndexes={carousel:1};
  vm.runInContext(fn('ensureCarouselCards')+fn('rcsCarouselMove')+source('const wirePhoneWithRcsCarouselSwipe='),context);context.wirePhone();
  handlers.pointerdown({clientX:25,pointerId:1,target:{closest:()=>null}});handlers.pointerup({clientX:70});
  assert.equal(context.state.carouselIndexes.carousel,0,'rightward swipe returns to the first card');
  handlers.pointerdown({clientX:70,pointerId:2,target:{closest:()=>null}});handlers.pointerup({clientX:25});
  assert.equal(context.state.carouselIndexes.carousel,1,'leftward swipe advances to the second card');
});

test('scroll-selected workspace navigation retains an explicit aria-current step token', () => {
  const modern=fs.readFileSync(path.join(root,'assets/v2-modern.js'),'utf8'),update=modern.match(/const updateActiveSection = \(\) => \{[\s\S]*?\n    \};/)[0];
  let positions=[200,12,500];
  const sections=positions.map((_,index)=>({hidden:false,getBoundingClientRect:()=>({top:positions[index]})}));
  const buttons=positions.map((_,index)=>({dataset:{v2Section:String(index)},attributes:new Map(),setAttribute(name,value){this.attributes.set(name,value)},removeAttribute(name){this.attributes.delete(name)},toggleAttribute(name,enabled){enabled?this.attributes.set(name,''):this.attributes.delete(name)}}));
  const context=vm.createContext({sections,nav:{querySelectorAll:()=>buttons},builder:{getBoundingClientRect:()=>({top:0})}});
  vm.runInContext(update+'this.updateActiveSection=updateActiveSection;',context);context.updateActiveSection();
  assert.equal(buttons[1].attributes.get('aria-current'),'step');assert.equal(buttons[0].attributes.has('aria-current'),false);
  positions=[2,200,500];context.updateActiveSection();assert.equal(buttons[0].attributes.get('aria-current'),'step');assert.equal(buttons[1].attributes.has('aria-current'),false);
});

test('image completions retain their initiating scenario and removal cancels older operations', () => {
  const context=environment();installJourneys(context);
  vm.runInContext(['normalizeImageSource','imageAssetTarget','beginImageAssetOperation','resetRcsImageCrop','setImageAssetValue'].map(fn).join('\n'),context);
  const control={dataset:{imageScope:'scenario',imageKey:'avatar'}};
  const pending=context.beginImageAssetOperation(control);context.state.scenarios.push(scenario('B'));context.state.activeId='B';
  assert.equal(context.setImageAssetValue(control,'data:image/png;base64,A',pending),true);
  assert.equal(context.state.scenarios[0].avatar,'data:image/png;base64,A');assert.equal(context.state.scenarios[1].avatar,undefined);
  const older=context.beginImageAssetOperation(control);context.setImageAssetValue(control,'');
  assert.equal(context.setImageAssetValue(control,'obsolete',older),false);
  assert.equal(context.state.scenarios[1].avatarDismissed,true);
  const logo={dataset:{imageScope:'scenario',imageKey:'emailLogo'}};context.setImageAssetValue(logo,'');
  assert.equal(context.state.scenarios[1].emailLogoDismissed,true);
});

test('pending images update only the original channel variant', () => {
  const context=environment();installJourneys(context);
  vm.runInContext(['normalizeImageSource','imageAssetTarget','beginImageAssetOperation','resetRcsImageCrop','setImageAssetValue'].map(fn).join('\n'),context);
  const a=context.state.scenarios[0];a.scenarioMode='multi';a.variants={sms:{channel:'sms',steps:clone(a.steps)},email:{channel:'email',steps:clone(a.steps)}};
  const control={dataset:{imageScope:'scenario',imageKey:'avatar'}},pending=context.beginImageAssetOperation(control);
  context.projectJourneyVariant(a,'email');context.setImageAssetValue(control,'SMS image',pending);
  assert.equal(a.variants.sms.avatar,'SMS image');assert.equal(a.avatar,undefined);assert.equal(a.variants.email.avatar,undefined);
});

function rcsActionEnvironment(carousel=false){
  const urls=[],readers=[],elements={};
  const context=environment({document:{querySelectorAll:selector=>elements[selector]||[]},loadImageFromUrl:()=>new Promise(resolve=>urls.push(resolve)),FileReader:class{constructor(){readers.push(this)}readAsDataURL(){}},renderAll(){},renderPreview(){}});
  installJourneys(context);
  const action={id:'action',text:'Option',emoji:'',image:''},owner={id:'card-step',author:'brand',kind:carousel?'carousel':'rich',text:'Choose'};
  if(carousel)owner.cards=[{id:'card',title:'Card',replyActions:[action]},{id:'other-card',title:'Other',replyActions:[{...action}]}];else owner.replyActions=[action];
  const a=context.state.scenarios[0];Object.assign(a,{scenarioMode:'multi',channel:'rcs',steps:[owner],variants:{email:{channel:'email',steps:[{id:'email',author:'brand',kind:'text',text:'Email'}]}}});
  context.captureJourneyVariant(a);
  const editor={dataset:{rcsActionOwner:owner.id,...(carousel?{rcsActionCard:'card'}:{})}},input={value:'https://example.test/image.png'},row={querySelector:()=>input};
  const closest=selector=>selector==='.rcs-card-actions-editor'?editor:row;
  const url={dataset:{rcsActionUrlApply:'action'},closest},upload={dataset:{rcsActionFile:'action'},closest,files:[{}]},remove={dataset:{rcsActionRemove:'action'},closest};
  elements['[data-rcs-action-url-apply]']=[url];elements['[data-rcs-action-file]']=[upload];elements['[data-rcs-action-remove]']=[remove];
  vm.runInContext(source('const rcsActionTextList=')+['followingCustomerStep','normalizeRcsActions','ensureCarouselCards','actionCollection','rcsActionTarget','rcsActionImageControl','normalizeImageSource','imageAssetTarget','beginImageAssetOperation','resetRcsImageCrop','setImageAssetValue','bindRcsActionControls'].map(fn).join('\n'),context);
  context.bindRcsActionControls();
  const currentAction=flow=>carousel?flow.steps[0].cards[0].replyActions[0]:flow.steps[0].replyActions[0];
  return {context,a,url,upload,remove,urls,readers,currentAction};
}

test('RCS action URL and FileReader completions follow stable scenario, channel, step, card and action IDs', async () => {
  for(const carousel of [false,true]){
    const {context,a,url,upload,urls,readers,currentAction}=rcsActionEnvironment(carousel);
    const urlPending=url.onclick(),detached=currentAction(a);context.captureJourneyVariant(a);context.projectJourneyVariant(a,'email');
    context.state.scenarios.push(scenario('B'));context.state.activeId='B';urls.shift()('data:image/png;base64,url');await urlPending;
    assert.equal(currentAction(a.variants.rcs).image,'data:image/png;base64,url');assert.equal(detached.image,'');assert.equal(a.channel,'email');assert.equal(context.state.scenarios[1].avatar,undefined);
    if(carousel)assert.equal(a.variants.rcs.steps[0].cards[1].replyActions[0].image,'','a duplicate action ID on another card is not targeted');
    context.state.activeId='A';context.projectJourneyVariant(a,'rcs');upload.onchange();context.captureJourneyVariant(a);context.projectJourneyVariant(a,'email');
    readers[0].result='data:image/png;base64,file';readers[0].onload();assert.equal(currentAction(a.variants.rcs).image,'data:image/png;base64,file');
  }
});

test('RCS reply image replacements are last-started-wins and action removal cancels pending work', async () => {
  for(const carousel of [false,true]){
    const {context,a,url,upload,remove,urls,readers,currentAction}=rcsActionEnvironment(carousel);
    const older=url.onclick();upload.onchange();readers[0].result='data:image/png;base64,newer';readers[0].onload();urls.shift()('data:image/png;base64,old');await older;
    assert.equal(currentAction(a).image,'data:image/png;base64,newer');
    const pending=url.onclick();remove.onclick();assert.equal(currentAction(a),undefined);urls.shift()('data:image/png;base64,removed');await pending;assert.equal(currentAction(a),undefined);assert.equal(context.state.imageOperations.size,0);
    const next=rcsActionEnvironment(carousel),deleted=next.url.onclick();next.context.state.scenarios=[];next.urls.shift()('data:image/png;base64,deleted');await deleted;assert.equal(next.currentAction(next.a).image,'');
  }
});

test('invalid multi-item import leaves the workspace untouched', () => {
  const context=environment();installJourneys(context);const before=clone(context.state);
  assert.throws(()=>context.prepareScenarioImport({scenarios:[scenario('valid'),null]}),/Invalid scenario/);
  assert.deepEqual(clone(context.state),before);
  assert.throws(()=>context.prepareScenarioImport({name:'No steps'}),/Invalid conversation/);
});

test('JSON round trip retains all channel data while assigning new import IDs', () => {
  const context=environment();installJourneys(context);
  const original={id:'original',name:'Four channels',scenarioMode:'multi',channel:'rcs',variants:Object.fromEntries(['sms','rcs','whatsapp','email'].map(channel=>[channel,{...scenario(channel),channel,avatar:`${channel} avatar` }]))};
  const imported=context.prepareScenarioImport(JSON.parse(JSON.stringify(original)))[0];
  assert.notEqual(imported.id,original.id);assert.equal(imported.channel,'rcs');
  for(const channel of Object.keys(original.variants)){assert.equal(imported.variants[channel].avatar,`${channel} avatar`);assert.notEqual(imported.variants[channel].steps[0].id,original.variants[channel].steps[0].id)}
});

test('saved and shared IDs cannot introduce markup; safe IDs and flow order remain stable', () => {
  const context=environment({supportedScenarioChannels:new Set(['sms','rcs','whatsapp','email']),scenarioMigrationDirty:false});installJourneys(context);
  vm.runInContext(fn('normalizeScenario'),context);
  const hostile='opening"><img src=/missing onerror=window.__reviewMarker=true><i data-x="';
  const input=scenario('safe-scenario');input.steps[0].id=hostile;input.steps[1].cards=[{id:hostile,replyActions:[{id:hostile,text:'Safe action'}]}];
  input.variants={rcs:{channel:'rcs',steps:[{id:hostile,author:'brand',text:'Variant text',replyActions:[{id:hostile,text:'Reply'}]}]}};
  for(const normalized of [context.bootstrapScenario(input,0),context.normalizeScenario(clone(input))]){
    assert.equal(normalized.id,'safe-scenario');assert.equal(normalized.steps[1].id,'safe-scenario-reply');
    for(const id of [normalized.steps[0].id,normalized.steps[1].cards[0].id,normalized.steps[1].cards[0].replyActions[0].id,normalized.variants.rcs.steps[0].id,normalized.variants.rcs.steps[0].replyActions[0].id])assert.match(id,/^[a-zA-Z0-9_-]+$/);
    assert.equal(normalized.variants.rcs.steps[0].text,'Variant text');
    assert.equal(context.normalizeScenarioIdentifiers(normalized),normalized);
  }
  for(const reserved of ['__proto__','constructor','toString']){
    const original=scenario(reserved);original.steps[0].id=reserved;
    const normalized=context.normalizeScenarioIdentifiers(original);
    assert.notEqual(normalized.id,reserved);assert.notEqual(normalized.steps[0].id,reserved);
  }
});

test('legacy backup recovery rechecks fresh storage after its asynchronous read', async () => {
  const localStorage=storage(),sessionStorage=storage();let readRequest,reloaded=false;
  const database={close(){},transaction(){return {objectStore(){return {get(){readRequest={};return readRequest}}}}}};
  const context=environment({localStorage,sessionStorage,indexedDB:{open(){const request={result:database};queueMicrotask(()=>request.onsuccess());return request}},location:{reload(){reloaded=true}}});
  vm.runInContext(fs.readFileSync(path.join(root,'assets/v2/scenario-backup.js'),'utf8'),context);
  const recovery=context.window.TwoWayV2.createScenarioBackup({scenarioKey:'current',announce(){}})();await tick();
  const fresh=JSON.stringify({scenarios:[scenario('fresh')]});localStorage.setItem('current',fresh);
  readRequest.result={value:JSON.stringify({scenarios:[scenario('old')]})};readRequest.onsuccess();await recovery;
  assert.equal(localStorage.getItem('current'),fresh);assert.equal(reloaded,false);
});

test('bootstrap recovery retains original keys and records a quarantine copy', () => {
  const localStorage=storage(),sessionStorage=storage(),listeners={};let reloaded=false;
  for(const key of ['two-way-experience-studio-v2-scenarios','two-way-studio-v4','two-way-studio-v3'])localStorage.setItem(key,`original ${key}`);
  const context=vm.createContext({localStorage,sessionStorage,window:{addEventListener:(name,handler)=>listeners[name]=handler},document:{body:{classList:{contains:()=>false}},getElementById:()=>null},navigator:{sendBeacon:()=>true},Blob,URL,location:{href:'https://example.test/',reload(){reloaded=true}}});
  vm.runInContext(fs.readFileSync(path.join(root,'assets/v2/bootstrap-guard.js'),'utf8'),context);
  listeners.error({error:new Error('Synthetic bootstrap error')});
  assert.equal(reloaded,true);
  for(const key of ['two-way-experience-studio-v2-scenarios','two-way-studio-v4','two-way-studio-v3'])assert.equal(localStorage.getItem(key),`original ${key}`);
  assert.ok(localStorage.getItem('two-way-experience-studio-v2-quarantined-scenarios'));
});
