import test from 'node:test';
import assert from 'node:assert/strict';
import { onSpeechStateChange, selectLocaleVoice, speakWord } from '../js/services/speechService.js';
import { renderPracticeMascot, renderTalkingSprigSvg, renderVoiceWave } from '../js/components/PracticeElements.js';

test('speech synthesis selects natural human voices and rejects macOS novelty/robotic voices like Albert', () => {
  const macVoices = [
    { name: 'Albert', lang: 'en-US' },
    { name: 'Bad News', lang: 'en-US' },
    { name: 'Bells', lang: 'en-US' },
    { name: 'Eddy (English (US))', lang: 'en-US' },
    { name: 'Fred', lang: 'en-US' },
    { name: 'Samantha (English (US))', lang: 'en-US' },
    { name: 'Zarvox', lang: 'en-US' }
  ];
  assert.equal(selectLocaleVoice(macVoices, 'en-US').name, 'Samantha (English (US))');

  const voicesWithPremium = [
    ...macVoices,
    { name: 'Google US English', lang: 'en-US' }
  ];
  assert.equal(selectLocaleVoice(voicesWithPremium, 'en-US').name, 'Google US English');

  const localeVoices = [
    { name: 'English', lang: 'en-GB' },
    { name: 'US Natural', lang: 'en-US' }
  ];
  assert.equal(selectLocaleVoice(localeVoices, 'en-US').name, 'US Natural');
  assert.equal(selectLocaleVoice(localeVoices, 'en-AU').name, 'US Natural');
});

test('Ukrainian voice selection never falls through to an English voice', () => {
  const voices = [{ name: 'US Natural', lang: 'en-US' }, { name: 'Ukrainian', lang: 'uk-UA' }];
  assert.equal(selectLocaleVoice(voices, 'uk-UA').name, 'Ukrainian');
  assert.equal(selectLocaleVoice(voices.slice(0, 1), 'uk-UA'), null);
});

test('recorded dictionary audio keeps natural 1.0 playback speed on normal rate and emits speech-state transitions', async () => {
  const originalWindow = globalThis.window;
  const audioInstances = [];
  const states = [];
  const off = onSpeechStateChange(state => states.push(state.speaking));
  class FakeAudio {
    constructor(url) { this.url = url; this.playbackRate = 1; audioInstances.push(this); }
    play() { return Promise.resolve(); }
    pause() {}
    removeAttribute() {}
    load() {}
  }
  globalThis.window = { Audio: FakeAudio };
  try {
    const normal = speakWord('resilient', 'en-US', 0.95, 'resilient.mp3');
    audioInstances[0].onended();
    assert.equal(await normal, true);
    assert.equal(audioInstances[0].playbackRate, 1, 'normal speed plays studio recording at unwarped 1.0x');

    const slow = speakWord('resilient', 'en-US', 0.72, 'resilient.mp3');
    audioInstances[1].onended();
    assert.equal(await slow, true);
    assert.equal(audioInstances[1].playbackRate, 0.72, 'slow mode lowers playbackRate intentionally');
    assert.ok(states.includes(true) && states.at(-1) === false, 'notifies talking mascot listeners on start and finish');
  } finally {
    off();
    globalThis.window = originalWindow;
  }
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
    assert.equal(await speakWord('Hello!', 'en-US', 0.95), true);
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
    const first = speakWord('first', 'en-US', 0.95, 'first.mp3');
    await Promise.resolve();
    const second = speakWord('second', 'en-US', 0.95, 'second.mp3');
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
      getVoices: () => [{ name: 'Samantha', lang: 'en-US' }],
      speak() { speechCalls += 1; }
    }
  };
  try {
    const first = speakWord('first', 'en-US', 0.95, 'first.mp3');
    const second = speakWord('second', 'en-US', 0.95, 'second.mp3');
    audioInstances[1].onended();
    assert.equal(await first, false);
    assert.equal(await second, true);
    assert.equal(speechCalls, 0);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('Talking Sprig mascot renders animated mouth, sound waves, and voice equalizer', () => {
  const mascotHtml = renderPracticeMascot({
    heading: 'Type what you hear',
    bubbleHtml: renderVoiceWave(),
    talking: true
  });
  assert.match(mascotHtml, /has-talking-mascot/);
  assert.match(mascotHtml, /data-sprig-talk/);
  assert.match(mascotHtml, /class="sprig-talk-svg"/);
  assert.match(mascotHtml, /sprig-mouth-talking/);
  assert.match(mascotHtml, /sprig-sound-waves/);
  assert.match(mascotHtml, /duo-voice-wave/);
  assert.match(renderTalkingSprigSvg('celebrate'), /sprig-eyes-happy/);
});
