const dns = require('node:dns').promises;
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const path = require('node:path');

const failure = code => Object.assign(new Error(code), { code });
const svgContentSecurityPolicy = "sandbox; default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";
const supportedImageTypes = new Set(['image/png','image/jpeg','image/gif','image/webp','image/avif','image/svg+xml','image/x-icon','image/vnd.microsoft.icon']);

function ipv6Words(address) {
  let value = address.toLowerCase();
  if (value.includes('.')) {
    const index = value.lastIndexOf(':'), bytes = value.slice(index + 1).split('.').map(Number);
    value = `${value.slice(0,index)}:${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`;
  }
  const halves = value.split('::'), left = halves[0] ? halves[0].split(':') : [], right = halves[1] ? halves[1].split(':') : [];
  return [...left, ...Array(8 - left.length - right.length).fill('0'), ...right].map(word => parseInt(word,16));
}

function privateIp(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const [a,b,c] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113);
  }
  if (family !== 6) return true;
  const words = ipv6Words(address);
  if (words.slice(0,5).every(word => word === 0) && words[5] === 0xffff) {
    return privateIp(`${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`);
  }
  // Only global unicast is eligible; exclude special-purpose, documentation and 6to4 ranges.
  return (words[0] & 0xe000) !== 0x2000 || words[0] === 0x2002 ||
    (words[0] === 0x2001 && (words[1] <= 0x01ff || words[1] === 0x0db8)) ||
    (words[0] === 0x3fff && words[1] <= 0x0fff);
}

function normalizedIp(value) {
  if (net.isIP(value) === 6) {
    const words = ipv6Words(value);
    if (words.slice(0,5).every(word => word === 0) && words[5] === 0xffff) return `${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`;
    return words.map(word => word.toString(16)).join(':');
  }
  return net.isIP(value) === 4 ? value : '';
}

function clientIp(request, trustHeroku = false) {
  // Heroku appends its observed peer on the right. Client-supplied entries to its left are untrusted.
  const forwarded = trustHeroku ? String(request.headers['x-forwarded-for'] || '').split(',').at(-1).trim() : '';
  return normalizedIp(forwarded) || normalizedIp(request.socket.remoteAddress || '') || 'unknown';
}

function allowedPublicPath(relativePath) {
  if (relativePath === 'interactive-simulator-builder.html') return true;
  const segments = relativePath.split(/[\\/]/);
  if (segments[0] !== 'assets' || segments.some(segment => !segment || segment.startsWith('.'))) return false;
  return /\.(?:css|js|png|jpe?g|gif|webp|avif|svg|ico|woff2?)$/i.test(relativePath);
}

function publicFilePath(root, relativePath) {
  if (!allowedPublicPath(relativePath)) return null;
  const file = path.resolve(root,relativePath);
  return file.startsWith(`${root}${path.sep}`) ? file : null;
}

function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve,reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort',abort,{ once:true });
    Promise.resolve(promise).then(resolve,reject).finally(() => signal.removeEventListener('abort',abort));
  });
}

async function safeUrl(value, { lookup = dns.lookup, signal } = {}) {
  let url;
  try { url = new URL(value); } catch { throw failure('invalid_url'); }
  const host = url.hostname.replace(/^\[|\]$/g,'').replace(/\.$/,'').toLowerCase();
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password ||
      (url.port && !['80','443'].includes(url.port)) || !host || host === 'localhost' || host.endsWith('.localhost') ||
      host === 'metadata.google.internal' || host.endsWith('.local') || host.endsWith('.internal')) throw failure('blocked_url');
  const literalFamily = net.isIP(host);
  const pending = literalFamily ? Promise.resolve([{ address:host, family:literalFamily }]) : lookup(host,{ all:true, verbatim:true });
  const addresses = signal ? await abortable(pending,signal) : await pending;
  if (!addresses.length || addresses.some(item => privateIp(item.address))) throw failure('blocked_host');
  // Prefer IPv4 when both are published; common hosted runtimes do not have IPv6 egress.
  const selected = addresses.find(item => net.isIP(item.address) === 4) || addresses[0];
  return { url, address:selected.address, family:net.isIP(selected.address) };
}

function createRemoteFetcher({ lookup = dns.lookup, httpRequest = http.request, httpsRequest = https.request, timeoutMs = 7000, maxConcurrent = 12 } = {}) {
  let active = 0;
  function requestOnce(target, maxBytes, allowPartial, signal) {
    return new Promise((resolve,reject) => {
      const request = target.url.protocol === 'https:' ? httpsRequest : httpRequest;
      let settled = false;
      const finish = (error,value) => { if (settled) return; settled=true; error ? reject(error) : resolve(value); };
      const upstreamRequest = request(target.url,{
        method:'GET', agent:false, autoSelectFamily:false, signal,
        lookup:(_host,options,callback) => options.all
          ? callback(null,[{ address:target.address, family:target.family }])
          : callback(null,target.address,target.family),
        headers:{ 'User-Agent':'SaaSy-TwoWay-Experience-Studio/1.0', 'Accept':'text/html,application/xhtml+xml,image/*,*/*;q=0.8', 'Accept-Encoding':'identity' }
      },upstream => {
        upstream.on('error',error => finish(error));
        upstream.on('aborted',() => finish(failure('website_fetch_failed')));
        const status = upstream.statusCode || 0;
        if (status >= 300 && status < 400) {
          finish(upstream.headers.location ? null : failure('bad_redirect'), { location:upstream.headers.location });
          upstream.destroy(); return;
        }
        if (status < 200 || status >= 300) { finish(Object.assign(failure('upstream_status'),{status})); upstream.destroy(); return; }
        if (!allowPartial && Number(upstream.headers['content-length'] || 0) > maxBytes) { finish(failure('too_large')); upstream.destroy(); return; }
        const chunks=[]; let total=0;
        const result = partial => ({ url:target.url.toString(), contentType:upstream.headers['content-type'] || '', body:Buffer.concat(chunks), partial });
        upstream.on('data',chunk => {
          if (settled) return;
          const remaining = maxBytes - total;
          if (chunk.length > remaining) {
            if (allowPartial && remaining > 0) chunks.push(chunk.subarray(0,remaining));
            finish(allowPartial ? null : failure('too_large'),allowPartial ? result(true) : undefined);
            upstream.destroy(); return;
          }
          chunks.push(chunk); total += chunk.length;
        });
        upstream.on('end',() => finish(null,result(false)));
      });
      upstreamRequest.on('error',error => finish(error));
      upstreamRequest.end();
    });
  }
  return async function fetchRemote(value,maxBytes,allowPartial=false) {
    if (active >= maxConcurrent) throw failure('remote_busy');
    active += 1;
    const controller=new AbortController(), timeout=setTimeout(() => controller.abort(failure('request_timeout')),timeoutMs);
    try {
      let next = value;
      for (let redirects=0; redirects<4; redirects+=1) {
        const target = await safeUrl(next,{lookup,signal:controller.signal});
        const result = await abortable(requestOnce(target,maxBytes,allowPartial,controller.signal),controller.signal);
        if (!result.location) return result;
        next = new URL(result.location,target.url).toString();
      }
      throw failure('too_many_redirects');
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (!error?.code) throw failure('website_fetch_failed');
      throw error;
    } finally { clearTimeout(timeout); active -= 1; }
  };
}

module.exports = { allowedPublicPath, clientIp, createRemoteFetcher, privateIp, publicFilePath, safeUrl, supportedImageTypes, svgContentSecurityPolicy };
