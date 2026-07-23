import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SPEAKING_CATEGORIES,
  SPEAKING_LESSONS,
  FREE_CONVERSATION_LESSON,
  DEFAULT_SPEAKING_LEVEL,
  getLessonPlan,
  buildCoachInitiativeCue,
  buildSpeakingInstruction
} from '../js/data/speakingLessons.js';
import {
  GEMINI_LIVE_MODEL,
  buildGeminiLiveUrl,
  buildGeminiSetupMessage,
  parseGeminiLiveMessage,
  downsampleAudio,
  float32ToPcm16,
  microphoneAccessError
} from '../js/services/geminiLive.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('the speaking curriculum contains six complete tracks and 84 distinct lessons', () => {
  assert.equal(SPEAKING_CATEGORIES.length, 6);
  assert.equal(SPEAKING_LESSONS.length, 84);
  assert.equal(new Set(SPEAKING_LESSONS.map(lesson => lesson.id)).size, 84);
  for (const category of SPEAKING_CATEGORIES) {
    assert.equal(SPEAKING_LESSONS.filter(lesson => lesson.category === category.id).length, 14);
  }
  for (const lesson of [...SPEAKING_LESSONS, FREE_CONVERSATION_LESSON]) {
    assert.ok(lesson.title && lesson.goal && lesson.learnerRole && lesson.coachRole);
    assert.ok(lesson.targetPhrases.length >= 3);
    assert.ok(lesson.coachQuestions.length >= 3);
    assert.ok(lesson.scenarioTwist);
    assert.equal(getLessonPlan(lesson).length, 5);
    assert.ok(lesson.duration >= 5 && lesson.duration <= 12);
  }
});

test('the speaking experience defaults to the learner B2 profile', () => {
  assert.equal(DEFAULT_SPEAKING_LEVEL, 'B2');
  assert.equal(FREE_CONVERSATION_LESSON.level, 'B2');
  assert.equal(SPEAKING_LESSONS.filter(lesson => lesson.level === 'B2').length, 58);
  const component = readFileSync(resolve(projectRoot, 'js/components/SpeakingMode.js'), 'utf8');
  assert.match(component, /lastLessonId: 'rent-apartment'/);
  assert.match(component, /let levelFilter = learnerLevel/);
});

test('lesson coaching instructions set a concrete role, level, correction style, and honest scoring boundary', () => {
  const lesson = SPEAKING_LESSONS.find(item => item.id === 'present-idea');
  const instruction = buildSpeakingInstruction(lesson);
  assert.match(instruction, /Present your idea/);
  assert.match(instruction, /Learner level: B1/);
  assert.match(instruction, /The learner is a product specialist/);
  assert.match(instruction, /one question at a time/);
  assert.match(instruction, /never pretend to provide phoneme-level scoring/);
});

test('every lesson has a visible five-stage plan and the coach initiates and rescues silence', () => {
  const lesson = SPEAKING_LESSONS.find(item => item.id === 'clarify-brief');
  assert.deepEqual(getLessonPlan(lesson).map(step => step.phase), ['Warm up', 'Build', 'Challenge', 'Resolve', 'Improve']);
  assert.match(getLessonPlan(lesson)[2].detail, /speed, quality, and low cost/);
  assert.match(buildCoachInitiativeCue(lesson, 'start'), /Do not wait for the learner/);
  assert.match(buildCoachInitiativeCue(lesson, 'silence'), /offer two concrete answer options/);
  assert.match(buildCoachInitiativeCue(lesson, 'silence'), /To make sure I understand/);
  const instruction = buildSpeakingInstruction(lesson);
  assert.match(instruction, /Structured lesson plan:/);
  assert.match(instruction, /always carry the initiative/);
  assert.match(instruction, /If the learner says “I don’t know”/);
});

test('Gemini Live setup uses the current native-audio model and transcription', () => {
  const message = buildGeminiSetupMessage('Coach this learner.');
  assert.equal(message.setup.model, `models/${GEMINI_LIVE_MODEL}`);
  assert.deepEqual(message.setup.generationConfig.responseModalities, ['AUDIO']);
  assert.deepEqual(message.setup.inputAudioTranscription, {});
  assert.deepEqual(message.setup.outputAudioTranscription, {});
  assert.equal(message.setup.realtimeInputConfig.automaticActivityDetection.disabled, false);
  assert.equal(message.setup.realtimeInputConfig.automaticActivityDetection.prefixPaddingMs, 40);
  assert.equal(message.setup.realtimeInputConfig.automaticActivityDetection.silenceDurationMs, 800);
  assert.equal(message.setup.systemInstruction.parts[0].text, 'Coach this learner.');
  assert.match(buildGeminiLiveUrl('key with spaces'), /^wss:\/\//);
  assert.match(buildGeminiLiveUrl('key with spaces'), /key=key%20with%20spaces$/);
});

test('Gemini Live parses text, Blob, binary, typed-array, and decoded WebSocket messages', async () => {
  const payload = { serverContent: { turnComplete: true } };
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  assert.deepEqual(await parseGeminiLiveMessage(json), payload);
  assert.deepEqual(await parseGeminiLiveMessage(new Blob([json], { type: 'application/json' })), payload);
  assert.deepEqual(await parseGeminiLiveMessage(bytes.buffer), payload);
  assert.deepEqual(await parseGeminiLiveMessage(bytes), payload);
  assert.equal(await parseGeminiLiveMessage(payload), payload);
  await assert.rejects(() => parseGeminiLiveMessage(new Blob(['[object Object]'])), /not valid JSON|Unexpected/);
});

test('Gemini credentials are device-local and never embedded in source', () => {
  const service = readFileSync(resolve(projectRoot, 'js/services/geminiLive.js'), 'utf8');
  const component = readFileSync(resolve(projectRoot, 'js/components/SpeakingMode.js'), 'utf8');
  assert.doesNotMatch(service, /AIza[0-9A-Za-z_-]{20,}/);
  assert.match(component, /localStorage\.setItem\(GEMINI_KEY_STORAGE/);
  assert.doesNotMatch(component, /DEFAULT_GEMINI_API_KEY/);
});

test('browser audio is converted to bounded 16-bit PCM and downsampled to 16 kHz', () => {
  const source = new Float32Array(480).fill(.5);
  const sampled = downsampleAudio(source, 48000, 16000);
  assert.equal(sampled.length, 160);
  const pcm = float32ToPcm16(new Float32Array([-2, -.5, 0, .5, 2]));
  assert.deepEqual([...pcm], [-32768, -16384, 0, 16383, 32767]);
});

test('microphone permission failures explain how to recover on Android', () => {
  const error = microphoneAccessError(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }));
  assert.match(error.message, /Allow Microphone for KeepVocab in Android Settings/);
});

test('the speaking route is visible in navigation, offline packaged, and explicit about connection timing', () => {
  const html = readFileSync(resolve(projectRoot, 'index.html'), 'utf8');
  const app = readFileSync(resolve(projectRoot, 'js/app.js'), 'utf8');
  const component = readFileSync(resolve(projectRoot, 'js/components/SpeakingMode.js'), 'utf8');
  const serviceWorker = readFileSync(resolve(projectRoot, 'sw.js'), 'utf8');
  assert.match(html, /data-view="speaking"/);
  assert.match(html, /id="btn-mode-speaking"/);
  assert.match(app, /renderSpeakingMode/);
  assert.match(component, /Gemini connects only after you press Start/);
  assert.match(component, /never copied to Google Drive/);
  assert.match(component, /COACH_SILENCE_MS = 9000/);
  assert.match(component, /buildCoachInitiativeCue\(lesson, 'start'\)/);
  assert.match(component, /buildCoachInitiativeCue\(lesson, 'silence'\)/);
  assert.match(serviceWorker, /SpeakingMode\.js\?v=42/);
  assert.match(serviceWorker, /speakingLessons\.js\?v=42/);
  assert.match(serviceWorker, /geminiLive\.js\?v=42/);
});
