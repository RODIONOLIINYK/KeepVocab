import { recordLearningExercise, recordSessionCompletion } from '../services/learningStats.js';
import { driveSync } from '../services/driveSync.js?v=1602';
import { getLithuanianSession, getLithuanianUnit } from '../data/lithuanianCurriculum.js?v=1602';
import { startLessonAttempt, recordLessonResponse, advanceLessonAttempt, answerMatches, completionEvidence, isSessionUnlocked } from '../services/lessonEngine.js?v=1602';
import { describeSpeechError, getSpeechAvailability, playAudioUrl, speakText } from '../services/speechService.js?v=1602';
import { getCachedOrGenerateDialogueAudio } from '../services/geminiTts.js?v=1602';
import { buildAdaptiveContext, evaluateListeningResponse, evaluateTranslationResponse, generateDialogueActivity, generateListeningActivity, generateTranslationActivity, processDialogueTurn } from '../services/adaptiveLessons.js?v=1602';
import { escapeHtml } from '../utils/html.js';

let lessonSpeechActive = false;

function exerciseLabel(type) {
  return ({ pattern: 'Guidebook', cloze: 'Missing word', dictation: 'Dictation', matching: 'Matching', 'meaning-choice': 'Meaning choice', 'listening-choice': 'Listening', 'ai-listening': 'AI listening', 'ai-dialogue': 'AI dialogue', 'adaptive-translation': 'Adaptive translation', 'read-repeat': 'Speaking practice', 'role-play': 'Speaking practice', 'typed-recall': 'Typed recall', 'word-order': 'Word order' })[type] || type.replaceAll('-', ' ');
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

function grammarGuideMarkup(exercise) {
  const guide = exercise.guide || {};
  const alphabet = (guide.alphabet || []).length
    ? `<section class="grammar-alphabet" aria-label="Lithuanian alphabet"><span>THE 32 LETTERS</span><div>${guide.alphabet.map(group => `<strong lang="lt">${escapeHtml(group)}</strong>`).join('')}</div></section>`
    : '';
  return `<article class="grammar-guide">
    ${alphabet}
    ${(exercise.teachingPhrases || []).length ? `<section class="lesson-new-vocabulary"><span>PHRASES FOR THIS LESSON</span>${exercise.teachingPhrases.map(phrase => `<div><strong lang="lt">${escapeHtml(phrase.lt)}</strong><span>${escapeHtml(phrase.en)}</span></div>`).join('')}</section>` : ''}
    <section class="grammar-rule"><span>HOW IT WORKS</span><p>${escapeHtml(guide.rule)}</p></section>
    <div class="grammar-form-table" role="table" aria-label="Forms and examples">
      ${(guide.forms || []).map(([label, form, meaning]) => `<div class="grammar-form-row" role="row"><span role="cell">${escapeHtml(label)}</span><strong role="cell" lang="lt">${escapeHtml(form)}</strong><small role="cell">${escapeHtml(meaning)}</small></div>`).join('')}
    </div>
    <aside class="grammar-memory-tip"><i class="fa-solid fa-lightbulb" aria-hidden="true"></i><p><strong>Remember:</strong> ${escapeHtml(guide.tip)}</p></aside>
    <section class="grammar-example"><span>SEE IT IN A SENTENCE</span><strong lang="lt">${escapeHtml(exercise.phrase.lt)}</strong><p>${escapeHtml(exercise.phrase.en)}</p></section>
  </article>`;
}

function answerControls(exercise) {
  if (exercise.type === 'ai-listening') return '<div class="adaptive-ai-host" data-ai-listening><div class="adaptive-loading"><i class="fa-solid fa-wave-square"></i><strong>Preparing a listening at your level…</strong><span>Using your course progress and Lithuanian Library.</span></div></div>';
  if (exercise.type === 'ai-dialogue') return '<div class="adaptive-ai-host" data-ai-dialogue><div class="adaptive-loading"><i class="fa-solid fa-comments"></i><strong>Preparing your conversation partner…</strong><span>Gemini will respond to the meaning of your Lithuanian.</span></div></div>';
  if (exercise.type === 'adaptive-translation') return '<div class="adaptive-ai-host" data-adaptive-translation><div class="adaptive-loading"><i class="fa-solid fa-arrow-right-arrow-left"></i><strong>Building an adaptive sentence…</strong><span>Length and vocabulary grow with your progress.</span></div></div>';
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
    return `${grammarGuideMarkup(exercise)}<button type="button" class="btn-green-solid lesson-understood" data-practice-done>I understand — practise it</button>`;
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
  return `<div class="lesson-audio-panel"><div class="listen-controls lesson-listen-controls">
      <button class="audio-btn-circle large" type="button" data-play-audio aria-label="Play Lithuanian audio"><i class="fa-solid fa-volume-high"></i></button>
      <button class="status-pill offline" type="button" data-play-audio-slow><i class="fa-solid fa-gauge-simple-low"></i> Slow</button>
    </div>
    <p class="speech-help lesson-audio-status" role="status" aria-live="polite"><span data-audio-status>Checking Lithuanian audio…</span><button type="button" data-audio-setup hidden>Audio settings</button></p></div>`;
}

function coachMarkup(exercise) {
  if (['pattern', 'ai-listening', 'ai-dialogue', 'adaptive-translation'].includes(exercise.type)) return '';
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

function adaptiveSourceLabel(activity) {
  return activity?.aiGenerated ? 'Adapted by Gemini' : 'Authored offline fallback';
}

function learningSupport(exercise, unit) {
  const phrases = exercise.type === 'matching' ? exercise.matchPairs : [exercise.phrase];
  return `<aside class="lesson-learning-support" aria-label="Learn as you answer"><span class="learning-kicker">LEARN AS YOU GO</span>
    ${phrases.map(phrase => `<div class="lesson-teaching-pair"><strong lang="lt">${escapeHtml(phrase.lt)}</strong><span>${escapeHtml(phrase.en)}</span></div>`).join('')}
    <p>Use this help while you answer. You will practise remembering it later.</p>
    <details><summary>See the language pattern</summary>${grammarGuideMarkup({ guide: unit.guide, phrase: exercise.phrase })}</details></aside>`;
}

function transcriptMarkup(activity, hidden = true) {
  return `<div class="adaptive-transcript" data-adaptive-transcript ${hidden ? 'hidden' : ''}>${(activity.transcript || []).map(turn => `<p><strong>${escapeHtml(turn.speaker)}</strong><span lang="lt">${escapeHtml(turn.text)}</span></p>`).join('')}</div>`;
}

export function lessonVocabularyRecords(session, unit) {
  const phrases = [];
  const seen = new Set();
  for (const phrase of session.vocabulary || []) {
    const key = `${phrase?.lt || ''}|${phrase?.en || ''}`.toLocaleLowerCase('lt-LT');
    if (!phrase?.lt || !phrase?.en || seen.has(key)) continue;
    seen.add(key);
    phrases.push(phrase);
  }
  return phrases.map(phrase => ({
    id: `lt-course-${unit.id}-v2-${encodeURIComponent(phrase.lt.toLocaleLowerCase('lt-LT'))}`,
    senseId: `lt-course-${unit.id}-sense-v2-${encodeURIComponent(phrase.lt.toLocaleLowerCase('lt-LT'))}`,
    courseId: 'lithuanian', languageCode: 'lt', word: phrase.lt.replace(/[.!?]+$/u, ''), lemma: phrase.lt.replace(/[.!?]+$/u, ''),
    example: phrase.lt, lessonId: session.id,
    definition: phrase.en, translation: phrase.en, acceptedForms: phrase.acceptedForms,
    partOfSpeech: /\s/.test(phrase.lt.trim()) ? 'phrase' : 'word', grammaticalTags: [`Module ${unit.unitNumber}`, unit.grammar], source: 'lesson'
  }));
}

function addLessonVocabularyToLibrary(session, unit) {
  const existing = driveSync.getAllWords();
  const vocabularyKey = value => String(value || '').normalize('NFC').trim().toLocaleLowerCase('lt-LT').replace(/[.!?]+$/u, '');
  const missing = lessonVocabularyRecords(session, unit).filter(candidate => !existing.some(word =>
    word.id === candidate.id || ((word.courseId || 'english') === 'lithuanian'
      && vocabularyKey(word.word) === vocabularyKey(candidate.word)
      && String(word.definition || '').trim().toLowerCase() === candidate.definition.trim().toLowerCase())
  ));
  if (!missing.length) return 0;
  return driveSync.addWords(missing).length;
}

function renderExercise(container, session, attempt, navigate) {
  const exercise = session.exercises[attempt.exerciseIndex];
  const unit = getLithuanianUnit(session.unitId);
  const profileSnapshot = driveSync.getCourseProfile('lithuanian') || {};
  const adaptiveContext = {
    ...buildAdaptiveContext({ session, unit, profile: profileSnapshot, words: driveSync.getWords() }),
    unitPhrases: unit.phrases
  };
  const guided = session.sessionNumber <= 2;
  const firstExercise = guided ? 1 : 0;
  const exerciseCount = session.exercises.length - firstExercise;
  const exerciseNumber = attempt.exerciseIndex - firstExercise + 1;
  const percent = Math.round(((exerciseNumber - 1) / exerciseCount) * 100);
  container.innerHTML = `
    <main class="lesson-shell">
      <header class="lesson-progress-header"><button class="lesson-close" aria-label="Leave lesson"><i class="fa-solid fa-xmark"></i></button><div class="lesson-progress-track"><i style="width:${percent}%"></i></div><span>${exerciseNumber} / ${exerciseCount}</span></header>
      <section class="lesson-card ${exercise.type}">
        <div class="lesson-type-line"><span>${escapeHtml(exerciseLabel(exercise.type))}</span><small>Module ${unit.unitNumber} · ${escapeHtml(unit.cefr)}</small></div>
        ${lessonScene(exercise, unit)}${audioControls(exercise)}
        <div class="lesson-prompt"><h1>${escapeHtml(exercise.prompt)}</h1>${exercise.instruction ? `<p>${escapeHtml(exercise.instruction)}</p>` : ''}</div>
        ${guided ? learningSupport(exercise, unit) : ''}${exerciseContext(exercise)}
        <form class="lesson-answer-form">${answerControls(exercise)}</form>
        <div class="lesson-feedback" aria-live="polite"></div>${guided ? '' : coachMarkup(exercise)}
      </section>
    </main>`;

  const persist = nextAttempt => {
    const profile = driveSync.getCourseProfile('lithuanian') || {};
    driveSync.updateCourseProfile('lithuanian', { lessonAttempts: { ...(profile.lessonAttempts || {}), [session.id]: nextAttempt } });
  };
  let responseFinished = false;
  const finishResponse = ({ response, correct, skipped = false, unscored = false, hintUsed = false, feedbackDetail = '', modelAnswer = '' }) => {
    if (responseFinished || !container.querySelector('.lesson-feedback')) return;
    responseFinished = true;
    const alreadyRecorded = attempt.responses?.some(item => item.exerciseId === exercise.id);
    let next = alreadyRecorded ? attempt : recordLessonResponse(attempt, exercise, { response, correct, skipped, unscored, hintUsed });
    if (!alreadyRecorded) next.responses.at(-1).activityRecorded = true;
    // Persist the answer before counting it so reload/Continue cannot count it twice.
    persist(next);
    if (!alreadyRecorded && !skipped && exercise.type !== 'pattern') {
      driveSync.recordReview();
      recordLearningExercise({ correct, recallType: unscored ? 'speaking' : 'productive' });
    }
    const feedback = container.querySelector('.lesson-feedback');
    feedback.className = `lesson-feedback show ${unscored || skipped ? 'skipped' : correct ? 'correct' : 'incorrect'}`;
    if (unscored && exercise.type !== 'pattern') feedback.innerHTML = '<i class="fa-solid fa-check"></i><div><strong>Speaking practised.</strong><p>This counts toward your daily activity. Pronunciation was not scored.</p></div>';
    else if (unscored) feedback.innerHTML = `<i class="fa-solid fa-circle-check"></i><div><strong>Guide complete.</strong><p>The rule stays available at the start of every lesson in this module.</p></div>`;
    else if (correct) feedback.innerHTML = `<i class="fa-solid fa-circle-check"></i><div><strong>Taip — that works.</strong><p>${escapeHtml(feedbackDetail || `${exercise.phrase.lt} · ${exercise.phrase.en}`)}</p></div>`;
    else if (skipped) feedback.innerHTML = '<i class="fa-solid fa-forward"></i><div><strong>Speaking skipped.</strong><p>You can repeat this in a later review.</p></div>';
    else {
      const model = modelAnswer || (exercise.type === 'cloze' ? `${exercise.clozeAnswer} · ${exercise.answer}` : exercise.answer);
      feedback.innerHTML = `<i class="fa-solid fa-seedling"></i><div><strong>Almost. Check the model.</strong><p>${escapeHtml(feedbackDetail || `${model} · ${exercise.rescue}`)}</p></div>`;
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
    if (status) status.textContent = ok ? 'Played in Lithuanian. Tap again to repeat.' : describeSpeechError();
    if (setup) setup.hidden = ok;
  };
  container.querySelector('[data-play-audio]')?.addEventListener('click', event => playAudio(event.currentTarget, 0.86));
  container.querySelector('[data-play-audio-slow]')?.addEventListener('click', event => playAudio(event.currentTarget, 0.68));

  const playAdaptiveListening = async (activity, button, status) => {
    button.disabled = true;
    button.classList.add('playing');
    status.textContent = activity.kind === 'dialogue' ? 'Generating and playing two-speaker Lithuanian…' : 'Playing the Lithuanian passage…';
    let played = false;
    try {
      if (activity.kind === 'dialogue' && activity.aiGenerated) {
        const url = await getCachedOrGenerateDialogueAudio(activity.transcript);
        if (url) played = await playAudioUrl(url, { rate: adaptiveContext.difficulty.speechRate, revoke: true });
      }
      if (!played) {
        for (const turn of activity.transcript || []) {
          played = await speakText(turn.text, { locale: 'lt-LT', rate: adaptiveContext.difficulty.speechRate }) || played;
        }
      }
      status.textContent = played ? 'Finished. Replay it or answer the main-idea question.' : describeSpeechError();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'The listening audio could not play.';
    }
    button.disabled = false;
    button.classList.remove('playing');
  };

  const setupAiListening = async () => {
    const host = container.querySelector('[data-ai-listening]');
    if (!host) return;
    const kind = unit.unitNumber % 3 === 0 ? 'passage' : 'dialogue';
    const activity = await generateListeningActivity(adaptiveContext, { kind, unitPhrases: unit.phrases });
    if (!host.isConnected) return;
    host.innerHTML = `<section class="adaptive-listening-card">
      <div class="adaptive-meta"><span>${escapeHtml(adaptiveSourceLabel(activity))}</span><small>Level ${adaptiveContext.difficulty.band}/7 · ${activity.kind === 'dialogue' ? '2 voices' : '1 voice'} · about ${adaptiveContext.difficulty.listeningWords} words</small></div>
      <div class="adaptive-audio-hero"><i class="fa-solid ${activity.kind === 'dialogue' ? 'fa-people-arrows' : 'fa-podcast'}"></i><div><strong>${escapeHtml(activity.title || unit.title)}</strong><p>Listen without reading first. You only need the main idea.</p></div><button type="button" class="btn-green-solid" data-play-adaptive-listening><i class="fa-solid fa-play"></i> Listen</button></div>
      <p class="adaptive-audio-status" data-adaptive-audio-status role="status">Ready to play in Lithuanian.</p>
      <label for="adaptive-listening-answer">${escapeHtml(activity.gistQuestion || 'What is this mainly about?')}</label>
      <textarea id="adaptive-listening-answer" data-listening-answer rows="3" placeholder="Answer briefly in English…"></textarea>
      <div class="adaptive-actions"><button type="button" class="status-pill offline" data-reveal-adaptive-transcript>Use transcript</button><button type="button" class="btn-green-solid" data-check-listening>Check main idea</button></div>
      ${transcriptMarkup(activity)}
    </section>`;
    const playButton = host.querySelector('[data-play-adaptive-listening]');
    const status = host.querySelector('[data-adaptive-audio-status]');
    playButton.addEventListener('click', () => playAdaptiveListening(activity, playButton, status));
    host.querySelector('[data-reveal-adaptive-transcript]').addEventListener('click', event => {
      event.currentTarget.disabled = true;
      host.querySelector('[data-adaptive-transcript]').hidden = false;
      attempt = { ...attempt, hintsUsed: Number(attempt.hintsUsed || 0) + 1 };
      persist(attempt);
    });
    host.querySelector('[data-check-listening]').addEventListener('click', async event => {
      const checkButton = event.currentTarget;
      const response = host.querySelector('[data-listening-answer]').value.trim();
      if (!response) return;
      checkButton.disabled = true;
      checkButton.textContent = 'Checking answer…';
      const result = await evaluateListeningResponse(activity, response, adaptiveContext);
      checkButton.textContent = 'Answer checked';
      finishResponse({ response, correct: result.correct, feedbackDetail: result.feedback, modelAnswer: activity.modelSummary });
    });
  };

  const setupAiDialogue = async () => {
    const host = container.querySelector('[data-ai-dialogue]');
    if (!host) return;
    const activity = await generateDialogueActivity(adaptiveContext, { unitPhrases: unit.phrases });
    if (!host.isConnected) return;
    const history = [{ role: 'partner', text: activity.opening }];
    host.innerHTML = `<section class="adaptive-dialogue-card">
      <div class="adaptive-meta"><span>${escapeHtml(adaptiveSourceLabel(activity))}</span><small>Level ${adaptiveContext.difficulty.band}/7 · ${adaptiveContext.difficulty.learnerTurns} learner turn${adaptiveContext.difficulty.learnerTurns === 1 ? '' : 's'}</small></div>
      <div class="adaptive-goal"><i class="fa-solid fa-bullseye"></i><div><span>SITUATION</span><strong>${escapeHtml(activity.scenario)}</strong><p>${escapeHtml(activity.goal)}</p></div></div>
      <div class="adaptive-turns" data-dialogue-turns><div class="adaptive-turn partner"><span>${escapeHtml(activity.partnerName || 'Rasa')}</span><p lang="lt">${escapeHtml(activity.opening)}</p><button type="button" data-speak-dialogue-line aria-label="Hear partner"><i class="fa-solid fa-volume-high"></i></button></div></div>
      <label for="adaptive-dialogue-answer">Your reply in Lithuanian</label>
      <textarea id="adaptive-dialogue-answer" data-dialogue-answer rows="2" lang="lt" placeholder="${escapeHtml(activity.supportPhrase || 'Type a natural reply…')}"></textarea>
      <button type="button" class="btn-green-solid adaptive-send" data-send-dialogue>Send to ${escapeHtml(activity.partnerName || 'Rasa')}</button>
      <p class="adaptive-turn-feedback" data-dialogue-feedback role="status">${activity.aiGenerated ? 'Gemini checks meaning and grammar after every turn.' : 'Your reply is checked against the lesson goal.'}</p>
    </section>`;
    host.querySelector('[data-speak-dialogue-line]').addEventListener('click', () => speakText(activity.opening, { locale: 'lt-LT', rate: adaptiveContext.difficulty.speechRate }));
    host.querySelector('[data-send-dialogue]').addEventListener('click', async event => {
      const sendButton = event.currentTarget;
      const input = host.querySelector('[data-dialogue-answer]');
      const reply = input.value.trim();
      if (!reply) return;
      sendButton.disabled = true;
      sendButton.textContent = 'Processing reply…';
      input.disabled = true;
      const turns = host.querySelector('[data-dialogue-turns]');
      turns.insertAdjacentHTML('beforeend', `<div class="adaptive-turn learner"><span>You</span><p lang="lt">${escapeHtml(reply)}</p></div>`);
      history.push({ role: 'learner', text: reply });
      const result = await processDialogueTurn(activity, history, reply, adaptiveContext);
      history.push({ role: 'partner', text: result.partnerReply });
      turns.insertAdjacentHTML('beforeend', `<div class="adaptive-turn partner"><span>${escapeHtml(activity.partnerName || 'Rasa')}</span><p lang="lt">${escapeHtml(result.partnerReply)}</p><small>${escapeHtml(result.englishMeaning)}</small></div>`);
      const feedback = host.querySelector('[data-dialogue-feedback]');
      feedback.innerHTML = `${result.correctedReply ? `<strong>Try:</strong> <span lang="lt">${escapeHtml(result.correctedReply)}</span> · ` : ''}${escapeHtml(result.feedback)}`;
      // Audio is optional: playback failure must never block answer feedback.
      void speakText(result.partnerReply, { locale: 'lt-LT', rate: adaptiveContext.difficulty.speechRate }).catch(() => {});
      const learnerTurns = history.filter(turn => turn.role === 'learner').length;
      if (result.goalComplete || learnerTurns >= adaptiveContext.difficulty.learnerTurns) {
        finishResponse({ response: history.filter(turn => turn.role === 'learner').map(turn => turn.text).join(' / '), correct: result.goalComplete || result.accepted, feedbackDetail: result.feedback, modelAnswer: result.correctedReply || activity.supportPhrase || activity.opening });
        return;
      }
      input.value = '';
      input.disabled = false;
      input.focus();
      sendButton.disabled = false;
      sendButton.textContent = 'Continue dialogue';
    });
  };

  const setupAdaptiveTranslation = async () => {
    const host = container.querySelector('[data-adaptive-translation]');
    if (!host) return;
    const activity = await generateTranslationActivity(adaptiveContext, { unitPhrases: unit.phrases });
    if (!host.isConnected) return;
    host.innerHTML = `<section class="adaptive-translation-card">
      <div class="adaptive-meta"><span>${escapeHtml(adaptiveSourceLabel(activity))}</span><small>Level ${adaptiveContext.difficulty.band}/7 · target ${adaptiveContext.difficulty.translationWordTarget} words · ${adaptiveContext.vocabularyCount} Library entries</small></div>
      <div class="adaptive-translation-prompt"><span>TRANSLATE INTO LITHUANIAN</span><strong>${escapeHtml(activity.englishPrompt)}</strong></div>
      ${activity.focusWords?.length ? `<p class="adaptive-focus-words"><span>Active vocabulary</span>${activity.focusWords.map(word => `<b lang="lt">${escapeHtml(word)}</b>`).join('')}</p>` : ''}
      <label for="adaptive-translation-answer">Your Lithuanian sentence</label>
      <textarea id="adaptive-translation-answer" data-translation-answer rows="3" lang="lt" placeholder="Write the complete sentence…"></textarea>
      <button type="button" class="btn-green-solid" data-check-translation>Check translation</button>
    </section>`;
    host.querySelector('[data-check-translation]').addEventListener('click', async event => {
      const checkButton = event.currentTarget;
      const response = host.querySelector('[data-translation-answer]').value.trim();
      if (!response) return;
      checkButton.disabled = true;
      checkButton.textContent = 'Checking meaning and forms…';
      const result = await evaluateTranslationResponse(activity, response, adaptiveContext);
      checkButton.textContent = 'Translation checked';
      finishResponse({ response, correct: result.correct, feedbackDetail: result.feedback, modelAnswer: result.correctedAnswer || activity.lithuanianModel });
    });
  };

  const savedResponse = attempt.responses?.find(item => item.exerciseId === exercise.id);
  if (savedResponse) { finishResponse(savedResponse); return; }

  if (exercise.type === 'ai-listening') setupAiListening();
  if (exercise.type === 'ai-dialogue') setupAiDialogue();
  if (exercise.type === 'adaptive-translation') setupAdaptiveTranslation();

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
      const pair = exercise.matchPairs.find(item => item.key === selectedLt);
      [ltButton, enButton].forEach(button => button?.classList.add('incorrect'));
      status.textContent = `${pair.lt} means “${pair.en}”. Try matching it again.`;
      window.setTimeout(() => { [ltButton, enButton].forEach(button => button?.classList.remove('selected', 'incorrect')); selectedLt = null; selectedEn = null; }, 420);
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
  const profile = driveSync.getCourseProfile('lithuanian') || {};
  const unit = getLithuanianUnit(session.unitId);
  const evidence = completionEvidence(session, attempt);
  const passed = !session.isCheckpoint || evidence.demonstrated;
  const completedNodeIds = [...new Set([...(profile.completedNodeIds || []), ...(passed ? [session.id] : [])])];
  const canDoEvidence = [...(profile.canDoEvidence || []).filter(item => item.nodeId !== session.id), evidence];
  let vocabularyAdded = 0;
  let vocabularyError = '';
  try { vocabularyAdded = addLessonVocabularyToLibrary(session, unit); }
  catch { vocabularyError = 'Your progress is saved, but the Library could not be updated. Try saving again.'; }
  driveSync.updateCourseProfile('lithuanian', { completedNodeIds, canDoEvidence, activeLessonId: null });
  const history = driveSync.getSettings().learningStats?.sessionHistory || [];
  if (!history.some(item => item.id === attempt.id)) recordSessionCompletion({ ...session, id: attempt.id }, { kind: 'lesson', correct: evidence.correct, exercises: evidence.total });
  container.innerHTML = `<main class="lesson-shell lesson-complete-shell"><section class="lesson-complete-card">
    <img src="assets/keepvocab-sprig-celebrate.webp" alt="Sprig celebrating"><span class="learning-kicker">${passed ? 'LESSON COMPLETE' : 'CHECKPOINT REVIEW'}</span><h1>${passed ? 'Puiku! Keep it growing.' : 'A little more practice.'}</h1>
    <p>${passed ? escapeHtml(unit.outcome) : 'Review the phrases, then try this checkpoint again. Answer at least two thirds correctly to unlock the next module.'}</p>
    <p>${vocabularyError || (vocabularyAdded ? `${vocabularyAdded} new ${vocabularyAdded === 1 ? 'entry' : 'entries'} added to your Lithuanian Library for spaced review.` : session.vocabulary.length ? 'These lesson entries are already in your Library.' : 'You revisited your vocabulary. No duplicate entries were added.')}</p>
    <div class="lesson-result-grid"><div><strong>${evidence.correct}/${evidence.total}</strong><span>scored answers</span></div><div><strong>${attempt.hintsUsed || 0}</strong><span>hints</span></div><div><strong>+${vocabularyAdded}</strong><span>Library entries</span></div></div>
    <button class="btn-green-solid" data-back-path>${passed ? 'Continue learning' : 'Back to course'}</button>
    <button class="status-pill offline" data-retry-lesson>Practise this lesson again</button>
    ${vocabularyError ? '<button class="status-pill offline" data-retry-save>Retry saving vocabulary</button>' : ''}
    <small>Course practice records your progress; it does not certify a CEFR level.</small>
  </section></main>`;
  container.querySelector('[data-back-path]')?.addEventListener('click', () => navigate('learn'));
  container.querySelector('[data-retry-save]')?.addEventListener('click', () => renderComplete(container, session, attempt, navigate));
  container.querySelector('[data-retry-lesson]')?.addEventListener('click', () => {
    const latest = driveSync.getCourseProfile('lithuanian');
    driveSync.updateCourseProfile('lithuanian', { activeLessonId: session.id, lessonAttempts: { ...latest.lessonAttempts, [session.id]: null } });
    renderLessonMode(container, navigate);
  });
}

export function renderLessonMode(container, navigate) {
  const profile = driveSync.getCourseProfile('lithuanian') || {}; const session = getLithuanianSession(profile.activeLessonId);
  if (driveSync.getActiveCourseId() !== 'lithuanian' || !session || !isSessionUnlocked(session.id, profile)) { navigate('learn'); return; }
  const attempt = startLessonAttempt(session.id, profile.lessonAttempts?.[session.id]);
  driveSync.updateCourseProfile('lithuanian', { lessonAttempts: { ...(profile.lessonAttempts || {}), [session.id]: attempt } });
  if (attempt.status === 'completed') renderComplete(container, session, attempt, navigate); else renderExercise(container, session, attempt, navigate);
}

export function teardownLessonMode() { lessonSpeechActive = false; }
