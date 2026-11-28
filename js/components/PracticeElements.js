import { escapeHtml } from '../utils/html.js';
import { isSpeechActive, onSpeechStateChange, speakWord } from '../services/speechService.js?v=18912';

// Let touch users read the clue before opening their keyboard. An explicit
// Next/Edit action can resume typing; desktop practice keeps keyboard focus.
export function focusPracticeInput(input, { allowTouch = false } = {}) {
  if (!input) return;
  const touch = globalThis.matchMedia?.('(pointer: coarse)').matches === true;
  if (touch && !allowTouch) return;
  input.focus({ preventScroll: !touch });
}

function progressFraction(fill) {
  if (!fill) return 0;
  const width = fill.parentElement.getBoundingClientRect().width;
  return width ? fill.getBoundingClientRect().width / width : 0;
}

function animateProgress(fill, from) {
  const to = progressFraction(fill);
  if (!to || Math.abs(from - to) < .001) return;
  fill.animate?.([{ scale: `${from / to} 1` }, { scale: '1 1' }], {
    duration: 440, easing: 'cubic-bezier(.16, .85, .24, 1)'
  });
}

export function updatePracticeProgress(rail, completed, total) {
  const fill = rail.querySelector('span');
  const from = progressFraction(fill);
  rail.setAttribute('aria-valuemax', String(total));
  rail.setAttribute('aria-valuenow', String(completed));
  if (rail.classList.contains('is-segmented')) rail.style.setProperty('--practice-completed', completed);
  fill.style.width = `${total ? 100 * completed / total : 0}%`;
  if (!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) animateProgress(fill, from);
}

const frameStates = new WeakMap();
export function renderPracticeFrame(container, markup, { key, result = '', step = '' }) {
  const previous = frameStates.get(container.firstElementChild);
  const sameQuestion = previous?.key === key;
  const motion = !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const progressSelector = '.review-progress > span, .exercise-progress > i > b';
  const from = previous && motion ? progressFraction(container.querySelector(progressSelector)) : 0;
  const hadFocus = container.contains?.(container.ownerDocument?.activeElement);
  talkingMascots.get(container)?.();
  container.innerHTML = markup;
  const node = container.firstElementChild;
  if (!node) return;
  frameStates.set(node, { key, result, step });
  const stepMotion = typeof step === 'number'
    ? step > (previous?.step || 0) ? 'place' : ''
    : step;
  node.dataset.practiceMotion = !sameQuestion ? 'enter'
    : result !== previous.result && result ? result
      : step !== previous.step ? stepMotion : '';
  if (motion) animateProgress(node.querySelector(progressSelector), from);
  if (hadFocus && result && result !== previous?.result) {
    node.querySelector('[data-practice-continue]')?.focus({ preventScroll: true });
  }
}

export function renderPracticeBurst() {
  return '<span class="practice-burst" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>';
}

// The existing status and progress reflect submitted exercises, including a
// missed answer. Milestones replace status text only; no extra UI or waiting.
export function practiceProgress({ current = 0, total = 0, answered = false, score = 0 } = {}) {
  const count = Math.max(0, Math.floor(Number(total) || 0));
  const completed = Math.min(count, Math.max(0, Math.floor(Number(current) || 0) + (answered ? 1 : 0)));
  const status = answered && count >= 4 && completed === Math.ceil(count / 2) ? 'Halfway through'
    : answered && count >= 4 && completed === count - 1 ? 'One exercise left'
      : `${Math.max(0, Number(score) || 0)} correct`;
  return { completed, percent: count ? Math.round(completed / count * 100) : 0, status };
}

export function answerEncouragement({ correct, recallType = 'recognition', hintsUsed = 0 } = {}) {
  if (!correct) return 'Not quite';
  if (hintsUsed > 0) return 'Correct — with a hint';
  if (recallType === 'free-recall') return 'Recalled without a hint';
  if (recallType === 'listening-recall') return 'You heard it correctly';
  if (recallType === 'productive') return 'You used the meaning';
  if (recallType === 'context') return 'You found the right fit';
  return 'You matched the meaning';
}

export function renderPracticeHeader({ exitId, label, current, total, score, answered = false }) {
  const progress = practiceProgress({ current, total, score, answered });
  const segmented = total >= 2 && total <= 10;
  const segments = segmented ? ` style="--practice-segments:${total};--practice-completed:${progress.completed}"` : '';
  return `<div class="practice-topline"><button class="status-pill offline" id="${escapeHtml(exitId)}"><i class="fa-solid fa-arrow-left"></i> Dashboard</button><span>${escapeHtml(label ? `${label} · ` : '')}${current + 1} of ${total}</span><strong>${escapeHtml(progress.status)}</strong></div>
    <div class="review-progress${segmented ? ' is-segmented' : ''}" role="progressbar" aria-label="Exercise progress" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${progress.completed}"${segments}><span style="width:${progress.percent}%"></span></div>`;
}

export function renderChoiceGrid({ options, targetId, selectedId = null, attribute = 'data-choice' }) {
  const answered = selectedId !== null;
  return `<div class="choice-grid">${options.map(option => {
    const state = answered ? option.id === targetId ? 'correct' : option.id === selectedId ? 'incorrect' : '' : '';
    const icon = state ? `<i class="fa-solid ${state === 'correct' ? 'fa-check' : 'fa-xmark'} choice-result-icon" aria-hidden="true"></i>` : '';
    return `<button class="choice-button${state ? ` ${state}` : ''}" ${attribute}="${escapeHtml(option.id)}" data-sound="none" ${answered ? 'disabled' : ''}><span>${escapeHtml(option.word)}</span>${icon}</button>`;
  }).join('')}</div>`;
}

export function renderAnswerFeedback({ answered, correct, answer, detail = '', nextId, nextLabel, recallType = 'recognition', hintsUsed = 0 }) {
  const message = correct ? escapeHtml(detail) : `The correct answer is <b>${escapeHtml(answer)}</b>. ${escapeHtml(detail)}`;
  if (!answered) return '';
  const state = correct ? 'correct' : 'incorrect';
  return `<aside class="practice-answer-tray ${state}">
    <div class="answer-feedback-card ${state}" role="status"><i class="fa-solid ${correct ? 'fa-check' : 'fa-xmark'} answer-feedback-icon" aria-hidden="true"></i><div><strong>${escapeHtml(answerEncouragement({ correct, recallType, hintsUsed }))}</strong><span>${message}</span></div></div>
    <button class="btn-green-solid" data-practice-continue id="${escapeHtml(nextId)}">${escapeHtml(nextLabel)}</button>
  </aside>`;
}

export function renderPracticeNotice({ title, detail, actions, complete = false, loading = false }) {
  return `<section class="full-view-stack"><div class="spec-card useful-empty-state${complete ? ' mode-complete practice-completion' : ''}"${loading ? ' aria-live="polite" aria-busy="true"' : ''}><img class="${loading ? 'practice-mascot' : 'mascot-result'}" src="assets/keepvocab-sprig-${complete ? 'celebrate' : 'thinking'}.webp" alt=""><h2>${escapeHtml(title)}</h2><p>${escapeHtml(detail)}</p><div class="inline-actions">${actions.map(({ id, label, secondary }) => `<button class="${secondary ? 'status-pill offline' : 'btn-green-solid'}" id="${escapeHtml(id)}">${escapeHtml(label)}</button>`).join('')}</div></div></section>`;
}

export function formatMemoryBoost(transition) {
  const afterDays = Number(transition?.after?.scheduled_days || 0);
  const beforeDays = Number(transition?.before?.scheduled_days || 0);
  if (!(afterDays >= 1)) return '';
  const roundedAfter = Math.round(afterDays);
  const roundedBefore = Math.round(beforeDays);
  if (roundedBefore >= 1 && roundedAfter > roundedBefore) {
    return `Memory boosted · ${roundedBefore}d → ${roundedAfter}d`;
  }
  return `Next review in ${roundedAfter} ${roundedAfter === 1 ? 'day' : 'days'}`;
}

export function renderVoiceWave() {
  return '<span class="duo-voice-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>';
}

// Real illustrated Talking Sprig using pixel-aligned mouth-closed and mouth-open
// frames that alternate cleanly while speech is playing.
export function renderTalkingSprig(mood = 'thinking') {
  if (mood === 'celebrate') {
    return '<img class="sprig-talk-frame is-celebrate" src="assets/keepvocab-sprig-celebrate.webp" alt="" aria-hidden="true" width="112" height="112">';
  }
  return `<span class="sprig-talk-stage" aria-hidden="true">
    <img class="sprig-talk-frame is-closed" src="assets/keepvocab-sprig-talk-closed.webp" alt="" width="112" height="112">
    <img class="sprig-talk-frame is-open" src="assets/keepvocab-sprig-talk-open.webp" alt="" width="112" height="112">
  </span>`;
}

export function renderComboBadge(combo = 0) {
  const count = Math.floor(Number(combo) || 0);
  if (count < 3) return '';
  const tier = count >= 15 ? ' is-legend' : count >= 10 ? ' is-super' : count >= 5 ? ' is-blaze' : '';
  const icon = count >= 15 ? 'fa-wand-magic-sparkles' : 'fa-fire';
  return `<span class="duo-combo-badge${tier}"><i class="fa-solid ${icon}" aria-hidden="true"></i> ${count} in a row</span>`;
}

export function comboShellClasses(combo = 0) {
  const count = Math.floor(Number(combo) || 0);
  if (count >= 10) return ' is-hot-combo is-super-combo is-ultra-combo';
  if (count >= 5) return ' is-hot-combo is-super-combo';
  if (count >= 3) return ' is-hot-combo';
  return '';
}

export function renderPracticeMascot({ heading = '', bubbleHtml = '', answered = false, correct = false, combo = 0, retry = false, talking = false } = {}) {
  const mood = answered ? (correct ? 'celebrate' : 'encourage') : 'thinking';
  const asset = mood === 'celebrate' ? 'assets/keepvocab-sprig-celebrate.webp'
    : mood === 'encourage' ? 'assets/keepvocab-sprout-mascot.webp'
      : 'assets/keepvocab-sprig-thinking.webp';
  const comboBadge = combo >= 3
    ? renderComboBadge(combo)
    : retry
      ? '<span class="duo-retry-badge"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i> Previous mistake</span>'
      : '';
  const mascotHtml = talking
    ? `<button type="button" class="duo-prompt-mascot duo-talking-mascot" data-sprig-talk data-sound="none" aria-label="Tap Sprig to replay pronunciation">${renderTalkingSprig(mood)}</button>`
    : `<img class="duo-prompt-mascot" src="${asset}" alt="" aria-hidden="true" width="108" height="108">`;
  return `<div class="duo-stage-heading">${heading ? `<h2>${escapeHtml(heading)}</h2>` : ''}${comboBadge}</div>
    <div class="duo-prompt-row is-${mood}${talking ? ' has-talking-mascot' : ''}${talking && isSpeechActive() ? ' is-talking' : ''}">
      <div class="practice-sprig">${mascotHtml}${correct && answered ? renderPracticeBurst() : ''}</div>
      <div class="duo-speech-bubble">${bubbleHtml}</div>
    </div>`;
}

// Keep Talking Sprig's mouth animation and voice equalizer in exact sync
// with speech playback, auto-cleaning up when the view re-renders.
const talkingMascots = new WeakMap();
export function bindTalkingMascot(container, onReplay = null) {
  if (!container) return () => {};
  const row = container.querySelector('.duo-prompt-row');
  if (!row) return () => {};

  if (typeof onReplay === 'function') {
    row.querySelector('[data-sprig-talk]')?.addEventListener('click', () => onReplay());
  }

  talkingMascots.get(container)?.();
  let unsubscribe = () => {};
  const cleanup = () => {
    unsubscribe();
    if (talkingMascots.get(container) === cleanup) talkingMascots.delete(container);
  };
  const syncState = ({ speaking } = {}) => {
    if (!container.contains?.(row) && row.isConnected === false) {
      cleanup();
      return;
    }
    row.classList.toggle('is-talking', Boolean(speaking));
  };

  syncState({ speaking: isSpeechActive() });
  unsubscribe = onSpeechStateChange(syncState);
  talkingMascots.set(container, cleanup);
  return cleanup;
}

export function renderSentenceExampleCue(sentence, revealed) {
  return `<div class="sentence-example-cue">
    <div class="inline-actions">
      <button type="button" class="status-pill offline" id="sentence-play-example" data-sound="none"><i class="fa-solid fa-volume-high" aria-hidden="true"></i> Play example</button>
      <button type="button" class="status-pill offline" id="sentence-read-example" aria-controls="sentence-example-text" aria-expanded="${revealed}">${revealed ? 'Hide example' : 'Read example'}</button>
    </div>
    <p id="sentence-example-text" class="duo-bubble-copy" lang="en"${revealed ? '' : ' hidden'}>${escapeHtml(sentence)}</p>
  </div>`;
}

export function bindSentenceExampleCue(container, sentence, onToggle) {
  container.querySelector('#sentence-play-example').addEventListener('click', () => speakWord(sentence, 'en-US', 0.95));
  const button = container.querySelector('#sentence-read-example');
  const example = container.querySelector('#sentence-example-text');
  button.addEventListener('click', () => {
    const revealed = example.hidden;
    example.hidden = !revealed;
    button.setAttribute('aria-expanded', String(revealed));
    button.textContent = revealed ? 'Hide example' : 'Read example';
    onToggle(revealed);
  });
}
