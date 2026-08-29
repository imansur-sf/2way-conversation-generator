const http = require('node:http');
const { createReadStream, stat } = require('node:fs');
const { lookup } = require('node:dns').promises;
const net = require('node:net');
const path = require('node:path');

const port = Number(process.env.PORT) || 3000;
const root = __dirname;
const geminiApiKey = process.env.GEMINI_API_KEY || '';
const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const scrapeLimitBytes = 500_000;
const imageLimitBytes = 2_000_000;
const requestLimitBytes = 200_000;
const requestTimeoutMs = 15_000;
const rateWindowMs = 60_000;
const perMinuteLimit = 12;
const rateBuckets = new Map();
const mimeTypes = { '.css':'text/css; charset=utf-8', '.gif':'image/gif', '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.svg':'image/svg+xml' };

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' });
  response.end(JSON.stringify(body));
}
function clientIp(request) { return request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.socket.remoteAddress || 'unknown'; }
function withinRateLimit(request) {
  const now = Date.now(), key = clientIp(request), bucket = rateBuckets.get(key);
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
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`, { method:'POST', headers:{ 'Content-Type':'application/json' }, signal:controller.signal, body:JSON.stringify({ contents:[{ parts:[{ text:prompt }] }], generationConfig:{ responseMimeType:'application/json', maxOutputTokens:3600 } }) });
    if (!upstream.ok) {
      const detail = (await upstream.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
      const code = upstream.status === 400 ? 'gemini_bad_request' : upstream.status === 401 || upstream.status === 403 ? 'gemini_auth_failed' : upstream.status === 404 ? 'gemini_model_not_found' : upstream.status === 429 ? 'gemini_rate_limited' : 'gemini_failed';
      console.error(JSON.stringify({ event:'gemini_request_failed', status:upstream.status, model:geminiModel, detail }));
      throw Object.assign(new Error(code), { code, status:upstream.status });
    }
    const payload = await upstream.json();
    return parseJson(payload?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '');
  } catch (error) {
    if (error?.name === 'AbortError') throw Object.assign(new Error('gemini_timeout'), { code:'gemini_timeout' });
    throw error;
  } finally { clearTimeout(timeout); }
}
function draftPrompt({ companyName, website, useCase, channels, evidence }) {
  const images = evidence.candidates.map((item,index) => `${index + 1}. ${item.role}: ${item.url}`).join('\n') || '(none)';
  return `Create concise, realistic Salesforce two-way messaging demo content. Return JSON only.\nCompany supplied: ${companyName || '(not supplied)'}\nWebsite: ${website}\nUse case: ${useCase}\nChannels: ${channels.join(', ')}\n\nWebsite evidence:\nTitle: ${evidence.title}\nDescription: ${evidence.description}\nHeadings: ${evidence.headings.slice(0,10).join(' | ')}\nText: ${evidence.text.slice(0,3500)}\nImage candidates (only use these URLs or empty strings):\n${images}\n\nReturn: {"companyName":"","initials":"","emailAddress":"","logoUrl":"","heroImageUrl":"","scenarios":{"sms":{"title":"","sender":"","initialMessage":"","keywords":[{"terms":"","response":""}],"fallbackResponse":""},"rcs":{"title":"","initialMessage":"","keywords":[{"terms":"","response":""}],"fallbackResponse":"","cards":[{"title":"","description":"","cta":"","url":"","imageUrl":""}]},"email":{"title":"","subject":"","initialBody":"","prefilledReply":"","keywords":[{"terms":"","response":""}],"fallbackResponse":""}}}. Include only requested channel keys. Use exactly 2 keyword responses and one fallback per requested channel; include at most 2 RCS cards. Keep every text field under 240 characters. Do not invent URLs or facts not supported by the evidence.`;
}
function clean(value, fallback = '') { return typeof value === 'string' ? value.trim().slice(0,1800) : fallback; }
function responses(value) { return Array.isArray(value) ? value.slice(0,3).map(item => ({ terms:clean(item?.terms,'').slice(0,140), response:clean(item?.response,'') })).filter(item => item.response) : []; }
function normalizeDraft(raw, channels, website) {
  const hostname = new URL(website).hostname.replace(/^www\./,'');
  const scenarios = {};
  channels.forEach(channel => {
    const scenario = raw?.scenarios?.[channel] || {};
    scenarios[channel] = { title:clean(scenario.title,`${clean(raw?.companyName,'Company')} ${channel.toUpperCase()} conversation`), sender:clean(scenario.sender,clean(raw?.companyName,hostname)), initialMessage:clean(scenario.initialMessage), subject:clean(scenario.subject,`A message from ${clean(raw?.companyName,hostname)}`), initialBody:clean(scenario.initialBody), prefilledReply:clean(scenario.prefilledReply), keywords:responses(scenario.keywords), fallbackResponse:clean(scenario.fallbackResponse,'Thanks for reaching out. I can help you find the best next step.'), cards:Array.isArray(scenario.cards) ? scenario.cards.slice(0,4).map(card => ({ title:clean(card?.title,'Learn more'), description:clean(card?.description), cta:clean(card?.cta,'Learn more'), url:clean(card?.url), imageUrl:clean(card?.imageUrl) })) : [] };
  });
  return { companyName:clean(raw?.companyName,hostname), initials:clean(raw?.initials).replace(/[^A-Za-z0-9]/g,'').slice(0,3).toUpperCase(), emailAddress:clean(raw?.emailAddress,`hello@${hostname}`), logoUrl:clean(raw?.logoUrl), heroImageUrl:clean(raw?.heroImageUrl), scenarios };
}
function readJson(request) {
  return new Promise((resolve,reject) => {
    const chunks=[]; let size=0;
    request.on('data',chunk => { size += chunk.length; if (size > requestLimitBytes) { reject(Object.assign(new Error('request_too_large'), { code:'request_too_large' })); request.destroy(); } else chunks.push(chunk); });
    request.on('end',() => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(Object.assign(new Error('invalid_json'), { code:'invalid_json' })); } });
    request.on('error',reject);
  });
}
function sendFile(file,response) {
  stat(file,(error,details) => {
    if (error || !details.isFile()) { response.writeHead(404,{ 'Content-Type':'text/plain; charset=utf-8' }); response.end('Not found'); return; }
    response.writeHead(200,{ 'Content-Type':mimeTypes[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control':'public, max-age=3600' });
    createReadStream(file).pipe(response);
  });
}
async function handleApi(request,response,url) {
  if (request.method === 'GET' && url.pathname === '/api/health') { sendJson(response,200,{ ok:true, service:'two-way-experience-studio', aiConfigured:Boolean(geminiApiKey) }); return true; }
  if (request.method === 'GET' && url.pathname === '/api/asset') {
    const requested = url.searchParams.get('url');
    if (!requested) { sendJson(response,400,{ error:'missing_url' }); return true; }
    try { const asset = await fetchRemote(requested,imageLimitBytes); if (!asset.contentType.toLowerCase().startsWith('image/')) throw Object.assign(new Error('not_an_image'),{ code:'not_an_image' }); sendJson(response,200,{ dataUrl:`data:${asset.contentType.split(';')[0]};base64,${asset.body.toString('base64')}` }); }
    catch (error) { sendJson(response,502,{ error:error.code || 'asset_fetch_failed' }); }
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/scenario-draft') {
    if (!withinRateLimit(request)) { sendJson(response,429,{ error:'rate_limited' }); return true; }
    try {
      const body = await readJson(request), website = normalizedWebsiteUrl(clean(body.website)), useCase = clean(body.useCase), channels = Array.isArray(body.channels) ? body.channels.filter(channel => ['sms','rcs','email'].includes(channel)) : [];
      if (!website || !useCase || !channels.length) { sendJson(response,400,{ error:'missing_required_fields' }); return true; }
      const remote = await fetchRemote(website,scrapeLimitBytes,true);
      if (!/html|xml|text\//i.test(remote.contentType)) throw Object.assign(new Error('not_html'),{ code:'not_html' });
      const evidence = extractWebsite(remote.body.toString('utf8'),remote.url);
      const ai = await callGemini(draftPrompt({ companyName:clean(body.companyName), website:remote.url, useCase, channels, evidence }));
      sendJson(response,200,{ draft:normalizeDraft(ai,channels,remote.url), source:{ url:remote.url, title:evidence.title, imageCandidates:evidence.candidates } });
    } catch (error) { const code=error?.code || 'scenario_generation_failed'; console.error(JSON.stringify({ event:'scenario_draft_failed', code, status:error?.status || null })); const status = code === 'llm_not_configured' ? 503 : ['invalid_url','blocked_url','blocked_host','missing_required_fields'].includes(code) ? 400 : 502; sendJson(response,status,{ error:code }); }
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
}).listen(port,() => console.log(`Two-Way Experience Studio is running on port ${port}; AI setup: ${geminiApiKey ? 'configured':'needs GEMINI_API_KEY'}`));
