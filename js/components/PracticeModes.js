import { driveSync } from '../services/driveSync.js?v=86';
import { speakWord } from '../services/speechService.js?v=86';
import { recordExerciseResult } from '../services/exerciseResult.js?v=86';
import { playInteractionSound } from '../services/interactionSound.js?v=86';
import { selectPracticeWords } from '../services/dailySession.js?v=86';
import { escapeHtml } from '../utils/html.js';
import { evaluateChoiceAnswer, evaluateRecallAnswer } from '../services/exerciseEvaluation.js?v=86';

function activeLibraryWords() {
  const notebook = driveSync.getActiveNotebook();
  return driveSync.getWords().filter(word => word.notebook === notebook && word.word && word.definition);
}

function activeWords() {
  return selectPracticeWords(activeLibraryWords());
}

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

export function buildWordChoices(target, words, limit = 4) {
  const seenSpellings = new Set([target.word.toLowerCase()]);
  const alternatives = shuffle(words.filter(word => word.id !== target.id)).filter(word => {
    const spelling = word.word.toLowerCase();
    if (seenSpellings.has(spelling)) return false;
    seenSpellings.add(spelling);
    return true;
  });
  return shuffle([target, ...alternatives.slice(0, Math.max(1, limit - 1))]);
}

export function stableWordChoices(state, target, words, limit = 4) {
  if (state.targetId !== target.id) {
    state.targetId = target.id;
    state.options = buildWordChoices(target, words, limit);
  }
  return state.options;
}

function go(view, onNavigate) {
  if (window.location.hash === `#${view}`) onNavigate(view);
  else window.location.hash = view;
}

function emptyMode(container, icon, title, detail, onNavigate) {
  container.innerHTML = `<section class="full-view-stack"><div class="spec-card useful-empty-state"><i class="fa-solid ${icon}"></i><h2>${escapeHtml(title)}</h2><p>${escapeHtml(detail)}</p><button class="btn-green-solid" id="mode-back-empty">Back to dashboard</button></div></section>`;
  container.querySelector('#mode-back-empty').addEventListener('click', () => go('dashboard', onNavigate));
}

export function renderSpellingMode(container, onNavigate) {
  const queue = activeWords();
  if (!queue.length) return emptyMode(container, 'fa-keyboard', 'Add vocabulary first', 'Listen & Spell uses the words in your active month.', onNavigate);
  const originalCount = queue.length;
  let index = 0;
  let score = 0;
  let answered = false;
  let correct = false;
  let questionStartedAt = performance.now();

  function render() {
    if (index >= queue.length) {
      container.innerHTML = `<section class="full-view-stack"><div class="spec-card useful-empty-state mode-complete"><img class="mascot-result" src="assets/keepvocab-sprig-celebrate.webp" alt="Sprig celebrating"><h2>Spelling session complete</h2><p>You recalled ${score} of ${originalCount} words. Missed words will be prioritized in your next session.</p><div class="inline-actions"><button class="btn-green-solid" id="spell-again">Practice again</button><button class="status-pill offline" id="spell-dashboard">Dashboard</button></div></div></section>`;
      container.querySelector('#spell-again').addEventListener('click', () => renderSpellingMode(container, onNavigate));
      container.querySelector('#spell-dashboard').addEventListener('click', () => go('dashboard', onNavigate));
      return;
    }
    const word = queue[index];
    container.innerHTML = `
      <section class="full-view-stack"><div class="spec-card practice-shell">
        <div class="practice-topline"><button class="status-pill offline" id="spell-exit"><i class="fa-solid fa-arrow-left"></i> Dashboard</button><span>${index + 1} of ${queue.length}</span><strong>Score ${score}</strong></div>
        <div class="review-progress"><span style="width:${Math.round(index / queue.length * 100)}%"></span></div>
        <div class="practice-prompt">
          <div class="practice-icon"><i class="fa-solid fa-headphones"></i></div>
          <p>Listen, then type the word that matches this definition.</p>
          <blockquote>${escapeHtml(word.definition)}</blockquote>
          <div class="listen-controls"><button class="audio-btn-circle large" id="spell-listen" aria-label="Play word"><i class="fa-solid fa-volume-high"></i></button><button class="status-pill offline" id="spell-listen-slow"><i class="fa-solid fa-gauge-simple-low"></i> Slow</button></div>
          <p class="speech-help" id="spell-audio-status" role="status" aria-live="polite">Tap the speaker to hear the word. Use Slow to repeat it clearly.</p>
          ${answered ? `<div class="practice-feedback ${correct ? 'correct' : 'incorrect'}"><strong>${correct ? 'Correct' : `Answer: ${escapeHtml(word.word)}`}</strong><span>${correct ? 'Excellent recall.' : 'This word returns to Box 1 for another review.'}</span></div><button class="btn-green-solid" id="spell-next">${index + 1 === queue.length ? 'See result' : 'Next word'}</button>` : `<form class="practice-answer-form" id="spell-form"><input id="spell-answer" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Type the word" aria-label="Spelling answer"><button class="btn-green-solid" data-sound="none">Check</button></form>`}
        </div>
      </div></section>`;
    container.querySelector('#spell-exit').addEventListener('click', () => go('dashboard', onNavigate));
    const playWord = async (button, rate = 0.9) => {
      button.disabled = true;
      button.classList.add('playing');
      const played = await speakWord(word.word, 'en-US', rate, word.audioUrl);
      button.disabled = false;
      button.classList.remove('playing');
      if (!played) {
        const status = container.querySelector('#spell-audio-status');
        if (status) status.textContent = 'Speech is unavailable. Install or enable an English voice in this device’s speech settings.';
      }
    };
    container.querySelector('#spell-listen').addEventListener('click', event => playWord(event.currentTarget));
    container.querySelector('#spell-listen-slow').addEventListener('click', event => playWord(event.currentTarget, 0.72));
    container.querySelector('#spell-form')?.addEventListener('submit', event => {
      event.preventDefault();
      const answer = container.querySelector('#spell-answer').value.trim().toLowerCase();
      if (!answer) return;
      correct = evaluateRecallAnswer(word.word, answer);
      playInteractionSound(correct ? 'correct' : 'wrong');
      if (correct) score += 1;
      recordExerciseResult({ wordId: word.id, exerciseType: 'listen-and-spell', correct, responseTimeMs: performance.now() - questionStartedAt, hintsUsed: 0, recallType: 'listening-recall', producedUnaided: correct });
      window.dispatchEvent(new CustomEvent('keepvocab:progress'));
      answered = true;
      render();
    });
    container.querySelector('#spell-next')?.addEventListener('click', () => { index += 1; answered = false; correct = false; questionStartedAt = performance.now(); render(); });
    container.querySelector('#spell-answer')?.focus();
  }
  render();
}

export function renderChooseWordMode(container, onNavigate) {
  const all = activeLibraryWords();
  const queue = selectPracticeWords(all);
  if (queue.length < 2) return emptyMode(container, 'fa-list-check', 'Add at least two words', 'Choose Word needs another word to create meaningful choices.', onNavigate);
  const originalCount = queue.length;
  let index = 0;
  let score = 0;
  let selectedId = null;
  let questionStartedAt = performance.now();
  const choiceState = { targetId: null, options: [] };

  function render() {
    if (index >= queue.length) {
      container.innerHTML = `<section class="full-view-stack"><div class="spec-card useful-empty-state mode-complete"><img class="mascot-result" src="assets/keepvocab-sprig-celebrate.webp" alt="Sprig celebrating"><h2>Choose Word complete</h2><p>You mastered ${score} of ${originalCount} definitions. Missed meanings will come first next time.</p><div class="inline-actions"><button class="btn-green-solid" id="choose-again">Try again</button><button class="status-pill offline" id="choose-dashboard">Dashboard</button></div></div></section>`;
      container.querySelector('#choose-again').addEventListener('click', () => renderChooseWordMode(container, onNavigate));
      container.querySelector('#choose-dashboard').addEventListener('click', () => go('dashboard', onNavigate));
      return;
    }
    const target = queue[index];
    const options = stableWordChoices(choiceState, target, all);
    const answered = selectedId !== null;
    const isCorrect = evaluateChoiceAnswer(target.id, selectedId);
    container.innerHTML = `
      <section class="full-view-stack"><div class="spec-card practice-shell">
        <div class="practice-topline"><button class="status-pill offline" id="choose-exit"><i class="fa-solid fa-arrow-left"></i> Dashboard</button><span>Choose Word · ${index + 1} of ${queue.length}</span><strong>Score ${score}</strong></div>
        <div class="review-progress"><span style="width:${Math.round(index / queue.length * 100)}%"></span></div>
        <div class="practice-prompt choose-prompt">
          <img class="practice-mascot" src="assets/keepvocab-sprig-thinking.webp" alt="" aria-hidden="true">
          <p>Which word matches this definition?</p>
          <blockquote>${escapeHtml(target.definition)}</blockquote>
          <div class="choice-grid">${options.map(option => {
            const state = answered ? option.id === target.id ? ' correct' : option.id === selectedId ? ' incorrect' : '' : '';
            const icon = answered && option.id === target.id ? '<i class="fa-solid fa-check choice-result-icon" aria-hidden="true"></i>' : answered && option.id === selectedId ? '<i class="fa-solid fa-xmark choice-result-icon" aria-hidden="true"></i>' : '';
            return `<button class="choice-button${state}" data-choice="${escapeHtml(option.id)}" data-sound="none" ${answered ? 'disabled' : ''}><span>${escapeHtml(option.word)}</span>${icon}</button>`;
          }).join('')}</div>
          <div class="answer-feedback-slot" aria-live="polite">${answered ? `${isCorrect ? '<span class="success-burst" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>' : ''}<div class="answer-feedback-card ${isCorrect ? 'correct' : 'incorrect'}"><i class="fa-solid ${isCorrect ? 'fa-check' : 'fa-xmark'} answer-feedback-icon" aria-hidden="true"></i><div><strong>${isCorrect ? 'Excellent!' : 'Not quite'}</strong><span>${isCorrect ? escapeHtml(target.example || 'You matched the meaning.') : `The correct answer is <b>${escapeHtml(target.word)}</b>. ${escapeHtml(target.example || '')}`}</span></div></div>` : ''}</div>
          <div class="answer-action-slot">${answered ? `<button class="btn-green-solid" id="choose-next">${index + 1 === queue.length ? 'See result' : 'Next question'}</button>` : ''}</div>
        </div>
      </div></section>`;
    container.querySelector('#choose-exit').addEventListener('click', () => go('dashboard', onNavigate));
    container.querySelectorAll('[data-choice]').forEach(button => button.addEventListener('click', () => {
      selectedId = button.dataset.choice;
      const correct = evaluateChoiceAnswer(target.id, selectedId);
      playInteractionSound(correct ? 'correct' : 'wrong');
      if (correct) score += 1;
      recordExerciseResult({ wordId: target.id, exerciseType: 'choose-word', correct, responseTimeMs: performance.now() - questionStartedAt, hintsUsed: 0, recallType: 'recognition', producedUnaided: false, confusedWithWordId: correct ? '' : selectedId });
      window.dispatchEvent(new CustomEvent('keepvocab:progress'));
      render();
    }));
    container.querySelector('#choose-next')?.addEventListener('click', () => { index += 1; selectedId = null; questionStartedAt = performance.now(); choiceState.targetId = null; render(); });
  }
  render();
}

export const renderDefinitionChallenge = renderChooseWordMode;
