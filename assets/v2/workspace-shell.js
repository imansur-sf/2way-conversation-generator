/* Organize the existing editor. Scenario data and event handlers stay owned by
   the original builder; exports intentionally do not mount this workspace. */
(() => {
  'use strict';
  const views = ['scenario', 'identity', 'conversation', 'export', 'ai'];
  const labels = { scenario:'Scenario', identity:'Identity', conversation:'Conversation', export:'Export', ai:'Build with AI' };
  const icons = {
    scenario:'<path d="M7 3h7l4 4v14H7zM14 3v5h4M10 12h5M10 16h5"/>',
    identity:'<circle cx="12" cy="7" r="4"/><path d="M4 21v-3a8 8 0 0 1 16 0v3z"/>',
    conversation:'<path d="M21 11a9 9 0 0 1-9 9 10 10 0 0 1-4-.8L3 21l1.7-5A9 9 0 1 1 21 11z"/>',
    export:'<path d="M12 16V3m-5 5 5-5 5 5M4 14v7h16v-7"/>',
    ai:'<path d="m12 2 2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6z"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
  const setText = (node, value) => { if (node && node.textContent !== value) node.textContent = value; };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  const mount = async () => {
    await window.__twoWayScenarioInitialization;
    if (document.body.classList.contains('export') || !window.TwoWayWorkspace || document.querySelector('.studio-rail')) return;
    const builder = document.querySelector('.builder'), studio = document.querySelector('.studio');
    if (!builder || !studio) return;
    const scenario = builder.querySelector(':scope > .section');
    const identity = document.querySelector('#manualChannelSection');
    const conversation = document.querySelector('#manualConversationSection');
    const setup = document.querySelector('#setupAssistant');
    const actions = document.querySelector('#manualActions');
    if (!scenario || !identity || !conversation || !setup || !actions) return;

    const ai = document.createElement('section');
    ai.className = 'section studio-ai-panel';
    ai.append(setup);
    const exportPanel = document.createElement('section');
    exportPanel.className = 'section studio-export-panel';
    exportPanel.innerHTML = '<h2>Save & export</h2><p class="studio-description">Keep an editable backup, or share a demo people can try.</p><h3>Interactive demo</h3><p class="studio-description">Download HTML to play the selected channel offline. This is a playback file, not a workspace backup.</p>';
    exportPanel.append(actions);
    const backup = document.createElement('div');
    backup.className = 'studio-backup-actions';
    backup.innerHTML = '<h3>Editable backup</h3><p class="studio-description">Export scenario JSON to protect every channel and continue editing on another device.</p>';
    for (const id of ['exportScenario', 'importScenario', 'importScenarioFile']) {
      const node = document.getElementById(id); if (node) backup.append(node);
    }
    exportPanel.append(backup);
    builder.append(ai, exportPanel);
    const panels = { scenario, identity, conversation, export:exportPanel, ai };
    for (const [name, panel] of Object.entries(panels)) {
      panel.dataset.studioPanel = name;
      panel.setAttribute('aria-label', labels[name]);
    }

    const rail = document.createElement('nav');
    rail.className = 'studio-rail';
    rail.setAttribute('aria-label', 'Workspace');
    rail.innerHTML = `<div class="studio-rail-main">${views.slice(0,4).map(name => `<button type="button" data-studio-view="${name}" aria-label="${labels[name]}" title="${labels[name]}">${icon(name)}<span>${labels[name]}</span></button>`).join('')}</div><div class="studio-rail-bottom"><button type="button" data-studio-view="ai" aria-label="Build with AI" title="Build with AI">${icon('ai')}<span>Build with AI</span></button><p>Device-local workspace</p><button type="button" data-studio-backup aria-label="Export JSON for backup" title="Export JSON for backup">${icon('export')}<span>Export JSON for backup</span></button></div>`;
    studio.prepend(rail);

    const context = document.createElement('header');
    context.className = 'studio-context';
    context.innerHTML = '<button type="button" class="studio-scenario-title" title="Open scenario settings"></button><p class="studio-context-detail"></p>';
    const channels = identity.querySelector('.channel-toggle');
    if (channels) { channels.setAttribute('aria-label', 'Conversation channel'); channels.setAttribute('role', 'group'); context.append(channels); }
    const focusRail = builder.querySelector('.v2-focus-rail');
    if (focusRail) focusRail.after(context); else builder.prepend(context);
    context.querySelector('button').addEventListener('click', () => select('scenario', true));

    const headerActions = document.querySelector('.appbar-actions');
    const present = document.querySelector('#presentation');
    if (headerActions && present) headerActions.insertBefore(present, document.querySelector('#topExport'));
    const menu = document.querySelector('.v2-header-menu');
    if (menu) { menu.open = false; menu.querySelector('summary').setAttribute('aria-label', 'Troubleshoot'); }
    const previewActions = document.querySelector('.v2-preview-mode');
    if (previewActions) {
      const title = document.createElement('strong'); title.className = 'studio-preview-heading'; title.textContent = 'Live preview';
      previewActions.prepend(title);
      const scale = document.querySelector('#previewScale'); if (scale) previewActions.append(scale);
    }

    let activeView = 'conversation', mode = '', frame = 0, animation = null, recoveryScenario = null;
    const scrollPositions = new Map();
    const select = (name, focus = false) => {
      if (!views.includes(name)) return;
      const previous = activeView;
      scrollPositions.set(previous, builder.scrollTop);
      activeView = name;
      if (matchMedia('(max-width: 950px)').matches) document.querySelector('[data-workspace-panel="editor"]')?.click();
      window.TwoWayWorkspace.setBuildMode(name === 'ai' ? 'ai' : 'manual');
      refresh();
      builder.scrollTop = scrollPositions.get(name) || 0;
      if (previous !== name) {
        animation?.cancel();
        animation = reduced.matches ? null : panels[name].animate([{opacity:.65,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}], {duration:180,easing:'cubic-bezier(.2,.7,.2,1)'});
      }
      if (focus) {
        const heading = panels[name].querySelector('h2,.section-title,.setup-title') || panels[name];
        heading.setAttribute('tabindex','-1'); heading.focus({preventScroll:true});
      }
      document.dispatchEvent(new CustomEvent('twoway:workspace-view', {detail:{view:name}}));
    };
    const refresh = () => {
      const snapshot = window.TwoWayWorkspace.snapshot();
      // Applying a draft returns the engine to manual mode. Follow that result
      // without interrupting generation, switching scenarios or clearing input.
      if (activeView === 'ai' && mode === 'ai' && snapshot.mode === 'manual') activeView = 'conversation';
      mode = snapshot.mode;
      // Manual recovery warnings are part of the created scenario. Keep them
      // with its conversation rather than hiding them inside the AI form.
      let recoverySlot = conversation.querySelector('.studio-recovery-slot');
      if (recoveryScenario !== snapshot.id) {
        if (recoverySlot?.hasChildNodes()) recoverySlot.replaceChildren();
        recoveryScenario = snapshot.id;
      }
      if (snapshot.mode === 'manual') {
        const note = setup.querySelector('.ai-brand-recovery');
        if (note) {
          if (!recoverySlot) { recoverySlot = document.createElement('div'); recoverySlot.className = 'studio-recovery-slot'; conversation.prepend(recoverySlot); }
          recoverySlot.replaceChildren(note);
          recoveryScenario = snapshot.id;
        }
      }
      for (const [name, panel] of Object.entries(panels)) {
        const visible = name === activeView;
        if (panel.dataset.studioActive !== String(visible)) panel.dataset.studioActive = String(visible);
      }
      for (const button of rail.querySelectorAll('[data-studio-view]')) {
        const current = button.dataset.studioView === activeView;
        if (current && button.getAttribute('aria-current') !== 'page') button.setAttribute('aria-current','page');
        else if (!current && button.hasAttribute('aria-current')) button.removeAttribute('aria-current');
      }
      if (document.body.dataset.studioActiveView !== activeView) document.body.dataset.studioActiveView = activeView;
      setText(context.querySelector('.studio-scenario-title'), snapshot.name || 'Untitled scenario');
      setText(context.querySelector('.studio-context-detail'), `${snapshot.channels} channel${snapshot.channels === 1 ? '' : 's'} · ${snapshot.channel === 'whatsapp' ? 'WhatsApp' : snapshot.channel.toUpperCase()} selected`);
      const status = document.querySelector('#saveState');
      const mirror = document.querySelector('.appbar .live-dot');
      if (status && mirror) {
        setText(mirror, status.textContent);
        const saved = status.textContent === 'Saved on this device';
        if (mirror.dataset.saved !== String(saved)) mirror.dataset.saved = String(saved);
        mirror.title = 'Saved work stays in this browser profile. Export JSON for a portable backup.';
      }
      setText(identity.querySelector('.section-title'), 'Identity');
      setText(conversation.querySelector('.section-title'), 'Conversation');
      setup.querySelectorAll('.setup-title').forEach(title => setText(title, title.textContent.replace(/^\d+\s*·\s*/, '')));
      const helper = conversation.querySelector('.conversation-headline + .helper');
      const introduction = 'Shape the exchange, then try it live.';
      if (helper && helper.textContent !== introduction) {
        let routing = conversation.querySelector('.studio-routing-help');
        if (!routing) {
          routing = document.createElement('details'); routing.className = 'studio-routing-help';
          routing.innerHTML = '<summary>How replies are matched</summary><p></p>';
          conversation.append(routing);
        }
        setText(routing.querySelector('p'), helper.textContent);
        setText(helper, introduction);
      }
      [...conversation.querySelectorAll('#steps article.block')].forEach((block, index) => {
        setText(block.querySelector('.badge'), String(index + 1).padStart(2, '0'));
      });
      const heading = conversation.querySelector('.section-title');
      heading.setAttribute('role','heading'); heading.setAttribute('aria-level','2');
      const add = conversation.querySelector('.add-menu'), steps = document.querySelector('#steps');
      if (add && steps && add.previousElementSibling !== steps) steps.after(add);
      const versionTools = document.querySelector('#versionTools');
      if (versionTools && versionTools.parentElement !== exportPanel) exportPanel.append(versionTools);
      const qa = document.querySelector('.v2-scenario-qa');
      if (qa) {
        let review = conversation.querySelector('.studio-checks');
        if (!review) {
          review = document.createElement('details'); review.className = 'studio-checks';
          review.innerHTML = '<summary><span></span><span>Details</span></summary>';
          (conversation.querySelector('.v2-flow-map') || steps).before(review);
        }
        setText(review.querySelector('summary span'), qa.querySelector('strong')?.textContent || 'Content checks');
        if (qa.parentElement !== review) review.append(qa);
      }
    };
    rail.addEventListener('click', event => {
      const button = event.target.closest('[data-studio-view]');
      if (button) select(button.dataset.studioView, true);
      if (event.target.closest('[data-studio-backup]')) { select('export'); document.querySelector('#exportScenario')?.click(); }
    });
    rail.addEventListener('keydown', event => {
      if (!['ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
      const buttons = [...rail.querySelectorAll('[data-studio-view]')], index = buttons.indexOf(document.activeElement);
      if (index < 0) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length-1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
    });
    document.addEventListener('keydown', event => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !/^[1-4]$/.test(event.key) || event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
      event.preventDefault(); event.stopImmediatePropagation(); select(views[Number(event.key)-1],true);
    }, true);
    document.addEventListener('click', event => {
      const button = event.target.closest('button');
      const target = button?.id === 'chooseManual' || button?.id === 'v2-switch-to-manual' ? 'conversation' : ['chooseAi','switchToAi'].includes(button?.id) ? 'ai' : null;
      if (target) queueMicrotask(() => select(target));
      const legacy = button?.closest('[data-v2-section]');
      if (legacy) { event.preventDefault(); event.stopImmediatePropagation(); select(views[Number(legacy.dataset.v2Section)]); }
      if (menu?.open && (!menu.contains(event.target) || event.target.closest('.v2-header-menu button'))) {
        menu.open = false;
        if (menu.contains(event.target)) menu.querySelector('summary').focus();
      }
    }, true);
    document.addEventListener('change', event => {
      if (event.target.id === 'scenarioSelect') { builder.scrollTop = 0; scrollPositions.clear(); }
    });
    document.addEventListener('twoway:project-loaded', event => {
      activeView = ['ai','review'].includes(event.detail.mode) ? 'ai' : 'conversation';
      mode = event.detail.mode; builder.scrollTop = 0; scrollPositions.clear(); refresh();
    });
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; refresh(); });
    });
    document.body.classList.add('studio-shell');
    if (['ai','review'].includes(window.TwoWayWorkspace.snapshot().mode)) { activeView='ai'; refresh(); }
    else select('conversation');
    observer.observe(document.body, {childList:true,subtree:true});
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {once:true});
  else mount();
})();
