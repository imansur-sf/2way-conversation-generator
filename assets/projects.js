/* Cloud operations are explicit. Authentication never owns the editor lifecycle. */
(() => {
  'use strict';
  window.TwoWayProjects = {mount};
  async function mount(bridge) {
    if (document.body.classList.contains('export')) return;
    const format = window.TwoWayProjectFormat;
    document.body.classList.add('has-account-toolbar');
    const toolbar = document.querySelector('.appbar-actions');
    const account = document.createElement('div'); account.className = 'cloud-account';
    const signInButton = document.createElement('button'); signInButton.type='button'; signInButton.className='cloud-sign-in'; signInButton.dataset.cloud='signin'; signInButton.textContent='Sign In';
    const menu = document.createElement('details'); menu.className = 'cloud-menu';
    menu.hidden=true;
    const summary = document.createElement('summary'); summary.innerHTML='<span class="cloud-avatar" aria-hidden="true"></span><span class="cloud-account-name"></span><span class="cloud-chevron" aria-hidden="true">▾</span>'; menu.append(summary);
    const controls = document.createElement('div');
    controls.className = 'cloud-controls';
    controls.innerHTML = '<div class="cloud-account-heading"><span>Signed in as</span><strong class="cloud-email"></strong></div><button type="button" data-cloud="save">Save Project</button><button type="button" data-cloud="list">My Projects</button><button type="button" data-cloud="auth">Sign Out</button><span class="cloud-status">Automatic saving stays on this device. Cloud saves are optional.</span>';
    menu.append(controls); account.append(signInButton,menu); toolbar.insertBefore(account,document.querySelector('#feedback-inbox-open')||document.querySelector('#reset'));
    const recoveryButton=document.createElement('button');recoveryButton.type='button';recoveryButton.className='top-quiet';recoveryButton.dataset.cloud='recovery';recoveryButton.textContent='Local recovery';
    document.querySelector('.v2-header-menu > div').prepend(recoveryButton);
    const notice=document.createElement('div');notice.className='cloud-notice';notice.hidden=true;notice.innerHTML='<span role="status" aria-live="polite"></span><button type="button" aria-label="Dismiss project notification">×</button>';document.body.append(notice);notice.querySelector('button').onclick=()=>{notice.hidden=true};
    const header=document.querySelector('.appbar');
    const measureHeader=()=>{if(document.body.classList.contains('presentation'))return;const height=Math.ceil(header.getBoundingClientRect().height);if(height>0&&document.body.style.getPropertyValue('--appbar-height')!==height+'px')document.body.style.setProperty('--appbar-height',height+'px')};
    new ResizeObserver(measureHeader).observe(header);measureHeader();
    const status = controls.querySelector('.cloud-status');
    const saveDialog = dialog('Save Project', '<form id="cloud-save-form"><label for="cloud-project-name">Project name</label><input id="cloud-project-name" name="name" required maxlength="160" autocomplete="off"><p data-save-description></p><p class="cloud-dialog-error" role="alert"></p><div class="cloud-dialog-actions"><button class="primary" type="submit">Save Project</button><button type="button" data-save-new>Save as New</button><button type="button" data-close>Cancel</button></div></form>');
    const listDialog = dialog('My Projects', '<p class="cloud-dialog-error" role="status"></p><ul class="cloud-project-list"></ul><div class="cloud-dialog-actions"><button type="button" data-refresh>Refresh</button></div>',true);
    const recoveryDialog = dialog('Local recovery', '<p>Automatic recovery stays in this browser, including after sign-out or an account change. Anyone using this browser profile can reopen it. It is never uploaded by signing in.</p><p>These backups protect the workspace replaced by a project load. They include all scenarios and completed AI drafts. The three most recent backups are retained.</p><p class="cloud-dialog-error" role="alert"></p><ul class="cloud-backup-list"></ul><div class="cloud-dialog-actions"><button type="button" data-close>Close</button></div>');
    let auth = null, identity = '', lastSignedIn = false, epoch = 0, workspaceEpoch = 0, association = null, baseline = null, draftOwner = null, attempt = null, saving = false, loading = false, listSequence = 0;
    const email = () => String(auth?.getEmail() || '').trim().toLowerCase();
    const signedIn = () => Boolean(auth?.isSignedIn() && email());
    const say = text => { status.textContent = text; notice.querySelector('span').textContent=text;notice.hidden=false; };
    document.querySelector('#feedback-open').onclick=()=>say('Feedback is unavailable. Reload while connected and try again. Your local workspace is kept.');
    const errorText = error => ({
      revision_conflict:'This project changed elsewhere. Save as New to keep your work, or load the latest version from My Projects.',
      account_changed:'The account changed. Your local work was kept. Sign in with the original account, or explicitly Save as New for this account.',
      cancelled:'Sign-in was cancelled. Your local work was kept.',
      not_found:'This project is no longer available. Your local work was kept.',
      invalid_tool:'Cloud projects for this studio are not enabled on the accounts server yet. Your local work was kept.',
      payload_too_large:'This workspace is too large for cloud saving. Your local work was kept.',
      sign_in_service_unavailable:'The accounts service is unavailable. Your local work was kept. Try again.',
      stale_workspace:'The workspace changed while this request was running. The current editor was kept. Try again.'
    }[error.code || error.message] || (error instanceof TypeError ? 'The network request failed. Your local work was kept. Try again.' : error.message || 'The request failed. Your local work was kept.'));
    function dialog(title, content, panel=false) {
      const node = document.createElement('dialog');
      node.className = 'cloud-dialog'+(panel?' cloud-project-panel':'');
      const heading = document.createElement('h2'); heading.textContent = title; heading.id = 'cloud-heading-' + crypto.randomUUID();
      node.setAttribute('aria-labelledby', heading.id);
      if(panel){const top=document.createElement('div'),close=document.createElement('button');top.className='cloud-panel-heading';close.type='button';close.dataset.close='';close.setAttribute('aria-label','Close My Projects');close.textContent='×';top.append(heading,close);node.append(top)}else node.append(heading);
      const body = document.createElement('div'); body.innerHTML = content; node.append(body); document.body.append(node);
      node.querySelector('[data-close]').onclick = () => node.close();
      node.addEventListener('close', () => {
        if (node.dataset.authSuspended) return;
        if (panel && document.activeElement!==document.body && !node.contains(document.activeElement)) return;
        const trigger = node===recoveryDialog?recoveryButton:menu.open?controls.querySelector(`[data-cloud="${node === saveDialog ? 'save' : 'list'}"]`):signedIn()?summary:signInButton;
        trigger?.focus();
      });
      return node;
    }
    function syncAuth(force = false) {
      const next = email();
      if (next !== identity || force || (lastSignedIn && !signedIn())) {
        const previousIdentity=identity;
        identity = next; epoch++; listSequence++; association = null; baseline = null; attempt = null;
        listDialog.querySelector('ul').replaceChildren(); listDialog.querySelector('.cloud-dialog-error').textContent = '';
        saveDialog.close(); listDialog.close(); saveDialog.querySelector('input').value = ''; saveDialog.querySelector('.cloud-dialog-error').textContent = '';
        void bridge.write('cloud-association', null).catch(() => {});
        status.textContent='Account session changed. This browser’s draft was kept; no cloud project is attached. Choose Save Project to save a copy.';
        notice.hidden=true;if(previousIdentity&&next&&previousIdentity!==next)say(status.textContent);
      }
      signInButton.hidden=signedIn();menu.hidden=!signedIn();if(!signedIn())menu.open=false;
      controls.querySelector('[data-cloud="auth"]').textContent = 'Sign Out';
      controls.querySelector('.cloud-email').textContent = signedIn() ? email() : '';
      summary.querySelector('.cloud-account-name').textContent=signedIn()?email().split('@')[0]:'';
      summary.querySelector('.cloud-avatar').textContent=signedIn()?email().charAt(0).toUpperCase():'';
      summary.setAttribute('aria-label',signedIn()?`Account: ${email()}`:'Account');
      lastSignedIn = signedIn();
      void window.TwoWayFeedback?.refreshSession();
    }
    const context = () => ({owner:email(),epoch,workspaceEpoch});
    function check(ctx, workspace = true, requireSession = true) {
      if (ctx.owner !== email() || ctx.epoch !== epoch || (requireSession && !signedIn())) throw new Error('account_changed');
      if (workspace && ctx.workspaceEpoch !== workspaceEpoch) throw new Error('stale_workspace');
    }
    async function signIn() {
      if (!auth) throw new Error(signInButton.title || 'Sign-in is unavailable. Your local work is still available. Reload to retry.');
      if (!signedIn()) { await auth.signIn(); syncAuth(); }
      if (!signedIn()) throw new Error('cancelled');
    }
    async function accountsAction(action, ctx) {
      check(ctx);
      try { const value = await action(); check(ctx); return value; }
      catch (error) {
        if (error.status !== 401) throw error;
        check(ctx, true, false);
        // The shared widget uses an overlay, so suspend native modal dialogs
        // while renewing a session; otherwise the browser makes it inert.
        const suspended = [saveDialog,listDialog].filter(node => node.open);
        suspended.forEach(node => { node.dataset.authSuspended = 'true'; node.close(); });
        try { await auth.signIn({expectedEmail:ctx.owner}); }
        finally {
          suspended.forEach(node => { if (ctx.owner === email() && ctx.epoch === epoch) node===listDialog?node.show():node.showModal(); delete node.dataset.authSuspended; });
        }
        check(ctx); // Never retry with a different signed-in identity.
        const value = await action(); check(ctx); return value;
      }
    }
    function show(node) { menu.open=false;notice.hidden=true;node.querySelector('.cloud-dialog-error').textContent = ''; if (!node.open) node===listDialog?node.show():node.showModal(); }
    function lockSave(locked) { saveDialog.querySelectorAll('input,button').forEach(node => { node.disabled = locked; }); }
    function ensureIdle() { if (loading || bridge.busy()) throw new Error('Wait for the current project load or AI operation to finish. Your work is kept.'); }
    async function openSave() {
      ensureIdle(); await signIn();
      if (saving) return;
      const ctx = context(), pending = await bridge.read('cloud-save-attempt:' + email()).catch(() => null); check(ctx);
      saveDialog.querySelector('input').value = association?.name || bridge.name() || 'Untitled workspace';
      saveDialog.querySelector('[data-save-description]').textContent = draftOwner && draftOwner !== email()
        ? 'This browser draft came from another account. Choose Save as New to explicitly copy it to your current account.'
        : association ? `Update “${association.name}”, or choose Save as New for a separate copy. Automatic local saving continues.` : 'Save all scenarios, channel variants, settings, and completed AI drafts to your account. Automatic local saving continues.';
      if (pending?.unresolved) saveDialog.querySelector('[data-save-description]').textContent = `The response to an earlier save of “${pending.options.name}” was interrupted. Retry Save Project to resolve that original snapshot first. Newer edits stay in the editor and can be saved afterward.`;
      saveDialog.querySelector('[data-save-new]').disabled = Boolean(pending?.unresolved);
      show(saveDialog); saveDialog.querySelector('input').focus();
    }
    async function save(asNew) {
      if (saving || !saveDialog.querySelector('input').reportValidity()) return;
      saving = true; lockSave(true);
      const message = saveDialog.querySelector('.cloud-dialog-error');
      message.textContent = 'Saving to cloud…';
      let ctx;
      try {
        ensureIdle(); ctx = context(); check(ctx);
        if (!asNew && draftOwner && draftOwner !== ctx.owner) throw new Error('account_changed');
        const payload = bridge.snapshot();
        const name = saveDialog.querySelector('input').value.trim();
        if (!name) throw new Error('Enter a project name.');
        const options = {tool:format.TOOL,name,payload,sourceUrl:location.origin + location.pathname};
        if (!asNew && association) { options.id = association.id; options.expectedRevision = association.revision; }
        const signature = format.canonical({owner:ctx.owner,options});
        if (!attempt || (!attempt.unresolved && attempt.signature !== signature)) {
          const retained = await bridge.read('cloud-save-attempt:' + ctx.owner); check(ctx);
          attempt = retained?.options && (retained.unresolved || retained.signature === signature) ? retained : {signature,options:{...options,idempotencyKey:'twoway_save_' + crypto.randomUUID()}};
        }
        // Write the exact retry key and snapshot before dispatch. A lost response
        // or reload must not turn the same create request into a duplicate.
        attempt.unresolved = true;
        format.assertSize(attempt.options.payload);
        await bridge.write('cloud-save-attempt:' + ctx.owner, attempt); check(ctx);
        const sent = attempt;
        let project;
        try { project = await accountsAction(() => auth.saveProject(sent.options), ctx); }
        catch (error) {
          if ((error.code || error.message) !== 'revision_conflict' || !sent.options.id) throw error;
          const existing = await accountsAction(() => auth.loadProject(sent.options.id), ctx);
          if (existing.tool !== format.TOOL || existing.name !== sent.options.name || existing.source_url !== sent.options.sourceUrl || format.canonical(existing.payload) !== format.canonical(sent.options.payload)) throw error;
          project = existing; // That exact update committed before its response was lost.
        }
        check(ctx);
        if (project.tool !== format.TOOL || !project.id || !project.revision) throw new Error('The server returned an invalid project. Your local work was kept.');
        association = {id:project.id,name:project.name,revision:project.revision}; baseline = format.canonical(sent.options.payload); draftOwner = ctx.owner; attempt = null;
        const metadata = {owner:ctx.owner,association,baseline};
        await bridge.write('cloud-association', metadata);
        await bridge.write('cloud-draft-origin', {owner:ctx.owner});
        await bridge.write('cloud-save-attempt:' + ctx.owner, null); check(ctx);
        saveDialog.close();
        say(`Saved to cloud: ${project.name}.` + (format.canonical(bridge.snapshot()) !== baseline ? ' Newer changes still need a cloud save.' : ' Automatic local saving continues.'));
      } catch (error) {
        if (ctx && error.status >= 400 && error.status < 500 && error.status !== 401) {
          // A definitive rejection permits a different save (e.g. Save as New
          // after a revision conflict). Ambiguous failures retain the snapshot.
          attempt = null; await bridge.write('cloud-save-attempt:' + ctx.owner, null).catch(() => {});
        }
        syncAuth();
        if (saveDialog.open) message.textContent = errorText(error); else say(errorText(error));
      } finally { saving = false; lockSave(false); }
    }
    async function refreshList() {
      const ctx = context(), sequence = ++listSequence;
      const list = listDialog.querySelector('ul'), message = listDialog.querySelector('.cloud-dialog-error');
      list.replaceChildren(); message.textContent = 'Loading projects…';
      try {
        const projects = await accountsAction(() => auth.listProjects({tool:format.TOOL}), ctx);
        if (sequence !== listSequence || !listDialog.open) return;
        message.textContent = projects.length ? '' : 'No cloud projects yet. Choose Save Project to create one.';
        for (const project of projects) {
          if (project.tool !== format.TOOL) continue;
          const item = document.createElement('li'), title = document.createElement('strong'), time = document.createElement('small');
          title.textContent = project.name; title.title=project.name; time.textContent = new Date(project.updated_at).toLocaleDateString(); title.append(time); item.append(title);
          for (const [label, handler] of [['Load', () => load(project.id)], ['Delete', () => remove(project)]]) {
            const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.setAttribute('aria-label', `${label} ${project.name}`);
            button.onclick = () => handler().catch(error => { if (listDialog.open) message.textContent = errorText(error); else say(errorText(error)); }); item.append(button);
          }
          list.append(item);
        }
      } catch (error) { syncAuth(); if (sequence === listSequence) message.textContent = errorText(error); }
    }
    async function openList() { await signIn(); show(listDialog); await refreshList(); }
    async function remove(project) {
      if (loading || saving) return;
      const ctx = context();
      if (!confirm(`Delete cloud project “${project.name}”? Your current editor and local recovery will be kept.`)) return;
      // The list is scoped to this tool; verify the fetched record as well.
      const stored = await accountsAction(() => auth.loadProject(project.id), ctx);
      if (stored.tool !== format.TOOL) throw new Error('This project belongs to another studio.');
      await accountsAction(() => auth.deleteProject(project.id), ctx);
      if (association?.id === project.id) { association = null; baseline = null; await bridge.write('cloud-association', null); }
      await refreshList();
    }
    async function replace(payload, label, ctx, cloud = null, history = [], localOwner = null) {
      const prepared = bridge.validate(payload);
      const before = format.canonical(bridge.snapshot());
      if (!baseline || before !== baseline) {
        if (!confirm(`Load ${label}? This replaces all scenarios and the current AI draft. Your current work has not been saved to cloud in this form. A local recovery backup will be kept before replacement.`)) return false;
      }
      await bridge.archive('Before loading ' + label, draftOwner);
      if (ctx) check(ctx);
      if (format.canonical(bridge.snapshot()) !== before || bridge.busy()) throw new Error('stale_workspace');
      workspaceEpoch++; association = null; baseline = null; attempt = null;
      await bridge.write('cloud-association', null);
      if (ctx) check({...ctx,workspaceEpoch});
      // No await between the final identity check and replacing the editor.
      if (format.canonical(bridge.snapshot()) !== before || bridge.busy()) throw new Error('stale_workspace');
      bridge.apply(prepared, history);
      draftOwner = cloud ? ctx.owner : localOwner;
      if (cloud) { association = {id:cloud.id,name:cloud.name,revision:cloud.revision}; baseline = format.canonical(bridge.snapshot()); }
      await bridge.write('cloud-draft-origin', {owner:draftOwner});
      await bridge.write('cloud-association', cloud ? {owner:ctx.owner,association,baseline} : null);
      if (ctx) check({...ctx,workspaceEpoch});
      const saved = await bridge.persist();
      say(`Loaded ${label}. The previous workspace is in Local recovery.` + (saved ? '' : ' Local saving needs attention; keep this tab open.'));
      return true;
    }
    async function load(id) {
      if (loading || saving) return;
      ensureIdle(); loading = true;
      const ctx = context(), before = format.canonical(bridge.snapshot());
      listDialog.querySelector('.cloud-dialog-error').textContent = 'Loading project…';
      try {
        const pending = await bridge.read('cloud-save-attempt:' + ctx.owner); check(ctx);
        if (pending?.unresolved) throw new Error('An earlier cloud save has an unknown outcome. Retry Save Project to resolve it before loading another project. Your editor was kept.');
        const project = await accountsAction(() => auth.loadProject(id), ctx);
        if (project.tool !== format.TOOL || !project.revision) throw new Error('This project belongs to another studio or is incomplete.');
        if (before !== format.canonical(bridge.snapshot())) throw new Error('stale_workspace');
        if (await replace(project.payload, `“${project.name}”`, ctx, project)) listDialog.close();
        else listDialog.querySelector('.cloud-dialog-error').textContent = 'Load cancelled. Your editor was kept.';
      } finally { loading = false; }
    }
    async function openRecovery() {
      show(recoveryDialog);
      const list = recoveryDialog.querySelector('ul'), error = recoveryDialog.querySelector('.cloud-dialog-error'); list.replaceChildren();
      try {
        const backups = await bridge.backups();
        error.textContent = backups.length ? '' : 'No replacement backups yet. Your current workspace still restores automatically in this browser.';
        for (const backup of backups) {
          const item = document.createElement('li'), label = document.createElement('span'), button = document.createElement('button');
          label.textContent = `${backup.label} · ${new Date(backup.savedAt).toLocaleString()}`; button.textContent = 'Restore backup'; button.type = 'button';
          button.onclick = async () => {
            if (saving || loading) return;
            try { ensureIdle(); loading = true; if (await replace(backup.payload, 'local backup', null, null, backup.history || [], backup.owner || null)) recoveryDialog.close(); }
            catch (failure) { error.textContent = errorText(failure); }
            finally { loading = false; }
          };
          item.append(label, button); list.append(item);
        }
      } catch (failure) { error.textContent = errorText(failure); }
    }
    const authenticate = async () => {
      try { if (signedIn()) { auth.signOut(); syncAuth(true); } else await signIn(); }
      catch (error) { syncAuth(); say(errorText(error)); }
      finally { menu.open = false; }
    };
    controls.querySelector('[data-cloud="auth"]').onclick=authenticate;signInButton.onclick=authenticate;
    document.addEventListener('click', event => { if (!account.contains(event.target) && !event.target.closest?.('.cloud-dialog') && !document.querySelector('.cloud-dialog[open]')) menu.open = false;if(listDialog.open&&!listDialog.contains(event.target)&&!event.target.closest?.('[data-cloud="list"]'))listDialog.close(); });
    menu.addEventListener('toggle',()=>{if(menu.open){if(listDialog.open)listDialog.close();document.querySelector('.v2-header-menu').open=false}});
    menu.addEventListener('keydown', event => { if (event.key === 'Escape') { menu.open=false; summary.focus(); } });
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&listDialog.open)listDialog.close()});
    controls.querySelector('[data-cloud="save"]').onclick = () => openSave().catch(error => say(errorText(error)));
    controls.querySelector('[data-cloud="list"]').onclick = () => openList().catch(error => say(errorText(error)));
    recoveryButton.onclick = ()=>{document.querySelector('.v2-header-menu').open=false;void openRecovery()};
    saveDialog.querySelector('form').onsubmit = event => { event.preventDefault(); void save(false); };
    saveDialog.querySelector('[data-save-new]').onclick = () => void save(true);
    saveDialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
    listDialog.addEventListener('close', () => { if (!listDialog.dataset.authSuspended) { listSequence++; listDialog.querySelector('ul').replaceChildren(); listDialog.querySelector('.cloud-dialog-error').textContent = ''; } });
    listDialog.querySelector('[data-refresh]').onclick = refreshList;
    window.addEventListener('storage', event => {
      // Observe session changes without inspecting credentials.
      if (event.key === null || event.key === 'saasy_auth_email') syncAuth(true);
      else if (event.key === 'saasy_auth_token') syncAuth();
    });
    const localEdit = () => { notice.hidden=true;if (association && !saving) status.textContent=`Cloud project: ${association.name}. Local autosave does not update cloud; use Save Project for changes.`; };
    window.addEventListener('twoway:local-edit', localEdit);
    document.addEventListener('input', event => { if (event.target.closest?.('.builder') || event.target.id === 'previewScale') localEdit(); });
    try {
      const initialEpoch = epoch;
      const [origin, metadata] = await Promise.all([bridge.read('cloud-draft-origin').catch(() => null),bridge.read('cloud-association').catch(() => null)]);
      draftOwner = origin?.owner || null;
      const script = document.createElement('script'); script.src = '/saasy-auth.js'; script.async = true;
      await new Promise((resolve,reject) => { script.onload = resolve; script.onerror = () => reject(new Error('Sign-in is unavailable. Local saving and recovery remain available. Reload to retry.')); document.head.append(script); });
      auth = window.SaasyAuth;
      if (!auth) throw new Error('Sign-in is unavailable. Local saving and recovery remain available.');
      window.TwoWayFeedback?.mount({trigger:document.querySelector('#feedback-open'),inboxTrigger:document.querySelector('#feedback-inbox-open')});
      identity = email(); syncAuth();
      if (epoch === initialEpoch && signedIn() && metadata?.owner === email() && metadata.association) { association = metadata.association; baseline = metadata.baseline; }
      if (association) status.textContent=`Cloud project: ${association.name}. Local recovery restored this workspace; use Save Project for cloud changes.`;
    } catch (error) { status.textContent=errorText(error);signInButton.title=status.textContent; }
  }
})();
