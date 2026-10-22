const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const test=require('node:test');
const {webcrypto}=require('node:crypto');

// Execute the actual smoke scripts with imports supplied by the harness and
// every network operation mocked. These tests cannot contact a live provider.
async function run(name,{env={},respond}={}){
  const source=fs.readFileSync(path.join(__dirname,'..','scripts',name),'utf8').replace(/^import .*;\n/gm,'');
  const calls=[],logs=[];
  const context=vm.createContext({
    assert,process:{env},crypto:webcrypto,URL,AbortSignal,
    configModule:{aiConfig:()=>({apiKey:'synthetic-test-key',model:env.GEMINI_MODEL||'gemini-3.5-flash',timeoutMs:20000,maxAttempts:2})},
    console:{log:value=>logs.push(value)},setTimeout:callback=>setTimeout(callback,0),
    spawn(){throw new Error('Local process launch forbidden in smoke unit tests');},fileURLToPath(){throw new Error('Unexpected local launch');},once(){throw new Error('Unexpected process wait');},
    fetch:async(url,options={})=>{
      const call={url:String(url),options};calls.push(call);
      if(!respond)throw new Error('Unexpected fetch');
      const result=respond(call,calls);
      return {ok:result.status===undefined||result.status===200,status:result.status||200,json:async()=>vm.runInContext('JSON.parse('+JSON.stringify(JSON.stringify(result.body))+')',context),text:async()=>result.text||''};
    },
  });
  const code=source.replace(/import\.meta\.url/g,"'file:///synthetic/scripts/ai-app-smoke.mjs'");
  try {await vm.runInContext('(async()=>{'+code+'})()',context);return {calls,logs};}
  catch(error){error.calls=calls;throw error;}
}
const smokeEnv={ALLOW_LIVE_AI:'1',BASE_URL:'https://staging.example.test',EXPECTED_ENV:'staging',EXPECTED_VERSION:'synthetic-release'};
const health={ok:true,version:'synthetic-release',environment:'staging',aiConfigured:true,ai:{configured:true,model:'gemini-3.5-flash',status:'unverified'}};

test('live smoke entry points require explicit authorization before any request',async()=>{
  for(const file of ['gemini-provider-smoke.mjs','ai-app-smoke.mjs'])await assert.rejects(run(file),error=>/ALLOW_LIVE_AI/.test(error.message)&&error.calls.length===0);
});
test('provider smoke uses shared model and exactly one request with genuine JSON validation',async()=>{
  const reply={body:{candidates:[{finishReason:'STOP',content:{parts:[{text:'{"ok":true}'}]}}]}};
  const result=await run('gemini-provider-smoke.mjs',{env:{ALLOW_LIVE_AI:'1',GEMINI_MODEL:'synthetic-configured-model'},respond:()=>reply});
  assert.equal(result.calls.length,1);assert.match(result.calls[0].url,/synthetic-configured-model:generateContent$/);assert.doesNotMatch(result.calls[0].url,/key=/);
  assert.equal(JSON.parse(result.logs[0]).providerRequests,1);
  await assert.rejects(run('gemini-provider-smoke.mjs',{env:{ALLOW_LIVE_AI:'1'},respond:()=>({body:{candidates:[{finishReason:'STOP',content:{parts:[{text:'{}'}]}}]}})}),error=>error.calls.length===1&&/requested JSON/.test(error.message));
});
test('hosted smoke checks explicit release/environment without calling the provider',async()=>{
  await assert.rejects(run('smoke-hosted.mjs',{env:{BASE_URL:smokeEnv.BASE_URL}}),error=>/EXPECTED_VERSION/.test(error.message)&&error.calls.length===0);
  const result=await run('smoke-hosted.mjs',{env:smokeEnv,respond:call=>call.url.endsWith('/api/health')?{body:health}:{text:'<title>Two-Way Experience Studio</title>'}});
  assert.equal(result.calls.length,2);assert.equal(JSON.parse(result.logs[0]).providerRequests,0);assert.equal(JSON.parse(result.logs[0]).version,'synthetic-release');
});
test('application smoke is staging-only and sends exactly two jobs with bounded attempts and optional review reports',async()=>{
  await assert.rejects(run('ai-app-smoke.mjs',{env:{...smokeEnv,EXPECTED_ENV:'production'}}),error=>/staging only/.test(error.message)&&error.calls.length===0);
  const jobs=[];
  const result=await run('ai-app-smoke.mjs',{env:{...smokeEnv,SMOKE_REPORT:'1'},respond:call=>{
    if(call.url.endsWith('/api/health'))return {body:health};
    if(call.options.method==='POST'){
      const body=JSON.parse(call.options.body),id='00000000-0000-0000-0000-'+String(jobs.length+1).padStart(12,'0');jobs.push({body,id});
      return {status:202,body:{id,poll:'/api/scenario-jobs/'+id}};
    }
    const {body}=jobs.at(-1),first=body.controls.initialSender;
    const turns=Array.from({length:4},(_,index)=>({speaker:index===0?first:index%2?'customer':'company',text:body.persona.customerName+' and '+body.persona.representativeName+' discuss next steps.',presentation:{kind:'card',cards:[{title:'Synthetic invitation'}]}}));
    return {body:{status:'completed',durationMs:5,draft:{schemaVersion:2,initialSender:first,persona:body.persona,scenarios:Object.fromEntries(body.channels.map(channel=>[channel,{sender:body.companyName,subject:'Synthetic invitation',turns}]))},source:{mode:'provider',fallbackReason:null,requestedChannels:body.channels,grounding:{status:'unverified'},provider:{attempts:2}},requirements:{complete:true,scope:'structure-and-explicit-constraints',channels:Object.fromEntries(body.channels.map(channel=>[channel,{status:'passed'}]))}}};
  }});
  assert.equal(jobs.length,2);assert.equal(result.calls.filter(call=>call.options.method==='POST').length,2);
  const logs=result.logs.map(JSON.parse);assert.equal(logs.filter(log=>log.event==='synthetic_draft_review').length,2);
  assert.equal(logs.at(-1).maxProviderRequests,4);assert.equal(logs.at(-1).providerRequests,4);
  assert.doesNotMatch(result.logs.join('\n'),/synthetic-test-key|x-goog-api-key/);
});
test('application smoke rejects a personal name used as the company sender before another job',async()=>{
  let body;
  await assert.rejects(run('ai-app-smoke.mjs',{env:smokeEnv,respond:call=>{
    if(call.url.endsWith('/api/health'))return {body:health};
    if(call.options.method==='POST'){body=JSON.parse(call.options.body);return {status:202,body:{poll:'/api/scenario-jobs/00000000-0000-0000-0000-000000000001'}};}
    const turns=Array.from({length:4},(_,index)=>({speaker:index%2?'customer':'company',text:body.persona.customerName+' and '+body.persona.representativeName}));
    return {body:{status:'completed',draft:{schemaVersion:2,initialSender:'company',scenarios:Object.fromEntries(body.channels.map(channel=>[channel,{sender:body.persona.customerName,turns}]))},source:{mode:'provider',fallbackReason:null,requestedChannels:body.channels,grounding:{status:'unverified'},provider:{attempts:1}},requirements:{complete:true,scope:'structure-and-explicit-constraints',channels:Object.fromEntries(body.channels.map(channel=>[channel,{status:'passed'}]))}}};
  }}),error=>/sender must remain the company identity/.test(error.message)&&error.calls.filter(call=>call.options.method==='POST').length===1);
});
