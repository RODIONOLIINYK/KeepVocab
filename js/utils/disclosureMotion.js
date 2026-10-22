// Keep the native <details> semantics while easing both opening and closing.
// A dedicated body lets a menu float without stretching its card during motion.
export function animateDisclosures(root, selector = 'details[data-motion]') {
  root.querySelectorAll(selector).forEach(details => {
    if (details.dataset.motionBound) return;
    const summary = details.querySelector('summary');
    const body = details.querySelector(':scope > .disclosure-body');
    if (!summary || !body) return;
    details.dataset.motionBound = 'true';
    let animation = null;
    let expanded = details.open;
    summary.setAttribute('aria-expanded', String(expanded));
    const toggle = open => {
      expanded = open;
      summary.setAttribute('aria-expanded', String(open));
      animation?.cancel();
      animation = null;
      const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (reduced || !body.animate) { details.open = open; body.style.overflow = ''; return; }
      details.open = true;
      const height = `${body.scrollHeight}px`;
      const resting = { height, opacity: 1, transform: 'translateY(0) scale(1)' };
      const frames = open ? [
        { height: '0px', opacity: 0, transform: 'translateY(-6px) scale(.97)', offset: 0 },
        { height, opacity: 1, transform: 'translateY(1px) scale(1.015)', offset: .76 },
        { ...resting, offset: 1 }
      ] : [resting, { height: '0px', opacity: 0, transform: 'translateY(-4px) scale(.98)' }];
      body.style.overflow = 'hidden';
      const current = body.animate(frames, {
        duration: open ? 320 : 180,
        easing: open ? 'cubic-bezier(.2,.7,.3,1)' : 'cubic-bezier(.4,0,1,1)',
        fill: 'both'
      });
      animation = current;
      current.finished.then(() => {
        if (animation !== current) return;
        details.open = open;
        animation = null;
        current.cancel();
        body.style.overflow = '';
      }).catch(() => {});
    };
    summary.addEventListener('click', event => { event.preventDefault(); toggle(!expanded); });
    details.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !expanded) return;
      event.preventDefault();
      toggle(false);
      summary.focus();
    });
  });
}
