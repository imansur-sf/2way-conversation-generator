(function (root) {
  'use strict';
  const text = value => typeof value === 'string' ? value : '';
  const sender = value => ['company', 'customer'].includes(value) ? value : null;
  const count = value => Number.isInteger(value) && value >= 2 && value <= 12 ? value : null;
  const controlTargets = ['opening-sender', 'message-total', 'customer-name', 'representative-name', 'representative-role'];
  const personaFields = {
    customerName: { label:'Customer name', target:'customer-name' },
    representativeName: { label:'Representative name', target:'representative-name' },
    representativeRole: { label:'Representative role', target:'representative-role' },
  };
  // Older servers and client-side draft validation do not attach issue codes.
  // Recognize only known validation wording; never infer the requested sender
  // from a model's prose or repeat arbitrary upstream text as a next step.
  function issueCode(issue) {
    if (text(issue.code) && !['invalid_draft', 'draft_invalid'].includes(issue.code)) return issue.code;
    const message = text(issue.message);
    if (/opening sender must|choose a supported opening sender/i.test(message)) return 'invalid_sender';
    if (/opening (?:sender|speaker)|must open the conversation/i.test(message)) return 'sender_mismatch';
    if (/exact message total must|message count must/i.test(message)) return 'invalid_count';
    if (/exactly \d+ messages|message count differs|message total differs/i.test(message)) return 'count_mismatch';
    if (/supplied dialogue|supplied script/i.test(message)) return 'dialogue_mismatch';
    if (/supplied in the brief is missing/i.test(message)) return 'missing_required_fact';
    return '';
  }
  function personaField(issue) {
    if (Object.hasOwn(personaFields, issue.field)) return issue.field;
    const message = text(issue.message);
    if (/\bcustomerName\b|^Customer (?:name |supplied)/i.test(message)) return 'customerName';
    if (/\brepresentativeRole\b|^Representative role/i.test(message)) return 'representativeRole';
    if (/\brepresentativeName\b|^Representative (?:name |supplied)/i.test(message)) return 'representativeName';
    return null;
  }
  function format(error, request = {}) {
    const value = typeof error === 'string' ? {code:error, message:error} : error || {};
    const code = text(value.code) || text(value.error) || text(value.message) || 'scenario_generation_failed';
    const originalIssues = Array.isArray(value.issues) ? value.issues : [];
    const issues = originalIssues.map(issue => typeof issue === 'string' ? {message:issue} : issue || {});
    if (!issues.length) issues.push({code, message:text(value.message)});
    const details = {code, message:text(value.message) || text(value.error) || code, issues:originalIssues, requestId:text(value.requestId) || text(request.requestId)};
    const actions = [], summaries = [], used = new Set();
    const add = (key, summary, next, target) => {
      if (used.has(key)) return;
      used.add(key);
      summaries.push(summary);
      actions.push({text:next, ...(target ? {target, label:target === 'opening-sender' ? 'Review first sender' : controlTargets.includes(target) ? 'Review generation controls' : target === 'website' ? 'Review company website' : 'Review scenario brief'} : {})});
    };
    const selectedSender = sender(request.controls?.initialSender);
    const selectedCount = count(request.controls?.expectedMessageCount);
    const expectedSender = [...new Set(issues.map(issue => sender(issue.expectedSender)).filter(Boolean))];
    const expectedCount = [...new Set(issues.map(issue => count(issue.expectedMessageCount)).filter(Boolean))];
    const has = candidate => issues.some(issue => issueCode(issue) === candidate);
    if (has('sender_conflict')) add('sender', 'The opening-sender instructions conflict.', 'Make “Who sends the first message?” agree with the first Company:/Customer: message and the written opening instruction, or correct the supplied dialogue order.', 'opening-sender');
    if (has('count_conflict')) add('count', 'The requested message totals conflict.', 'Use the same total in Generation controls → Exact message total, the written brief, and any supplied dialogue. Clear the control to follow the brief, or correct the conflicting instruction.', 'message-total');
    for (const issue of issues) {
      const kind = issueCode(issue);
      if (kind === 'sender_mismatch' || kind === 'invalid_sender' && issue.origin !== 'user-input' && ['draft_invalid','invalid_draft'].includes(code)) {
        const choice = expectedSender.length === 1 ? expectedSender[0] : null;
        add('sender', selectedSender ? 'The AI did not follow your selected opening sender.' : 'The generated opening sender did not match the requested conversation.', selectedSender
          ? `For this attempt, “Who sends the first message?” was set to ${selectedSender === 'company' ? 'Company opens' : 'Customer opens'}. Review the current setting and keep that selection if it is still intended, then generate again; the AI needs to follow it.`
          : `Under “Who sends the first message?”, ${choice ? `choose ${choice === 'company' ? 'Company opens' : 'Customer opens'}` : 'choose Company opens or Customer opens to match your intended first message'}, then generate again.`, 'opening-sender');
      } else if (kind === 'invalid_sender') add('sender', 'Choose a valid opening sender.', 'Under “Who sends the first message?”, select Follow the prompt, Company opens, or Customer opens.', 'opening-sender');
      else if (kind === 'count_mismatch') add('count', selectedCount ? 'The AI did not follow your selected message total.' : 'The generated message total did not match the request.', selectedCount
        ? `For this attempt, Generation controls → Exact message total was set to ${selectedCount}. Review the current setting and keep that total if it is still intended, then generate again; the AI needs to follow it.`
        : `Open Generation controls → Exact message total and ${expectedCount.length === 1 ? `enter ${expectedCount[0]} to match the requested total` : 'enter the intended total (2–12), or leave it blank to follow the prompt'}. Keep any supplied dialogue and written total consistent.`, 'message-total');
      else if (kind === 'invalid_count') add('count', 'The requested message total is not supported.', 'Check Generation controls → Exact message total and any message count in the brief. Use a whole number from 2 to 12, or clear the control to follow the prompt.', 'message-total');
      else if (kind === 'invalid_dialogue') add('dialogue', 'The supplied dialogue could not be read as a valid script.', 'Review “What should this demo show?”. Put exact dialogue on separate Company:/Customer: lines, close quotation marks, and use at most 12 nonempty messages (1,800 characters each). Descriptive instructions do not need quotation marks.', 'brief');
      else if (kind === 'dialogue_mismatch') add('dialogue', 'The AI did not preserve the dialogue you supplied.', 'Generate again with the same script. If it repeats, review “What should this demo show?” and put each exact message on its own Company:/Customer: line in the intended order. Do not change the wording unless you want to.', 'brief');
      else if (['missing_required_fact', 'invalid_persona', 'persona_mismatch'].includes(kind)) {
        const field = personaField(issue);
        if (field) {
          const meta = personaFields[field], supplied = Boolean(text(request.persona?.[field]).trim());
          add(field, kind === 'invalid_persona' ? 'A generation name or role setting is invalid.' : 'The AI did not preserve a requested name or role.', kind === 'invalid_persona'
            ? `Review Generation controls → ${meta.label}. Use text up to 160 characters, or leave it blank if not specified.`
            : supplied ? `For this attempt, you supplied an entry for Generation controls → ${meta.label}. Review the current entry and keep it if it is still intended, then generate again; the AI needs to preserve it.`
              : `Enter the intended value in Generation controls → ${meta.label}, then generate again. This makes the requested name or role explicit.`, meta.target);
        } else add('requirements', 'The AI left out a requested detail.', 'Generate again with the same brief. If it repeats, review “What should this demo show?” and state the missing requirement and its place in the conversation explicitly.', 'brief');
      } else if (['missing_requirement', 'contradicted_requirement', 'requirement_order', 'missing_rich_presentation', 'missing_speaker'].includes(kind)) add('requirements', 'The AI did not follow all requested content or sequence requirements.', 'Generate again with the same brief. If it repeats, review “What should this demo show?” and state the missing requirement and its place in the conversation explicitly.', 'brief');
      else if (['unlisted_url', 'invalid_url_in_draft', 'invalid_image', 'image_unavailable', 'asset_unavailable'].includes(kind)) add('assets', 'A generated link or image could not be used.', 'Check the affected link or image in Technical details. Add the intended public URL to the brief, or select/upload a replacement in the branding or manual editor. Opening-sender and message-count controls will not fix an image.', 'brief');
    }
    if (!actions.length) {
      if (['generation_timeout','gemini_timeout'].includes(code)) add('timeout', 'The AI did not finish a complete scenario before the deadline.', 'Generate again; your entries are kept. If it repeats, try fewer channels at once, or use the available branding recovery to build manually.');
      else if (code === 'gemini_incomplete') add('incomplete', 'The AI provider stopped before completing the scenario.', 'Generate again with the same inputs. If it repeats, try fewer channels at once, or use the available branding recovery to build manually.');
      else if (code === 'gemini_bad_json') add('unreadable', 'The AI returned a response the builder could not read.', 'Generate again with the same inputs. If it repeats, share the request ID and Technical details with the tool owner, or use the available branding recovery to build manually.');
      else if (['generation_busy','remote_busy','rate_limited','gemini_rate_limited'].includes(code)) add('busy', 'The generation service is temporarily busy.', 'Wait briefly, then generate again. Your entries are kept; no generation-control changes are needed.');
      else if (['llm_not_configured','gemini_auth_failed','gemini_model_not_found','gemini_bad_request'].includes(code)) add('service', 'The AI service needs attention from the tool owner.', 'Contact the tool owner with the request ID and Technical details below. Your inputs are kept; changing Generation controls will not resolve this service issue.');
      else if (code === 'gemini_blocked') add('blocked', 'The AI provider declined this request.', 'Review the brief for content the provider may restrict, then try again. If the request is appropriate and still fails, contact the tool owner with Technical details.', 'brief');
      else if (['invalid_url','blocked_url','blocked_host','not_html','too_large','request_timeout','website_fetch_failed','upstream_status','bad_redirect','too_many_redirects','empty_body'].includes(code)) add('website', 'The company website could not be read.', code === 'invalid_url'
        ? 'Enter a public company website URL, such as https://example.com, then generate again.'
        : 'Try the public company homepage or another relevant public page. For redirects, use the final public URL. Generation controls do not change website access.', 'website');
      else if (code === 'missing_required_fields') add('inputs', 'Some generation inputs are missing.', 'Enter a company website, describe the scenario, and select at least one channel before generating.', 'brief');
      else if (code === 'idempotency_conflict') add('changed', 'The inputs changed during a retry.', 'Choose Generate scenario drafts again to start a new request with your current entries.');
      else if (code === 'conflicting_requirements') add('conflict', 'The generation requirements conflict.', 'Review “Who sends the first message?” and Generation controls → Exact message total alongside the written brief and any supplied dialogue. Make the instructions consistent before generating.', 'opening-sender');
      else if (code === 'invalid_controls') add('controls', 'A generation-control setting is invalid.', 'Review “Who sends the first message?” and Generation controls → Exact message total. Choose a listed sender and use a whole-number total from 2 to 12, or leave them blank to follow the prompt.', 'opening-sender');
      else add('generic', ['draft_invalid','invalid_draft'].includes(code) ? 'The generated scenario did not pass its content checks.' : 'The scenario could not be generated.', 'Generate again with the same inputs. If it repeats, share the request ID and Technical details with the tool owner, or use available branding recovery to build manually.');
    }
    const summary = summaries.length === 1 ? summaries[0] : 'The scenario did not meet several requested content checks. Review the next steps below.';
    const controlTarget = actions.find(action => controlTargets.includes(action.target))?.target;
    return {summary:`${summary} Nothing was applied. Your entries are kept.`, actions:actions.slice(0,4), details, ...(controlTarget ? {controlTarget} : {})};
  }
  const api = {format};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TwoWayAiErrorGuidance = api;
})(typeof window === 'object' ? window : globalThis);
