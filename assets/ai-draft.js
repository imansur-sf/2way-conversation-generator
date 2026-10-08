(function (root) {
  'use strict';
  const channels = ['sms', 'rcs', 'whatsapp', 'email'];
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
  const text = value => typeof value === 'string';
  const nonempty = value => text(value) && Boolean(value.trim());
  const options = value => Array.isArray(value) ? value.filter(item => text(item) && item.trim()) : String(value || '').split(',').map(item => item.trim()).filter(Boolean);
  function failure(message, issues = []) {
    const error = new Error(message); error.code = 'invalid_draft'; error.issues = issues; return error;
  }
  function publicUrl(value) {
    if (!value) return true;
    if (!text(value)) return false;
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
  }
  function validate(draft, requestedChannels) {
    const selected = [...new Set(requestedChannels || [])], issues = [];
    const invalid = (channel, message) => issues.push({channel, message});
    if (!selected.length || selected.some(channel => !channels.includes(channel))) throw failure('Choose supported channels.');
    if (!draft || draft.schemaVersion !== 2 || !nonempty(draft.companyName) || !draft.scenarios || typeof draft.scenarios !== 'object') throw failure('The server returned an unsupported or incomplete draft.');
    if (!['company','customer'].includes(draft.initialSender) || !draft.persona || ['customerName','representativeName','representativeRole'].some(key=>!text(draft.persona[key]))) invalid(null, 'The draft identity or opening sender is invalid.');
    for (const key of ['logoUrl', 'heroImageUrl', 'website']) if (!publicUrl(draft[key])) invalid(null, `Invalid ${key}.`);
    for (const channel of selected) {
      const config = draft.scenarios[channel];
      if (!config || !nonempty(config.title) || !Array.isArray(config.turns) || config.turns.length < 2 || config.turns.length > 12) { invalid(channel, 'A channel draft needs a title and 2–12 ordered messages.'); continue; }
      if (channel === 'email' && !nonempty(config.subject)) invalid(channel, 'Email needs a subject.');
      if (config.turns[0]?.speaker !== draft.initialSender) invalid(channel, 'The opening sender differs from the draft contract.');
      config.turns.forEach((turn, index) => {
        const label = `Message ${index + 1}`;
        if (!turn || !['company', 'customer'].includes(turn.speaker) || !text(turn.text)) { invalid(channel, `${label} has an invalid speaker or body.`); return; }
        if (turn.text.length > 30000) invalid(channel, `${label} is too large.`);
        const presentation = turn.presentation || {kind:'text'}, kind = presentation.kind;
        if (!['text', 'card', 'carousel', 'email'].includes(kind)) invalid(channel, `${label} has an unsupported presentation.`);
        if (channel === 'sms' && kind !== 'text' || channel !== 'email' && kind === 'email' || channel === 'email' && ['card', 'carousel'].includes(kind)) invalid(channel, `${label} presentation does not belong to this channel.`);
        if (turn.speaker === 'customer') {
          if (turn.mode && !['prefill', 'free', 'choices'].includes(turn.mode)) invalid(channel, `${label} has an unsupported reply mode.`);
          if (turn.mode === 'choices' && (!Array.isArray(turn.options) || !turn.options.length || turn.options.length > 6 || turn.options.some(option => !nonempty(option)))) invalid(channel, `${label} needs 1–6 usable reply choices.`);
          if ((!turn.mode || turn.mode === 'prefill') && !nonempty(turn.text)) invalid(channel, `${label} needs a prefilled reply.`);
          if (['card', 'carousel'].includes(kind)) invalid(channel, `${label} customer cards are not supported.`);
        }
        if (['card', 'carousel'].includes(kind)) {
          const cards = presentation.cards;
          if (!Array.isArray(cards) || kind === 'card' && cards.length !== 1 || kind === 'carousel' && (cards.length < 2 || cards.length > 4)) invalid(channel, `${label} has an invalid card set.`);
          else cards.forEach(card => {
            if (!card || ![card.title, card.description, card.imageUrl].some(nonempty)) { invalid(channel, `${label} has an empty card.`); return; }
            for (const field of ['title', 'description', 'imageUrl', 'ctaLabel', 'ctaUrl']) if (own(card, field) && !text(card[field])) invalid(channel, `${label} has an invalid card field.`);
            if (!publicUrl(card.imageUrl) || !publicUrl(card.ctaUrl)) invalid(channel, `${label} has an unsafe card URL.`);
            if (Boolean(card.ctaLabel) !== Boolean(card.ctaUrl)) invalid(channel, `${label} CTA needs both label and URL.`);
          });
        } else if (turn.speaker === 'company' && !nonempty(turn.text)) invalid(channel, `${label} is empty.`);
        if (kind === 'email') {
          if (!['plain', 'branded'].includes(presentation.mode)) invalid(channel, `${label} needs a supported email mode.`);
          for (const field of ['preheader', 'heroImageUrl', 'ctaLabel', 'ctaUrl']) if (own(presentation, field) && !text(presentation[field])) invalid(channel, `${label} has an invalid email field.`);
          if (!publicUrl(presentation.heroImageUrl) || !publicUrl(presentation.ctaUrl)) invalid(channel, `${label} has an unsafe email URL.`);
          if (Boolean(presentation.ctaLabel) !== Boolean(presentation.ctaUrl)) invalid(channel, `${label} CTA needs both label and URL.`);
        }
      });
      if (!config.turns.some(turn => turn?.speaker === 'company')) invalid(channel, 'Add at least one company message.');
      if (!config.turns.some(turn => turn?.speaker === 'customer')) invalid(channel, 'A two-way draft needs at least one customer message.');
    }
    if (issues.length) throw failure('The draft is incomplete or unsupported. Nothing was applied.', issues);
    return selected;
  }
  function toScenario(channel, draft, {avatar = '', id = () => root.crypto.randomUUID()} = {}) {
    validate(draft, [channel]);
    const config = draft.scenarios[channel], company = draft.companyName;
    const scenario = {id:id(), channel, name:`${company} — ${channel === 'whatsapp' ? 'WhatsApp' : channel.toUpperCase()}: ${config.title}`, generatedByAi:true, brandName:company, smsAddress:config.sender || company, emailAddress:draft.emailAddress || '', initials:draft.initials || company.slice(0,2), avatar, avatarKind:avatar ? 'company-logo' : '', persona:{...draft.persona}, steps:[]};
    scenario.steps = config.turns.map(turn => {
      const step = {id:id(), author:turn.speaker === 'company' ? 'brand' : 'customer', kind:'text', text:turn.text, matchTerms:'', allowRepeat:false, reusableSet:true};
      const presentation = turn.presentation || {kind:'text'};
      if (turn.speaker === 'customer') return {...step, kind:turn.mode === 'free' ? 'free' : turn.mode === 'choices' ? 'prefilled' : 'prefill', options:Array.isArray(turn.options) ? [...turn.options] : [], reusableSet:false};
      if (['card', 'carousel'].includes(presentation.kind)) {
        const cards = presentation.cards.map(card => ({id:id(), title:card.title || '', description:card.description || '', image:card.imageUrl || '', cta:card.ctaLabel || '', url:card.ctaUrl || ''}));
        if (presentation.kind === 'card') Object.assign(step, {kind:'rich',cardTitle:cards[0].title,cardDescription:cards[0].description,cardImage:cards[0].image,cardCta:cards[0].cta,cardUrl:cards[0].url});
        else Object.assign(step, {kind:'carousel',cards});
      }
      if (channel === 'email') Object.assign(step, {emailMode:presentation.mode || 'plain',emailLogo:avatar,emailPreheader:presentation.preheader || '',emailHeroImage:presentation.heroImageUrl || '',emailCtaLabel:presentation.ctaLabel || '',emailCtaUrl:presentation.ctaUrl || '',emailLayout:presentation.heroImageUrl ? 'hero' : 'simple'});
      return step;
    });
    if (channel === 'email') {
      const first = scenario.steps[0].author === 'brand' ? scenario.steps[0] : null;
      Object.assign(scenario, {subject:config.subject,emailBody:first?.text || '',emailMode:first?.emailMode || 'plain',emailLogo:avatar,emailPreheader:first?.emailPreheader || '',emailHeroImage:first?.emailHeroImage || '',emailCtaLabel:first?.emailCtaLabel || '',emailCtaUrl:first?.emailCtaUrl || '',emailLayout:first?.emailLayout || 'simple'});
      for (const field of ['brandColor', 'brandSecondaryColor']) if (/^#[\da-f]{6}$/i.test(draft[field] || '')) scenario[field === 'brandColor' ? 'emailAccent' : 'emailSecondary'] = draft[field];
    }
    return scenario;
  }
  function readControls(rootDocument) {
    const value = selector => rootDocument.querySelector(selector)?.value || '';
    const raw = value('[data-v2-message-total]'), total = raw === '' ? null : Number(raw), sender = value('[data-v2-opening-sender]');
    if (total !== null && (!Number.isInteger(total) || total < 2 || total > 12)) throw failure('Exact message total must be a whole number from 2 to 12.');
    if (sender && !['company','customer'].includes(sender)) throw failure('Choose a supported opening sender.');
    return {controls:{initialSender:sender || null,expectedMessageCount:total},persona:{customerName:value('[data-v2-customer-name]'),representativeName:value('[data-v2-representative-name]'),representativeRole:value('[data-v2-representative-role]')}};
  }
  function validateResult(result, request) {
    if (!request || !result) throw failure('This draft has no matching generation request.');
    const selected=validate(result.draft,request.channels),source=result.source,requirements=result.requirements;
    if (request.companyName?.trim() && result.draft.companyName !== request.companyName.trim()) throw failure('The draft changed the explicitly supplied company name.');
    if (!source || !['provider','prompt-fallback'].includes(source.mode) || !Array.isArray(source.requestedChannels) || JSON.stringify([...new Set(source.requestedChannels)].sort())!==JSON.stringify([...selected].sort())) throw failure('The returned channels do not match the requested draft.');
    for(const channel of selected){
      const review=requirements?.channels?.[channel],turns=result.draft.scenarios[channel].turns;
      if(!review||!['passed','needs-review'].includes(review.status)||!Array.isArray(review.checks)||review.checks.some(check=>!nonempty(check.label)||!['passed','unverified','not-applicable'].includes(check.status))) throw failure('Channel validation results are incomplete or contain failed checks.');
      const sender=request.controls?.initialSender||source.brief?.initialSender,count=request.controls?.expectedMessageCount||source.brief?.expectedMessageCount,script=source.brief?.scriptedTurns;
      if(sender&&turns[0].speaker!==sender||count&&turns.length!==count)throw failure('The draft does not match the requested sender or message count.');
      if(Array.isArray(script)&&script.length>1&&(script.length!==turns.length||script.some((turn,index)=>turn.speaker!==turns[index].speaker||turn.text!==turns[index].text)))throw failure('The draft changed supplied dialogue or its order.');
      if(Array.isArray(script)&&script.length===1&&!turns.some(turn=>turn.speaker===script[0].speaker&&turn.text===script[0].text))throw failure('The draft changed a supplied dialogue line.');
    }
    for(const key of ['customerName','representativeName','representativeRole'])if(request.persona?.[key]?.trim()&&result.draft.persona[key]!==request.persona[key].trim())throw failure('The draft changed an explicitly named person.');
    return selected;
  }
  function reviewScenario(scenario, emailContent) {
    if (!scenario?.steps?.length) return null;
    const flow = scenario.steps, issues = [], companyCount = flow.filter(step => step.author === 'brand').length;
    if (!companyCount) issues.push({kind:'error',text:'Add at least one company message.'});
    flow.forEach((step, index) => {
      const rich = step.kind === 'rich' && [step.cardTitle,step.cardDescription,step.cardImage].some(nonempty) || step.kind === 'carousel' && step.cards?.some(card => [card.title,card.description,card.image].some(nonempty));
      const content = scenario.channel === 'email' && step.author === 'brand' ? emailContent(step,scenario) : {text:step.text,html:''};
      if (step.author === 'brand' && !nonempty(content.text) && !rich && !/<(?:img|table|video)\b/i.test(content.html || '')) issues.push({kind:'error',text:`Company message ${index + 1} is empty.`,stepId:step.id});
      if (step.author === 'customer' && step.kind === 'prefilled' && !options(step.options).length) issues.push({kind:'error',text:`Customer message ${index + 1} needs reply choices.`,stepId:step.id});
    });
    const keywordRouting = flow.some(step => step.author === 'customer' && step.reusableSet !== false);
    return {total:flow.length,companyCount,customerCount:flow.length-companyCount,initialSender:flow[0].author === 'brand' ? 'company' : 'customer',issues,routing:keywordRouting ? 'Keyword response sets need route testing; adjacent company messages may be alternatives.' : 'Company sequences deliver in configured order.',note:'Basic content checks only. Review facts, test replies, and verify assets during export.'};
  }
  function fallbackMessage(source) {
    const reason = {gemini_timeout:'The provider timed out.',generation_timeout:'The generation deadline was reached.',gemini_rate_limited:'The provider rate limit was reached.',gemini_bad_json:'The provider returned an unreadable draft.',invalid_draft:'The provider draft did not pass validation.',gemini_failed:'The provider could not complete the request.'}[source?.fallbackReason] || 'The provider draft was unavailable or did not pass validation.';
    return `${reason} This is a prompt-guided starter, not a provider-verified result. Coverage is ${source?.coverage === 'complete' ? 'complete for the reported checks' : 'partial'}; facts still require review.`;
  }
  const api = {validate,validateResult,toScenario,options,readControls,reviewScenario,fallbackMessage};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TwoWayAi = api;
})(typeof window === 'object' ? window : globalThis);
