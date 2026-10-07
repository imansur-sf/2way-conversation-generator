/* Branded email is editable HTML in the application origin. Custom HTML stays
 * in its separate sandbox; never use this renderer to remove that boundary. */
(function (root) {
  'use strict';
  const tags = ['p','br','b','strong','i','em','u','s','strike','ul','ol','li','a','span','div','h1','h2','h3','h4','h5','h6','blockquote','pre','code','table','thead','tbody','tfoot','tr','td','th','hr','img','font','center'];
  const attributes = ['href','title','src','alt','width','height','style','target','rel','colspan','rowspan','align','color','size','face'];
  const textStyles = new Set(['color','background-color','font-family','font-size','font-weight','font-style','text-decoration','text-align','line-height','letter-spacing','white-space','border','border-color','border-width','border-style','border-collapse','padding','padding-top','padding-right','padding-bottom','padding-left','margin','margin-top','margin-right','margin-bottom','margin-left','width','max-width','height','vertical-align']);
  const escapeText = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function allowedUrl(value, image) {
    const url = String(value || '').trim();
    if (!url || /[\u0000-\u0020\u007f]/.test(url)) return false;
    if (image) return /^(?:https?:\/\/|assets\/|data:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml);base64,)/i.test(url);
    return /^(?:https?:\/\/|mailto:|tel:|#)/i.test(url);
  }
  function sanitizeRichHtml(value) {
    const raw = String(value ?? '');
    // Fail closed if the bundled sanitizer failed to load. Do not fall back to
    // regex-based HTML filtering, including in an offline downloaded file.
    if (!root.DOMPurify?.isSupported) return escapeText(raw);
    const fragment = root.DOMPurify.sanitize(raw, {
      ALLOWED_TAGS: tags,
      ALLOWED_ATTR: attributes,
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      SANITIZE_DOM: true,
      SANITIZE_NAMED_PROPS: true,
      RETURN_DOM_FRAGMENT: true
    });
    fragment.querySelectorAll('*').forEach(node => {
      for (const attribute of ['href','src']) {
        if (node.hasAttribute(attribute) && !allowedUrl(node.getAttribute(attribute), attribute === 'src')) node.removeAttribute(attribute);
      }
      if (node.hasAttribute('style')) {
        const safe = [];
        for (const property of Array.from(node.style)) {
          const value = node.style.getPropertyValue(property);
          if (textStyles.has(property) && !/url\s*\(|expression\s*\(|var\s*\(|@|[<>]/i.test(value)) safe.push(`${property}:${value}`);
        }
        if (safe.length) node.setAttribute('style', safe.join(';')); else node.removeAttribute('style');
      }
      if (node.tagName === 'A') {
        if (node.getAttribute('target') === '_blank') node.setAttribute('rel', 'noopener noreferrer');
        else node.removeAttribute('target');
      }
    });
    const holder = document.createElement('div');
    holder.append(fragment);
    return holder.innerHTML;
  }
  root.TwoWayEmailSafety = Object.freeze({sanitizeRichHtml, allowedUrl});
  // Intercept rich clipboard HTML before the browser inserts it into a live
  // contenteditable node. Sanitizing only at the next render would be too late.
  const insertSafeTransfer = event => {
    const editor = event.target instanceof Element ? event.target.closest('#richEmailEditor, [data-response-rich]') : null;
    const transfer = event.clipboardData || event.dataTransfer;
    if (!editor || !transfer) return;
    const html = transfer.getData('text/html');
    if (!html) return;
    event.preventDefault();
    editor.focus();
    if (event.type === 'drop') {
      const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
      if (range && editor.contains(range.startContainer)) {
        const selection = window.getSelection();
        selection.removeAllRanges(); selection.addRange(range);
      }
    }
    document.execCommand('insertHTML', false, sanitizeRichHtml(html));
    editor.dispatchEvent(new Event('input', {bubbles:true}));
  };
  document.addEventListener('paste', insertSafeTransfer, true);
  document.addEventListener('drop', insertSafeTransfer, true);
})(window);
