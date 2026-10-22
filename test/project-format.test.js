const test = require('node:test');
const assert = require('node:assert/strict');
const format = require('../assets/project-format');
const image = 'data:image/png;base64,AAAA';
function state() {
  const variant = channel => ({channel,avatar:image,emailLogo:image,steps:[{id:channel,author:'brand',kind:'carousel',cards:[{id:'card',image,replyActions:[{id:'reply',image}]}]}]});
  return {activeId:'one',previewScale:'.85',setupMode:'manual',scenarios:[{id:'one',name:'Example',scenarioMode:'multi',...variant('rcs'),variants:{rcs:variant('rcs'),email:variant('email')}}],aiSetup:{companyName:'Example',website:'https://example.test',useCase:'Welcome',channels:{sms:true},draft:null,loading:true,requestId:'transient'}};
}
test('cloud format retains every channel and nested uploaded asset without live job state', () => {
  const source = state(), payload = format.build(source);
  assert.deepEqual(payload.workspace.scenarios,source.scenarios);
  assert.deepEqual(payload.workspace.settings,{previewScale:'.85',setupMode:'manual'});
  assert.equal(payload.workspace.aiSetup.requestId,undefined);
  assert.equal(payload.workspace.aiSetup.loading,undefined);
  payload.workspace.scenarios[0].variants.rcs.avatar = 'changed';
  assert.equal(source.scenarios[0].variants.rcs.avatar,image);
});
test('invalid projects are rejected atomically, including future versions and malformed review arrays', () => {
  for (const mutate of [p=>p.version++,p=>p.workspace.activeId='missing',p=>p.workspace.scenarios.push(null),p=>p.workspace.scenarios.push(p.workspace.scenarios[0]),p=>p.workspace.scenarios[0].variants.email.steps=null,p=>p.workspace.aiSetup.source={imageCandidates:{}},p=>p.workspace.aiSetup.draft={}]) {
    const payload = format.build(state()); mutate(payload); assert.throws(()=>format.validate(payload));
  }
});
test('cloud preflight measures UTF-8 bytes and never strips images to fit', () => {
  const payload = format.build(state()); payload.workspace.aiSetup.useCase = 'é'.repeat(10 * 1024 * 1024);
  assert.throws(()=>format.assertSize(payload),/19 MiB/);
  assert.equal(payload.workspace.scenarios[0].avatar,image);
});
test('canonical comparison ignores JSON key order but retains exact content', () => {
  assert.equal(format.canonical({b:2,a:{d:4,c:3}}),format.canonical({a:{c:3,d:4},b:2}));
  assert.notEqual(format.canonical({text:'new'}),format.canonical({text:'old'}));
});
