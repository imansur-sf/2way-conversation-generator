const http = require('node:http');
const { createReadStream, stat } = require('node:fs');
const { lookup } = require('node:dns').promises;
const { randomUUID, createHash } = require('node:crypto');
const net = require('node:net');
const path = require('node:path');

const port = Number(process.env.PORT) || 3000;
const root = __dirname;
const appEnvironment = process.env.APP_ENV || 'development';
const appVersion = process.env.APP_VERSION || '2.0.0';
const geminiApiKey = process.env.GEMINI_API_KEY || '';
const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const scrapeLimitBytes = 500_000;
const imageLimitBytes = 2_000_000;
const requestLimitBytes = 200_000;
/* Keep the full scrape + generation request safely below Heroku's router
   timeout. A browser retry starts a fresh request when an upstream is slow. */
const requestTimeoutMs = 7_000;
const geminiRequestTimeoutMs = 20_000;
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
const generationMetrics = { started:0, completed:0, failed:0, fallback:0, totalDurationMs:0, lastCompletedAt:null, lastFailureAt:null };
const mimeTypes = { '.css':'text/css; charset=utf-8', '.gif':'image/gif', '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.svg':'image/svg+xml' };

function sendJson(response, status, body, requestId = '') {
  response.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', ...(requestId ? { 'X-Request-Id':requestId } : {}) });
  response.end(JSON.stringify(requestId ? { ...body, requestId } : body));
}
function clientIp(request) { return request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.socket.remoteAddress || 'unknown'; }
function withinRateLimit(request) {
  const now = Date.now(), key = clientIp(request), bucket = rateBuckets.get(key);
  for (const [candidate, value] of rateBuckets) if (value.resetAt <= now) rateBuckets.delete(candidate);
  if (!bucket || bucket.resetAt <= now) { rateBuckets.set(key, { count:1, resetAt:now + rateWindowMs }); return true; }
  bucket.count += 1;
  return bucket.count <= perMinuteLimit;
}
function privateIp(address) {
  if (net.isIP(address) === 4) return /^(0|10|127)\./.test(address) || /^169\.254\./.test(address) || /^192\.168\./.test(address) || /^172\.(1[6-9]|2\d|3[01])\./.test(address);
  const value = String(address).toLowerCase();
  return value === '::' || value === '::1' || value.startsWith('fe80:') || value.startsWith('fc') || value.startsWith('fd');
}
function blockedHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return !host || host === 'localhost' || host === 'metadata.google.internal' || host.endsWith('.local') || host.endsWith('.internal') || privateIp(host);
}
function normalizedWebsiteUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`;
}
async function safeUrl(value) {
  let parsed;
  try { parsed = new URL(normalizedWebsiteUrl(value)); } catch { throw Object.assign(new Error('invalid_url'), { code:'invalid_url' }); }
  if (!['http:','https:'].includes(parsed.protocol) || parsed.username || parsed.password || blockedHost(parsed.hostname)) throw Object.assign(new Error('blocked_url'), { code:'blocked_url' });
  const addresses = await lookup(parsed.hostname, { all:true, verbatim:true });
  if (!addresses.length || addresses.some(item => privateIp(item.address))) throw Object.assign(new Error('blocked_host'), { code:'blocked_host' });
  return parsed;
}
async function fetchRemote(value, maxBytes, allowPartial = false) {
  let remote = await safeUrl(value);
  for (let redirects = 0; redirects < 4; redirects += 1) {
    const controller = new AbortController();
    const deadline = Date.now() + requestTimeoutMs;
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const upstream = await fetch(remote, { redirect:'manual', headers:{ 'User-Agent':'SaaSy-TwoWay-Experience-Studio/1.0', 'Accept':'text/html,application/xhtml+xml,image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8' }, signal:controller.signal });
      if (upstream.status >= 300 && upstream.status < 400) {
        const location = upstream.headers.get('location');
        if (!location) throw Object.assign(new Error('bad_redirect'), { code:'bad_redirect' });
        remote = await safeUrl(new URL(location, remote).toString());
        continue;
      }
      if (!upstream.ok) throw Object.assign(new Error('upstream_status'), { code:'upstream_status', status:upstream.status });
      if (!allowPartial && Number(upstream.headers.get('content-length') || 0) > maxBytes) throw Object.assign(new Error('too_large'), { code:'too_large' });
      const reader = upstream.body?.getReader();
      if (!reader) throw Object.assign(new Error('empty_body'), { code:'empty_body' });
      const chunks = []; let total = 0;
      while (true) {
        const remainingMs = Math.max(1, deadline - Date.now());
        const { done, value:chunk } = await new Promise((resolve,reject) => {
          const readTimeout = setTimeout(() => {
            controller.abort();
            reject(Object.assign(new Error('request_timeout'), { code:'request_timeout' }));
          }, remainingMs);
          reader.read().then(value => { clearTimeout(readTimeout); resolve(value); }, error => { clearTimeout(readTimeout); reject(error); });
        });
        if (done) break;
        const remaining = maxBytes - total;
        if (chunk.length > remaining) {
          if (!allowPartial) { try { await reader.cancel(); } catch {} throw Object.assign(new Error('too_large'), { code:'too_large' }); }
          if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
          try { await reader.cancel(); } catch {}
          return { url:remote.toString(), contentType:upstream.headers.get('content-type') || '', body:Buffer.concat(chunks), partial:true };
        }
        chunks.push(chunk); total += chunk.length;
      }
      return { url:remote.toString(), contentType:upstream.headers.get('content-type') || '', body:Buffer.concat(chunks), partial:false };
    } catch (error) {
      if (error?.name === 'AbortError') throw Object.assign(new Error('request_timeout'), { code:'request_timeout' });
      if (!error?.code) throw Object.assign(new Error('website_fetch_failed'), { code:'website_fetch_failed' });
      throw error;
    } finally { clearTimeout(timeout); }
  }
  throw Object.assign(new Error('too_many_redirects'), { code:'too_many_redirects' });
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
  return { url:pageUrl, title, description, headings, text:stripMarkup(html).slice(0,7000), candidates:candidates.slice(0,16) };
}
function parseJson(text) {
  const value = String(text || '').trim().replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```$/,'').trim();
  const first = value.indexOf('{'), last = value.lastIndexOf('}');
  if (first < 0 || last <= first) throw Object.assign(new Error('gemini_bad_json'), { code:'gemini_bad_json' });
  try { return JSON.parse(value.slice(first,last + 1)); }
  catch { throw Object.assign(new Error('gemini_bad_json'), { code:'gemini_bad_json' }); }
}
async function callGemini(prompt) {
  if (!geminiApiKey) throw Object.assign(new Error('llm_not_configured'), { code:'llm_not_configured' });
  const request = async (attempt = 0) => {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), geminiRequestTimeoutMs);
    try {
      const retryInstruction = attempt ? '\nReturn the compact JSON object now. Do not explain it, use Markdown, or add fields that were not requested.' : '';
      const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`, { method:'POST', headers:{ 'Content-Type':'application/json' }, signal:controller.signal, body:JSON.stringify({ contents:[{ parts:[{ text:prompt + retryInstruction }] }], generationConfig:{ responseMimeType:'application/json', maxOutputTokens:2400 } }) });
      if (!upstream.ok) {
        const detail = (await upstream.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
        const code = upstream.status === 400 ? 'gemini_bad_request' : upstream.status === 401 || upstream.status === 403 ? 'gemini_auth_failed' : upstream.status === 404 ? 'gemini_model_not_found' : upstream.status === 429 ? 'gemini_rate_limited' : 'gemini_failed';
        console.error(JSON.stringify({ event:'gemini_request_failed', status:upstream.status, model:geminiModel, detail }));
        throw Object.assign(new Error(code), { code, status:upstream.status });
      }
      let payload;
      try { payload = await upstream.json(); }
      catch { throw Object.assign(new Error('gemini_bad_json'), { code:'gemini_bad_json' }); }
      const raw=payload?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';
      try { return parseJson(raw); }
      catch (error) { console.error(JSON.stringify({ event:'gemini_invalid_json', model:geminiModel, attempt, finishReason:payload?.candidates?.[0]?.finishReason || null, characters:raw.length })); throw error; }
    } catch (error) {
      if (error?.name === 'AbortError') throw Object.assign(new Error('gemini_timeout'), { code:'gemini_timeout' });
      if (!error?.code && error?.name === 'TypeError') throw Object.assign(new Error('gemini_failed'), { code:'gemini_failed' });
      throw error;
    } finally { clearTimeout(timeout); }
  };
  let failure;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { return await request(attempt); }
    catch (error) {
      failure = error;
      const retryable = ['gemini_timeout','gemini_failed','gemini_bad_json','gemini_rate_limited'].includes(error?.code);
      if (!retryable || attempt === 1) throw error;
      console.log(JSON.stringify({ event:'gemini_request_retrying', attempt:attempt + 1, code:error.code }));
      await new Promise(resolve => setTimeout(resolve, 350));
    }
  }
  throw failure;
}
function adaptCanonicalDraft(raw, channels) {
  const source = raw?.scenarios?.sms || raw?.scenarios?.[Object.keys(raw?.scenarios || {})[0]] || {};
  return { ...raw, scenarios:Object.fromEntries(channels.map(channel => [channel,{ ...source }])) };
}
function fallbackTurns(useCase) {
  const turns = [];
  const pattern = /\b(company|customer|prospect|recipient)(?:\s*\([^)]*\))?\s+(?:says?|asks?|repl(?:y|ies)|responds?)\s*[:\-]?\s*["“]([^"”]{2,1800})["”]/gi;
  for (const match of useCase.matchAll(pattern)) turns.push({ speaker:/company/i.test(match[1]) ? 'company':'customer', text:clean(match[2]), mode:'prefill', options:[] });
  return turns.slice(0,16);
}
function promptStory(useCase) {
  const copy = cleanPrompt(useCase);
  const customer = clean(copy.match(/\b(?:customer|prospect|recipient|lead)\s*,?\s*(?:named\s+)?([A-Z][a-z]{1,40})\b/i)?.[1]);
  const representativeMatch = copy.match(/\b((?:(?:sales|account|customer success|admissions|program)?\s*(?:rep(?:resentative)?|advisor|agent|specialist|manager|director|consultant|executive)))\s+(?:named|called)?\s*([A-Z][a-z]{1,40})\b/i);
  const representativeRole = clean(representativeMatch?.[1]);
  const representative = clean(representativeMatch?.[2]);
  const openingTopic = clean(copy.match(/\b(?:sends?|shares?|announces?|promotes?|invites?|markets?|launches?)[^.?!]{0,160}?\b(?:about|for)\s+(?:an?\s+)?([^.!?]+)/i)?.[1] || copy.match(/\b(?:about|for)\s+(?:an?\s+)?([^.!?]+)/i)?.[1]);
  const questionTopic = clean(copy.match(/\b(?:questions?\s+(?:around|about|regarding)|asks?\s+(?:about|whether)|inquires?\s+(?:about|whether)|wants?\s+to\s+know\s+(?:about\s+)?)\s*([^.!?]+)/i)?.[1]);
  const handoffTopic = clean(copy.match(/\b(?:wants?\s+to\s+learn\s+more\s+about|is\s+interested\s+in|asks?\s+to\s+learn\s+about)\s+([^,.!?]+)/i)?.[1]);
  return { customer, representative, representativeRole, openingTopic, questionTopic, handoffTopic };
}
function requestedMessageCount(useCase) {
  const scripted = fallbackTurns(useCase);
  if (scripted.length >= 2) return scripted.length;
  const match = cleanPrompt(useCase).match(/\b([2-9]|1[0-2])\s+(?:total\s+)?(?:messages?|turns?|steps?)\b/i);
  return match ? Number(match[1]) : 0;
}
function storyBrief(useCase, companyName = '') {
  const story = promptStory(useCase);
  const scriptedTurns = fallbackTurns(useCase);
  return {
    company:clean(companyName),
    initialSender:requestedInitialSender(useCase,companyName) || (scriptedTurns[0]?.speaker || ''),
    expectedMessageCount:requestedMessageCount(useCase),
    scriptedTurns,
    story
  };
}
function promptStoryAnchors(story) { return [story.customer, story.representative, story.openingTopic, story.questionTopic, story.handoffTopic].filter(value => value && value.length >= 3); }
function naturalLanguageFallbackTurns(useCase, company) {
  const story = promptStory(useCase), hasStory = promptStoryAnchors(story).length || story.questionTopic;
  if (!hasStory) return [];
  const greeting = story.customer ? `Hi ${story.customer}! ` : 'Hi! ';
  const opening = story.openingTopic ? `about ${story.openingTopic}` : 'with an update tailored to your interests';
  const question = story.questionTopic ? `Could you tell me more about ${story.questionTopic}?` : `Could you share more details ${story.openingTopic ? `about ${story.openingTopic}` : ''}?`.replace(/\s+\?/,'?');
  const turns = [
    { speaker:'company', text:`${greeting}${company} is reaching out ${opening}. We’d be glad to help you explore the details.`, mode:'prefill', options:[] },
    { speaker:'customer', text:question, mode:'prefill', options:[] },
    { speaker:'company', text:`${greeting}I can help clarify ${story.questionTopic || story.openingTopic || 'the details'} without guessing at information that is not in the brief.`, mode:'prefill', options:[] }
  ];
  if (story.handoffTopic) {
    turns.push({ speaker:'customer', text:`Thanks. I’d also like to learn more about ${story.handoffTopic}.`, mode:'prefill', options:[] });
    const role = story.representativeRole || 'specialist';
    const person = story.representative || `a ${role}`;
    turns.push({ speaker:'company', text:`Absolutely${story.customer ? `, ${story.customer}` : ''}. I’m connecting you with ${person} in this same thread to help with ${story.handoffTopic}.`, mode:'prefill', options:[] });
    if (story.representative) turns.push({ speaker:'company', text:`Hi${story.customer ? ` ${story.customer}` : ''}, ${story.representative} here. I’d be happy to share more about ${story.handoffTopic} and help with next steps.`, mode:'prefill', options:[] });
  }
  return turns;
}
function escapedPattern(value) { return String(value || '').replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }
function requestedInitialSender(useCase, companyName = '') {
  const copy = String(useCase || ''), company = escapedPattern(companyName.trim());
  const explicit = copy.match(/\b(?:start|begin|open)(?:\s+the\s+(?:conversation|demo|flow))?\s+with\s+(?:the\s+)?(company|customer)\b/i)?.[1]?.toLowerCase();
  if (explicit) return explicit;
  const companySubject = company ? `(?:company|brand|${company})` : '(?:company|brand)';
  const customerSubject = '(?:customer|prospect|recipient|lead)';
  const companyAction = '(?:says?|sends?|shares?|announces?|invites?|markets?|reaches?\\s+out|launches?)';
  const customerAction = '(?:says?|sends?|asks?|repl(?:y|ies)|responds?|reaches?\\s+out|inquires?)';
  const candidates = [
    ...[...copy.matchAll(new RegExp(`\\b${companySubject}\\b[^.!?]{0,110}\\b${companyAction}\\b`, 'gi'))].map(match => ({ speaker:'company', index:match.index })),
    ...[...copy.matchAll(new RegExp(`\\b${customerSubject}\\b[^.!?]{0,110}\\b${customerAction}\\b`, 'gi'))].map(match => ({ speaker:'customer', index:match.index }))
  ].sort((left,right) => left.index-right.index);
  return candidates[0]?.speaker || null;
}
function enforceRequestedInitialSender(raw, useCase, companyName = '') {
  const requested = requestedInitialSender(useCase,companyName);
  if (!requested) return raw;
  const scenarioKey = raw?.scenarios?.sms ? 'sms' : Object.keys(raw?.scenarios || {})[0];
  const scenario = scenarioKey ? raw.scenarios[scenarioKey] : null;
  if (!scenario) return { ...raw, initialSender:requested };
  const generated = turns(scenario.turns);
  if (requested === 'company' && generated[0]?.speaker !== 'company') {
    const opening = clean(scenario.initialMessage || scenario.initialBody || generated.find(turn => turn.speaker === 'company')?.text || `Hi! ${clean(companyName,clean(raw?.companyName,'Our team'))} is reaching out with an update.`);
    console.log(JSON.stringify({ event:'scenario_draft_initial_sender_corrected', requested, generatedFirst:generated[0]?.speaker || null }));
    return { ...raw, initialSender:'company', scenarios:{ ...raw.scenarios, [scenarioKey]:{ ...scenario, initialMessage:opening, initialBody:opening, turns:[{ speaker:'company', text:opening },...generated] } } };
  }
  if (requested === 'customer' && generated[0]?.speaker !== 'customer') {
    const firstCustomer = generated.find(turn => turn.speaker === 'customer');
    const opening = firstCustomer || { speaker:'customer', text:`Hi, I have a question about ${promptStory(useCase).questionTopic || promptStory(useCase).openingTopic || 'your offering'}.`, mode:'prefill', options:[] };
    console.log(JSON.stringify({ event:'scenario_draft_initial_sender_corrected', requested, generatedFirst:generated[0]?.speaker || null }));
    return { ...raw, initialSender:'customer', scenarios:{ ...raw.scenarios, [scenarioKey]:{ ...scenario, customerMessage:opening.text, prefilledReply:opening.text, turns:[opening,...generated.filter(turn => turn !== firstCustomer)] } } };
  }
  return { ...raw, initialSender:requested };
}
function preserveExplicitTurns(raw, useCase) {
  const supplied = fallbackTurns(useCase);
  const scenarioKey = raw?.scenarios?.sms ? 'sms' : Object.keys(raw?.scenarios || {})[0];
  const generated = scenarioKey ? turns(raw.scenarios[scenarioKey]?.turns) : [];
  const orderedMatch = supplied.length === generated.length && supplied.every((turn,index) => turn.speaker === generated[index]?.speaker && turn.text === generated[index]?.text);
  if (supplied.length < 2 || orderedMatch || !scenarioKey) return raw;
  const firstCompany = supplied.find(turn => turn.speaker === 'company')?.text || '';
  const firstCustomer = supplied.find(turn => turn.speaker === 'customer')?.text || '';
  console.log(JSON.stringify({ event:'scenario_draft_explicit_turns_preserved', supplied:supplied.length, generated:generated.length }));
  return { ...raw, initialSender:supplied[0]?.speaker === 'customer' ? 'customer':'company', scenarios:{ ...raw.scenarios, [scenarioKey]:{ ...raw.scenarios[scenarioKey], initialMessage:firstCompany || raw.scenarios[scenarioKey]?.initialMessage, initialBody:firstCompany || raw.scenarios[scenarioKey]?.initialBody, customerMessage:firstCustomer || raw.scenarios[scenarioKey]?.customerMessage, prefilledReply:firstCustomer || raw.scenarios[scenarioKey]?.prefilledReply, turns:supplied } } };
}
function enforceRequestedMessageCount(raw, useCase, companyName = '') {
  const required = requestedMessageCount(useCase);
  const scenarioKey = raw?.scenarios?.sms ? 'sms' : Object.keys(raw?.scenarios || {})[0];
  const scenario = scenarioKey ? raw.scenarios[scenarioKey] : null;
  const generated = turns(scenario?.turns);
  if (!scenario || !required || generated.length >= required) return raw;
  const story = promptStory(useCase), company = clean(companyName,clean(raw?.companyName,'Our team'));
  const topic = story.questionTopic || story.openingTopic || 'the details';
  const addition = [];
  while (generated.length + addition.length < required) {
    const offset = addition.length;
    addition.push(offset % 2 === 0
      ? { speaker:'customer', text:`Could you share one more detail about ${topic}${story.customer ? ` for ${story.customer}` : ''}?`, mode:'prefill', options:[] }
      : { speaker:'company', text:`Absolutely${story.customer ? `, ${story.customer}` : ''}. ${company} can walk through ${topic} and the next best step with you.`, mode:'prefill', options:[] });
  }
  /* Keep a named handoff as the ending rather than burying it behind filler. */
  const handoffIndex = story.handoffTopic ? generated.findIndex(turn => turn.text.toLowerCase().includes(story.handoffTopic.toLowerCase())) : -1;
  const expanded = handoffIndex > -1 ? [...generated.slice(0,handoffIndex),...addition,...generated.slice(handoffIndex)] : [...generated,...addition];
  console.log(JSON.stringify({ event:'scenario_draft_message_count_repaired', required, generated:generated.length, repaired:expanded.length }));
  return { ...raw, scenarios:{ ...raw.scenarios, [scenarioKey]:{ ...scenario, turns:expanded.slice(0,12) } } };
}
function enforcePromptStory(raw, useCase, companyName = '') {
  const story = promptStory(useCase), required = promptStoryAnchors(story), contextualTurns = naturalLanguageFallbackTurns(useCase,clean(companyName,clean(raw?.companyName,'Our team')));
  const scenarioKey = raw?.scenarios?.sms ? 'sms' : Object.keys(raw?.scenarios || {})[0];
  const scenario = scenarioKey ? raw.scenarios[scenarioKey] : null;
  const generated = turns(scenario?.turns), transcript = generated.map(turn => turn.text).join('\n').toLowerCase();
  const missing = required.filter(value => !transcript.includes(value.toLowerCase()));
  if (!scenario || !contextualTurns.length || (!missing.length && generated.length >= contextualTurns.length)) return raw;
  const firstCompany = contextualTurns.find(turn => turn.speaker === 'company')?.text || '';
  const firstCustomer = contextualTurns.find(turn => turn.speaker === 'customer')?.text || '';
  console.log(JSON.stringify({ event:'scenario_draft_prompt_story_enforced', missing, generatedTurns:generated.length, replacementTurns:contextualTurns.length }));
  return { ...raw, initialSender:contextualTurns[0]?.speaker === 'customer' ? 'customer':'company', scenarios:{ ...raw.scenarios, [scenarioKey]:{ ...scenario, initialMessage:firstCompany, initialBody:firstCompany, customerMessage:firstCustomer, prefilledReply:firstCustomer, turns:contextualTurns, fallbackResponse:contextualTurns.filter(turn => turn.speaker === 'company').at(-1)?.text || scenario.fallbackResponse } } };
}
function fallbackDraft({ companyName, website, useCase, evidence }) {
  const hostname = new URL(website).hostname.replace(/^www\./,''), company=clean(companyName,evidence.title || hostname), turns=fallbackTurns(useCase);
  if (!turns.length) turns.push(...naturalLanguageFallbackTurns(useCase,company));
  const companyFirst = turns[0]?.speaker === 'company' || (!turns.length && requestedInitialSender(useCase,company) === 'company');
  if (!turns.length) {
    const opening = companyFirst ? `Hi! ${company} is reaching out with an update.` : 'Hi! I have a question about your offering.';
    turns.push({ speaker:companyFirst?'company':'customer', text:opening, mode:'prefill', options:[] });
    turns.push({ speaker:companyFirst?'customer':'company', text:companyFirst?'Could you share more details?':`Thanks for reaching out to ${company}. How can we help?`, mode:'prefill', options:[] });
  }
  const firstCompany=turns.find(turn=>turn.speaker==='company')?.text || '',firstCustomer=turns.find(turn=>turn.speaker==='customer')?.text || '';
  return { companyName:company, initials:company.split(/\s+/).map(word=>word[0]).join('').slice(0,3).toUpperCase(), emailAddress:`hello@${hostname}`, logoUrl:evidence.candidates.find(item=>item.role==='logo')?.url || '', heroImageUrl:evidence.candidates.find(item=>item.role==='hero')?.url || evidence.candidates.find(item=>item.role==='image')?.url || '', brandColor:'#0176D3', brandSecondaryColor:'#032D60', initialSender:companyFirst?'company':'customer', scenarios:{sms:{title:`${company} conversation`,sender:company,initialMessage:firstCompany,customerMessage:firstCustomer,prefilledReply:firstCustomer,turns,keywords:[],fallbackResponse:turns.filter(turn=>turn.speaker==='company').at(-1)?.text || `Thanks for reaching out to ${company}.`}} };
}
function draftPrompt({ companyName, website, useCase, channels, evidence }) {
  const images = evidence.candidates.map((item,index) => `${index + 1}. ${item.role}: ${item.url}`).join('\n') || '(none)';
  const channel = channels[0] || 'sms';
  const brief = storyBrief(useCase,companyName);
  const channelSchema = channel === 'email'
    ? '{"title":"","subject":"","preheader":"","initialBody":"","customerMessage":"","prefilledReply":"","turns":[{"speaker":"company","text":""},{"speaker":"customer","text":"","mode":"prefill"}],"keywords":[{"terms":"","response":""}],"fallbackResponse":"","ctaLabel":"","ctaUrl":"","layout":"hero"}'
    : '{"title":"","sender":"","initialMessage":"","customerMessage":"","prefilledReply":"","turns":[{"speaker":"company","text":""},{"speaker":"customer","text":"","mode":"prefill"}],"keywords":[{"terms":"","response":""}],"fallbackResponse":""}';
  return `Create one concise, realistic ${channel.toUpperCase()} two-way messaging demo. Return JSON only.\nCompany: ${companyName || '(not supplied)'}\nWebsite: ${website}\nUse case: ${useCase}\n\nStructured brief (this is the acceptance contract): ${JSON.stringify(brief)}. Include every non-empty named person, topic, question, and handoff in the turns; never replace them with generic placeholders. If expectedMessageCount is non-zero, return exactly that many turns. If scriptedTurns is non-empty, preserve each scripted turn's speaker, text, and order verbatim. Preserve every explicitly provided line and its order in turns. Include every supplied turn, up to 12 turns.\n\nEvidence: ${evidence.title}. ${evidence.description}. ${evidence.headings.slice(0,6).join(' | ')}\nWebsite text: ${evidence.text.slice(0,2000)}\nImage candidates (only use these URLs or empty strings):\n${images}\n\nUse "company" as initialSender when the company opens with outreach, a campaign, reminder, or invitation; use "customer" only when the customer explicitly begins. Never merge or omit adjacent company turns, including a handoff to another company representative. A turn is {"speaker":"company"|"customer","text":"","mode":"prefill"|"free"|"choices","options":[]}. Any supplied customer wording must use mode "prefill". Use "choices" only for requested selectable options and "free" only for explicitly open-ended typing. Copy explicitly quoted dialogue verbatim; do not shorten it.\n\nReturn exactly this compact JSON shape, with only the ${channel} scenario key: {"companyName":"","initials":"","emailAddress":"","logoUrl":"","heroImageUrl":"","brandColor":"#0176D3","brandSecondaryColor":"#032D60","initialSender":"company","scenarios":{"${channel}":${channelSchema}}}. When dialogue is not supplied, keep each generated text under 240 characters. Do not invent facts or URLs.`;
}
function clean(value, fallback = '') { return typeof value === 'string' ? value.trim().slice(0,1800) : fallback; }
function cleanPrompt(value) { return typeof value === 'string' ? value.trim().slice(0,12_000) : ''; }
function color(value, fallback = '#0176D3') { const candidate = clean(value); return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate.toUpperCase() : fallback; }
function responses(value) { return Array.isArray(value) ? value.slice(0,3).map(item => ({ terms:clean(item?.terms,'').slice(0,140), response:clean(item?.response,'') })).filter(item => item.response) : []; }
function turns(value) { return Array.isArray(value) ? value.slice(0,16).map(turn => { const speaker=clean(turn?.speaker).toLowerCase()==='customer'?'customer':'company'; const mode=['prefill','free','choices'].includes(clean(turn?.mode).toLowerCase())?clean(turn?.mode).toLowerCase():'prefill'; return { speaker, text:clean(turn?.text), mode:speaker==='customer'?mode:undefined, options:Array.isArray(turn?.options)?turn.options.map(option=>clean(option)).filter(Boolean).slice(0,6):[] }; }).filter(turn => turn.text) : []; }
function normalizeDraft(raw, channels, website) {
  const hostname = new URL(website).hostname.replace(/^www\./,'');
  const scenarios = {};
  channels.forEach(channel => {
    const scenario = raw?.scenarios?.[channel] || {};
    scenarios[channel] = { title:clean(scenario.title,`${clean(raw?.companyName,'Company')} ${channel.toUpperCase()} conversation`), sender:clean(scenario.sender,clean(raw?.companyName,hostname)), initialMessage:clean(scenario.initialMessage), customerMessage:clean(scenario.customerMessage), subject:clean(scenario.subject,`A message from ${clean(raw?.companyName,hostname)}`), preheader:clean(scenario.preheader), initialBody:clean(scenario.initialBody), ctaLabel:clean(scenario.ctaLabel), ctaUrl:clean(scenario.ctaUrl), layout:['hero','simple'].includes(clean(scenario.layout)) ? clean(scenario.layout) : 'hero', prefilledReply:clean(scenario.prefilledReply), turns:turns(scenario.turns), keywords:responses(scenario.keywords), fallbackResponse:clean(scenario.fallbackResponse,'Thanks for reaching out. I can help you find the best next step.'), cards:Array.isArray(scenario.cards) ? scenario.cards.slice(0,4).map(card => ({ title:clean(card?.title,'Learn more'), description:clean(card?.description), cta:clean(card?.cta,'Learn more'), url:clean(card?.url), imageUrl:clean(card?.imageUrl) })) : [] };
  });
  return { companyName:clean(raw?.companyName,hostname), initials:clean(raw?.initials).replace(/[^A-Za-z0-9]/g,'').slice(0,3).toUpperCase(), emailAddress:clean(raw?.emailAddress,`hello@${hostname}`), logoUrl:clean(raw?.logoUrl), heroImageUrl:clean(raw?.heroImageUrl), brandColor:color(raw?.brandColor), brandSecondaryColor:color(raw?.brandSecondaryColor,'#032D60'), initialSender:clean(raw?.initialSender).toLowerCase()==='customer'?'customer':'company', scenarios };
}
function readJson(request) {
  return new Promise((resolve,reject) => {
    const chunks=[]; let size=0;
    request.on('data',chunk => { size += chunk.length; if (size > requestLimitBytes) { reject(Object.assign(new Error('request_too_large'), { code:'request_too_large' })); request.destroy(); } else chunks.push(chunk); });
    request.on('end',() => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(Object.assign(new Error('invalid_json'), { code:'invalid_json' })); } });
    request.on('error',reject);
  });
}
function validateDraftRequest(body) {
  const website = normalizedWebsiteUrl(clean(body?.website));
  const useCase = cleanPrompt(body?.useCase);
  const channels = [...new Set(Array.isArray(body?.channels) ? body.channels.filter(channel => ['sms','rcs','whatsapp','email'].includes(channel)) : [])];
  if (!website || !useCase || !channels.length) throw Object.assign(new Error('missing_required_fields'), { code:'missing_required_fields' });
  return { companyName:clean(body?.companyName), website, useCase, channels };
}
function requirementChecklist(draft, useCase) {
  const brief = storyBrief(useCase,draft?.companyName);
  const story = brief.story;
  const fields = [
    ['Customer',story.customer], ['Representative',story.representative], ['Opening topic',story.openingTopic], ['Customer question',story.questionTopic], ['Handoff topic',story.handoffTopic]
  ].filter(([,value]) => value && value.length >= 3);
  const canonical = draft?.scenarios?.sms || Object.values(draft?.scenarios || {})[0] || {};
  const generatedTurns = turns(canonical.turns);
  const transcript = Object.values(draft?.scenarios || {}).flatMap(scenario => [scenario.initialMessage,scenario.initialBody,...turns(scenario.turns).map(turn => turn.text)]).filter(Boolean).join('\n').toLowerCase();
  const items = fields.map(([label,value]) => ({ label, value, satisfied:transcript.includes(value.toLowerCase()) }));
  const initialSenderSatisfied = !brief.initialSender || draft?.initialSender === brief.initialSender && generatedTurns[0]?.speaker === brief.initialSender;
  const countSatisfied = !brief.expectedMessageCount || generatedTurns.length === brief.expectedMessageCount;
  const scriptedTurnsSatisfied = !brief.scriptedTurns.length || (brief.scriptedTurns.length === generatedTurns.length && brief.scriptedTurns.every((turn,index) => turn.speaker === generatedTurns[index]?.speaker && turn.text === generatedTurns[index]?.text));
  return { story, items, initialSender:brief.initialSender || null, initialSenderSatisfied, expectedMessageCount:brief.expectedMessageCount || null, actualMessageCount:generatedTurns.length, countSatisfied, scriptedTurns:brief.scriptedTurns.length, scriptedTurnsSatisfied, complete:items.every(item => item.satisfied) && initialSenderSatisfied && countSatisfied && scriptedTurnsSatisfied };
}
function errorStatus(code) {
  if (code === 'llm_not_configured') return 503;
  if (['invalid_url','blocked_url','blocked_host','missing_required_fields','request_too_large','invalid_json'].includes(code)) return 400;
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
  const request = validateDraftRequest(body);
  const cacheKey = createHash('sha256').update(JSON.stringify(request)).digest('hex');
  const cached = draftCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    console.log(JSON.stringify({ event:'scenario_draft_cache_hit', requestId }));
    return JSON.parse(JSON.stringify(cached.value));
  }
  const startedAt = Date.now();
  console.log(JSON.stringify({ event:'scenario_draft_started', requestId, channels:request.channels, website:new URL(request.website).hostname }));
  const remote = await fetchRemote(request.website,scrapeLimitBytes,true);
  console.log(JSON.stringify({ event:'scenario_draft_website_ready', requestId, elapsedMs:Date.now()-startedAt, bytes:remote.body.length, partial:Boolean(remote.partial) }));
  if (!/html|xml|text\//i.test(remote.contentType)) throw Object.assign(new Error('not_html'),{ code:'not_html' });
  const evidence = extractWebsite(remote.body.toString('utf8'),remote.url);
  console.log(JSON.stringify({ event:'scenario_draft_gemini_started', requestId, elapsedMs:Date.now()-startedAt, model:geminiModel, requests:1, channels:request.channels }));
  let canonical, fallbackReason='';
  try { canonical = await callGemini(draftPrompt({ companyName:request.companyName, website:remote.url, useCase:request.useCase, channels:['sms'], evidence })); }
  catch (error) {
    if (!['gemini_timeout','gemini_failed','gemini_bad_json'].includes(error?.code)) throw error;
    fallbackReason=error.code;
    canonical=fallbackDraft({ companyName:request.companyName, website:remote.url, useCase:request.useCase, evidence });
    console.log(JSON.stringify({ event:'scenario_draft_fallback', requestId, reason:fallbackReason, elapsedMs:Date.now()-startedAt }));
  }
  const promptComplete = enforceRequestedMessageCount(enforcePromptStory(preserveExplicitTurns(canonical,request.useCase),request.useCase,request.companyName),request.useCase,request.companyName);
  const ai = adaptCanonicalDraft(enforceRequestedInitialSender(promptComplete,request.useCase,request.companyName),request.channels);
  const draft = normalizeDraft(ai,request.channels,remote.url);
  const requirements = requirementChecklist(draft,request.useCase);
  console.log(JSON.stringify({ event:'scenario_draft_completed', requestId, elapsedMs:Date.now()-startedAt, requirementsComplete:requirements.complete }));
  const result = { draft, source:{ url:remote.url, title:evidence.title, imageCandidates:evidence.candidates, fallbackReason, brief:storyBrief(request.useCase,request.companyName) }, requirements };
  if (!fallbackReason) draftCache.set(cacheKey,{ expiresAt:Date.now()+draftCacheTtlMs, value:result });
  for (const [key,value] of draftCache) if (value.expiresAt <= Date.now()) draftCache.delete(key);
  return result;
}
function pruneGenerationJobs() {
  const threshold = Date.now() - generationJobTtlMs;
  for (const [id, job] of generationJobs) if (job.createdAt < threshold) generationJobs.delete(id);
  for (const [key, id] of idempotencyJobs) if (!generationJobs.has(id)) idempotencyJobs.delete(key);
  while (generationJobs.size > generationJobLimit) generationJobs.delete(generationJobs.keys().next().value);
}
function startGenerationJob(body, requestId, idempotencyKey = '') {
  pruneGenerationJobs();
  const existingId = idempotencyKey ? idempotencyJobs.get(idempotencyKey) : '';
  const existing = existingId ? generationJobs.get(existingId) : null;
  if (existing) return { job:existing, reused:true };
  const id = randomUUID();
  const job = { id, requestId, createdAt:Date.now(), updatedAt:Date.now(), startedAt:null, completedAt:null, status:'queued', result:null, error:null };
  generationJobs.set(id,job);
  if (idempotencyKey) idempotencyJobs.set(idempotencyKey,id);
  generationMetrics.started += 1;
  queueMicrotask(async () => {
    job.status='running'; job.startedAt=Date.now(); job.updatedAt=job.startedAt;
    try {
      job.result = await generateScenarioDraft(body,requestId);
      job.status='completed';
      generationMetrics.completed += 1;
      generationMetrics.totalDurationMs += Date.now() - job.startedAt;
      generationMetrics.lastCompletedAt = Date.now();
      if (job.result?.source?.fallbackReason) generationMetrics.fallback += 1;
    }
    catch (error) {
      job.error = error?.code || 'scenario_generation_failed';
      job.status='failed';
      generationMetrics.failed += 1;
      generationMetrics.lastFailureAt = Date.now();
      console.error(JSON.stringify({ event:'scenario_draft_failed', requestId, code:job.error, status:error?.status || null, name:error?.name || null, message:String(error?.message || '').slice(0,240) }));
    }
    finally { job.completedAt=Date.now(); job.updatedAt=job.completedAt; }
  });
  return { job, reused:false };
}
function publicJob(job) {
  const response = { id:job.id, status:job.status, createdAt:job.createdAt, updatedAt:job.updatedAt, durationMs:job.startedAt ? Math.max(0, (job.completedAt || Date.now()) - job.startedAt) : 0 };
  if (job.status === 'completed') Object.assign(response,job.result);
  if (job.status === 'failed') response.error=job.error;
  return response;
}
function sendFile(file,response) {
  stat(file,(error,details) => {
    if (error || !details.isFile()) { response.writeHead(404,{ 'Content-Type':'text/plain; charset=utf-8' }); response.end('Not found'); return; }
    const releaseCritical = path.basename(file) === 'interactive-simulator-builder.html' || file.includes(`${path.sep}assets${path.sep}v2${path.sep}`) || file.endsWith(`${path.sep}assets${path.sep}v2-modern.css`) || file.endsWith(`${path.sep}assets${path.sep}v2-modern.js`);
    response.writeHead(200,{ 'Content-Type':mimeTypes[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control':releaseCritical ? 'no-cache' : 'public, max-age=3600' });
    createReadStream(file).pipe(response);
  });
}
async function handleApi(request,response,url) {
  const requestId = request.headers['x-request-id']?.toString().slice(0,96) || randomUUID();
  if (request.method === 'GET' && url.pathname === '/api/health') { sendJson(response,200,{ ok:true, service:'two-way-experience-studio', version:appVersion, environment:appEnvironment, aiConfigured:Boolean(geminiApiKey), jobs:{ transient:true, retentionMinutes:generationJobTtlMs / 60_000, metrics:publicGenerationMetrics() } },requestId); return true; }
  const jobMatch = url.pathname.match(/^\/api\/scenario-jobs\/([0-9a-f-]{36})$/i);
  if (request.method === 'GET' && jobMatch) {
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
      const { job, reused } = startGenerationJob(body,requestId,idempotencyKey);
      sendJson(response,202,{ id:job.id, status:job.status, poll:`/api/scenario-jobs/${job.id}`, reused },requestId);
    } catch (error) { sendJson(response,errorStatus(error?.code),{ error:error?.code || 'scenario_generation_failed' },requestId); }
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/api/asset') {
    const requested = url.searchParams.get('url');
    if (!requested) { sendJson(response,400,{ error:'missing_url' }); return true; }
    try { const asset = await fetchRemote(requested,imageLimitBytes); if (!asset.contentType.toLowerCase().startsWith('image/')) throw Object.assign(new Error('not_an_image'),{ code:'not_an_image' }); if (url.searchParams.get('raw') === '1') { response.writeHead(200,{ 'Content-Type':asset.contentType.split(';')[0], 'Cache-Control':'private, max-age=300', 'X-Content-Type-Options':'nosniff' }); response.end(asset.body); } else sendJson(response,200,{ dataUrl:`data:${asset.contentType.split(';')[0]};base64,${asset.body.toString('base64')}` }); }
    catch (error) { sendJson(response,502,{ error:error.code || 'asset_fetch_failed' }); }
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/scenario-draft') {
    if (!withinRateLimit(request)) { sendJson(response,429,{ error:'rate_limited' },requestId); return true; }
    try {
      const result = await generateScenarioDraft(await readJson(request),requestId);
      sendJson(response,200,result,requestId);
    } catch (error) { const code=error?.code || 'scenario_generation_failed'; console.error(JSON.stringify({ event:'scenario_draft_failed', requestId, code, status:error?.status || null, name:error?.name || null, message:String(error?.message || '').slice(0,240) })); sendJson(response,errorStatus(code),{ error:code },requestId); }
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
  const file = path.resolve(root,relativePath);
  if (!file.startsWith(`${root}${path.sep}`)) { response.writeHead(400); response.end('Invalid path'); return; }
  sendFile(file,response);
}).listen(port,() => console.log(`Two-Way Experience Studio ${appVersion} is running on port ${port} (${appEnvironment}); AI setup: ${geminiApiKey ? 'configured':'needs GEMINI_API_KEY'}`));
