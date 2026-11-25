import { escapeHtml } from '../utils/html.js';
import { speakWord } from '../services/speechService.js?v=18908';

// Let touch users read the clue before opening their keyboard. An explicit
// Next/Edit action can resume typing; desktop practice keeps keyboard focus.
export function focusPracticeInput(input, { allowTouch = false } = {}) {
  if (!input) return;
  const touch = globalThis.matchMedia?.('(pointer: coarse)').matches === true;
  if (touch && !allowTouch) return;
  input.focus({ preventScroll: !touch });
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
  return `<div class="practice-topline"><button class="status-pill offline" id="${escapeHtml(exitId)}"><i class="fa-solid fa-arrow-left"></i> Dashboard</button><span>${escapeHtml(label ? `${label} · ` : '')}${current + 1} of ${total}</span><strong>${escapeHtml(progress.status)}</strong></div>
    <div class="review-progress" role="progressbar" aria-label="Exercise progress" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${progress.completed}"><span style="width:${progress.percent}%"></span></div>`;
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
  return `<div class="answer-feedback-slot" aria-live="polite">${answered ? `<div class="answer-feedback-card ${correct ? 'correct' : 'incorrect'}"><i class="fa-solid ${correct ? 'fa-check' : 'fa-xmark'} answer-feedback-icon" aria-hidden="true"></i><div><strong>${escapeHtml(answerEncouragement({ correct, recallType, hintsUsed }))}</strong><span>${message}</span></div></div>` : ''}</div>
    <div class="answer-action-slot">${answered ? `<button class="btn-green-solid" id="${escapeHtml(nextId)}">${escapeHtml(nextLabel)}</button>` : ''}</div>`;
}

export function renderPracticeNotice({ title, detail, actions, complete = false, loading = false }) {
  return `<section class="full-view-stack"><div class="spec-card useful-empty-state${complete ? ' mode-complete' : ''}"${loading ? ' aria-live="polite" aria-busy="true"' : ''}><img class="${loading ? 'practice-mascot' : 'mascot-result'}" src="assets/keepvocab-sprig-${complete ? 'celebrate' : 'thinking'}.webp" alt=""><h2>${escapeHtml(title)}</h2><p>${escapeHtml(detail)}</p><div class="inline-actions">${actions.map(({ id, label, secondary }) => `<button class="${secondary ? 'status-pill offline' : 'btn-green-solid'}" id="${escapeHtml(id)}">${escapeHtml(label)}</button>`).join('')}</div></div></section>`;
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

export function renderPracticeMascot({ heading = '', bubbleHtml = '', answered = false, correct = false, combo = 0, retry = false } = {}) {
  const mood = answered ? (correct ? 'celebrate' : 'encourage') : 'thinking';
  const asset = mood === 'celebrate' ? 'assets/keepvocab-sprig-celebrate.webp'
    : mood === 'encourage' ? 'assets/keepvocab-sprout-mascot.webp'
      : 'assets/keepvocab-sprig-thinking.webp';
  const comboBadge = combo >= 3
    ? `<span class="duo-combo-badge"><i class="fa-solid fa-fire" aria-hidden="true"></i> ${combo} in a row</span>`
    : retry
      ? '<span class="duo-retry-badge"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i> Previous mistake</span>'
      : '';
  return `<div class="duo-stage-heading">${heading ? `<h2>${escapeHtml(heading)}</h2>` : ''}${comboBadge}</div>
    <div class="duo-prompt-row is-${mood}">
      <img class="duo-prompt-mascot" src="${asset}" alt="" aria-hidden="true" width="108" height="108">
      <div class="duo-speech-bubble">${bubbleHtml}</div>
    </div>`;
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
  container.querySelector('#sentence-play-example').addEventListener('click', () => speakWord(sentence, 'en-US', 0.92));
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
