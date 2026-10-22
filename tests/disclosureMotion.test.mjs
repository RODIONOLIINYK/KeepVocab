import test from 'node:test';
import assert from 'node:assert/strict';
import { animateDisclosures } from '../js/utils/disclosureMotion.js';

function fixture({ reduced = false } = {}) {
  const callbacks = {};
  const attributes = {};
  const animations = [];
  let focused = false;
  const summary = {
    setAttribute(key, value) { attributes[key] = value; },
    addEventListener(event, callback) { callbacks[`summary:${event}`] = callback; },
    focus() { focused = true; }
  };
  const body = {
    scrollHeight: 96,
    style: {},
    animate(frames, options) {
      let resolve;
      let reject;
      const result = { frames, options, finished: new Promise((yes, no) => { resolve = yes; reject = no; }), finish() { resolve(); }, cancel() { reject(new Error('cancelled')); } };
      animations.push(result);
      return result;
    }
  };
  const details = {
    open: false,
    dataset: {},
    querySelector(selector) { return selector === 'summary' ? summary : body; },
    addEventListener(event, callback) { callbacks[event] = callback; }
  };
  const previous = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: reduced });
  animateDisclosures({ querySelectorAll: () => [details] });
  return {
    details, body, attributes, animations,
    get focused() { return focused; },
    click() { let prevented = false; callbacks['summary:click']({ preventDefault() { prevented = true; } }); assert.equal(prevented, true); },
    escape() { callbacks.keydown({ key: 'Escape', preventDefault() {} }); },
    restore() { if (previous) globalThis.matchMedia = previous; else delete globalThis.matchMedia; }
  };
}

test('disclosure stays open during its closing animation and Escape returns focus', async () => {
  const ui = fixture();
  try {
    assert.equal(ui.attributes['aria-expanded'], 'false');
    ui.click();
    assert.equal(ui.details.open, true);
    assert.equal(ui.attributes['aria-expanded'], 'true');
    assert.equal(ui.animations[0].frames[0].height, '0px');
    ui.animations[0].finish();
    await Promise.resolve();
    ui.escape();
    assert.equal(ui.details.open, true);
    assert.equal(ui.focused, true);
    assert.equal(ui.attributes['aria-expanded'], 'false');
    assert.equal(ui.animations[1].frames[0].height, '96px');
    ui.animations[1].finish();
    await Promise.resolve();
    assert.equal(ui.details.open, false);
    assert.equal(ui.body.style.overflow, '');
  } finally { ui.restore(); }
});

test('rapid toggle cancels earlier motion without letting it close the reopened disclosure', async () => {
  const ui = fixture();
  try {
    ui.click(); ui.click(); ui.click();
    ui.animations[1].finish();
    await Promise.resolve();
    assert.equal(ui.details.open, true);
    assert.equal(ui.attributes['aria-expanded'], 'true');
    ui.animations[2].finish();
    await Promise.resolve();
    assert.equal(ui.details.open, true);
  } finally { ui.restore(); }
});

test('reduced motion toggles immediately without creating animations', () => {
  const ui = fixture({ reduced: true });
  try {
    ui.click();
    assert.equal(ui.details.open, true);
    ui.click();
    assert.equal(ui.details.open, false);
    assert.equal(ui.animations.length, 0);
  } finally { ui.restore(); }
});
