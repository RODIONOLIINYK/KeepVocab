import { evaluateUseItSentence } from '../services/useItEvaluation.js?v=90';
import { getGeminiSettings } from '../services/geminiSettings.js?v=90';
import { canRecordForGemini, createSpeechRecorder, transcribeAudioBlob } from '../services/speechInput.js?v=90';
import { escapeHtml } from '../utils/html.js';

export function mountUseItExercise(root, options) {
  let sentence = String(options.sentence || '');
  let result = options.result || null;
  let speechRecorder = null;
  let speechTimer = null;
  let destroyed = false;

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
    if (!speechRecorder || destroyed) return;
    clearSpeechTimer();
    const controller = speechRecorder;
    speechRecorder = null;
    const button = root.querySelector('[data-useit-speak]');
    const status = root.querySelector('[data-useit-status]');
    if (button) { button.disabled = true; button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Transcribing…'; }
    if (status) status.textContent = 'Gemini is transcribing your sentence…';
    try {
      const transcript = await transcribeAudioBlob(await controller.stop());
      sentence = transcript;
      const input = root.querySelector('[data-useit-sentence]');
      if (input) input.value = transcript;
      if (status) status.textContent = 'Speech added. Edit it if needed, then check the sentence.';
    } catch (error) {
      if (status) status.textContent = `${error.message} You can keep typing.`;
    } finally {
      if (button) { button.disabled = false; button.innerHTML = '<i class="fa-solid fa-microphone"></i> Speak instead'; }
    }
  }

  function render() {
    if (destroyed) return;
    const word = options.word;
    const canSpeak = canRecordForGemini() || Boolean(globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition);
    root.innerHTML = `<div class="use-it-stage"><img src="${result ? (result.correct ? 'assets/keepvocab-sprig-celebrate.webp' : 'assets/keepvocab-sprout-mascot.webp') : 'assets/keepvocab-sprig-thinking.webp'}" alt="" aria-hidden="true"><span class="eyebrow">Make it yours</span><h1>Use <strong>${escapeHtml(word.word)}</strong> in your own sentence.</h1><p class="use-it-definition">${escapeHtml(word.definition)}</p>
      ${result ? `<div class="answer-feedback-card ${result.correct ? 'correct' : 'incorrect'}" role="status" aria-live="polite"><i class="fa-solid ${result.correct ? 'fa-check' : 'fa-pen'} answer-feedback-icon" aria-hidden="true"></i><div><strong>${result.correct ? 'Good use of the meaning' : 'One more adjustment'}</strong><span>${escapeHtml(result.feedback)}${result.improvedSentence ? `<br>More natural: “${escapeHtml(result.improvedSentence)}”` : ''}</span></div></div><div class="inline-actions"><button class="btn-green-solid" data-useit-next>${escapeHtml(options.nextLabel || 'Next word')}</button><button class="status-pill offline" data-useit-retry>Edit sentence</button></div>` : `<form data-useit-form><textarea data-useit-sentence rows="4" placeholder="Write a natural sentence…" aria-label="Your sentence">${escapeHtml(sentence)}</textarea><div class="use-it-actions">${canSpeak ? '<button type="button" class="status-pill offline" data-useit-speak><i class="fa-solid fa-microphone"></i> Speak instead</button>' : ''}<button class="btn-green-solid" data-useit-check>Check sentence</button></div><p data-useit-status role="status" aria-live="polite">${getGeminiSettings().enabled ? 'Gemini will check meaning, grammar, and naturalness.' : 'Your sentence will be saved locally. Connect Gemini for detailed feedback.'}</p></form>`}</div>`;

    root.querySelector('[data-useit-form]')?.addEventListener('submit', async event => {
      event.preventDefault();
      sentence = root.querySelector('[data-useit-sentence]').value.trim();
      if (!sentence) return;
      cancelSpeechInput();
      const button = root.querySelector('[data-useit-check]');
      button.disabled = true;
      button.textContent = 'Checking…';
      result = await evaluateUseItSentence(word, sentence, options.evaluationOptions);
      await options.onEvaluated?.(result, sentence);
      render();
    });

    root.querySelector('[data-useit-speak]')?.addEventListener('click', async () => {
      if (speechRecorder) return finishGeminiRecording();
      const button = root.querySelector('[data-useit-speak]');
      const status = root.querySelector('[data-useit-status]');
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
      recognition.addEventListener('result', event => { sentence = event.results[0][0].transcript; root.querySelector('[data-useit-sentence]').value = sentence; status.textContent = 'Speech added. Edit it if needed, then check the sentence.'; });
      recognition.addEventListener('end', () => { button.innerHTML = '<i class="fa-solid fa-microphone"></i> Speak instead'; });
      recognition.addEventListener('error', event => { status.textContent = `Speech recognition stopped (${event.error || 'unavailable'}). Check microphone permission or keep typing.`; });
      try { recognition.start(); } catch (error) { status.textContent = `${error.message} You can keep typing.`; }
    });

    root.querySelector('[data-useit-retry]')?.addEventListener('click', () => { result = null; render(); });
    root.querySelector('[data-useit-next]')?.addEventListener('click', () => { cancelSpeechInput(); options.onNext?.(); });
    root.querySelector('[data-useit-sentence]')?.focus();
  }

  render();
  return {
    destroy() {
      destroyed = true;
      cancelSpeechInput();
      root.innerHTML = '';
    }
  };
}
