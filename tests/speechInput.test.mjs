import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryStorage } from '../js/services/driveSync.js';
import { saveGeminiSettings } from '../js/services/geminiSettings.js';
import { blobToBase64, createSpeechRecordingSession, transcribeAudioBlob } from '../js/services/speechInput.js';

test('speech audio is encoded and sent to Gemini for transcription', async () => {
  const storage = new MemoryStorage();
  saveGeminiSettings({ apiKey: 'AIza-example-device-key-123456789' }, storage, { silent: true });
  const audio = new Blob(['voice-bytes'], { type: 'audio/webm' });
  assert.equal(await blobToBase64(audio), 'dm9pY2UtYnl0ZXM=');
  let requestBody;
  const transcript = await transcribeAudioBlob(audio, {
    storage,
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return { ok: true, async json() { return { candidates: [{ content: { parts: [{ text: 'I faced my adversary calmly.' }] } }] }; } };
    }
  });
  assert.equal(transcript, 'I faced my adversary calmly.');
  assert.equal(requestBody.contents[0].parts[0].inlineData.mimeType, 'audio/webm');
  assert.equal(requestBody.contents[0].parts[0].inlineData.data, 'dm9pY2UtYnl0ZXM=');
});

test('a Use It speech session requests microphone access once and reuses it across recordings', async () => {
  const originalNavigator = globalThis.navigator;
  const originalMediaRecorder = globalThis.MediaRecorder;
  let requests = 0;
  let permissionRequests = 0;
  let stoppedTracks = 0;
  const stream = { getTracks: () => [{ readyState: 'live', stop: () => { stoppedTracks += 1; } }], getAudioTracks: () => [{ readyState: 'live' }] };
  class FakeMediaRecorder extends EventTarget {
    static isTypeSupported() { return true; }
    constructor() { super(); this.state = 'inactive'; this.mimeType = 'audio/webm'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.dispatchEvent(new Event('stop')); }
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => { requests += 1; return stream; } } } });
  globalThis.MediaRecorder = FakeMediaRecorder;
  try {
    const session = createSpeechRecordingSession({ requestPermission: async () => { permissionRequests += 1; return true; } });
    await session.prepare();
    const first = await session.createRecorder();
    await first.stop();
    const second = await session.createRecorder();
    await second.stop();
    assert.equal(requests, 1);
    assert.equal(permissionRequests, 1);
    assert.equal(stoppedTracks, 0);
    session.close();
    assert.equal(stoppedTracks, 1);
  } finally {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: originalNavigator });
    globalThis.MediaRecorder = originalMediaRecorder;
  }
});

test('a denied desktop microphone permission stops before opening an audio stream', async () => {
  const originalNavigator = globalThis.navigator;
  let requests = 0;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => { requests += 1; } } } });
  try {
    const session = createSpeechRecordingSession({ requestPermission: async () => false });
    await assert.rejects(session.prepare(), /Microphone access is off/);
    assert.equal(requests, 0);
  } finally {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: originalNavigator });
  }
});
