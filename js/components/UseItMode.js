import { driveSync } from '../services/driveSync.js?v=18908';
import { recordExerciseResult } from '../services/exerciseResult.js?v=18908';
import { getActivePracticeWords, ensureDailyStudyPlan, recordModeWordSelections, selectModeWords } from '../services/wordSelection.js?v=18908';
import { playInteractionSound } from '../services/interactionSound.js?v=18908';
import { mountUseItExercise } from './UseItExercise.js?v=18908';
import { renderPracticeFrame, renderPracticeHeader, updatePracticeProgress, comboShellClasses } from './PracticeElements.js?v=18915';
import { showComboCelebration } from './ComboCelebration.js?v=18917';
import { createSpeechRecordingSession } from '../services/speechInput.js?v=18908';
import { navigateTo as go } from '../utils/navigation.js';

export { evaluateUseItFallback, evaluateUseItSentence } from '../services/useItEvaluation.js?v=18908';

let activeSpeechSession = null;

export function teardownUseItMode() {
  activeSpeechSession?.close();
  activeSpeechSession = null;
}

export function renderUseItMode(container, onNavigate) {
  teardownUseItMode();
  const allWords = getActivePracticeWords(driveSync);
  const settings = ensureDailyStudyPlan(driveSync);
  const words = selectModeWords(allWords, { mode: 'use-it', limit: 10, settings, useDailyPlan: true, allowCompletedPlanWords: true });
  if (!words.length) {
    container.innerHTML = `<section class="full-view-stack"><div class="spec-card useful-empty-state"><img class="mascot-result" src="assets/keepvocab-sprout-mascot.webp" alt="Sprig"><h2>${allWords.length ? 'All caught up' : 'Add vocabulary first'}</h2><p>${allWords.length ? 'Your words are resting until their next review. Recall history keeps recently remembered words out of the next set.' : 'Use It turns saved meanings into active English.'}</p><button class="btn-green-solid" id="useit-back">Back to Today</button></div></section>`;
    container.querySelector('#useit-back').addEventListener('click', () => go('dashboard', onNavigate));
    return;
  }
  activeSpeechSession = createSpeechRecordingSession();
  const speechSession = activeSpeechSession;
  recordModeWordSelections(driveSync, words, { mode: 'use-it' });

  let index = 0;
  let score = 0;
  let combo = 0;
  let startedAt = performance.now();
  let exerciseController = null;

  function render(focusInput = false) {
    exerciseController?.destroy();
    const word = words[index];
    renderPracticeFrame(container, `<section class="full-view-stack"><div class="spec-card use-it-shell${comboShellClasses(combo)}">${renderPracticeHeader({ exitId: 'useit-exit', label: 'Use It', current: index, total: words.length, score })}<div id="useit-exercise-root"></div></div></section>`, { key: `useit:${index}` });
    container.querySelector('#useit-exit').addEventListener('click', () => {
      exerciseController?.destroy();
      teardownUseItMode();
      go('dashboard', onNavigate);
    });
    const exerciseRoot = container.querySelector('#useit-exercise-root');
    exerciseController = mountUseItExercise(exerciseRoot, {
      word,
      focusInput,
      speechSession,
      getCombo: () => combo,
      nextLabel: index + 1 >= words.length ? 'Finish' : 'Next word',
      onEvaluated(result, sentence) {
        if (result.correct) { score += 1; combo += 1; } else combo = 0;
        const shell = exerciseRoot.parentElement;
        shell?.classList.toggle('is-hot-combo', combo >= 3);
        const rail = shell?.querySelector('.review-progress');
        if (rail) updatePracticeProgress(rail, index + 1, words.length);
        recordExerciseResult({ wordId: word.id, exerciseType: 'use-it', correct: result.correct, responseTimeMs: performance.now() - startedAt, hintsUsed: 0, recallType: 'productive', producedUnaided: true, learnerResponse: sentence });
        window.dispatchEvent(new CustomEvent('keepvocab:progress'));
        if (!result.correct || !showComboCelebration(combo)) {
          playInteractionSound(result.correct ? 'correct' : 'wrong', { combo });
        }
      },
      onNext() {
        if (index + 1 >= words.length) {
          exerciseController?.destroy();
          teardownUseItMode();
          go('dashboard', onNavigate);
          return;
        }
        index += 1;
        startedAt = performance.now();
        render(true);
      }
    });
  }

  render();
}
