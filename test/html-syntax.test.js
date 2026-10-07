const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
test('every inline builder script compiles as the HTML parser sees it', () => {
  const html = fs.readFileSync(path.join(root, 'interactive-simulator-builder.html'), 'utf8');
  let count = 0;
  for (const [,attributes,source] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\bsrc=|application\/json/i.test(attributes)) continue;
    assert.doesNotThrow(() => new vm.Script(source, {filename:`builder-inline-${++count}.js`}));
  }
  assert.ok(count > 0);
});
test('the offline sanitizer exactly matches its pinned distribution', () => {
  const bundled = fs.readFileSync(path.join(root, 'assets/vendor/purify.min.js'), 'utf8').trim();
  const installed = fs.readFileSync(path.join(root, 'node_modules/dompurify/dist/purify.min.js'), 'utf8').trim();
  assert.equal(bundled, installed);
});
