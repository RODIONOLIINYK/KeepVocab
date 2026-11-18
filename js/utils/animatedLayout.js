// Keep the same visible item anchored while keyed cards move or merge.
export function updateAnimatedLayout(root, update, { selector, keys, preserveAnchor = true } = {}) {
  const nodes = () => [...(root.querySelectorAll?.(selector) || [])];
  const measure = node => ({ node, rect: node.getBoundingClientRect?.() });
  const layout = () => nodes().map(measure).filter(item => item.rect?.height).map(item => ({ ...item, keys: keys(item.node) }));
  const before = layout();
  const scrollers = [];
  for (let node = root; node; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight && node === globalThis.document?.scrollingElement) continue;
    if (node.scrollHeight > node.clientHeight && /auto|scroll/.test(globalThis.getComputedStyle?.(node)?.overflowY || '')) scrollers.push({ node, top: node.scrollTop, rect: node.getBoundingClientRect() });
  }
  const viewportTop = Math.max(0, ...scrollers.map(({ node, rect }) => rect.top + (parseFloat(globalThis.getComputedStyle(node).scrollPaddingTop) || 0)));
  const viewportBottom = Math.min(globalThis.innerHeight || Infinity, ...scrollers.map(({ rect }) => rect.bottom));
  const anchor = preserveAnchor && before.find(item => item.rect.bottom > viewportTop && item.rect.top < viewportBottom);
  update();
  const matches = (a, b) => a.keys.some(key => b.keys.includes(key));
  scrollers.forEach(({ node, top }) => { node.scrollTop = top; });
  let after = layout();
  if (anchor) {
    const replacement = after.find(item => matches(anchor, item));
    if (replacement) {
      const delta = replacement.rect.top - anchor.rect.top;
      const scroller = scrollers[0]?.node;
      if (scroller) scroller.scrollTop += delta;
      else if (delta) globalThis.scrollBy?.(0, delta);
      after = layout();
    }
  }
  if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  for (const item of after) {
    const old = before.find(old => matches(old, item));
    if (!old) { item.node.animate?.([{ opacity: .25 }, { opacity: 1 }], { duration: 220 }); continue; }
    const x = old.rect.left - item.rect.left, y = old.rect.top - item.rect.top;
    if (x || y) item.node.animate?.([{ transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' }], { duration: 320, easing: 'cubic-bezier(.2,.7,.2,1)' });
  }
  // Animate each disappearing source card towards its surviving merged group.
  for (const old of before) {
    const target = after.find(item => matches(old, item));
    if (!target || before.find(item => matches(item, target)) === old || old.rect.bottom < viewportTop || old.rect.top > viewportBottom || after.some(item => item.keys.length === old.keys.length && item.keys.every(key => old.keys.includes(key)))) continue;
    const ghost = old.node.cloneNode?.(true);
    if (!ghost || !globalThis.document?.body || !ghost.animate) continue;
    ghost.removeAttribute('id'); ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true;
    Object.assign(ghost.style, { position: 'fixed', left: `${old.rect.left}px`, top: `${old.rect.top}px`, width: `${old.rect.width}px`, height: `${old.rect.height}px`, margin: '0', pointerEvents: 'none', zIndex: '10000' });
    document.body.appendChild(ghost);
    const animation = ghost.animate([{ opacity: .65, transform: 'translate(0, 0) scale(1)' }, { opacity: 0, transform: `translate(${target.rect.left - old.rect.left}px, ${target.rect.top - old.rect.top}px) scale(.85)` }], { duration: 320, easing: 'ease-out' });
    animation.finished.then(() => ghost.remove(), () => ghost.remove());
  }
}
