import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import axe from 'axe-core';
import { browserOptions } from './browser-options.mjs';
import { selectView } from './workspace-helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const target = path.resolve(root, `.${pathname === '/' ? '/interactive-simulator-builder.html' : pathname}`);
  if (!target.startsWith(`${root}${path.sep}`)) { response.writeHead(403).end(); return; }
  try {
    response.setHeader('Content-Type', ({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png'})[path.extname(target)] || 'application/octet-stream');
    response.end(await readFile(target));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch(browserOptions);
const key = 'two-way-experience-studio-v2-scenarios';
const fixture = {id:'workspace-review',name:'Coaching inquiry',channel:'sms',smsAddress:'Coaching team',brandName:'Coaching team',initials:'CT',steps:[
  {id:'opening',author:'brand',kind:'text',text:'How can we help?'},
  {id:'question',author:'customer',kind:'free',text:''},
  {id:'answer',author:'brand',kind:'text',text:'We can help you choose.'}
]};

try {
  const context = await browser.newContext({viewport:{width:1536,height:1024},reducedMotion:'reduce'});
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await context.addInitScript(({key,fixture}) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({version:2,activeId:fixture.id,scenarios:[fixture]}));
  }, {key,fixture});
  await page.goto(base);
  await page.locator('body.studio-shell').waitFor();
  assert.equal(await page.locator('button[data-studio-view]').count(), 5);
  assert.equal(await page.locator('[data-studio-panel][data-studio-active="true"]').count(), 1);
  assert.equal(await page.locator('.appbar-brand img').getAttribute('src'), 'assets/logo-variations/saasy-solutions-blue-transparent.png');
  const builder = await page.locator('.builder').elementHandle(), stage = await page.locator('#stage').elementHandle();

  await selectView(page, 'identity');
  await page.locator('[data-skey="smsAddress"]').fill('Workspace team');
  await selectView(page, 'conversation');
  // Flow navigation must open the actual disclosure and retain that state.
  await page.locator('[data-v2-flow-target="opening"]').click();
  const message = page.locator('[data-step="opening"][data-field="text"]');
  await message.fill('A draft that must survive navigation.');
  await message.evaluate(node => node.setSelectionRange(2, 7));
  const field = await message.elementHandle();
  await selectView(page, 'scenario');
  await page.locator('#scenarioName').fill('Workspace review');
  await selectView(page, 'export');
  assert.equal(await page.locator('#exportScenario').isVisible(), true);
  assert.equal(await page.locator('#importScenario').isVisible(), true);
  await selectView(page, 'conversation');
  assert.equal(await message.inputValue(), 'A draft that must survive navigation.');
  assert.equal(await field.evaluate(node => node === document.querySelector('[data-step="opening"][data-field="text"]')), true);
  assert.equal(await message.evaluate(node => node.selectionStart), 2);
  assert.equal(await page.locator('[data-collapse-step="opening"]').getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('.studio-scenario-title').textContent(), 'Workspace review');
  assert.equal(await page.locator('#scenarioName').count(), 1);

  await selectView(page, 'ai');
  await page.locator('#aiWebsite').fill('https://example.test');
  await page.locator('#aiUseCase').fill('Keep this unfinished AI brief while I edit the flow.');
  await selectView(page, 'identity');
  assert.equal(await page.locator('[data-skey="smsAddress"]').inputValue(), 'Workspace team');
  await selectView(page, 'ai');
  assert.equal(await page.locator('#aiUseCase').inputValue(), 'Keep this unfinished AI brief while I edit the flow.');
  assert.equal(await page.locator('#aiWebsite').inputValue(), 'https://example.test');
  assert.equal(await builder.evaluate(node => node === document.querySelector('.builder')), true);
  assert.equal(await stage.evaluate(node => node === document.querySelector('#stage')), true);
  console.log('PASS workspace: one active view, retained field/caret, identity, AI brief and persistent builder/preview');
  const menu = page.locator('.v2-header-menu');
  await menu.locator('summary').click();
  assert.equal(await menu.evaluate(node => node.open), true);
  await page.keyboard.press('Escape');
  assert.equal(await menu.evaluate(node => node.open), false);
  assert.equal(await menu.locator('summary').evaluate(node => node === document.activeElement), true);
  await selectView(page, 'conversation');
  await page.locator('[data-v2-preview-focus]').click();
  await page.waitForFunction(() => document.querySelector('.preview').getBoundingClientRect().width > innerWidth - 150);
  assert.equal(await page.locator('.studio-rail').isVisible(), false);
  await page.locator('.v2-focus-rail').click();
  assert.equal(await page.locator('.studio-rail').isVisible(), true);
  assert.equal(await page.locator('button[data-studio-view="conversation"]').evaluate(node => node === document.activeElement), true);
  console.log('PASS workspace: focus mode enlarges preview and restores navigation/focus');

  await page.addScriptTag({content:axe.source});
  for (const view of ['scenario','identity','conversation','export','ai']) {
    await selectView(page, view);
    const violations = await page.evaluate(async () => (await axe.run({include:[['.studio-rail'],['.builder'],['.appbar'],['.v2-preview-mode']]},{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}})).violations.map(({id,nodes}) => ({id,targets:nodes.map(node => node.target)})));
    assert.deepEqual(violations, [], `${view} workspace accessibility`);
    assert.equal(await page.evaluate(() => document.getAnimations().some(animation => animation.effect?.target?.matches('[data-studio-panel]'))), false, 'Reduced motion uses static view changes');
  }
  console.log('PASS workspace: all five views pass scoped accessibility with static reduced-motion navigation');

  for (const width of [1440,1024,820,390]) {
    await page.setViewportSize({width,height:900});
    for (const view of ['scenario','identity','conversation','export','ai']) {
      await selectView(page, view);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}px ${view} horizontal overflow`);
    }
  }
  await page.evaluate(() => document.documentElement.style.fontSize = '200%');
  await selectView(page,'conversation');
  const reflow = await page.evaluate(() => {
    const builder = document.querySelector('.builder'), right = builder.getBoundingClientRect().right;
    return {overflow:builder.scrollWidth-builder.clientWidth,documentOverflow:document.documentElement.scrollWidth-innerWidth,nodes:[...builder.querySelectorAll('*')].filter(node=>node.getClientRects().length && node.getBoundingClientRect().right>right+1).map(node=>({tag:node.tagName,class:node.className,text:node.textContent.slice(0,45)})).slice(0,12)};
  });
  assert.ok(reflow.overflow <= 1 && reflow.documentOverflow <= 1, `Enlarged editor text must fit: ${JSON.stringify(reflow)}`);
  assert.deepEqual(errors, []);
  await page.evaluate(() => document.documentElement.style.fontSize = '100%');
  await page.setViewportSize({width:1536,height:1024});
  await page.emulateMedia({reducedMotion:'no-preference'});
  for (const view of ['identity','ai','conversation']) await page.locator(`button[data-studio-view="${view}"]`).click();
  await page.waitForFunction(() => !document.getAnimations().some(animation => animation.effect?.target?.matches('[data-studio-panel]')));
  assert.equal(await page.locator('body').getAttribute('data-studio-active-view'), 'conversation');
  assert.equal(await page.locator('[data-studio-panel][data-studio-active="true"]').count(), 1);
  assert.deepEqual(errors, []);
  console.log('PASS workspace: rapid view changes remain interruptible and settle on the requested view');
  await context.close();
  console.log('PASS workspace: desktop/tablet/mobile routes and 200% text reflow');

  const local = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const localPage = await local.newPage();
  await localPage.goto(pathToFileURL(path.join(root,'interactive-simulator-builder.html')).href);
  await localPage.locator('body.studio-shell').waitFor();
  await selectView(localPage, 'identity');
  await selectView(localPage, 'conversation');
  assert.equal(await localPage.locator('[data-studio-panel="conversation"]').isVisible(), true);
  await local.close();
  console.log('PASS workspace: direct file:// launch and navigation');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
