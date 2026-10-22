// Synthetic browser-only feedback service. No outgoing submissions.
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {browserOptions} from './browser-options.mjs';
import path from 'node:path';
const browser=await chromium.launch(browserOptions);
try {
 const page=await browser.newPage(); page.setDefaultTimeout(7000);
 page.on('pageerror',error=>console.error(error));
 await page.route('**/*',route=>route.fulfill({status:200,contentType:'application/json',body:'{}'}));
 await page.goto('https://studio.test/');
 await page.setContent('<button id="feedback-trigger">Feedback</button><button id="inbox-trigger" hidden>adminInbox</button>');
 await page.evaluate(()=>{
  window.testEmail='';window.testAdmin=false;window.feedbackCalls=[];window.failFeedback=true;
  window.SaasyAuth={getEmail:()=>window.testEmail,isSignedIn:()=>!!window.testEmail,
   getFeedbackSession:async tool=>({email:window.testEmail,admin:window.testAdmin}),
   listFeedback:async opts=>({items:[],total:0,unreadCount:2,pageSize:25}),
   submitFeedback:async(payload,key)=>{window.feedbackCalls.push({payload,key});if(window.failFeedback)throw Error('Offline');return{id:'persisted-feedback'};}};
 });
 await page.addScriptTag({path:path.resolve('assets/feedback.js')});
 await page.evaluate(()=>TwoWayFeedback.mount({trigger:document.querySelector('#feedback-trigger'),inboxTrigger:document.querySelector('#inbox-trigger')}));
 await page.click('#feedback-trigger');
 await page.fill('#feedback-name','Guest');await page.fill('#feedback-email','guest@example.test');await page.fill('#feedback-description','Please improve previews');
 await page.click('#feedback-submit');await page.waitForFunction(()=>document.querySelector('#feedback-message').textContent.includes('Offline'));
 await page.click('#feedback-submit');await page.waitForFunction(()=>window.feedbackCalls.length===2);
 assert.equal(await page.evaluate(()=>feedbackCalls[0].key===feedbackCalls[1].key),true);
 assert.equal(await page.evaluate(()=>feedbackCalls[0].payload.tool),'twoway');
 assert.equal(await page.evaluate(()=>feedbackCalls[0].payload.context.appName),'2 Way Experience Studio');
 await page.evaluate(()=>{window.failFeedback=false;});await page.click('#feedback-submit');await page.waitForFunction(()=>!document.querySelector('#feedback-success').hidden);
 await page.click('#feedback-done');
 await page.evaluate(async()=>{window.testEmail='other@salesforce.com';window.testAdmin=true;await TwoWayFeedback.refreshSession(true);});
 assert.equal(await page.locator('#inbox-trigger').isHidden(),true);
 await page.evaluate(async()=>{window.testEmail='imansur@salesforce.com';await TwoWayFeedback.refreshSession(true);});
 assert.equal(await page.locator('#inbox-trigger').isVisible(),true);
 await page.click('#inbox-trigger');await page.waitForFunction(()=>document.querySelector('#feedback-inbox-dialog').open);
 await page.evaluate(async()=>{window.testEmail='';window.testAdmin=false;await TwoWayFeedback.refreshSession();});
 assert.equal(await page.locator('#inbox-trigger').isHidden(),true);
 assert.equal(await page.evaluate(()=>document.querySelector('#feedback-inbox-dialog').open),false);
 assert.equal(await page.locator('#feedback-inbox-detail').textContent(),'');
 console.log('Feedback browser checks passed: guest retry, tool context, strict admin, sign-out clearing.');
} finally {await browser.close();}
