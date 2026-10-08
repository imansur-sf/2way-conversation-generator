import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

export async function checkPresentationToolbar(page, { enterFromHeader = false, cancelEarly = false, onCountdown, onHidden } = {}) {
  const toolbar = page.locator('.v2-preview-mode');
  const present = toolbar.locator('[data-v2-preview-present]');
  const hint = toolbar.locator('.v2-presentation-hint');
  const counter = hint.locator('[data-v2-hide-countdown]');
  const info = page.locator('.preview-info');
  const infoInitiallyVisible = await info.isVisible();
  const popups = [];
  const onDialog = async dialog => { popups.push(dialog.message()); await dialog.dismiss(); };
  page.on('dialog', onDialog);
  const enter = async (header = false) => {
    await expect(present).toHaveText('Present');
    await page.locator(header ? '#presentation' : '[data-v2-preview-present]').click();
    await expect(page.locator('body')).toHaveClass(/\bpresentation\b/);
    await expect(present).toHaveText('Hide bar');
    await expect(present).toBeVisible();
    await expect(hint).toBeHidden();
  };
  const exit = async () => {
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).not.toHaveClass(/\bpresentation\b/);
    await expect(page.locator('body')).not.toHaveClass(/\bv2-presentation-bar-hidden\b/);
    await expect(toolbar).toBeVisible();
    await expect(present).toHaveText('Present');
    await expect(present).toBeVisible();
    await expect(hint).toBeHidden();
    await expect(present).toBeFocused();
    assert.equal(await info.isVisible(), infoInitiallyVisible, 'Escape must restore the original info visibility');
  };
  try {
    await enter(enterFromHeader);
    if (cancelEarly) {
      await present.click();
      await expect(counter).toHaveText('5');
      await expect(counter).toHaveText('4', { timeout:2500 });
      await exit();
      await enter();
      // Pass the old deadline without clicking Hide bar again. A cancelled
      // interval must never hide the next presentation session's controls.
      await page.waitForTimeout(4200);
      await expect(toolbar).toBeVisible();
      await expect(present).toBeVisible();
      await expect(hint).toBeHidden();
      await expect(page.locator('body')).not.toHaveClass(/\bv2-presentation-bar-hidden\b/);
    }
    const before = await page.locator('#stage').boundingBox();
    await present.click();
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('To exit out of full screen, press Escape');
    await expect(counter).toHaveText('5');
    await expect(present).toBeHidden();
    await expect(toolbar.locator('[data-v2-preview-reset]')).toBeVisible();
    assert.equal(await info.isVisible(), infoInitiallyVisible, 'Info remains unchanged during the inline countdown');
    const bounds = await hint.evaluate(node => {
      const box = node.getBoundingClientRect(), bar = node.closest('.v2-preview-mode').getBoundingClientRect();
      return { left:box.left, right:box.right, bottom:box.bottom, barBottom:bar.bottom, viewport:innerWidth };
    });
    assert.ok(bounds.left >= 0 && bounds.right <= bounds.viewport + 1 && bounds.bottom <= bounds.barBottom + 1, 'Instruction must fit inline inside the toolbar, including narrow screens');
    if (onCountdown) await onCountdown();
    // The visual countdown uses wall time. It must remain visible at one second
    // and only then remove the entire control surface.
    await expect(counter).toHaveText('1', { timeout:6000 });
    await expect(toolbar).toBeVisible();
    await expect(toolbar).toBeHidden({ timeout:2500 });
    await expect(hint).toBeHidden();
    await expect(info).toBeHidden();
    await expect(page.locator('#emailPresentationHint')).toBeHidden();
    await expect(page.locator('body')).toHaveClass(/\bpresentation\b/);
    for (const selector of ['[data-v2-preview-reset]', '[data-v2-preview-focus]', '[data-v2-preview-present]']) await expect(toolbar.locator(selector)).toBeHidden();
    const after = await page.locator('#stage').boundingBox();
    assert.ok(after.height > before.height, 'Hiding the toolbar must release its space to the preview');
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('.v2-preview-mode')), false, 'Focus must not remain in hidden controls');
    if (onHidden) await onHidden();
    await exit();
    await enter();
    await expect(toolbar).toBeVisible();
    await exit();
    assert.deepEqual(popups, [], 'Hide bar must not show a dialog');
  } finally {
    page.off('dialog', onDialog);
  }
}
