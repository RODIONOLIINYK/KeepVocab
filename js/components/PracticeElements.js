import { escapeHtml } from '../utils/html.js';

// Shared markup deliberately uses the existing practice styles and animations.
export function renderPracticeHeader({ exitId, label, current, total, score }) {
  return `<div class="practice-topline"><button class="status-pill offline" id="${escapeHtml(exitId)}"><i class="fa-solid fa-arrow-left"></i> Dashboard</button><span>${escapeHtml(label ? `${label} · ` : '')}${current + 1} of ${total}</span><strong>Score ${score}</strong></div>
    <div class="review-progress" role="progressbar" aria-label="Exercise progress" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${current}"><span style="width:${Math.round(current / total * 100)}%"></span></div>`;
}

export function renderChoiceGrid({ options, targetId, selectedId = null, attribute = 'data-choice' }) {
  const answered = selectedId !== null;
  return `<div class="choice-grid">${options.map(option => {
    const state = answered ? option.id === targetId ? 'correct' : option.id === selectedId ? 'incorrect' : '' : '';
    const icon = state ? `<i class="fa-solid ${state === 'correct' ? 'fa-check' : 'fa-xmark'} choice-result-icon" aria-hidden="true"></i>` : '';
    return `<button class="choice-button${state ? ` ${state}` : ''}" ${attribute}="${escapeHtml(option.id)}" data-sound="none" ${answered ? 'disabled' : ''}><span>${escapeHtml(option.word)}</span>${icon}</button>`;
  }).join('')}</div>`;
}

export function renderAnswerFeedback({ answered, correct, answer, detail = '', nextId, nextLabel }) {
  const message = correct ? escapeHtml(detail) : `The correct answer is <b>${escapeHtml(answer)}</b>. ${escapeHtml(detail)}`;
  return `<div class="answer-feedback-slot" aria-live="polite">${answered ? `${correct ? '<span class="success-burst" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>' : ''}<div class="answer-feedback-card ${correct ? 'correct' : 'incorrect'}"><i class="fa-solid ${correct ? 'fa-check' : 'fa-xmark'} answer-feedback-icon" aria-hidden="true"></i><div><strong>${correct ? 'Excellent!' : 'Not quite'}</strong><span>${message}</span></div></div>` : ''}</div>
    <div class="answer-action-slot">${answered ? `<button class="btn-green-solid" id="${escapeHtml(nextId)}">${escapeHtml(nextLabel)}</button>` : ''}</div>`;
}

export function renderPracticeNotice({ title, detail, actions, complete = false, loading = false }) {
  return `<section class="full-view-stack"><div class="spec-card useful-empty-state${complete ? ' mode-complete' : ''}"${loading ? ' aria-live="polite" aria-busy="true"' : ''}><img class="${loading ? 'practice-mascot' : 'mascot-result'}" src="assets/keepvocab-sprig-${complete ? 'celebrate' : 'thinking'}.webp" alt=""><h2>${escapeHtml(title)}</h2><p>${escapeHtml(detail)}</p><div class="inline-actions">${actions.map(({ id, label, secondary }) => `<button class="${secondary ? 'status-pill offline' : 'btn-green-solid'}" id="${escapeHtml(id)}">${escapeHtml(label)}</button>`).join('')}</div></div></section>`;
}
