/* Versioned editable workspace format. Local autosave keeps its own format. */
(function (global) {
  'use strict';
  const TOOL = 'twoway', MAX_BYTES = 19 * 1024 * 1024;
  const aiFields = ['companyName','website','useCase','channels','draft','source','requirements','requestSnapshot','selectedVisualIndex','logoOptionUrls','branding','brandingSelection','error','failureGuidance'];
  const clone = value => JSON.parse(JSON.stringify(value));
  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
    return JSON.stringify(value);
  }
  function validate(payload) {
    if (!payload || payload.format !== 'twoway-project' || payload.version !== 1) throw new Error('This project uses an unsupported workspace format. Your editor was kept.');
    const workspace = payload.workspace;
    if (!workspace || !Array.isArray(workspace.scenarios) || !workspace.scenarios.length || !workspace.settings || !workspace.aiSetup) throw new Error('This project is incomplete. Your editor was kept.');
    const ids = new Set(), channels = ['sms','rcs','whatsapp','email'];
    const validVariant = variant => variant && typeof variant === 'object' && Array.isArray(variant.steps) && variant.steps.every(step => step && typeof step === 'object' && !Array.isArray(step));
    for (const scenario of workspace.scenarios) {
      if (!scenario || typeof scenario.id !== 'string' || !scenario.id || ids.has(scenario.id) || typeof scenario.name !== 'string' || !channels.includes(scenario.channel) || !validVariant(scenario)) throw new Error('This project contains an invalid scenario. Your editor was kept.');
      ids.add(scenario.id);
      if (scenario.scenarioMode === 'multi' && (!scenario.variants || !scenario.variants[scenario.channel] || !Object.keys(scenario.variants).length || !Object.entries(scenario.variants).every(([channel, variant]) => channels.includes(channel) && validVariant(variant)))) throw new Error('This project contains invalid channel variants. Your editor was kept.');
    }
    if (!ids.has(workspace.activeId) || !['auto','1','.85','.7'].includes(workspace.settings.previewScale) || !['choose','manual','ai','review'].includes(workspace.settings.setupMode)) throw new Error('This project contains invalid workspace settings. Your editor was kept.');
    if (workspace.settings.generationControls && (typeof workspace.settings.generationControls !== 'object' || Array.isArray(workspace.settings.generationControls) || Object.values(workspace.settings.generationControls).some(value => typeof value !== 'string'))) throw new Error('This project contains invalid generation controls. Your editor was kept.');
    const ai = workspace.aiSetup;
    if (typeof ai !== 'object' || Array.isArray(ai) || !ai.channels || typeof ai.channels !== 'object' || !['companyName','website','useCase'].every(key => typeof ai[key] === 'string')) throw new Error('This project contains invalid AI settings. Your editor was kept.');
    if (ai.draft && (typeof ai.draft !== 'object' || !ai.requestSnapshot || !Array.isArray(ai.requestSnapshot.channels) || !ai.requestSnapshot.channels.every(channel => channels.includes(channel)))) throw new Error('This project contains an incomplete AI draft. Your editor was kept.');
    for (const [object, key] of [[ai.source,'imageCandidates'],[ai,'logoOptionUrls'],[ai.failureGuidance,'actions'],[ai.branding,'imageCandidates'],[ai.requirements,'warnings']]) {
      if (object?.[key] != null && !Array.isArray(object[key])) throw new Error('This project contains invalid review data. Your editor was kept.');
    }
    if (ai.failureGuidance && (!Array.isArray(ai.failureGuidance.actions) || ai.failureGuidance.actions.some(action => !action || typeof action.text !== 'string'))) throw new Error('This project contains invalid generation guidance. Your editor was kept.');
    if (ai.requirements && (!ai.requirements.channels || typeof ai.requirements.channels !== 'object' || Object.values(ai.requirements.channels).some(result => !result || !Array.isArray(result.checks) || result.checks.some(check => !check || typeof check.label !== 'string')) || ai.requirements.warnings?.some(warning => !warning || (typeof warning !== 'string' && typeof warning.message !== 'string')))) throw new Error('This project contains invalid review checks. Your editor was kept.');
    if (Object.values(ai.channels).some(value => typeof value !== 'boolean') || (ai.error != null && typeof ai.error !== 'string')) throw new Error('This project contains invalid AI settings. Your editor was kept.');
    return clone(payload);
  }
  function build(state) {
    const aiSetup = captureAi(state.aiSetup);
    return validate({format:'twoway-project',version:1,workspace:{scenarios:clone(state.scenarios),activeId:state.activeId,settings:{previewScale:state.previewScale || 'auto',setupMode:state.setupMode || 'manual'},aiSetup}});
  }
  function assertSize(payload) {
    if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > MAX_BYTES) throw new Error('This workspace exceeds the 19 MiB cloud limit. Your local work is intact. Export JSON or reduce uploaded image sizes before trying again.');
  }
  function captureAi(ai) { return Object.fromEntries(aiFields.filter(key => ai[key] !== undefined).map(key => [key, clone(ai[key])])); }
  const api = {TOOL,MAX_BYTES,clone,canonical,validate,build,assertSize,captureAi};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.TwoWayProjectFormat = api;
})(typeof window === 'undefined' ? globalThis : window);
