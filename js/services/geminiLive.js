export const GEMINI_LIVE_MODEL = 'gemini-3.1-flash-live-preview';
export const GEMINI_KEY_STORAGE = 'keepvocab_gemini_live_key_v1';
export const BARGE_IN_LEVEL = 0.12;
export const BARGE_IN_FRAMES = 2;

export async function parseGeminiLiveMessage(data) {
  if (typeof data === 'string') return JSON.parse(data);
  if (typeof Blob !== 'undefined' && data instanceof Blob) return JSON.parse(await data.text());
  if (data instanceof ArrayBuffer) return JSON.parse(new TextDecoder().decode(new Uint8Array(data)));
  if (ArrayBuffer.isView(data)) {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  if (data && typeof data === 'object') return data;
  throw new TypeError('Gemini Live returned an unsupported message format.');
}

export function buildGeminiLiveUrl(apiKey, model = GEMINI_LIVE_MODEL) {
  if (!String(apiKey || '').trim()) throw new Error('A Gemini API key is required.');
  const endpoint = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
  return `${endpoint}?key=${encodeURIComponent(String(apiKey).trim())}`;
}

export function buildGeminiSetupMessage(instruction, model = GEMINI_LIVE_MODEL) {
  return {
    setup: {
      model: `models/${model}`,
      generationConfig: {
        responseModalities: ['AUDIO']
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      realtimeInputConfig: {
        automaticActivityDetection: {
          disabled: false,
          prefixPaddingMs: 40,
          silenceDurationMs: 800
        }
      },
      systemInstruction: { parts: [{ text: String(instruction || '') }] }
    }
  };
}

export function float32ToPcm16(samples) {
  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    pcm[index] = value < 0 ? value * 0x8000 : value * 0x7fff;
  }
  return pcm;
}

export function downsampleAudio(samples, sourceRate, targetRate = 16000) {
  if (sourceRate === targetRate) return samples;
  const ratio = sourceRate / targetRate;
  const length = Math.max(1, Math.round(samples.length / ratio));
  const output = new Float32Array(length);
  for (let outputIndex = 0; outputIndex < length; outputIndex += 1) {
    const start = Math.floor(outputIndex * ratio);
    const end = Math.min(samples.length, Math.floor((outputIndex + 1) * ratio));
    let sum = 0;
    for (let inputIndex = start; inputIndex < end; inputIndex += 1) sum += samples[inputIndex];
    output[outputIndex] = sum / Math.max(1, end - start);
  }
  return output;
}

export function microphoneAccessError(error) {
  const denied = error?.name === 'NotAllowedError' || /permission denied|not allowed/i.test(String(error?.message || ''));
  if (denied) {
    return new Error('Microphone permission was denied. Allow Microphone for KeepVocab in Android Settings, then try again.');
  }
  return error instanceof Error ? error : new Error('Microphone access failed.');
}

function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function pcm16ToFloat32(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result = new Float32Array(Math.floor(bytes.byteLength / 2));
  for (let index = 0; index < result.length; index += 1) {
    const sample = view.getInt16(index * 2, true);
    result[index] = sample / (sample < 0 ? 0x8000 : 0x7fff);
  }
  return result;
}

function eventDetail(name, detail) {
  return new CustomEvent(name, { detail });
}

export class GeminiLiveSession extends EventTarget {
  constructor() {
    super();
    this.socket = null;
    this.stream = null;
    this.inputContext = null;
    this.outputContext = null;
    this.processor = null;
    this.inputSource = null;
    this.muted = false;
    this.nextAudioTime = 0;
    this.outputSources = new Set();
    this.outputGeneration = 0;
    this.pendingAudioChunks = 0;
    this.pendingTurnComplete = false;
    this.sessionStatus = 'closed';
    this.loudInputFrames = 0;
    this.ignoreCurrentModelAudio = false;
    this.closedByUser = false;
  }

  updateStatus(status) {
    this.sessionStatus = status;
    this.dispatchEvent(eventDetail('status', status));
  }

  async prepareAudioOutput() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('This browser does not support live audio playback.');
    if (!this.outputContext) this.outputContext = new AudioContextClass({ sampleRate: 24000 });
    await this.outputContext.resume();
  }

  async connect({ apiKey, instruction }) {
    this.closedByUser = false;
    this.updateStatus('connecting');
    const socket = new WebSocket(buildGeminiLiveUrl(apiKey));
    this.socket = socket;

    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = error => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };
      const timeout = window.setTimeout(() => fail(new Error('Gemini Live took too long to connect.')), 15000);

      socket.addEventListener('open', () => socket.send(JSON.stringify(buildGeminiSetupMessage(instruction))));
      socket.addEventListener('message', async event => {
        try {
          const message = await parseGeminiLiveMessage(event.data);
          if (message.setupComplete && !settled) {
            settled = true;
            window.clearTimeout(timeout);
            this.updateStatus('ready');
            resolve();
          }
          this.handleServerMessage(message);
        } catch (error) {
          this.dispatchEvent(eventDetail('error', error));
        }
      });
      socket.addEventListener('error', () => fail(new Error('Gemini Live could not connect. Check the key and your network.')));
      socket.addEventListener('close', event => {
        window.clearTimeout(timeout);
        if (!this.closedByUser && event.code !== 1000) {
          const error = new Error(`Gemini Live disconnected${event.reason ? `: ${event.reason}` : '.'}`);
          fail(error);
          this.dispatchEvent(eventDetail('error', error));
        }
        this.updateStatus('closed');
      });
    });
  }

  async startMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser does not support microphone access.');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    } catch (error) {
      throw microphoneAccessError(error);
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.inputContext = new AudioContextClass();
    await this.inputContext.resume();
    this.inputSource = this.inputContext.createMediaStreamSource(this.stream);
    this.processor = this.inputContext.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = event => {
      if (this.muted || this.socket?.readyState !== WebSocket.OPEN) return;
      const source = event.inputBuffer.getChannelData(0);
      const level = Math.min(1, source.reduce((sum, value) => sum + Math.abs(value), 0) / source.length * 5);
      if (this.sessionStatus === 'speaking' && level >= BARGE_IN_LEVEL) {
        this.loudInputFrames += 1;
        if (this.loudInputFrames >= BARGE_IN_FRAMES) this.interruptOutput('voice');
      } else {
        this.loudInputFrames = 0;
      }
      const pcm = float32ToPcm16(downsampleAudio(source, this.inputContext.sampleRate, 16000));
      this.socket.send(JSON.stringify({
        realtimeInput: { audio: { data: bytesToBase64(pcm.buffer), mimeType: 'audio/pcm;rate=16000' } }
      }));
      this.dispatchEvent(eventDetail('level', level));
    };
    this.inputSource.connect(this.processor);
    this.processor.connect(this.inputContext.destination);
    this.updateStatus('listening');
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    for (const track of this.stream?.getAudioTracks?.() || []) track.enabled = !this.muted;
    const modelStillSpeaking = this.sessionStatus === 'speaking' || this.outputSources.size || this.pendingAudioChunks || this.pendingTurnComplete;
    this.updateStatus(modelStillSpeaking ? 'speaking' : this.muted ? 'muted' : 'listening');
  }

  sendText(text) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    if (this.sessionStatus === 'speaking') this.interruptOutput('typed');
    this.socket.send(JSON.stringify({ realtimeInput: { text: String(text) } }));
    return true;
  }

  cancelOutputAudio() {
    this.outputGeneration += 1;
    for (const source of this.outputSources) {
      try { source.stop(); } catch {}
      try { source.disconnect(); } catch {}
    }
    this.outputSources.clear();
    this.nextAudioTime = this.outputContext?.currentTime || 0;
  }

  finishOutputTurnIfReady() {
    if (!this.pendingTurnComplete || this.pendingAudioChunks || this.outputSources.size) return;
    this.pendingTurnComplete = false;
    this.dispatchEvent(eventDetail('turncomplete', true));
    this.updateStatus(this.muted ? 'muted' : 'listening');
  }

  interruptOutput(source = 'button') {
    if (this.sessionStatus !== 'speaking' && !this.outputSources.size) return false;
    this.ignoreCurrentModelAudio = true;
    this.pendingTurnComplete = false;
    this.cancelOutputAudio();
    this.loudInputFrames = 0;
    this.updateStatus(this.muted ? 'muted' : 'listening');
    this.dispatchEvent(eventDetail('interrupted', { source }));
    return true;
  }

  handleServerMessage(message) {
    const content = message.serverContent;
    if (!content) return;
    if (content.inputTranscription?.text) this.dispatchEvent(eventDetail('transcript', { role: 'learner', text: content.inputTranscription.text }));
    if (content.outputTranscription?.text) this.dispatchEvent(eventDetail('transcript', { role: 'coach', text: content.outputTranscription.text }));
    if (content.interrupted) {
      this.pendingTurnComplete = false;
      this.cancelOutputAudio();
      this.ignoreCurrentModelAudio = false;
      this.updateStatus(this.muted ? 'muted' : 'listening');
      return;
    }
    if (content.modelTurn) {
      if (!this.ignoreCurrentModelAudio) this.updateStatus('speaking');
    }
    if (!this.ignoreCurrentModelAudio) {
      for (const part of content.modelTurn?.parts || []) {
        if (!part.inlineData?.data) continue;
        const rateMatch = String(part.inlineData.mimeType || '').match(/rate=(\d+)/);
        this.playAudio(part.inlineData.data, Number(rateMatch?.[1] || 24000));
      }
    }
    if (content.turnComplete) {
      this.ignoreCurrentModelAudio = false;
      this.pendingTurnComplete = true;
      this.finishOutputTurnIfReady();
    }
  }

  async playAudio(base64, sampleRate) {
    const generation = this.outputGeneration;
    this.pendingAudioChunks += 1;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    try {
      if (!this.outputContext) this.outputContext = new AudioContextClass({ sampleRate });
      await this.outputContext.resume();
      if (generation !== this.outputGeneration || this.ignoreCurrentModelAudio) return;
      const samples = pcm16ToFloat32(base64ToBytes(base64));
      const buffer = this.outputContext.createBuffer(1, samples.length, sampleRate);
      buffer.copyToChannel(samples, 0);
      const source = this.outputContext.createBufferSource();
      source.buffer = buffer;
      source.connect(this.outputContext.destination);
      this.outputSources.add(source);
      source.onended = () => {
        this.outputSources.delete(source);
        try { source.disconnect(); } catch {}
        this.finishOutputTurnIfReady();
      };
      const now = this.outputContext.currentTime;
      const startAt = Math.max(now, this.nextAudioTime);
      source.start(startAt);
      this.nextAudioTime = startAt + buffer.duration;
    } finally {
      this.pendingAudioChunks -= 1;
      this.finishOutputTurnIfReady();
    }
  }

  async disconnect() {
    this.closedByUser = true;
    this.cancelOutputAudio();
    this.processor?.disconnect();
    this.inputSource?.disconnect();
    for (const track of this.stream?.getTracks?.() || []) track.stop();
    if (this.inputContext && this.inputContext.state !== 'closed') await this.inputContext.close();
    if (this.outputContext && this.outputContext.state !== 'closed') await this.outputContext.close();
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.close(1000, 'Lesson ended');
    this.socket = null;
    this.stream = null;
    this.processor = null;
    this.inputSource = null;
    this.inputContext = null;
    this.outputContext = null;
    this.sessionStatus = 'closed';
    this.pendingAudioChunks = 0;
    this.pendingTurnComplete = false;
    this.ignoreCurrentModelAudio = false;
  }
}
