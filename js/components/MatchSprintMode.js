import { driveSync } from '../services/driveSync.js?v=79';
import { recordExerciseResult } from '../services/exerciseResult.js?v=79';
import { playInteractionSound } from '../services/interactionSound.js?v=79';
import { escapeHtml } from '../utils/html.js';
import { selectPracticeWords } from '../services/dailySession.js?v=79';

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function go(view, onNavigate) {
  if (window.location.hash === `#${view}`) onNavigate(view); else window.location.hash = view;
}

function buildRound(words) {
  return shuffle(selectPracticeWords(words, { limit: 6 }));
}

export function getUnmatchedWords(items, matchedIds) {
  return items.filter(word => !matchedIds.has(word.id));
}

export function renderMatchSprintMode(container, onNavigate) {
  const notebook = driveSync.getActiveNotebook();
  const allWords = driveSync.getWords().filter(word => word.notebook === notebook && word.word && word.definition);
  const round = buildRound(allWords);
  if (round.length < 2) {
    container.innerHTML = `<section class="full-view-stack"><div class="spec-card useful-empty-state"><i class="fa-solid fa-stopwatch"></i><h2>Add two different words</h2><p>Match Sprint pairs exact meanings with spellings, so a round needs at least two different words in the active month.</p><button class="btn-green-solid" id="match-back">Back to dashboard</button></div></section>`;
    container.querySelector('#match-back').addEventListener('click', () => go('dashboard', onNavigate));
    return;
  }

  const terms = shuffle(round);
  const definitions = shuffle(round);
  const matched = new Set();
  const missed = new Set();
  let selectedTerm = null;
  let selectedDefinition = null;
  let wrongPair = null;
  let correctPair = null;
  let resolvingPair = false;
  let animateBoard = true;
  let progressCelebration = false;
  let mistakes = 0;
  const startedAt = performance.now();
  let elapsedSeconds = 0;
  const timer = window.setInterval(() => {
    elapsedSeconds = Math.floor((performance.now() - startedAt) / 1000);
    const display = container.querySelector('#match-timer');
    if (display) display.textContent = `${elapsedSeconds}s`;
  }, 250);
  window.addEventListener('hashchange', () => window.clearInterval(timer), { once: true });

  function complete() {
    window.clearInterval(timer);
    elapsedSeconds = Math.max(1, Math.floor((performance.now() - startedAt) / 1000));
    const confetti = Array.from({ length: 12 }, (_, index) => `<i style="--confetti-index:${index}" aria-hidden="true"></i>`).join('');
    container.innerHTML = `<section class="full-view-stack"><div class="spec-card useful-empty-state match-result"><div class="match-confetti" aria-hidden="true">${confetti}</div><i class="fa-solid fa-flag-checkered match-result-icon"></i><h2>Sprint complete</h2><p>You matched ${round.length} exact meanings in <strong>${elapsedSeconds} seconds</strong> with <strong>${mistakes} mistake${mistakes === 1 ? '' : 's'}</strong>.</p><div class="match-result-metrics"><div><strong>${elapsedSeconds}s</strong><span>Time</span></div><div><strong>${mistakes}</strong><span>Mistakes</span></div><div><strong>${round.length}</strong><span>Pairs</span></div></div><div class="inline-actions"><button class="btn-green-solid" id="match-again">New sprint</button><button class="status-pill offline" id="match-done">Dashboard</button></div></div></section>`;
    container.querySelector('#match-again').addEventListener('click', () => renderMatchSprintMode(container, onNavigate));
    container.querySelector('#match-done').addEventListener('click', () => go('dashboard', onNavigate));
  }

  function evaluate() {
    if (!selectedTerm || !selectedDefinition) return;
    if (selectedTerm === selectedDefinition) {
      const id = selectedTerm;
      correctPair = id;
      resolvingPair = true;
      playInteractionSound('correct');
      render();
      recordExerciseResult({ wordId: id, exerciseType: 'match-sprint', correct: true, responseTimeMs: performance.now() - startedAt, hintsUsed: missed.has(id) ? 1 : 0, recallType: 'recognition', producedUnaided: false });
      window.dispatchEvent(new CustomEvent('keepvocab:progress'));
      window.setTimeout(() => {
        matched.add(id);
        correctPair = null;
        selectedTerm = null;
        selectedDefinition = null;
        resolvingPair = false;
        progressCelebration = true;
        animateBoard = true;
        if (matched.size === round.length) complete(); else render();
      }, 460);
      return;
    }
    mistakes += 1;
    playInteractionSound('wrong');
    missed.add(selectedTerm);
    missed.add(selectedDefinition);
    recordExerciseResult({ wordId: selectedTerm, exerciseType: 'match-sprint', correct: false, responseTimeMs: performance.now() - startedAt, hintsUsed: 0, recallType: 'recognition', producedUnaided: false, confusedWithWordId: selectedDefinition });
    wrongPair = { term: selectedTerm, definition: selectedDefinition };
    resolvingPair = true;
    render();
    window.setTimeout(() => {
      wrongPair = null;
      selectedTerm = null;
      selectedDefinition = null;
      resolvingPair = false;
      if (window.location.hash === '#match') render();
    }, 550);
  }

  function render() {
    const progress = Math.round(matched.size / round.length * 100);
    const tile = (word, kind, index) => {
      const selected = kind === 'term' ? selectedTerm === word.id : selectedDefinition === word.id;
      const wrong = wrongPair && wrongPair[kind] === word.id;
      const correct = correctPair === word.id;
      const content = kind === 'term'
        ? `<strong>${escapeHtml(word.word)}</strong><small>${escapeHtml(word.partOfSpeech || 'unknown')}</small>`
        : `<span>${escapeHtml(word.definition)}</span>`;
      return `<button class="match-tile ${kind}${selected ? ' selected' : ''}${wrong ? ' wrong' : ''}${correct ? ' correct-match' : ''}${animateBoard ? ' tile-enter' : ''}" style="--match-delay:${Math.min(index, 6) * 35}ms" data-match-kind="${kind}" data-match-id="${escapeHtml(word.id)}" aria-pressed="${selected}"${resolvingPair ? ' disabled' : ''}>${content}${correct ? '<i class="fa-solid fa-check match-correct-check" aria-hidden="true"></i>' : ''}</button>`;
    };
    container.innerHTML = `<section class="full-view-stack"><div class="spec-card match-shell">
      <div class="practice-topline"><button class="status-pill offline" id="match-exit"><i class="fa-solid fa-arrow-left"></i> Dashboard</button><span>${matched.size} of ${round.length} pairs</span><strong id="match-timer">${elapsedSeconds}s</strong></div>
      <div class="review-progress match-progress"><span class="${progressCelebration ? 'progress-celebrate' : ''}" style="width:${progress}%"></span></div>
      <div class="match-intro"><div class="practice-icon match-icon"><i class="fa-solid fa-stopwatch"></i></div><div><h2>Match Sprint</h2><p>Tap a word, then tap its exact meaning. The most difficult meanings appear first.</p></div><span>${mistakes} mistake${mistakes === 1 ? '' : 's'}</span></div>
      <div class="match-board" aria-label="Word and definition matching board"><div class="match-column"><h3>Words</h3>${getUnmatchedWords(terms, matched).map((word, index) => tile(word, 'term', index)).join('')}</div><div class="match-column"><h3>Meanings</h3>${getUnmatchedWords(definitions, matched).map((word, index) => tile(word, 'definition', index)).join('')}</div></div>
    </div></section>`;
    animateBoard = false;
    progressCelebration = false;
    container.querySelector('#match-exit').addEventListener('click', () => go('dashboard', onNavigate));
    container.querySelectorAll('[data-match-kind]').forEach(button => button.addEventListener('click', () => {
      if (resolvingPair) return;
      const { matchKind, matchId } = button.dataset;
      if (matchKind === 'term') selectedTerm = selectedTerm === matchId ? null : matchId;
      else selectedDefinition = selectedDefinition === matchId ? null : matchId;
      render();
      evaluate();
    }));
  }

  render();
}
