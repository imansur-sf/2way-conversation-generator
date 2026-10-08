const http = require('node:http');
const { createReadStream, stat, realpath } = require('node:fs');
const { randomUUID, createHash } = require('node:crypto');
const path = require('node:path');
const { clientIp:trustedClientIp, createRemoteFetcher, publicFilePath, supportedImageTypes, svgContentSecurityPolicy } = require('./server/security.cjs');
const { aiConfig, providerHealth } = require('./server/ai-config.cjs');
const { CHANNELS, normalizePersona, normalizeControls, storyBrief, draftPrompt, draftResponseSchema, validateAndNormalizeDraft, promptFallback } = require('./server/draft-contract.cjs');

const port = Number(process.env.PORT) || 3000;
const root = __dirname;
const appEnvironment = process.env.APP_ENV || 'development';
const appVersion = process.env.APP_VERSION || '2.0.0';
const aiSettings = aiConfig(process.env);
const geminiApiKey = aiSettings.apiKey;
const geminiModel = aiSettings.model;
const providerObservation = {lastSuccessAt:null,lastFailureAt:null,lastFailureCode:null};
const scrapeLimitBytes = 500_000;
const imageLimitBytes = 2_000_000;
const requestLimitBytes = 200_000;
/* Website fetches have a total deadline. Generation uses asynchronous jobs;
   its two-attempt provider budget may exceed a synchronous router timeout. */
const requestTimeoutMs = 7_000;
const rateWindowMs = 60_000;
const perMinuteLimit = 12;
const rateBuckets = new Map();
const generationJobs = new Map();
const idempotencyJobs = new Map();
/* This is deliberately an in-memory convenience cache, not scenario storage.
   It only avoids repeat Gemini calls while a single dyno remains alive. */
const draftCache = new Map();
const draftCacheTtlMs = 5 * 60_000;
const generationJobTtlMs = 15 * 60_000;
const generationJobLimit = 120;
const generationConcurrency = Math.max(1,Math.min(8,Number.parseInt(process.env.GENERATION_CONCURRENCY,10) || 3));
let activeGenerations = 0;
const trustHeroku = Boolean(process.env.DYNO);
const secureRemoteFetch = createRemoteFetcher({ timeoutMs:requestTimeoutMs });
const generationMetrics = { started:0, completed:0, failed:0, fallback:0, totalDurationMs:0, lastCompletedAt:null, lastFailureAt:null };
const mimeTypes = { '.css':'text/css; charset=utf-8', '.gif':'image/gif', '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.svg':'image/svg+xml', '.webp':'image/webp', '.avif':'image/avif', '.ico':'image/x-icon', '.woff':'font/woff', '.woff2':'font/woff2' };

function sendJson(response, status, body, requestId = '') {
  response.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', ...([429,503].includes(status) ? { 'Retry-After':'5' } : {}), ...(requestId ? { 'X-Request-Id':requestId } : {}) });
  response.end(JSON.stringify(requestId ? { ...body, requestId } : body));
}
function clientIp(request) { return trustedClientIp(request,trustHeroku); }
function withinRateLimit(request,category='generation',limit=perMinuteLimit) {
  const now = Date.now(), key = `${category}:${clientIp(request)}`, bucket = rateBuckets.get(key);
  for (const [candidate, value] of rateBuckets) if (value.resetAt <= now) rateBuckets.delete(candidate);
  if (!bucket || bucket.resetAt <= now) { if (rateBuckets.size >= 5000) return false; rateBuckets.set(key, { count:1, resetAt:now + rateWindowMs }); return true; }
  bucket.count += 1;
  return bucket.count <= limit;
}
function normalizedWebsiteUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`;
}
async function fetchRemote(value, maxBytes, allowPartial = false) {
  return secureRemoteFetch(normalizedWebsiteUrl(value),maxBytes,allowPartial);
}
function absoluteUrl(value, base) { try { const url = new URL(value, base); return ['http:','https:'].includes(url.protocol) ? url.toString() : ''; } catch { return ''; } }
function decodeEntities(value = '') { return value.replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>'); }
function stripMarkup(value = '') { return decodeEntities(value.replace(/<(script|style|noscript|svg|iframe|template)[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()); }
function metaValue(html, name) {
  const escape = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const before = new RegExp(`<meta[^>]+(?:name|property)=["']${escape}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i');
  const after = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escape}["'][^>]*>`, 'i');
  return decodeEntities(html.match(before)?.[1] || html.match(after)?.[1] || '');
}
function extractWebsite(html, pageUrl) {
  const title = stripMarkup(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').slice(0,200);
  const headings = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map(match => stripMarkup(match[1])).filter(Boolean).slice(0,18);
  const description = (metaValue(html,'description') || metaValue(html,'og:description')).slice(0,600);
  const candidates = [];
  const add = (raw, role) => { const url = absoluteUrl(raw, pageUrl); if (url && !candidates.some(item => item.url === url)) candidates.push({ url, role }); };
  const ogImage = absoluteUrl(metaValue(html,'og:image') || metaValue(html,'twitter:image'), pageUrl);
  if (ogImage) add(ogImage,'hero');
  [...html.matchAll(/<link\b[^>]*>/gi)].forEach(match => { const tag = match[0], rel = tag.match(/rel=["']([^"']+)["']/i)?.[1] || '', href = tag.match(/href=["']([^"']+)["']/i)?.[1]; if (/icon/i.test(rel) && href) add(href,'logo'); });
  [...html.matchAll(/<img\b[^>]*>/gi)].forEach(match => { const tag = match[0], src = tag.match(/(?:src|data-src)=["']([^"']+)["']/i)?.[1], descriptor = `${tag.match(/alt=["']([^"']*)["']/i)?.[1] || ''} ${tag.match(/class=["']([^"']*)["']/i)?.[1] || ''}`.toLowerCase(); if (src) add(src, /logo|brand|header/.test(descriptor) ? 'logo':'image'); });
  const links=[...new Set([...html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].map(match=>absoluteUrl(decodeEntities(match[1]),pageUrl)).filter(Boolean))].slice(0,30);
  const emails=[...new Set([...html.matchAll(/href=["']mailto:([^?"']+)/gi)].map(match=>decodeEntities(match[1])))].slice(0,10);
  return { url:pageUrl, title, description, headings, text:stripMarkup(html).slice(0,7000), candidates:candidates.slice(0,16), links, emails };
}
function parseJson(value) {
  const text = String(value || '').trim().replace(/^\x60\x60\x60json\s*/i,'').replace(/^\x60\x60\x60\s*/,'').replace(/\x60\x60\x60$/,'').trim();
  try { return JSON.parse(text); }
  catch { throw Object.assign(new Error('gemini_bad_json'),{code:'gemini_bad_json'}); }
}
/* Exactly one upstream attempt. The generation loop owns the shared retry
   budget, including structural/semantic validation failures. */
async function callGemini(prompt, channels) {
  if (!geminiApiKey) throw Object.assign(new Error('llm_not_configured'),{code:'llm_not_configured'});
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),aiSettings.timeoutMs);
  try {
    const upstream=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`,{
      method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':geminiApiKey},signal:controller.signal,
      body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:'application/json',responseSchema:draftResponseSchema(channels),maxOutputTokens:Math.min(8000,2400*channels.length)}})
    });
    if (!upstream.ok) {
      const code=upstream.status===400?'gemini_bad_request':upstream.status===401||upstream.status===403?'gemini_auth_failed':upstream.status===404?'gemini_model_not_found':upstream.status===429?'gemini_rate_limited':'gemini_failed';
      console.error(JSON.stringify({event:'gemini_request_failed',status:upstream.status,model:geminiModel}));
      throw Object.assign(new Error(code),{code,status:upstream.status});
    }
    let payload;
    try {payload=await upstream.json();} catch {throw Object.assign(new Error('gemini_bad_json'),{code:'gemini_bad_json'});}
    const candidate=payload?.candidates?.[0],finish=candidate?.finishReason;
    if (payload?.promptFeedback?.blockReason || ['SAFETY','RECITATION','BLOCKLIST','PROHIBITED_CONTENT','SPII'].includes(finish)) throw Object.assign(new Error('gemini_blocked'),{code:'gemini_blocked'});
    if (finish && finish!=='STOP') throw Object.assign(new Error('gemini_incomplete'),{code:'gemini_incomplete'});
    const raw=candidate?.content?.parts?.filter(part=>!part.thought).map(part=>part.text || '').join('') || '';
    return parseJson(raw);
  } catch (error) {
    if (error?.name==='AbortError') throw Object.assign(new Error('gemini_timeout'),{code:'gemini_timeout'});
    if (!error?.code && error?.name==='TypeError') throw Object.assign(new Error('gemini_failed'),{code:'gemini_failed'});
    throw error;
  } finally {clearTimeout(timeout);}
}
function clean(value, fallback='') {return typeof value==='string'?value.trim().slice(0,1800):fallback;}
function cleanPrompt(value) {return typeof value==='string'?value.trim():'';}
function readJson(request) {
  return new Promise((resolve,reject) => {
    const chunks=[]; let size=0;
    request.on('data',chunk => { size += chunk.length; if (size > requestLimitBytes) { reject(Object.assign(new Error('request_too_large'), { code:'request_too_large' })); request.destroy(); } else chunks.push(chunk); });
    request.on('end',() => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(Object.assign(new Error('invalid_json'), { code:'invalid_json' })); } });
    request.on('error',reject);
  });
}
function validateDraftRequest(body) {
  if (!body || typeof body!=='object' || Array.isArray(body)) throw Object.assign(new Error('invalid_json'),{code:'invalid_json'});
  let website=normalizedWebsiteUrl(typeof body.website==='string'?body.website:'');
  const useCase=cleanPrompt(body.useCase);
  const channels=[...new Set(Array.isArray(body.channels)?body.channels:[])];
  if (!website || !useCase || !channels.length) throw Object.assign(new Error('missing_required_fields'),{code:'missing_required_fields'});
  if (useCase.length>12000 || website.length>2048 || body.companyName!==undefined&&(typeof body.companyName!=='string'||body.companyName.length>200) || channels.some(channel=>!CHANNELS.includes(channel))) throw Object.assign(new Error('invalid_generation_request'),{code:'invalid_generation_request'});
  try {const parsed=new URL(website);if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)throw new Error();website=parsed.href;} catch {throw Object.assign(new Error('invalid_url'),{code:'invalid_url'});}
  const request={companyName:clean(body.companyName),website,useCase,channels,persona:normalizePersona(body.persona),controls:normalizeControls(body.controls)};
  storyBrief(request); // Fail contradictory/invalid controls before admission or any network work.
  return request;
}
function errorStatus(code) {
  if (['llm_not_configured','generation_busy','remote_busy'].includes(code)) return 503;
  if (code === 'idempotency_conflict') return 409;
  if (['invalid_url','blocked_url','blocked_host','missing_required_fields','request_too_large','invalid_json','invalid_generation_request','invalid_controls','invalid_persona','invalid_dialogue','conflicting_requirements'].includes(code)) return 400;
  if (code === 'rate_limited') return 429;
  return 502;
}
function publicGenerationMetrics() {
  const active = [...generationJobs.values()].filter(job => ['queued','running'].includes(job.status)).length;
  const completed = generationMetrics.completed;
  return {
    active,
    started:generationMetrics.started,
    completed,
    failed:generationMetrics.failed,
    fallback:generationMetrics.fallback,
    averageDurationMs:completed ? Math.round(generationMetrics.totalDurationMs / completed) : 0,
    lastCompletedAt:generationMetrics.lastCompletedAt,
    lastFailureAt:generationMetrics.lastFailureAt
  };
}
async function generateScenarioDraft(body, requestId) {
  const request=validateDraftRequest(body),brief=storyBrief(request);
  const cacheKey=createHash('sha256').update(JSON.stringify(request)).digest('hex');
  const cached=draftCache.get(cacheKey);
  if (cached && cached.expiresAt>Date.now()) {
    console.log(JSON.stringify({event:'scenario_draft_cache_hit',requestId}));
    return JSON.parse(JSON.stringify(cached.value));
  }
  const startedAt=Date.now();
  console.log(JSON.stringify({event:'scenario_draft_started',requestId,channels:request.channels,website:new URL(request.website).hostname}));
  const remote=await fetchRemote(request.website,scrapeLimitBytes,true);
  if (!/html|xml|text\//i.test(remote.contentType)) throw Object.assign(new Error('not_html'),{code:'not_html'});
  const evidence=extractWebsite(remote.body.toString('utf8'),remote.url);
  let validated,failure,attempts=0;
  const retryable=new Set(['gemini_timeout','gemini_failed','gemini_bad_json','gemini_incomplete','gemini_rate_limited','draft_invalid']);
  for (let attempt=0;attempt<aiSettings.maxAttempts;attempt+=1) {
    attempts+=1;
    try {
      const raw=await callGemini(draftPrompt(request,evidence,brief,failure?.issues || []),request.channels);
      validated=validateAndNormalizeDraft(raw,request,evidence,brief);
      providerObservation.lastSuccessAt=Date.now();
      break;
    } catch(error) {
      failure=error;providerObservation.lastFailureAt=Date.now();providerObservation.lastFailureCode=error.code || 'gemini_failed';
      if (!retryable.has(error?.code) || attempt+1>=aiSettings.maxAttempts) break;
      console.log(JSON.stringify({event:'gemini_request_retrying',requestId,attempt:attempt+1,code:error.code}));
      await new Promise(resolve=>setTimeout(resolve,350));
    }
  }
  let fallbackReason=null,stage=null;
  if (!validated) {
    if (['gemini_timeout','gemini_failed','gemini_bad_json','gemini_incomplete','draft_invalid'].includes(failure?.code)) {
      validated=promptFallback(request,evidence,brief);
      if (validated) {fallbackReason=failure.code;stage=failure.code==='draft_invalid'?'validation':'provider';}
    }
    if (!validated) throw failure || Object.assign(new Error('draft_invalid'),{code:'draft_invalid'});
  }
  const {draft,requirements}=validated;
  requirements.scope='structure-and-explicit-constraints';
  if (fallbackReason) requirements.warnings.push('This is a deterministic prompt-guided starter, not a successful AI generation. Review it before applying.');
  console.log(JSON.stringify({event:'scenario_draft_completed',requestId,elapsedMs:Date.now()-startedAt,requirementsComplete:requirements.complete,fallbackReason,attempts}));
  const result={draft,requirements,source:{
    url:remote.url,title:evidence.title,imageCandidates:evidence.candidates,
    requestedChannels:[...request.channels],requestFingerprint:cacheKey,
    mode:fallbackReason?'prompt-fallback':'provider',fallbackReason,stage,coverage:'partial',
    provider:{name:'gemini',model:geminiModel,attempts},brief,facts:brief.facts,
    grounding:{status:'unverified',note:'Only the supplied brief and limited page context were available. Facts, link availability, and ownership were not independently verified.'},
  }};
  if (!fallbackReason && requirements.complete) draftCache.set(cacheKey,{expiresAt:Date.now()+draftCacheTtlMs,value:result});
  for (const [key,value] of draftCache) if (value.expiresAt<=Date.now()) draftCache.delete(key);
  while (draftCache.size>generationJobLimit) draftCache.delete(draftCache.keys().next().value);
  return result;
}
function pruneGenerationJobs(reserve = 0) {
  const threshold = Date.now() - generationJobTtlMs;
  for (const [id, job] of generationJobs) if (job.completedAt && job.completedAt < threshold) generationJobs.delete(id);
  for (const [id, job] of generationJobs) {
    if (generationJobs.size + reserve <= generationJobLimit) break;
    if (['completed','failed'].includes(job.status)) generationJobs.delete(id);
  }
  for (const [key, id] of idempotencyJobs) if (!generationJobs.has(id)) idempotencyJobs.delete(key);
}
function acquireGenerationSlot() {
  if (activeGenerations >= generationConcurrency) throw Object.assign(new Error('generation_busy'),{code:'generation_busy'});
  activeGenerations += 1;
}
function startGenerationJob(body, requestId, idempotencyKey = '', requester = '') {
  const normalizedBody = validateDraftRequest(body);
  const payloadHash = createHash('sha256').update(JSON.stringify(normalizedBody)).digest('hex');
  const scopedKey = idempotencyKey ? createHash('sha256').update(`${requester}\0${idempotencyKey}`).digest('hex') : '';
  pruneGenerationJobs();
  const existingId = scopedKey ? idempotencyJobs.get(scopedKey) : '';
  const existing = existingId ? generationJobs.get(existingId) : null;
  if (existing) {
    if (existing.payloadHash !== payloadHash) throw Object.assign(new Error('idempotency_conflict'),{code:'idempotency_conflict'});
    return { job:existing, reused:true };
  }
  if (activeGenerations >= generationConcurrency) throw Object.assign(new Error('generation_busy'),{code:'generation_busy'});
  pruneGenerationJobs(1);
  if (generationJobs.size >= generationJobLimit) throw Object.assign(new Error('generation_busy'),{code:'generation_busy'});
  acquireGenerationSlot();
  const id = randomUUID();
  const job = { id, requestId, payloadHash, createdAt:Date.now(), updatedAt:Date.now(), startedAt:null, completedAt:null, status:'queued', result:null, error:null };
  generationJobs.set(id,job);
  if (scopedKey) idempotencyJobs.set(scopedKey,id);
  generationMetrics.started += 1;
  queueMicrotask(async () => {
    job.status='running'; job.startedAt=Date.now(); job.updatedAt=job.startedAt;
    try {
      job.result = await generateScenarioDraft(normalizedBody,requestId);
      job.status='completed';
      generationMetrics.completed += 1;
      generationMetrics.totalDurationMs += Date.now() - job.startedAt;
      generationMetrics.lastCompletedAt = Date.now();
      if (job.result?.source?.fallbackReason) generationMetrics.fallback += 1;
    }
    catch (error) {
      job.error = error?.code || 'scenario_generation_failed';
      job.issues = Array.isArray(error?.issues) ? error.issues : [];
      job.status='failed';
      generationMetrics.failed += 1;
      generationMetrics.lastFailureAt = Date.now();
      console.error(JSON.stringify({ event:'scenario_draft_failed', requestId, code:job.error, status:error?.status || null, name:error?.name || null, message:String(error?.message || '').slice(0,240) }));
    }
    finally { job.completedAt=Date.now(); job.updatedAt=job.completedAt; activeGenerations -= 1; pruneGenerationJobs(); }
  });
  return { job, reused:false };
}
function publicJob(job) {
  const response = { id:job.id, status:job.status, createdAt:job.createdAt, updatedAt:job.updatedAt, durationMs:job.startedAt ? Math.max(0, (job.completedAt || Date.now()) - job.startedAt) : 0 };
  if (job.status === 'completed') Object.assign(response,job.result);
  if (job.status === 'failed') {response.error=job.error;response.issues=job.issues || [];}
  return response;
}
function sendFile(file,response) {
  const missing = () => { response.writeHead(404,{ 'Content-Type':'text/plain; charset=utf-8' }); response.end('Not found'); };
  realpath(file,(resolveError,resolved) => {
    if (resolveError || !publicFilePath(root,path.relative(root,resolved))) { missing(); return; }
    stat(resolved,(error,details) => {
      if (error || !details.isFile()) { missing(); return; }
      const releaseCritical = ['.html','.js','.css'].includes(path.extname(resolved).toLowerCase());
      const contentType=mimeTypes[path.extname(resolved).toLowerCase()];
      const stream=createReadStream(resolved);
      response.on('close',() => stream.destroy());
      stream.on('error',() => { if (!response.headersSent) missing(); else response.destroy(); });
      stream.on('open',() => {
        response.writeHead(200,{ 'Content-Type':contentType, 'Cache-Control':releaseCritical ? 'no-cache' : 'public, max-age=3600', 'X-Content-Type-Options':'nosniff', ...(contentType === 'image/svg+xml' ? { 'Content-Security-Policy':svgContentSecurityPolicy } : {}) });
        stream.pipe(response);
      });
    });
  });
}
async function handleApi(request,response,url) {
  const requestId = request.headers['x-request-id']?.toString().slice(0,96) || randomUUID();
  if (request.method === 'GET' && url.pathname === '/api/health') { sendJson(response,200,{ ok:true, service:'two-way-experience-studio', version:appVersion, environment:appEnvironment, aiConfigured:Boolean(geminiApiKey), ai:providerHealth(aiSettings,providerObservation), jobs:{ transient:true, retentionMinutes:generationJobTtlMs / 60_000, metrics:publicGenerationMetrics() } },requestId); return true; }
  if (request.method === 'POST' && url.pathname === '/api/client-diagnostic') {
    if (!withinRateLimit(request,'diagnostic',20)) { sendJson(response,429,{ error:'rate_limited' },requestId); return true; }
    try {
      const body = await readJson(request);
      const safeText = value => String(value || '').replace(/[\r\n\t]/g,' ').slice(0,400);
      console.warn(JSON.stringify({
        event:'client_boot_diagnostic',
        kind:safeText(body.kind),
        phase:safeText(body.phase),
        message:safeText(body.message),
        source:safeText(body.source),
        line:Number.isFinite(Number(body.line)) ? Number(body.line) : null,
        column:Number.isFinite(Number(body.column)) ? Number(body.column) : null
      }));
      response.writeHead(204,{ 'Cache-Control':'no-store' }); response.end();
    } catch { sendJson(response,400,{ error:'invalid_diagnostic' },requestId); }
    return true;
  }
  const jobMatch = url.pathname.match(/^\/api\/scenario-jobs\/([0-9a-f-]{36})$/i);
  if (request.method === 'GET' && jobMatch) {
    pruneGenerationJobs();
    const job = generationJobs.get(jobMatch[1]);
    if (!job) sendJson(response,404,{ error:'job_not_found' },requestId);
    else sendJson(response,200,publicJob(job),requestId);
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/scenario-jobs') {
    if (!withinRateLimit(request)) { sendJson(response,429,{ error:'rate_limited' },requestId); return true; }
    try {
      const body = await readJson(request);
      validateDraftRequest(body);
      const idempotencyKey = String(request.headers['x-idempotency-key'] || request.headers['x-request-id'] || '').trim().slice(0,128);
      const { job, reused } = startGenerationJob(body,requestId,idempotencyKey,clientIp(request));
      sendJson(response,202,{ id:job.id, status:job.status, poll:`/api/scenario-jobs/${job.id}`, reused },requestId);
    } catch (error) { sendJson(response,errorStatus(error?.code),{ error:error?.code || 'scenario_generation_failed', issues:error?.issues || [] },requestId); }
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/api/asset') {
    if (!withinRateLimit(request,'asset',120)) { sendJson(response,429,{ error:'rate_limited' },requestId); return true; }
    const requested = url.searchParams.get('url');
    if (!requested) { sendJson(response,400,{ error:'missing_url' }); return true; }
    try {
      const asset = await fetchRemote(requested,imageLimitBytes);
      const contentType=asset.contentType.split(';')[0].trim().toLowerCase();
      if (!supportedImageTypes.has(contentType)) throw Object.assign(new Error('not_an_image'),{ code:'not_an_image' });
      if (url.searchParams.get('raw') === '1') {
        response.writeHead(200,{ 'Content-Type':contentType, 'Cache-Control':'private, max-age=300', 'X-Content-Type-Options':'nosniff', ...(contentType === 'image/svg+xml' ? { 'Content-Security-Policy':svgContentSecurityPolicy } : {}) });
        response.end(asset.body);
      } else sendJson(response,200,{ dataUrl:`data:${contentType};base64,${asset.body.toString('base64')}` });
    } catch (error) { sendJson(response,errorStatus(error.code),{ error:error.code || 'asset_fetch_failed' },requestId); }
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/scenario-draft') {
    if (!withinRateLimit(request)) { sendJson(response,429,{ error:'rate_limited' },requestId); return true; }
    let admitted=false;
    try {
      const body=validateDraftRequest(await readJson(request));
      acquireGenerationSlot(); admitted=true;
      const result = await generateScenarioDraft(body,requestId);
      sendJson(response,200,result,requestId);
    } catch (error) { const code=error?.code || 'scenario_generation_failed'; console.error(JSON.stringify({ event:'scenario_draft_failed', requestId, code, status:error?.status || null, name:error?.name || null, message:String(error?.message || '').slice(0,240) })); sendJson(response,errorStatus(code),{ error:code, issues:error?.issues || [] },requestId); }
    finally { if (admitted) activeGenerations -= 1; }
    return true;
  }
  return false;
}
http.createServer(async (request,response) => {
  let url;
  try { url = new URL(request.url,`http://${request.headers.host || 'localhost'}`); } catch { sendJson(response,400,{ error:'invalid_request' }); return; }
  try { if (url.pathname.startsWith('/api/') && await handleApi(request,response,url)) return; } catch { sendJson(response,500,{ error:'server_error' }); return; }
  let relativePath;
  try { relativePath = url.pathname === '/' ? 'interactive-simulator-builder.html' : decodeURIComponent(url.pathname).replace(/^\/+/, ''); } catch { response.writeHead(400); response.end('Invalid path'); return; }
  if (!['GET','HEAD'].includes(request.method)) { response.writeHead(405,{ Allow:'GET, HEAD' }); response.end(); return; }
  const file = publicFilePath(root,relativePath);
  if (!file) { response.writeHead(404); response.end('Not found'); return; }
  sendFile(file,response);
}).listen(port,() => console.log(`Two-Way Experience Studio ${appVersion} is running on port ${port} (${appEnvironment}); AI setup: ${geminiApiKey ? 'configured':'needs GEMINI_API_KEY'}`));
