import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveMobileViewportState, setupMobileViewport } from '../js/utils/mobileViewport.js';

const dimensions = overrides => ({ layoutWidth: 390, layoutHeight: 844, viewportHeight: 844,
  baselineHeight: 844, editableFocused: true, ...overrides });

function createEnvironment({ coarsePointer = false, visualViewport = true } = {}) {
  const values = new Map();
  const names = new Set();
  const style = {
    getPropertyValue: name => values.get(name) || '',
    setProperty: (name, value) => values.set(name, value),
    removeProperty: name => values.delete(name)
  };
  const classList = {
    contains: name => names.has(name),
    toggle(name, force) { if (force) names.add(name); else names.delete(name); }
  };
  const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 });
  const win = Object.assign(new EventTarget(), { innerWidth: 390, innerHeight: 844,
    visualViewport: visualViewport ? viewport : undefined,
    matchMedia: () => ({ matches: coarsePointer }) });
  const doc = Object.assign(new EventTarget(), { documentElement: { clientWidth: 390, clientHeight: 844, style },
    body: { classList }, activeElement: { tagName: 'BODY' } });
  return {
    window: win, document: doc, viewport, style, classList,
    focus(element) { doc.activeElement = element; doc.dispatchEvent(new Event('focusin')); },
    async blur() { doc.activeElement = { tagName: 'BODY' }; doc.dispatchEvent(new Event('focusout')); await Promise.resolve(); },
    resize({ width = doc.documentElement.clientWidth, height = win.innerHeight, visualHeight = viewport.height, top = viewport.offsetTop } = {}) {
      doc.documentElement.clientWidth = win.innerWidth = width;
      doc.documentElement.clientHeight = win.innerHeight = height;
      viewport.height = visualHeight;
      viewport.offsetTop = top;
      win.dispatchEvent(new Event('resize'));
      viewport.dispatchEvent(new Event('resize'));
    }
  };
}

test('keyboard detection needs editable focus and at least 120 pixels of viewport loss', () => {
  assert.equal(deriveMobileViewportState(dimensions({ viewportHeight: 725 })).keyboardOpen, false);
  assert.equal(deriveMobileViewportState(dimensions({ viewportHeight: 724 })).keyboardOpen, true);
  assert.equal(deriveMobileViewportState(dimensions({ viewportHeight: 500, editableFocused: false })).keyboardOpen, false);
  assert.equal(deriveMobileViewportState(dimensions({ viewportHeight: 760 })).keyboardOpen, false,
    'ordinary browser chrome changes keep navigation visible');
});

test('the pre-focus baseline detects Android keyboards that also shrink the layout viewport', () => {
  const state = deriveMobileViewportState(dimensions({ layoutHeight: 500, viewportHeight: 500, viewportTop: 34 }));
  assert.equal(state.keyboardOpen, true);
  assert.equal(state.visualHeight, 500);
  assert.equal(state.visualTop, 34);
});

test('desktop resizing and pinch zoom do not hide navigation; coarse landscape keyboards are supported', () => {
  assert.equal(deriveMobileViewportState(dimensions({ layoutWidth: 1280, viewportHeight: 500 })).keyboardOpen, false);
  assert.equal(deriveMobileViewportState(dimensions({ viewportHeight: 400, viewportScale: 2 })).keyboardOpen, false);
  const landscape = dimensions({ layoutWidth: 844, layoutHeight: 390, baselineHeight: 390, viewportHeight: 230 });
  assert.equal(deriveMobileViewportState(landscape).keyboardOpen, false);
  assert.equal(deriveMobileViewportState({ ...landscape, coarsePointer: true }).keyboardOpen, true);
});

test('visual viewport values stay valid while transient measurements are missing', () => {
  const state = deriveMobileViewportState(dimensions({ viewportHeight: 0, viewportTop: Infinity }));
  assert.equal(state.visualHeight, 844);
  assert.equal(state.visualTop, 0);
  assert.equal(state.keyboardOpen, false);
});

test('the helper tracks visual resize and scroll and clears keyboard state on blur', async () => {
  const env = createEnvironment();
  const cleanup = setupMobileViewport(env);
  assert.equal(env.style.getPropertyValue('--visual-viewport-height'), '844px');
  assert.equal(env.classList.contains('keyboard-open'), false);
  env.focus({ tagName: 'INPUT', type: 'text' });
  assert.equal(env.classList.contains('keyboard-open'), false);

  env.viewport.height = 500;
  env.viewport.offsetTop = 20;
  env.viewport.dispatchEvent(new Event('resize'));
  assert.equal(env.classList.contains('keyboard-open'), true);
  assert.equal(env.style.getPropertyValue('--visual-viewport-height'), '500px');
  assert.equal(env.style.getPropertyValue('--visual-viewport-top'), '20px');
  env.viewport.offsetTop = 55;
  env.viewport.dispatchEvent(new Event('scroll'));
  assert.equal(env.style.getPropertyValue('--visual-viewport-top'), '55px');

  await env.blur();
  assert.equal(env.classList.contains('keyboard-open'), false);
  env.resize({ visualHeight: 844, top: 0 });
  assert.equal(env.style.getPropertyValue('--visual-viewport-height'), '844px');
  cleanup();
});

test('Android resize and switching fields preserve the full-height baseline until the keyboard closes', async () => {
  const env = createEnvironment();
  const cleanup = setupMobileViewport(env);
  env.focus({ tagName: 'INPUT', type: 'search' });
  env.resize({ height: 500, visualHeight: 500 });
  assert.equal(env.classList.contains('keyboard-open'), true);

  env.document.dispatchEvent(new Event('focusout'));
  env.focus({ tagName: 'TEXTAREA' });
  await Promise.resolve();
  assert.equal(env.classList.contains('keyboard-open'), true);
  env.resize({ height: 844, visualHeight: 844 });
  assert.equal(env.classList.contains('keyboard-open'), false);
  cleanup();
});

test('rotation resets the baseline so a shorter landscape viewport is not mistaken for a keyboard', () => {
  const env = createEnvironment({ coarsePointer: true });
  const cleanup = setupMobileViewport(env);
  env.focus({ tagName: 'INPUT', type: 'text' });
  env.resize({ width: 844, height: 390, visualHeight: 390 });
  env.window.dispatchEvent(new Event('orientationchange'));
  assert.equal(env.classList.contains('keyboard-open'), false);
  env.resize({ height: 230, visualHeight: 230 });
  assert.equal(env.classList.contains('keyboard-open'), true);
  cleanup();
});

test('rotating with the Android keyboard open preserves its height reference in both orientations', () => {
  const env = createEnvironment({ coarsePointer: true });
  const cleanup = setupMobileViewport(env);
  env.focus({ tagName: 'INPUT', type: 'text' });
  env.resize({ height: 500, visualHeight: 500 });
  assert.equal(env.classList.contains('keyboard-open'), true);

  env.resize({ width: 844, height: 230, visualHeight: 230 });
  env.window.dispatchEvent(new Event('orientationchange'));
  assert.equal(env.classList.contains('keyboard-open'), true);
  env.window.dispatchEvent(new Event('orientationchange'));
  env.resize({ width: 390, height: 500, visualHeight: 500 });
  assert.equal(env.classList.contains('keyboard-open'), true);
  env.resize({ height: 844, visualHeight: 844 });
  assert.equal(env.classList.contains('keyboard-open'), false);
  cleanup();
});

test('compact portrait-to-landscape rotation keeps navigation visible without a keyboard, even with text focused', () => {
  const env = createEnvironment({ coarsePointer: true });
  env.resize({ width: 360, height: 640, visualHeight: 640 });
  const cleanup = setupMobileViewport(env);
  env.focus({ tagName: 'INPUT', type: 'text' });
  env.window.dispatchEvent(new Event('orientationchange'));
  env.resize({ width: 640, height: 360, visualHeight: 360 });
  assert.equal(env.classList.contains('keyboard-open'), false);
  env.resize({ width: 360, height: 640, visualHeight: 640 });
  env.window.dispatchEvent(new Event('orientationchange'));
  assert.equal(env.classList.contains('keyboard-open'), false);
  cleanup();
});

test('noneditable controls do not trigger keyboard mode; contenteditable text does', () => {
  const env = createEnvironment();
  const cleanup = setupMobileViewport(env);
  env.resize({ visualHeight: 500 });
  for (const element of [{ tagName: 'INPUT', type: 'checkbox' }, { tagName: 'INPUT', type: 'text', readOnly: true },
    { tagName: 'TEXTAREA', disabled: true }, { tagName: 'SELECT' }]) {
    env.focus(element);
    assert.equal(env.classList.contains('keyboard-open'), false);
  }
  env.focus({ tagName: 'DIV', isContentEditable: true });
  assert.equal(env.classList.contains('keyboard-open'), true);
  cleanup();
});

test('cleanup restores previous styles and removes listeners, including queued focus updates', async () => {
  const env = createEnvironment();
  env.style.setProperty('--visual-viewport-height', '90dvh');
  env.style.setProperty('--visual-viewport-top', '4px');
  const cleanup = setupMobileViewport(env);
  env.focus({ tagName: 'INPUT', type: 'text' });
  env.document.dispatchEvent(new Event('focusout'));
  cleanup();
  env.resize({ height: 400, visualHeight: 400 });
  env.viewport.dispatchEvent(new Event('scroll'));
  env.document.dispatchEvent(new Event('focusin'));
  await Promise.resolve();
  assert.equal(env.style.getPropertyValue('--visual-viewport-height'), '90dvh');
  assert.equal(env.style.getPropertyValue('--visual-viewport-top'), '4px');
  assert.equal(env.classList.contains('keyboard-open'), false);
});

test('browsers without visualViewport keep CSS viewport fallbacks untouched', () => {
  const env = createEnvironment({ visualViewport: false });
  const cleanup = setupMobileViewport(env);
  env.focus({ tagName: 'INPUT', type: 'text' });
  env.resize({ height: 400 });
  assert.equal(env.style.getPropertyValue('--visual-viewport-height'), '');
  assert.equal(env.style.getPropertyValue('--visual-viewport-top'), '');
  assert.equal(env.classList.contains('keyboard-open'), false);
  cleanup();
});
