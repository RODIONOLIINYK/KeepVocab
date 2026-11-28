import { definitionForLearning, exampleForLearning } from '../services/learningDefinitions.js?v=18908';
import { isUkrainianTranslationEnabled } from '../services/translationSettings.js?v=18908';
import { driveSync } from '../services/driveSync.js?v=18908';
import { preloadAudioUrl, speakWord } from '../services/speechService.js?v=18912';
import { recordExerciseResult } from '../services/exerciseResult.js?v=18908';
import { playInteractionSound } from '../services/interactionSound.js?v=18908';
import { selectPracticeWords } from '../services/dailySession.js?v=18908';
import { escapeHtml } from '../utils/html.js';
import { evaluateChoiceAnswer, evaluateRecallAnswer } from '../services/exerciseEvaluation.js?v=18908';
import { getActivePracticeWords, ensureDailyStudyPlan, recordModeWordSelections } from '../services/wordSelection.js?v=18908';
import { stableWordChoices } from '../services/wordChoices.js?v=18908';
import { renderPracticeFrame, renderPracticeHeader, renderChoiceGrid, renderAnswerFeedback, focusPracticeInput, renderPracticeMascot, renderVoiceWave, bindTalkingMascot, comboShellClasses } from './PracticeElements.js?v=18915';
import { showComboCelebration } from './ComboCelebration.js?v=18917';
import { navigateTo as go } from '../utils/navigation.js';

function emptyMode(container, icon, title, detail, onNavigate) {
  container.innerHTML = `<section class="full-view-stack"><div class="spec-card useful-empty-state"><i class="fa-solid ${icon}"></i><h2>${escapeHtml(title)}</h2><p>${escapeHtml(detail)}</p><button class="btn-green-solid" id="mode-back-empty">Back to dashboard</button></div></section>`;
  container.querySelector('#mode-back-empty').addEventListener('click', () => go('dashboard', onNavigate));
}

export function renderSpellingMode(container, onNavigate) {
  const all = getActivePracticeWords(driveSync);
  const settings = ensureDailyStudyPlan(driveSync);
  const queue = selectPracticeWords(all, { mode: 'listen-and-spell', settings, useDailyPlan: true, allowCompletedPlanWords: true });
  if (!queue.length) return emptyMode(container, 'fa-keyboard', all.length ? 'All caught up' : 'Add vocabulary first', all.length ? 'Your words are resting until their next review. Recent recall and mistakes determine when they return.' : 'Listen & Spell uses the words in your active month.', onNavigate);
  recordModeWordSelections(driveSync, queue, { mode: 'listen-and-spell' });
  const originalCount = queue.length;
  let index = 0;
  let score = 0;
  let combo = 0;
  let answered = false;
  let correct = false;
  let questionStartedAt = performance.now();

  function render(focusInput = false) {
    if (index >= queue.length) {
      container.innerHTML = `<section class="full-view-stack"><div class="spec-card useful-empty-state mode-complete practice-completion"><img class="mascot-result" src="assets/keepvocab-sprig-celebrate.webp" alt="Sprig celebrating"><h2>Spelling session complete</h2><p>You recalled ${score} of ${originalCount} words. Missed words will be prioritized in your next session.</p><div class="inline-actions"><button class="btn-green-solid" id="spell-again">Practice again</button><button class="status-pill offline" id="spell-dashboard">Dashboard</button></div></div></section>`;
      container.querySelector('#spell-again').addEventListener('click', () => renderSpellingMode(container, onNavigate));
      container.querySelector('#spell-dashboard').addEventListener('click', () => go('dashboard', onNavigate));
      return;
    }
    const word = queue[index];
    preloadAudioUrl(word.audioUrl);
    renderPracticeFrame(container, `
      <section class="full-view-stack"><div class="spec-card practice-shell${comboShellClasses(combo)}">
        ${renderPracticeHeader({ exitId: 'spell-exit', label: '', current: index, total: queue.length, score, answered })}
        <div class="practice-prompt">
          ${renderPracticeMascot({
            heading: 'Type what you hear',
            bubbleHtml: `<div class="duo-bubble-audio"><button type="button" class="audio-btn-circle" id="spell-listen" aria-label="Play word"><i class="fa-solid fa-volume-high"></i></button>${renderVoiceWave()}<button type="button" class="status-pill offline" id="spell-listen-slow" data-sound="none"><i class="fa-solid fa-gauge-simple"></i> Slow</button></div><blockquote class="duo-bubble-quote">${escapeHtml(definitionForLearning(word))}</blockquote>${isUkrainianTranslationEnabled() && word.translationLanguage === 'uk' && word.translation ? `<p class="word-translation" lang="uk">${escapeHtml(word.translation)}</p>` : ''}`,
            answered,
            correct,
            combo,
            talking: true
          })}
          <p class="speech-help" id="spell-audio-status" role="status" aria-live="polite"></p>
          ${answered ? `<aside class="practice-answer-tray ${correct ? 'correct' : 'incorrect'}"><div class="practice-feedback ${correct ? 'correct' : 'incorrect'}" role="status"><strong>${correct ? 'Correct' : `Answer: ${escapeHtml(word.word)}`}</strong><span>${correct ? 'Excellent recall.' : 'This word will return sooner for another review.'}</span></div><button class="btn-green-solid" id="spell-next" data-practice-continue>${index + 1 === queue.length ? 'See result' : 'Next word'}</button></aside>` : `<form class="practice-answer-form" id="spell-form"><input id="spell-answer" lang="en" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" enterkeyhint="done" placeholder="Type the word" aria-label="Spelling answer"><button class="btn-green-solid" data-sound="none">Check</button></form>`}
        </div>
      </div></section>`, { key: `spell:${index}`, result: answered ? (correct ? 'correct' : 'incorrect') : '' });
    container.querySelector('#spell-exit').addEventListener('click', () => go('dashboard', onNavigate));
    const playWord = async (button, rate = 0.95) => {
      if (button) {
        button.disabled = true;
        button.classList.add('playing');
      }
      const played = await speakWord(word.word, 'en-US', rate, word.audioUrl);
      if (button) {
        button.disabled = false;
        button.classList.remove('playing');
      }
      if (!played) {
        const status = container.querySelector('#spell-audio-status');
        if (status) status.textContent = 'Speech is unavailable. Install or enable an English voice in this device’s speech settings.';
      }
    };
    const listenButton = container.querySelector('#spell-listen');
    listenButton.addEventListener('click', event => playWord(event.currentTarget, 0.95));
    container.querySelector('#spell-listen-slow').addEventListener('click', event => playWord(event.currentTarget, 0.72));
    bindTalkingMascot(container, () => playWord(listenButton, 0.95));
    container.querySelector('#spell-form')?.addEventListener('submit', event => {
      event.preventDefault();
      const answer = container.querySelector('#spell-answer').value.trim().toLowerCase();
      if (!answer) return;
      correct = evaluateRecallAnswer(word.word, answer);
      if (correct) { score += 1; combo += 1; } else { combo = 0; }
      if (!correct || !showComboCelebration(combo)) {
        playInteractionSound(correct ? 'correct' : 'wrong', { combo });
      }
      recordExerciseResult({ wordId: word.id, exerciseType: 'listen-and-spell', correct, responseTimeMs: performance.now() - questionStartedAt, hintsUsed: 0, recallType: 'listening-recall', producedUnaided: correct });
      window.dispatchEvent(new CustomEvent('keepvocab:progress'));
      answered = true;
      render();
    });
    container.querySelector('#spell-next')?.addEventListener('click', () => { index += 1; answered = false; correct = false; questionStartedAt = performance.now(); render(true); });
    focusPracticeInput(container.querySelector('#spell-answer'), { allowTouch: focusInput });
  }
  render();
}

export function renderChooseWordMode(container, onNavigate) {
  const all = getActivePracticeWords(driveSync);
  const settings = ensureDailyStudyPlan(driveSync);
  const queue = selectPracticeWords(all, { mode: 'choose-word', settings, useDailyPlan: true, allowCompletedPlanWords: true, minWords: 2 });
  if (new Set(all.map(word => word.word.toLowerCase())).size < 2) return emptyMode(container, 'fa-list-check', 'Add at least two words', 'Choose Word needs another word to create meaningful choices.', onNavigate);
  if (!queue.length) return emptyMode(container, 'fa-list-check', 'All caught up', 'Your words are resting until their next review. Recently recalled meanings stay out of the next set.', onNavigate);
  recordModeWordSelections(driveSync, queue, { mode: 'choose-word' });
  const originalCount = queue.length;
  let index = 0;
  let score = 0;
  let combo = 0;
  let selectedId = null;
  let questionStartedAt = performance.now();
  const choiceState = { targetId: null, options: [] };

  function render() {
    if (index >= queue.length) {
      container.innerHTML = `<section class="full-view-stack"><div class="spec-card useful-empty-state mode-complete practice-completion"><img class="mascot-result" src="assets/keepvocab-sprig-celebrate.webp" alt="Sprig celebrating"><h2>Choose Word complete</h2><p>You mastered ${score} of ${originalCount} definitions. Missed meanings will come first next time.</p><div class="inline-actions"><button class="btn-green-solid" id="choose-again">Try again</button><button class="status-pill offline" id="choose-dashboard">Dashboard</button></div></div></section>`;
      container.querySelector('#choose-again').addEventListener('click', () => renderChooseWordMode(container, onNavigate));
      container.querySelector('#choose-dashboard').addEventListener('click', () => go('dashboard', onNavigate));
      return;
    }
    const target = queue[index];
    const options = stableWordChoices(choiceState, target, all);
    const answered = selectedId !== null;
    const isCorrect = evaluateChoiceAnswer(target.id, selectedId);
    renderPracticeFrame(container, `
      <section class="full-view-stack"><div class="spec-card practice-shell${comboShellClasses(combo)}">
        ${renderPracticeHeader({ exitId: 'choose-exit', label: 'Choose Word', current: index, total: queue.length, score, answered })}
        <div class="practice-prompt choose-prompt">
          ${renderPracticeMascot({
            heading: 'Pick the matching word',
            bubbleHtml: `<blockquote class="duo-bubble-quote">${escapeHtml(definitionForLearning(target))}</blockquote>${isUkrainianTranslationEnabled() && target.translationLanguage === 'uk' && target.translation ? `<p class="word-translation" lang="uk">${escapeHtml(target.translation)}</p>` : ''}`,
            answered,
            correct: isCorrect,
            combo
          })}
          ${renderChoiceGrid({ options, targetId: target.id, selectedId })}
          ${renderAnswerFeedback({ answered, correct: isCorrect, answer: target.word, detail: exampleForLearning(target) || '', nextId: 'choose-next', nextLabel: index + 1 === queue.length ? 'See result' : 'Next question' })}
        </div>
      </div></section>`, { key: `choose:${index}`, result: answered ? (isCorrect ? 'correct' : 'incorrect') : '' });
    container.querySelector('#choose-exit').addEventListener('click', () => go('dashboard', onNavigate));
    container.querySelectorAll('[data-choice]').forEach(button => button.addEventListener('click', () => {
      if (selectedId !== null) return;
      selectedId = button.dataset.choice;
      const correct = evaluateChoiceAnswer(target.id, selectedId);
      if (correct) { score += 1; combo += 1; } else { combo = 0; }
      if (!correct || !showComboCelebration(combo)) {
        playInteractionSound(correct ? 'correct' : 'wrong', { combo });
      }
      recordExerciseResult({ wordId: target.id, exerciseType: 'choose-word', correct, responseTimeMs: performance.now() - questionStartedAt, hintsUsed: 0, recallType: 'recognition', producedUnaided: false, confusedWithWordId: correct ? '' : selectedId });
      window.dispatchEvent(new CustomEvent('keepvocab:progress'));
      render();
    }));
    container.querySelector('#choose-next')?.addEventListener('click', () => { index += 1; selectedId = null; questionStartedAt = performance.now(); choiceState.targetId = null; render(); });
  }
  render();
}
