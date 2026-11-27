import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLocalSentenceSet,
  buildSentenceGenerationPrompt,
  buildSentencePuzzle,
  canBuildSentenceExercise,
  chunkSentenceTokens,
  evaluateSentenceAssembly,
  generateSentenceBuilderSet
} from '../js/services/sentenceBuilder.js';
import { buildDailySession } from '../js/services/dailySession.js';
import { MemoryStorage } from '../js/services/driveSync.js';

test('sentence builder groups phrases to keep adjectives paired with nouns, locks opening anchor, and omits distractors', () => {
  const candid = {
    id: 'candid',
    word: 'candid',
    partOfSpeech: 'adjective',
    definition: 'Truthful and straightforward.',
    example: 'She gave a candid answer during the interview.'
  };
  assert.equal(canBuildSentenceExercise(candid), true);
  assert.equal(canBuildSentenceExercise({ id: 'x', word: 'x', example: 'Too short.' }), false);

  const puzzle = buildSentencePuzzle(candid, [candid]);
  assert.ok(puzzle);
  assert.equal(puzzle.opening, 'She', 'locks unambiguous opening chunk when target word is not inside it');
  assert.deepEqual(puzzle.targetTokens, ['gave', 'a candid answer', 'during the interview']);
  assert.equal(puzzle.distractorCount, 0, 'omits distractor tiles');
  assert.equal(puzzle.tiles.length, puzzle.targetTokens.length, 'every bank tile belongs to the sentence');
  assert.equal(
    evaluateSentenceAssembly(puzzle.targetTokens, puzzle.targetTokens, { opening: puzzle.opening, acceptedSentences: puzzle.acceptedSentences }).correct,
    true
  );
  assert.equal(
    evaluateSentenceAssembly(puzzle.targetTokens, [...puzzle.targetTokens].reverse(), { opening: puzzle.opening, acceptedSentences: puzzle.acceptedSentences }).correct,
    false
  );

  // Two adjectives + two nouns stay paired so adjectives are never interchangeable.
  const chunks = chunkSentenceTokens(['The', 'quiet', 'student', 'read', 'the', 'old', 'book', 'at', 'home']);
  assert.ok(chunks.includes('The quiet student'), 'keeps first adjective attached to its noun');
  assert.ok(chunks.includes('the old book'), 'keeps second adjective attached to its noun');
  assert.ok(chunks.includes('at home'), 'keeps preposition attached to its object');

  // When chunk 0 contains the target word, leave opening empty instead of hiding the target word.
  const resilient = {
    id: 'resilient',
    word: 'resilient',
    partOfSpeech: 'adjective',
    definition: 'Able to recover quickly from difficulties.',
    example: 'The resilient team recovered quickly after the setback.'
  };
  const resilientPuzzle = buildSentencePuzzle(resilient, [resilient]);
  assert.ok(resilientPuzzle);
  assert.equal(resilientPuzzle.opening, '');
  assert.ok(resilientPuzzle.targetTokens.length >= 3 && resilientPuzzle.targetTokens.length <= 5);
  assert.ok(resilientPuzzle.targetTokens.some(chunk => chunk.includes('resilient team')));
});

test('sentence builder accepts alternate valid word orders from Gemini and movable adverbs', () => {
  const word = {
    id: 'meticulous',
    word: 'meticulous',
    partOfSpeech: 'adjective',
    definition: 'Showing great attention to detail.'
  };
  const puzzle = buildSentencePuzzle(word, [word], {
    sentence: 'The editor checked every meticulous note carefully.',
    chunks: ['The editor', 'checked', 'every meticulous note', 'carefully'],
    acceptedSentences: ['The editor carefully checked every meticulous note.'],
    source: 'ai'
  });
  assert.equal(puzzle.opening, 'The editor');
  assert.equal(
    evaluateSentenceAssembly(puzzle.targetTokens, ['checked', 'every meticulous note', 'carefully'], {
      opening: puzzle.opening,
      acceptedSentences: puzzle.acceptedSentences
    }).correct,
    true
  );
  assert.equal(
    evaluateSentenceAssembly(puzzle.targetTokens, ['carefully', 'checked', 'every meticulous note'], {
      opening: puzzle.opening,
      acceptedSentences: puzzle.acceptedSentences
    }).correct,
    true,
    'accepts valid alternate placement of movable adverb'
  );
});

test('multi-mode Practice avoids repeating the same mode a word saw last time', () => {
  const now = new Date('2026-11-22T12:00:00.000Z');
  const word = {
    id: 'w1',
    word: 'candid',
    definition: 'Truthful and straightforward.',
    example: 'She gave a candid answer during the interview.',
    createdAt: '2026-11-10T12:00:00.000Z',
    nextReviewDate: now.toISOString(),
    mastery: { recognition: 1, recall: 0.8, context: 0.2, productive: 0, lastExerciseType: 'daily-sentence-builder' }
  };
  const second = {
    id: 'w2',
    word: 'steady',
    definition: 'Firmly fixed.',
    example: 'He kept a steady pace up the hill.',
    createdAt: '2026-11-10T12:00:00.000Z',
    nextReviewDate: now.toISOString(),
    mastery: { recognition: 1, recall: 0.8, context: 0.2, productive: 0, lastExerciseType: 'daily-context-cloze' }
  };
  const session = buildDailySession([word, second], { now });
  const w1Task = session.exercises.find(item => item.wordId === 'w1');
  const w2Task = session.exercises.find(item => item.wordId === 'w2');
  assert.notEqual(w1Task.exerciseType, 'sentence-builder');
  assert.notEqual(w2Task.exerciseType, 'context-cloze');
});

test('Gemini sentence builder generates chunked puzzles without distractors, caches them, and falls back to saved examples', async () => {
  const storage = new MemoryStorage();
  const words = [
    {
      id: 'w-ai-only',
      word: 'meticulous',
      partOfSpeech: 'adjective',
      definition: 'Showing great attention to detail.'
    },
    {
      id: 'w-fallback',
      word: 'vivid',
      partOfSpeech: 'adjective',
      definition: 'Producing clear, powerful images in the mind.',
      example: 'She painted a vivid scene of the harbor.'
    }
  ];

  const prompt = buildSentenceGenerationPrompt(words, { storage });
  assert.match(prompt, /meticulous/);
  assert.match(prompt, /5 to 9 words/);
  assert.match(prompt, /Do not include distractors/);

  let calls = 0;
  const generate = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        items: [
          {
            wordId: 'w-ai-only',
            sentence: 'The editor kept meticulous notes for the review.',
            chunks: ['The editor', 'kept', 'meticulous notes', 'for the review'],
            acceptedSentences: []
          },
          {
            wordId: 'w-fallback',
            sentence: 'Missing target word completely here.'
          }
        ]
      };
    }
    return { items: [] };
  };

  const result = await generateSentenceBuilderSet(words, { storage, generate });
  assert.equal(calls, 2, 'runs one targeted repair pass for missing items');
  assert.equal(result.kind, 'mixed');
  assert.equal(result.items.length, 2);

  const aiItem = result.items.find(item => item.wordId === 'w-ai-only');
  assert.equal(aiItem.source, 'ai');
  assert.deepEqual(aiItem.chunks, ['The editor', 'kept', 'meticulous notes', 'for the review']);

  const fallbackItem = result.items.find(item => item.wordId === 'w-fallback');
  assert.equal(fallbackItem.source, 'saved-example');
  assert.equal(fallbackItem.sentence, 'She painted a vivid scene of the harbor.');

  const puzzle = buildSentencePuzzle(words[0], words, {
    sentence: aiItem.sentence,
    chunks: aiItem.chunks,
    acceptedSentences: aiItem.acceptedSentences,
    source: aiItem.source
  });
  assert.equal(puzzle.source, 'ai');
  assert.equal(puzzle.opening, 'The editor');
  assert.equal(puzzle.distractorCount, 0);
  assert.equal(puzzle.tiles.length, 3);

  const cached = await generateSentenceBuilderSet(words, { storage, generate });
  assert.equal(calls, 2);
  assert.equal(cached.items.length, 2);

  await generateSentenceBuilderSet(words, { storage, generate, force: true });
  assert.ok(calls >= 3, 'force: true bypasses cache to generate fresh sentences');

  const localOnly = buildLocalSentenceSet(words);
  assert.equal(localOnly.kind, 'local');
  assert.equal(localOnly.items.length, 1);
  assert.equal(localOnly.items[0].wordId, 'w-fallback');
});
