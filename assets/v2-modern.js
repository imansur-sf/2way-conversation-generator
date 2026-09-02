(() => {
  const scenarioKey = 'two-way-experience-studio-v2-scenarios';
  let lastRequirements = null;
  let jobStatus = '';
  const { createAnnouncer, createScenarioBackup } = window.TwoWayV2 || {};
  if (!createAnnouncer || !createScenarioBackup) return;
  const announce = createAnnouncer();
  const enableIndexedDbMirror = createScenarioBackup({ scenarioKey, announce });
  const htmlEscape = value => String(value || '').replace(/[&<>"]/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' })[character]);

  const hydrateLabels = root => {
    const scenarioSelect = root.querySelector('#scenarioSelect');
    if (scenarioSelect && !scenarioSelect.getAttribute('aria-label')) scenarioSelect.setAttribute('aria-label', 'Choose saved scenario');
    root.querySelectorAll('label.label').forEach((label, index) => {
      const control = label.nextElementSibling;
      if (!control || !/^(INPUT|TEXTAREA|SELECT)$/i.test(control.tagName)) return;
      if (!control.id) control.id = `v2-field-${index}-${label.textContent.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      label.htmlFor = control.id;
    });
  };
  const hydrateImages = root => {
    root.querySelectorAll('[data-image-asset]').forEach(control => {
      const copy = control.querySelector('.image-asset-copy');
      const image = control.querySelector('img[data-image-thumbnail]');
      if (!copy || copy.querySelector('.v2-image-state')) return;
      const status = document.createElement('span');
      status.className = 'v2-image-state';
      const setStatus = (state, message) => { status.dataset.state = state; status.textContent = message; document.dispatchEvent(new CustomEvent('twoway:asset-state')); };
      setStatus(image ? (image.complete && image.naturalWidth ? 'ready' : 'checking') : 'empty', image ? (image.complete && image.naturalWidth ? 'Preview ready' : 'Checking image…') : 'No image selected');
      copy.append(status);
      if (image) {
        image.addEventListener('load', () => setStatus('ready', 'Preview ready'), { once:true });
        image.addEventListener('error', () => setStatus('unavailable', 'Image unavailable — upload a replacement or use another URL'), { once:true });
      }
      const apply = control.querySelector('[data-image-url-apply]');
      if (apply && !apply.dataset.v2ImageStateBound) {
        apply.dataset.v2ImageStateBound = 'true';
        apply.addEventListener('click', () => setStatus('checking', 'Checking image…'));
      }
    });
  };
  const hydrateRequirements = root => {
    const review = root.querySelector('.ai-review');
    if (!review || !lastRequirements || review.querySelector('.v2-requirements')) return;
    const section = document.createElement('section');
    section.className = 'v2-requirements';
    const items = lastRequirements.items || [];
    const checks = [
      lastRequirements.initialSender ? { label:'Opening sender', value:lastRequirements.initialSender === 'company' ? 'Company' : 'Customer', satisfied:lastRequirements.initialSenderSatisfied } : null,
      lastRequirements.expectedMessageCount ? { label:'Message count', value:`${lastRequirements.actualMessageCount} of ${lastRequirements.expectedMessageCount}`, satisfied:lastRequirements.countSatisfied } : null,
      lastRequirements.scriptedTurns ? { label:'Scripted order', value:`${lastRequirements.scriptedTurns} supplied turns`, satisfied:lastRequirements.scriptedTurnsSatisfied } : null
    ].filter(Boolean);
    const all = [...checks, ...items];
    section.innerHTML = `<strong>${lastRequirements.complete ? 'Prompt contract verified' : 'Prompt requirements to review'}</strong>${all.length ? `<ul>${all.map(item => `<li data-missing="${!item.satisfied}">${htmlEscape(item.label)}: ${htmlEscape(item.value)}</li>`).join('')}</ul>` : '<div>No named requirements were detected. Review the conversation before applying.</div>'}`;
    review.append(section);
  };
  const hydrateAiProgress = root => {
    const panel = root.querySelector('#setupAssistant');
    if (!panel || !jobStatus || panel.querySelector('.v2-ai-progress')) return;
    if (!['starting','queued','running'].includes(jobStatus)) return;
    const progress = document.createElement('div');
    progress.className = 'v2-ai-progress';
    const running = jobStatus === 'running';
    progress.innerHTML = `<strong>Building your scenario</strong><span>${running ? 'Reading the website and shaping the message flow.' : 'Creating a secure generation job.'}</span><ol><li class="is-complete">Website</li><li class="${running ? 'is-active' : ''}">Conversation</li><li>Requirement check</li></ol>`;
    panel.querySelector('.ai-setup-form')?.append(progress);
  };
  const hydrateGenerationControls = root => {
    const form = root.querySelector('#setupAssistant .ai-setup-form');
    if (!form || form.querySelector('.v2-generation-controls')) return;
    const controls = document.createElement('details');
    controls.className = 'v2-generation-controls';
    controls.innerHTML = `<summary>Generation controls <span>Optional precision</span></summary><div class="v2-generation-controls__body"><label>Opening sender<select data-v2-opening-sender><option value="">Follow the prompt</option><option value="company">Company opens</option><option value="customer">Customer opens</option></select></label><label>Exact message total<input type="number" min="2" max="12" inputmode="numeric" placeholder="Follow the prompt" data-v2-message-total></label><p>These are added as clear generation requirements. They do not replace your scenario description.</p></div>`;
    const generate = form.querySelector('#generateAiDraft');
    generate?.before(controls);
    const storageKey = 'two-way-experience-studio-v2-generation-controls';
    let saved = {};
    try { saved = JSON.parse(sessionStorage.getItem(storageKey) || '{}'); } catch {}
    const sender = controls.querySelector('[data-v2-opening-sender]');
    const total = controls.querySelector('[data-v2-message-total]');
    sender.value = saved.sender || '';
    total.value = saved.total || '';
    const save = () => { try { sessionStorage.setItem(storageKey, JSON.stringify({ sender:sender.value, total:total.value })); } catch {} };
    sender.addEventListener('change', save);
    total.addEventListener('input', save);
    generate?.addEventListener('click', () => {
      const prompt = form.querySelector('#aiUseCase');
      if (!prompt) return;
      const original = prompt.value.replace(/\n*\[Studio generation controls:[\s\S]*?\]\s*$/,'').trim();
      const lines = [];
      if (sender.value) lines.push(`Start the conversation with the ${sender.value}.`);
      const numericTotal = Number(total.value);
      if (numericTotal >= 2 && numericTotal <= 12) lines.push(`Create exactly ${numericTotal} total messages.`);
      prompt.value = lines.length ? `${original}\n\n[Studio generation controls: ${lines.join(' ')}]` : original;
      prompt.dispatchEvent(new Event('input', { bubbles:true }));
    }, { capture:true });
  };
  const hydrateFlowMap = root => {
    const steps = root.querySelector('#steps');
    if (!steps) return;
    const blocks = [...steps.querySelectorAll('article.block')];
    if (!blocks.length) return;
    const signature = blocks.map(block => `${block.dataset.stepBlock || ''}:${block.querySelector('.block-summary')?.textContent || block.querySelector('textarea,input[type="text"]')?.value || ''}`).join('|');
    const existing = document.querySelector('.v2-flow-map');
    if (existing?.dataset.signature === signature) return;
    existing?.remove();
    const nodes = blocks.map((block, index) => {
      const heading = block.querySelector('.block-bar strong')?.textContent?.trim() || `Message ${index + 1}`;
      const author = /customer/i.test(heading) ? 'customer' : 'company';
      const copy = block.querySelector('textarea,input[type="text"]')?.value?.trim() || block.querySelector('.block-summary')?.textContent?.trim() || '';
      const id = block.dataset.stepBlock || '';
      return `<button type="button" class="v2-flow-map__node" data-v2-flow-target="${id}" data-author="${author}"><span>${author === 'customer' ? 'Customer' : 'Company'}</span>${copy ? `<small>${copy.replace(/[<&>]/g, '')}</small>` : ''}</button>`;
    });
    const map = document.createElement('section');
    map.className = 'v2-flow-map';
    map.dataset.signature = signature;
    map.innerHTML = `<div class="v2-flow-map__head"><strong>Conversation path</strong><span>Select a message to edit it below</span></div><div class="v2-flow-map__steps">${nodes.map((node, index) => `${index ? '<span class="v2-flow-map__arrow" aria-hidden="true">→</span>' : ''}${node}`).join('')}</div>`;
    map.addEventListener('click', event => {
      const button = event.target.closest('[data-v2-flow-target]');
      if (!button) return;
      const block = steps.querySelector(`[data-step-block="${CSS.escape(button.dataset.v2FlowTarget)}"]`);
      map.querySelectorAll('[data-v2-flow-target]').forEach(item => item.toggleAttribute('data-selected', item === button));
      block?.scrollIntoView({ behavior:'smooth', block:'center' });
      block?.classList.remove('is-collapsed');
      block?.querySelector('textarea,input,select')?.focus({ preventScroll:true });
    });
    steps.before(map);
  };
  const hydrateScenarioQa = root => {
    const steps = root.querySelector('#steps');
    if (!steps) return;
    const blocks = [...steps.querySelectorAll('article.block')];
    if (!blocks.length) return;
    const flow = blocks.map((block, index) => {
      const author = /customer/i.test(block.querySelector('.badge')?.textContent || '') ? 'customer' : 'company';
      const message = block.querySelector('textarea[data-field="text"], textarea[data-step], [data-response-rich]')?.value || block.querySelector('[data-response-rich]')?.textContent || '';
      return { block, index, author, message:message.trim() };
    });
    const companyCount = flow.filter(item => item.author === 'company').length;
    const customerCount = flow.length - companyCount;
    const emptyCompany = flow.find(item => item.author === 'company' && !item.message);
    const unavailableAssets = [...root.querySelectorAll('.v2-image-state[data-state="unavailable"]')].length;
    const consecutiveCompany = flow.some((item, index) => index && item.author === 'company' && flow[index - 1].author === 'company');
    const issues = [
      !companyCount ? { kind:'error', text:'Add at least one company message so the preview can respond.' } : null,
      emptyCompany ? { kind:'error', text:`Company message ${emptyCompany.index + 1} is empty.`, target:emptyCompany.block } : null,
      unavailableAssets ? { kind:'warning', text:`${unavailableAssets} image ${unavailableAssets === 1 ? 'needs' : 'need'} a replacement.` } : null
    ].filter(Boolean);
    const signature = flow.map(item => `${item.author}:${item.message}`).join('|') + `:${unavailableAssets}`;
    const existing = root.querySelector('.v2-scenario-qa');
    if (existing?.dataset.signature === signature) return;
    existing?.remove();
    const qa = document.createElement('section');
    qa.className = 'v2-scenario-qa';
    qa.dataset.signature = signature;
    qa.innerHTML = `<div class="v2-scenario-qa__head"><div><strong>${issues.length ? 'Scenario review needed' : 'Scenario ready'}</strong><span>${flow.length} messages · ${companyCount} company · ${customerCount} customer · starts with ${flow[0].author}</span></div><i data-state="${issues.length ? 'review' : 'ready'}">${issues.length ? 'Review' : 'Ready'}</i></div>${consecutiveCompany ? '<p class="v2-scenario-qa__note">Consecutive company messages are configured as a guided sequence and will deliver in order.</p>' : ''}${issues.length ? `<ul>${issues.map((issue,index) => `<li data-kind="${issue.kind}">${htmlEscape(issue.text)}${issue.target ? `<button type="button" data-v2-qa-target="${issue.target.dataset.stepBlock || ''}">Fix</button>` : ''}</li>`).join('')}</ul>` : '<p class="v2-scenario-qa__note">Flow, sender order, and available assets are ready for preview and export.</p>'}`;
    const map = root.querySelector('.v2-flow-map');
    (map || steps).before(qa);
    qa.addEventListener('click', event => {
      const button = event.target.closest('[data-v2-qa-target]');
      if (!button) return;
      const block = steps.querySelector(`[data-step-block="${CSS.escape(button.dataset.v2QaTarget)}"]`);
      block?.classList.remove('is-collapsed');
      block?.scrollIntoView({ behavior:'smooth', block:'center' });
      block?.querySelector('textarea,input,[contenteditable="true"]')?.focus({ preventScroll:true });
    });
  };
  const hydratePreviewMode = root => {
    const preview = root.querySelector('.preview');
    if (!preview || preview.querySelector('.v2-preview-mode')) return;
    const control = document.createElement('div');
    control.className = 'v2-preview-mode';
    control.setAttribute('aria-label', 'Preview actions');
    control.innerHTML = '<button type="button" data-v2-preview-reset>Reset path</button><button type="button" data-v2-preview-focus>Focus mode</button><button type="button" data-v2-preview-present>Present</button>';
    control.addEventListener('click', event => {
      if (event.target.closest('[data-v2-preview-reset]')) document.querySelector('#reset')?.click();
      if (event.target.closest('[data-v2-preview-present]')) document.querySelector('#presentation')?.click();
      const focus = event.target.closest('[data-v2-preview-focus]');
      if (focus) {
        const enabled = document.body.classList.toggle('v2-focus-mode');
        focus.textContent = enabled ? 'Exit focus' : 'Focus mode';
        focus.setAttribute('aria-pressed', String(enabled));
        announce(enabled ? 'Focus mode on. The preview is enlarged.' : 'Focus mode off. The builder is visible again.');
      }
    });
    preview.querySelector('.preview-info')?.before(control);
    const builder = root.querySelector('.builder');
    if (builder && !builder.querySelector('.v2-focus-rail')) {
      const exit = document.createElement('button');
      exit.className = 'v2-focus-rail';
      exit.type = 'button';
      exit.innerHTML = '<span aria-hidden="true">‹</span><b>Edit</b>';
      exit.setAttribute('aria-label', 'Exit focus mode and show builder');
      exit.addEventListener('click', () => {
        document.body.classList.remove('v2-focus-mode');
        control.querySelector('[data-v2-preview-focus]')?.replaceChildren(document.createTextNode('Focus mode'));
        control.querySelector('[data-v2-preview-focus]')?.setAttribute('aria-pressed', 'false');
      });
      builder.prepend(exit);
    }
  };
  const mountNavigation = () => {
    const builder = document.querySelector('.builder');
    if (!builder || builder.querySelector('.v2-workspace-nav')) return;
    const sections = [builder.querySelector(':scope > .section'), builder.querySelector('#manualChannelSection'), builder.querySelector('#manualConversationSection'), builder.querySelector('#manualActions')].filter(Boolean);
    const labels = ['Scenario', 'Identity', 'Flow', 'Export'];
    sections.forEach((section, index) => { section.classList.add('v2-section-anchor'); section.id ||= `v2-section-${index}`; });
    const nav = document.createElement('nav');
    nav.className = 'v2-workspace-nav';
    nav.setAttribute('aria-label', 'Builder sections');
    nav.innerHTML = labels.map((label, index) => `<button type="button" data-v2-section="${index}" ${index === 0 ? 'aria-current="step"' : ''}><span>${index + 1}</span>${label}</button>`).join('');
    nav.addEventListener('click', event => {
      const button = event.target.closest('[data-v2-section]');
      if (!button) return;
      const index = Number(button.dataset.v2Section);
      const section = sections[index];
      if (index > 0 && section?.hidden) {
        document.querySelector('#chooseManual, #v2-switch-to-manual, #switchToAi')?.click();
        requestAnimationFrame(() => document.querySelector(`#v2-section-${index}`)?.scrollIntoView({ behavior:'smooth', block:'start' }));
      } else section?.scrollIntoView({ behavior:'smooth', block:'start' });
      nav.querySelectorAll('button').forEach(item => item.removeAttribute('aria-current'));
      button.setAttribute('aria-current', 'step');
    });
    const updateActiveSection = () => {
      const builderTop = builder.getBoundingClientRect().top;
      const visible = sections.filter(section => !section.hidden);
      const current = visible.reduce((closest, section) => Math.abs(section.getBoundingClientRect().top - builderTop) < Math.abs(closest.getBoundingClientRect().top - builderTop) ? section : closest, visible[0]);
      const index = sections.indexOf(current);
      if (index < 0) return;
      nav.querySelectorAll('button').forEach(item => item.toggleAttribute('aria-current', Number(item.dataset.v2Section) === index));
    };
    builder.addEventListener('scroll', updateActiveSection, { passive:true });
    if (!document.documentElement.dataset.v2KeyboardNavigation) {
      document.documentElement.dataset.v2KeyboardNavigation = 'true';
      document.addEventListener('keydown', event => {
        if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !/^[1-4]$/.test(event.key)) return;
        if (event.target.matches('input,textarea,select,[contenteditable="true"]')) return;
        event.preventDefault();
        nav.querySelector(`[data-v2-section="${Number(event.key) - 1}"]`)?.click();
      });
    }
    builder.prepend(nav);
  };
  const hydrate = () => {
    mountNavigation();
    hydrateLabels(document);
    hydrateImages(document);
    hydrateRequirements(document);
    hydrateAiProgress(document);
    hydrateGenerationControls(document);
    hydrateFlowMap(document);
    hydrateScenarioQa(document);
    hydratePreviewMode(document);
  };

  document.addEventListener('twoway:ai-job', event => {
    jobStatus = event.detail?.status || '';
    if (jobStatus === 'failed') announce('AI draft generation could not complete. Review the error and try again.');
    hydrate();
  });
  document.addEventListener('twoway:ai-draft', event => {
    lastRequirements = event.detail?.requirements || null;
    jobStatus = 'completed';
    announce(lastRequirements?.complete ? 'AI draft is ready and captures the named prompt requirements.' : 'AI draft is ready. Review the prompt requirements before applying.');
    hydrate();
  });
  document.addEventListener('twoway:asset-state', () => hydrateScenarioQa(document));

  const observe = () => new MutationObserver(() => hydrate()).observe(document.body, { childList:true, subtree:true });
  window.addEventListener('DOMContentLoaded', () => { hydrate(); observe(); enableIndexedDbMirror(); });
})();
