import { driveSync } from '../services/driveSync.js?v=63';
import { buildDailySession, buildWeakWordsSession, weaknessScore } from '../services/dailySession.js?v=63';
import { recordExerciseResult } from '../services/exerciseResult.js?v=63';
import { recordSessionCompletion } from '../services/learningStats.js?v=63';
import { speakWord } from '../services/speechService.js?v=63';
import { playInteractionSound } from '../services/interactionSound.js?v=63';
import { buildWordChoices } from './PracticeModes.js?v=63';
import { escapeHtml } from '../utils/html.js';

function normalize(value) {
  return String(value || '').trim().toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, ' ');
}

function containsTarget(sentence, target) {
  const escaped = String(target || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, 'i').test(String(sentence || ''));
}

function go(view, onNavigate) {
  if (window.location.hash === `#${view}`) onNavigate(view); else window.location.hash = view;
}

function cloze(word) {
  if (!word.example || !containsTarget(word.example, word.word)) return `Complete with the word meaning “${word.definition}”.`;
  return word.example.replace(new RegExp(word.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), '________');
}

function exerciseCopy(exercise, word) {
  if (exercise.exerciseType === 'image-recognition') return { title: 'Choose the word', prompt: 'Which word matches this visual idea?' };
  if (exercise.exerciseType === 'definition-recognition') return { title: 'Recognize it', prompt: word.definition };
  if (exercise.exerciseType === 'listening-recall') return { title: 'Listen & recall', prompt: 'Listen, then type the word.' };
  if (exercise.exerciseType === 'context-cloze') return { title: 'Complete the context', prompt: cloze(word) };
  if (exercise.exerciseType === 'use-it') return { title: 'Use it', prompt: `Use “${word.word}” in your own sentence.` };
  return { title: 'Recall it', prompt: word.definition };
}

export function renderDailySessionMode(container, onNavigate, options = {}) {
  const words = driveSync.getWords();
  const session = options.kind === 'weak' ? buildWeakWordsSession(words) : buildDailySession(words);
  if (!session.exercises.length) {
    container.innerHTML = `<section class="full-view-stack"><div class="spec-card useful-empty-state"><img class="mascot-result" src="assets/keepvocab-sprout-mascot.webp" alt="Sprig"><h2>${options.kind === 'weak' ? 'No weak words yet' : 'Build your first workout'}</h2><p>${options.kind === 'weak' ? 'Mistakes from any learning mode will appear here automatically.' : 'Add vocabulary and KeepVocab will choose the right first exercises.'}</p><button class="btn-green-solid" id="daily-empty-action">${options.kind === 'weak' ? 'Back to Today' : 'Add a word'}</button></div></section>`;
    container.querySelector('#daily-empty-action').addEventListener('click', () => options.kind === 'weak' ? go('dashboard', onNavigate) : document.getElementById('btn-header-quick-add')?.click());
    return;
  }

  const queue = [...session.exercises];
  const retries = new Set();
  const initialWeak = new Map(words.map(word => [word.id, weaknessScore(word)]));
  let index = 0;
  let score = 0;
  let answered = false;
  let correct = false;
  let hintsUsed = 0;
  let learnerResponse = '';
  let confusedWithWordId = '';
  let questionStartedAt = performance.now();

  const currentWord = () => driveSync.getWords().find(word => word.id === queue[index]?.wordId);

  function complete() {
    const improved = driveSync.getWords().filter(word => (initialWeak.get(word.id) || 0) > weaknessScore(word)).length;
    recordSessionCompletion(session, { kind: options.kind || 'daily', exercises: queue.length, correct: score, minutes: Math.max(1, Math.round((performance.now() - startedAt) / 60_000)), weakWordsImproved: improved });
    container.innerHTML = `<section class="full-view-stack"><div class="spec-card daily-complete-card"><img src="assets/keepvocab-sprig-celebrate.webp" alt="Sprig celebrating"><span class="eyebrow">Workout complete</span><h1>${options.kind === 'weak' ? 'Your weak words are getting stronger' : 'You moved your vocabulary forward'}</h1><p>${score} of ${queue.length} exercises were correct. ${improved ? `${improved} weak word${improved === 1 ? '' : 's'} improved.` : 'Mistakes are already shaping your next workout.'}</p><div class="daily-complete-metrics"><div><strong>${score}</strong><span>correct</span></div><div><strong>${queue.length}</strong><span>exercises</span></div><div><strong>${improved}</strong><span>recovered</span></div></div><div class="inline-actions"><button class="btn-green-solid" id="daily-finish">Back to Today</button><button class="status-pill offline" id="daily-stats">View progress</button></div></div></section>`;
    container.querySelector('#daily-finish').addEventListener('click', () => go('dashboard', onNavigate));
    container.querySelector('#daily-stats').addEventListener('click', () => go('stats', onNavigate));
  }

  const startedAt = performance.now();

  function submit(answer, selectedId = '') {
    const exercise = queue[index];
    const word = currentWord();
    learnerResponse = String(answer || '').trim();
    confusedWithWordId = selectedId && selectedId !== word.id ? selectedId : '';
    if (exercise.exerciseType === 'use-it') correct = containsTarget(learnerResponse, word.word) && learnerResponse.split(/\s+/).length >= 4;
    else if (['image-recognition', 'definition-recognition'].includes(exercise.exerciseType)) correct = selectedId === word.id;
    else correct = normalize(learnerResponse) === normalize(word.word);
    const recallType = exercise.exerciseType === 'use-it' ? 'productive'
      : exercise.exerciseType === 'context-cloze' ? 'context'
        : exercise.exerciseType === 'listening-recall' ? 'listening-recall'
          : ['image-recognition', 'definition-recognition'].includes(exercise.exerciseType) ? 'recognition' : 'free-recall';
    recordExerciseResult({
      wordId: word.id,
      exerciseType: `daily-${exercise.exerciseType}`,
      correct,
      responseTimeMs: performance.now() - questionStartedAt,
      hintsUsed,
      recallType,
      producedUnaided: correct && !hintsUsed && !['image-recognition', 'definition-recognition'].includes(exercise.exerciseType),
      confusedWithWordId,
      learnerResponse: recallType === 'productive' ? learnerResponse : ''
    });
    playInteractionSound(correct ? 'correct' : 'wrong');
    if (correct) score += 1;
    if (!correct && !retries.has(word.id)) {
      retries.add(word.id);
      queue.splice(Math.min(queue.length, index + 2), 0, { ...exercise, id: `${exercise.id}-retry`, immediateRetry: true });
    }
    answered = true;
    render();
  }

  function render() {
    if (index >= queue.length) return complete();
    const exercise = queue[index];
    const word = currentWord();
    if (!word) { index += 1; return render(); }
    const copy = exerciseCopy(exercise, word);
    const choiceMode = ['image-recognition', 'definition-recognition'].includes(exercise.exerciseType);
    const optionsList = choiceMode ? buildWordChoices(word, driveSync.getWords(), 4) : [];
    const inputLabel = exercise.exerciseType === 'use-it' ? 'Your sentence' : 'Your answer';
    const mascot = answered ? (correct ? 'assets/keepvocab-sprig-celebrate.webp' : 'assets/keepvocab-sprout-mascot.webp') : 'assets/keepvocab-sprig-thinking.webp';
    container.innerHTML = `<section class="full-view-stack"><div class="spec-card daily-session-shell">
      <div class="daily-session-top"><button class="status-pill offline" id="daily-exit"><i class="fa-solid fa-xmark"></i> Exit</button><div><span>${options.kind === 'weak' ? 'Weak Words' : "Today's Workout"}</span><strong>${index + 1} of ${queue.length}</strong></div><span class="daily-score">${score} correct</span></div>
      <div class="review-progress" role="progressbar" aria-label="Workout progress" aria-valuemin="0" aria-valuemax="${queue.length}" aria-valuenow="${index}"><span style="width:${Math.round(index / queue.length * 100)}%"></span></div>
      <div class="daily-exercise-stage ${answered ? (correct ? 'is-correct' : 'is-incorrect') : ''}"><img class="daily-sprig" src="${mascot}" alt="" aria-hidden="true"><span class="eyebrow">${escapeHtml(copy.title)}</span><h1>${escapeHtml(copy.prompt)}</h1>
        ${exercise.exerciseType === 'image-recognition' && word.imageUrl ? `<figure class="daily-image-prompt"><img src="${escapeHtml(word.imageUrl)}" alt="Visual clue"></figure>` : ''}
        ${exercise.exerciseType === 'listening-recall' ? `<button class="audio-btn-circle large" id="daily-listen" aria-label="Play the word"><i class="fa-solid fa-volume-high"></i></button>` : ''}
        ${answered ? `<div class="answer-feedback-card ${correct ? 'correct' : 'incorrect'}" role="status" aria-live="polite"><i class="fa-solid ${correct ? 'fa-check' : 'fa-arrow-rotate-left'} answer-feedback-icon" aria-hidden="true"></i><div><strong>${correct ? 'Strong answer' : 'Let’s strengthen this one'}</strong><span>${correct ? (exercise.exerciseType === 'use-it' ? 'Your sentence uses the target word clearly.' : escapeHtml(word.example || word.definition)) : `Answer: <b>${escapeHtml(word.word)}</b>. You’ll see it once more.`}</span></div></div><button class="btn-green-solid" id="daily-next">Continue</button>`
          : choiceMode ? `<div class="choice-grid">${optionsList.map(option => `<button class="choice-button" data-daily-choice="${escapeHtml(option.id)}"><span>${escapeHtml(option.word)}</span></button>`).join('')}</div>`
            : `<form class="practice-answer-form daily-answer-form" id="daily-form">${exercise.exerciseType === 'use-it' ? `<textarea id="daily-answer" rows="3" placeholder="Write a natural sentence" aria-label="${inputLabel}"></textarea>` : `<input id="daily-answer" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Type your answer" aria-label="${inputLabel}">`}<button class="btn-green-solid" data-sound="none">Check</button></form><button class="daily-hint-button" id="daily-hint">Need a hint?</button><p class="daily-hint" id="daily-hint-copy" role="status" aria-live="polite"></p>`}
      </div></div></section>`;
    container.querySelector('#daily-exit').addEventListener('click', () => go('dashboard', onNavigate));
    container.querySelector('#daily-listen')?.addEventListener('click', () => speakWord(word.word, 'en-US', 0.86, word.audioUrl));
    container.querySelectorAll('[data-daily-choice]').forEach(button => button.addEventListener('click', () => submit(button.textContent, button.dataset.dailyChoice)));
    container.querySelector('#daily-form')?.addEventListener('submit', event => { event.preventDefault(); const answer = container.querySelector('#daily-answer').value; if (answer.trim()) submit(answer); });
    container.querySelector('#daily-hint')?.addEventListener('click', () => { hintsUsed += 1; container.querySelector('#daily-hint-copy').textContent = exercise.exerciseType === 'use-it' ? `Try a situation where “${word.word}” naturally describes what happened.` : `It starts with “${word.word.slice(0, Math.min(2, word.word.length))}”.`; });
    container.querySelector('#daily-next')?.addEventListener('click', () => { index += 1; answered = false; correct = false; hintsUsed = 0; learnerResponse = ''; confusedWithWordId = ''; questionStartedAt = performance.now(); render(); });
    container.querySelector('#daily-answer')?.focus();
  }

  render();
}
