(() => {
  const scenarioKey = 'two-way-experience-studio-v2-scenarios';
  let lastRequirements = null;
  let lastSource = null;
  let activeAiRequest = null;
  let jobStatus = '';
  const { createAnnouncer, createScenarioBackup } = window.TwoWayV2 || {};
  if (!createAnnouncer) return;
  const announce = createAnnouncer();
  // A downloaded interactive HTML bundles the workspace controls but deliberately
  // omits the browser-profile backup service. Keep the controls usable there.
  const enableIndexedDbMirror = typeof createScenarioBackup === 'function'
    ? createScenarioBackup({ scenarioKey, announce })
    : () => {};
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
    const status = {'passed':'Passed','failed':'Not met','unverified':'Not verified','not-applicable':'Not applicable'};
    const entries = Object.entries(lastRequirements.channels || {});
    const persona = lastSource?.brief?.persona || {};
    section.innerHTML = `<strong>Channel checks — review before applying</strong><p>${lastSource?.mode === 'prompt-fallback' ? 'Prompt-guided starter' : 'Provider-generated draft'} · Coverage: ${htmlEscape(lastSource?.coverage || 'not reported')}. Factual accuracy is not verified.</p><p>Customer: ${htmlEscape(persona.customerName || 'Not specified')} · Representative: ${htmlEscape(persona.representativeName || 'Not specified')}</p>${entries.map(([channel, result]) => `<h5>${htmlEscape(channel === 'whatsapp' ? 'WhatsApp' : channel.toUpperCase())}</h5><ul>${(result.checks || []).map(check => `<li data-missing="${check.status === 'failed'}">${htmlEscape(check.label)}: ${htmlEscape(status[check.status] || 'Not verified')}${check.detail ? ' — ' + htmlEscape(check.detail) : ''}</li>`).join('')}</ul>`).join('')}${(lastRequirements.warnings || []).length ? `<ul>${lastRequirements.warnings.map(warning => `<li>${htmlEscape(typeof warning === 'string' ? warning : warning.message || '')}</li>`).join('')}</ul>` : ''}`;
    review.append(section);
  };
  const hydrateAiProgress = root => {
    const panel = root.querySelector('#setupAssistant');
    if (!panel) return;
    const existing = panel.querySelector('.v2-ai-progress');
    if (!['starting','queued','running'].includes(jobStatus)) { existing?.remove(); return; }
    const description = jobStatus === 'starting' ? 'Submitting the generation request.' : jobStatus === 'queued' ? 'Waiting for generation to start.' : 'Generation is running. Website research and validation are not complete until the result is returned.';
    if (existing?.dataset.status === jobStatus) return;
    existing?.remove();
    const progress = document.createElement('div');
    progress.className = 'v2-ai-progress';
    progress.dataset.status = jobStatus;
    progress.innerHTML = `<strong>Building your scenario</strong><span>${description}</span>`;
    panel.querySelector('.ai-setup-form')?.append(progress);
  };
  const hydrateGenerationControls = root => {
    const form = root.querySelector('#setupAssistant .ai-setup-form');
    if (!form || form.querySelector('.v2-generation-controls')) return;
    const controls = document.createElement('details');
    controls.className = 'v2-generation-controls';
    controls.innerHTML = '<summary>Generation controls <span>Optional precision</span></summary><div class="v2-generation-controls__body"><label>Opening sender<select data-v2-opening-sender><option value="">Follow the prompt</option><option value="company">Company opens</option><option value="customer">Customer opens</option></select></label><label>Exact message total<input type="number" min="2" max="12" step="1" inputmode="numeric" placeholder="Follow the prompt" data-v2-message-total></label><label>Customer name<input data-v2-customer-name placeholder="Not specified"></label><label>Representative name<input data-v2-representative-name placeholder="Not specified"></label><label>Representative role<input data-v2-representative-role placeholder="Not specified"></label><p>Optional structured requirements. Your prompt is kept unchanged; conflicting dialogue must be resolved before generation.</p></div>';
    form.querySelector('#generateAiDraft')?.before(controls);
    const storageKey = 'two-way-experience-studio-v2-generation-controls';
    let saved = {};
    try { saved = JSON.parse(sessionStorage.getItem(storageKey) || '{}'); } catch {}
    const fields = {sender:'[data-v2-opening-sender]',total:'[data-v2-message-total]',customerName:'[data-v2-customer-name]',representativeName:'[data-v2-representative-name]',representativeRole:'[data-v2-representative-role]'};
    for (const [key,selector] of Object.entries(fields)) controls.querySelector(selector).value = saved[key] || '';
    const save = () => { try { sessionStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(Object.entries(fields).map(([key,selector]) => [key,controls.querySelector(selector).value])))); } catch {} };
    controls.addEventListener('input', save);
    controls.addEventListener('change', save);
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
    const steps = root.querySelector('#steps'),review = window.TwoWayAi?.getScenarioReview?.();
    if (!steps || !review) return;
    const assetStates = [...root.querySelectorAll('.v2-image-state')].map(node=>node.dataset.state);
    const unavailable = assetStates.filter(state=>state==='unavailable').length,checking = assetStates.filter(state=>state==='checking').length;
    const issues = [...review.issues];
    if (unavailable) issues.push({kind:'warning',text:`${unavailable} image(s) need a replacement.`});
    if (checking) issues.push({kind:'warning',text:`${checking} image(s) are still being checked.`});
    const signature = JSON.stringify({review,assetStates}),existing = root.querySelector('.v2-scenario-qa');
    if (existing?.dataset.signature === signature) return;
    existing?.remove();
    const qa = document.createElement('section');
    qa.className = 'v2-scenario-qa';
    qa.dataset.signature = signature;
    qa.innerHTML = `<div class="v2-scenario-qa__head"><div><strong>${issues.length ? 'Scenario review needed' : 'Basic content checks passed'}</strong><span>${review.total} messages · ${review.companyCount} company · ${review.customerCount} customer · starts with ${htmlEscape(review.initialSender)}</span></div><i data-state="${issues.length ? 'review' : 'ready'}">${issues.length ? 'Review' : 'Checked'}</i></div><p class="v2-scenario-qa__note">${htmlEscape(review.routing)}</p>${issues.length ? `<ul>${issues.map(issue=>`<li data-kind="${issue.kind}">${htmlEscape(issue.text)}${issue.stepId ? `<button type="button" data-v2-qa-target="${htmlEscape(issue.stepId)}">Fix</button>` : ''}</li>`).join('')}</ul>` : ''}<p class="v2-scenario-qa__note">${htmlEscape(review.note)}</p>`;
    (root.querySelector('.v2-flow-map') || steps).before(qa);
    qa.addEventListener('click', event => {
      const button = event.target.closest('[data-v2-qa-target]');
      if (!button) return;
      const block = steps.querySelector(`[data-step-block="${CSS.escape(button.dataset.v2QaTarget)}"]`);
      block?.classList.remove('is-collapsed');
      const body=block?.querySelector('.block-body');if(body)body.hidden=false;
      block?.scrollIntoView({behavior:'smooth',block:'center'});
      block?.querySelector('textarea,input,[contenteditable="true"]')?.focus({preventScroll:true});
    });
  };
  let workspacePanel = 'editor';
  const narrowWorkspace = matchMedia('(max-width: 950px)');
  const syncWorkspaceLayout = () => {
    const exported = document.body.classList.contains('export');
    const narrow = narrowWorkspace.matches && !exported;
    const tabs = document.querySelector('.v2-workspace-tabs');
    const builder = document.querySelector('.builder'), preview = document.querySelector('.preview');
    if (!builder || !preview || !tabs) return;
    if (document.body.classList.contains('v2-narrow-workspace') !== narrow) document.body.classList.toggle('v2-narrow-workspace', narrow);
    const presenting = document.body.classList.contains('presentation');
    tabs.hidden = !narrow || presenting;
    if (narrow && presenting) workspacePanel = 'preview';
    const focus = document.body.classList.contains('v2-focus-mode');
    const menu = document.querySelector('.v2-header-menu');
    if (menu && menu.__v2Desktop !== !narrow) { menu.__v2Desktop = !narrow; menu.open = !narrow; }
    for (const [name, panel] of [['editor', builder], ['preview', preview]]) {
      const hidden = narrow && name !== (presenting ? 'preview' : workspacePanel);
      if (hidden && panel.contains(document.activeElement)) tabs.querySelector(`[data-workspace-panel="${workspacePanel}"]`)?.focus();
      panel.hidden = hidden;
      if (!panel.hasAttribute('aria-busy')) panel.inert = hidden;
      if (narrow) { panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', `workspace-tab-${name}`); }
      else { panel.removeAttribute('role'); panel.removeAttribute('aria-labelledby'); }
      const tab = tabs.querySelector(`[data-workspace-panel="${name}"]`);
      tab.setAttribute('aria-selected', String(name === workspacePanel)); tab.tabIndex = name === workspacePanel ? 0 : -1;
    }
    for (const child of builder.children) if (!child.classList.contains('v2-focus-rail')) child.inert = !narrow && focus;
    window.TwoWayV2?.refreshPreviewFit?.();
  };
  const mountWorkspaceLayout = () => {
    const builder = document.querySelector('.builder'), preview = document.querySelector('.preview');
    if (!builder || !preview) return;
    builder.id ||= 'workspace-editor'; preview.id ||= 'workspace-preview';
    if (!document.querySelector('.v2-workspace-tabs')) {
      const tabs = document.createElement('div'); tabs.className = 'v2-workspace-tabs'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Workspace view');
      tabs.innerHTML = `<button type="button" id="workspace-tab-editor" role="tab" data-workspace-panel="editor" aria-controls="${builder.id}" aria-selected="true">Editor</button><button type="button" id="workspace-tab-preview" role="tab" data-workspace-panel="preview" aria-controls="${preview.id}" aria-selected="false" tabindex="-1">Preview</button>`;
      const select = button => { workspacePanel = button.dataset.workspacePanel; syncWorkspaceLayout(); };
      tabs.addEventListener('click', event => { const button = event.target.closest('[data-workspace-panel]'); if (button) select(button); });
      tabs.addEventListener('keydown', event => {
        if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
        event.preventDefault();
        const name = event.key === 'Home' ? 'editor' : event.key === 'End' ? 'preview' : workspacePanel === 'editor' ? 'preview' : 'editor';
        const button = tabs.querySelector(`[data-workspace-panel="${name}"]`); select(button); button.focus();
      });
      document.querySelector('.studio')?.before(tabs);
      narrowWorkspace.addEventListener('change', syncWorkspaceLayout);
      new MutationObserver(syncWorkspaceLayout).observe(document.body, { attributes:true, attributeFilter:['class'] });
      document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        const menu = document.querySelector('.v2-header-menu[open]');
        if (menu && narrowWorkspace.matches) { menu.open = false; menu.querySelector('summary').focus(); }
        if (!document.querySelector('.rcs-image-cropper')) document.body.classList.remove('presentation');
      });
      document.querySelector('.v2-header-menu')?.addEventListener('click', event => { if (narrowWorkspace.matches && event.target.closest('button')) event.currentTarget.open = false; });
    }
    document.querySelectorAll('.phone .status,.phone-side,.card-img__shade,.crop-safe-area').forEach(node => node.setAttribute('aria-hidden','true'));
    syncWorkspaceLayout();
  };
  const emailEscapeDocuments = new WeakSet();
  const bindCustomEmailEscape = root => {
    root.querySelectorAll('.custom-html-email-frame').forEach(frame => {
      const bind = () => {
        let doc;
        try { doc = frame.contentDocument; } catch {}
        if (!doc) {
          // A followed link may navigate away from the same-origin email.
          // Restore controls rather than leave an inaccessible frame in Present.
          if (document.body.classList.contains('presentation')) document.querySelector('#presentationExit')?.click();
          return;
        }
        // A CSP-blocked embed can still leave a focusable blank frame. Remove
        // those unsupported email elements so Escape stays in this document.
        Document.prototype.querySelectorAll.call(doc, 'iframe,frame,object,embed').forEach(node => Element.prototype.remove.call(node));
        if (emailEscapeDocuments.has(doc)) return;
        emailEscapeDocuments.add(doc);
        const exit = () => { if (document.body.classList.contains('presentation')) document.querySelector('#presentationExit')?.click(); };
        // These listeners run in the trusted parent realm. Pasted scripts stay
        // disabled by the iframe sandbox; never enable allow-scripts here.
        EventTarget.prototype.addEventListener.call(doc, 'keydown', event => {
          if (event.key === 'Escape') { event.preventDefault(); exit(); }
        });
        EventTarget.prototype.addEventListener.call(doc, 'click', event => {
          const link = event.target.nodeType === 1 ? Element.prototype.closest.call(event.target, 'a[href]') : null;
          if (link && !link.getAttribute('href').trim().startsWith('#')) exit();
        });
      };
      if (!frame.__v2EmailEscapeBound) {
        frame.__v2EmailEscapeBound = true;
        frame.addEventListener('load', bind);
      }
      bind();
    });
  };
  const bindPresentationControls = control => {
    const button = control.querySelector('[data-v2-preview-present]');
    if (!button) return;
    const hint = document.createElement('span');
    hint.className = 'v2-presentation-hint';
    hint.hidden = true;
    hint.setAttribute('role', 'status');
    hint.innerHTML = 'To exit out of full screen, press Escape <span aria-hidden="true">— hiding in <b data-v2-hide-countdown>5</b>s</span>';
    button.after(hint);
    const counter = hint.querySelector('[data-v2-hide-countdown]');
    let timer = null, wasPresenting = false;
    const stopCountdown = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const focusPreview = () => {
      const stage = document.querySelector('#stage');
      if (!stage) return;
      if (!stage.hasAttribute('tabindex')) stage.setAttribute('tabindex', '-1');
      stage.focus({ preventScroll:true });
    };
    // Observe the shared presentation class: header controls, exports and the
    // existing Escape handlers can all enter/leave presentation independently.
    const syncPresentation = () => {
      const presenting = document.body.classList.contains('presentation');
      const label = presenting ? 'Hide bar' : 'Present';
      if (button.textContent !== label) button.textContent = label;
      if (!presenting) {
        stopCountdown();
        hint.hidden = true;
        button.hidden = false;
        if (document.body.classList.contains('v2-presentation-bar-hidden')) document.body.classList.remove('v2-presentation-bar-hidden');
        if (wasPresenting) button.focus({ preventScroll:true });
      }
      wasPresenting = presenting;
    };
    new MutationObserver(syncPresentation).observe(document.body, { attributes:true, attributeFilter:['class'] });
    button.addEventListener('click', () => {
      if (!document.body.classList.contains('presentation')) {
        document.querySelector('#presentation')?.click();
        syncPresentation();
        return;
      }
      if (timer !== null || document.body.classList.contains('v2-presentation-bar-hidden')) return;
      const deadline = Date.now() + 5000;
      counter.textContent = '5';
      button.hidden = true;
      hint.hidden = false;
      focusPreview();
      timer = setInterval(() => {
        if (!document.body.classList.contains('presentation')) { syncPresentation(); return; }
        const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        if (!remaining) {
          stopCountdown();
          if (control.contains(document.activeElement)) focusPreview();
          hint.hidden = true;
          document.body.classList.add('v2-presentation-bar-hidden');
        } else if (counter.textContent !== String(remaining)) counter.textContent = String(remaining);
      }, 100);
    });
    syncPresentation();
  };
  const bindPreviewMode = control => {
    // Keep the binding marker as a runtime property, not a data attribute.
    // Downloaded HTML serializes data attributes, which would otherwise make
    // its freshly loaded script incorrectly think these buttons were bound.
    if (control.__v2PreviewModeBound) return;
    control.__v2PreviewModeBound = true;
    bindPresentationControls(control);
    control.addEventListener('click', event => {
      if (event.target.closest('[data-v2-preview-reset]')) document.querySelector('#reset')?.click();
      const focus = event.target.closest('[data-v2-preview-focus]');
      if (focus) {
        const enabled = document.body.classList.toggle('v2-focus-mode');
        focus.textContent = enabled ? 'Exit focus' : 'Focus mode';
        focus.setAttribute('aria-pressed', String(enabled));
        if (enabled && narrowWorkspace.matches) workspacePanel = 'preview';
        syncWorkspaceLayout();
        announce(enabled ? 'Focus mode on. The preview is enlarged.' : 'Focus mode off. The builder is visible again.');
      }
    });
  };
  const hydratePreviewMode = root => {
    bindCustomEmailEscape(root);
    mountWorkspaceLayout();
    const preview = root.querySelector('.preview');
    if (!preview) return;
    let control = preview.querySelector('.v2-preview-mode');
    if (!control) {
      control = document.createElement('div');
      control.className = 'v2-preview-mode';
      control.setAttribute('aria-label', 'Preview actions');
      control.innerHTML = '<button type="button" data-v2-preview-reset>Reset path</button><button type="button" data-v2-preview-focus aria-pressed="false">Focus mode</button><button type="button" data-v2-preview-present>Present</button>';
      preview.querySelector('.preview-info')?.before(control);
    }
    bindPreviewMode(control);
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
        syncWorkspaceLayout();
        document.querySelector('.v2-workspace-nav button')?.focus();
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
      nav.querySelectorAll('button').forEach(item => Number(item.dataset.v2Section) === index ? item.setAttribute('aria-current', 'step') : item.removeAttribute('aria-current'));
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
    const detail=event.detail || {};
    if(detail.status==='cleared'){activeAiRequest=null;lastRequirements=null;lastSource=null;jobStatus='';hydrate();return;}
    if(detail.status==='starting'){activeAiRequest=detail.requestId;lastRequirements=null;lastSource=null;}
    if(!detail.requestId||detail.requestId!==activeAiRequest)return;
    jobStatus=detail.status || '';
    if(jobStatus==='failed')announce('Draft generation could not complete. Review the reported reason and try again.');
    hydrate();
  });
  document.addEventListener('twoway:ai-draft', event => {
    if(!event.detail?.requestId||event.detail.requestId!==activeAiRequest)return;
    lastRequirements=event.detail.requirements || null;
    lastSource=event.detail.source || null;
    jobStatus='completed';
    announce(lastSource?.mode==='prompt-fallback'?'A prompt-guided starter is ready. Review coverage and facts before applying.':'A provider draft is ready. Review each channel and verify facts before applying.');
    hydrate();
  });
  document.addEventListener('twoway:asset-state', () => hydrateScenarioQa(document));

  const observe = () => new MutationObserver(() => hydrate()).observe(document.body, { childList:true, subtree:true });
  window.addEventListener('DOMContentLoaded', () => { hydrate(); observe(); enableIndexedDbMirror(); });
})();
