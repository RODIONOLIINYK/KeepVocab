import { driveSync } from '../services/driveSync.js?v=18908';
import { recordExerciseResult } from '../services/exerciseResult.js?v=18908';
import { getGeminiSettings } from '../services/geminiSettings.js?v=18908';
import { playInteractionSound } from '../services/interactionSound.js?v=18908';
import { speakWord } from '../services/speechService.js?v=18912';
import {
  buildLocalSentenceSet,
  buildSentencePuzzle,
  canBuildSentenceExercise,
  evaluateSentenceAssembly,
  generateSentenceBuilderSet
} from '../services/sentenceBuilder.js';
import { ensureDailyStudyPlan, getActivePracticeWords, recordModeWordSelections, selectModeWords } from '../services/wordSelection.js?v=18908';
import { escapeHtml } from '../utils/html.js';
import { navigateTo as go } from '../utils/navigation.js';
import { formatMemoryBoost, renderPracticeHeader, renderPracticeMascot, renderPracticeNotice, comboShellClasses } from './PracticeElements.js?v=18915';
import { showComboCelebration } from './ComboCelebration.js?v=18917';

export function renderSentenceBuilderMode(container, onNavigate, options = {}) {
  const allWords = getActivePracticeWords(driveSync);
  const geminiEnabled = getGeminiSettings().enabled;
  const settings = ensureDailyStudyPlan(driveSync);
  const localWords = allWords.filter(word => canBuildSentenceExercise(word));
  const pool = geminiEnabled ? allWords : localWords;
  const selectedWords = selectModeWords(pool, {
    mode: 'sentence-builder',
    limit: 10,
    settings,
    useDailyPlan: true,
    allowCompletedPlanWords: true
  });

  const notice = (title, detail, actions, noticeOptions = {}) => {
    container.innerHTML = renderPracticeNotice({ title, detail, actions, ...noticeOptions });
    actions.forEach(action => container.querySelector(`#${action.id}`)?.addEventListener('click', action.run));
  };

  if (!selectedWords.length) {
    if (!allWords.length) {
      notice(
        'Save a word to start',
        'Add vocabulary and KeepVocab will turn your meanings into short phrase-tile sentence puzzles.',
        [
          { id: 'sentence-empty-primary', label: 'Add a word', run: () => document.getElementById('btn-header-quick-add')?.click() },
          { id: 'sentence-empty-home', label: 'Back to Today', secondary: true, run: () => go('dashboard', onNavigate) }
        ]
      );
      return;
    }
    notice(
      'Connect Gemini or add examples',
      'Build Sentence generates short phrase puzzles with Gemini, or uses saved example sentences from your Library.',
      [
        { id: 'sentence-empty-gemini', label: 'Set up Google AI Studio', run: () => go('settings', onNavigate) },
        { id: 'sentence-empty-library', label: 'Open library', secondary: true, run: () => go('library', onNavigate) },
        { id: 'sentence-empty-home', label: 'Back to Today', secondary: true, run: () => go('dashboard', onNavigate) }
      ]
    );
    return;
  }

  let words = [];
  let itemByWordId = new Map();
  let index = 0;
  let score = 0;
  let combo = 0;
  let answered = false;
  let correct = false;
  let hintsUsed = 0;
  let memoryBoost = '';
  let chosenIds = [];
  let puzzle = null;
  let startedAt = performance.now();

  const loadPuzzle = () => {
    const word = driveSync.getWords().find(item => item.id === words[index]?.id) || words[index];
    const generated = word ? itemByWordId.get(String(word.id)) : null;
    puzzle = word
      ? buildSentencePuzzle(word, allWords, {
        sentence: generated?.sentence || null,
        chunks: generated?.chunks || null,
        acceptedSentences: generated?.acceptedSentences || null,
        source: generated?.source || 'saved-example'
      })
      : null;
    chosenIds = [];
    answered = false;
    correct = false;
    hintsUsed = 0;
    memoryBoost = '';
    startedAt = performance.now();
  };

  function startSession(generatedSet) {
    itemByWordId = new Map((generatedSet?.items || []).map(item => [String(item.wordId), item]));
    words = selectedWords.filter(word => itemByWordId.has(String(word.id)));
    if (!words.length) {
      const fallbackWords = selectModeWords(localWords, {
        mode: 'sentence-builder',
        limit: 10,
        settings,
        useDailyPlan: true,
        allowCompletedPlanWords: true
      });
      if (!fallbackWords.length) {
        notice(
          'Could not create sentence puzzles',
          'Check your Gemini connection or add example sentences in Library.',
          [
            { id: 'sentence-retry', label: 'Try again', run: () => load(true) },
            { id: 'sentence-settings', label: 'Check AI settings', secondary: true, run: () => go('settings', onNavigate) }
          ]
        );
        return;
      }
      const localSet = buildLocalSentenceSet(fallbackWords);
      itemByWordId = new Map(localSet.items.map(item => [String(item.wordId), item]));
      words = fallbackWords.filter(word => itemByWordId.has(String(word.id)));
    }
    recordModeWordSelections(driveSync, words, { mode: 'sentence-builder' });
    index = 0;
    score = 0;
    combo = 0;
    loadPuzzle();
    render();
  }

  async function load(force = false) {
    if (!geminiEnabled) {
      startSession(buildLocalSentenceSet(selectedWords));
      return;
    }
    notice(
      'Creating fresh sentence puzzles…',
      'Generating short, unambiguous phrase puzzles from your saved meanings with Gemini.',
      [{ id: 'sentence-cancel', label: 'Cancel', secondary: true, run: () => go('dashboard', onNavigate) }],
      { loading: true }
    );
    const loadingView = container.firstElementChild;
    try {
      const generated = await generateSentenceBuilderSet(selectedWords, { force });
      if (!container.contains(loadingView)) return;
      startSession(generated);
    } catch (error) {
      if (!container.contains(loadingView)) return;
      try {
        startSession(buildLocalSentenceSet(localWords.slice(0, 10)));
      } catch {
        notice(
          'Could not create sentence puzzles',
          error?.message || 'Check your connection or Gemini API key and try again.',
          [
            { id: 'sentence-retry', label: 'Try again', run: () => load(true) },
            { id: 'sentence-settings', label: 'Check AI settings', secondary: true, run: () => go('settings', onNavigate) },
            { id: 'sentence-home', label: 'Back to Today', secondary: true, run: () => go('dashboard', onNavigate) }
          ]
        );
      }
    }
  }

  function render() {
    if (index >= words.length) {
      notice(
        'Sentence Builder complete',
        `You assembled ${score} of ${words.length} sentences cleanly. Putting phrases together locks vocabulary into active grammar.`,
        [
          { id: 'sentence-again', label: geminiEnabled ? 'Build fresh AI set' : 'Build another set', run: () => renderSentenceBuilderMode(container, onNavigate, { force: true }) },
          { id: 'sentence-home', label: 'Back to Today', secondary: true, run: () => go('dashboard', onNavigate) }
        ],
        { complete: true }
      );
      return;
    }

    const word = driveSync.getWords().find(item => item.id === words[index].id) || words[index];
    if (!puzzle) {
      index += 1;
      loadPuzzle();
      return render();
    }

    const tileById = new Map(puzzle.tiles.map(tile => [tile.id, tile]));
    const chosenSet = new Set(chosenIds);
    const chosenTiles = chosenIds.map(id => tileById.get(id)).filter(Boolean);
    const canCheck = chosenTiles.length === puzzle.targetTokens.length && !answered;
    const sourceBadge = puzzle.source === 'ai'
      ? '<span class="duo-source-chip"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> AI sentence</span>'
      : '';
    const lockedOpeningHtml = puzzle.opening
      ? `<span class="sentence-tile is-locked" aria-label="Sentence opening">${escapeHtml(puzzle.opening)}</span>`
      : '';

    container.innerHTML = `<section class="full-view-stack" aria-labelledby="sentence-heading">
      <div class="spec-card practice-shell sentence-shell${comboShellClasses(combo)}">
        <div class="card-header-bar">
          <div class="card-tag" id="sentence-heading"><i class="fa-solid fa-align-left" aria-hidden="true"></i> Build Sentence</div>
          <span class="muted-label">${escapeHtml(driveSync.getActiveNotebook())}</span>
        </div>
        ${renderPracticeHeader({ exitId: 'sentence-exit', label: '', current: index, total: words.length, score, answered })}
        <div class="practice-prompt sentence-prompt">
          ${renderPracticeMascot({
            heading: puzzle.opening ? 'Complete the sentence' : 'Build the sentence',
            bubbleHtml: `<div class="duo-bubble-word-row"><strong>${escapeHtml(word.word)}</strong><span class="duo-bubble-tags"><span class="review-pos-hint">${escapeHtml(word.partOfSpeech || 'word')}</span>${sourceBadge}</span></div><p class="duo-bubble-copy">${escapeHtml(puzzle.definition)}</p>`,
            answered,
            correct,
            combo
          })}
          <div class="sentence-answer-tray${answered ? (correct ? ' is-correct' : ' is-incorrect') : ''}" id="sentence-tray" aria-label="Your assembled sentence">
            ${lockedOpeningHtml}
            ${chosenTiles.length
              ? chosenTiles.map(tile => `<button type="button" class="sentence-tile is-placed" data-remove-tile="${escapeHtml(tile.id)}" ${answered ? 'disabled' : ''}>${escapeHtml(tile.text)}</button>`).join('')
              : `<span class="sentence-tray-placeholder">${puzzle.opening ? 'Tap the phrase tiles below to finish the sentence.' : 'Tap the phrase tiles below in order.'}</span>`}
          </div>
          ${answered
            ? `<div class="practice-feedback ${correct ? 'correct' : 'incorrect'}" role="status" aria-live="polite">
                <strong><i class="fa-solid ${correct ? 'fa-check' : 'fa-xmark'}" aria-hidden="true"></i> ${correct ? 'Sentence locked in!' : 'Expected sentence'}</strong>
                <span>${escapeHtml(puzzle.sentence)}</span>
                ${correct && memoryBoost ? `<em class="memory-boost-pill"><i class="fa-solid fa-seedling" aria-hidden="true"></i> ${escapeHtml(memoryBoost)}</em>` : ''}
              </div>
              <div class="inline-actions">
                <button type="button" class="status-pill offline" id="sentence-hear"><i class="fa-solid fa-volume-high" aria-hidden="true"></i> Hear sentence</button>
                <button type="button" class="btn-green-solid" id="sentence-next">${index + 1 === words.length ? 'See result' : 'Next sentence'}</button>
              </div>`
            : `<div class="sentence-tile-bank" role="group" aria-label="Phrase bank">
                ${puzzle.tiles.map(tile => {
                  const used = chosenSet.has(tile.id);
                  return `<button type="button" class="sentence-tile${used ? ' is-used' : ''}" data-pick-tile="${escapeHtml(tile.id)}" ${used ? 'disabled aria-hidden="true" tabindex="-1"' : ''}>${escapeHtml(tile.text)}</button>`;
                }).join('')}
              </div>
              <div class="sentence-controls">
                <button type="button" class="status-pill offline" id="sentence-hint"><i class="fa-solid fa-lightbulb" aria-hidden="true"></i> Hint</button>
                <button type="button" class="status-pill offline" id="sentence-clear" ${chosenTiles.length ? '' : 'disabled'}>Clear</button>
                <button type="button" class="btn-green-solid" id="sentence-check" data-sound="none" ${canCheck ? '' : 'disabled'}>Check</button>
              </div>`}
        </div>
      </div>
    </section>`;

    container.querySelector('#sentence-exit').addEventListener('click', () => go('dashboard', onNavigate));
    container.querySelectorAll('[data-pick-tile]').forEach(button => button.addEventListener('click', () => {
      const id = button.dataset.pickTile;
      if (!id || chosenSet.has(id) || answered) return;
      chosenIds.push(id);
      render();
    }));
    container.querySelectorAll('[data-remove-tile]').forEach(button => button.addEventListener('click', () => {
      const id = button.dataset.removeTile;
      if (!id || answered) return;
      chosenIds = chosenIds.filter(item => item !== id);
      render();
    }));
    container.querySelector('#sentence-clear')?.addEventListener('click', () => {
      chosenIds = [];
      render();
    });
    container.querySelector('#sentence-hint')?.addEventListener('click', () => {
      if (answered) return;
      const prefix = [];
      for (let i = 0; i < puzzle.targetTokens.length; i += 1) {
        const expectedText = puzzle.targetTokens[i];
        const currentTile = tileById.get(chosenIds[i]);
        if (currentTile && currentTile.text === expectedText) {
          prefix.push(chosenIds[i]);
        } else {
          const nextTile = puzzle.tiles.find(tile => tile.text === expectedText && !prefix.includes(tile.id));
          if (nextTile) {
            chosenIds = [...prefix, nextTile.id];
            hintsUsed += 1;
            render();
          }
          return;
        }
      }
    });
    container.querySelector('#sentence-check')?.addEventListener('click', () => {
      if (!canCheck) return;
      const evaluation = evaluateSentenceAssembly(puzzle.targetTokens, chosenTiles.map(tile => tile.text), {
        opening: puzzle.opening,
        acceptedSentences: puzzle.acceptedSentences
      });
      answered = true;
      correct = evaluation.correct;
      if (correct) {
        score += 1;
        combo += 1;
      } else {
        combo = 0;
      }
      const applied = recordExerciseResult({
        wordId: word.id,
        exerciseType: 'sentence-builder',
        correct,
        responseTimeMs: performance.now() - startedAt,
        hintsUsed,
        recallType: 'context',
        producedUnaided: correct && hintsUsed === 0
      });
      memoryBoost = correct ? formatMemoryBoost(applied?.transition) : '';
      if (!correct || !showComboCelebration(combo)) {
        playInteractionSound(correct ? 'correct' : 'wrong', { combo });
      }
      window.dispatchEvent(new CustomEvent('keepvocab:progress'));
      render();
    });
    container.querySelector('#sentence-hear')?.addEventListener('click', () => speakWord(puzzle.sentence, 'en-US', 0.92));
    container.querySelector('#sentence-next')?.addEventListener('click', () => {
      index += 1;
      loadPuzzle();
      render();
    });
  }

  load(Boolean(options.force));
}
