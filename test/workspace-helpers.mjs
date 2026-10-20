/** Navigate through the same visible controls used by a person. */
export async function selectView(page, view) {
  const editorTab = page.locator('[data-workspace-panel="editor"]');
  if (await editorTab.isVisible()) await editorTab.click();
  const destination = page.locator(`button[data-studio-view="${view}"]`);
  await destination.click();
  await page.locator(`[data-studio-panel="${view}"]`).evaluateAll(async panels => {
    await Promise.all(panels.flatMap(panel => panel.getAnimations({ subtree:true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))));
  });
}

export async function revealEditor(page, selector) {
  if (await page.locator('body').evaluate(body => body.classList.contains('export'))) return;
  const target = page.locator(selector).first();
  const view = await target.evaluate(node => {
    if (node.matches('[data-channel]')) return null;
    const panel = node.closest('[data-studio-panel]');
    if (panel) return panel.dataset.studioPanel;
    if (node.closest('#setupAssistant')) return ['chooseManual', 'chooseAi'].includes(node.id) ? 'scenario' : 'ai';
    if (node.closest('#identityFields, #manualChannelSection')) return 'identity';
    if (node.closest('#manualConversationSection, #steps')) return 'conversation';
    if (node.closest('#manualActions') || node.matches('#export, #save')) return 'export';
    if (node.closest('.builder') && node.closest('.section')) return 'scenario';
    return null;
  }).catch(() => null);
  if (view && !await target.isVisible()) await selectView(page, view);
  if (!await target.isVisible() && await target.evaluate(node => Boolean(node.closest('.preview'))).catch(() => false)) {
    const previewTab = page.locator('[data-workspace-panel="preview"]');
    if (await previewTab.isVisible()) await previewTab.click();
  }
  // Expand disclosure menus through their summary controls before using a child.
  for (let depth = 0; depth < 5; depth++) {
    const isSummary = await target.evaluate(node => node.tagName === 'SUMMARY');
    const closed = target.locator(isSummary ? 'xpath=parent::details/ancestor::details[not(@open)]' : 'xpath=ancestor::details[not(@open)]').first();
    if (!await closed.count()) break;
    await closed.locator(':scope > summary').click();
  }
}

export async function editor(page, selector) {
  if (selector === '[data-v2-preview-present]' && !await page.locator('body').evaluate(body => body.classList.contains('export') || body.classList.contains('presentation'))) selector = '#presentation';
  await revealEditor(page, selector);
  return page.locator(selector);
}
