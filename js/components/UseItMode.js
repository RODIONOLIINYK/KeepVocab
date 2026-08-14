import { driveSync } from '../services/driveSync.js?v=63';
import { recordExerciseResult } from '../services/exerciseResult.js?v=63';
import { generateGeminiContent, getGeminiSettings } from '../services/geminiSettings.js?v=63';
import { weaknessScore } from '../services/dailySession.js?v=63';
import { playInteractionSound } from '../services/interactionSound.js?v=63';
import { canRecordForGemini, createSpeechRecorder, transcribeAudioBlob } from '../services/speechInput.js?v=63';
import { escapeHtml } from '../utils/html.js';

function containsTarget(sentence, target) {
  const escaped = String(target || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, 'i').test(String(sentence || ''));
}

export function evaluateUseItFallback(word, sentence) {
  const used = containsTarget(sentence, word.word);
  const longEnough = String(sentence || '').trim().split(/\s+/).filter(Boolean).length >= 4;
  return {
    used,
    senseCorrect: used ? null : false,
    grammatical: null,
    natural: null,
    correct: used && longEnough,
    feedback: !used ? `Include “${word.word}” in the sentence.` : !longEnough ? 'Add enough context to show what you mean.' : 'Your sentence is saved. Connect Gemini for meaning, grammar, and naturalness feedback.',
    improvedSentence: ''
  };
}

export async function evaluateUseItSentence(word, sentence, options = {}) {
  const fallback = evaluateUseItFallback(word, sentence);
  if (!fallback.used || !getGeminiSettings(options.storage).enabled) return fallback;
  try {
    const result = await generateGeminiContent(`You are a concise, encouraging English teacher. Evaluate the learner sentence without punishing valid stylistic differences. Target word: ${word.word}. Intended definition: ${word.definition}. Example sense: ${word.example || 'not provided'}. Learner sentence: ${sentence}. Return JSON only with: used (boolean), senseCorrect (boolean), grammatical (boolean), natural (boolean), correct (boolean; true when the target is used in the intended sense and the sentence is understandable), feedback (one short sentence), improvedSentence (empty when no improvement is needed).`, { ...options, json: true });
    return {
      used: Boolean(result.used),
      senseCorrect: Boolean(result.senseCorrect),
      grammatical: Boolean(result.grammatical),
      natural: Boolean(result.natural),
      correct: Boolean(result.correct),
      feedback: String(result.feedback || fallback.feedback),
      improvedSentence: String(result.improvedSentence || '')
    };
  } catch {
    return fallback;
  }
}

function go(view, onNavigate) {
  if (window.location.hash === `#${view}`) onNavigate(view); else window.location.hash = view;
}

export function renderUseItMode(container, onNavigate) {
  const notebook = driveSync.getActiveNotebook();
  const words = driveSync.getWords().filter(word => word.notebook === notebook).sort((a, b) => weaknessScore(b) - weaknessScore(a));
  if (!words.length) {
    container.innerHTML = `<section class="full-view-stack"><div class="spec-card useful-empty-state"><img class="mascot-result" src="assets/keepvocab-sprout-mascot.webp" alt="Sprig"><h2>Add vocabulary first</h2><p>Use It turns saved meanings into active English.</p><button class="btn-green-solid" id="useit-back">Back to Today</button></div></section>`;
    container.querySelector('#useit-back').addEventListener('click', () => go('dashboard', onNavigate));
    return;
  }
  let index = 0;
  let result = null;
  let sentence = '';
  let startedAt = performance.now();
  let speechRecorder = null;
  let speechTimer = null;

  function clearSpeechTimer() {
    if (speechTimer) globalThis.clearTimeout(speechTimer);
    speechTimer = null;
  }

  function cancelSpeechInput() {
    clearSpeechTimer();
    speechRecorder?.cancel();
    speechRecorder = null;
  }

  async function finishGeminiRecording() {
    if (!speechRecorder) return;
    clearSpeechTimer();
    const controller = speechRecorder;
    speechRecorder = null;
    const button = container.querySelector('#useit-speak');
    const status = container.querySelector('#useit-status');
    if (button) { button.disabled = true; button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Transcribing…'; }
    if (status) status.textContent = 'Gemini is transcribing your sentence…';
    try {
      const transcript = await transcribeAudioBlob(await controller.stop());
      sentence = transcript;
      const input = container.querySelector('#useit-sentence');
      if (input) input.value = transcript;
      if (status) status.textContent = 'Speech added. Edit it if needed, then check the sentence.';
    } catch (error) {
      if (status) status.textContent = `${error.message} You can keep typing.`;
    } finally {
      if (button) { button.disabled = false; button.innerHTML = '<i class="fa-solid fa-microphone"></i> Speak instead'; }
    }
  }

  function render() {
    const word = words[index % words.length];
    const canSpeak = canRecordForGemini() || Boolean(globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition);
    container.innerHTML = `<section class="full-view-stack"><div class="spec-card use-it-shell"><div class="practice-topline"><button class="status-pill offline" id="useit-exit"><i class="fa-solid fa-arrow-left"></i> Today</button><span>Use It · ${index + 1} of ${words.length}</span><strong>Active production</strong></div><div class="review-progress"><span style="width:${Math.round(index / words.length * 100)}%"></span></div><div class="use-it-stage"><img src="${result ? (result.correct ? 'assets/keepvocab-sprig-celebrate.webp' : 'assets/keepvocab-sprout-mascot.webp') : 'assets/keepvocab-sprig-thinking.webp'}" alt="" aria-hidden="true"><span class="eyebrow">Make it yours</span><h1>Use <strong>${escapeHtml(word.word)}</strong> in your own sentence.</h1><p class="use-it-definition">${escapeHtml(word.definition)}</p>
      ${result ? `<div class="answer-feedback-card ${result.correct ? 'correct' : 'incorrect'}" role="status"><i class="fa-solid ${result.correct ? 'fa-check' : 'fa-pen'} answer-feedback-icon"></i><div><strong>${result.correct ? 'Good use of the meaning' : 'One more adjustment'}</strong><span>${escapeHtml(result.feedback)}${result.improvedSentence ? `<br>More natural: “${escapeHtml(result.improvedSentence)}”` : ''}</span></div></div><div class="inline-actions"><button class="btn-green-solid" id="useit-next">${index + 1 >= words.length ? 'Finish' : 'Next word'}</button><button class="status-pill offline" id="useit-retry">Edit sentence</button></div>` : `<form id="useit-form"><textarea id="useit-sentence" rows="4" placeholder="Write a natural sentence…" aria-label="Your sentence">${escapeHtml(sentence)}</textarea><div class="use-it-actions">${canSpeak ? '<button type="button" class="status-pill offline" id="useit-speak"><i class="fa-solid fa-microphone"></i> Speak instead</button>' : ''}<button class="btn-green-solid" id="useit-check">Check sentence</button></div><p id="useit-status" role="status" aria-live="polite">${getGeminiSettings().enabled ? 'Gemini will check meaning, grammar, and naturalness.' : 'Offline fallback checks usage and saves your answer locally.'}</p></form>`}</div></div></section>`;
    container.querySelector('#useit-exit').addEventListener('click', () => { cancelSpeechInput(); go('dashboard', onNavigate); });
    container.querySelector('#useit-form')?.addEventListener('submit', async event => {
      event.preventDefault();
      sentence = container.querySelector('#useit-sentence').value.trim();
      if (!sentence) return;
      cancelSpeechInput();
      const button = container.querySelector('#useit-check');
      button.disabled = true;
      button.textContent = 'Checking…';
      result = await evaluateUseItSentence(word, sentence);
      recordExerciseResult({ wordId: word.id, exerciseType: 'use-it', correct: result.correct, responseTimeMs: performance.now() - startedAt, hintsUsed: 0, recallType: 'productive', producedUnaided: true, learnerResponse: sentence });
      playInteractionSound(result.correct ? 'correct' : 'wrong');
      render();
    });
    container.querySelector('#useit-speak')?.addEventListener('click', async () => {
      if (speechRecorder) return finishGeminiRecording();
      const button = container.querySelector('#useit-speak');
      const status = container.querySelector('#useit-status');
      if (canRecordForGemini()) {
        try {
          button.disabled = true;
          status.textContent = 'Requesting microphone access…';
          speechRecorder = await createSpeechRecorder();
          button.disabled = false;
          button.innerHTML = '<i class="fa-solid fa-stop"></i> Stop recording';
          status.textContent = 'Listening… Speak your sentence, then tap Stop.';
          speechTimer = globalThis.setTimeout(finishGeminiRecording, 10_000);
        } catch (error) {
          button.disabled = false;
          button.innerHTML = '<i class="fa-solid fa-microphone"></i> Speak instead';
          status.textContent = `${error.message} Check microphone permission or keep typing.`;
        }
        return;
      }
      const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
      const recognition = new Recognition();
      recognition.lang = 'en-US';
      recognition.interimResults = false;
      recognition.addEventListener('start', () => { button.innerHTML = '<i class="fa-solid fa-wave-square"></i> Listening…'; status.textContent = 'Listening for your sentence…'; });
      recognition.addEventListener('result', event => { sentence = event.results[0][0].transcript; container.querySelector('#useit-sentence').value = sentence; status.textContent = 'Speech added. Edit it if needed, then check the sentence.'; });
      recognition.addEventListener('end', () => { button.innerHTML = '<i class="fa-solid fa-microphone"></i> Speak instead'; });
      recognition.addEventListener('error', event => { status.textContent = `Speech recognition stopped (${event.error || 'unavailable'}). Check microphone permission or keep typing.`; });
      try { recognition.start(); } catch (error) { status.textContent = `${error.message} You can keep typing.`; }
    });
    container.querySelector('#useit-retry')?.addEventListener('click', () => { result = null; render(); });
    container.querySelector('#useit-next')?.addEventListener('click', () => { cancelSpeechInput(); if (index + 1 >= words.length) go('dashboard', onNavigate); else { index += 1; result = null; sentence = ''; startedAt = performance.now(); render(); } });
    container.querySelector('#useit-sentence')?.focus();
  }
  render();
}
