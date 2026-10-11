'use strict';

function candidateUrl(value) {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.href.length <= 2048 ? url.href : '';
  } catch { return ''; }
}

// This is page-discovered evidence, not provider output or verified image bytes.
// Image preview/embedding must still use the guarded asset endpoint.
function websiteBranding(request, evidence, partial = false) {
  const imageCandidates = [], seen = new Set();
  for (const candidate of evidence.candidates || []) {
    const url = candidateUrl(candidate?.url), role = candidate?.role;
    if (!url || !['logo', 'hero', 'image'].includes(role) || seen.has(url)) continue;
    seen.add(url);
    imageCandidates.push({ url, role });
    if (imageCandidates.length === 16) break;
  }
  return {
    schemaVersion:1,
    mode:'website-only',
    companyName:request.companyName || '',
    requestedWebsite:request.website,
    requestedChannels:[...request.channels],
    source:{ url:evidence.url, title:String(evidence.title || '').slice(0,300), assets:'unverified', partial:Boolean(partial) },
    imageCandidates,
  };
}

module.exports = { websiteBranding };
