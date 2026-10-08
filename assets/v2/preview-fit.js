(() => {
  const fitScale = (width, height, availableWidth, availableHeight, mode = 'auto', focus = false) => mode === 'auto'
    ? Math.min(focus ? 1.4 : 1, Math.max(0, availableWidth / width), Math.max(0, availableHeight / height))
    : ({ '1':1, '.85':0.85, '.7':0.7 }[mode] || 1);
  let scheduled = false;
  const update = () => {
    scheduled = false;
    const stage = document.querySelector('#stage');
    const device = stage?.querySelector('.phone,.gmail');
    if (!device || !stage.clientWidth || !stage.clientHeight || stage.closest('[hidden]')) return;
    const style = getComputedStyle(stage);
    const width = Math.max(1, stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
    const height = Math.max(1, stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom));
    let canvas = stage.querySelector('.v2-preview-canvas');
    if (!canvas) { canvas = document.createElement('div'); canvas.className = 'v2-preview-canvas'; device.before(canvas); canvas.append(device); }
    const email = device.classList.contains('gmail');
    if (email) {
      device.style.setProperty('width', `${Math.max(360, width)}px`, 'important');
      device.style.setProperty('height', `${Math.max(320, height)}px`, 'important');
      device.style.setProperty('min-height', '0', 'important');
    }
    const naturalWidth = device.offsetWidth, naturalHeight = device.offsetHeight;
    const mode = document.querySelector('#previewScale')?.value || 'auto';
    const scale = fitScale(naturalWidth, naturalHeight, width, height, mode, document.body.classList.contains('v2-focus-mode'));
    canvas.style.width = `${naturalWidth * scale}px`;
    canvas.style.height = `${naturalHeight * scale}px`;
    // Keep the scale on the persistent stage so a freshly rendered device uses
    // the same scale immediately, before its next measured fit pass.
    stage.style.setProperty('--v2-device-scale', String(scale));
    stage.dataset.previewFit = mode;
    stage.dataset.previewScale = String(scale);
    stage.classList.remove('scaled');
  };
  const schedule = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(update); } };
  window.TwoWayV2 = { ...window.TwoWayV2, fitScale, refreshPreviewFit:schedule };
  const mount = () => {
    const stage = document.querySelector('#stage');
    if (!stage) return;
    new ResizeObserver(schedule).observe(stage);
    new MutationObserver(schedule).observe(stage, { childList:true, subtree:true });
    new MutationObserver(schedule).observe(document.body, { attributes:true, attributeFilter:['class'] });
    document.querySelector('#previewScale')?.addEventListener('change', schedule);
    window.addEventListener('resize', schedule);
    document.addEventListener('twoway:layout', schedule);
    schedule();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once:true });
  else mount();
})();
