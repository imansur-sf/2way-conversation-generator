/* Runs before the large builder bundle so even a parse-time failure can be
   recovered and reported. It intentionally carries no scenario content. */
(() => {
  const standalone = document.body?.classList.contains('export');
  const flag = 'two-way-experience-studio-v2-bootstrap-recovery-v2';
  const notice = 'two-way-experience-studio-v2-bootstrap-recovered';
  const skipLegacy = 'two-way-experience-studio-v2-bootstrap-skip-legacy';
  const idbFlag = 'two-way-experience-studio-v2-idb-restored';
  const quarantine = 'two-way-experience-studio-v2-quarantined-scenarios';
  let ready = false;

  const status = () => document.getElementById('bootstrapStatus');
  const failure = () => document.getElementById('bootstrapFailure');
  const text = value => String(value || '').replace(/[\r\n\t]/g, ' ').slice(0, 400);
  const sourcePath = value => { try { const url = new URL(value, location.href); return url.pathname; } catch { return ''; } };
  const report = (kind, details = {}) => {
    if (standalone) return;
    try {
      const payload = JSON.stringify({ kind:text(kind), phase:'pre-builder', message:text(details.message), source:sourcePath(details.source), line:Number(details.line) || null, column:Number(details.column) || null });
      const blob = new Blob([payload], { type:'application/json' });
      if (navigator.sendBeacon?.('/api/client-diagnostic', blob)) return;
      fetch('/api/client-diagnostic', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:payload, keepalive:true }).catch(() => {});
    } catch {}
  };
  const escapeHtml = value => text(value).replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
  const showFailure = (details = {}) => {
    const node = failure();
    if (!node) return;
    node.hidden = false;
    const location = [sourcePath(details.source), details.line ? `line ${details.line}` : '', details.column ? `column ${details.column}` : ''].filter(Boolean).join(' · ');
    node.innerHTML = `<strong>The builder could not start in this browser profile.</strong><span>${escapeHtml(details.message || 'Browser scripts were blocked or stopped before the app could load.')}</span>${location ? `<small>${escapeHtml(location)}</small>` : ''}`;
    node.style.cssText = 'display:grid;gap:8px;max-width:480px;padding:20px;border:1px solid #f1b8b8;border-radius:14px;background:#fff7f7;color:#7b1e1e;font:600 14px/1.45 Inter,Arial,sans-serif;box-shadow:0 12px 28px #50141418';
  };
  const resetSavedState = () => {
    const keys = ['two-way-experience-studio-v2-scenarios', 'two-way-studio-v4', 'two-way-studio-v3'];
    const snapshot = Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)]).filter(([, value]) => value));
    if (Object.keys(snapshot).length) localStorage.setItem(quarantine, JSON.stringify({ recoveredAt:new Date().toISOString(), snapshot }));
    keys.forEach(key => localStorage.removeItem(key));
    sessionStorage.setItem(skipLegacy, '1');
    sessionStorage.setItem(idbFlag, '1');
  };
  const recover = details => {
    if (standalone || ready) return;
    try {
      if (sessionStorage.getItem(flag)) { showFailure(details); return; }
      sessionStorage.setItem(flag, '1');
      sessionStorage.setItem(notice, '1');
      resetSavedState();
      location.reload();
    } catch { showFailure(details); }
  };

  window.__twoWayBootstrapGuardReady = () => { ready = true; const node = status(); if (node) node.hidden = true; };
  window.addEventListener('error', event => {
    const error = event.error;
    if (!error || ready) return;
    report('error', { message:error.message || event.message, source:event.filename, line:event.lineno, column:event.colno });
    recover({ message:error.message || event.message, source:event.filename, line:event.lineno, column:event.colno });
  }, true);
  window.addEventListener('unhandledrejection', event => {
    if (ready) return;
    report('unhandled-rejection', { message:event.reason?.message || event.reason });
    recover({ message:event.reason?.message || event.reason });
  });
})();
