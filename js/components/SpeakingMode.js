import { escapeHtml } from '../utils/html.js';
import {
  SPEAKING_CATEGORIES,
  SPEAKING_LESSONS,
  FREE_CONVERSATION_LESSON,
  DEFAULT_SPEAKING_LEVEL,
  getSpeakingLesson,
  getLessonPlan,
  buildCoachInitiativeCue,
  buildSpeakingInstruction
} from '../data/speakingLessons.js?v=79';
import { GeminiLiveSession } from '../services/geminiLive.js?v=79';
import { getGeminiSettings } from '../services/geminiSettings.js?v=79';
import { driveSync } from '../services/driveSync.js?v=79';
import { recordSpeakingStats } from '../services/learningStats.js?v=79';
import { buildVocabularySpeakingInstruction, selectSpeakingTargets, speakingSessionHighlights, storeSpeakingActivations } from '../services/speakingVocabulary.js?v=79';

const PROGRESS_STORAGE = 'keepvocab_speaking_progress_v1';
export const COACH_SILENCE_MS = 9000;
const CATEGORY_BY_ID = new Map(SPEAKING_CATEGORIES.map(category => [category.id, category]));
let activeSession = null;
let sessionTimer = null;
let initiativeTimer = null;

function readProgress() {
  const defaults = { completed: [], lastLessonId: 'rent-apartment', weeklyGoal: 5, level: DEFAULT_SPEAKING_LEVEL };
  try {
    const synced = driveSync.getSettings().speakingProgress;
    const legacy = JSON.parse(localStorage.getItem(PROGRESS_STORAGE) || '{}') || {};
    const saved = synced && typeof synced === 'object' ? synced : legacy;
    return { ...defaults, ...saved, completed: Array.isArray(saved.completed) ? saved.completed : [] };
  } catch {
    return defaults;
  }
}

function writeProgress(progress) {
  localStorage.setItem(PROGRESS_STORAGE, JSON.stringify(progress));
  driveSync.updateSettings({ speakingProgress: progress });
}

function getGeminiKey() {
  return getGeminiSettings().apiKey || '';
}

function navigate(view, onNavigate) {
  if (window.location.hash === `#${view}`) onNavigate(view);
  else window.location.hash = view;
}

function mergeTranscript(entries, role, text) {
  const clean = String(text || '').trim();
  if (!clean) return entries;
  const last = entries.at(-1);
  if (last?.role === role) last.text = `${last.text} ${clean}`.trim();
  else entries.push({ role, text: clean });
  return entries;
}

function lessonIcon(lesson) {
  return CATEGORY_BY_ID.get(lesson.category)?.icon || 'fa-microphone-lines';
}

function renderVoiceOrb(status = 'idle', level = 0) {
  const bars = [0.55, 0.82, 1, 0.72, 0.92, 0.62, 0.78];
  return `<div class="speaking-orb ${escapeHtml(status)}" id="speaking-orb" style="--voice-level:${Math.max(.15, level)}" aria-hidden="true"><span class="orb-ripple one"></span><span class="orb-ripple two"></span><div class="orb-core">${bars.map((height, index) => `<i style="--bar:${height};--bar-delay:${index * 70}ms"></i>`).join('')}</div></div>`;
}

function renderCatalog(container, onNavigate) {
  const progress = readProgress();
  const completed = new Set(progress.completed || []);
  const learnerLevel = progress.level || DEFAULT_SPEAKING_LEVEL;
  const savedLastLesson = getSpeakingLesson(progress.lastLessonId);
  const nextLevelLesson = SPEAKING_LESSONS.find(lesson => lesson.level === learnerLevel && !completed.has(lesson.id));
  const lastLesson = savedLastLesson?.level === learnerLevel
    ? savedLastLesson
    : nextLevelLesson || SPEAKING_LESSONS.find(lesson => lesson.level === learnerLevel) || SPEAKING_LESSONS[15];
  const weeklyCount = Math.min(progress.weeklyGoal || 5, completed.size);
  let categoryFilter = 'all';
  let levelFilter = learnerLevel;

  const renderLessons = () => {
    const filtered = SPEAKING_LESSONS.filter(lesson => (categoryFilter === 'all' || lesson.category === categoryFilter) && (levelFilter === 'all' || lesson.level === levelFilter));
    const grid = container.querySelector('#speaking-lesson-grid');
    const count = container.querySelector('#speaking-result-count');
    if (!grid) return;
    count.textContent = `${filtered.length} ${filtered.length === 1 ? 'lesson' : 'lessons'}`;
    grid.innerHTML = filtered.map((lesson, index) => {
      const category = CATEGORY_BY_ID.get(lesson.category);
      const done = completed.has(lesson.id);
      return `<article class="speaking-lesson-card" style="--lesson-index:${Math.min(index, 8)}" data-lesson-card="${escapeHtml(lesson.id)}">
        <div class="lesson-icon ${escapeHtml(category.tone)}"><i class="fa-solid ${escapeHtml(category.icon)}"></i>${done ? '<span class="lesson-done"><i class="fa-solid fa-check"></i></span>' : ''}</div>
        <div class="lesson-card-copy"><div class="lesson-card-heading"><h3>${escapeHtml(lesson.title)}</h3><span>${escapeHtml(category.label)}</span></div>
        <div class="lesson-meta"><span>${escapeHtml(lesson.level)}</span><span><i class="fa-regular fa-clock"></i> ${lesson.duration} min</span></div>
        <p>${escapeHtml(lesson.goal)}</p></div>
        <button class="lesson-start-btn" data-open-speaking-lesson="${escapeHtml(lesson.id)}" aria-label="${done ? 'Practice again' : 'Start'} ${escapeHtml(lesson.title)}">${done ? 'Practice again' : 'Start'} <i class="fa-solid fa-arrow-right"></i></button>
      </article>`;
    }).join('');
    grid.querySelectorAll('[data-open-speaking-lesson]').forEach(button => button.addEventListener('click', () => renderLessonPreview(container, button.dataset.openSpeakingLesson, onNavigate)));
  };

  container.innerHTML = `<section class="speaking-hub full-view-stack" aria-labelledby="speaking-heading">
    <div class="speaking-title-row"><div><span class="eyebrow"><i class="fa-solid fa-microphone-lines"></i> Live conversation practice · ${escapeHtml(learnerLevel)}</span><h1 id="speaking-heading">AI Speaking</h1><p>Upper-intermediate conversations with useful, focused feedback.</p></div><button class="speaking-settings-btn" id="speaking-settings" title="Gemini connection settings"><i class="fa-solid fa-key"></i><span>Gemini setup</span></button></div>
    <section class="speaking-hero">
      <div class="speaking-hero-copy"><span class="hero-kicker">Your ${escapeHtml(learnerLevel)} pathway</span><h2>Speak with confidence and precision</h2><p>Explain ideas in detail, handle nuanced situations, and turn recurring mistakes into useful habits.</p>
        <div class="weekly-progress"><div><span>Weekly progress</span><strong>${weeklyCount} of ${progress.weeklyGoal || 5} lessons</strong></div><i><b style="width:${Math.round(weeklyCount / Math.max(1, progress.weeklyGoal || 5) * 100)}%"></b></i></div>
        <div class="hero-action-row"><button class="btn-green-solid hero-continue" id="speaking-continue">${completed.has(lastLesson.id) ? 'Practice again' : 'Continue lesson'} <i class="fa-solid fa-arrow-right"></i></button><div><strong>${escapeHtml(lastLesson.title)}</strong><span>${lastLesson.level} · ${lastLesson.duration} min</span></div></div>
      </div>
      <div class="speaking-hero-visual">${renderVoiceOrb('preview')}<span class="floating-word one">Try it</span><span class="floating-word two">You’ve got this</span><span class="floating-word three">Speak freely</span></div>
    </section>
    <div class="speaking-filter-row" aria-label="Speaking lesson filters">
      <div class="speaking-category-tabs"><button class="active" data-speaking-category="all"><i class="fa-solid fa-grip"></i> All topics</button>${SPEAKING_CATEGORIES.map(category => `<button data-speaking-category="${category.id}"><i class="fa-solid ${category.icon}"></i> ${escapeHtml(category.label)}</button>`).join('')}</div>
      <label class="speaking-level-filter">Your level <select id="speaking-level"><option value="all">All levels</option>${['A1', 'A2', 'B1', 'B2', 'C1'].map(level => `<option${level === levelFilter ? ' selected' : ''}>${level}</option>`).join('')}</select></label>
    </div>
    <div class="speaking-curriculum-heading"><div><h2>Choose a ${escapeHtml(learnerLevel)} lesson</h2><p>Practise longer answers, precise vocabulary, negotiation, discussion, and natural self-correction.</p></div><span id="speaking-result-count"></span></div>
    <div class="speaking-lesson-grid" id="speaking-lesson-grid"></div>
    <section class="free-conversation-card"><div class="free-chat-icon"><i class="fa-solid fa-comment-dots"></i><i class="fa-solid fa-comment"></i></div><div><span>${escapeHtml(learnerLevel)} open practice</span><h2>Free conversation</h2><p>Choose any topic; Mira will expect detailed answers, follow-up reasoning, and natural paraphrasing.</p><div class="free-topic-pills"><span>Current events</span><span>Work and study</span><span>Culture</span><span>Surprise me</span></div></div><button id="start-free-conversation">Start free chat <i class="fa-solid fa-wave-square"></i></button></section>
    <aside class="speaking-privacy-note"><i class="fa-solid fa-shield-halved"></i><div><strong>Your privacy matters</strong><p>Gemini connects only after you press Start. Your key stays in KeepVocab storage and joins your private Drive backup when sync is enabled.</p></div></aside>
  </section>`;
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });

  container.querySelector('#speaking-continue').addEventListener('click', () => renderLessonPreview(container, lastLesson.id, onNavigate));
  container.querySelector('#start-free-conversation').addEventListener('click', () => renderLessonPreview(container, FREE_CONVERSATION_LESSON.id, onNavigate));
  container.querySelector('#speaking-settings').addEventListener('click', () => navigate('settings', onNavigate));
  container.querySelectorAll('[data-speaking-category]').forEach(button => button.addEventListener('click', () => {
    categoryFilter = button.dataset.speakingCategory;
    container.querySelectorAll('[data-speaking-category]').forEach(item => item.classList.toggle('active', item === button));
    renderLessons();
  }));
  container.querySelector('#speaking-level').addEventListener('change', event => {
    levelFilter = event.target.value;
    if (levelFilter === 'all') return renderLessons();
    progress.level = levelFilter;
    progress.lastLessonId = SPEAKING_LESSONS.find(lesson => lesson.level === levelFilter && !completed.has(lesson.id))?.id
      || SPEAKING_LESSONS.find(lesson => lesson.level === levelFilter)?.id
      || progress.lastLessonId;
    writeProgress(progress);
    renderCatalog(container, onNavigate);
  });
  renderLessons();
}

function renderLessonPreview(container, lessonId, onNavigate) {
  const lesson = getSpeakingLesson(lessonId);
  if (!lesson) return renderCatalog(container, onNavigate);
  const category = CATEGORY_BY_ID.get(lesson.category);
  const hasKey = Boolean(getGeminiKey());
  const lessonPlan = getLessonPlan(lesson);
  const vocabularyTargets = selectSpeakingTargets(driveSync.getWords(), { limit: 3 });
  container.innerHTML = `<section class="full-view-stack speaking-preview-shell"><button class="speaking-back" id="lesson-back"><i class="fa-solid fa-arrow-left"></i> All lessons</button>
    <div class="speaking-preview-card">
      <div class="preview-main"><div class="preview-lesson-icon ${category?.tone || 'green'}"><i class="fa-solid ${lessonIcon(lesson)}"></i></div><span class="eyebrow">${escapeHtml(category?.label || 'Open practice')} · ${escapeHtml(lesson.level)}</span><h1>${escapeHtml(lesson.title)}</h1><p class="preview-goal">${escapeHtml(lesson.goal)}</p>
        <div class="role-play-box"><i class="fa-solid fa-masks-theater"></i><div><strong>Your role</strong><span>${escapeHtml(lesson.learnerRole)}</span></div><i class="fa-solid fa-arrow-right"></i><div><strong>Mira’s role</strong><span>${escapeHtml(lesson.coachRole)}</span></div></div>
        ${vocabularyTargets.length ? `<div class="speaking-vocabulary-targets"><span>Words to activate</span><div>${vocabularyTargets.map(word => `<button type="button" title="${escapeHtml(word.definition)}">${escapeHtml(word.word)}</button>`).join('')}</div><small>Mira will create natural openings for these words without giving them away.</small></div>` : ''}
        <div class="target-phrases"><span>Try these phrases</span>${lesson.targetPhrases.map(phrase => `<button data-copy-phrase="${escapeHtml(phrase)}"><i class="fa-regular fa-copy"></i> ${escapeHtml(phrase)}</button>`).join('')}</div>
        <div class="preview-actions"><button class="btn-green-solid start-live-lesson" id="start-live-lesson"><i class="fa-solid fa-microphone"></i> ${hasKey ? 'Start live lesson' : 'Set up Gemini to start'}</button><button class="status-pill offline" id="cant-speak-now"><i class="fa-solid fa-keyboard"></i> Can’t speak now</button><span><i class="fa-regular fa-clock"></i> About ${lesson.duration} minutes</span></div>
      </div>
      <aside class="preview-side lesson-plan-side"><div class="preview-orb-wrap">${renderVoiceOrb('preview')}</div><h2>Your lesson plan</h2><ol class="lesson-plan-list">${lessonPlan.map(step => `<li><b>${escapeHtml(step.phase)}</b><span>${escapeHtml(step.detail)}</span></li>`).join('')}</ol><p class="mic-privacy"><i class="fa-solid fa-lock"></i> Your microphone starts only after you press Start and allow access.</p></aside>
    </div></section>`;
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  container.querySelector('#lesson-back').addEventListener('click', () => renderCatalog(container, onNavigate));
  container.querySelectorAll('[data-copy-phrase]').forEach(button => button.addEventListener('click', async () => {
    await navigator.clipboard?.writeText(button.dataset.copyPhrase);
    button.classList.add('copied');
    window.setTimeout(() => button.classList.remove('copied'), 700);
  }));
  container.querySelector('#start-live-lesson').addEventListener('click', () => {
    if (!getGeminiKey()) return navigate('settings', onNavigate);
    startLiveLesson(container, lesson, vocabularyTargets, onNavigate);
  });
  container.querySelector('#cant-speak-now').addEventListener('click', () => navigate('useit', onNavigate));
}

async function startLiveLesson(container, lesson, vocabularyTargets, onNavigate) {
  if (activeSession) await activeSession.disconnect();
  activeSession = new GeminiLiveSession();
  const transcript = [];
  const startedAt = Date.now();
  let status = 'connecting';
  let muted = false;

  const clearInitiativeTimer = () => {
    window.clearTimeout(initiativeTimer);
    initiativeTimer = null;
  };
  const scheduleInitiative = () => {
    clearInitiativeTimer();
    if (muted || status !== 'listening' || activeSession !== session) return;
    initiativeTimer = window.setTimeout(() => {
      if (muted || status !== 'listening' || activeSession !== session) return;
      const sent = session.sendText(buildCoachInitiativeCue(lesson, 'silence'));
      if (sent) updateStatus('helping');
    }, COACH_SILENCE_MS);
  };

  const updateStatus = nextStatus => {
    status = nextStatus;
    const label = container.querySelector('#live-status-label');
    const turnCue = container.querySelector('#live-turn-cue');
    const interruptButton = container.querySelector('#interrupt-live-coach');
    const orb = container.querySelector('#speaking-orb');
    if (label) label.textContent = ({ connecting: 'Connecting securely…', ready: 'Preparing microphone…', listening: 'Your turn — Mira is listening', speaking: 'Mira’s turn — listening is paused', helping: 'Mira is helping you continue…', muted: 'Microphone paused', closed: 'Lesson ended' })[status] || status;
    if (turnCue) turnCue.textContent = status === 'speaking'
      ? 'Want to answer now? Start speaking to interrupt, or tap Stop Mira.'
      : status === 'listening'
        ? 'Speak now. Mira will wait until your turn is complete.'
        : status === 'muted'
          ? 'Unmute when you are ready to take your turn.'
          : 'Setting up clear turn-by-turn audio…';
    if (interruptButton) interruptButton.hidden = status !== 'speaking';
    if (orb) orb.className = `speaking-orb ${status}`;
    if (status === 'speaking' || status === 'muted' || status === 'closed') clearInitiativeTimer();
    else if (status === 'listening') scheduleInitiative();
  };
  const renderTranscript = () => {
    const list = container.querySelector('#live-transcript');
    if (!list) return;
    list.innerHTML = transcript.length ? transcript.map(entry => `<div class="transcript-turn ${entry.role}"><span>${entry.role === 'coach' ? 'Mira' : 'You'}</span><p>${escapeHtml(entry.text)}</p></div>`).join('') : '<div class="transcript-empty"><i class="fa-solid fa-wave-square"></i><span>Your live transcript will appear here.</span></div>';
    list.scrollTop = list.scrollHeight;
  };

  container.innerHTML = `<section class="speaking-live-shell" aria-labelledby="live-lesson-title">
    <header class="live-header"><button id="live-back" class="speaking-back"><i class="fa-solid fa-chevron-left"></i> Leave</button><div><span>Live lesson</span><h1 id="live-lesson-title">${escapeHtml(lesson.title)}</h1></div><time id="live-timer">00:00</time></header>
    <div class="live-stage">
      <main class="live-coach-panel"><div class="live-status-pill"><i></i><span id="live-status-label">Connecting securely…</span></div>${renderVoiceOrb('connecting')}<div class="coach-identity"><strong>Mira</strong><span>Your AI speaking coach</span></div><p class="live-prompt">${escapeHtml(lesson.goal)}</p><p class="live-turn-cue" id="live-turn-cue" aria-live="polite">Setting up clear turn-by-turn audio…</p>
        <div class="live-controls"><button id="interrupt-live-coach" class="live-control interrupt" hidden><i class="fa-solid fa-hand"></i><span>Stop Mira</span></button><button id="toggle-live-mic" class="live-control"><i class="fa-solid fa-microphone"></i><span>Mute</span></button><button id="end-live-lesson" class="end-lesson-button"><i class="fa-solid fa-stop"></i><span>End lesson</span></button></div>
        <form id="live-text-fallback" class="live-text-fallback"><input id="live-text-input" placeholder="Or type a reply" autocomplete="off"><button aria-label="Send typed reply"><i class="fa-solid fa-paper-plane"></i></button></form>
      </main>
      <aside class="live-side-panel"><div class="live-goal-card"><span>Lesson goal</span><p>${escapeHtml(lesson.goal)}</p></div>${vocabularyTargets.length ? `<div class="live-vocabulary-card"><span>Words to activate</span><div>${vocabularyTargets.map(word => `<b>${escapeHtml(word.word)}</b>`).join('')}</div></div>` : ''}<div class="live-plan-card"><span>Today’s route</span><ol>${getLessonPlan(lesson).map(step => `<li>${escapeHtml(step.phase)}</li>`).join('')}</ol></div><div class="live-phrase-card"><span>Try a target phrase</span><strong id="live-target-phrase">${escapeHtml(lesson.targetPhrases[0])}</strong><button id="next-live-phrase">Another phrase <i class="fa-solid fa-rotate"></i></button></div><div class="live-transcript-card"><div><span>Live transcript</span><small>Generated by Gemini</small></div><div id="live-transcript" class="live-transcript" aria-live="polite"></div></div></aside>
    </div>
  </section>`;
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  renderTranscript();

  const session = activeSession;
  session.addEventListener('status', event => updateStatus(event.detail));
  session.addEventListener('level', event => {
    const orb = container.querySelector('#speaking-orb');
    if (orb) orb.style.setProperty('--voice-level', Math.max(.15, event.detail));
    if (event.detail > .08 && !muted && status === 'listening') scheduleInitiative();
  });
  session.addEventListener('transcript', event => { mergeTranscript(transcript, event.detail.role, event.detail.text); renderTranscript(); });
  session.addEventListener('turncomplete', scheduleInitiative);
  session.addEventListener('error', event => showLiveError(
    container,
    event.detail?.message || 'The live connection stopped.',
    () => navigate('settings', onNavigate)
  ));

  sessionTimer = window.setInterval(() => {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    const timer = container.querySelector('#live-timer');
    if (timer) timer.textContent = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  }, 1000);
  container.querySelector('#toggle-live-mic').addEventListener('click', event => {
    muted = !muted;
    session.setMuted(muted);
    if (muted) clearInitiativeTimer();
    else scheduleInitiative();
    event.currentTarget.classList.toggle('muted', muted);
    event.currentTarget.innerHTML = `<i class="fa-solid ${muted ? 'fa-microphone-slash' : 'fa-microphone'}"></i><span>${muted ? 'Unmute' : 'Mute'}</span>`;
  });
  container.querySelector('#interrupt-live-coach').addEventListener('click', () => session.interruptOutput('button'));
  let phraseIndex = 0;
  container.querySelector('#next-live-phrase').addEventListener('click', () => { phraseIndex = (phraseIndex + 1) % lesson.targetPhrases.length; container.querySelector('#live-target-phrase').textContent = lesson.targetPhrases[phraseIndex]; });
  container.querySelector('#live-text-fallback').addEventListener('submit', event => {
    event.preventDefault();
    const input = container.querySelector('#live-text-input');
    const text = input.value.trim();
    if (!text || !session.sendText(text)) return;
    clearInitiativeTimer();
    mergeTranscript(transcript, 'learner', text); renderTranscript(); input.value = '';
  });
  const finish = async () => {
    clearInitiativeTimer();
    window.clearInterval(sessionTimer);
    sessionTimer = null;
    await session.disconnect();
    if (activeSession === session) activeSession = null;
    completeSpeakingLesson(container, lesson, vocabularyTargets, transcript, Math.max(1, Math.round((Date.now() - startedAt) / 60000)), onNavigate);
  };
  container.querySelector('#end-live-lesson').addEventListener('click', finish);
  container.querySelector('#live-back').addEventListener('click', finish);

  try {
    await session.prepareAudioOutput();
    await session.connect({ apiKey: getGeminiKey(), model: getGeminiSettings().liveModel, instruction: `${buildSpeakingInstruction(lesson)}${buildVocabularySpeakingInstruction(vocabularyTargets)}` });
    await session.startMicrophone();
    session.sendText(buildCoachInitiativeCue(lesson, 'start'));
    scheduleInitiative();
  } catch (error) {
    clearInitiativeTimer();
    showLiveError(container, error.message, () => navigate('settings', onNavigate));
  }
}

function showLiveError(container, message, onSetup) {
  const panel = container.querySelector('.live-coach-panel');
  panel?.querySelector('.live-error')?.remove();
  panel?.insertAdjacentHTML('beforeend', `<div class="live-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i><div><strong>Live lesson could not start</strong><span>${escapeHtml(message)}</span></div><button id="live-error-setup">Check setup</button></div>`);
  const status = container.querySelector('#live-status-label');
  if (status) status.textContent = 'Connection needs attention';
  container.querySelector('#speaking-orb')?.classList.add('error');
  container.querySelector('#live-error-setup')?.addEventListener('click', onSetup);
}

function completeSpeakingLesson(container, lesson, vocabularyTargets, transcript, minutes, onNavigate) {
  const progress = readProgress();
  progress.completed = [...new Set([...(progress.completed || []), lesson.id])];
  progress.lastLessonId = lesson.id;
  progress.lastCompletedAt = new Date().toISOString();
  writeProgress(progress);
  recordSpeakingStats({ minutes });
  const learnerTurns = transcript.filter(entry => entry.role === 'learner').length;
  const usedPhrases = lesson.targetPhrases.filter(phrase => transcript.some(entry => entry.role === 'learner' && entry.text.toLowerCase().includes(phrase.replace(/[.…?]/g, '').toLowerCase().slice(0, 10))));
  const activations = storeSpeakingActivations(vocabularyTargets, transcript, driveSync);
  const highlights = speakingSessionHighlights(transcript, activations);
  container.innerHTML = `<section class="speaking-summary-shell"><div class="speaking-summary-card"><div class="summary-celebration" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><span><i class="fa-solid fa-check"></i></span></div><span class="eyebrow">Lesson complete</span><h1>Nice work — you showed up and spoke.</h1><p>${escapeHtml(lesson.title)} is now part of your speaking progress.</p><div class="summary-metrics"><div><strong>${minutes}</strong><span>minutes</span></div><div><strong>${learnerTurns}</strong><span>your turns</span></div><div><strong>${usedPhrases.length}/${lesson.targetPhrases.length}</strong><span>target phrases</span></div></div>
    ${vocabularyTargets.length ? `<div class="speaking-activation-summary"><div><span>Activated</span><strong>${highlights.used.length ? highlights.used.map(word => escapeHtml(word.word)).join(' · ') : 'None yet'}</strong></div><div><span>Try next time</span><strong>${highlights.unused.length ? highlights.unused.map(word => escapeHtml(word.word)).join(' · ') : 'All target words used'}</strong></div></div>` : ''}
    ${highlights.strongest.length ? `<div class="summary-strong-responses"><span>Your strongest response${highlights.strongest.length > 1 ? 's' : ''}</span>${highlights.strongest.map(text => `<blockquote>“${escapeHtml(text)}”</blockquote>`).join('')}</div>` : ''}
    <div class="summary-takeaway"><i class="fa-solid fa-lightbulb"></i><div><strong>Keep one phrase</strong><p>${escapeHtml(usedPhrases[0] || lesson.targetPhrases[0])}</p></div></div>
    <div class="summary-actions"><button class="btn-green-solid" id="summary-again">Practice again</button><button class="status-pill offline" id="summary-lessons">All lessons</button></div></div>
    <div class="summary-transcript spec-card"><div class="card-header-bar"><div class="card-tag"><i class="fa-solid fa-align-left"></i> Session transcript</div><span>${transcript.length} turns</span></div>${transcript.length ? transcript.map(entry => `<div class="transcript-turn ${entry.role}"><span>${entry.role === 'coach' ? 'Mira' : 'You'}</span><p>${escapeHtml(entry.text)}</p></div>`).join('') : '<p class="summary-empty">No transcript was received. You still completed the practice session.</p>'}</div></section>`;
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  container.querySelector('#summary-again').addEventListener('click', () => renderLessonPreview(container, lesson.id, onNavigate));
  container.querySelector('#summary-lessons').addEventListener('click', () => renderCatalog(container, onNavigate));
}

export async function teardownSpeakingMode() {
  window.clearTimeout(initiativeTimer);
  initiativeTimer = null;
  window.clearInterval(sessionTimer);
  sessionTimer = null;
  if (activeSession) await activeSession.disconnect();
  activeSession = null;
}

export function renderSpeakingMode(container, onNavigate) {
  renderCatalog(container, onNavigate);
}

export { mergeTranscript, readProgress };
