import { definitionForLearning, exampleForLearning } from '../services/learningDefinitions.js?v=18908';
import { isUkrainianTranslationEnabled } from '../services/translationSettings.js?v=18908';
import { ensureDailyStudyPlan, getActivePracticeWords, getScheduledPracticeWords, recordModeWordSelections } from '../services/wordSelection.js?v=18908';
import { driveSync } from '../services/driveSync.js?v=18908';
import { buildScheduledPracticeSession, buildWeakWordsSession, weaknessScore } from '../services/dailySession.js?v=18908';
import { recordExerciseResult } from '../services/exerciseResult.js?v=18908';
import { recordSessionCompletion } from '../services/learningStats.js?v=18908';
import { getStreakSummary } from '../services/studyActivity.js';
import { preloadAudioUrl, speakWord } from '../services/speechService.js?v=18912';
import { playInteractionSound } from '../services/interactionSound.js?v=18908';
import { buildWordChoices } from '../services/wordChoices.js?v=18908';
import { escapeHtml } from '../utils/html.js';
import { replaceTargetWordForm, sentenceUsesTargetForm } from '../utils/wordForms.js?v=18908';
import { evaluateChoiceAnswer, evaluateRecallAnswer } from '../services/exerciseEvaluation.js?v=18908';
import { evaluateUseItSentence } from '../services/useItEvaluation.js?v=18908';
import { getGeminiSettings } from '../services/geminiSettings.js?v=18908';
import { buildSentencePuzzle, evaluateSentenceAssembly, generateSentenceBuilderSet } from '../services/sentenceBuilder.js';
import { mountUseItExercise } from './UseItExercise.js?v=18908';
import { renderPracticeHeader, focusPracticeInput, practiceProgress, answerEncouragement, formatMemoryBoost, renderPracticeMascot, renderVoiceWave, bindTalkingMascot } from './PracticeElements.js?v=18912';
import { navigateTo as go } from '../utils/navigation.js';

function cloze(word) {
  const example = exampleForLearning(word);
  if (!example || !sentenceUsesTargetForm(example, word)) return `Complete with the word meaning “${definitionForLearning(word)}”.`;
  return `${replaceTargetWordForm(example, word)} · Type the saved base word.`;
}

function exerciseCopy(exercise, word) {
  if (exercise.exerciseType === 'image-recognition') return { title: 'Visual Match', icon: 'fa-images', prompt: 'Choose the word that matches this image.', sprig: 'Which word fits this visual?' };
  if (exercise.exerciseType === 'meaning-recognition') return { title: 'Choose the meaning', icon: 'fa-list-check', prompt: `What does “${word.word}” mean?`, sprig: 'Pick the closest meaning.' };
  if (exercise.exerciseType === 'definition-recognition') return { title: 'Choose Word', icon: 'fa-list-check', prompt: definitionForLearning(word), sprig: 'Spot the exact word.' };
  if (exercise.exerciseType === 'listening-recall') return { title: 'Listen & Spell', icon: 'fa-headphones', prompt: 'Listen closely, then type the word.', sprig: 'Tap play and trust your ear!' };
  if (exercise.exerciseType === 'sentence-builder') return { title: 'Build Sentence', icon: 'fa-align-left', prompt: `Arrange the tiles to use “${word.word}”.`, sprig: `Put “${word.word}” in its natural place.` };
  if (exercise.exerciseType === 'context-cloze') return { title: 'Context', icon: 'fa-book-open-reader', prompt: cloze(word), sprig: 'Fill the gap in this real situation.' };
  if (exercise.exerciseType === 'use-it') return { title: 'Use It', icon: 'fa-pen-nib', prompt: `Use “${word.word}” in your own sentence.`, sprig: 'Make this word yours!' };
  return { title: 'Write the word', icon: 'fa-keyboard', prompt: definitionForLearning(word), sprig: 'Recall it from memory.' };
}

// Refresh only the still-visible result/rest screen. A due learning step must
// become available without navigating away, and must not replace another view.
function refreshPlanAt(container, at, refresh) {
  const deadline = Date.parse(at || '');
  if (!Number.isFinite(deadline)) return;
  const screen = container.firstElementChild;
  const check = () => {
    if (!container.isConnected || container.firstElementChild !== screen) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) refresh();
    else setTimeout(check, Math.min(remaining + 50, 60000));
  };
  setTimeout(check, Math.max(50, Math.min(deadline - Date.now() + 50, 60000)));
}

function renderSessionStreakStrip(settings) {
  const summary = getStreakSummary(settings);
  const streakLabel = summary.currentStreak > 0
    ? `${summary.currentStreak}-day streak`
    : 'Streak ready';
  const statusCopy = summary.goalReachedToday
    ? `Daily goal reached (${summary.reviewsToday}/${summary.dailyGoal})`
    : `${summary.reviewsToday}/${summary.dailyGoal} today`;
  const milestoneCopy = summary.currentStreak > 0
    ? `${summary.daysToMilestone}d to ${summary.nextMilestone}d milestone`
    : `${Math.max(0, summary.dailyGoal - summary.reviewsToday)} left to start streak`;
  return `<div class="session-rhythm-bar" aria-label="Streak summary"><span><i class="fa-solid fa-fire" aria-hidden="true"></i> <strong>${escapeHtml(streakLabel)}</strong></span><span><i class="fa-solid fa-bullseye" aria-hidden="true"></i> ${escapeHtml(statusCopy)}</span><span><i class="fa-solid fa-shield-halved" aria-hidden="true"></i> ${summary.bankedFreezes}/${summary.maxFreezes} freezes</span><span class="session-rhythm-milestone">${escapeHtml(milestoneCopy)}</span></div>`;
}

function renderScheduledRestState(container, onNavigate, notebookLabel, result = null) {
  const settings = ensureDailyStudyPlan(driveSync);
  const session = buildScheduledPracticeSession(getScheduledPracticeWords(driveSync), settings);
  const plan = session.dailyPlan;
  const ready = session.exercises.length > 0;
  const waiting = plan.waitingTodayCount > 0;
  const nextTime = plan.nextReadyAt ? new Date(plan.nextReadyAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  const heading = ready ? (result ? 'Session complete' : 'Ready to continue')
    : waiting ? 'A little space helps memory'
      : plan.isPlanComplete ? 'Today’s plan complete' : 'No reviews due today';
  const nextCopy = ready ? `${session.wordCount} word${session.wordCount === 1 ? ' is' : 's are'} ready in today’s plan.`
    : waiting ? `${plan.waitingTodayCount} word${plan.waitingTodayCount === 1 ? ' still needs' : 's still need'} practice today.${nextTime ? ` The next review opens at ${nextTime}.` : ' They return when their review is due.'} FSRS spaces learning steps so you can try recalling them again.`
      : plan.isPlanComplete ? `You finished today’s plan.${plan.reviseTomorrowCount ? ` ${plan.reviseTomorrowCount} word${plan.reviseTomorrowCount === 1 ? ' is' : 's are'} currently scheduled to revise tomorrow.` : ' Your next plan starts at 8:00 AM.'}`
        : 'Your saved words are resting until their scheduled reviews. Your next plan starts at 8:00 AM.';
  container.innerHTML = `<section class="full-view-stack" aria-labelledby="practice-complete-heading"><div class="spec-card practice-shell review-recall-shell"><div class="card-header-bar"><div class="card-tag"><i class="fa-solid fa-${waiting ? 'clock' : 'dumbbell'}" aria-hidden="true"></i> Practice</div><span class="muted-label">${escapeHtml(notebookLabel)}</span></div><div class="useful-empty-state mode-complete"><img class="mascot-result" src="assets/${waiting ? 'keepvocab-sprig-thinking' : 'keepvocab-sprig-celebrate'}.webp" alt="Sprig"><h2 id="practice-complete-heading">${heading}</h2><p role="status">${result ? `${result.correct} of ${result.total} exercises were correct. ` : ''}${escapeHtml(nextCopy)}</p>${result ? `<div class="review-score-orb"><strong>${result.correct}</strong><span>correct</span></div>${renderSessionStreakStrip(settings)}` : ''}<div class="inline-actions">${ready ? '<button class="btn-green-solid" id="daily-continue">Continue today’s plan</button>' : ''}<button class="${ready ? 'status-pill offline' : 'btn-green-solid'}" id="daily-finish">Back to Today</button><button class="status-pill offline" id="daily-open-library">Open library</button>${result ? '<button class="status-pill offline" id="daily-stats">View progress</button>' : ''}</div></div></div></section>`;
  container.querySelector('#daily-continue')?.addEventListener('click', () => renderDailySessionMode(container, onNavigate));
  container.querySelector('#daily-finish').addEventListener('click', () => go('dashboard', onNavigate));
  container.querySelector('#daily-open-library').addEventListener('click', () => go('library', onNavigate));
  container.querySelector('#daily-stats')?.addEventListener('click', () => go('stats', onNavigate));
  refreshPlanAt(container, plan.nextReadyAt || plan.nextEvaluationAt,
    () => renderScheduledRestState(container, onNavigate, notebookLabel, result));
}

export function renderDailySessionMode(container, onNavigate, options = {}) {
  const words = options.kind === 'weak' ? getActivePracticeWords(driveSync) : getScheduledPracticeWords(driveSync);
  const practiceNotebookLabel = driveSync.getActiveNotebook();
  const settings = options.kind === 'weak' ? driveSync.getSettings() : ensureDailyStudyPlan(driveSync);
  const session = options.kind === 'weak' ? buildWeakWordsSession(words) : buildScheduledPracticeSession(words, settings);
  if (!session.exercises.length) {
    if (options.kind !== 'weak' && words.length) {
      renderScheduledRestState(container, onNavigate, practiceNotebookLabel);
      return;
    }
    container.innerHTML = `<section class="full-view-stack"><div class="spec-card useful-empty-state"><img class="mascot-result" src="assets/keepvocab-sprout-mascot.webp" alt="Sprig"><h2>${options.kind === 'weak' ? 'No weak words ready' : 'Build your first workout'}</h2><p>${options.kind === 'weak' ? 'Unresolved mistakes return when their next review is due. Recently recalled words get time to rest.' : 'Add vocabulary to the selected Library month and KeepVocab will choose the right first exercises.'}</p><button class="btn-green-solid" id="daily-empty-action">${options.kind === 'weak' ? 'Back to Today' : 'Add a word'}</button></div></section>`;
    container.querySelector('#daily-empty-action').addEventListener('click', () => options.kind === 'weak' ? go('dashboard', onNavigate) : document.getElementById('btn-header-quick-add')?.click());
    return;
  }

  const queue = [...session.exercises];
  const selectedIds = new Set(queue.map(exercise => exercise.wordId));
  recordModeWordSelections(driveSync, words.filter(word => selectedIds.has(word.id)), { mode: options.kind === 'weak' ? 'weak' : 'practice' });
  const initialWeak = new Map(words.map(word => [word.id, weaknessScore(word)]));
  const retriedWordIds = new Set();
  let index = 0;
  let score = 0;
  let combo = 0;
  let answered = false;
  let correct = false;
  let hintsUsed = 0;
  let memoryBoost = '';
  let learnerResponse = '';
  let confusedWithWordId = '';
  let useItResult = null;
  let useItController = null;
  let sentencePuzzle = null;
  let sentencePuzzleKey = '';
  let sentenceChosenIds = [];
  let questionStartedAt = performance.now();
  const aiSentenceByWordId = new Map();

  if (options.kind !== 'weak' && getGeminiSettings().enabled) {
    const sentenceWordIds = [...new Set(queue.filter(item => item.exerciseType === 'sentence-builder').map(item => item.wordId))];
    const sentenceWords = sentenceWordIds.map(id => words.find(word => word.id === id)).filter(Boolean);
    if (sentenceWords.length) {
      generateSentenceBuilderSet(sentenceWords).then(generated => {
        for (const item of generated?.items || []) {
          aiSentenceByWordId.set(String(item.wordId), item);
        }
      }).catch(() => { /* saved-example puzzle remains active seamlessly */ });
    }
  }

  const currentWord = () => driveSync.getWords().find(word => word.id === queue[index]?.wordId);

  function resetQuestionState() {
    answered = false;
    correct = false;
    hintsUsed = 0;
    memoryBoost = '';
    learnerResponse = '';
    confusedWithWordId = '';
    useItResult = null;
    sentencePuzzle = null;
    sentencePuzzleKey = '';
    sentenceChosenIds = [];
    questionStartedAt = performance.now();
  }

  function queueMissedRecovery(exercise) {
    if (!exercise || exercise.isRetry || retriedWordIds.has(exercise.wordId)) return;
    retriedWordIds.add(exercise.wordId);
    queue.push({
      id: `${exercise.wordId}-retry-${queue.length}`,
      wordId: exercise.wordId,
      exerciseType: exercise.exerciseType === 'sentence-builder' ? 'typed-recall' : exercise.exerciseType,
      source: exercise.source,
      isRetry: true
    });
  }

  function complete() {
    const improved = driveSync.getWords().filter(word => (initialWeak.get(word.id) || 0) > weaknessScore(word)).length;
    recordSessionCompletion(session, { kind: options.kind || 'daily', exercises: queue.length, correct: score, minutes: Math.max(1, Math.round((performance.now() - startedAt) / 60_000)), weakWordsImproved: improved });
    if (options.kind !== 'weak') {
      renderScheduledRestState(container, onNavigate, practiceNotebookLabel, { correct: score, total: queue.length });
      return;
    } else {
      container.innerHTML = `<section class="full-view-stack"><div class="spec-card daily-complete-card"><img src="assets/keepvocab-sprig-celebrate.webp" alt="Sprig celebrating"><span class="eyebrow">Practice complete</span><h1>${options.kind === 'weak' ? 'Your weak words are getting stronger' : 'You moved your vocabulary forward'}</h1><p>${score} of ${queue.length} exercises were correct. ${improved ? `${improved} weak word${improved === 1 ? '' : 's'} improved.` : 'Mistakes are already shaping your next workout.'}</p><div class="daily-complete-metrics"><div><strong>${score}</strong><span>correct</span></div><div><strong>${queue.length}</strong><span>exercises</span></div><div><strong>${improved}</strong><span>recovered</span></div></div>${renderSessionStreakStrip(driveSync.getSettings())}<div class="inline-actions"><button class="btn-green-solid" id="daily-finish">Back to Today</button><button class="status-pill offline" id="daily-stats">View progress</button></div></div></section>`;
    }
    container.querySelector('#daily-finish').addEventListener('click', () => go('dashboard', onNavigate));
    container.querySelector('#daily-stats').addEventListener('click', () => go('stats', onNavigate));
  }

  const startedAt = performance.now();

  async function submit(answer, selectedId = '') {
    if (answered) return;
    const exercise = queue[index];
    const word = currentWord();
    if (!word) return;
    answered = true;
    learnerResponse = String(answer || '').trim();
    confusedWithWordId = selectedId && selectedId !== word.id ? selectedId : '';
    if (exercise.exerciseType === 'use-it') {
      useItResult = await evaluateUseItSentence(word, learnerResponse);
      correct = useItResult.correct;
    } else if (exercise.exerciseType === 'sentence-builder' && sentencePuzzle) {
      const tileById = new Map(sentencePuzzle.tiles.map(tile => [tile.id, tile]));
      const chosenTokens = sentenceChosenIds.map(id => tileById.get(id)?.text).filter(Boolean);
      correct = evaluateSentenceAssembly(sentencePuzzle.targetTokens, chosenTokens, {
        opening: sentencePuzzle.opening,
        acceptedSentences: sentencePuzzle.acceptedSentences
      }).correct;
    } else if (['image-recognition', 'definition-recognition', 'meaning-recognition'].includes(exercise.exerciseType)) {
      correct = evaluateChoiceAnswer(word.id, selectedId);
    } else {
      correct = evaluateRecallAnswer(word.word, learnerResponse);
    }
    const recallType = exercise.exerciseType === 'use-it' ? 'productive'
      : ['context-cloze', 'sentence-builder'].includes(exercise.exerciseType) ? 'context'
        : exercise.exerciseType === 'listening-recall' ? 'listening-recall'
          : ['image-recognition', 'definition-recognition', 'meaning-recognition'].includes(exercise.exerciseType) ? 'recognition' : 'free-recall';
    const applied = recordExerciseResult({
      wordId: word.id,
      exerciseType: `daily-${exercise.exerciseType}`,
      correct,
      responseTimeMs: performance.now() - questionStartedAt,
      hintsUsed,
      recallType,
      producedUnaided: correct && !hintsUsed && !['image-recognition', 'definition-recognition', 'meaning-recognition'].includes(exercise.exerciseType),
      confusedWithWordId,
      learnerResponse: recallType === 'productive' ? learnerResponse : ''
    });
    if (correct) {
      score += 1;
      combo += 1;
      memoryBoost = formatMemoryBoost(applied?.transition);
    } else {
      combo = 0;
      memoryBoost = '';
      queueMissedRecovery(exercise);
    }
    playInteractionSound(correct ? 'correct' : 'wrong', { combo });
    window.dispatchEvent(new CustomEvent('keepvocab:progress'));
    render();
  }

  function render(focusInput = false) {
    useItController?.destroy();
    useItController = null;
    if (index >= queue.length) return complete();
    const exercise = queue[index];
    const word = currentWord();
    if (!word) { index += 1; resetQuestionState(); return render(); }
    if (exercise.exerciseType === 'sentence-builder') {
      const aiItem = aiSentenceByWordId.get(String(word.id));
      // Once the example is available to the learner, freeze the tiles and
      // reference for this question even if the Gemini result arrives later.
      const key = `${exercise.id}:${word.id}`;
      if (sentencePuzzleKey !== key) {
        sentencePuzzle = buildSentencePuzzle(word, words, {
          sentence: aiItem?.sentence || null,
          chunks: aiItem?.chunks || null,
          acceptedSentences: aiItem?.acceptedSentences || null,
          source: aiItem?.source || 'saved-example'
        });
        sentencePuzzleKey = key;
        sentenceChosenIds = [];
      }
      if (!sentencePuzzle) {
        exercise.exerciseType = 'typed-recall';
      }
    }
    const copy = exerciseCopy(exercise, word);
    const choiceMode = ['image-recognition', 'definition-recognition', 'meaning-recognition'].includes(exercise.exerciseType);
    const optionsList = choiceMode ? buildWordChoices(word, words, 4, exercise.exerciseType === 'meaning-recognition' ? 'definition' : 'word') : [];
    const meaningLabels = exercise.exerciseType === 'meaning-recognition' ? new Map(optionsList.map(option => [option.id, option.definition])) : null;
    const inputLabel = exercise.exerciseType === 'use-it' ? 'Your sentence' : 'Your answer';
    const sessionLabel = options.kind === 'weak' ? 'Weak Words' : 'Practice';
    const progress = practiceProgress({ current: index, total: queue.length, score, answered });
    const mascot = answered ? (correct ? 'assets/keepvocab-sprig-celebrate.webp' : 'assets/keepvocab-sprout-mascot.webp') : 'assets/keepvocab-sprig-thinking.webp';
    if (exercise.exerciseType === 'use-it') {
      container.innerHTML = `<section class="full-view-stack"><div class="spec-card use-it-shell weak-use-it-shell${combo >= 3 ? ' is-hot-combo' : ''}"><div class="card-header-bar"><div class="card-tag"><i class="fa-solid fa-pen-nib" aria-hidden="true"></i> Use It</div><span class="muted-label">${escapeHtml(practiceNotebookLabel)}</span></div><div class="practice-topline"><button class="status-pill offline" id="daily-exit"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Today</button><span>${sessionLabel} · ${index + 1} of ${queue.length}</span><strong>${escapeHtml(progress.status)}</strong></div><div class="review-progress" role="progressbar" aria-label="${sessionLabel} progress" aria-valuemin="0" aria-valuemax="${queue.length}" aria-valuenow="${progress.completed}"><span style="width:${progress.percent}%"></span></div><div id="weak-useit-exercise-root"></div></div></section>`;
      container.querySelector('#daily-exit').addEventListener('click', () => go('dashboard', onNavigate));
      useItController = mountUseItExercise(container.querySelector('#weak-useit-exercise-root'), {
        word,
        focusInput,
        nextLabel: index + 1 >= queue.length ? 'Finish' : 'Continue',
        onEvaluated(result, sentence) {
          learnerResponse = sentence;
          useItResult = result;
          correct = result.correct;
          answered = true;
          recordExerciseResult({
            wordId: word.id,
            exerciseType: 'daily-use-it',
            correct,
            responseTimeMs: performance.now() - questionStartedAt,
            hintsUsed,
            recallType: 'productive',
            producedUnaided: true,
            learnerResponse
          });
          if (correct) { score += 1; combo += 1; } else { combo = 0; queueMissedRecovery(exercise); }
          window.dispatchEvent(new CustomEvent('keepvocab:progress'));
          playInteractionSound(correct ? 'correct' : 'wrong', { combo });
        },
        onNext() {
          index += 1;
          resetQuestionState();
          render(true);
        }
      });
      return;
    }
    if (options.kind !== 'weak') {
      const visual = exercise.exerciseType === 'image-recognition';
      const sentenceMode = exercise.exerciseType === 'sentence-builder' && sentencePuzzle;
      const listening = exercise.exerciseType === 'listening-recall';
      const contextMode = exercise.exerciseType === 'context-cloze';
      if (listening) preloadAudioUrl(word.audioUrl);
      const tileById = sentenceMode ? new Map(sentencePuzzle.tiles.map(tile => [tile.id, tile])) : null;
      const chosenSet = sentenceMode ? new Set(sentenceChosenIds) : null;
      const chosenTiles = sentenceMode ? sentenceChosenIds.map(id => tileById.get(id)).filter(Boolean) : [];
      const canCheckSentence = sentenceMode && chosenTiles.length === sentencePuzzle.targetTokens.length;
      const recallTypeForFeedback = sentenceMode || contextMode ? 'context' : listening ? 'listening-recall' : visual ? 'recognition' : 'free-recall';
      const feedbackDetail = sentenceMode
        ? sentencePuzzle.sentence
        : (exampleForLearning(word) || definitionForLearning(word));
      const headingText = sentenceMode ? (sentencePuzzle.opening ? 'Complete the sentence' : 'Build the sentence')
        : listening ? 'Type what you hear'
          : visual ? 'Which word matches?'
            : contextMode ? 'Fill in the blank'
              : 'Write the word';
      const lockedOpeningHtml = sentenceMode && sentencePuzzle.opening
        ? `<span class="sentence-tile is-locked" aria-label="Sentence opening">${escapeHtml(sentencePuzzle.opening)}</span>`
        : '';
      const bubbleHtml = sentenceMode
        ? `<div class="duo-bubble-word-row"><strong>${escapeHtml(word.word)}</strong><span class="duo-bubble-tags"><span class="review-pos-hint">${escapeHtml(word.partOfSpeech || 'word')}</span>${sentencePuzzle.source === 'ai' ? '<span class="duo-source-chip"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> AI sentence</span>' : ''}</span></div><p class="duo-bubble-copy">${escapeHtml(sentencePuzzle.definition)}</p>`
        : listening
          ? `<div class="duo-bubble-audio"><button type="button" class="audio-btn-circle" id="daily-listen" aria-label="Play the word"><i class="fa-solid fa-volume-high"></i></button>${renderVoiceWave()}<button type="button" class="status-pill offline" id="daily-listen-slow" data-sound="none"><i class="fa-solid fa-gauge-simple"></i> Slow</button></div><p class="duo-bubble-copy">${escapeHtml(definitionForLearning(word))}</p>`
          : contextMode
            ? `<blockquote class="duo-bubble-quote">${escapeHtml(cloze(word))}</blockquote><span class="review-pos-hint">${escapeHtml(word.partOfSpeech || 'word')}</span>`
            : `<blockquote class="duo-bubble-quote">${escapeHtml(definitionForLearning(word))}</blockquote>${isUkrainianTranslationEnabled() && word.translationLanguage === 'uk' && word.translation ? `<p class="word-translation" lang="uk">${escapeHtml(word.translation)}</p>` : ''}<span class="review-pos-hint">${escapeHtml(word.partOfSpeech || 'word')}</span>`;
      container.innerHTML = `<section class="full-view-stack" aria-labelledby="practice-heading"><div class="spec-card practice-shell review-recall-shell${combo >= 3 ? ' is-hot-combo' : ''}">
        <div class="card-header-bar"><div class="card-tag" id="practice-heading"><i class="fa-solid fa-dumbbell" aria-hidden="true"></i> Practice</div><span class="muted-label">${escapeHtml(practiceNotebookLabel)}</span></div>
        ${renderPracticeHeader({ exitId: 'daily-exit', current: index, total: queue.length, score, answered })}
        <div class="${visual ? 'visual-prompt' : sentenceMode ? 'practice-prompt sentence-prompt' : 'practice-prompt typed-review-prompt'}">
          ${visual
            ? `<div class="duo-stage-heading"><h2>${escapeHtml(headingText)}</h2>${combo >= 3 ? `<span class="duo-combo-badge"><i class="fa-solid fa-fire" aria-hidden="true"></i> ${combo} in a row</span>` : ''}</div><figure class="practice-image-prompt"><img src="${escapeHtml(word.imageUrl)}" alt="Visual clue"></figure>`
            : renderPracticeMascot({ heading: headingText, bubbleHtml, answered, correct, combo, retry: Boolean(exercise.isRetry), talking: listening })}
          ${sentenceMode
            ? `<div class="sentence-answer-tray${answered ? (correct ? ' is-correct' : ' is-incorrect') : ''}" id="sentence-tray" aria-label="Your assembled sentence">
                 ${lockedOpeningHtml}${chosenTiles.length ? chosenTiles.map(tile => `<button type="button" class="sentence-tile is-placed" data-remove-tile="${escapeHtml(tile.id)}" ${answered ? 'disabled' : ''}>${escapeHtml(tile.text)}</button>`).join('') : `<span class="sentence-tray-placeholder">${sentencePuzzle.opening ? 'Tap the phrase tiles below to finish the sentence.' : 'Tap the phrase tiles below in order.'}</span>`}
               </div>`
            : ''}
          ${answered ? `<div class="practice-feedback ${correct ? 'correct' : 'incorrect'}" role="status" aria-live="polite"><strong><i class="fa-solid ${correct ? 'fa-check' : 'fa-xmark'}" aria-hidden="true"></i> ${correct ? escapeHtml(answerEncouragement({ correct, recallType: recallTypeForFeedback, hintsUsed })) : (sentenceMode ? 'Expected sentence' : 'Answer')}${sentenceMode ? '' : `: ${escapeHtml(word.word)}`}</strong><span>${escapeHtml(feedbackDetail)}</span>${correct && memoryBoost ? `<em class="memory-boost-pill"><i class="fa-solid fa-seedling" aria-hidden="true"></i> ${escapeHtml(memoryBoost)}</em>` : ''}</div><div class="inline-actions"><button class="status-pill offline" id="practice-hear-answer"><i class="fa-solid fa-volume-high"></i> ${sentenceMode ? 'Hear sentence' : 'Hear answer'}</button><button class="btn-green-solid" id="daily-next">${index + 1 === queue.length ? 'See result' : 'Next word'}</button></div>`
            : visual ? `<div class="choice-grid">${optionsList.map(option => `<button class="choice-button" data-daily-choice="${escapeHtml(option.id)}"><span>${escapeHtml(option.word)}</span></button>`).join('')}</div>`
            : sentenceMode ? `<div class="sentence-tile-bank" role="group" aria-label="Phrase bank">${sentencePuzzle.tiles.map(tile => { const used = chosenSet.has(tile.id); return `<button type="button" class="sentence-tile${used ? ' is-used' : ''}" data-pick-tile="${escapeHtml(tile.id)}" ${used ? 'disabled aria-hidden="true" tabindex="-1"' : ''}>${escapeHtml(tile.text)}</button>`; }).join('')}</div><div class="sentence-controls"><button type="button" class="status-pill offline" id="daily-sentence-hint"><i class="fa-solid fa-lightbulb" aria-hidden="true"></i> Hint</button><button type="button" class="status-pill offline" id="daily-sentence-clear" ${chosenTiles.length ? '' : 'disabled'}>Clear</button><button type="button" class="btn-green-solid" id="daily-sentence-check" data-sound="none" ${canCheckSentence ? '' : 'disabled'}>Check</button></div>`
            : `<form class="practice-answer-form" id="daily-form"><input id="daily-answer" lang="en" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" enterkeyhint="done" placeholder="Type the word" aria-label="Your answer"><button class="btn-green-solid" data-sound="none">Check</button></form>`}
        </div>
      </div></section>`;
    } else {
      container.innerHTML = `<section class="full-view-stack"><div class="spec-card daily-session-shell ${options.kind === 'weak' ? 'is-weak-session' : ''}">
      <div class="daily-session-top"><button class="daily-exit-button" id="daily-exit" aria-label="Exit ${sessionLabel}"><i class="fa-solid fa-xmark" aria-hidden="true"></i><span class="daily-exit-label">Exit</span></button><div><span>${sessionLabel}</span><strong>${index + 1} of ${queue.length}</strong></div><span class="daily-score">${escapeHtml(progress.status)}</span></div>
      <div class="review-progress" role="progressbar" aria-label="Practice progress" aria-valuemin="0" aria-valuemax="${queue.length}" aria-valuenow="${progress.completed}"><span style="width:${progress.percent}%"></span></div>
      <div class="daily-exercise-stage ${answered ? (correct ? 'is-correct' : 'is-incorrect') : ''}"><img class="daily-sprig" src="${mascot}" alt="" aria-hidden="true"><span class="eyebrow">${escapeHtml(copy.title)}</span><h1>${escapeHtml(copy.prompt)}</h1>
        ${exercise.exerciseType === 'image-recognition' && word.imageUrl ? `<figure class="daily-image-prompt"><img src="${escapeHtml(word.imageUrl)}" alt="Visual clue"></figure>` : ''}
        ${exercise.exerciseType === 'listening-recall' ? `<button class="audio-btn-circle large" id="daily-listen" aria-label="Play the word"><i class="fa-solid fa-volume-high"></i></button>` : ''}
        ${answered ? `<div class="answer-feedback-card ${correct ? 'correct' : 'incorrect'}" role="status" aria-live="polite"><i class="fa-solid ${correct ? 'fa-check' : 'fa-arrow-rotate-left'} answer-feedback-icon" aria-hidden="true"></i><div><strong>${escapeHtml(answerEncouragement({ correct, recallType: exercise.exerciseType === 'use-it' ? 'productive' : choiceMode ? 'recognition' : exercise.exerciseType === 'listening-recall' ? 'listening-recall' : 'free-recall', hintsUsed }))}</strong><span>${exercise.exerciseType === 'use-it' ? escapeHtml(useItResult?.feedback || '') : (correct ? escapeHtml(exampleForLearning(word) || definitionForLearning(word)) : `Answer: <b>${escapeHtml(word.word)}</b> — ${escapeHtml(definitionForLearning(word))}. It will be prioritized next time.`)}</span></div></div><button class="btn-green-solid" id="daily-next">Continue</button>`
          : choiceMode ? `<div class="choice-grid">${optionsList.map(option => `<button class="choice-button" data-daily-choice="${escapeHtml(option.id)}"><span>${escapeHtml(meaningLabels ? meaningLabels.get(option.id) : option.word)}</span></button>`).join('')}</div>`
            : `<form class="practice-answer-form daily-answer-form ${exercise.exerciseType === 'use-it' ? 'is-sentence' : 'is-recall'}" id="daily-form">${exercise.exerciseType === 'use-it' ? `<input id="daily-answer" type="text" autocomplete="off" autocapitalize="sentences" spellcheck="true" placeholder="Write a natural sentence" aria-label="${inputLabel}">` : `<input id="daily-answer" lang="en" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" enterkeyhint="done" placeholder="Type your answer" aria-label="${inputLabel}">`}<button class="btn-green-solid" data-sound="none">Check</button></form><button class="daily-hint-button" id="daily-hint">Need a hint?</button><p class="daily-hint" id="daily-hint-copy" role="status" aria-live="polite"></p>`}
      </div></div></section>`;
    }
    container.querySelector('.practice-image-prompt img, .daily-image-prompt img')?.addEventListener('error', () => {
      if (queue[index] !== exercise || answered) return;
      exercise.exerciseType = 'typed-recall';
      render();
    });
    container.querySelector('#daily-exit').addEventListener('click', () => go('dashboard', onNavigate));
    container.querySelector('#practice-hear-answer')?.addEventListener('click', () => {
      if (exercise.exerciseType === 'sentence-builder' && sentencePuzzle) speakWord(sentencePuzzle.sentence, 'en-US', 0.95);
      else speakWord(word.word, 'en-US', 0.95, word.audioUrl);
    });
    const playListeningWord = async (rate = 0.95) => {
      const played = await speakWord(word.word, 'en-US', rate, word.audioUrl);
      if (!played && queue[index] === exercise && !answered) {
        exercise.exerciseType = 'typed-recall';
        render();
      }
    };
    container.querySelector('#daily-listen')?.addEventListener('click', () => playListeningWord(0.95));
    container.querySelector('#daily-listen-slow')?.addEventListener('click', () => playListeningWord(0.72));
    if (exercise.exerciseType === 'listening-recall') {
      bindTalkingMascot(container, () => playListeningWord(0.95));
    }
    container.querySelectorAll('[data-pick-tile]').forEach(button => button.addEventListener('click', () => {
      const id = button.dataset.pickTile;
      if (!id || answered || sentenceChosenIds.includes(id)) return;
      sentenceChosenIds.push(id);
      render();
    }));
    container.querySelectorAll('[data-remove-tile]').forEach(button => button.addEventListener('click', () => {
      const id = button.dataset.removeTile;
      if (!id || answered) return;
      sentenceChosenIds = sentenceChosenIds.filter(item => item !== id);
      render();
    }));
    container.querySelector('#daily-sentence-clear')?.addEventListener('click', () => {
      sentenceChosenIds = [];
      render();
    });
    container.querySelector('#daily-sentence-hint')?.addEventListener('click', () => {
      if (answered || !sentencePuzzle) return;
      const tileMap = new Map(sentencePuzzle.tiles.map(tile => [tile.id, tile]));
      const prefix = [];
      for (let i = 0; i < sentencePuzzle.targetTokens.length; i += 1) {
        const expectedText = sentencePuzzle.targetTokens[i];
        const current = tileMap.get(sentenceChosenIds[i]);
        if (current && current.text === expectedText) {
          prefix.push(sentenceChosenIds[i]);
        } else {
          const nextTile = sentencePuzzle.tiles.find(tile => !tile.isDistractor && tile.text === expectedText && !prefix.includes(tile.id));
          if (nextTile) {
            sentenceChosenIds = [...prefix, nextTile.id];
            hintsUsed += 1;
            render();
          }
          return;
        }
      }
    });
    container.querySelector('#daily-sentence-check')?.addEventListener('click', () => {
      if (answered || sentenceChosenIds.length !== sentencePuzzle.targetTokens.length) return;
      void submit(sentenceChosenIds.join(' '));
    });
    container.querySelectorAll('[data-daily-choice]').forEach(button => button.addEventListener('click', () => submit(button.textContent, button.dataset.dailyChoice)));
    container.querySelector('#daily-form')?.addEventListener('submit', async event => {
      event.preventDefault();
      const answer = container.querySelector('#daily-answer').value;
      if (!answer.trim()) return;
      const button = event.currentTarget.querySelector('button');
      if (exercise.exerciseType === 'use-it') { button.disabled = true; button.textContent = 'Checking…'; }
      await submit(answer);
    });
    container.querySelector('#daily-hint')?.addEventListener('click', () => { hintsUsed += 1; container.querySelector('#daily-hint-copy').textContent = exercise.exerciseType === 'use-it' ? `Try a situation where “${word.word}” naturally describes what happened.` : `It starts with “${word.word.slice(0, Math.min(2, word.word.length))}”.`; });
    container.querySelector('#daily-next')?.addEventListener('click', () => { index += 1; resetQuestionState(); render(true); });
    if (exercise.exerciseType === 'listening-recall' && !answered && focusInput) {
      void speakWord(word.word, 'en-US', 0.95, word.audioUrl);
    }
    focusPracticeInput(container.querySelector('#daily-answer'), { allowTouch: focusInput });
  }

  render();
}
