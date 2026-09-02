import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from '@playwright/test';
import axe from 'axe-core';

const port = 3182;
const baseUrl = `http://127.0.0.1:${port}`;
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const server = spawn(process.execPath, ['server.js'], { env:{ ...process.env, PORT:String(port), APP_ENV:'test', APP_VERSION:'1.1.0-test' }, stdio:['ignore', 'pipe', 'pipe'] });
let serverOutput = '';
server.stdout.on('data', chunk => { serverOutput += chunk; });
server.stderr.on('data', chunk => { serverOutput += chunk; });

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        const health = await response.json();
        assert.equal(health.ok, true, 'Health endpoint must report a healthy service');
        assert.equal(typeof health.jobs?.metrics?.active, 'number', 'Health endpoint must expose safe generation metrics');
        return;
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Local server did not start: ${serverOutput}`);
}

try {
  await waitForServer();
  const browser = await chromium.launch({ headless:true, executablePath:chrome });
  const migrationContext = await browser.newContext();
  const migrationPage = await migrationContext.newPage();
  await migrationPage.goto(baseUrl, { waitUntil:'networkidle' });
  await migrationPage.evaluate(() => {
    localStorage.removeItem('two-way-experience-studio-v2-scenarios');
    localStorage.removeItem('two-way-experience-studio-v2-version-history');
    localStorage.setItem('two-way-studio-v4', JSON.stringify({ version:4, scenarios:[{ id:'v1-migration-check', name:'Migrated 1.0 scenario', channel:'sms', brandName:'Migration Co', smsAddress:'555-0100', emailAddress:'', subject:'', emailBody:'', initials:'MC', avatar:'', steps:[{ id:'v1-migration-step', author:'brand', kind:'text', text:'Migration check', options:'' }] }] }));
    localStorage.setItem('two-way-studio-version-history-v1', JSON.stringify([{ id:'v1-history-check', scenarioId:'v1-migration-check', label:'Before promotion', createdAt:1, snapshot:{ id:'v1-migration-check' } }]));
  });
  await migrationPage.reload({ waitUntil:'networkidle' });
  await migrationPage.waitForFunction(() => Boolean(localStorage.getItem('two-way-experience-studio-v2-scenarios')));
  const migrated = await migrationPage.evaluate(() => ({ scenarios:JSON.parse(localStorage.getItem('two-way-experience-studio-v2-scenarios')).scenarios, history:JSON.parse(localStorage.getItem('two-way-experience-studio-v2-version-history')) }));
  assert.ok(migrated.scenarios.some(scenario => scenario.name === 'Migrated 1.0 scenario'), 'Valid 1.0 scenarios must migrate into the upgraded storage key');
  assert.equal(migrated.history[0].label, 'Before promotion', 'Valid 1.0 version history must migrate into the upgraded storage key');
  await migrationContext.close();
  const emailContext = await browser.newContext();
  const emailPage = await emailContext.newPage();
  await emailPage.goto(baseUrl, { waitUntil:'networkidle' });
  await emailPage.evaluate(() => {
    const scenario = {
      id:'company-first-email-once', name:'Company-first email once', channel:'email', brandName:'Example Co', smsAddress:'', emailAddress:'hello@example.com', subject:'One opening only', emailBody:'This legacy body must not create a second email.', initials:'EC', avatar:'',
      steps:[
        { id:'opening-email', author:'brand', kind:'text', text:'Opening email copy', emailMode:'branded' },
        { id:'customer-reply', author:'customer', kind:'free', text:'' },
        { id:'later-company-reply', author:'brand', kind:'text', text:'Later company reply', emailMode:'branded', allowRepeat:true }
      ]
    };
    localStorage.setItem('two-way-experience-studio-v2-scenarios', JSON.stringify({ version:4, scenarios:[scenario] }));
  });
  await emailPage.reload({ waitUntil:'networkidle' });
  await emailPage.locator('[data-email="0"]').click();
  assert.equal(await emailPage.locator('.scenario-email').count(), 1, 'A company-first opening email must render once, even when the active scenario projection recreates its step object');
  await emailContext.close();
  const context = await browser.newContext({ acceptDownloads:true, viewport:{ width:1440, height:960 } });
  const page = await context.newPage();
  const builderResponse = await page.goto(baseUrl, { waitUntil:'networkidle' });
  assert.equal(builderResponse.headers()['cache-control'], 'no-cache', 'The release-critical builder document must not be served from a stale browser cache');
  const modernCss = await page.request.get(`${baseUrl}/assets/v2-modern.css`);
  assert.equal(modernCss.headers()['cache-control'], 'no-cache', 'The release-critical modern UI stylesheet must not be served from a stale browser cache');
  await page.waitForSelector('.v2-workspace-nav');
  await page.waitForSelector('[data-v2-preview-focus]');
  assert.equal(await page.locator('.v2-workspace-nav button').count(), 4, 'Modern workspace navigation must render');
  assert.equal(await page.locator('.v2-status-line').count(), 0, 'Internal staging status must not be shown to production users');
  assert.equal(await page.locator('.v2-scenario-snapshot').count(), 0, 'Redundant scenario summary must not render');
  await page.locator('[data-v2-preview-focus]').click();
  assert.equal(await page.locator('body').evaluate(body => body.classList.contains('v2-focus-mode')), true, 'Focus mode must expand the preview workspace');
  await page.locator('.v2-focus-rail').click();
  assert.equal(await page.locator('body').evaluate(body => body.classList.contains('v2-focus-mode')), false, 'Focus rail must restore the builder');
  await page.locator('[data-v2-preview-present]').click();
  await page.waitForFunction(() => document.body.classList.contains('presentation'));
  for (const id of ['presentationExit', 'presentationReset', 'presentationNotes']) assert.equal(await page.locator(`#${id}`).isVisible(), false, `Presenter mode must hide redundant ${id} control`);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.body.classList.contains('presentation'));
  await page.locator('.v2-workspace-nav button').nth(2).click();
  await page.locator('#manualConversationSection:not([hidden])').waitFor();
  await page.keyboard.press('Alt+Digit1');
  await page.waitForFunction(() => document.querySelector('.v2-workspace-nav button[aria-current="step"]')?.dataset.v2Section === '0');
  await page.locator('.v2-workspace-nav button').nth(2).click();
  await page.locator('#manualConversationSection:not([hidden])').waitFor();
  await page.locator('#addCustomer').click();
  assert.ok(await page.locator('#steps article.block').count(), 'Flow remains editable through the modern workspace');
  await page.waitForSelector('.v2-flow-map');
  assert.ok(await page.locator('.v2-flow-map__node').count(), 'Conversation path map must render for editable flow steps');
  await page.waitForSelector('.v2-scenario-qa');
  assert.match(await page.locator('.v2-scenario-qa').textContent(), /messages.*company.*customer/i, 'Scenario QA must show actual flow counts');
  await page.locator('#switchToAi').click();
  await page.locator('[data-ai-channel="whatsapp"]').waitFor();
  await page.locator('.v2-generation-controls').waitFor();
  await page.locator('.v2-generation-controls summary').click();
  await page.locator('[data-v2-opening-sender]').selectOption('company');
  await page.locator('[data-v2-message-total]').fill('7');
  assert.equal(await page.locator('[data-v2-opening-sender]').inputValue(), 'company', 'Generation controls must allow an explicit opening sender');
  assert.equal(await page.locator('[data-v2-message-total]').inputValue(), '7', 'Generation controls must allow an exact message count');
  await page.locator('[data-ai-channel="whatsapp"]').check();
  assert.equal(await page.locator('[data-ai-channel="whatsapp"]').isChecked(), true, 'AI setup must allow a WhatsApp scenario');
  await page.locator('.v2-workspace-nav button').nth(2).click();
  await page.locator('#manualConversationSection:not([hidden])').waitFor();

  await page.addScriptTag({ content:axe.source });
  const axeResults = await page.evaluate(async () => axe.run(document, { runOnly:{ type:'tag', values:['wcag2a','wcag2aa'] } }));
  const critical = axeResults.violations.filter(item => item.impact === 'critical');
  assert.equal(critical.length, 0, `No critical accessibility violations: ${critical.map(item => item.id).join(', ')}`);

  const download = await Promise.all([page.waitForEvent('download'), page.locator('#export').click()]).then(([value]) => value);
  const exported = `/private/tmp/${await download.suggestedFilename()}`;
  await download.saveAs(exported);
  const exportedPage = await context.newPage();
  await exportedPage.goto(`file://${exported}`, { waitUntil:'load' });
  await exportedPage.waitForTimeout(100);
  assert.equal(await exportedPage.locator('.builder').isVisible(), false, 'Standalone export must hide the builder');
  const localPage = await context.newPage();
  await localPage.goto(`file://${process.cwd()}/interactive-simulator-builder.html`, { waitUntil:'load' });
  await localPage.waitForSelector('.v2-workspace-nav');
  assert.ok(await localPage.locator('[data-v2-preview-focus]').count(), 'Local file mode must retain the 2.0 workspace enhancements');
  await browser.close();
  console.log('2.0 browser, accessibility, and standalone-export smoke test: OK');
} finally {
  server.kill('SIGTERM');
  await Promise.race([once(server, 'exit'), new Promise(resolve => setTimeout(resolve, 1_000))]);
}
