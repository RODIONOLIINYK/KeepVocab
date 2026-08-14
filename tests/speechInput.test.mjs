import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryStorage } from '../js/services/driveSync.js';
import { saveGeminiSettings } from '../js/services/geminiSettings.js';
import { blobToBase64, transcribeAudioBlob } from '../js/services/speechInput.js';

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
