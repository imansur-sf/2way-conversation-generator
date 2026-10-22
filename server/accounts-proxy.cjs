const DEFAULT_ACCOUNTS_URL = 'https://sassysolutions-accounts-8215113235cf.aster-virginia.herokuapp.com';

function createAccountsProxy({ baseUrl = process.env.SAASY_ACCOUNTS_URL || DEFAULT_ACCOUNTS_URL, timeoutMs = 30000 } = {}) {
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('Invalid SAASY_ACCOUNTS_URL');
  return async function accountsProxy(request, response) {
    const url = new URL(request.url, 'http://studio.local');
    const project = /^\/projects(?:\/[1-9]\d{0,18})?$/.test(url.pathname);
    const auth = ['/auth/config', '/auth/request-code', '/auth/verify', '/auth/magic/verify'].includes(url.pathname);
    const widget = url.pathname === '/saasy-auth.js';
    const feedbackId = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
    const feedback = new RegExp('^/feedback(?:/(?:session|inbox(?:/' + feedbackId + '(?:/attachments/' + feedbackId + ')?)?))?$','i').test(url.pathname);
    const attachment = feedback && url.pathname.includes('/attachments/');
    if (!project && !auth && !widget && !feedback) return false;
    const unavailable = feedback ? 'feedback_service_unavailable' : 'sign_in_service_unavailable';
    const reply = (status, error) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify({ error }));
    };
    const allowed = feedback ? (url.pathname === '/feedback' ? ['POST'] : (url.pathname === '/feedback/session' || url.pathname === '/feedback/inbox' || attachment) ? ['GET'] : ['GET','PUT','DELETE']) : widget || url.pathname === '/auth/config' ? ['GET', 'HEAD'] : auth ? ['POST'] : url.pathname === '/projects' ? ['GET', 'POST'] : ['GET', 'PUT', 'DELETE'];
    if (!allowed.includes(request.method)) { reply(405, 'method_not_allowed'); return true; }
    if (feedback) {
      const tools = url.searchParams.getAll('tool');
      if (tools.length > 1 || (tools.length && tools[0] !== 'twoway')) { reply(400, 'invalid_feedback_tool'); request.resume(); return true; }
      url.searchParams.set('tool', 'twoway');
    }
    const limit = (project ? 20 : feedback ? 5 : 1) * 1024 * 1024;
    if (Number(request.headers['content-length']) > limit) { reply(413, 'payload_too_large'); request.resume(); return true; }
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), timeoutMs);
    const aborted = () => controller.abort();
    request.once('aborted', aborted);
    try {
      let body = await new Promise((resolve, reject) => {
        const chunks = []; let bytes = 0;
        const cleanup = () => { request.removeListener('data', data); request.removeListener('end', end); request.removeListener('error', failed); controller.signal.removeEventListener('abort', failed); };
        const failed = () => { cleanup(); request.resume(); reject(new Error('request_failed')); };
        const end = () => { cleanup(); resolve(Buffer.concat(chunks)); };
        const data = chunk => {
          bytes += chunk.length;
          if (bytes > limit) { cleanup(); request.resume(); reject(Object.assign(new Error('payload_too_large'), { status: 413 })); return; }
          chunks.push(chunk);
        };
        request.on('data', data); request.once('end', end); request.once('error', failed); controller.signal.addEventListener('abort', failed, { once: true });
      });
      if (feedback && request.method === 'POST') {
        let parsed;
        try { parsed = JSON.parse(body.toString()); } catch (_) { reply(400, 'invalid_feedback'); return true; }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { reply(400, 'invalid_feedback'); return true; }
        if (parsed.tool !== undefined && parsed.tool !== 'twoway') { reply(400, 'invalid_feedback_tool'); return true; }
        body = Buffer.from(JSON.stringify({ ...parsed, tool: 'twoway' }));
        if (body.length > limit) { reply(413, 'payload_too_large'); return true; }
      }
      const headers = {};
      for (const key of ['accept', 'authorization', 'content-type', 'idempotency-key']) if (request.headers[key]) headers[key] = request.headers[key];
      const upstream = await fetch(base.origin + url.pathname + url.search, {
        method: request.method, headers, redirect: 'manual', signal: controller.signal,
        ...(!['GET', 'HEAD'].includes(request.method) ? { body } : {})
      });
      if (upstream.status >= 300 && upstream.status < 400) { reply(502, unavailable); return true; }
      const upstreamBody = Buffer.from(await upstream.arrayBuffer());
      response.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') || 'application/json',
        'Cache-Control': feedback ? 'private, no-store' : 'no-store', 'X-Content-Type-Options': 'nosniff',
        ...(attachment ? { 'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Disposition': upstream.headers.get('content-disposition') || 'inline' } : {}),
        ...(upstream.headers.get('retry-after') ? { 'Retry-After': upstream.headers.get('retry-after') } : {})
      });
      response.end(upstreamBody);
    } catch (error) {
      if (!response.headersSent && !response.destroyed) reply(error.status || 502, error.status === 413 ? 'payload_too_large' : unavailable);
    } finally {
      clearTimeout(deadline); request.removeListener('aborted', aborted);
    }
    return true;
  };
}

module.exports = { createAccountsProxy, DEFAULT_ACCOUNTS_URL };
