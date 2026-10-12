import test from 'node:test';
import assert from 'node:assert/strict';
import { selectLocaleVoice, speakWord } from '../js/services/speechService.js';

test('speech synthesis selects the exact English locale before a generic English voice', () => {
  const voices = [
    { name: 'English', lang: 'en-GB' },
    { name: 'US Natural', lang: 'en-US' }
  ];
  assert.equal(selectLocaleVoice(voices, 'en-US').name, 'US Natural');
  assert.equal(selectLocaleVoice(voices, 'en-AU').name, 'US Natural');
});

test('Ukrainian voice selection never falls through to an English voice', () => {
  const voices = [{ name: 'US Natural', lang: 'en-US' }, { name: 'Ukrainian', lang: 'uk-UA' }];
  assert.equal(selectLocaleVoice(voices, 'uk-UA').name, 'Ukrainian');
  assert.equal(selectLocaleVoice(voices.slice(0, 1), 'uk-UA'), null);
});

test('English speech can use a language tag when voice enumeration is unavailable', async () => {
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
    assert.equal(await speakWord('Hello!', 'en-US', 0.9), true);
    assert.equal(spoken.lang, 'en-US');
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


test('a cancelled dictionary recording does not restart as browser speech', async () => {
  const originalWindow = globalThis.window;
  const audioInstances = [];
  let speechCalls = 0;
  class FakeAudio {
    constructor() { audioInstances.push(this); }
    play() { return Promise.resolve(); }
    pause() {}
    removeAttribute() {}
    load() {}
  }
  globalThis.window = {
    Audio: FakeAudio,
    SpeechSynthesisUtterance: class {},
    speechSynthesis: {
      cancel() {},
      getVoices: () => [{ name: 'English', lang: 'en-US' }],
      speak() { speechCalls += 1; }
    }
  };
  try {
    const first = speakWord('first', 'en-US', 0.9, 'first.mp3');
    const second = speakWord('second', 'en-US', 0.9, 'second.mp3');
    audioInstances[1].onended();
    assert.equal(await first, false);
    assert.equal(await second, true);
    assert.equal(speechCalls, 0);
  } finally {
    globalThis.window = originalWindow;
  }
});
