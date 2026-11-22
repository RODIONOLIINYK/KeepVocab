import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLocalSentenceSet,
  buildSentenceGenerationPrompt,
  buildSentencePuzzle,
  canBuildSentenceExercise,
  evaluateSentenceAssembly,
  generateSentenceBuilderSet
} from '../js/services/sentenceBuilder.js';
import { applyExerciseToDailyQuests, getDailyQuests } from '../js/services/dailyQuests.js';
import { buildDailySession } from '../js/services/dailySession.js';
import { MemoryStorage } from '../js/services/driveSync.js';

test('sentence builder validates examples, creates shuffled tiles with distractors, and evaluates assembly', () => {
  const word = {
    id: 'resilient',
    word: 'resilient',
    partOfSpeech: 'adjective',
    definition: 'Able to recover quickly from difficulties.',
    example: 'The resilient team recovered quickly after the setback.'
  };
  const other = { id: 'vivid', word: 'vivid', partOfSpeech: 'adjective', definition: 'Bright and clear.' };
  assert.equal(canBuildSentenceExercise(word), true);
  assert.equal(canBuildSentenceExercise({ id: 'x', word: 'x', example: 'Too short.' }), false);

  const puzzle = buildSentencePuzzle(word, [word, other]);
  assert.ok(puzzle);
  assert.ok(puzzle.targetTokens.length >= 4 && puzzle.targetTokens.length <= 10);
  assert.ok(puzzle.tiles.length > puzzle.targetTokens.length, 'includes distractor tiles');
  assert.equal(evaluateSentenceAssembly(puzzle.targetTokens, puzzle.targetTokens).correct, true);
  assert.equal(evaluateSentenceAssembly(puzzle.targetTokens, [...puzzle.targetTokens].reverse()).correct, false);
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

test('daily quests track warmup, combo, and mode variety per local day', () => {
  const now = new Date(2026, 10, 22, 12);
  let state = null;
  for (let i = 0; i < 3; i += 1) {
    state = applyExerciseToDailyQuests(state, { exerciseType: 'daily-sentence-builder', correct: true }, now);
  }
  const summary = getDailyQuests({ learningStats: { dailyQuests: state }, reviewsDate: state.date, reviewsToday: 3 }, now);
  assert.equal(summary.quests.length, 3);
  assert.equal(summary.quests.find(q => q.id === 'combo').done, true);
  assert.equal(summary.quests.find(q => q.id === 'warmup').progress, 3);
});

test('Gemini sentence builder generates validated puzzles with distractors, caches them, and falls back to saved examples', async () => {
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
  assert.match(prompt, /6 to 11 words/);

  let calls = 0;
  const generate = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        items: [
          {
            wordId: 'w-ai-only',
            sentence: 'The meticulous editor checked every paragraph carefully.',
            distractors: ['swiftly', 'meticulous', 'two words', 'calmly']
          },
          {
            wordId: 'w-fallback',
            sentence: 'Missing target word completely here.'
          }
        ]
      };
    }
    // Repair call fails or misses w-fallback -> should fall back to saved example seamlessly.
    return { items: [] };
  };

  const result = await generateSentenceBuilderSet(words, { storage, generate });
  assert.equal(calls, 2, 'runs one targeted repair pass for missing items');
  assert.equal(result.kind, 'mixed');
  assert.equal(result.items.length, 2);

  const aiItem = result.items.find(item => item.wordId === 'w-ai-only');
  assert.equal(aiItem.source, 'ai');
  assert.deepEqual(aiItem.distractors, ['swiftly', 'calmly'], 'filters out target word and multi-word distractors');

  const fallbackItem = result.items.find(item => item.wordId === 'w-fallback');
  assert.equal(fallbackItem.source, 'saved-example');
  assert.equal(fallbackItem.sentence, 'She painted a vivid scene of the harbor.');

  const puzzle = buildSentencePuzzle(words[0], words, {
    sentence: aiItem.sentence,
    distractors: aiItem.distractors,
    source: aiItem.source
  });
  assert.equal(puzzle.source, 'ai');
  assert.ok(puzzle.tiles.some(tile => tile.isDistractor && tile.text === 'swiftly'));

  // Cached hit avoids calling Gemini again until force: true.
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
