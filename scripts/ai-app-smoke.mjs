import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import configModule from '../server/ai-config.cjs';

assert.equal(process.env.ALLOW_LIVE_AI,'1','Set ALLOW_LIVE_AI=1 to authorize two synthetic generation jobs (at most four provider requests).');
const config=configModule.aiConfig(),remote=Boolean(process.env.BASE_URL);
const expectedVersion=process.env.EXPECTED_VERSION || (remote ? '' : '2.0.0-smoke');
const expectedEnvironment=process.env.EXPECTED_ENV || (remote ? '' : 'smoke');
assert.ok(expectedVersion&&expectedEnvironment,'Remote smoke requires EXPECTED_VERSION and EXPECTED_ENV.');
if(remote)assert.equal(expectedEnvironment,'staging','Live application smoke may target staging only; it does not authorize production generation.');
if(!remote)assert.ok(config.apiKey,'GEMINI_API_KEY is required for a local live smoke.');
const base=new URL(process.env.BASE_URL || 'http://127.0.0.1:3194');
assert.ok(['https:','http:'].includes(base.protocol)&&!base.username&&!base.password,'Use an HTTP(S) URL without embedded credentials.');
const server=remote?null:spawn(process.execPath,[fileURLToPath(new URL('../server.js',import.meta.url))],{env:{...process.env,PORT:'3194',APP_ENV:expectedEnvironment,APP_VERSION:expectedVersion},stdio:['ignore','ignore','ignore']});
const wait=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
const fetchBounded=(url,options={})=>fetch(url,{...options,signal:AbortSignal.timeout(10000)});
async function health(){
  for(let attempt=0;attempt<(remote?1:50);attempt++){
    try {const response=await fetchBounded(new URL('/api/health',base));if(response.ok)return response.json();} catch{}
    if(!remote)await wait(150);
  }
  throw new Error('Smoke service did not become healthy. No generation request was made.');
}
const samples=[
  {label:'company-first-four-channels',channels:['sms','rcs','whatsapp','email'],persona:{customerName:'Avery',representativeName:'Jordan',representativeRole:'sales representative'},controls:{initialSender:'company',expectedMessageCount:4},useCase:'Create a fictional invitation demonstration. Address Avery by name; Avery asks for details; sales representative Jordan joins with next steps. Use concise SMS, an RCS rich card, conversational WhatsApp, and an email with a relevant subject and body. Use only the supplied website for optional links. No invented event dates, prices, promises, contact details or named offers.'},
  {label:'customer-first-email',channels:['email'],persona:{customerName:'Morgan',representativeName:'Riley',representativeRole:'sales representative'},controls:{initialSender:'customer',expectedMessageCount:4},useCase:'Create a fictional email demonstration. Morgan introduces themselves and asks Example Company for information. The company acknowledges Morgan and connects them with sales representative Riley for next steps in this thread. Include both names naturally. Use plain text only; no invented dates, prices, promises, contact details or offers.'},
];
async function generate(sample){
  const id=crypto.randomUUID(),body={companyName:'Example Company',website:'https://example.com',channels:sample.channels,persona:sample.persona,controls:sample.controls,useCase:sample.useCase};
  const response=await fetchBounded(new URL('/api/scenario-jobs',base),{method:'POST',headers:{'Content-Type':'application/json','X-Request-Id':id,'X-Idempotency-Key':id},body:JSON.stringify(body)});
  assert.equal(response.status,202,'Synthetic job must be admitted');
  const created=await response.json();assert.match(created.poll,/^\/api\/scenario-jobs\/[0-9a-f-]{36}$/i);
  for(let attempt=0;attempt<70;attempt++){
    await wait(900);
    const poll=await fetchBounded(new URL(created.poll,base));assert.equal(poll.status,200);
    const job=await poll.json();if(job.status==='failed')throw new Error('Synthetic job failed: '+job.error+'; '+JSON.stringify(job.issues||[]));
    if(job.status!=='completed')continue;
    assert.equal(job.draft?.schemaVersion,2);assert.equal(job.source?.mode,'provider','A fallback does not pass live-provider evaluation');assert.equal(job.source?.fallbackReason,null);
    assert.equal(job.requirements?.complete,true);assert.equal(job.requirements?.scope,'structure-and-explicit-constraints');
    assert.equal(job.source?.grounding?.status,'unverified','Smoke must not confuse structural validity with fact checking');
    assert.deepEqual(job.source.requestedChannels,sample.channels);assert.equal(job.draft.initialSender,sample.controls.initialSender);
    assert.ok(job.source.provider.attempts>=1&&job.source.provider.attempts<=config.maxAttempts);
    for(const channel of sample.channels){
      const scenario=job.draft.scenarios[channel];assert.equal(scenario.turns.length,4);assert.equal(scenario.turns[0].speaker,sample.controls.initialSender);assert.equal(job.requirements.channels[channel].status,'passed');
      const transcript=scenario.turns.map(turn=>turn.text).join('\n');for(const name of [sample.persona.customerName,sample.persona.representativeName])assert.ok(transcript.includes(name),channel+' must retain '+name);
      if(channel==='email')assert.ok(scenario.subject.trim());
      if(channel==='rcs')assert.ok(scenario.turns.some(turn=>['card','carousel'].includes(turn.presentation?.kind)),'RCS must retain its requested rich presentation');
    }
    if(process.env.SMOKE_REPORT==='1')console.log(JSON.stringify({event:'synthetic_draft_review',label:sample.label,persona:job.draft.persona,scenarios:job.draft.scenarios,source:job.source,requirements:job.requirements}));
    return {label:sample.label,durationMs:job.durationMs,providerAttempts:job.source.provider.attempts};
  }
  throw new Error('Synthetic job did not finish within the bounded polling window; no replacement job was submitted.');
}
try{
  const status=await health();assert.equal(status.ok,true);assert.equal(status.version,expectedVersion);assert.equal(status.environment,expectedEnvironment);assert.equal(status.aiConfigured,true);
  const expectedModel=process.env.EXPECTED_MODEL || process.env.GEMINI_MODEL || (!remote?config.model:'');if(expectedModel)assert.equal(status.ai?.model,expectedModel);
  const results=[];for(const sample of samples)results.push(await generate(sample));
  console.log(JSON.stringify({event:'ai_application_smoke_passed',generationJobs:2,maxProviderRequests:2*config.maxAttempts,providerRequests:results.reduce((sum,result)=>sum+result.providerAttempts,0),model:status.ai.model,results}));
}finally{
  if(server){server.kill('SIGTERM');await Promise.race([once(server,'exit'),wait(1000)]);}
}
