import { driveSync } from '../services/driveSync.js?v=33';
import { speakWord } from '../services/speechService.js';
import { updateWordRepetition } from '../services/srsEngine.js?v=33';
import { escapeHtml } from '../utils/html.js';

function activeWords() {
  const notebook = driveSync.getActiveNotebook();
  return driveSync.getWords().filter(word => word.notebook === notebook && word.word && word.definition);
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
  const queue = shuffle(activeWords());
  if (!queue.length) return emptyMode(container, 'fa-keyboard', 'Add vocabulary first', 'Listen & Spell uses the words in your active month.', onNavigate);
  const originalCount = queue.length;
  const retried = new Set();
  let index = 0;
  let score = 0;
  let answered = false;
  let correct = false;

  function render() {
    if (index >= queue.length) {
      container.innerHTML = `<section class="full-view-stack"><div class="spec-card useful-empty-state"><i class="fa-solid fa-bolt"></i><h2>Spelling session complete</h2><p>You recalled ${score} of ${originalCount} words. Missed words were repeated once at the end.</p><div class="inline-actions"><button class="btn-green-solid" id="spell-again">Practice again</button><button class="status-pill offline" id="spell-dashboard">Dashboard</button></div></div></section>`;
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
          ${answered ? `<div class="practice-feedback ${correct ? 'correct' : 'incorrect'}"><strong>${correct ? 'Correct' : `Answer: ${escapeHtml(word.word)}`}</strong><span>${correct ? 'Excellent recall.' : 'This word returns to Box 1 for another review.'}</span></div><button class="btn-green-solid" id="spell-next">${index + 1 === queue.length ? 'See result' : 'Next word'}</button>` : `<form class="practice-answer-form" id="spell-form"><input id="spell-answer" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Type the word" aria-label="Spelling answer"><button class="btn-green-solid">Check</button></form>`}
        </div>
      </div></section>`;
    container.querySelector('#spell-exit').addEventListener('click', () => go('dashboard', onNavigate));
    container.querySelector('#spell-listen').addEventListener('click', () => speakWord(word.word));
    container.querySelector('#spell-listen-slow').addEventListener('click', () => speakWord(word.word, 'en-US', 0.72));
    container.querySelector('#spell-form')?.addEventListener('submit', event => {
      event.preventDefault();
      const answer = container.querySelector('#spell-answer').value.trim().toLowerCase();
      if (!answer) return;
      correct = answer === word.word.toLowerCase();
      if (correct) score += 1;
      if (!correct && !retried.has(word.id)) { retried.add(word.id); queue.push(word); }
      updateWordRepetition(word.id, correct ? 'easy' : 'again');
      window.dispatchEvent(new CustomEvent('keepvocab:progress'));
      answered = true;
      render();
    });
    container.querySelector('#spell-next')?.addEventListener('click', () => { index += 1; answered = false; correct = false; render(); });
    container.querySelector('#spell-answer')?.focus();
  }
  render();
}

export function renderChooseWordMode(container, onNavigate) {
  const all = activeWords();
  if (all.length < 2) return emptyMode(container, 'fa-list-check', 'Add at least two words', 'Choose Word needs another word to create meaningful choices.', onNavigate);
  const queue = shuffle(all);
  const originalCount = queue.length;
  const retried = new Set();
  let index = 0;
  let score = 0;
  let selectedId = null;
  const choiceState = { targetId: null, options: [] };

  function render() {
    if (index >= queue.length) {
      container.innerHTML = `<section class="full-view-stack"><div class="spec-card useful-empty-state mode-complete"><i class="fa-solid fa-trophy"></i><h2>Choose Word complete</h2><p>You mastered ${score} of ${originalCount} definitions. Missed choices were repeated once.</p><div class="inline-actions"><button class="btn-green-solid" id="choose-again">Try again</button><button class="status-pill offline" id="choose-dashboard">Dashboard</button></div></div></section>`;
      container.querySelector('#choose-again').addEventListener('click', () => renderChooseWordMode(container, onNavigate));
      container.querySelector('#choose-dashboard').addEventListener('click', () => go('dashboard', onNavigate));
      return;
    }
    const target = queue[index];
    const options = stableWordChoices(choiceState, target, all);
    const answered = selectedId !== null;
    const isCorrect = selectedId === target.id;
    container.innerHTML = `
      <section class="full-view-stack"><div class="spec-card practice-shell">
        <div class="practice-topline"><button class="status-pill offline" id="choose-exit"><i class="fa-solid fa-arrow-left"></i> Dashboard</button><span>Choose Word · ${index + 1} of ${queue.length}</span><strong>Score ${score}</strong></div>
        <div class="review-progress"><span style="width:${Math.round(index / queue.length * 100)}%"></span></div>
        <div class="practice-prompt choose-prompt">
          <div class="practice-icon purple"><i class="fa-solid fa-list-check"></i></div>
          <p>Which word matches this definition?</p>
          <blockquote>${escapeHtml(target.definition)}</blockquote>
          <div class="choice-grid">${options.map(option => {
            const state = answered ? option.id === target.id ? ' correct' : option.id === selectedId ? ' incorrect' : '' : '';
            const icon = answered && option.id === target.id ? '<i class="fa-solid fa-check choice-result-icon" aria-hidden="true"></i>' : answered && option.id === selectedId ? '<i class="fa-solid fa-xmark choice-result-icon" aria-hidden="true"></i>' : '';
            return `<button class="choice-button${state}" data-choice="${escapeHtml(option.id)}" ${answered ? 'disabled' : ''}><span>${escapeHtml(option.word)}</span>${icon}</button>`;
          }).join('')}</div>
          <div class="answer-feedback-slot" aria-live="polite">${answered ? `${isCorrect ? '<span class="success-burst" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>' : ''}<div class="answer-feedback-card ${isCorrect ? 'correct' : 'incorrect'}"><i class="fa-solid ${isCorrect ? 'fa-check' : 'fa-xmark'} answer-feedback-icon" aria-hidden="true"></i><div><strong>${isCorrect ? 'Excellent!' : 'Not quite'}</strong><span>${isCorrect ? escapeHtml(target.example || 'You matched the meaning.') : `The correct answer is <b>${escapeHtml(target.word)}</b>. ${escapeHtml(target.example || '')}`}</span></div></div>` : ''}</div>
          <div class="answer-action-slot">${answered ? `<button class="btn-green-solid" id="choose-next">${index + 1 === queue.length ? 'See result' : 'Next question'}</button>` : ''}</div>
        </div>
      </div></section>`;
    container.querySelector('#choose-exit').addEventListener('click', () => go('dashboard', onNavigate));
    container.querySelectorAll('[data-choice]').forEach(button => button.addEventListener('click', () => {
      selectedId = button.dataset.choice;
      const correct = selectedId === target.id;
      if (correct) score += 1;
      if (!correct && !retried.has(target.id)) { retried.add(target.id); queue.push(target); }
      updateWordRepetition(target.id, correct ? 'good' : 'again');
      window.dispatchEvent(new CustomEvent('keepvocab:progress'));
      render();
    }));
    container.querySelector('#choose-next')?.addEventListener('click', () => { index += 1; selectedId = null; choiceState.targetId = null; render(); });
  }
  render();
}

export const renderDefinitionChallenge = renderChooseWordMode;
