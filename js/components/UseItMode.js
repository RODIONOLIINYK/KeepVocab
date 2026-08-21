import { driveSync } from '../services/driveSync.js?v=90';
import { recordExerciseResult } from '../services/exerciseResult.js?v=90';
import { recordModeWordSelections, selectModeWords } from '../services/wordSelection.js?v=90';
import { playInteractionSound } from '../services/interactionSound.js?v=90';
import { mountUseItExercise } from './UseItExercise.js?v=90';
import { navigateTo as go } from '../utils/navigation.js';

export { evaluateUseItFallback, evaluateUseItSentence } from '../services/useItEvaluation.js?v=90';

export function renderUseItMode(container, onNavigate) {
  const notebook = driveSync.getActiveNotebook();
  const words = selectModeWords(driveSync.getWords().filter(word => word.notebook === notebook), { mode: 'use-it', limit: 10 });
  if (!words.length) {
    container.innerHTML = `<section class="full-view-stack"><div class="spec-card useful-empty-state"><img class="mascot-result" src="assets/keepvocab-sprout-mascot.webp" alt="Sprig"><h2>Add vocabulary first</h2><p>Use It turns saved meanings into active English.</p><button class="btn-green-solid" id="useit-back">Back to Today</button></div></section>`;
    container.querySelector('#useit-back').addEventListener('click', () => go('dashboard', onNavigate));
    return;
  }
  recordModeWordSelections(driveSync, words, { mode: 'use-it' });

  let index = 0;
  let startedAt = performance.now();
  let exerciseController = null;

  function render() {
    exerciseController?.destroy();
    const word = words[index];
    container.innerHTML = `<section class="full-view-stack"><div class="spec-card use-it-shell"><div class="practice-topline"><button class="status-pill offline" id="useit-exit"><i class="fa-solid fa-arrow-left"></i> Today</button><span>Use It · ${index + 1} of ${words.length}</span><strong>Active production</strong></div><div class="review-progress"><span style="width:${Math.round(index / words.length * 100)}%"></span></div><div id="useit-exercise-root"></div></div></section>`;
    container.querySelector('#useit-exit').addEventListener('click', () => {
      exerciseController?.destroy();
      go('dashboard', onNavigate);
    });
    exerciseController = mountUseItExercise(container.querySelector('#useit-exercise-root'), {
      word,
      nextLabel: index + 1 >= words.length ? 'Finish' : 'Next word',
      onEvaluated(result, sentence) {
        recordExerciseResult({ wordId: word.id, exerciseType: 'use-it', correct: result.correct, responseTimeMs: performance.now() - startedAt, hintsUsed: 0, recallType: 'productive', producedUnaided: true, learnerResponse: sentence });
        window.dispatchEvent(new CustomEvent('keepvocab:progress'));
        playInteractionSound(result.correct ? 'correct' : 'wrong');
      },
      onNext() {
        if (index + 1 >= words.length) {
          exerciseController?.destroy();
          go('dashboard', onNavigate);
          return;
        }
        index += 1;
        startedAt = performance.now();
        render();
      }
    });
  }

  render();
}
