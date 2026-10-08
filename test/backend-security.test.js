const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const { PassThrough, Readable } = require('node:stream');
const test = require('node:test');
const { privateIp, clientIp, publicFilePath, safeUrl, createRemoteFetcher, svgContentSecurityPolicy } = require('../server/security.cjs');

const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'server.js'),'utf8');
const requestBody={companyName:'Example',website:'https://example.com',useCase:'A synthetic test conversation.',channels:['sms']};
const tick=() => new Promise(resolve => setImmediate(resolve));

function loadServer({env={},fileSystem,mockGeneration=true}={}) {
  let handler;
  const requireFromServer=createRequire(path.join(root,'server.js'));
  const context=vm.createContext({
    require:name => name === 'node:http' ? {createServer(fn) {handler=fn;return {listen(){}};}} : name === 'node:fs' && fileSystem ? fileSystem : requireFromServer(name),
    __dirname:root,process:{env:{APP_ENV:'test',GEMINI_API_KEY:'',...env}},console:{log(){},error(){},warn(){}},
    Buffer,URL,AbortController,setTimeout,clearTimeout,queueMicrotask,
    fetch:() => {throw new Error('Unexpected network access');},
    generationGate:async () => ({draft:{},source:{}})
  });
  vm.runInContext(`${source}\n${mockGeneration?'generateScenarioDraft=async (body,requestId)=>generationGate(body,requestId);':''}this.api={startGenerationJob,pruneGenerationJobs,generationJobs,idempotencyJobs,withinRateLimit,handleApi,activeCount:()=>activeGenerations};`,context);
  return {context,api:context.api,handler};
}

async function invoke(handler,{url='/',method='GET',headers={},body,ip='127.0.0.1'}={}) {
  const request=Readable.from(body===undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(request,{url,method,headers:{host:'localhost',...headers},socket:{remoteAddress:ip}});
  const response=new PassThrough();let status,returnedHeaders,content='';
  response.writeHead=(code,value={})=>{status=code;returnedHeaders=value;response.headersSent=true;};
  response.on('data',chunk=>{content+=chunk;});
  const finished=new Promise((resolve,reject)=>{response.once('finish',resolve);response.once('error',reject);});
  await handler(request,response);
  await finished;
  return {status,headers:returnedHeaders,content,json:()=>JSON.parse(content)};
}

function transport(responses,observed=[]) {
  return (url,options,callback) => {
    const request=new EventEmitter();
    request.end=()=>queueMicrotask(()=> {
      const record={url:String(url),options};observed.push(record);
      options.lookup(url.hostname,{all:true},(error,addresses)=>{if(error)throw error;record.addresses=addresses;});
      const current=responses.shift();
      if (!current) return;
      const upstream=new PassThrough();
      upstream.statusCode=current.status || 200;upstream.headers=current.headers || {'content-type':'text/html'};
      callback(upstream);
      if (!upstream.destroyed && !current.hang) upstream.end(Buffer.from(current.body || 'ok'));
    });
    options.signal.addEventListener('abort',()=>request.emit('error',options.signal.reason),{once:true});
    return request;
  };
}

test('nonpublic IPv4, mapped IPv6 and special IPv6 ranges are denied',()=>{
  for (const address of ['0.0.0.0','10.0.0.1','100.64.0.1','127.0.0.1','169.254.169.254','172.31.1.2','192.168.1.1','192.0.2.1','198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','::','::1','::ffff:127.0.0.1','::ffff:7f00:1','::ffff:10.0.0.1','fe80::1','febf::1','fc00::1','fd00::1','ff02::1','64:ff9b::7f00:1','2001:db8::1','2002:7f00:1::','3fff:fff::1','invalid']) {
    assert.equal(privateIp(address),true,address);
  }
  for (const address of ['8.8.8.8','1.1.1.1','93.184.216.34','2606:4700:4700::1111','2001:4860:4860::8888','::ffff:8.8.8.8']) assert.equal(privateIp(address),false,address);
});

test('DNS validation rejects a mixed public/private result and invalid destinations',async()=>{
  const lookup=async()=>[{address:'93.184.216.34',family:4},{address:'::ffff:127.0.0.1',family:6}];
  await assert.rejects(safeUrl('https://example.com',{lookup}),{code:'blocked_host'});
  for(const url of ['http://127.0.0.1','http://2130706433','http://0177.0.0.1','http://[::ffff:127.0.0.1]','http://localhost.','http://sub.localhost','https://user:pass@example.com','https://example.com:8080','file:///tmp/test']) {
    await assert.rejects(safeUrl(url,{lookup}),error=>['blocked_host','blocked_url'].includes(error.code));
  }
});

test('outbound connection uses validated DNS address and preserves the original TLS hostname',async()=>{
  const calls=[];let lookups=0;
  const lookup=async()=>{lookups+=1;return [{address:lookups===1?'93.184.216.34':'127.0.0.1',family:4}];};
  const mock=transport([{body:'safe'}],calls);
  const fetchRemote=createRemoteFetcher({lookup,httpsRequest:mock,httpRequest:mock});
  const result=await fetchRemote('https://example.com/logo',100);
  assert.equal(result.body.toString(),'safe');
  assert.equal(lookups,1,'connection lookup must not resolve DNS a second time');
  assert.equal(calls[0].url,'https://example.com/logo','TLS still receives the real hostname');
  assert.equal(calls[0].addresses[0].address,'93.184.216.34');
  assert.equal(calls[0].options.agent,false,'no previously pooled connection may bypass validation');
});

test('dual-stack websites retain an IPv4 route on hosts without IPv6 egress',async()=>{
  const result=await safeUrl('https://example.com',{lookup:async()=>[{address:'2606:4700:4700::1111',family:6},{address:'93.184.216.34',family:4}]});
  assert.equal(result.address,'93.184.216.34');assert.equal(result.family,4);
});

test('redirect targets are validated before any second connection',async()=>{
  const calls=[];const mock=transport([{status:302,headers:{location:'http://127.0.0.1/private'}}],calls);
  const fetchRemote=createRemoteFetcher({lookup:async()=>[{address:'93.184.216.34',family:4}],httpsRequest:mock,httpRequest:mock});
  await assert.rejects(fetchRemote('https://example.com',100),{code:'blocked_host'});
  assert.equal(calls.length,1);
});

test('one outbound deadline covers stalled DNS and response bodies; slots release afterward',async()=>{
  const stalled=createRemoteFetcher({lookup:()=>new Promise(()=>{}),timeoutMs:20,maxConcurrent:1});
  const pending=stalled('https://example.com',100);
  await assert.rejects(stalled('https://example.com',100),{code:'remote_busy'});
  await assert.rejects(pending,{code:'request_timeout'});
  await assert.rejects(stalled('https://example.com',100),{code:'request_timeout'});
  const mock=transport([{hang:true}]);
  const bodyStalled=createRemoteFetcher({lookup:async()=>[{address:'93.184.216.34',family:4}],httpRequest:mock,httpsRequest:mock,timeoutMs:20});
  await assert.rejects(bodyStalled('https://example.com',100),{code:'request_timeout'});
});

test('redirects share the original timeout rather than receiving a fresh deadline',async()=>{
  const observed=[];const mock=transport([{status:302,headers:{location:'https://next.example.com'}}],observed);
  const lookup=async()=>{await new Promise(resolve=>setTimeout(resolve,20));return [{address:'93.184.216.34',family:4}];};
  const fetchRemote=createRemoteFetcher({lookup,httpsRequest:mock,httpRequest:mock,timeoutMs:30});
  await assert.rejects(fetchRemote('https://example.com',100),{code:'request_timeout'});
  assert.equal(observed.length,1);
});

test('remote content is bounded with explicit partial HTML support',async()=>{
  const mock=transport([{body:'abcdefgh'},{body:'abcdefgh'},{headers:{'content-length':'900'},body:'tiny'}]);
  const fetchRemote=createRemoteFetcher({lookup:async()=>[{address:'93.184.216.34',family:4}],httpRequest:mock,httpsRequest:mock});
  await assert.rejects(fetchRemote('https://example.com',4),{code:'too_large'});
  const partial=await fetchRemote('https://example.com',4,true);
  assert.equal(partial.body.toString(),'abcd');assert.equal(partial.partial,true);
  await assert.rejects(fetchRemote('https://example.com',4),{code:'too_large'});
});

test('forwarded client identity trusts only the appended Heroku address and ignores local spoofing',()=>{
  const request={headers:{'x-forwarded-for':'1.1.1.1, 8.8.8.8'},socket:{remoteAddress:'::ffff:127.0.0.1'}};
  assert.equal(clientIp(request),'127.0.0.1');
  assert.equal(clientIp(request,true),'8.8.8.8');
  const {api}=loadServer({env:{DYNO:'web.1'}});
  const accepted=Array.from({length:30},(_,i)=>api.withinRateLimit({headers:{'x-forwarded-for':`1.1.1.${i}, 8.8.8.8`},socket:{remoteAddress:'10.0.0.1'}}));
  assert.equal(accepted.filter(Boolean).length,12);
});

test('only builder and public assets are routable; symlinks cannot expose private files',async()=>{
  const {handler}=loadServer();
  for(const url of ['/server.js','/package.json','/.env','/.git/config','/test/backend-jobs.test.js','/server/security.cjs','/assets/.secret.js','/assets/../server.js','/assets/%2e%2e/server.js']) {
    assert.equal((await invoke(handler,{url})).status,404,url);
  }
  assert.equal((await invoke(handler)).status,200);
  assert.equal((await invoke(handler,{url:'/assets/v2-modern.js'})).status,200);
  for(const url of ['/assets/email-safety.js','/assets/export-runtime.js','/assets/vendor/purify.min.js','/assets/v2-modern.css']) {
    const asset=await invoke(handler,{url});assert.equal(asset.status,200,url);assert.equal(asset.headers['Cache-Control'],'no-cache',url);
  }
  assert.equal((await invoke(handler,{url:'/assets/gmail/gmail-logo.png'})).headers['Cache-Control'],'public, max-age=3600');
  assert.equal(publicFilePath(root,'assets/../../other.js'),null);
  const maliciousLink=loadServer({fileSystem:{...fs,realpath:(_file,callback)=>callback(null,path.join(root,'server.js'))}});
  assert.equal((await invoke(maliciousLink.handler,{url:'/assets/link.js'})).status,404);
});

test('raw SVG documents are sandboxed while retaining legitimate SVG image bytes',async()=>{
  const {context,handler}=loadServer();
  context.asset={contentType:'image/svg+xml',body:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="20" height="20" fill="blue"/><script>window.marker=true</script></svg>')};
  vm.runInContext('fetchRemote=async()=>asset;',context);
  const response=await invoke(handler,{url:'/api/asset?raw=1&url=https://example.com/logo.svg'});
  assert.equal(response.status,200);assert.equal(response.headers['Content-Type'],'image/svg+xml');
  assert.equal(response.headers['Content-Security-Policy'],svgContentSecurityPolicy);
  assert.match(response.headers['Content-Security-Policy'],/(?:^|;)\s*sandbox(?:;|$)/);
  assert.match(response.headers['Content-Security-Policy'],/script-src 'none'/);
  assert.equal(response.headers['X-Content-Type-Options'],'nosniff');
  assert.equal(response.content,context.asset.body.toString());
  context.asset.contentType='image/html';
  assert.equal((await invoke(handler,{url:'/api/asset?raw=1&url=https://example.com/fake'})).status,502);
});

test('generation admission bounds queued/running work, preserving retries and all accepted jobs',async()=>{
  const {api,context}=loadServer();const release=[];
  context.generationGate=()=>new Promise(resolve=>release.push(resolve));
  const first=api.startGenerationJob(requestBody,'r1','retry','client');
  const second=api.startGenerationJob(requestBody,'r2');
  const third=api.startGenerationJob(requestBody,'r3');
  assert.throws(()=>api.startGenerationJob(requestBody,'r4'),{code:'generation_busy'});
  assert.equal(api.startGenerationJob(requestBody,'retry','retry','client').reused,true);
  await tick();assert.equal(release.length,3);assert.equal(api.activeCount(),3);
  for(const {job} of [first,second,third]) {job.createdAt=Date.now()-60*60_000;assert.equal(job.status,'running');}
  api.pruneGenerationJobs();assert.equal(api.generationJobs.size,3);
  release.forEach(resolve=>resolve({source:{}}));await tick();
  assert.equal(api.activeCount(),0);assert.equal(first.job.status,'completed');
  api.startGenerationJob(requestBody,'after');await tick();release.at(-1)({source:{}});await tick();
});

test('idempotency binds normalized payload and requester scope',async()=>{
  const {api}=loadServer();
  const first=api.startGenerationJob(requestBody,'r1','key','client-a');
  const reused=api.startGenerationJob({...requestBody,website:'example.com'},'r2','key','client-a');
  assert.equal(first.job.id,reused.job.id);
  assert.throws(()=>api.startGenerationJob({...requestBody,useCase:'A different request.'},'r3','key','client-a'),{code:'idempotency_conflict'});
  assert.notEqual(api.startGenerationJob(requestBody,'r4','key','client-b').job.id,first.job.id);
  await tick();
});

test('completed retention stays bounded, protects active records and expires on polling',async()=>{
  const {api,context,handler}=loadServer();let finish;
  context.generationGate=()=>new Promise(resolve=>{finish=resolve;});
  const {job}=api.startGenerationJob(requestBody,'active');await tick();
  for(let i=0;i<119;i++) api.generationJobs.set(`completed-${i}`,{id:`completed-${i}`,status:'completed',completedAt:Date.now(),createdAt:Date.now()});
  const second=api.startGenerationJob(requestBody,'next');
  assert.equal(api.generationJobs.size,120);assert.equal(api.generationJobs.has(job.id),true);assert.equal(api.generationJobs.has(second.job.id),true);
  finish({source:{}});await tick();
  job.completedAt=Date.now()-16*60_000;
  assert.equal((await invoke(handler,{url:`/api/scenario-jobs/${job.id}`})).status,404);
  finish({source:{}});await tick();
});

test('legacy generation shares the job concurrency cap and reports retry guidance',async()=>{
  const {api,context,handler}=loadServer();const release=[];
  context.generationGate=()=>new Promise(resolve=>release.push(resolve));
  for(let i=0;i<3;i++)api.startGenerationJob(requestBody,`r${i}`);
  const response=await invoke(handler,{method:'POST',url:'/api/scenario-draft',body:requestBody});
  assert.equal(response.status,503);assert.equal(response.json().error,'generation_busy');assert.equal(response.headers['Retry-After'],'5');
  release.forEach(resolve=>resolve({source:{}}));await tick();assert.equal(api.activeCount(),0);
});

test('valid generation still completes through the API and preserves discovered logo candidates',async()=>{
  const {context,handler}=loadServer({mockGeneration:false,env:{GEMINI_API_KEY:'offline-test-key'}});
  const providerDraft={schemaVersion:2,companyName:'Example',initialSender:'company',logoUrl:'https://example.com/logo.svg',heroImageUrl:'https://example.com/hero.png',scenarios:{sms:{title:'Welcome',initialMessage:'Hello from Example.',turns:[{speaker:'company',text:'Hello from Example.'},{speaker:'customer',text:'Hello.'}]}}};
  let providerCalls=0;
  context.fetch=async()=>{providerCalls+=1;return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify(providerDraft)}]}}]})};};
  vm.runInContext(`fetchRemote=async()=>({url:'https://example.com/',contentType:'text/html',body:Buffer.from('<title>Example</title><link rel="icon" href="/logo.svg"><meta property="og:image" content="/hero.png"><p>A synthetic company page.</p>'),partial:false});`,context);
  const request={...requestBody,useCase:'Demonstrate a conversation.'};
  const created=await invoke(handler,{method:'POST',url:'/api/scenario-jobs',headers:{'x-idempotency-key':'legitimate'},body:request});
  assert.equal(created.status,202);await tick();
  const response=await invoke(handler,{url:created.json().poll});
  const job=response.json();
  assert.equal(response.status,200);assert.equal(job.status,'completed');assert.equal(job.requirements.complete,true);
  assert.equal(job.draft.logoUrl,'https://example.com/logo.svg');
  assert.equal(job.source.imageCandidates.find(item=>item.role==='logo').url,'https://example.com/logo.svg');
  assert.equal(job.source.imageCandidates.find(item=>item.role==='hero').url,'https://example.com/hero.png');
  const replay=await invoke(handler,{method:'POST',url:'/api/scenario-jobs',headers:{'x-idempotency-key':'legitimate'},body:request});
  assert.equal(replay.json().id,created.json().id);assert.equal(providerCalls,1);
  const conflict=await invoke(handler,{method:'POST',url:'/api/scenario-jobs',headers:{'x-idempotency-key':'legitimate'},body:{...request,useCase:'Another conversation.'}});
  assert.equal(conflict.status,409);assert.equal(conflict.json().error,'idempotency_conflict');
});
