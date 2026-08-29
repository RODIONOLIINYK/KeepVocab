import { driveSync } from '../services/driveSync.js?v=93';
import { recordExerciseResult } from '../services/exerciseResult.js?v=93';
import { getGeminiSettings } from '../services/geminiSettings.js?v=93';
import { buildLocalContextSet, clozeContextSentence, generateContextExerciseSet } from '../services/contextExercises.js?v=116';
import { escapeHtml } from '../utils/html.js';
import { evaluateChoiceAnswer } from '../services/exerciseEvaluation.js?v=93';
import { DEFAULT_SESSION_SIZE } from '../services/dailySession.js?v=93';
import { recordModeWordSelections, selectModeWords } from '../services/wordSelection.js?v=93';
import { navigateTo as go } from '../utils/navigation.js';

function shuffle(values) {
  return [...values].sort(() => Math.random() - .5);
}

export function selectContextWords(words, limit = DEFAULT_SESSION_SIZE, now = new Date()) {
  return selectModeWords(words, { mode: 'context', limit, now });
}

export function renderContextQuizMode(container, onNavigate) {
  const allWords = driveSync.getWords();
  const courseId = driveSync.getActiveCourseId();
  const lithuanian = courseId === 'lithuanian';
  const contextWords = selectContextWords(allWords);
  if (contextWords.length < 3) {
    container.innerHTML = `<section class="mode-empty-state"><img src="assets/keepvocab-sprig-thinking.webp" alt="Sprig thinking"><span class="eyebrow">Context</span><h1>Add 3 words to unlock Context</h1><p>KeepVocab needs a few meanings to create useful sentence choices.</p><button class="btn-green-solid" id="context-add">Add vocabulary</button></section>`;
    container.querySelector('#context-add').addEventListener('click', () => document.getElementById('quick-add-modal')?.classList.add('active'));
    return;
  }

  let contextSet = null;
  let quizWords = contextWords;
  let current = 0;
  let score = 0;
  let answered = false;
  let selectedId = '';
  let selectionRecorded = false;

  function renderSetup() {
    container.innerHTML = `<section class="mode-empty-state"><img src="assets/keepvocab-sprig-thinking.webp" alt="Sprig thinking"><span class="eyebrow">AI Context</span><h1>Connect Gemini to create Context sentences</h1><p>Gemini writes a fresh sentence for each selected vocabulary sense. Definitions stay hidden while you answer.</p><div class="mode-completion-actions"><button class="btn-green-solid" id="context-settings"><i class="fa-solid fa-key"></i> Set up Google AI Studio</button><button class="status-pill offline" id="context-home">Today</button></div></section>`;
    container.querySelector('#context-settings').addEventListener('click', () => go('settings', onNavigate));
    container.querySelector('#context-home').addEventListener('click', () => go('dashboard', onNavigate));
  }

  function renderLoading() {
    container.innerHTML = `<section class="mode-empty-state" aria-live="polite"><img src="assets/keepvocab-sprig-thinking.webp" alt="Sprig thinking"><span class="eyebrow"><i class="fa-solid fa-wand-magic-sparkles"></i> Gemini is writing</span><h1>Creating fresh context sentences…</h1><p>Each sentence is based on the exact meaning you saved.</p><button class="status-pill offline" id="context-cancel">Cancel</button></section>`;
    container.querySelector('#context-cancel').addEventListener('click', () => go('dashboard', onNavigate));
  }

  function renderError(error) {
    container.innerHTML = `<section class="mode-empty-state"><img src="assets/keepvocab-sprout-mascot.webp" alt="Sprig encouraging you"><span class="eyebrow">Context paused</span><h1>Gemini could not create these sentences</h1><p role="alert">${escapeHtml(error?.message || 'Check your connection and try again.')}</p><div class="mode-completion-actions"><button class="btn-green-solid" id="context-retry">Try again</button><button class="status-pill offline" id="context-settings">Check AI settings</button></div></section>`;
    container.querySelector('#context-retry').addEventListener('click', () => load(true));
    container.querySelector('#context-settings').addEventListener('click', () => go('settings', onNavigate));
  }

  async function load(force = false) {
    if (!getGeminiSettings().enabled) return renderSetup();
    renderLoading();
    try {
      contextSet = await generateContextExerciseSet(contextWords, { force, courseId });
      quizWords = contextWords.filter(word => contextSet.items.some(item => item.wordId === String(word.id)));
      if (!selectionRecorded) {
        recordModeWordSelections(driveSync, contextWords, { mode: 'context' });
        selectionRecorded = true;
      }
      current = 0;
      score = 0;
      answered = false;
      selectedId = '';
      render();
    } catch (error) {
      try {
        contextSet = buildLocalContextSet(contextWords);
        quizWords = contextWords.filter(word => contextSet.items.some(item => item.wordId === String(word.id)));
        current = 0;
        score = 0;
        answered = false;
        selectedId = '';
        render();
      } catch {
        renderError(error);
      }
    }
  }

  function render() {
    if (!contextSet) return renderLoading();
    if (current >= quizWords.length) {
      container.innerHTML = `<section class="mode-completion-card"><img src="assets/keepvocab-sprig-celebrate.webp" alt="Sprig celebrating"><span class="eyebrow">Context complete</span><h1>${score} of ${quizWords.length}</h1><p>You inferred meaning from ${contextSet.kind === 'ai' ? 'AI-generated sentences' : contextSet.kind === 'mixed' ? 'generated and saved example sentences' : 'your saved example sentences'} without definition clues.</p><div class="mode-completion-actions"><button class="btn-green-solid" id="context-again">New AI sentences</button><button class="status-pill offline" id="context-home">Today</button></div></section>`;
      container.querySelector('#context-again').addEventListener('click', () => renderContextQuizMode(container, onNavigate));
      container.querySelector('#context-home').addEventListener('click', () => go('dashboard', onNavigate));
      return;
    }

    const target = quizWords[current];
    const generatedItem = contextSet.items.find(item => item.wordId === String(target.id));
    const options = shuffle([target, ...shuffle(allWords.filter(word => word.id !== target.id && word.word !== target.word)).slice(0, 3)]);
    const cloze = clozeContextSentence(generatedItem.sentence, target.word);
    const sourceLabel = generatedItem.source === 'saved-example' ? 'Saved example fallback' : contextSet.kind === 'mixed' ? 'Resilient context set' : lithuanian ? 'AI-generated Lithuanian sentence' : 'AI-generated sentence';
    const question = lithuanian ? 'Choose the Lithuanian phrase that fits' : 'Choose the word that fits';
    container.innerHTML = `<section class="context-mode context-sentence-mode" aria-labelledby="context-heading"><header class="exercise-topbar"><button class="status-pill offline" id="context-exit"><i class="fa-solid fa-arrow-left"></i> Exit</button><div class="exercise-progress"><span>${current + 1} of ${quizWords.length}</span><i><b style="width:${Math.round((current + 1) / quizWords.length * 100)}%"></b></i></div><strong>${score} correct</strong></header>
      <article class="daily-exercise-card context-question-card"><span class="eyebrow"><i class="fa-solid fa-wand-magic-sparkles"></i> ${sourceLabel}</span><h1 id="context-heading">${question}</h1><h2 lang="${lithuanian ? 'lt' : 'en'}">“${escapeHtml(cloze)}”</h2><div class="choice-grid">${options.map(option => { const state = answered ? option.id === target.id ? ' correct' : option.id === selectedId ? ' incorrect' : '' : ''; return `<button class="choice-button${state}" data-context-word="${escapeHtml(option.id)}" ${answered ? 'disabled' : ''}>${escapeHtml(option.word)}${answered && option.id === target.id ? '<i class="fa-solid fa-check" aria-hidden="true"></i>' : answered && option.id === selectedId ? '<i class="fa-solid fa-xmark" aria-hidden="true"></i>' : ''}</button>`; }).join('')}</div>${answered ? `<div class="practice-feedback ${selectedId === target.id ? 'correct' : 'incorrect'}" role="status"><strong>${selectedId === target.id ? 'That fits the situation.' : `Answer: ${escapeHtml(target.word)}`}</strong><span>${escapeHtml(generatedItem.sentence)}</span></div><button class="btn-green-solid" id="context-next">${current + 1 === quizWords.length ? 'See results' : 'Next sentence'}</button>` : ''}</article></section>`;
    container.querySelector('#context-exit').addEventListener('click', () => go('dashboard', onNavigate));
    container.querySelectorAll('[data-context-word]').forEach(button => button.addEventListener('click', () => {
      if (answered) return;
      selectedId = button.dataset.contextWord;
      answered = true;
      const correct = evaluateChoiceAnswer(target.id, selectedId);
      if (correct) score += 1;
      recordExerciseResult({ wordId: target.id, exerciseType: 'context-cloze', correct, recallType: 'context', producedUnaided: false, confusedWithWordId: correct ? '' : selectedId });
      window.dispatchEvent(new CustomEvent('keepvocab:progress'));
      render();
    }));
    container.querySelector('#context-next')?.addEventListener('click', () => { current += 1; answered = false; selectedId = ''; render(); });
  }

  load();
}
