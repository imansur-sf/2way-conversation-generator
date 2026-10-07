import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {browserOptions} from './browser-options.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = 3187;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:String(port),APP_ENV:'test',GEMINI_API_KEY:''},stdio:['ignore','pipe','pipe']});
let browser;
let serverLog='';server.stdout.on('data',chunk=>serverLog+=chunk);server.stderr.on('data',chunk=>serverLog+=chunk);
const attack = `<p><b>Keep this formatting</b></p><img src="/missing-audit-image" onerror='window.__auditProbe=true'><a href="javascript:window.__auditProbe=true">Unsafe</a><svg onload="window.__auditProbe=true"></svg>`;
const scenario = (mode='branded')=>({id:'security-fixture',name:'Security fixture',channel:'email',brandName:'Synthetic company',emailAddress:'audit@example.test',subject:'Safe markup test',emailBody:'Fallback text',initials:'SC',avatar:'',steps:[{id:'opening',author:'brand',kind:'text',text:'Opening',emailMode:mode,emailHtml:mode==='branded'?attack:'',customHtml:mode==='html'?attack:''},{id:'reply',author:'customer',kind:'free',text:''}]});
try {
  let ready=false;
  for(let i=0;i<50;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100));}
  assert.ok(ready,`Server did not start: ${serverLog}`);
  browser=await chromium.launch(browserOptions);
  for(const kind of ['json-import','share-link','custom-html-sandbox']){
    const context=await browser.newContext();
    await context.route('https://**/*',route=>route.abort());
    const page=await context.newPage();page.setDefaultTimeout(10000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const fragment=kind==='share-link'?'#scenario='+encodeURIComponent(Buffer.from(JSON.stringify(scenario())).toString('base64')):'';
    await page.goto(base+'/'+fragment,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.querySelector('#scenarioSelect')?.options.length>0);
    await page.evaluate(async()=>{await window.__twoWayScenarioInitialization});
    if(kind!=='share-link')await page.locator('#importScenarioFile').setInputFiles({name:'fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(scenario(kind==='custom-html-sandbox'?'html':'branded')))});
    await page.waitForFunction(expected=>document.querySelector('#scenarioName')?.value===expected,kind==='share-link'?'Security fixture (shared)':'Security fixture',{timeout:10000});
    await page.locator('[data-email="0"]').click();
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(()=>window.__auditProbe===true),false,`${kind} must not execute active markup`);
    assert.equal(errors.length,0,`${kind}: ${errors.join('; ')}`);
    if(kind==='custom-html-sandbox')assert.equal(await page.locator('iframe.custom-html-email-frame').getAttribute('sandbox'),'');
    else{
      assert.equal(await page.locator('#stage [onerror*="__auditProbe"], #stage svg[onload], #stage a[href^="javascript:"]').count(),0);
      assert.equal(await page.locator('#stage .scenario-email-copy b').textContent(),'Keep this formatting');
    }
    const sanitized=await page.evaluate(()=>{
      const html=window.TwoWayEmailSafety.sanitizeRichHtml('<div id="stage" style="position:fixed;z-index:999;color:red"><img src=x onerror=alert(1)><a target="_blank" href="https://example.com">Safe</a><a href="javas&#99;ript:alert(1)">Bad</a><iframe srcdoc="bad"></iframe></div>');
      return html;
    });
    assert.doesNotMatch(sanitized,/onerror|javascript:|<iframe|id="stage"|position:|z-index:/i);
    assert.match(sanitized,/color:\s*red/);assert.match(sanitized,/rel="noopener noreferrer"/);
    const transferResult=await page.evaluate(html=>{
      const editor=document.createElement('div');editor.id='richEmailEditor';editor.contentEditable='true';document.body.append(editor);editor.focus();
      const range=document.createRange();range.selectNodeContents(editor);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
      const transfer=new DataTransfer();transfer.setData('text/html',html);
      editor.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));
      const pasted=editor.innerHTML;
      editor.dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));
      const dropped=editor.innerHTML;editor.remove();return {pasted,dropped};
    },attack);
    for(const markup of Object.values(transferResult)){
      assert.match(markup,/Keep this formatting/);
      assert.doesNotMatch(markup,/onerror|javascript:|<svg/i);
    }
    console.log(`PASS ${kind}: safe rendering and formatting`);
    await context.close();
  }
  for(const source of ['shared','saved']){
    const context=await browser.newContext();context.setDefaultTimeout(10000);
    await context.route('https://**/*',route=>route.abort());
    const fixture=scenario();fixture.emailCtaUrl='javascript:window.__auditProbe=true';
    fixture.steps[0].id='opening"><img src="/missing" onerror="window.__auditProbe=true"><i data-x="';
    fixture.steps[0].emailCtaLabel='Unsafe CTA';
    if(source==='saved')await context.addInitScript(value=>localStorage.setItem('two-way-experience-studio-v2-scenarios',JSON.stringify({version:4,scenarios:[value]})),fixture);
    const page=await context.newPage(), errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/'+(source==='shared'?'#scenario='+encodeURIComponent(Buffer.from(JSON.stringify(fixture)).toString('base64')):''));
    await page.evaluate(async()=>{await window.__twoWayScenarioInitialization});
    await page.locator('[data-email="0"]').click();
    assert.equal(await page.locator('#stage a[href^="javascript:"]').count(),0,`${source} CTA schemes must be validated`);
    assert.equal(await page.locator('[onerror*="__auditProbe"]').count(),0,`${source} identifiers must never create markup`);
    assert.equal(await page.evaluate(()=>window.__auditProbe===true),false);
    assert.deepEqual(errors,[]);
    console.log(`PASS ${source}: unsafe identifiers and CTA URLs are inert`);
    await context.close();
  }
} finally {
  await browser?.close();server.kill('SIGTERM');
  await Promise.race([once(server,'exit'),new Promise(resolve=>setTimeout(resolve,1000))]);
}
