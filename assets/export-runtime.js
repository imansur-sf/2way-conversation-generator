/* Build exports from the shipped template, never from the live editor DOM. */
(function (global) {
  'use strict';

  const uiAssets = ['assets/vendor/purify.min.js', 'assets/email-safety.js', 'assets/ai-draft.js', 'assets/export-runtime.js', 'assets/v2/live-region.js', 'assets/v2/preview-fit.js', 'assets/v2-modern.js'];
  const imageFields = new Set(['avatar', 'recipientAvatar', 'emailLogo', 'emailHeroImage', 'cardImage', 'image', 'imageUrl']);
  const inlineUrl = value => !value || /^(?:data:|#)/i.test(value);
  const safeJson = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const runtimeImagePattern = /(["'])(assets\/[A-Za-z0-9_./-]+\.(?:png|gif|jpe?g|webp|svg)(?:[?#][^"'\s<>]*)?)\1/gi;
  let labels = new Map();
  const embeddedAssets = JSON.parse(document.querySelector('#standalone-asset-data')?.textContent || '{}');

  function activeChannelScenario(scenario) {
    const selected = JSON.parse(JSON.stringify(scenario));
    delete selected.variants;
    selected.scenarioMode = 'single';
    return selected;
  }

  function locationLabel(path) {
    return path.replace(/^scenario\.steps\[(\d+)\]/, (_, index) => `Message ${Number(index) + 1}`)
      .replace(/^scenario\./, 'Company ').replace(/\.cards\[(\d+)\]/g, (_, index) => ` card ${Number(index) + 1}`)
      .replace(/\.replyActions\[(\d+)\]/g, (_, index) => ` reply ${Number(index) + 1}`)
      .replace(/\.(customHtml|emailHtml)/g, ' email content').replace(/[._]/g, ' ');
  }

  function srcsetParts(value) {
    // Data URLs contain commas; their URL token ends at whitespace, not a comma.
    const parts = [];
    let rest = String(value || '').trim();
    while (rest) {
      const match = /^(data:[^\s]+|[^\s,]+)(?:\s+([^,]+))?\s*,?\s*/i.exec(rest);
      if (!match) break;
      parts.push({ url:match[1].replace(/,$/, ''), descriptor:(match[2] || '').trim() });
      rest = rest.slice(match[0].length);
    }
    return parts;
  }

  function cssReferences(source) {
    const references = [];
    const imageSetDepths = new Set();
    let depth = 0;
    const decodeUrl = raw => String(raw || '').trim().replace(/\\([a-f\d]{1,6})\s?|\\([^\r\n])/gi, (_, hex, literal) => hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff) || 0xfffd) : literal);
    for (let index = 0; index < source.length;) {
      if (source.startsWith('/*', index)) {
        const end = source.indexOf('*/', index + 2);
        index = end < 0 ? source.length : end + 2;
        continue;
      }
      if (source[index] === '"' || source[index] === "'") {
        const start = index;
        const quote = source[index++];
        while (index < source.length) { if (source[index++] === '\\') index++; else if (source[index - 1] === quote) break; }
        if (imageSetDepths.has(depth)) references.push({ start, end:index, raw:source.slice(start, index), url:decodeUrl(source.slice(start + 1, index - 1)), imported:false, condition:'' });
        continue;
      }
      const rest = source.slice(index);
      const imageSet = /^(?:-webkit-)?image-set\(/i.exec(rest);
      if (imageSet) { imageSetDepths.add(++depth); index += imageSet[0].length; continue; }
      const imported = /^@import\s+(?:url\(\s*(?:(["'])((?:\\.|[^\\])*?)\1|([^)]*?))\s*\)|(["'])((?:\\.|[^\\])*?)\4)\s*([^;]*);/i.exec(rest);
      const image = !/[\w-]/.test(source[index - 1] || '') && /^url\(\s*(?:(["'])((?:\\.|[^\\])*?)\1|((?:\\.|[^)])*?))\s*\)/i.exec(rest);
      const match = imported || image;
      if (!match) {
        if (source[index] === '(') depth++;
        else if (source[index] === ')') { imageSetDepths.delete(depth); depth = Math.max(0, depth - 1); }
        index++; continue;
      }
      const raw = imported ? match[2] ?? match[3] ?? match[5] : match[2] ?? match[3];
      const url = decodeUrl(raw);
      references.push({ start:index, end:index + match[0].length, raw:match[0], url, imported:Boolean(imported), condition:imported ? match[6].trim() : '' });
      index += match[0].length;
    }
    return references;
  }

  async function prepare({ scenario, fetchText, fetchAsset, allowMissingAssets = false }) {
    labels = new Map();
    const selected = activeChannelScenario(scenario);
    const resources = new Map();
    const failures = new Map();
    const templatePath = 'interactive-simulator-builder.html';
    labels.set(templatePath, 'offline export template');
    let template;
    try { template = await fetchText(templatePath); }
    catch (error) { error.exportAssetPaths = [templatePath]; error.exportRequiredAssetPaths = [templatePath]; throw error; }
    const doc = new DOMParser().parseFromString(template, 'text/html');
    const base = new URL(templatePath, global.location.href).href;
    const resolveUrl = (url, relativeTo = base) => { try { return new URL(url, relativeTo).href; } catch { return url; } };

    const getResource = (raw, label, kind = 'image', relativeTo = base) => {
      const source = String(raw || '').trim();
      if (inlineUrl(source)) return Promise.resolve(source);
      const url = resolveUrl(source, relativeTo);
      const key = `${kind}:${url}`;
      labels.set(url, [...new Set([labels.get(url), label].filter(Boolean))].join('; '));
      labels.set(source, labels.get(url));
      if (!resources.has(key)) resources.set(key, (async () => {
        try {
          if (!/^(?:https?:|blob:|file:)/i.test(url)) throw new Error('Unsupported asset URL');
          return await (kind === 'text' ? fetchText(url) : fetchAsset(url));
        } catch (error) {
          failures.set(url, { path:url, reason:error.exportAssetReason || error.message, required:kind === 'text' });
          return source;
        }
      })());
      return resources.get(key);
    };

    const rewriteCss = async (css, label, relativeTo = base, parents = new Set()) => {
      let source = String(css || '');
      // Inline imported stylesheets first so their relative image URLs keep the correct base.
      const imports = cssReferences(source).filter(reference => reference.imported);
      for (const reference of imports.reverse()) {
        const url = resolveUrl(reference.url, relativeTo);
        if (parents.has(url)) { source = source.slice(0, reference.start) + source.slice(reference.end); continue; }
        const imported = await getResource(url, `${label} stylesheet`, 'text', relativeTo);
        if (failures.has(url)) continue;
        const nested = await rewriteCss(imported, label, url, new Set([...parents, url]));
        source = source.slice(0, reference.start) + (reference.condition ? `@media ${reference.condition}{${nested}}` : nested) + source.slice(reference.end);
      }
      const references = cssReferences(source).filter(reference => !reference.imported);
      const replacements = await Promise.all(references.map(async reference => {
        const embedded = await getResource(reference.url, `${label} CSS image`, 'image', relativeTo);
        return { start:reference.start, end:reference.end, value:`url("${embedded.replace(/"/g, '%22')}")` };
      }));
      for (const item of replacements.reverse()) source = source.slice(0, item.start) + item.value + source.slice(item.end);
      return source;
    };

    const rewriteMarkup = async (markup, label, relativeTo = base) => {
      const parsed = new DOMParser().parseFromString(String(markup || ''), 'text/html');
      relativeTo = resolveUrl(parsed.querySelector('base[href]')?.getAttribute('href') || relativeTo, relativeTo);
      const tasks = [];
      for (const node of parsed.querySelectorAll('img[src], input[type="image"][src], source[src], video[poster], [background], image[href], image[xlink\\:href]')) {
        for (const attr of ['src', 'poster', 'background', 'href', 'xlink:href']) {
          if (!node.hasAttribute(attr)) continue;
          tasks.push(getResource(node.getAttribute(attr), `${label} ${node.localName} ${attr}`, 'image', relativeTo).then(value => node.setAttribute(attr, value)));
        }
      }
      for (const node of parsed.querySelectorAll('[srcset]')) tasks.push((async () => {
        const parts = await Promise.all(srcsetParts(node.getAttribute('srcset')).map(async part => `${await getResource(part.url, `${label} responsive image`, 'image', relativeTo)}${part.descriptor ? ` ${part.descriptor}` : ''}`));
        node.setAttribute('srcset', parts.join(', '));
      })());
      for (const node of parsed.querySelectorAll('[style]')) tasks.push(rewriteCss(node.getAttribute('style'), label, relativeTo).then(value => node.setAttribute('style', value)));
      for (const node of parsed.querySelectorAll('style')) tasks.push(rewriteCss(node.textContent, label, relativeTo).then(value => { node.textContent = value; }));
      for (const node of parsed.querySelectorAll('link[rel="stylesheet"][href]')) tasks.push((async () => {
        const url = resolveUrl(node.getAttribute('href'), relativeTo);
        const source = await getResource(url, `${label} stylesheet`, 'text', relativeTo);
        if (failures.has(url)) return;
        const style = parsed.createElement('style');
        if (node.hasAttribute('media')) style.setAttribute('media', node.getAttribute('media'));
        style.textContent = await rewriteCss(source, label, url, new Set([url]));
        node.replaceWith(style);
      })());
      await Promise.all(tasks);
      return /<html\b|<!doctype/i.test(String(markup)) ? parsed.documentElement.outerHTML : parsed.head.innerHTML + parsed.body.innerHTML;
    };

    const rewriteData = async (value, path = 'scenario') => {
      if (!value || typeof value !== 'object') return;
      await Promise.all(Object.entries(value).map(async ([key, item]) => {
        const nextPath = Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`;
        if (typeof item === 'string' && imageFields.has(key)) value[key] = await getResource(item, locationLabel(nextPath));
        else if (typeof item === 'string' && ['emailHtml', 'customHtml'].includes(key)) {
          const effective = key === 'customHtml' ? value.emailMode === 'html' : !['plain', 'html'].includes(value.emailMode);
          if (effective && item) {
            const markup = key === 'emailHtml' ? global.TwoWayEmailSafety.sanitizeRichHtml(item) : item;
            value[key] = await rewriteMarkup(markup, locationLabel(nextPath));
          }
        } else await rewriteData(item, nextPath);
      }));
    };

    // These are trusted runtime URL literals, not arbitrary occurrences in scenario copy.
    // The shared app boots several renderers before settling on the selected channel.
    const runtimePaths = [...new Set([...template.matchAll(runtimeImagePattern)].map(match => match[2]))];
    const runtimeAssets = new Map();
    await Promise.all([
      rewriteData(selected),
      ...runtimePaths.map(async path => runtimeAssets.set(path, await getResource(path, `Preview image ${path.split('/').pop()}`)))
    ]);
    const assetData = doc.createElement('script');
    assetData.id = 'standalone-asset-data';
    assetData.type = 'application/json';
    assetData.textContent = safeJson(Object.fromEntries(runtimeAssets));
    doc.head.append(assetData);

    for (const node of [...doc.querySelectorAll('script[src]')]) {
      const path = node.getAttribute('src');
      if (!uiAssets.includes(path)) { node.remove(); continue; }
      const source = await getResource(path, `Offline controls (${path.split('/').pop()})`, 'text');
      if (failures.has(new URL(path, base).href)) continue;
      node.removeAttribute('src');
      node.setAttribute('data-standalone-asset', path);
      node.textContent = source.replace(/<\/script/gi, '<\\/script');
    }
    for (const node of [...doc.querySelectorAll('script:not([src])')]) {
      if (node.type === 'application/json') continue;
      if (/\bgtag\s*\(/.test(node.textContent)) { node.remove(); continue; }
    }
    for (const node of [...doc.querySelectorAll('link[rel="stylesheet"]')]) {
      const path = node.getAttribute('href');
      const css = await getResource(path, `Offline styles (${path.split('/').pop()})`, 'text');
      if (failures.has(new URL(path, base).href)) continue;
      const style = doc.createElement('style');
      style.setAttribute('data-standalone-asset', path);
      style.textContent = (await rewriteCss(css, 'Preview', new URL(path, base).href)).replace(/<\/style/gi, '<\\/style');
      node.replaceWith(style);
    }
    for (const node of doc.querySelectorAll('img[src]')) {
      const path = node.getAttribute('src');
      node.setAttribute('src', runtimeAssets.get(path) || await getResource(path, 'Preview image'));
    }
    for (const node of doc.querySelectorAll('style:not([data-standalone-asset])')) node.textContent = await rewriteCss(node.textContent, 'Preview');
    doc.querySelector('#scenario-data').textContent = safeJson({ scenarios:[selected] });
    doc.body.className = `export export-booting export-channel-${selected.channel || 'sms'}`;
    const lock = doc.createElement('style');
    lock.id = 'standalone-export-lock';
    lock.textContent = '.export .builder,.export .appbar,.export .preview-info,.export #presentationNotePanel,.export #emailPresentationHint,.export #appStatus{display:none!important}.export #stage{max-width:none!important;margin:0!important}.export-booting #stage{visibility:hidden}';
    doc.head.append(lock);
    const missingPaths = [...failures.keys()];
    const requiredPaths = [...failures.values()].filter(failure => failure.required).map(failure => failure.path);
    if (requiredPaths.length || (missingPaths.length && !allowMissingAssets)) {
      const error = new Error('Export could not embed every required asset');
      error.exportAssetPath = missingPaths[0];
      error.exportAssetPaths = missingPaths;
      error.exportRequiredAssetPaths = requiredPaths;
      error.exportAssetFailures = [...failures.values()].map(failure => ({ ...failure, location:labels.get(failure.path) }));
      throw error;
    }
    return { html:'<!doctype html>\n' + doc.documentElement.outerHTML, missingPaths, failures:[...failures.values()] };
  }

  global.TwoWayStandalone = { prepare, safeJson, activeChannelScenario, assetUrl:path => embeddedAssets[path] || path, assetLabel:path => labels.get(path) || '' };
})(window);
