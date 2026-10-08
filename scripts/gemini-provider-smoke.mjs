import assert from 'node:assert/strict';
import configModule from '../server/ai-config.cjs';

const config=configModule.aiConfig();
assert.equal(process.env.ALLOW_LIVE_AI,'1','Set ALLOW_LIVE_AI=1 to authorize exactly one potentially billable provider request.');
assert.ok(config.apiKey,'GEMINI_API_KEY is missing');
const response=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(config.model)+':generateContent',{
  method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':config.apiKey},
  signal:AbortSignal.timeout(config.timeoutMs),
  body:JSON.stringify({contents:[{parts:[{text:'Return exactly the JSON object {"ok":true}.'}]}],generationConfig:{responseMimeType:'application/json',maxOutputTokens:128}}),
});
assert.ok(response.ok,'Gemini returned '+response.status);
const body=await response.json(),candidate=body.candidates?.[0];
assert.equal(body.promptFeedback?.blockReason,undefined,'Provider blocked the synthetic smoke prompt');
assert.equal(candidate?.finishReason,'STOP','Provider did not finish its response');
const output=candidate?.content?.parts?.filter(part=>!part.thought).map(part=>part.text||'').join('') || '';
assert.deepEqual(JSON.parse(output),{ok:true},'Provider must return the requested JSON, not merely a candidate');
console.log(JSON.stringify({event:'gemini_provider_smoke_passed',model:config.model,providerRequests:1}));
