const KEYBOARD_SHRINK_PX = 120;
const MOBILE_WIDTH_PX = 720;
const WIDTH_RESET_PX = 80;

const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;

// Android can resize both the layout and visual viewports for the IME. Keeping
// the height from before focus lets that case work alongside iOS's visual-only
// resize, without treating browser toolbar movement as a keyboard.
export function deriveMobileViewportState({
  layoutWidth,
  layoutHeight,
  viewportHeight,
  viewportTop = 0,
  viewportScale = 1,
  baselineHeight = layoutHeight,
  editableFocused = false,
  coarsePointer = false
} = {}) {
  const visualHeight = positive(viewportHeight) || positive(layoutHeight);
  const visualTop = Number.isFinite(Number(viewportTop)) ? Math.max(0, Number(viewportTop)) : 0;
  const referenceHeight = Math.max(positive(layoutHeight), positive(baselineHeight));
  const width = positive(layoutWidth);
  const mobile = width > 0 && (width <= MOBILE_WIDTH_PX
    || (coarsePointer && positive(layoutHeight) <= MOBILE_WIDTH_PX));
  const scale = positive(viewportScale) || 1;
  return {
    keyboardOpen: Boolean(editableFocused && mobile && visualHeight
      && Math.abs(scale - 1) < 0.05 && referenceHeight - visualHeight >= KEYBOARD_SHRINK_PX),
    visualHeight,
    visualTop
  };
}

function editable(element) {
  if (!element || element.disabled || element.readOnly) return false;
  const tag = String(element.tagName || '').toLowerCase();
  if (tag === 'textarea' || element.isContentEditable) return true;
  if (tag !== 'input') return false;
  return !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']
    .includes(String(element.type || 'text').toLowerCase());
}

export function setupMobileViewport({ window: win = globalThis.window, document: doc = globalThis.document } = {}) {
  const viewport = win?.visualViewport;
  const style = doc?.documentElement?.style;
  const classes = doc?.body?.classList;
  if (!viewport?.addEventListener || !style || !classes) return () => {};

  const measure = () => ({
    layoutWidth: positive(doc.documentElement.clientWidth) || positive(win.innerWidth),
    layoutHeight: positive(win.innerHeight) || positive(doc.documentElement.clientHeight),
    viewportHeight: positive(viewport.height),
    viewportTop: viewport.offsetTop,
    viewportScale: viewport.scale,
    coarsePointer: Boolean(win.matchMedia?.('(pointer: coarse)')?.matches)
  });
  const initial = measure();
  let baselineHeight = Math.max(initial.layoutHeight, initial.viewportHeight);
  let previousWidth = initial.layoutWidth;
  let focused = editable(doc.activeElement);
  let keyboardWasOpen = false;
  let disposed = false;
  let focusRevision = 0;
  const originalHeight = style.getPropertyValue('--visual-viewport-height');
  const originalTop = style.getPropertyValue('--visual-viewport-top');
  const originalKeyboardOpen = classes.contains('keyboard-open');

  function update() {
    if (disposed) return;
    const dimensions = measure();
    const hasFocus = editable(doc.activeElement);
    const widthChanged = Math.abs(dimensions.layoutWidth - previousWidth) >= WIDTH_RESET_PX;
    if (widthChanged || (!hasFocus && !focused)) {
      baselineHeight = Math.max(dimensions.layoutHeight, dimensions.viewportHeight);
      // On a touch-device rotation, the previous width is the new full height.
      // Preserve that reference only for a keyboard already known to be open;
      // ordinary compact landscape windows must not imply keyboard occlusion.
      if (widthChanged && hasFocus && keyboardWasOpen && dimensions.coarsePointer) {
        baselineHeight = Math.max(baselineHeight, previousWidth);
      }
    }
    // Do not replace the pre-focus baseline with the smaller Android viewport
    // during a focusout/focusin transition between two fields.
    if (hasFocus && !focused) baselineHeight = Math.max(baselineHeight, dimensions.layoutHeight, dimensions.viewportHeight);
    const state = deriveMobileViewportState({ ...dimensions, baselineHeight, editableFocused: hasFocus });
    style.setProperty('--visual-viewport-height', `${state.visualHeight}px`);
    style.setProperty('--visual-viewport-top', `${state.visualTop}px`);
    classes.toggle('keyboard-open', state.keyboardOpen);
    keyboardWasOpen = state.keyboardOpen;
    previousWidth = dimensions.layoutWidth;
    focused = hasFocus;
  }

  const onViewportChange = () => update();
  const onOrientationChange = () => update();
  const onFocusIn = () => { focusRevision += 1; update(); };
  const onFocusOut = () => {
    const revision = ++focusRevision;
    // Focus has finished moving by the microtask, so switching fields does not
    // briefly restore navigation or discard the keyboard-height baseline.
    Promise.resolve().then(() => { if (revision === focusRevision) update(); });
  };
  viewport.addEventListener('resize', onViewportChange);
  viewport.addEventListener('scroll', onViewportChange);
  win.addEventListener('resize', onViewportChange);
  win.addEventListener('orientationchange', onOrientationChange);
  doc.addEventListener('focusin', onFocusIn);
  doc.addEventListener('focusout', onFocusOut);
  update();

  return () => {
    disposed = true;
    viewport.removeEventListener('resize', onViewportChange);
    viewport.removeEventListener('scroll', onViewportChange);
    win.removeEventListener('resize', onViewportChange);
    win.removeEventListener('orientationchange', onOrientationChange);
    doc.removeEventListener('focusin', onFocusIn);
    doc.removeEventListener('focusout', onFocusOut);
    if (originalHeight) style.setProperty('--visual-viewport-height', originalHeight);
    else style.removeProperty('--visual-viewport-height');
    if (originalTop) style.setProperty('--visual-viewport-top', originalTop);
    else style.removeProperty('--visual-viewport-top');
    classes.toggle('keyboard-open', originalKeyboardOpen);
  };
}
