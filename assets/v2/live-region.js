(window.TwoWayV2 ||= {}).createAnnouncer = function createAnnouncer(root = document) {
  const getRegion = () => {
    const existing = root.querySelector('.v2-live-region');
    if (existing) return existing;
    const region = root.createElement('div');
    region.className = 'v2-live-region';
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'true');
    root.body.append(region);
    return region;
  };
  return message => {
    const region = getRegion();
    region.textContent = '';
    requestAnimationFrame(() => { region.textContent = message; });
  };
};
