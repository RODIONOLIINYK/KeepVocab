import { generateGeminiParts, getGeminiSettings } from './geminiSettings.js?v=63';

export function canRecordForGemini(storage = globalThis.localStorage) {
  return Boolean(getGeminiSettings(storage).enabled
    && globalThis.navigator?.mediaDevices?.getUserMedia
    && globalThis.MediaRecorder);
}

export async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return globalThis.btoa(binary);
}

export async function transcribeAudioBlob(blob, options = {}) {
  if (!blob?.size) throw new Error('No speech was recorded.');
  const mimeType = String(blob.type || 'audio/webm').split(';')[0];
  const data = await blobToBase64(blob);
  const transcript = await generateGeminiParts([
    { inlineData: { mimeType, data } },
    { text: 'Transcribe this English learner speech. Return only the spoken words, with normal punctuation. Do not add notes, labels, or quotation marks.' }
  ], { ...options, maxOutputTokens: 180 });
  const clean = String(transcript || '').trim().replace(/^['“"]|['”"]$/g, '');
  if (!clean) throw new Error('No speech was detected. Try again or keep typing.');
  return clean;
}

export async function createSpeechRecorder(options = {}) {
  if (!globalThis.navigator?.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) {
    throw new Error('Audio recording is unavailable on this device.');
  }
  const stream = await globalThis.navigator.mediaDevices.getUserMedia({ audio: true });
  const preferredTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  const mimeType = preferredTypes.find(type => globalThis.MediaRecorder.isTypeSupported?.(type)) || '';
  const recorder = new globalThis.MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  let settled = false;
  let resolveResult;
  let rejectResult;
  const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  const stopTracks = () => stream.getTracks().forEach(track => track.stop());
  recorder.addEventListener('dataavailable', event => { if (event.data?.size) chunks.push(event.data); });
  recorder.addEventListener('error', event => {
    if (settled) return;
    settled = true;
    stopTracks();
    rejectResult(new Error(event.error?.message || 'Audio recording failed.'));
  });
  recorder.addEventListener('stop', () => {
    if (settled) return;
    settled = true;
    stopTracks();
    resolveResult(new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' }));
  });
  recorder.start();
  return {
    result,
    stop() { if (recorder.state !== 'inactive') recorder.stop(); return result; },
    cancel() {
      stopTracks();
      if (recorder.state !== 'inactive') recorder.stop();
    }
  };
}
