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
} from '../data/speakingLessons.js?v=93';
import { GeminiLiveSession } from '../services/geminiLive.js?v=113';
import { getGeminiSettings } from '../services/geminiSettings.js?v=113';
import { driveSync } from '../services/driveSync.js?v=93';
import { recordSpeakingStats } from '../services/learningStats.js?v=93';
import { buildVocabularySpeakingInstruction, selectSpeakingTargets, speakingSessionHighlights, storeSpeakingActivations } from '../services/speakingVocabulary.js?v=93';
import { buildPhraseCoachingInstruction, detectUsedPhrases, lessonPhraseLibraryEntries, phraseLearningStatus, recordPhrasePractice, saveLessonPhrasesToLibrary, selectPhrasesForLesson } from '../services/speakingPhrases.js?v=93';
import { recordModeWordSelections } from '../services/wordSelection.js?v=93';
import { navigateTo as navigate } from '../utils/navigation.js';
import { LITHUANIAN_UNITS, PATH_STAGES } from '../data/lithuanianCurriculum.js?v=111';
import { LITHUANIAN_A2_SPEAKING_SCENARIOS } from '../data/lithuanianSpeakingScenarios.js?v=114';
import { getLastSpeechErrorCode, speakText } from '../services/speechService.js?v=113';
import { translateLithuanianCoachText } from '../services/lithuanianEnrichment.js?v=113';

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

function mergeTranscript(entries, role, text) {
  const clean = String(text || '').trim();
  if (!clean) return entries;
  const last = entries.at(-1);
  if (last?.role === role) {
    last.text = `${last.text} ${clean}`.trim();
    if (role === 'coach') {
      last.translation = '';
      last.translationPending = false;
    }
  }
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

function buildLithuanianInstruction(lesson) {
  const phrases = lesson.lithuanianPhrases || [];
  return `You are Sprig, KeepVocab's patient Lithuanian speaking coach. Run a short live conversation entirely in Lithuanian at ${lesson.level} level.
Scenario: ${lesson.title}. Goal: ${lesson.goal}
Use short, natural sentences and vocabulary from these authored targets: ${phrases.map(item => `${item.lt} = ${item.en}`).join('; ')}.
Start slowly in Lithuanian. When the learner is stuck, repeat more slowly, then give a Lithuanian hint. Give a brief English rescue only after the learner remains stuck.
Verify communicative meaning, phrase use, and important grammar honestly. Never invent phoneme scores, pronunciation percentages, or claim precision the system does not have.
After each learner turn, respond naturally before correcting at most one important issue. Keep turns under four sentences.`;
}

function coachInstruction(lesson, reason = 'start', phraseTargets = []) {
  if (lesson.languageCode !== 'lt') return reason === 'silence'
    ? buildCoachInitiativeCue(lesson, 'silence', phraseTargets)
    : buildCoachInitiativeCue(lesson, 'start', phraseTargets);
  const first = lesson.lithuanianPhrases?.[0]?.lt || 'Labas!';
  return reason === 'silence'
    ? `[Internal direction: the learner is quiet. Reassure them in simple Lithuanian, offer two short Lithuanian replies including “${first}”, and ask one easy question. Use English only if the Lithuanian hint still fails.]`
    : `[Internal direction: begin immediately in Lithuanian, set the scenario in one short sentence, and ask an easy question that invites “${first}”.]`;
}

function speakingInstruction(lesson, phraseTargets, vocabularyTargets) {
  if (lesson.languageCode === 'lt') return buildLithuanianInstruction(lesson);
  return `${buildSpeakingInstruction(lesson, phraseTargets)}${buildVocabularySpeakingInstruction(vocabularyTargets)}${buildPhraseCoachingInstruction(phraseTargets)}`;
}

export const LITHUANIAN_SPEAKING_VARIANTS = [
  { id: 'guided', label: 'Guided role-play', duration: 7, phraseOffset: 0, goal: 'Use visible models, then recall them after a short delay.', twist: 'Ask one realistic follow-up using only familiar A1–A2 Lithuanian.' },
  { id: 'challenge', label: 'Follow-up challenge', duration: 8, phraseOffset: 1, goal: 'Handle a change, clarification, or unexpected follow-up.', twist: 'Change one practical detail and let the learner repair the conversation in simple Lithuanian.' },
  { id: 'fluency', label: 'Speak from memory', duration: 6, phraseOffset: 2, goal: 'Keep the exchange moving with fewer visible prompts.', twist: 'Revisit an earlier question in a new way and wait longer before offering a model.' }
];
export const LITHUANIAN_SPEAKING_TOPICS = Object.freeze([...LITHUANIAN_UNITS, ...LITHUANIAN_A2_SPEAKING_SCENARIOS]);

function lithuanianSpeakingLesson(unit, variantId = 'guided') {
  const variant = LITHUANIAN_SPEAKING_VARIANTS.find(item => item.id === variantId) || LITHUANIAN_SPEAKING_VARIANTS[0];
  return {
    id: variant.id === 'guided' ? `lt-speaking-${unit.id}` : `lt-speaking-${unit.id}-${variant.id}`,
    title: `${unit.title} · ${variant.label}`,
    unitId: unit.id,
    variantId: variant.id,
    variantLabel: variant.label,
    category: 'everyday',
    level: unit.cefr,
    duration: variant.duration,
    goal: `${unit.outcome} ${variant.goal}`,
    learnerRole: 'a Lithuanian learner in a practical situation',
    coachRole: 'a patient Lithuanian conversation partner',
    targetPhrases: unit.phrases.map(item => item.lt),
    lithuanianPhrases: unit.phrases,
    languageCode: 'lt',
    coachQuestions: unit.phrases.slice(0, 3).map(item => `Respond using: ${item.en}`),
    scenarioTwist: variant.twist
  };
}

export function getLithuanianSpeakingLessons(unit) {
  return LITHUANIAN_SPEAKING_VARIANTS.map(variant => lithuanianSpeakingLesson(unit, variant.id));
}

function lithuanianPhraseTargets(unit, variantId = 'guided') {
  const variant = LITHUANIAN_SPEAKING_VARIANTS.find(item => item.id === variantId) || LITHUANIAN_SPEAKING_VARIANTS[0];
  const phrases = unit.phrases.length
    ? unit.phrases.map((_, index, items) => items[(index + variant.phraseOffset) % items.length]).slice(0, 3)
    : [];
  return phrases.map((item, index) => ({
    text: item.lt,
    meaning: item.en,
    example: item.lt,
    progressId: `${unit.id}:lt-${index}`
  }));
}

function renderLithuanianSpeakingPreview(container, unit, onNavigate, variantId = 'guided') {
  if (!unit) return renderLithuanianSpeakingCatalog(container, onNavigate);
  const lesson = lithuanianSpeakingLesson(unit, variantId);
  const phraseTargets = lithuanianPhraseTargets(unit, lesson.variantId);
  const hasKey = Boolean(getGeminiKey());
  const plan = [
    ['Warm up', `Hear and repeat “${phraseTargets[0].text}”.`],
    ['Guided reply', 'Answer one short question with a visible model nearby.'],
    ['Recall', 'Hide the model and answer again from memory.'],
    ['Real turn', 'Handle one realistic follow-up in the same situation.'],
    ['Repair', 'Ask for repetition or clarification if you need it.']
  ];
  const moduleLabel = unit.speakingStageTitle || `Module ${unit.unitNumber}`;
  container.innerHTML = `<section class="full-view-stack speaking-preview-shell"><button class="speaking-back" id="lesson-back"><i class="fa-solid fa-arrow-left"></i> All lessons</button>
    <div class="speaking-preview-card">
      <div class="preview-main"><div class="preview-lesson-icon green"><i class="fa-solid fa-comments"></i></div><span class="eyebrow">${escapeHtml(moduleLabel)} · ${escapeHtml(unit.cefr)} · ${escapeHtml(lesson.variantLabel)}</span><h1>${escapeHtml(unit.title)}</h1><p class="preview-goal">${escapeHtml(lesson.goal)}</p>
        <div class="role-play-box"><i class="fa-solid fa-masks-theater"></i><div><strong>Your role</strong><span>${escapeHtml(lesson.learnerRole)}</span></div><i class="fa-solid fa-arrow-right"></i><div><strong>Sprig’s role</strong><span>${escapeHtml(lesson.coachRole)}</span></div></div>
        <div class="target-phrases phrase-learning-preview"><div class="phrase-preview-heading"><span>Expressions you’ll remember</span><small>Meaning first → recall later → reuse near the end</small></div>${phraseTargets.map((target, index) => `<article><div><strong lang="lt">${escapeHtml(target.text)}</strong><button type="button" data-lt-preview-audio="${index}" aria-label="Hear ${escapeHtml(target.text)}"><i class="fa-solid fa-volume-high"></i> Hear</button></div><p>${escapeHtml(target.meaning)}</p><small>Listen now, then recall it during the conversation.</small></article>`).join('')}</div>
        <p class="lt-preview-audio-status" data-lt-preview-audio-status role="status" aria-live="polite">Use Hear to check each phrase before the live role-play.</p>
        <div class="preview-actions"><button class="btn-green-solid start-live-lesson" id="start-live-lesson"><i class="fa-solid ${hasKey ? 'fa-microphone' : 'fa-key'}"></i> ${hasKey ? 'Start live lesson' : 'Set up Gemini to start'}</button><button class="status-pill offline" id="cant-speak-now"><i class="fa-solid fa-keyboard"></i> Can’t speak now</button><span><i class="fa-regular fa-clock"></i> About ${lesson.duration} minutes</span></div>
      </div>
      <aside class="preview-side lesson-plan-side"><div class="preview-orb-wrap">${renderVoiceOrb('preview')}</div><h2>Your lesson plan</h2><ol class="lesson-plan-list">${plan.map(step => `<li><b>${escapeHtml(step[0])}</b><span>${escapeHtml(step[1])}</span></li>`).join('')}</ol><p class="mic-privacy"><i class="fa-solid fa-lock"></i> Your microphone starts only after you press Start and allow access.</p></aside>
    </div></section>`;
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  container.querySelector('#lesson-back')?.addEventListener('click', () => renderLithuanianSpeakingCatalog(container, onNavigate));
  container.querySelector('#start-live-lesson')?.addEventListener('click', () => {
    if (!getGeminiKey()) return navigate('settings', onNavigate);
    startLiveLesson(container, lesson, [], phraseTargets, onNavigate);
  });
  container.querySelector('#cant-speak-now')?.addEventListener('click', () => navigate('useit', onNavigate));
  container.querySelectorAll('[data-lt-preview-audio]').forEach(button => button.addEventListener('click', async () => {
    const target = phraseTargets[Number(button.dataset.ltPreviewAudio)];
    const status = container.querySelector('[data-lt-preview-audio-status]');
    button.disabled = true;
    if (status) status.textContent = 'Playing in Lithuanian…';
    const played = await speakText(target.text, { locale: 'lt-LT', rate: 0.84 });
    if (status) status.textContent = played ? `${target.text} · ${target.meaning}` : getLastSpeechErrorCode() === 'invalid-gemini-key' ? 'The saved Gemini key was rejected. Open Audio & Gemini to replace it.' : 'Lithuanian audio needs an lt-LT device voice or Gemini setup.';
    button.disabled = false;
  }));
}

function renderLithuanianSpeakingCatalog(container, onNavigate) {
  const profile = driveSync.getCourseProfile('lithuanian') || {};
  const completed = new Set(profile.speakingProgress?.completed || []);
  const nextUnitIndex = Math.min(35, Math.floor((profile.completedNodeIds || []).length / 6));
  const recommended = LITHUANIAN_UNITS[nextUnitIndex] || LITHUANIAN_UNITS[0];
  let stageFilter = String(recommended.sectionNumber);
  let levelFilter = 'all';
  const openLesson = (unit, variantId = 'guided') => renderLithuanianSpeakingPreview(container, unit, onNavigate, variantId);
  const freeUnit = { ...recommended, id: 'lt-free-conversation', title: 'Free Lithuanian conversation', outcome: 'Choose a familiar topic and keep a natural Lithuanian conversation going.' };

  const renderLessons = () => {
    const filteredUnits = LITHUANIAN_SPEAKING_TOPICS.filter(unit => (stageFilter === 'all' || String(unit.speakingStageId || unit.sectionNumber) === stageFilter) && (levelFilter === 'all' || unit.cefr === levelFilter));
    const filtered = filteredUnits.flatMap(unit => getLithuanianSpeakingLessons(unit).map(lesson => ({ unit, lesson })));
    const grid = container.querySelector('#speaking-lesson-grid');
    const count = container.querySelector('#speaking-result-count');
    if (!grid || !count) return;
    count.textContent = `${filtered.length} ${filtered.length === 1 ? 'session' : 'sessions'}`;
    grid.innerHTML = filtered.map(({ unit, lesson }, index) => {
      const done = completed.has(lesson.id);
      const stage = unit.speakingStageTitle
        ? { title: unit.speakingStageTitle }
        : PATH_STAGES.find(item => unit.unitNumber >= item.unitStart && unit.unitNumber <= item.unitEnd) || PATH_STAGES[0];
      return `<article class="speaking-lesson-card" style="--lesson-index:${Math.min(index, 8)}" data-lesson-card="${escapeHtml(lesson.id)}">
        <div class="lesson-icon green"><i class="fa-solid fa-comments"></i>${done ? '<span class="lesson-done"><i class="fa-solid fa-check"></i></span>' : ''}</div>
        <div class="lesson-card-copy"><div class="lesson-card-heading"><h3>${escapeHtml(unit.title)}</h3><span>${escapeHtml(lesson.variantLabel)}</span></div>
        <div class="lesson-meta"><span>${escapeHtml(unit.cefr)}</span><span>${escapeHtml(stage.title)}</span><span><i class="fa-regular fa-clock"></i> ${lesson.duration} min</span></div><p>${escapeHtml(lesson.goal)}</p></div>
        <button class="lesson-start-btn" data-lt-speaking="${unit.id}" data-lt-variant="${lesson.variantId}" aria-label="${done ? 'Practise again' : 'Start'} ${escapeHtml(lesson.title)}">${done ? 'Practise again' : 'Start'} <i class="fa-solid fa-arrow-right"></i></button>
      </article>`;
    }).join('');
    grid.querySelectorAll('[data-lt-speaking]').forEach(button => button.addEventListener('click', () => openLesson(LITHUANIAN_SPEAKING_TOPICS.find(unit => unit.id === button.dataset.ltSpeaking), button.dataset.ltVariant)));
  };

  container.innerHTML = `<section class="speaking-hub full-view-stack" aria-labelledby="speaking-heading">
    <div class="speaking-title-row"><div><span class="eyebrow"><i class="fa-solid fa-comments"></i> ${LITHUANIAN_SPEAKING_TOPICS.length * LITHUANIAN_SPEAKING_VARIANTS.length} Lithuanian conversations · ${(LITHUANIAN_SPEAKING_TOPICS.filter(unit => unit.cefr === 'A2').length * LITHUANIAN_SPEAKING_VARIANTS.length)} at A2</span><h1 id="speaking-heading">Speak Lithuanian</h1><p>Try each topic as a guided role-play, a realistic follow-up challenge, and a from-memory conversation.</p></div><button class="speaking-settings-btn" id="speaking-settings"><i class="fa-solid fa-key"></i><span>Audio & Gemini</span></button></div>
    <section class="speaking-hero"><div class="speaking-hero-copy"><span class="hero-kicker">Recommended · Module ${recommended.unitNumber}</span><h2>${escapeHtml(recommended.title)}</h2><p>${escapeHtml(recommended.outcome)}</p><div class="weekly-progress"><div><span>Speaking progress</span><strong>${completed.size} completed conversations</strong></div><i><b style="width:${Math.round(Math.min(1, completed.size / Math.max(1, LITHUANIAN_SPEAKING_TOPICS.length * LITHUANIAN_SPEAKING_VARIANTS.length)) * 100)}%"></b></i></div><div class="hero-action-row"><button class="btn-green-solid hero-continue" id="speaking-continue">Continue lesson <i class="fa-solid fa-arrow-right"></i></button><div><strong lang="lt">${escapeHtml(recommended.phrases[0].lt)}</strong><span>${escapeHtml(recommended.phrases[0].en)}</span></div></div></div><div class="speaking-hero-visual">${renderVoiceOrb('preview')}<span class="floating-word one">Labas</span><span class="floating-word two">Ačiū</span><span class="floating-word three">Prašau</span></div></section>
    <div class="speaking-filter-row" aria-label="Speaking lesson filters"><div class="speaking-category-tabs"><button data-lt-speaking-stage="all"><i class="fa-solid fa-grip"></i> All topics</button>${PATH_STAGES.map(stage => `<button class="${String(stage.number) === stageFilter ? 'active' : ''}" data-lt-speaking-stage="${stage.number}"><i class="fa-solid fa-map-signs"></i> ${escapeHtml(stage.title)}</button>`).join('')}<button class="${stageFilter === 'a2-lab' ? 'active' : ''}" data-lt-speaking-stage="a2-lab"><i class="fa-solid fa-comments"></i> A2 conversation lab</button></div><label class="speaking-level-filter">Your level <select id="lt-speaking-level"><option value="all">All levels</option>${['A1', 'A2', 'B1 bridge'].map(level => `<option value="${escapeHtml(level)}">${escapeHtml(level)}</option>`).join('')}</select></label></div>
    <div class="speaking-curriculum-heading"><div><h2>Choose a Lithuanian session</h2><p>Each topic has guided, challenge, and from-memory versions so you can build real conversational range.</p></div><span id="speaking-result-count"></span></div>
    <div class="speaking-lesson-grid" id="speaking-lesson-grid"></div>
    <section class="free-conversation-card"><div class="free-chat-icon"><i class="fa-solid fa-comment-dots"></i><i class="fa-solid fa-comment"></i></div><div><span>${escapeHtml(recommended.cefr)} open practice</span><h2>Free conversation</h2><p>Choose a familiar topic; Sprig will keep the language level-sensitive and offer Lithuanian hints first.</p><div class="free-topic-pills"><span>Daily life</span><span>Study</span><span>Plans</span><span>Surprise me</span></div></div><button id="start-lt-free-conversation">Start free chat <i class="fa-solid fa-wave-square"></i></button></section>
    <aside class="speaking-privacy-note"><i class="fa-solid fa-shield-halved"></i><div><strong>Your microphone stays private until Start</strong><p>Gemini connects only when a live role-play begins. Typed replies remain available in every session.</p></div></aside>
  </section>`;
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  container.querySelector('#speaking-continue')?.addEventListener('click', () => openLesson(recommended));
  container.querySelector('#speaking-settings')?.addEventListener('click', () => navigate('settings', onNavigate));
  container.querySelector('#start-lt-free-conversation')?.addEventListener('click', () => openLesson(freeUnit));
  container.querySelectorAll('[data-lt-speaking-stage]').forEach(button => button.addEventListener('click', () => {
    stageFilter = button.dataset.ltSpeakingStage;
    container.querySelectorAll('[data-lt-speaking-stage]').forEach(item => item.classList.toggle('active', item === button));
    renderLessons();
  }));
  container.querySelector('#lt-speaking-level')?.addEventListener('change', event => {
    levelFilter = event.target.value;
    stageFilter = 'all';
    container.querySelectorAll('[data-lt-speaking-stage]').forEach(item => item.classList.toggle('active', item.dataset.ltSpeakingStage === 'all'));
    renderLessons();
  });
  renderLessons();
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
  const vocabularyTargets = selectSpeakingTargets(driveSync.getWords(), { limit: 3, lesson });
  const phraseTargets = selectPhrasesForLesson(lesson, readProgress(), { limit: 2 });
  container.innerHTML = `<section class="full-view-stack speaking-preview-shell"><button class="speaking-back" id="lesson-back"><i class="fa-solid fa-arrow-left"></i> All lessons</button>
    <div class="speaking-preview-card">
      <div class="preview-main"><div class="preview-lesson-icon ${category?.tone || 'green'}"><i class="fa-solid ${lessonIcon(lesson)}"></i></div><span class="eyebrow">${escapeHtml(category?.label || 'Open practice')} · ${escapeHtml(lesson.level)}</span><h1>${escapeHtml(lesson.title)}</h1><p class="preview-goal">${escapeHtml(lesson.goal)}</p>
        <div class="role-play-box"><i class="fa-solid fa-masks-theater"></i><div><strong>Your role</strong><span>${escapeHtml(lesson.learnerRole)}</span></div><i class="fa-solid fa-arrow-right"></i><div><strong>Mira’s role</strong><span>${escapeHtml(lesson.coachRole)}</span></div></div>
        ${vocabularyTargets.length ? `<div class="speaking-vocabulary-targets"><span>Words to activate</span><div>${vocabularyTargets.map(word => `<button type="button" title="${escapeHtml(word.definition)}">${escapeHtml(word.word)}</button>`).join('')}</div><small>Mira will create natural openings for these words without giving them away.</small></div>` : ''}
        <div class="target-phrases phrase-learning-preview"><div class="phrase-preview-heading"><span>Expressions you’ll remember</span><small>Meaning first → recall later → reuse near the end</small></div>${phraseTargets.map(target => { const learning = phraseLearningStatus(target, readProgress()); return `<article><div><strong>${escapeHtml(target.text)}</strong><em>${escapeHtml(learning.label)}</em></div><p>${escapeHtml(target.meaning)}</p><small>“${escapeHtml(target.example)}”</small></article>`; }).join('')}</div>
        <div class="preview-actions"><button class="btn-green-solid start-live-lesson" id="start-live-lesson"><i class="fa-solid fa-microphone"></i> ${hasKey ? 'Start live lesson' : 'Set up Gemini to start'}</button><button class="status-pill offline" id="cant-speak-now"><i class="fa-solid fa-keyboard"></i> Can’t speak now</button><span><i class="fa-regular fa-clock"></i> About ${lesson.duration} minutes</span></div>
      </div>
      <aside class="preview-side lesson-plan-side"><div class="preview-orb-wrap">${renderVoiceOrb('preview')}</div><h2>Your lesson plan</h2><ol class="lesson-plan-list">${lessonPlan.map(step => `<li><b>${escapeHtml(step.phase)}</b><span>${escapeHtml(step.detail)}</span></li>`).join('')}</ol><p class="mic-privacy"><i class="fa-solid fa-lock"></i> Your microphone starts only after you press Start and allow access.</p></aside>
    </div></section>`;
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  container.querySelector('#lesson-back').addEventListener('click', () => renderCatalog(container, onNavigate));
  container.querySelector('#start-live-lesson').addEventListener('click', () => {
    if (!getGeminiKey()) return navigate('settings', onNavigate);
    recordModeWordSelections(driveSync, vocabularyTargets, { mode: 'speaking' });
    startLiveLesson(container, lesson, vocabularyTargets, phraseTargets, onNavigate);
  });
  container.querySelector('#cant-speak-now').addEventListener('click', () => navigate('useit', onNavigate));
}

async function startLiveLesson(container, lesson, vocabularyTargets, phraseTargets, onNavigate) {
  if (activeSession) await activeSession.disconnect();
  activeSession = new GeminiLiveSession();
  const transcript = [];
  const startedAt = Date.now();
  let status = 'connecting';
  let muted = false;
  let phraseIndex = 0;
  let phraseHidden = false;
  let translationTimer = null;
  const coachName = lesson.languageCode === 'lt' ? 'Sprig' : 'Mira';

  const clearInitiativeTimer = () => {
    window.clearTimeout(initiativeTimer);
    initiativeTimer = null;
  };
  const scheduleInitiative = () => {
    clearInitiativeTimer();
    if (muted || status !== 'listening' || activeSession !== session) return;
    initiativeTimer = window.setTimeout(() => {
      if (muted || status !== 'listening' || activeSession !== session) return;
      const sent = session.sendText(coachInstruction(lesson, 'silence', phraseTargets));
      if (sent) updateStatus('helping');
    }, COACH_SILENCE_MS);
  };

  const updateStatus = nextStatus => {
    status = nextStatus;
    const label = container.querySelector('#live-status-label');
    const turnCue = container.querySelector('#live-turn-cue');
    const interruptButton = container.querySelector('#interrupt-live-coach');
    const orb = container.querySelector('#speaking-orb');
    if (label) label.textContent = ({ connecting: 'Connecting securely…', ready: 'Preparing microphone…', listening: `Your turn — ${coachName} is listening`, speaking: `${coachName}’s turn — listening is paused`, helping: `${coachName} is helping you continue…`, muted: 'Microphone paused', closed: 'Lesson ended' })[status] || status;
    if (turnCue) turnCue.textContent = status === 'speaking'
      ? `Want to answer now? Start speaking to interrupt, or tap Stop ${coachName}.`
      : status === 'listening'
        ? `Speak now. ${coachName} will wait until your turn is complete.`
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
    list.innerHTML = transcript.length ? transcript.map(entry => `<div class="transcript-turn ${entry.role}"><span>${entry.role === 'coach' ? coachName : 'You'}</span><p>${escapeHtml(entry.text)}</p>${lesson.languageCode === 'lt' && entry.role === 'coach' ? `<small class="transcript-translation${entry.translationPending ? ' pending' : ''}">${escapeHtml(entry.translation || (entry.translationPending ? 'Translating…' : 'English translation unavailable'))}</small>` : ''}</div>`).join('') : '<div class="transcript-empty"><i class="fa-solid fa-wave-square"></i><span>Your live transcript will appear here.</span></div>';
    list.scrollTop = list.scrollHeight;
    const learnerTurns = transcript.filter(entry => entry.role === 'learner').length;
    if (phraseTargets.length && learnerTurns >= 2 && learnerTurns % 2 === 0) {
      phraseIndex = Math.min(phraseTargets.length - 1, Math.floor(learnerTurns / 2));
    }
    const target = phraseTargets[phraseIndex];
    const phraseText = container.querySelector('#live-target-phrase');
    const phraseMeaning = container.querySelector('#live-target-meaning');
    const phraseStage = container.querySelector('#live-phrase-stage');
    if (target && phraseText) phraseText.textContent = phraseHidden ? 'Say it from memory…' : target.text;
    if (target && phraseMeaning) phraseMeaning.textContent = target.meaning;
    if (phraseStage) phraseStage.textContent = learnerTurns < 2 ? 'Meet it in context' : learnerTurns < 5 ? 'Recall after a delay' : 'Reuse it once more';
  };

  const translateLatestCoachTurn = async () => {
    if (lesson.languageCode !== 'lt') return;
    const entry = [...transcript].reverse().find(item => item.role === 'coach' && item.text && !item.translation);
    if (!entry) return;
    if (entry.translationPending && entry.translationPromise) return entry.translationPromise;
    const source = entry.text;
    entry.translationPending = true;
    renderTranscript();
    entry.translationPromise = translateLithuanianCoachText(source)
      .then(translation => {
        if (entry.text === source) entry.translation = translation;
      })
      .catch(() => {
        if (entry.text === source) entry.translation = 'English translation is temporarily unavailable.';
      })
      .finally(() => {
        if (entry.text === source) entry.translationPending = false;
        entry.translationPromise = null;
        renderTranscript();
      });
    return entry.translationPromise;
  };
  const scheduleCoachTranslation = (delay = 650) => {
    if (lesson.languageCode !== 'lt') return;
    window.clearTimeout(translationTimer);
    translationTimer = window.setTimeout(() => { void translateLatestCoachTurn(); }, delay);
  };

  container.innerHTML = `<section class="speaking-live-shell" aria-labelledby="live-lesson-title">
    <header class="live-header"><button id="live-back" class="speaking-back"><i class="fa-solid fa-chevron-left"></i> Leave</button><div><span>Live lesson</span><h1 id="live-lesson-title">${escapeHtml(lesson.title)}</h1></div><time id="live-timer">00:00</time></header>
    <div class="live-stage">
      <main class="live-coach-panel"><div class="live-status-pill"><i></i><span id="live-status-label">Connecting securely…</span></div>${renderVoiceOrb('connecting')}<div class="coach-identity"><strong>${coachName}</strong><span>${lesson.languageCode === 'lt' ? 'Your Lithuanian speaking coach' : 'Your AI speaking coach'}</span></div><p class="live-prompt">${escapeHtml(lesson.goal)}</p><p class="live-turn-cue" id="live-turn-cue" aria-live="polite">Setting up clear turn-by-turn audio…</p>
        <div class="live-controls"><button id="interrupt-live-coach" class="live-control interrupt" hidden><i class="fa-solid fa-hand"></i><span>Stop ${coachName}</span></button><button id="toggle-live-mic" class="live-control"><i class="fa-solid fa-microphone"></i><span>Mute</span></button><button id="end-live-lesson" class="end-lesson-button"><i class="fa-solid fa-stop"></i><span>End lesson</span></button></div>
        <form id="live-text-fallback" class="live-text-fallback"><input id="live-text-input" lang="${lesson.languageCode === 'lt' ? 'lt' : 'en'}" placeholder="${lesson.languageCode === 'lt' ? 'Arba parašykite atsakymą…' : 'Or type a reply'}" autocomplete="off"><button aria-label="Send typed reply"><i class="fa-solid fa-paper-plane"></i></button></form>
      </main>
      <aside class="live-side-panel"><div class="live-goal-card"><span>Lesson goal</span><p>${escapeHtml(lesson.goal)}</p></div>${vocabularyTargets.length ? `<div class="live-vocabulary-card"><span>Scenario-matched words</span><div>${vocabularyTargets.map(word => `<b>${escapeHtml(word.word)}</b>`).join('')}</div></div>` : ''}<div class="live-plan-card"><span>Today’s route</span><ol>${getLessonPlan(lesson).map(step => `<li>${escapeHtml(step.phase)}</li>`).join('')}</ol></div><div class="live-phrase-card"><div><span id="live-phrase-stage">Meet it in context</span><small>${phraseIndex + 1} of ${phraseTargets.length}</small></div><strong id="live-target-phrase">${escapeHtml(phraseTargets[0]?.text || '')}</strong><p id="live-target-meaning">${escapeHtml(phraseTargets[0]?.meaning || '')}</p><div><button id="hide-live-phrase">Hide & recall <i class="fa-solid fa-eye-slash"></i></button><button id="next-live-phrase">Next expression <i class="fa-solid fa-rotate"></i></button></div></div><div class="live-transcript-card"><div><span>Live transcript</span><small>${lesson.languageCode === 'lt' ? 'English shown under every Sprig turn' : 'Generated by Gemini'}</small></div><div id="live-transcript" class="live-transcript" aria-live="polite"></div></div></aside>
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
  session.addEventListener('transcript', event => {
    mergeTranscript(transcript, event.detail.role, event.detail.text);
    renderTranscript();
    if (event.detail.role === 'coach') scheduleCoachTranslation();
  });
  session.addEventListener('turncomplete', () => {
    scheduleInitiative();
    scheduleCoachTranslation(0);
  });
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
  container.querySelector('#hide-live-phrase').addEventListener('click', event => {
    phraseHidden = !phraseHidden;
    const target = phraseTargets[phraseIndex];
    container.querySelector('#live-target-phrase').textContent = phraseHidden ? 'Say it from memory…' : target.text;
    event.currentTarget.innerHTML = phraseHidden ? 'Reveal <i class="fa-solid fa-eye"></i>' : 'Hide & recall <i class="fa-solid fa-eye-slash"></i>';
  });
  container.querySelector('#next-live-phrase').addEventListener('click', () => {
    phraseIndex = (phraseIndex + 1) % phraseTargets.length;
    phraseHidden = false;
    const target = phraseTargets[phraseIndex];
    container.querySelector('#live-target-phrase').textContent = target.text;
    container.querySelector('#live-target-meaning').textContent = target.meaning;
    container.querySelector('#hide-live-phrase').innerHTML = 'Hide & recall <i class="fa-solid fa-eye-slash"></i>';
  });
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
    window.clearTimeout(translationTimer);
    window.clearInterval(sessionTimer);
    sessionTimer = null;
    await translateLatestCoachTurn();
    await session.disconnect();
    if (activeSession === session) activeSession = null;
    completeSpeakingLesson(container, lesson, vocabularyTargets, phraseTargets, transcript, Math.max(1, Math.round((Date.now() - startedAt) / 60000)), onNavigate);
  };
  container.querySelector('#end-live-lesson').addEventListener('click', finish);
  container.querySelector('#live-back').addEventListener('click', finish);

  try {
    await session.startMicrophone();
    await session.prepareAudioOutput();
    await session.connect({ apiKey: getGeminiKey(), model: getGeminiSettings().liveModel, instruction: speakingInstruction(lesson, phraseTargets, vocabularyTargets) });
    session.sendText(coachInstruction(lesson, 'start', phraseTargets));
    scheduleInitiative();
  } catch (error) {
    clearInitiativeTimer();
    await session.disconnect().catch(() => {});
    if (activeSession === session) activeSession = null;
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

function completeSpeakingLesson(container, lesson, vocabularyTargets, phraseTargets, transcript, minutes, onNavigate) {
  const coachName = lesson.languageCode === 'lt' ? 'Sprig' : 'Mira';
  const progress = readProgress();
  progress.completed = [...new Set([...(progress.completed || []), lesson.id])];
  progress.lastLessonId = lesson.id;
  progress.lastCompletedAt = new Date().toISOString();
  const phrasePractice = recordPhrasePractice(progress, phraseTargets, transcript);
  progress.phraseProgress = phrasePractice.phraseProgress;
  writeProgress(progress);
  recordSpeakingStats({ minutes });
  const learnerTurns = transcript.filter(entry => entry.role === 'learner').length;
  const usedPhrases = detectUsedPhrases(phraseTargets, transcript);
  const activations = storeSpeakingActivations(vocabularyTargets, transcript, driveSync);
  const highlights = speakingSessionHighlights(transcript, activations);
  const allLessonPhrases = lesson.languageCode === 'lt' ? lesson.lithuanianPhrases.map(item => ({ word: item.lt, definition: item.en })) : lessonPhraseLibraryEntries(lesson);
  let savedPhraseCount = 0;
  let phraseSaveError = '';
  try {
    savedPhraseCount = lesson.languageCode === 'lt'
      ? driveSync.addWords(lesson.lithuanianPhrases.map(item => ({ word: item.lt, lemma: item.lt, translation: item.en, definition: item.en, acceptedForms: item.acceptedForms, partOfSpeech: 'phrase', languageCode: 'lt', source: 'KeepVocab Lithuanian lesson' }))).length
      : saveLessonPhrasesToLibrary(lesson, driveSync).saved.length;
  } catch (error) {
    phraseSaveError = error instanceof Error ? error.message : String(error);
  }
  container.innerHTML = `<section class="speaking-summary-shell"><div class="speaking-summary-card"><div class="summary-celebration" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><span><i class="fa-solid fa-check"></i></span></div><span class="eyebrow">Lesson complete</span><h1>Nice work — you showed up and spoke.</h1><p>${escapeHtml(lesson.title)} is now part of your speaking progress.</p><div class="summary-metrics"><div><strong>${minutes}</strong><span>minutes</span></div><div><strong>${learnerTurns}</strong><span>your turns</span></div><div><strong>${usedPhrases.length}/${phraseTargets.length}</strong><span>expressions recalled</span></div></div>
    ${vocabularyTargets.length ? `<div class="speaking-activation-summary"><div><span>Activated</span><strong>${highlights.used.length ? highlights.used.map(word => escapeHtml(word.word)).join(' · ') : 'None yet'}</strong></div><div><span>Try next time</span><strong>${highlights.unused.length ? highlights.unused.map(word => escapeHtml(word.word)).join(' · ') : 'All target words used'}</strong></div></div>` : ''}
    ${highlights.strongest.length ? `<div class="summary-strong-responses"><span>Your strongest response${highlights.strongest.length > 1 ? 's' : ''}</span>${highlights.strongest.map(text => `<blockquote>“${escapeHtml(text)}”</blockquote>`).join('')}</div>` : ''}
    <div class="speaking-library-save ${phraseSaveError ? 'error' : ''}"><i class="fa-solid ${phraseSaveError ? 'fa-circle-exclamation' : 'fa-book-bookmark'}"></i><div><strong>${phraseSaveError ? 'The lesson phrases could not be saved' : `${allLessonPhrases.length} lesson expressions are in your Library`}</strong><p>${phraseSaveError ? escapeHtml(phraseSaveError) : savedPhraseCount ? `${savedPhraseCount} new expression${savedPhraseCount === 1 ? '' : 's'} added with ${savedPhraseCount === 1 ? 'its' : 'their'} idiomatic ${savedPhraseCount === 1 ? 'meaning' : 'meanings'}.` : 'They were already saved, so no duplicates were created.'}</p></div></div>
    <div class="summary-takeaway"><i class="fa-solid fa-lightbulb"></i><div><strong>${usedPhrases.length ? `Next recall in ${phrasePractice.results.find(item => item.target.progressId === usedPhrases[0].progressId)?.intervalDays || 1} day${(phrasePractice.results.find(item => item.target.progressId === usedPhrases[0].progressId)?.intervalDays || 1) === 1 ? '' : 's'}` : 'This expression returns tomorrow'}</strong><p>${escapeHtml((usedPhrases[0] || phraseTargets[0])?.text || '')}</p></div></div>
    <div class="summary-actions"><button class="btn-green-solid" id="summary-again">Practice again</button><button class="status-pill offline" id="summary-lessons">All lessons</button></div></div>
    <div class="summary-transcript spec-card"><div class="card-header-bar"><div class="card-tag"><i class="fa-solid fa-align-left"></i> Session transcript</div><span>${transcript.length} turns</span></div>${transcript.length ? transcript.map(entry => `<div class="transcript-turn ${entry.role}"><span>${entry.role === 'coach' ? coachName : 'You'}</span><p>${escapeHtml(entry.text)}</p>${lesson.languageCode === 'lt' && entry.role === 'coach' ? `<small class="transcript-translation">${escapeHtml(entry.translation || 'English translation is temporarily unavailable.')}</small>` : ''}</div>`).join('') : '<p class="summary-empty">No transcript was received. You still completed the practice session.</p>'}</div></section>`;
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  container.querySelector('#summary-again').addEventListener('click', () => {
    if (lesson.languageCode === 'lt') renderLithuanianSpeakingCatalog(container, onNavigate);
    else renderLessonPreview(container, lesson.id, onNavigate);
  });
  container.querySelector('#summary-lessons').addEventListener('click', () => {
    if (lesson.languageCode === 'lt') renderLithuanianSpeakingCatalog(container, onNavigate);
    else renderCatalog(container, onNavigate);
  });
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
  if (driveSync.getActiveCourseId() === 'lithuanian') renderLithuanianSpeakingCatalog(container, onNavigate);
  else renderCatalog(container, onNavigate);
}

export { mergeTranscript, readProgress };
