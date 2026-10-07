import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import axe from 'axe-core';
import { browserOptions } from './browser-options.mjs';

const port = 3182;
const baseUrl = `http://127.0.0.1:${port}`;
const exportDirectory = await mkdtemp(join(tmpdir(),'two-way-e2e-'));
const server = spawn(process.execPath, ['server.js'], { env:{ ...process.env, PORT:String(port), APP_ENV:'test', APP_VERSION:'1.1.0-test' }, stdio:['ignore', 'pipe', 'pipe'] });
let serverOutput = '';
let browser;
server.stdout.on('data', chunk => { serverOutput += chunk; });
server.stderr.on('data', chunk => { serverOutput += chunk; });

async function createContext(options) {
  const context = await browser.newContext(options);
  context.setDefaultTimeout(10000);
  context.setDefaultNavigationTimeout(15000);
  await context.route('https://**/*', route => route.abort());
  return context;
}

async function enableManual(page) {
  await page.evaluate(async () => { await window.__twoWayScenarioInitialization; });
  if (await page.locator('#chooseManual').isVisible()) await page.locator('#chooseManual').click();
}

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
  browser = await chromium.launch(browserOptions);
  const migrationContext = await createContext();
  const migrationPage = await migrationContext.newPage();
  await migrationContext.addInitScript(() => {
    if (location.protocol === 'file:' || sessionStorage.getItem('fixture-seeded')) return;
    sessionStorage.setItem('fixture-seeded', '1');
    localStorage.removeItem('two-way-experience-studio-v2-scenarios');
    localStorage.removeItem('two-way-experience-studio-v2-version-history');
    localStorage.setItem('two-way-studio-v4', JSON.stringify({ version:4, scenarios:[{ id:'v1-migration-check', name:'Migrated 1.0 scenario', channel:'sms', brandName:'Migration Co', smsAddress:'555-0100', emailAddress:'', subject:'', emailBody:'', initials:'MC', avatar:'', steps:[{ id:'v1-migration-step', author:'brand', kind:'text', text:'Migration check', options:'' }] }] }));
    localStorage.setItem('two-way-studio-version-history-v1', JSON.stringify([{ id:'v1-history-check', scenarioId:'v1-migration-check', label:'Before promotion', createdAt:1, snapshot:{ id:'v1-migration-check' } }]));
  });
  await migrationPage.goto(baseUrl, { waitUntil:'networkidle' });
  await migrationPage.evaluate(async () => { await window.__twoWayScenarioInitialization; });
  await migrationPage.waitForFunction(() => Boolean(localStorage.getItem('two-way-experience-studio-v2-scenarios')));
  const migrated = await migrationPage.evaluate(() => ({ scenarios:JSON.parse(localStorage.getItem('two-way-experience-studio-v2-scenarios')).scenarios, history:JSON.parse(localStorage.getItem('two-way-experience-studio-v2-version-history')) }));
  assert.ok(migrated.scenarios.some(scenario => scenario.name === 'Migrated 1.0 scenario'), 'Valid 1.0 scenarios must migrate into the upgraded storage key');
  assert.equal(migrated.history[0].label, 'Before promotion', 'Valid 1.0 version history must migrate into the upgraded storage key');
  await migrationContext.close();
  const manualRecoveryContext = await createContext();
  const manualRecoveryPage = await manualRecoveryContext.newPage();
  await manualRecoveryPage.goto(baseUrl, { waitUntil:'networkidle' });
  await manualRecoveryPage.evaluate(() => {
    localStorage.setItem('two-way-experience-studio-v2-scenarios', JSON.stringify({ version:1, scenarios:[{ id:'broken', scenarioMode:'multi', channel:'rcs', variants:{ rcs:{ steps:[null] } } }] }));
    localStorage.setItem('two-way-studio-v4', JSON.stringify({ version:4, scenarios:[{ id:'legacy-broken', scenarioMode:'multi', channel:'email', variants:{ email:{ steps:[null] } } }] }));
  });
  await manualRecoveryPage.goto(`${baseUrl}?recover-local=1`, { waitUntil:'networkidle' });
  await manualRecoveryPage.evaluate(async () => { await window.__twoWayScenarioInitialization; });
  await manualRecoveryPage.waitForSelector('#scenarioSelect option', {state:'attached'});
  assert.ok(await manualRecoveryPage.locator('#scenarioSelect option').count() >= 2, 'The visible recovery link must restore a usable builder from blank-state local data');
  const manualRecoveryState = await manualRecoveryPage.evaluate(() => ({ quarantined:localStorage.getItem('two-way-experience-studio-v2-quarantined-scenarios'), active:JSON.parse(localStorage.getItem('two-way-experience-studio-v2-scenarios')).scenarios, legacy:JSON.parse(localStorage.getItem('two-way-studio-v4')).scenarios, search:location.search }));
  assert.ok(manualRecoveryState.quarantined, 'Manual recovery must preserve a quarantine copy before resetting local scenarios');
  assert.ok(manualRecoveryState.active.some(scenario => scenario.id === 'broken'), 'Recovery must retain the original cache until the user explicitly saves the usable in-memory workspace');
  assert.ok(manualRecoveryState.legacy.some(scenario => scenario.id === 'legacy-broken'), 'Recovery must retain the original legacy record instead of overwriting the only recovery source');
  assert.equal(manualRecoveryState.search, '', 'Manual recovery must remove its one-time recovery parameter from the address bar');
  await manualRecoveryContext.close();
  const corruptJourneyContext = await createContext();
  const corruptJourneyPage = await corruptJourneyContext.newPage();
  await corruptJourneyContext.addInitScript(() => {
    if (location.protocol === 'file:' || sessionStorage.getItem('fixture-seeded')) return;
    sessionStorage.setItem('fixture-seeded', '1');
    const malformedJourney = {
      id:'customer-initiated-initial-message', name:'Recovered multi-channel journey', scenarioMode:'multi', channel:'rcs',
      brandName:'Recovery Co', smsAddress:'Recovery Co', emailAddress:'', subject:'', emailBody:'', initials:'RC', avatar:'',
      variants:{ rcs:{ channel:'rcs', brandName:'Recovery Co', smsAddress:'Recovery Co', steps:[{ id:'recovery-opening', author:'brand', kind:'text', text:'Recovered opening message' }] }, email:{ channel:'email', brandName:'Recovery Co', emailAddress:'hello@recovery.example', steps:[null] } }
    };
    localStorage.setItem('two-way-experience-studio-v2-scenarios', JSON.stringify({ version:1, scenarios:[malformedJourney] }));
  });
  await corruptJourneyPage.goto(baseUrl, { waitUntil:'networkidle' });
  await enableManual(corruptJourneyPage);
  await corruptJourneyPage.evaluate(async () => { await window.__twoWayScenarioInitialization; });
  await corruptJourneyPage.waitForSelector('#scenarioSelect option', {state:'attached'});
  assert.ok(await corruptJourneyPage.locator('#scenarioSelect option').count() >= 2, 'An incomplete saved channel variant must recover to usable starter journeys instead of blanking the builder');
  assert.match(await corruptJourneyPage.locator('#stage').textContent(), /Recovered opening message/, 'The active channel must retain its valid root flow when its saved variant is incomplete');
  const repairedJourney = await corruptJourneyPage.evaluate(() => JSON.parse(localStorage.getItem('two-way-experience-studio-v2-scenarios')).scenarios.find(scenario => scenario.id === 'customer-initiated-initial-message'));
  assert.ok(Array.isArray(repairedJourney.variants.rcs.steps), 'The repaired channel variant must persist a steps array for future page loads');
  await corruptJourneyPage.locator('[data-channel="email"]').click();
  await corruptJourneyPage.waitForSelector('#scenarioSelect option', {state:'attached'});
  assert.ok(await corruptJourneyPage.locator('#scenarioSelect option').count() >= 2, 'A malformed inactive channel variant must not blank the app when opened');
  const normalizedEmailSteps = await corruptJourneyPage.evaluate(() => JSON.parse(localStorage.getItem('two-way-experience-studio-v2-scenarios')).scenarios.find(scenario => scenario.id === 'customer-initiated-initial-message').variants.email.steps);
  assert.ok(normalizedEmailSteps.every(step => step && typeof step === 'object'), 'Nested channel steps must be normalized before the editor renders them');
  await corruptJourneyContext.close();
  const emailContext = await createContext();
  const emailPage = await emailContext.newPage();
  await emailContext.addInitScript(() => {
    if (location.protocol === 'file:' || sessionStorage.getItem('fixture-seeded')) return;
    sessionStorage.setItem('fixture-seeded', '1');
    const scenario = {
      id:'company-first-email-once', name:'Company-first email once', channel:'email', brandName:'Example Co', smsAddress:'', emailAddress:'hello@example.com', subject:'One opening only', emailBody:'This legacy body must not create a second email.', initials:'EC', avatar:'',
      steps:[
        { id:'opening-email', author:'brand', kind:'text', text:'Opening email copy', emailMode:'branded' },
        { id:'customer-reply', author:'customer', kind:'free', text:'', reusableSet:false },
        { id:'first-company-reply', author:'brand', kind:'text', text:'First company reply', emailMode:'branded' },
        { id:'second-customer-reply', author:'customer', kind:'free', text:'', reusableSet:false },
        { id:'later-company-reply', author:'brand', kind:'text', text:'Later company reply', emailMode:'branded' }
      ]
    };
    localStorage.setItem('two-way-experience-studio-v2-scenarios', JSON.stringify({ version:2, scenarios:[scenario] }));
  });
  await emailPage.goto(baseUrl, { waitUntil:'networkidle' });
  await emailPage.evaluate(async () => { await window.__twoWayScenarioInitialization; });
  if (await emailPage.locator('#chooseManual').isVisible()) await emailPage.locator('#chooseManual').click();
  const emailInboxOpening = await emailPage.locator('[data-email="0"]').textContent();
  assert.match(emailInboxOpening, /Opening email copy/, 'The Gmail inbox preview must use the first company email response');
  assert.doesNotMatch(emailInboxOpening, /This legacy body must not create a second email/, 'The Gmail inbox preview must not show a stale scenario-level email body');
  const emailFlowStartCount = await emailPage.locator('#steps article.block').count();
  await emailPage.locator('#emailAddReply').click();
  await emailPage.waitForFunction(count => document.querySelectorAll('#steps article.block').length === count + 1, emailFlowStartCount);
  await emailPage.locator('#emailAddResponse').click();
  await emailPage.waitForFunction(count => document.querySelectorAll('#steps article.block').length === count + 2, emailFlowStartCount);
  await emailPage.locator('[data-email="0"]').click();
  assert.equal(await emailPage.locator('.scenario-email').count(), 1, 'A company-first opening email must render once, even when the active scenario projection recreates its step object');
  await emailPage.locator('#openEmailReply').click();
  await emailPage.locator('#emailInput').fill('First customer reply');
  await emailPage.locator('#emailSend').click();
  await emailPage.waitForFunction(() => document.querySelector('#stage')?.textContent?.includes('First company reply'));
  await emailPage.locator('#openEmailReply').click();
  await emailPage.locator('#emailInput').fill('Second customer reply');
  await emailPage.locator('#emailSend').click();
  await emailPage.waitForFunction(() => document.querySelector('#stage')?.textContent?.includes('Later company reply'),null,{timeout:5000}).catch(async error=>{console.error('Email conversation after second reply:',await emailPage.locator('#stage').innerText().catch(()=>'<page closed>'));throw error});
  await emailContext.close();
  const emailExportContext = await createContext({ acceptDownloads:true });
  const emailExportPage = await emailExportContext.newPage();
  await emailExportContext.addInitScript(() => {
    if (location.protocol === 'file:' || sessionStorage.getItem('fixture-seeded')) return;
    sessionStorage.setItem('fixture-seeded', '1');
    localStorage.setItem('two-way-experience-studio-v2-scenarios', JSON.stringify({ version:2, scenarios:[{
      id:'email-opening-preview-export', name:'Email opening preview export', channel:'email', brandName:'Preview Co', emailAddress:'hello@preview.example', subject:'One source of truth', emailBody:'Stale email body that must never appear in the inbox.', initials:'PC', avatar:'',
      steps:[{ id:'custom-opening', author:'brand', kind:'text', text:'The customized opening email copy appears everywhere.', emailMode:'branded' }, { id:'email-customer', author:'customer', kind:'free', text:'' }]
    }] }));
  });
  await emailExportPage.goto(baseUrl, { waitUntil:'networkidle' });
  await emailExportPage.evaluate(async () => { await window.__twoWayScenarioInitialization; });
  const customizedInbox = await emailExportPage.locator('[data-email="0"]').textContent();
  assert.match(customizedInbox, /The customized opening email copy appears everywhere\./, 'The live Gmail inbox must mirror the customized opening company email');
  const emailDownload = await Promise.all([emailExportPage.waitForEvent('download'), emailExportPage.locator('#export').click()]).then(([value]) => value);
  const emailExportPath = `${exportDirectory}/email-opening-${await emailDownload.suggestedFilename()}`;
  await emailDownload.saveAs(emailExportPath);
  const exportedEmailPage = await emailExportContext.newPage();
  await exportedEmailPage.goto(`file://${emailExportPath}`, { waitUntil:'load' });
  assert.match(await exportedEmailPage.locator('[data-email="0"]').textContent(), /The customized opening email copy appears everywhere\./, 'The downloaded Gmail inbox must mirror the customized opening company email');
  assert.doesNotMatch(await exportedEmailPage.locator('[data-email="0"]').textContent(), /Stale email body/, 'The downloaded Gmail inbox must not use a stale scenario-level email body');
  await emailExportContext.close();
  const livePreviewContext = await createContext();
  const livePreviewPage = await livePreviewContext.newPage();
  await livePreviewContext.addInitScript(() => {
    if (location.protocol === 'file:' || sessionStorage.getItem('fixture-seeded')) return;
    sessionStorage.setItem('fixture-seeded', '1');
    const scenario = {
      id:'live-preview-journey', name:'Live preview journey', scenarioMode:'multi', channel:'rcs',
      variants:{ rcs:{ channel:'rcs', brandName:'Live Preview Co', smsAddress:'Live Preview Co', emailAddress:'', subject:'', emailBody:'', initials:'LP', avatar:'', steps:[
        { id:'live-rich-card', author:'brand', kind:'rich', text:'Opening message', cardTitle:'Original card title', cardDescription:'Original description', cardImage:'assets/avatars/company-avatar-sheet.png', cardCta:'Learn more', cardUrl:'' },
        { id:'live-carousel', author:'brand', kind:'carousel', text:'', cards:[
          { id:'live-carousel-card-1', title:'Automated Bookkeeping', description:'A deliberately long card description confirms navigation never covers the copy.', image:'assets/avatars/company-avatar-sheet.png', cta:'Learn more', url:'' },
          { id:'live-carousel-card-2', title:'Tax planning', description:'Second card', image:'assets/avatars/company-avatar-sheet.png', cta:'Learn more', url:'' }
        ] },
        { id:'live-customer', author:'customer', kind:'free', text:'', options:'', reusableSet:false },
        { id:'live-later-company', author:'brand', kind:'text', text:'Later response', matchTerms:'', allowRepeat:true }
      ] } }
    };
    localStorage.setItem('two-way-experience-studio-v2-scenarios', JSON.stringify({ version:2, scenarios:[scenario] }));
  });
  await livePreviewPage.goto(baseUrl, { waitUntil:'networkidle' });
  await livePreviewPage.evaluate(async () => { await window.__twoWayScenarioInitialization; });
  if (await livePreviewPage.locator('#chooseManual').isVisible()) await livePreviewPage.locator('#chooseManual').click();
  const liveCardTitle = livePreviewPage.locator('[data-step="live-rich-card"][data-field="cardTitle"]');
  if (!(await liveCardTitle.isVisible())) await livePreviewPage.locator('[data-collapse-step="live-rich-card"]').click();
  await liveCardTitle.focus();
  await liveCardTitle.fill('Updated card title');
  await livePreviewPage.waitForFunction(() => document.querySelector('#stage')?.textContent?.includes('Updated card title'));
  assert.ok(await livePreviewPage.locator('.rich-card, .card').count(), 'Focusing an RCS card editor must reveal its in-phone preview');
  assert.equal(await livePreviewPage.locator('.live-preview-note').count(), 0, 'The live editor must not add a builder-only label to the simulated conversation');
  const carouselTitle=livePreviewPage.locator('[data-carousel-step="live-carousel"][data-carousel-field="title"]').first();
  if (!(await carouselTitle.isVisible())) await livePreviewPage.locator('[data-collapse-step="live-carousel"]').click();
  await carouselTitle.focus();
  await livePreviewPage.waitForSelector('#stage [data-rcs-carousel="live-carousel"]');
  assert.equal(await livePreviewPage.locator('#stage [data-rcs-carousel="live-carousel"] .carousel-nav.prev').count(), 0, 'The unavailable previous-card control must be hidden');
  assert.equal(await livePreviewPage.locator('#stage [data-rcs-carousel="live-carousel"] .carousel-nav.next').count(), 1, 'The next-card control must remain available');
  const navBox = await livePreviewPage.locator('#stage [data-rcs-carousel="live-carousel"] .carousel-nav.next').boundingBox();
  const imageBox = await livePreviewPage.locator('#stage [data-rcs-carousel="live-carousel"] .card-img').boundingBox();
  assert.ok(navBox.y >= imageBox.y && navBox.y + navBox.height <= imageBox.y + imageBox.height, 'Carousel navigation must stay inside the card media area');
  await livePreviewPage.locator('#stage [data-rcs-carousel="live-carousel"] .carousel-nav.next').click();
  await livePreviewPage.waitForFunction(() => document.querySelector('#stage [data-rcs-carousel="live-carousel"] .carousel-track')?.style.transform === 'translateX(-100%)');
  assert.equal(await livePreviewPage.locator('#stage [data-rcs-carousel="live-carousel"] .carousel-nav.next').count(), 0, 'The unavailable next-card control must be hidden');
  assert.equal(await livePreviewPage.locator('#stage [data-rcs-carousel="live-carousel"] .carousel-nav.prev').count(), 1, 'The previous-card control must return after advancing');
  const carouselWindow = await livePreviewPage.locator('#stage [data-rcs-carousel="live-carousel"] .carousel-window').boundingBox();
  await livePreviewPage.mouse.move(carouselWindow.x + carouselWindow.width * 0.25, carouselWindow.y + carouselWindow.height * 0.5);
  await livePreviewPage.mouse.down();
  await livePreviewPage.mouse.move(carouselWindow.x + carouselWindow.width * 0.7, carouselWindow.y + carouselWindow.height * 0.5);
  await livePreviewPage.mouse.up();
  await livePreviewPage.waitForFunction(() => document.querySelector('#stage [data-rcs-carousel="live-carousel"] .carousel-track')?.style.transform === 'translateX(-0%)');
  const firstWindow = await livePreviewPage.locator('#stage [data-rcs-carousel="live-carousel"] .carousel-window').boundingBox();
  await livePreviewPage.mouse.move(firstWindow.x + firstWindow.width * 0.7, firstWindow.y + firstWindow.height * 0.5);
  await livePreviewPage.mouse.down();
  await livePreviewPage.mouse.move(firstWindow.x + firstWindow.width * 0.25, firstWindow.y + firstWindow.height * 0.5);
  await livePreviewPage.mouse.up();
  await livePreviewPage.waitForFunction(() => document.querySelector('#stage [data-rcs-carousel="live-carousel"] .carousel-track')?.style.transform === 'translateX(-100%)');
  const ctaPresentation = livePreviewPage.locator('[data-rcs-cta-presentation-step="live-rich-card"]');
  await ctaPresentation.selectOption('reply');
  await livePreviewPage.waitForFunction(() => document.querySelector('#stage .rcs-card-cta-action'));
  assert.equal(await livePreviewPage.locator('#stage .rcs-card-cta-action').count(), 1, 'A rich-card CTA can match the centered reply-action treatment');
  const adjustCardImage = livePreviewPage.locator('[data-image-asset][data-image-step="live-rich-card"][data-image-key="cardImage"] [data-image-adjust]');
  await adjustCardImage.click();
  const cropper = livePreviewPage.locator('.rcs-image-cropper');
  await cropper.waitFor();
  await cropper.locator('[data-rcs-crop-fit="contain"]').click();
  await cropper.locator('[data-rcs-crop-zoom]').evaluate(input => { input.value = '1.4'; input.dispatchEvent(new Event('input', { bubbles:true })); });
  const cropFrame = cropper.locator('[data-rcs-crop-frame]');
  const cropBox = await cropFrame.boundingBox();
  await livePreviewPage.mouse.move(cropBox.x + cropBox.width * 0.5, cropBox.y + cropBox.height * 0.5);
  await livePreviewPage.mouse.down();
  await livePreviewPage.mouse.move(cropBox.x + cropBox.width * 0.75, cropBox.y + cropBox.height * 0.35);
  await livePreviewPage.mouse.up();
  await livePreviewPage.waitForFunction(() => document.querySelector('#stage .card-img__asset')?.style.objectFit === 'contain');
  const savedCrop = await livePreviewPage.evaluate(() => JSON.parse(localStorage.getItem('two-way-experience-studio-v2-scenarios')).scenarios[0].variants.rcs.steps.find(step => step.id === 'live-rich-card'));
  assert.equal(savedCrop.imageFit, 'contain', 'The selected RCS image-fit mode must persist with the card');
  assert.equal(savedCrop.imageScale, 1.4, 'The RCS image zoom must persist with the card');
  assert.ok(savedCrop.imagePositionX > 70 && savedCrop.imagePositionY < 40, 'Dragging inside the 5:2 crop frame must persist the selected focal point');
  await cropper.locator('[data-rcs-crop-done]').click();
  const cropExport = await Promise.all([livePreviewPage.waitForEvent('download'), livePreviewPage.locator('#export').click()]).then(([value]) => value);
  const cropExported = `${exportDirectory}/crop-${await cropExport.suggestedFilename()}`;
  await cropExport.saveAs(cropExported);
  const cropExportedHtml = await readFile(cropExported, 'utf8');
  assert.match(cropExportedHtml, /"imageFit":"contain"/, 'Standalone HTML must retain the selected RCS image-fit mode');
  assert.match(cropExportedHtml, /"imageScale":1\.4/, 'Standalone HTML must retain the selected RCS image zoom');
  await livePreviewContext.close();
  const channelGuardContext = await createContext();
  const channelGuardPage = await channelGuardContext.newPage();
  await channelGuardPage.goto(baseUrl, { waitUntil:'networkidle' });
  await enableManual(channelGuardPage);
  await channelGuardPage.locator('[data-channel="rcs"]').click();
  const channelGuardName = channelGuardPage.locator('#identityFields [data-skey="brandName"]');
  await channelGuardName.fill('Guarded RCS Co');
  const saveBeforeSwitch = channelGuardPage.waitForEvent('dialog').then(async dialog=>{
    assert.match(dialog.message(), /Save your RCS changes before switching to SMS/);
    await dialog.accept();
  });
  await channelGuardPage.locator('[data-channel="sms"]').click();
  await saveBeforeSwitch;
  await channelGuardPage.waitForFunction(() => document.querySelector('[data-channel="sms"]')?.classList.contains('active'));
  await channelGuardPage.waitForFunction(() => document.querySelector('#saveState')?.textContent.includes('Saved on this device'));
  let unnecessarySwitchPrompt = false;
  const unexpectedDialog=async dialog => { unnecessarySwitchPrompt = true; await dialog.dismiss(); };
  channelGuardPage.on('dialog', unexpectedDialog);
  await channelGuardPage.locator('[data-channel="rcs"]').click();
  await channelGuardPage.waitForFunction(() => document.querySelector('[data-channel="rcs"]')?.classList.contains('active'));
  await channelGuardPage.waitForTimeout(250);
  assert.equal(unnecessarySwitchPrompt, false, 'Switching a channel with no unsaved changes must not ask for confirmation');
  channelGuardPage.off('dialog', unexpectedDialog);
  await channelGuardName.waitFor();
  assert.equal(await channelGuardName.inputValue(), 'Guarded RCS Co', 'Saving on a channel switch must preserve the edited channel variant');
  await channelGuardName.fill('Stay on RCS');
  const stayOnChannel = channelGuardPage.waitForEvent('dialog').then(dialog=>dialog.dismiss());
  await channelGuardPage.locator('[data-channel="sms"]').click();
  await stayOnChannel;
  assert.equal(await channelGuardPage.locator('[data-channel="rcs"]').evaluate(button => button.classList.contains('active')), true, 'Cancelling the save prompt must keep the user on the current channel');
  await channelGuardContext.close();
  const durableSaveContext = await createContext();
  const durableSavePage = await durableSaveContext.newPage();
  await durableSavePage.goto(baseUrl, { waitUntil:'networkidle' });
  await enableManual(durableSavePage);
  await durableSavePage.locator('[data-channel="rcs"]').click();
  const durableBrand = durableSavePage.locator('#identityFields [data-skey="brandName"]');
  await durableBrand.fill('Durable Save RCS');
  await durableSavePage.locator('#save').click();
  await durableSavePage.waitForFunction(() => document.querySelector('#saveState')?.textContent.includes('Saved on this device'));
  const durableRecord = await durableSavePage.evaluate(async () => new Promise((resolve, reject) => {
    const request = indexedDB.open('two-way-experience-studio-scenarios-v1', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const read = request.result.transaction('scenario-state', 'readonly').objectStore('scenario-state').get('current');
      read.onerror = () => reject(read.error);
      read.onsuccess = () => resolve(read.result);
    };
  }));
  const durableScenario = durableRecord.scenarios.find(scenario => scenario.id === durableRecord.activeId);
  assert.equal(durableScenario.variants.rcs.brandName, 'Durable Save RCS', 'Save all changes must write the active RCS variant into the durable browser database');
  assert.ok(await durableSavePage.locator('#createRestorePoint').count(), 'restore-point creation remains available as a secondary action');
  assert.equal(await durableSavePage.locator('#saveVersion').count(), 0, 'the ambiguous standalone Save version button must be removed');
  await durableSavePage.evaluate(() => {
    localStorage.removeItem('two-way-experience-studio-v2-scenarios');
    localStorage.removeItem('two-way-studio-v4');
  });
  await durableSavePage.reload({ waitUntil:'networkidle' });
  await durableSavePage.waitForFunction(() => document.querySelector('#identityFields [data-skey="brandName"]')?.value === 'Durable Save RCS');
  await durableSaveContext.close();
  const channelIsolationContext = await createContext();
  const channelIsolationPage = await channelIsolationContext.newPage();
  await channelIsolationPage.goto(baseUrl, { waitUntil:'networkidle' });
  await enableManual(channelIsolationPage);
  await channelIsolationPage.locator('[data-channel="rcs"]').click();
  await channelIsolationPage.locator('#identityFields [data-skey="brandName"]').fill('RCS only brand');
  let switchDialog = channelIsolationPage.waitForEvent('dialog').then(dialog=>dialog.accept());
  await channelIsolationPage.locator('[data-channel="sms"]').click();
  await switchDialog;
  await channelIsolationPage.locator('#identityFields [data-skey="smsAddress"]').fill('SMS only sender');
  switchDialog = channelIsolationPage.waitForEvent('dialog').then(dialog=>dialog.accept());
  await channelIsolationPage.locator('[data-channel="whatsapp"]').click();
  await switchDialog;
  const whatsappAvatar = channelIsolationPage.locator('[data-image-asset][data-image-key="avatar"]');
  await whatsappAvatar.locator('[data-image-url-open]').click();
  await whatsappAvatar.locator('.image-url-entry:not([hidden])').waitFor();
  const whatsappAvatarDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9qM0wAAAAASUVORK5CYII=';
  await channelIsolationPage.route('**/api/asset?url=**', route => route.fulfill({ json:{ dataUrl:whatsappAvatarDataUrl } }));
  await whatsappAvatar.locator('[data-image-url]').fill('https://images.example.test/whatsapp-company.png');
  await whatsappAvatar.locator('[data-image-url-apply]').click();
  await channelIsolationPage.locator('[data-image-asset][data-image-key="avatar"] [data-image-thumbnail]').waitFor();
  await channelIsolationPage.unroute('**/api/asset?url=**');
  await channelIsolationPage.locator('#identityFields [data-skey="brandName"]').fill('WhatsApp only brand');
  await channelIsolationPage.locator('#save').click();
  await channelIsolationPage.waitForFunction(() => document.querySelector('#saveState')?.textContent.includes('Saved on this device'));
  const isolatedRecord = await channelIsolationPage.evaluate(async () => new Promise((resolve, reject) => {
    const request = indexedDB.open('two-way-experience-studio-scenarios-v1', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const read = request.result.transaction('scenario-state', 'readonly').objectStore('scenario-state').get('current');
      read.onerror = () => reject(read.error);
      read.onsuccess = () => resolve(read.result);
    };
  }));
  const isolatedScenario = isolatedRecord.scenarios.find(scenario => scenario.id === isolatedRecord.activeId);
  assert.equal(isolatedScenario.variants.rcs.brandName, 'RCS only brand', 'RCS edits must remain in the RCS variant');
  assert.equal(isolatedScenario.variants.sms.smsAddress, 'SMS only sender', 'SMS edits must remain in the SMS variant');
  assert.equal(isolatedScenario.variants.whatsapp.brandName, 'WhatsApp only brand', 'WhatsApp edits must remain in the WhatsApp variant');
  assert.equal(isolatedScenario.variants.whatsapp.avatar, whatsappAvatarDataUrl, 'WhatsApp company avatar URLs must save in the WhatsApp variant');
  assert.notEqual(isolatedScenario.variants.rcs.avatar, whatsappAvatarDataUrl, 'A WhatsApp company avatar must not overwrite the RCS variant');
  await channelIsolationContext.close();
  const context = await createContext({ acceptDownloads:true, viewport:{ width:1440, height:960 } });
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

  async function verifyStandaloneChannelExport(channel) {
    const exportContext = await createContext({ acceptDownloads:true, viewport:{ width:1440, height:960 } });
    const exportPage = await exportContext.newPage();
    await exportPage.goto(baseUrl, { waitUntil:'networkidle' });
    await enableManual(exportPage);
    await exportPage.locator(`[data-channel="${channel}"]`).click();
    await exportPage.waitForFunction(expected => document.querySelector('[data-channel].active')?.dataset.channel === expected, channel);
    const download = await Promise.all([
      exportPage.waitForEvent('download'),
      exportPage.locator('#export').click()
    ]).then(([value]) => value);
    const exportedPath = `${exportDirectory}/${channel}-standalone-${await download.suggestedFilename()}`;
    await download.saveAs(exportedPath);
    const exportedHtml = await readFile(exportedPath, 'utf8');
    assert.match(exportedHtml, /id="standalone-asset-data"/, `${channel} standalone export must include its offline image registry`);

    const errors = [];
    const dependencies = [];
    const standalonePage = await exportContext.newPage();
    standalonePage.on('pageerror', error => errors.push(error.message));
    standalonePage.on('request', request => {if(request.resourceType()!=='document'&&!/^(data:|blob:|about:)/.test(request.url()))dependencies.push(request.url())});
    await standalonePage.goto(`file://${exportedPath}`, { waitUntil:'load' });
    await standalonePage.waitForTimeout(150);
    assert.equal(await standalonePage.locator('#bootstrapFailure').isVisible(), false, `${channel} standalone export must not show a builder startup failure`);
    assert.equal(await standalonePage.locator('#bootstrapStatus').isVisible(), false, `${channel} standalone export must replace the startup placeholder with the channel preview`);
    assert.equal(await standalonePage.locator('.builder').isVisible(), false, `${channel} standalone export must hide the builder`);
    assert.equal(errors.length, 0, `${channel} standalone export must not raise a browser error: ${errors.join('; ')}`);
    assert.deepEqual(dependencies, [], `${channel} offline preview must not request external or local image dependencies`);
    assert.equal(await standalonePage.locator('#stage img').evaluateAll(images=>images.every(image=>image.complete&&image.naturalWidth>0)),true,`${channel} visible offline images must decode`);
    await exportContext.close();
  }

  for (const channel of ['sms', 'rcs', 'whatsapp', 'email']) await verifyStandaloneChannelExport(channel);

  const download = await Promise.all([page.waitForEvent('download'), page.locator('#export').click()]).then(([value]) => value);
  const exported = `${exportDirectory}/${await download.suggestedFilename()}`;
  await download.saveAs(exported);
  const exportedHtml = await readFile(exported, 'utf8');
  assert.match(exportedHtml, /id="standalone-asset-data"/, 'Standalone exports must include the offline image registry');
  for (const asset of ['assets/v2-modern.css', 'assets/v2/live-region.js', 'assets/v2-modern.js']) assert.match(exportedHtml, new RegExp(`data-standalone-asset="${asset.replace(/[./]/g, '\\$&')}"`), `Standalone export must embed ${asset}`);
  const exportedPage = await context.newPage();
  await exportedPage.goto(`file://${exported}`, { waitUntil:'load' });
  await exportedPage.waitForTimeout(100);
  assert.equal(await exportedPage.locator('.builder').isVisible(), false, 'Standalone export must hide the builder');
  await exportedPage.locator('[data-thread], [data-email], [data-wa-thread]').first().click();
  await exportedPage.locator('#stage .conversation, #stage .g-detail-scroll, #stage .wa-chat').waitFor();
  await exportedPage.locator('[data-v2-preview-reset]').click();
  await exportedPage.locator('#stage .message-list, #stage .g-list-scroll, #stage .wa-list').waitFor();
  await exportedPage.locator('[data-v2-preview-focus]').click();
  await exportedPage.waitForFunction(() => document.body.classList.contains('v2-focus-mode'));
  await exportedPage.locator('[data-v2-preview-present]').click();
  await exportedPage.waitForFunction(() => document.body.classList.contains('presentation'));
  await exportedPage.keyboard.press('Escape');
  await exportedPage.waitForFunction(() => !document.body.classList.contains('presentation'));
  let fallbackPrompt = '';
  await page.route('**/assets/avatars/company-avatar-sheet.png', route => route.abort());
  page.once('dialog', async dialog => { fallbackPrompt = dialog.message(); await dialog.accept(); });
  const fallbackDownload = await Promise.all([page.waitForEvent('download'), page.locator('#export').click()]).then(([value]) => value);
  await page.unroute('**/assets/avatars/company-avatar-sheet.png');
  assert.match(fallbackPrompt, /(?:company profile image|Preview image company-avatar-sheet\.png).*download anyway/i, 'A failed visual asset must offer a named download-anyway choice');
  const fallbackExported = `${exportDirectory}/fallback-${await fallbackDownload.suggestedFilename()}`;
  await fallbackDownload.saveAs(fallbackExported);
  const fallbackHtml = await readFile(fallbackExported, 'utf8');
  assert.match(fallbackHtml, /assets\/avatars\/company-avatar-sheet\.png/, 'A user-confirmed fallback export may retain only the unavailable image path');
  const localPage = await context.newPage();
  await localPage.goto(`file://${process.cwd()}/interactive-simulator-builder.html`, { waitUntil:'load' });
  await localPage.waitForSelector('.v2-workspace-nav');
  assert.ok(await localPage.locator('[data-v2-preview-focus]').count(), 'Local file mode must retain the 2.0 workspace enhancements');
  await browser.close();
  console.log('2.0 browser, accessibility, and standalone-export smoke test: OK');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await Promise.race([once(server, 'exit'), new Promise(resolve => setTimeout(resolve, 1_000))]);
}
