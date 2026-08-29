import { driveSync } from '../services/driveSync.js?v=93';
import { getLithuanianSession, getLithuanianUnit } from '../data/lithuanianCurriculum.js?v=111';
import { startLessonAttempt, recordLessonResponse, advanceLessonAttempt, answerMatches, completionEvidence } from '../services/lessonEngine.js?v=111';
import { getLastSpeechErrorCode, getSpeechAvailability, speakText } from '../services/speechService.js?v=111';
import { escapeHtml } from '../utils/html.js';

let lessonSpeechActive = false;

function exerciseLabel(type) {
  return ({ pattern: 'Guidebook', cloze: 'Missing word', dictation: 'Dictation', matching: 'Matching', 'meaning-choice': 'Meaning choice', 'listening-choice': 'Listening', 'read-repeat': 'Speaking practice', 'role-play': 'Speaking practice', 'typed-recall': 'Typed recall', 'word-order': 'Word order' })[type] || type.replaceAll('-', ' ');
}

function matchingControls(exercise) {
  const pairs = exercise.matchPairs || [];
  return `<div class="lesson-match-help">Choose one Lithuanian phrase, then choose its English meaning.</div>
    <div class="lesson-match-board" data-match-board>
      <section><span>LITHUANIAN</span>${pairs.map(pair => `<button type="button" class="lesson-choice" data-match-lt="${escapeHtml(pair.key)}" lang="lt">${escapeHtml(pair.lt)}</button>`).join('')}</section>
      <section><span>ENGLISH</span>${[...pairs].reverse().map(pair => `<button type="button" class="lesson-choice" data-match-en="${escapeHtml(pair.key)}">${escapeHtml(pair.en)}</button>`).join('')}</section>
    </div>
    <p class="lesson-match-status" data-match-status role="status" aria-live="polite">0 of ${pairs.length} pairs matched</p>`;
}

function answerControls(exercise) {
  if (['meaning-choice', 'listening-choice'].includes(exercise.type)) {
    return `<div class="lesson-choice-grid">${exercise.choices.map(choice => `<button type="button" class="lesson-choice" data-choice-answer="${escapeHtml(choice)}">${escapeHtml(choice)}</button>`).join('')}</div>`;
  }
  if (exercise.type === 'matching') return matchingControls(exercise);
  if (exercise.type === 'word-order') {
    return `<div class="word-order-answer" id="word-order-answer" aria-live="polite"><span>Build the phrase here</span></div>
      <div class="word-token-bank">${exercise.tokens.map((token, index) => `<button type="button" class="word-token" data-token-index="${index}">${escapeHtml(token)}</button>`).join('')}</div>
      <div class="word-order-actions"><button type="button" class="status-pill offline" data-word-undo disabled><i class="fa-solid fa-rotate-left"></i> Undo</button><button type="button" class="status-pill offline" data-word-reset disabled>Reset</button></div>`;
  }
  if (['read-repeat', 'role-play'].includes(exercise.type)) {
    return `<div class="speaking-practice-card"><span>PHRASE TO PRACTISE</span><strong lang="lt">${escapeHtml(exercise.phrase.lt)}</strong><p>${escapeHtml(exercise.phrase.en)}</p><small>Say the whole phrase aloud. This repetition is recorded as practice, not as a pronunciation score.</small></div>
      <div class="lesson-speaking-actions"><button type="button" class="status-pill offline" data-skip-speaking>Skip for now</button><button type="button" class="btn-green-solid" data-spoke>Done</button></div>`;
  }
  if (exercise.type === 'pattern') {
    return `<div class="pattern-discovery"><span>USEFUL FORM</span><strong lang="lt">${escapeHtml(exercise.phrase.lt)}</strong><p>${escapeHtml(exercise.phrase.en)}</p><div class="pattern-parts">${exercise.phrase.lt.split(/\s+/).map((word, index) => `<span class="part-${index % 3}">${escapeHtml(word)}</span>`).join('')}</div></div><button type="button" class="btn-green-solid lesson-understood" data-practice-done>Continue</button>`;
  }
  if (['dialogue', 'mission'].includes(exercise.type)) {
    return `<div class="dialogue-answer-row"><label for="lesson-answer">Your reply in Lithuanian</label><textarea id="lesson-answer" rows="2" lang="lt" autocomplete="off" spellcheck="false" placeholder="Type the requested reply…"></textarea></div><button type="submit" class="btn-green-solid">Check reply</button>`;
  }
  const placeholder = exercise.type === 'cloze' ? 'Missing Lithuanian word' : 'Type in Lithuanian';
  return `<label class="lesson-input-label" for="lesson-answer">Your answer</label><input id="lesson-answer" lang="lt" autocomplete="off" spellcheck="false" placeholder="${placeholder}"><button type="submit" class="btn-green-solid">Check</button>`;
}

function exerciseContext(exercise) {
  if (exercise.type !== 'cloze') return '';
  return `<div class="lesson-cloze-context">
    <div><span>ENGLISH CUE</span><p>${escapeHtml(exercise.phrase.en)}</p></div>
    <strong lang="lt">${escapeHtml(exercise.clozePrompt || exercise.answer)}</strong>
    <small>Type the missing Lithuanian word. The complete phrase is also accepted.</small>
  </div>`;
}

function lessonScene(exercise, unit) {
  if (!['dialogue', 'mission'].includes(exercise.type)) return '';
  const icon = exercise.type === 'mission' ? 'fa-location-dot' : 'fa-comments';
  return `<div class="lesson-dialogue-scene" aria-label="Guided ${exercise.type} situation">
    <div class="dialogue-place"><i class="fa-solid ${icon}" aria-hidden="true"></i><span>${escapeHtml(unit.title)}</span></div>
    <div class="guided-situation"><span>SITUATION</span><strong>${escapeHtml(unit.outcome)}</strong></div>
    <div class="dialogue-turn learner"><img src="assets/keepvocab-sprout-mascot.webp" alt="" aria-hidden="true"><div class="scene-bubble"><span>YOUR CLEAR GOAL</span><strong>${escapeHtml(exercise.phrase.en)}</strong></div></div>
  </div>`;
}

function audioControls(exercise) {
  if (!exercise.audioText) return '';
  return `<div class="listen-controls lesson-listen-controls">
      <button class="audio-btn-circle large" type="button" data-play-audio aria-label="Play Lithuanian audio"><i class="fa-solid fa-volume-high"></i></button>
      <button class="status-pill offline" type="button" data-play-audio-slow><i class="fa-solid fa-gauge-simple-low"></i> Slow</button>
    </div>
    <p class="speech-help lesson-audio-status" role="status" aria-live="polite"><span data-audio-status>Checking Lithuanian audio…</span><button type="button" data-audio-setup hidden>Audio settings</button></p>`;
}

function coachMarkup(exercise) {
  const guidance = exercise.type === 'matching' ? 'Choose a Lithuanian card first, then its English match.'
    : ['read-repeat', 'role-play'].includes(exercise.type) ? 'Listen once at normal speed, then use Slow if needed.'
      : exercise.type === 'listening-choice' ? 'Listen more than once before using the English rescue.'
        : 'Try retrieving the Lithuanian before you reveal the model.';
  return `<div class="lesson-coach"><img src="assets/keepvocab-sprig-thinking.webp" alt=""><p><strong>Sprig’s hint:</strong> ${escapeHtml(guidance)}</p><button type="button" data-hint>Hint</button></div>`;
}

function hintText(exercise) {
  if (exercise.type === 'matching') return '<strong>How it works:</strong> Pair one card from each column. Completed pairs disappear from play.';
  if (exercise.type === 'cloze') return `<strong>Small hint:</strong> The missing word starts with “${escapeHtml(exercise.clozeAnswer?.[0] || '')}”.<br><span>English rescue: ${escapeHtml(exercise.phrase.en)}</span>`;
  if (exercise.type === 'word-order') return `<strong>Start here:</strong> ${escapeHtml(exercise.answer.split(/\s+/)[0])}<br><span>English rescue: ${escapeHtml(exercise.phrase.en)}</span>`;
  if (['read-repeat', 'role-play'].includes(exercise.type)) return '<strong>Say it in chunks:</strong> Listen on Slow, pause, then repeat the complete phrase.';
  return `<strong>Lietuviškai:</strong> ${escapeHtml(exercise.phrase.lt)}<br><span>English rescue: ${escapeHtml(exercise.phrase.en)}</span>`;
}

export function lessonVocabularyRecords(session, unit) {
  const phrases = [];
  const seen = new Set();
  for (const exercise of session.exercises || []) {
    const phrase = exercise.phrase;
    const key = `${phrase?.lt || ''}|${phrase?.en || ''}`.toLocaleLowerCase('lt-LT');
    if (!phrase?.lt || !phrase?.en || seen.has(key)) continue;
    seen.add(key);
    phrases.push(phrase);
  }
  return phrases.map((phrase, index) => ({
    id: `lt-course-${unit.id}-phrase-${index + 1}`,
    senseId: `lt-course-${unit.id}-sense-${index + 1}`,
    courseId: 'lithuanian', languageCode: 'lt', word: phrase.lt, lemma: phrase.lt,
    definition: phrase.en, translation: phrase.en, acceptedForms: phrase.acceptedForms,
    partOfSpeech: 'phrase', grammaticalTags: [`Module ${unit.unitNumber}`, unit.grammar], source: 'lesson'
  }));
}

function addLessonVocabularyToLibrary(session, unit) {
  const existing = driveSync.getAllWords();
  const missing = lessonVocabularyRecords(session, unit).filter(candidate => !existing.some(word =>
    word.id === candidate.id || ((word.courseId || 'english') === 'lithuanian'
      && String(word.word || '').trim().toLocaleLowerCase('lt-LT') === candidate.word.trim().toLocaleLowerCase('lt-LT')
      && String(word.definition || '').trim().toLowerCase() === candidate.definition.trim().toLowerCase())
  ));
  if (!missing.length) return 0;
  try { driveSync.addWords(missing); return missing.length; }
  catch (error) { console.warn('[LessonMode] Some lesson vocabulary was already present.', error); return 0; }
}

function renderExercise(container, session, attempt, navigate) {
  const exercise = session.exercises[attempt.exerciseIndex];
  const unit = getLithuanianUnit(session.unitId);
  const percent = Math.round((attempt.exerciseIndex / session.exercises.length) * 100);
  container.innerHTML = `
    <main class="lesson-shell">
      <header class="lesson-progress-header"><button class="lesson-close" aria-label="Leave lesson"><i class="fa-solid fa-xmark"></i></button><div class="lesson-progress-track"><i style="width:${percent}%"></i></div><span>${attempt.exerciseIndex + 1} / ${session.exercises.length}</span></header>
      <section class="lesson-card ${exercise.type}">
        <div class="lesson-type-line"><span>${escapeHtml(exerciseLabel(exercise.type))}</span><small>Module ${unit.unitNumber} · ${escapeHtml(unit.cefr)}</small></div>
        ${lessonScene(exercise, unit)}${audioControls(exercise)}
        <div class="lesson-prompt"><h1>${escapeHtml(exercise.prompt)}</h1>${exercise.instruction ? `<p>${escapeHtml(exercise.instruction)}</p>` : ''}</div>
        ${exerciseContext(exercise)}
        <form class="lesson-answer-form">${answerControls(exercise)}</form>
        <div class="lesson-feedback" aria-live="polite"></div>${coachMarkup(exercise)}
      </section>
    </main>`;

  const persist = nextAttempt => {
    const profile = driveSync.getCourseProfile('lithuanian') || {};
    driveSync.updateCourseProfile('lithuanian', { lessonAttempts: { ...(profile.lessonAttempts || {}), [session.id]: nextAttempt } });
  };
  const finishResponse = ({ response, correct, skipped = false, unscored = false, hintUsed = false }) => {
    let next = recordLessonResponse(attempt, exercise, { response, correct, skipped, unscored, hintUsed });
    const feedback = container.querySelector('.lesson-feedback');
    feedback.className = `lesson-feedback show ${unscored || skipped ? 'skipped' : correct ? 'correct' : 'incorrect'}`;
    if (unscored) feedback.innerHTML = `<i class="fa-solid fa-circle-check"></i><div><strong>Practice recorded.</strong><p>${escapeHtml(exercise.phrase.lt)} · This activity is not scored.</p></div>`;
    else if (correct) feedback.innerHTML = `<i class="fa-solid fa-circle-check"></i><div><strong>Taip — that works.</strong><p>${escapeHtml(exercise.phrase.lt)} · ${escapeHtml(exercise.phrase.en)}</p></div>`;
    else if (skipped) feedback.innerHTML = '<i class="fa-solid fa-forward"></i><div><strong>Speaking skipped.</strong><p>You can repeat this in a later review.</p></div>';
    else {
      const model = exercise.type === 'cloze' ? `${exercise.clozeAnswer} · ${exercise.answer}` : exercise.answer;
      feedback.innerHTML = `<i class="fa-solid fa-seedling"></i><div><strong>Almost. Check the model.</strong><p>${escapeHtml(model)} · ${escapeHtml(exercise.rescue)}</p></div>`;
    }
    container.querySelectorAll('button, input, textarea').forEach(control => { if (!control.matches('.lesson-close')) control.disabled = true; });
    const nextButton = document.createElement('button');
    nextButton.type = 'button'; nextButton.className = 'btn-green-solid lesson-next';
    nextButton.textContent = attempt.exerciseIndex + 1 >= session.exercises.length ? 'Finish lesson' : 'Continue';
    feedback.append(nextButton); persist(next);
    nextButton.addEventListener('click', () => {
      next = advanceLessonAttempt(next, session); persist(next);
      if (next.status === 'completed') renderComplete(container, session, next, navigate); else renderExercise(container, session, next, navigate);
    });
  };

  container.querySelector('.lesson-close')?.addEventListener('click', () => navigate('learn'));
  container.querySelector('[data-audio-setup]')?.addEventListener('click', () => navigate('settings'));
  if (exercise.audioText) getSpeechAvailability('lt-LT').then(availability => {
    const status = container.querySelector('[data-audio-status]');
    const setup = container.querySelector('[data-audio-setup]');
    if (!status) return;
    if (availability.source === 'device') status.textContent = `${availability.voiceName || 'Lithuanian'} voice is ready on this device.`;
    else if (availability.source === 'android') status.textContent = 'Android Lithuanian speech is ready.';
    else if (availability.source === 'gemini') status.textContent = 'Gemini Lithuanian audio is configured. Use Listen to verify the saved key.';
    else if (availability.source === 'browser') status.textContent = 'The device speech engine will try the lt-LT language voice.';
    else {
      status.textContent = 'Lithuanian audio needs a device voice or Gemini setup.';
      if (setup) setup.hidden = false;
    }
  }).catch(() => {});
  const playAudio = async (button, rate) => {
    const controls = [...container.querySelectorAll('[data-play-audio], [data-play-audio-slow]')];
    controls.forEach(control => { control.disabled = true; });
    lessonSpeechActive = true; button.classList.add('playing');
    const status = container.querySelector('[data-audio-status]');
    const setup = container.querySelector('[data-audio-setup]');
    if (status) status.textContent = rate < 0.8 ? 'Playing slowly in Lithuanian…' : 'Playing in Lithuanian…';
    const ok = await speakText(exercise.audioText, { locale: 'lt-LT', rate });
    lessonSpeechActive = false; button.classList.remove('playing'); controls.forEach(control => { control.disabled = false; });
    if (status) status.textContent = ok ? 'Played in Lithuanian. Tap again to repeat.' : getLastSpeechErrorCode() === 'invalid-gemini-key' ? 'The saved Gemini key was rejected. Open Audio settings to replace it.' : 'Lithuanian audio could not start on this device.';
    if (setup) setup.hidden = ok;
  };
  container.querySelector('[data-play-audio]')?.addEventListener('click', event => playAudio(event.currentTarget, 0.86));
  container.querySelector('[data-play-audio-slow]')?.addEventListener('click', event => playAudio(event.currentTarget, 0.68));
  container.querySelector('[data-hint]')?.addEventListener('click', event => {
    event.currentTarget.disabled = true; container.querySelector('.lesson-coach p').innerHTML = hintText(exercise);
    attempt = { ...attempt, hintsUsed: Number(attempt.hintsUsed || 0) + 1 }; persist(attempt);
  });
  container.querySelectorAll('[data-choice-answer]').forEach(button => button.addEventListener('click', () => finishResponse({ response: button.dataset.choiceAnswer, correct: button.dataset.choiceAnswer === exercise.phrase.en })));

  if (exercise.type === 'matching') {
    const matched = new Set(); let selectedLt = null; let selectedEn = null;
    const updateMatch = () => {
      const status = container.querySelector('[data-match-status]');
      if (!selectedLt || !selectedEn) return;
      const ltButton = container.querySelector(`[data-match-lt="${CSS.escape(selectedLt)}"]`);
      const enButton = container.querySelector(`[data-match-en="${CSS.escape(selectedEn)}"]`);
      if (selectedLt === selectedEn) {
        matched.add(selectedLt); [ltButton, enButton].forEach(button => { button.classList.add('matched'); button.disabled = true; button.setAttribute('aria-pressed', 'true'); });
        selectedLt = null; selectedEn = null; status.textContent = `${matched.size} of ${exercise.matchPairs.length} pairs matched`;
        if (matched.size === exercise.matchPairs.length) finishResponse({ response: [...matched].join(','), correct: true });
        return;
      }
      [ltButton, enButton].forEach(button => button?.classList.add('incorrect')); status.textContent = 'Those do not match. Try another pair.';
      window.setTimeout(() => { [ltButton, enButton].forEach(button => button?.classList.remove('selected', 'incorrect')); selectedLt = null; selectedEn = null; if (status) status.textContent = `${matched.size} of ${exercise.matchPairs.length} pairs matched`; }, 420);
    };
    container.querySelectorAll('[data-match-lt]').forEach(button => button.addEventListener('click', () => { container.querySelectorAll('[data-match-lt]').forEach(item => item.classList.remove('selected')); selectedLt = button.dataset.matchLt; button.classList.add('selected'); updateMatch(); }));
    container.querySelectorAll('[data-match-en]').forEach(button => button.addEventListener('click', () => { container.querySelectorAll('[data-match-en]').forEach(item => item.classList.remove('selected')); selectedEn = button.dataset.matchEn; button.classList.add('selected'); updateMatch(); }));
  }

  const ordered = [];
  const refreshWordOrder = () => {
    const output = container.querySelector('#word-order-answer');
    if (output) output.innerHTML = ordered.length ? escapeHtml(ordered.map(item => item.text).join(' ')) : '<span>Build the phrase here</span>';
    const undo = container.querySelector('[data-word-undo]'); const reset = container.querySelector('[data-word-reset]');
    if (undo) undo.disabled = !ordered.length; if (reset) reset.disabled = !ordered.length;
  };
  container.querySelectorAll('.word-token').forEach(button => button.addEventListener('click', () => {
    if (button.disabled) return; ordered.push({ index: Number(button.dataset.tokenIndex), text: button.textContent }); button.disabled = true; refreshWordOrder();
    if (ordered.length === exercise.tokens.length) { const response = ordered.map(item => item.text).join(' '); finishResponse({ response, correct: answerMatches(exercise, response) }); }
  }));
  container.querySelector('[data-word-undo]')?.addEventListener('click', () => { const item = ordered.pop(); if (item) container.querySelector(`[data-token-index="${item.index}"]`).disabled = false; refreshWordOrder(); });
  container.querySelector('[data-word-reset]')?.addEventListener('click', () => { ordered.splice(0); container.querySelectorAll('.word-token').forEach(button => { button.disabled = false; }); refreshWordOrder(); });
  container.querySelector('[data-practice-done]')?.addEventListener('click', () => finishResponse({ response: '[guidebook viewed]', correct: false, unscored: true }));
  container.querySelector('[data-spoke]')?.addEventListener('click', () => finishResponse({ response: '[speaking practised]', correct: false, unscored: true }));
  container.querySelector('[data-skip-speaking]')?.addEventListener('click', () => finishResponse({ response: '', correct: false, skipped: true }));
  container.querySelector('.lesson-answer-form')?.addEventListener('submit', event => { event.preventDefault(); const response = container.querySelector('#lesson-answer')?.value || ''; if (response.trim()) finishResponse({ response, correct: answerMatches(exercise, response) }); });
}

function renderComplete(container, session, attempt, navigate) {
  const profile = driveSync.getCourseProfile('lithuanian') || {}; const unit = getLithuanianUnit(session.unitId);
  const completedNodeIds = [...new Set([...(profile.completedNodeIds || []), session.id])];
  const evidence = completionEvidence(session, attempt);
  const canDoEvidence = [...(profile.canDoEvidence || []).filter(item => item.nodeId !== session.id), evidence];
  driveSync.updateCourseProfile('lithuanian', { completedNodeIds, canDoEvidence, activeLessonId: null });
  const vocabularyAdded = addLessonVocabularyToLibrary(session, unit);
  const scored = attempt.responses.filter(item => !item.skipped && !item.unscored); const correct = scored.filter(item => item.correct).length;
  container.innerHTML = `<main class="lesson-shell lesson-complete-shell"><section class="lesson-complete-card">
    <div class="checkpoint-celebration"><span></span><i class="fa-solid fa-seedling"></i><span></span></div><img src="assets/keepvocab-sprig-celebrate.webp" alt="Sprig celebrating"><span class="learning-kicker">LESSON COMPLETE</span><h1>Puiku! You moved forward.</h1>
    <p>You answered ${correct} of ${scored.length} scored activities successfully.${vocabularyAdded ? ` ${vocabularyAdded} new phrase${vocabularyAdded === 1 ? ' was' : 's were'} added to your Lithuanian Library.` : ' Lesson phrases are already in your Lithuanian Library.'} This is learning evidence, not an official CEFR certificate.</p>
    <div class="lesson-result-grid"><div><strong>${correct}/${scored.length}</strong><span>scored answers</span></div><div><strong>${attempt.hintsUsed || 0}</strong><span>hints</span></div><div><strong>+${vocabularyAdded}</strong><span>library phrases</span></div></div><button class="btn-green-solid" data-back-path>Back to path</button>
  </section></main>`;
  container.querySelector('[data-back-path]')?.addEventListener('click', () => navigate('learn'));
}

export function renderLessonMode(container, navigate) {
  const profile = driveSync.getCourseProfile('lithuanian') || {}; const session = getLithuanianSession(profile.activeLessonId);
  if (!session) { navigate('learn'); return; }
  const attempt = startLessonAttempt(session.id, profile.lessonAttempts?.[session.id]);
  driveSync.updateCourseProfile('lithuanian', { lessonAttempts: { ...(profile.lessonAttempts || {}), [session.id]: attempt } });
  if (attempt.status === 'completed') renderComplete(container, session, attempt, navigate); else renderExercise(container, session, attempt, navigate);
}

export function teardownLessonMode() { lessonSpeechActive = false; }
