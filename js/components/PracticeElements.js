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

// Expressive animated Talking Sprig vector modeled on Sprig's green book-sprout
// mascot, with live talking mouth, bobbing leaves, blinking eyes, and sound waves.
export function renderTalkingSprigSvg(mood = 'thinking') {
  const happyEyes = mood === 'celebrate';
  return `<svg class="sprig-talk-svg" viewBox="0 0 128 136" width="112" height="118" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id="sprig-body-grad" x1="28" y1="30" x2="96" y2="108" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#22c55e"/>
        <stop offset="100%" stop-color="#129c45"/>
      </linearGradient>
      <linearGradient id="sprig-leaf-grad" x1="56" y1="8" x2="86" y2="42" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#4ade80"/>
        <stop offset="100%" stop-color="#16a34a"/>
      </linearGradient>
    </defs>
    <!-- Radiating speech sound waves (visible while Sprig is talking) -->
    <g class="sprig-sound-waves">
      <path class="sprig-wave w1" d="M104 54c5 5 5 15 0 20" stroke="#22c55e" stroke-width="3.2" stroke-linecap="round"/>
      <path class="sprig-wave w2" d="M112 46c8 9 8 27 0 36" stroke="#4ade80" stroke-width="3" stroke-linecap="round"/>
    </g>
    <!-- Feet -->
    <g class="sprig-feet">
      <path d="M51 108l-5 11" stroke="#15803d" stroke-width="5.5" stroke-linecap="round"/>
      <ellipse cx="44" cy="121" rx="9" ry="5.5" fill="#14532d" transform="rotate(-12 44 121)"/>
      <path d="M77 104l5 10" stroke="#15803d" stroke-width="5.5" stroke-linecap="round"/>
      <ellipse cx="85" cy="115" rx="9" ry="5.5" fill="#14532d" transform="rotate(-10 85 115)"/>
    </g>
    <!-- Upper body + head rig -->
    <g class="sprig-head-rig">
      <!-- Top sprout leaves -->
      <g class="sprig-leaves">
        <path d="M58 38c-2-12 6-26 22-30 2 14-6 27-22 30z" fill="url(#sprig-leaf-grad)"/>
        <path d="M62 32c1-7 6-14 14-18-1 8-6 15-14 18z" fill="#bef264"/>
        <path d="M57 38c-12-2-22-9-23-19 11-2 21 5 23 19z" fill="#22c55e"/>
        <path d="M53 34c-6-2-12-6-13-11 6-1 11 3 13 11z" fill="#bef264"/>
      </g>
      <!-- Rounded character body -->
      <rect x="26" y="36" width="74" height="68" rx="22" transform="rotate(-7 63 70)" fill="url(#sprig-body-grad)"/>
      <!-- Lime heart face mask -->
      <path d="M62 56c-4-9-16-12-23-5-8 8-6 22 4 30l17 12 18-13c10-8 11-22 3-30-7-7-17-4-19 6z" fill="#a3f03d"/>
      <!-- Eyebrows -->
      <path d="M41 48c3-2.5 7-3 10-1.5" stroke="#14532d" stroke-width="2.8" stroke-linecap="round"/>
      <path d="M70 43c3.5-1.5 7.5-1 10 1.5" stroke="#14532d" stroke-width="2.8" stroke-linecap="round"/>
      <!-- Expressive eyes -->
      ${happyEyes
        ? `<g class="sprig-eyes-happy">
            <path d="M40 65c2-6 10-7 13-1" stroke="#14532d" stroke-width="4" stroke-linecap="round"/>
            <path d="M67 61c2-6 10-7 13-1" stroke="#14532d" stroke-width="4" stroke-linecap="round"/>
          </g>`
        : `<g class="sprig-eyes">
            <circle cx="48" cy="65" r="10.5" fill="#ffffff"/>
            <circle cx="51" cy="65" r="6" fill="#14532d"/>
            <circle cx="48.5" cy="62.2" r="2.3" fill="#ffffff"/>
            <circle cx="76" cy="60.5" r="10.5" fill="#ffffff"/>
            <circle cx="79" cy="60.5" r="6" fill="#14532d"/>
            <circle cx="76.5" cy="57.7" r="2.3" fill="#ffffff"/>
          </g>`}
      <!-- Animated talking mouth -->
      <g class="sprig-mouth-idle">
        <path d="M56 75c5 3 12 2.5 16-1.5-1 7-6 11-11 10-4-.8-6-4-5-8.5z" fill="#14532d"/>
        <ellipse cx="64.5" cy="81.2" rx="4.2" ry="2.6" fill="#f97316"/>
      </g>
      <g class="sprig-mouth-talking">
        <ellipse class="sprig-mouth-cavity" cx="64" cy="78" rx="8.5" ry="7.2" fill="#14532d"/>
        <ellipse class="sprig-mouth-tongue" cx="64" cy="82.2" rx="5.2" ry="3" fill="#f97316"/>
      </g>
      <!-- Open book pages held by Sprig -->
      <g class="sprig-book">
        <path d="M35 89c11-4 21-1 28 7 7-8 17-11 28-7l-2 22c-10-4-19-1-26 5-7-6-16-9-26-5l-2-22z" fill="#ffffff" stroke="#16a34a" stroke-width="2.4" stroke-linejoin="round"/>
        <path d="M63 96v20" stroke="#16a34a" stroke-width="2.2" stroke-linecap="round"/>
        <path d="M42 96c5-1 10 0 14 2.5M43 102c5-1 10 0 14 2.5" stroke="#bbf7d0" stroke-width="2.6" stroke-linecap="round"/>
        <path d="M70 98.5c4-2.5 9-3.5 14-2.5M70 104.5c4-2.5 9-3.5 14-2.5" stroke="#bbf7d0" stroke-width="2.6" stroke-linecap="round"/>
        <!-- Little white hands holding the book -->
        <ellipse cx="36" cy="91" rx="6" ry="5" fill="#ffffff" stroke="#16a34a" stroke-width="2"/>
        <ellipse cx="90" cy="88" rx="6.5" ry="4.8" fill="#ffffff" stroke="#16a34a" stroke-width="2"/>
      </g>
    </g>
  </svg>`;
}

export function renderVoiceWave() {
  return '<span class="duo-voice-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>';
}

export function renderPracticeMascot({ heading = '', bubbleHtml = '', answered = false, correct = false, combo = 0, retry = false, talking = false } = {}) {
  const mood = answered ? (correct ? 'celebrate' : 'encourage') : 'thinking';
  const asset = mood === 'celebrate' ? 'assets/keepvocab-sprig-celebrate.webp'
    : mood === 'encourage' ? 'assets/keepvocab-sprout-mascot.webp'
      : 'assets/keepvocab-sprig-thinking.webp';
  const comboBadge = combo >= 3
    ? `<span class="duo-combo-badge"><i class="fa-solid fa-fire" aria-hidden="true"></i> ${combo} in a row</span>`
    : retry
      ? '<span class="duo-retry-badge"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i> Previous mistake</span>'
      : '';
  const mascotHtml = talking
    ? `<button type="button" class="duo-prompt-mascot duo-talking-mascot" data-sprig-talk data-sound="none" aria-label="Tap Sprig to replay pronunciation">${renderTalkingSprigSvg(mood)}</button>`
    : `<img class="duo-prompt-mascot" src="${asset}" alt="" aria-hidden="true" width="108" height="108">`;
  return `<div class="duo-stage-heading">${heading ? `<h2>${escapeHtml(heading)}</h2>` : ''}${comboBadge}</div>
    <div class="duo-prompt-row is-${mood}${talking ? ' has-talking-mascot' : ''}${talking && isSpeechActive() ? ' is-talking' : ''}">
      ${mascotHtml}
      <div class="duo-speech-bubble">${bubbleHtml}</div>
    </div>`;
}

// Keep Talking Sprig's mouth, sound waves, and voice equalizer in exact sync
// with speech playback, auto-cleaning up when the view re-renders.
export function bindTalkingMascot(container, onReplay = null) {
  if (!container) return () => {};
  const row = container.querySelector('.duo-prompt-row');
  if (!row) return () => {};

  if (typeof onReplay === 'function') {
    row.querySelector('[data-sprig-talk]')?.addEventListener('click', () => onReplay());
  }

  let unsubscribe = () => {};
  const syncState = ({ speaking } = {}) => {
    if (!container.contains?.(row) && row.isConnected === false) {
      unsubscribe();
      return;
    }
    row.classList.toggle('is-talking', Boolean(speaking));
  };

  syncState({ speaking: isSpeechActive() });
  unsubscribe = onSpeechStateChange(syncState);
  return unsubscribe;
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
