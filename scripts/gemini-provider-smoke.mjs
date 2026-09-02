const key = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

if (!key) throw new Error('GEMINI_API_KEY is missing');

const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
  method:'POST',
  headers:{ 'Content-Type':'application/json' },
  body:JSON.stringify({
    contents:[{ parts:[{ text:'Return exactly the JSON object {"ok":true}.' }] }],
    generationConfig:{ responseMimeType:'application/json', maxOutputTokens:128 }
  })
});

if (!response.ok) throw new Error(`Gemini returned ${response.status}`);
const body = await response.json();
const candidate = body.candidates?.[0];
if (!candidate?.content?.parts?.length) {
  const diagnostic = {
    candidateCount:body.candidates?.length || 0,
    finishReason:candidate?.finishReason || null,
    promptBlockReason:body.promptFeedback?.blockReason || null
  };
  throw new Error(`Gemini returned no candidate (${JSON.stringify(diagnostic)})`);
}
console.log(`Gemini provider smoke: OK (${model})`);
