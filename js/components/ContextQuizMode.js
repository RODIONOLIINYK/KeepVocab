import { driveSync } from '../services/driveSync.js?v=18900';
import { recordExerciseResult } from '../services/exerciseResult.js?v=18900';
import { getGeminiSettings } from '../services/geminiSettings.js?v=18900';
import { buildLocalContextSet, clozeContextSentence, generateContextExerciseSet } from '../services/contextExercises.js?v=18900';
import { escapeHtml } from '../utils/html.js';
import { evaluateChoiceAnswer } from '../services/exerciseEvaluation.js?v=18900';
import { DEFAULT_SESSION_SIZE } from '../services/dailySession.js?v=18900';
import { getActivePracticeWords, ensureDailyStudyPlan, recordModeWordSelections, selectModeWords } from '../services/wordSelection.js?v=18900';
import { stableWordChoices } from '../services/wordChoices.js?v=18900';
import { playInteractionSound } from '../services/interactionSound.js?v=18900';
import { renderPracticeHeader, renderChoiceGrid, renderAnswerFeedback, renderPracticeNotice } from './PracticeElements.js?v=18900';
import { navigateTo as go } from '../utils/navigation.js';

export function selectContextWords(words, limit = DEFAULT_SESSION_SIZE, now = new Date(), settings = null) {
  return selectModeWords(words, {
    mode: 'context',
    limit,
    now,
    ...(settings ? { settings, useDailyPlan: true, allowCompletedPlanWords: true, minWords: 3 } : {})
  });
}

export function renderContextQuizMode(container, onNavigate) {
  const allWords = getActivePracticeWords(driveSync);
  const courseId = driveSync.getActiveCourseId();
  const currentSettings = ensureDailyStudyPlan(driveSync);
  const contextWords = selectContextWords(allWords, DEFAULT_SESSION_SIZE, new Date(), currentSettings);
  const dashboard = () => go('dashboard', onNavigate);
  const settings = () => go('settings', onNavigate);

  function notice(title, detail, actions, options = {}) {
    container.innerHTML = renderPracticeNotice({ title, detail, actions, ...options });
    actions.forEach(action => container.querySelector(`#${action.id}`).addEventListener('click', action.run));
  }

  if (contextWords.length < 3) {
    const hasVocabulary = new Set(allWords.map(word => word.word.toLowerCase())).size >= 3;
    notice(hasVocabulary ? 'Fewer than 3 words ready' : 'Add 3 different words to this month', hasVocabulary ? 'Context needs three words ready for review. Recently recalled words are resting; you can practice the remaining words in Practice.' : 'Context uses the month selected in Library. Add vocabulary or choose a month with at least three words.', [
      ...(hasVocabulary ? [{ id: 'context-practice', label: 'Practice ready words', run: () => go('review', onNavigate) }] : []),
      { id: 'context-library', label: 'Open library', run: () => go('library', onNavigate) },
      { id: 'context-home', label: 'Dashboard', secondary: true, run: dashboard }
    ]);
    return;
  }

  let contextSet = null;
  let quizWords = [];
  let current = 0;
  let score = 0;
  let selectedId = null;
  let questionStartedAt = 0;
  const choiceState = { targetId: null, options: [] };

  async function load(force = false) {
    if (!getGeminiSettings().enabled) {
      notice('Connect Gemini to create Context sentences', 'Create fresh sentences from the exact meanings saved in your selected month. Definitions stay hidden while you answer.', [
        { id: 'context-settings', label: 'Set up Google AI Studio', run: settings },
        { id: 'context-home', label: 'Dashboard', secondary: true, run: dashboard }
      ]);
      return;
    }
    notice('Creating fresh context sentences…', 'Each sentence is based on an exact meaning from your selected month.', [
      { id: 'context-cancel', label: 'Cancel', secondary: true, run: dashboard }
    ], { loading: true });
    const loadingView = container.firstElementChild;
    try {
      contextSet = await generateContextExerciseSet(contextWords, { force, courseId });
    } catch (error) {
      if (!container.contains(loadingView)) return;
      try {
        contextSet = buildLocalContextSet(contextWords);
      } catch {
        notice('Could not create these sentences', error?.message || 'Check your connection and try again.', [
          { id: 'context-retry', label: 'Try again', run: () => load(true) },
          { id: 'context-settings', label: 'Check AI settings', secondary: true, run: settings }
        ]);
        return;
      }
    }
    // A response arriving after Cancel or navigation must not replace the next view.
    if (!container.contains(loadingView)) return;
    quizWords = contextWords.filter(word => contextSet.items.some(item => item.wordId === String(word.id)));
    recordModeWordSelections(driveSync, quizWords, { mode: 'context' });
    questionStartedAt = performance.now();
    render();
  }

  function render() {
    if (current >= quizWords.length) {
      notice('Context complete', `You completed ${score} of ${quizWords.length} sentences correctly. Missed words will be prioritized in your next session.`, [
        { id: 'context-again', label: 'Practice again', run: () => renderContextQuizMode(container, onNavigate) },
        { id: 'context-home', label: 'Dashboard', secondary: true, run: dashboard }
      ], { complete: true });
      return;
    }

    const target = quizWords[current];
    const generatedItem = contextSet.items.find(item => item.wordId === String(target.id));
    const options = stableWordChoices(choiceState, target, allWords);
    const answered = selectedId !== null;
    const correct = evaluateChoiceAnswer(target.id, selectedId);
    const cloze = clozeContextSentence(generatedItem.sentence, target.word);
    const sourceLabel = generatedItem.source === 'saved-example' ? 'Saved example' : 'AI-generated sentence';
    container.innerHTML = `<section class="full-view-stack"><div class="spec-card practice-shell">
      ${renderPracticeHeader({ exitId: 'context-exit', label: 'Context', current, total: quizWords.length, score })}
      <div class="practice-prompt choose-prompt">
        <img class="practice-mascot" src="assets/keepvocab-sprig-thinking.webp" alt="" aria-hidden="true">
        <p>${'Choose the word that fits this sentence.'}</p>
        <blockquote lang="${'en'}">${escapeHtml(cloze)}</blockquote>
        <span class="muted-label">${sourceLabel}</span>
        ${renderChoiceGrid({ options, targetId: target.id, selectedId, attribute: 'data-context-word' })}
        ${renderAnswerFeedback({ answered, correct, answer: target.word, detail: generatedItem.sentence, nextId: 'context-next', nextLabel: current + 1 === quizWords.length ? 'See results' : 'Next sentence' })}
      </div>
    </div></section>`;
    container.querySelector('#context-exit').addEventListener('click', dashboard);
    container.querySelectorAll('[data-context-word]').forEach(button => button.addEventListener('click', () => {
      if (selectedId !== null) return;
      selectedId = button.dataset.contextWord;
      const isCorrect = evaluateChoiceAnswer(target.id, selectedId);
      playInteractionSound(isCorrect ? 'correct' : 'wrong');
      if (isCorrect) score += 1;
      recordExerciseResult({ wordId: target.id, exerciseType: 'context-cloze', correct: isCorrect, responseTimeMs: performance.now() - questionStartedAt, recallType: 'context', producedUnaided: false, confusedWithWordId: isCorrect ? '' : selectedId });
      window.dispatchEvent(new CustomEvent('keepvocab:progress'));
      render();
      container.querySelector('#context-next')?.focus({ preventScroll: true });
    }));
    container.querySelector('#context-next')?.addEventListener('click', () => {
      current += 1;
      selectedId = null;
      questionStartedAt = performance.now();
      render();
      container.querySelector('[data-context-word]')?.focus({ preventScroll: true });
    });
  }

  load();
}
