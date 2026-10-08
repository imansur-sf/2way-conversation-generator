import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { browserOptions } from './browser-options.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.EXPORT_TEST_PORT || 3186);
const base = `http://127.0.0.1:${port}`;
const directory = await mkdtemp(join(tmpdir(), 'two-way-export-test-'));
const tinyImage = await readFile(join(root, 'assets/gmail/refresh.png'));
const server = spawn(process.execPath, ['server.js'], { cwd:root, env:{ ...process.env, PORT:String(port), APP_ENV:'test' }, stdio:'ignore' });
const literal = 'LITERAL $& $` $\' </script> assets/gmail/gmail-logo.png';
let browser;

function fixture(channel, mode = 'branded') {
  return { id:`export-${channel}-${mode}-</script>`, name:`Export ${channel} ${mode}`, channel, brandName:'Synthetic Co', smsAddress:'555-0100', emailAddress:'synthetic@example.invalid', subject:'Export regression', emailBody:'STALE_LEGACY_BODY', avatar:'assets/gmail/refresh.png', initials:'SC', steps:[
    { id:'opening', author:'brand', kind:'text', emailMode:mode, text:literal },
    { id:'customer', author:'customer', kind:'free', text:'', reusableSet:false },
    { id:'response', author:'brand', kind:'text', emailMode:mode, text:'RESPONSE_MARKER' }
  ] };
}

async function builderFor(scenario) {
  browser = await chromium.launch(browserOptions);
  const context = await browser.newContext({ acceptDownloads:true, viewport:{ width:1600, height:1100 } });
  const metrics = { corsFetches:0, proxySuccesses:0 };
  await context.route(`${base}/api/asset?*`, route => {
    const source = new URL(new URL(route.request().url()).searchParams.get('url'));
    if (source.hostname === 'assets.export.test' && source.pathname === '/cors-only.png') {
      metrics.proxySuccesses++;
      return route.fulfill({ contentType:'application/json', body:JSON.stringify({ dataUrl:`data:image/png;base64,${tinyImage.toString('base64')}` }) });
    }
    return route.fulfill({ status:503, contentType:'application/json', body:JSON.stringify({ error:'Synthetic unavailable asset' }) });
  });
  await context.route('https://**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'assets.export.test') return route.abort();
    if (url.pathname.endsWith('.css')) return route.fulfill({ contentType:'text/css', body:'.external-background{background-image:url("picture.png?from=stylesheet");height:30px}', headers:{ 'Access-Control-Allow-Origin':'*' } });
    if (url.pathname.endsWith('.svg')) return route.fulfill({ contentType:'image/svg+xml', body:'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="blue"/></svg>', headers:{ 'Access-Control-Allow-Origin':'*' } });
    if (url.pathname === '/cors-only.png') {
      // Model a browser-blocked cross-origin fetch while ordinary <img> rendering remains possible.
      if (route.request().resourceType() === 'fetch') { metrics.corsFetches++; return route.abort('accessdenied'); }
      return route.fulfill({ contentType:'image/png', body:tinyImage });
    }
    return route.fulfill({ contentType:'image/png', body:tinyImage, headers:{ 'Access-Control-Allow-Origin':'*' } });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  await page.addInitScript(value => {
    if (window !== window.top || location.protocol === 'file:') return;
    localStorage.setItem('two-way-experience-studio-v2-scenarios', JSON.stringify({ version:4, scenarios:[value,{ id:'unrelated-scenario', name:'UNRELATED_SCENARIO_NAME', channel:'sms', brandName:'Other', steps:[] }] }));
  }, scenario);
  await page.goto(base, { waitUntil:'domcontentloaded' });
  await page.locator('.v2-preview-mode').waitFor();
  return { context, page, metrics };
}

async function download(context, builder, label) {
  const download = await Promise.all([builder.waitForEvent('download'), builder.locator('#topExport').click()]).then(([result]) => result);
  const file = join(directory, `${label}.html`);
  await download.saveAs(file);
  const html = await readFile(file, 'utf8');
  assert.ok(!html.includes('UNRELATED_SCENARIO_NAME'));
  assert.ok(!html.includes('googletagmanager.com'));
  const page = await context.newPage(), errors = [], dependencies = [];
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^(?:https?:|file:)/.test(request.url()) && request.url() !== `file://${file}`) dependencies.push(request.url()); });
  await context.setOffline(true);
  await page.goto(`file://${file}`, { waitUntil:'load' });
  await page.waitForFunction(() => !document.body.classList.contains('export-booting'));
  const data = JSON.parse(await page.locator('#scenario-data').textContent());
  assert.equal(data.scenarios.length, 1);
  assert.equal(data.scenarios[0].variants, undefined);
  assert.equal(await page.locator('script[src]').count(), 0);
  return { page, errors, dependencies, data, html };
}

async function verifyImages(page) {
  await page.waitForFunction(() => [...document.querySelectorAll('#stage img')].every(image => image.complete && image.naturalWidth > 0));
  for (const frame of page.frames().slice(1)) await frame.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
}

async function controls(page, channel, thread) {
  await page.locator('[data-v2-preview-reset]').click();
  await page.locator(thread).waitFor();
  await page.locator(thread).click();
  assert.ok(!(await page.locator('#stage').innerText()).includes('RESPONSE_MARKER'));
  const target = page.locator(channel === 'email' ? '.gmail' : '.phone');
  const before = await target.boundingBox();
  await page.locator('[data-v2-preview-focus]').click();
  assert.equal(await page.locator('[data-v2-preview-focus]').getAttribute('aria-pressed'), 'true');
  await page.waitForFunction(({selector,before})=>{const node=document.querySelector(selector),box=node.getBoundingClientRect();return box.width>before.width+1||box.height>before.height+1},{selector:channel==='email'?'.gmail':'.phone',before});
  const focused=await target.boundingBox();assert.ok(focused.width>before.width+1||focused.height>before.height+1,'Focus must provide visibly more reading space');
  for(const [mode,scale] of [['.85',.85],['.7',.7],['1',1]]){
    await page.locator('#previewScale').selectOption(mode,{force:true});
    await page.waitForFunction(({selector,scale})=>{const node=document.querySelector(selector),box=node.getBoundingClientRect();return Math.abs(box.width-node.offsetWidth*scale)<.1&&Math.abs(box.height-node.offsetHeight*scale)<.1},{selector:channel==='email'?'.gmail':'.phone',scale});
  }
  await page.locator('#previewScale').selectOption('auto',{force:true});
  await page.locator('[data-v2-preview-focus]').click();
  assert.equal(await page.locator('body').evaluate(node => node.classList.contains('v2-focus-mode')), false);
  await page.locator('[data-v2-preview-present]').click();
  await page.waitForFunction(() => document.body.classList.contains('presentation'));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.body.classList.contains('presentation'));
}

try {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
    if (attempt === 49) throw new Error('Export test server did not start');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  for (const channel of ['sms','rcs','whatsapp']) {
    const scenario = fixture(channel);
    if (channel === 'sms') {
      scenario.scenarioMode = 'multi';
      scenario.variants = { sms:JSON.parse(JSON.stringify(scenario)), email:{ channel:'email', steps:[{ id:'other-channel-step', author:'brand', kind:'text', text:'UNSELECTED_CHANNEL_CONTENT' }] } };
    }
    if (channel === 'rcs') Object.assign(scenario.steps[2], { kind:'carousel', cards:[{ id:'first-card', title:'Future card one', image:'https://assets.export.test/card.png?first=1' },{ id:'second-card', title:'Future card two', image:'https://assets.export.test/card.png?second=2' }] });
    const { context, page:builder } = await builderFor(scenario);
    try {
      const result = await download(context, builder, channel), page = result.page;
      assert.equal(result.data.scenarios[0].steps[0].text, literal);
      assert.equal(result.data.scenarios[0].id, await builder.locator('#scenarioSelect').inputValue(), 'export retains the builder-selected, validated scenario ID');
      assert.ok(!result.html.includes('UNSELECTED_CHANNEL_CONTENT'));
      const thread = channel === 'whatsapp' ? '[data-wa-thread="wa-main"]' : '[data-thread="sms-main"]';
      await page.locator(thread).click();
      assert.ok((await page.locator('#transcript').innerText()).includes(literal));
      await page.locator('#phoneInput').fill('CUSTOMER_MARKER');
      await page.locator('#phoneSend').click();
      await page.waitForFunction(() => document.querySelector('#transcript')?.textContent.includes('RESPONSE_MARKER'));
      if (channel === 'rcs') {
        assert.ok(result.data.scenarios[0].steps[2].cards.every(card => card.image.startsWith('data:image/')));
        const next = page.locator('[data-carousel-move="1"]');
        if (await next.count()) await next.click();
      }
      await verifyImages(page);
      await controls(page, channel, thread);
      assert.deepEqual(result.errors, []);
      assert.deepEqual(result.dependencies, []);
      console.log(`PASS ${channel}: literal round trip, offline reply/images, reset, focus, presentation`);
    } finally { await browser.close(); browser = null; }
  }
  for (const mode of ['plain','branded','html']) {
    const scenario = fixture('email', mode);
    scenario.emailLogo = 'assets/logo-variations/saasy-solutions-blue-transparent.png';
    scenario.emailHeroImage = 'https://assets.export.test/hero.png';
    if (mode === 'branded') {
      scenario.steps[0].emailHtml = '<p>OPENING_RICH_MARKER &amp; copy</p>';
      scenario.steps[2].emailHtml = '<p>RESPONSE_MARKER</p><img alt="later email" src="https://assets.export.test/reply.png"><img alt="SVG email logo" src="https://assets.export.test/logo.svg"><img alt="Image without CORS" src="https://assets.export.test/cors-only.png">';
    }
    if (mode === 'html') {
      scenario.steps[0].customHtml = '<h1>OPENING_CUSTOM_MARKER</h1><img src="https://assets.export.test/opening.png?size=1">';
      scenario.steps[2].customHtml = '<link rel="stylesheet" media="screen" href="https://assets.export.test/email.css"><style>@import url(https://assets.export.test/import.css);.inside{background:url("https://assets.export.test/background.png");background-image:image-set("https://assets.export.test/one.png" 1x,"https://assets.export.test/two.png" 2x)}.literal::after{content:"url(https://text-only.invalid/preserve.png)"}/* url(https://comment-only.invalid/preserve.png) */</style><p>RESPONSE_MARKER</p><p>Literal assets/gmail/gmail-logo.png $&amp;</p><div class="external-background inside"></div><img alt="later email" src="https://assets.export.test/reply.png" srcset="https://assets.export.test/reply.png 1x, https://assets.export.test/reply2.png 2x">';
    }
    const { context, page:builder, metrics } = await builderFor(scenario);
    try {
      const expected = mode === 'plain' ? literal : mode === 'branded' ? 'OPENING_RICH_MARKER & copy' : 'OPENING_CUSTOM_MARKER';
      assert.ok((await builder.locator('[data-email="0"] .g-snippet').innerText()).includes(expected));
      const result = await download(context, builder, `email-${mode}`), page = result.page;
      assert.equal(result.data.scenarios[0].steps[0].text, literal);
      if (mode === 'html') {
        const markup = result.data.scenarios[0].steps[2].customHtml;
        assert.ok(markup.includes('Literal assets/gmail/gmail-logo.png $&amp;'));
        assert.ok(markup.includes('url(https://text-only.invalid/preserve.png)'));
        assert.ok(markup.includes('url(https://comment-only.invalid/preserve.png)'));
        assert.ok(markup.includes('<style media="screen">'));
      }
      if (mode === 'branded') {
        assert.ok(result.data.scenarios[0].steps[2].emailHtml.includes('data:image/svg+xml;base64,'));
        assert.equal(metrics.corsFetches, 1);
        assert.equal(metrics.proxySuccesses, 1);
      }
      assert.ok((await page.locator('[data-email="0"] .g-snippet').innerText()).includes(expected));
      await page.locator('[data-email="0"]').click();
      const opening = mode === 'html' ? page.frameLocator('#stage .custom-html-email-frame').first().locator('body') : page.locator('#stage .mailbody');
      assert.ok((await opening.innerText()).includes(expected));
      assert.ok(!(await opening.innerText()).includes('STALE_LEGACY_BODY'));
      await page.locator('#openEmailReply').click();
      await page.locator('#emailInput').fill('CUSTOMER_MARKER');
      await page.locator('#emailSend').click();
      if (mode === 'html') await page.frameLocator('#stage .custom-html-email-frame').last().getByText('RESPONSE_MARKER').waitFor();
      else await page.getByText('RESPONSE_MARKER', { exact:true }).last().waitFor();
      await verifyImages(page);
      await controls(page, 'email', '[data-email="0"]');
      assert.deepEqual(result.errors, []);
      assert.deepEqual(result.dependencies, []);
      console.log(`PASS email ${mode}: snippet/body, offline future HTML/CSS/images, controls`);
    } finally { await browser.close(); browser = null; }
  }
  for (const mode of ['plain','branded','html']) {
    const scenario = fixture('email', mode);
    Object.assign(scenario.steps[0], { text:'', emailHtml:'', customHtml:'' });
    const { context, page:builder } = await builderFor(scenario);
    try {
      const result = await download(context, builder, `blank-${mode}`), page = result.page;
      assert.equal((await page.locator('[data-email="0"] .g-snippet').innerText()).trim(), '-');
      await page.locator('[data-email="0"]').click();
      assert.ok(!(await page.locator('#stage').innerText()).includes('STALE_LEGACY_BODY'));
      const body = mode === 'branded' ? page.locator('#stage .scenario-email-copy') : page.locator('#stage .mailbody');
      assert.equal((await body.innerText()).trim(), '');
      assert.deepEqual(result.errors, []);
      console.log(`PASS email ${mode}: intentional blank remains blank`);
    } finally { await browser.close(); browser = null; }
  }
  for (const mode of ['plain','branded','html']) {
    const scenario = fixture('email', mode);
    scenario.steps = scenario.steps.slice(1);
    const response = scenario.steps[1];
    response.text = mode === 'plain' ? 'PLAIN_INBOUND_MARKER' : 'STALE_INBOUND_TEXT';
    response.emailHtml = '<p>RICH_INBOUND_MARKER</p>';
    response.customHtml = '<p>CUSTOM_INBOUND_MARKER</p><img src="https://assets.export.test/inbound.png">';
    const expected = mode === 'plain' ? 'PLAIN_INBOUND_MARKER' : mode === 'branded' ? 'RICH_INBOUND_MARKER' : 'CUSTOM_INBOUND_MARKER';
    const { context, page:builder } = await builderFor(scenario);
    try {
      const result = await download(context, builder, `customer-first-${mode}`), page = result.page;
      await page.locator('#stage .compose-btn').click();
      await page.locator('#emailFirstInput').fill('Customer starts this conversation');
      await page.locator('#emailFirstSend').click();
      await page.locator('[data-customer-inbound]').waitFor();
      assert.ok((await page.locator('[data-customer-inbound] .g-snippet').innerText()).includes(expected));
      await page.locator('[data-customer-inbound]').click();
      const body = mode === 'html' ? page.frameLocator('#stage .custom-html-email-frame').locator('body') : page.locator('#stage');
      assert.ok((await body.innerText()).includes(expected));
      assert.ok(!(await body.innerText()).includes('STALE_INBOUND_TEXT'));
      await verifyImages(page);
      assert.deepEqual(result.errors, []);
      assert.deepEqual(result.dependencies, []);
      console.log(`PASS customer-first email ${mode}: inbound snippet matches displayed reply offline`);
    } finally { await browser.close(); browser = null; }
  }
  {
    const scenario = fixture('email', 'html');
    scenario.steps[0].customHtml = '<p>Warning test opening</p>';
    scenario.steps[2].customHtml = '<p>RESPONSE_MARKER</p><img src="https://assets.export.test/missing.png">';
    const { context, page:builder } = await builderFor(scenario);
    try {
      let attempts = 0, downloads = 0;
      builder.on('download', () => downloads++);
      await context.route('https://assets.export.test/missing.png', route => {
        if (route.request().resourceType() === 'fetch') attempts++;
        return route.fulfill({ status:503, body:'Synthetic unavailable asset', headers:{ 'Access-Control-Allow-Origin':'*' } });
      });
      let dialog = await Promise.all([builder.waitForEvent('dialog'), builder.locator('#topExport').click()]).then(([value]) => value);
      assert.match(dialog.message(), /Message 3 email content img src/);
      assert.match(dialog.message(), /Choose OK to download anyway/);
      await dialog.dismiss();
      assert.equal(attempts, 3, 'required assets retry three times before warning');
      assert.equal(downloads, 0, 'cancel must not download an incomplete export');
      dialog = await Promise.all([builder.waitForEvent('dialog'), builder.locator('#topExport').click()]).then(([value]) => value);
      const pendingDownload = builder.waitForEvent('download');
      await dialog.accept();
      const output = await pendingDownload;
      const file = join(directory, 'allowed-missing.html');
      await output.saveAs(file);
      assert.equal(downloads, 1);
      assert.equal(attempts, 9, 'the accepted retry and download-anyway attempt each retry the missing asset');
      await builder.waitForFunction(() => document.querySelector('#appStatus')?.textContent.includes('Downloaded with missing Message 3'));
      const html = await readFile(file, 'utf8');
      assert.ok(html.includes('https://assets.export.test/missing.png'));
      console.log('PASS missing asset: exact message location, retries, cancel, confirmed download-anyway warning');
    } finally { await browser.close(); browser = null; }
  }
  {
    const scenario = fixture('sms');
    const { context, page:builder } = await builderFor(scenario);
    try {
      let downloads = 0, dialogs = 0;
      builder.on('download', () => downloads++);
      builder.on('dialog', async dialog => { dialogs++; await dialog.dismiss(); });
      await context.route(`${base}/assets/v2-modern.js`, route => route.fulfill({ status:503, body:'Synthetic controls unavailable' }));
      await builder.locator('#topExport').click();
      await builder.waitForFunction(() => document.querySelector('#appStatus')?.textContent.includes('required Offline controls (v2-modern.js)'));
      assert.equal(downloads, 0);
      assert.equal(dialogs, 0, 'required controls must not offer download-anyway');
      const result = await builder.evaluate(async ({ scenario, image }) => {
        try {
          await window.TwoWayStandalone.prepare({ scenario, allowMissingAssets:true, fetchAsset:async () => image, fetchText:async path => { const response = await fetch(new URL(path, location.href)); if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.text(); } });
          return { blocked:false };
        } catch (error) { return { blocked:true, required:error.exportRequiredAssetPaths }; }
      }, { scenario, image:`data:image/png;base64,${tinyImage.toString('base64')}` });
      assert.equal(result.blocked, true);
      assert.ok(result.required.some(path => path.endsWith('/assets/v2-modern.js')));
      console.log('PASS required runtime: named retry warning, no confirmation bypass, download-anyway still blocked');
    } finally { await browser.close(); browser = null; }
  }
  console.log('Standalone export browser regressions: OK');
} finally {
  await browser?.close();
  server.kill();
  if (server.exitCode === null) await once(server, 'exit');
  await rm(directory, { recursive:true, force:true });
}
