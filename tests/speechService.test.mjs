import test from 'node:test';
import assert from 'node:assert/strict';
import { selectEnglishVoice, selectLocaleVoice, speakWord } from '../js/services/speechService.js';

test('speech synthesis selects the exact English locale before a generic English voice', () => {
  const voices = [
    { name: 'English', lang: 'en-GB' },
    { name: 'US Natural', lang: 'en-US' }
  ];
  assert.equal(selectEnglishVoice(voices, 'en-US').name, 'US Natural');
  assert.equal(selectEnglishVoice(voices, 'en-AU').name, 'US Natural');
});

test('Lithuanian voice selection never falls through to an English voice', () => {
  const voices = [{ name: 'US Natural', lang: 'en-US' }, { name: 'Lithuanian', lang: 'lt-LT' }];
  assert.equal(selectLocaleVoice(voices, 'lt-LT').name, 'Lithuanian');
  assert.equal(selectLocaleVoice(voices.slice(0, 1), 'lt-LT'), null);
});

test('Lithuanian speech can use an lt-LT language tag when voice enumeration is unavailable', async () => {
  const originalWindow = globalThis.window;
  let spoken = null;
  class FakeUtterance {
    constructor(text) { this.text = text; }
  }
  globalThis.window = {
    SpeechSynthesisUtterance: FakeUtterance,
    speechSynthesis: {
      cancel() {},
      getVoices: () => [],
      addEventListener() {},
      removeEventListener() {},
      speak(utterance) { spoken = utterance; queueMicrotask(() => utterance.onend()); }
    }
  };
  try {
    assert.equal(await speakWord('Laba diena!', 'lt-LT', 0.84), true);
    assert.equal(spoken.lang, 'lt-LT');
    assert.equal(spoken.voice, undefined);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('speech requests fail safely when no synthesizer exists', async () => {
  assert.equal(await speakWord('resilient'), false);
  assert.equal(await speakWord(''), false);
});

test('a newer pronunciation stops and settles the previous recorded audio request', async () => {
  const originalWindow = globalThis.window;
  const audioInstances = [];
  class FakeAudio {
    constructor(url) { this.url = url; this.paused = false; audioInstances.push(this); }
    play() { return Promise.resolve(); }
    pause() { this.paused = true; }
    removeAttribute() {}
    load() {}
  }
  globalThis.window = { Audio: FakeAudio };
  try {
    const first = speakWord('first', 'en-US', 0.9, 'first.mp3');
    await Promise.resolve();
    const second = speakWord('second', 'en-US', 0.9, 'second.mp3');
    await Promise.resolve();
    assert.equal(audioInstances[0].paused, true);
    audioInstances[1].onended();
    assert.equal(await first, false);
    assert.equal(await second, true);
  } finally {
    globalThis.window = originalWindow;
  }
});
