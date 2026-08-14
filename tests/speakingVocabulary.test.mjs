import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVocabularySpeakingInstruction, detectSpeakingActivations, selectSpeakingTargets, speakingSessionHighlights, storeSpeakingActivations } from '../js/services/speakingVocabulary.js';

const now = new Date('2026-08-15T10:00:00.000Z');
const words = [
  { id: 'due', word: 'adversary', definition: 'an opponent', createdAt: '2026-07-01T00:00:00.000Z', nextReviewDate: '2026-08-14T00:00:00.000Z', mastery: { recall: .7, speaking: 0 } },
  { id: 'weak', word: 'meager', definition: 'lacking in quantity', createdAt: '2026-08-10T00:00:00.000Z', nextReviewDate: '2026-09-14T00:00:00.000Z', mastery: { recall: .6, speaking: 0 }, mistakes: { recentFailures: 3, consecutiveFailures: 2 } },
  { id: 'easy', word: 'bestow', definition: 'to give as an honor', createdAt: '2026-01-01T00:00:00.000Z', nextReviewDate: '2026-09-14T00:00:00.000Z', mastery: { recall: .9, speaking: .8 } }
];

test('speaking targets prioritize due and weak Library vocabulary ready for activation', () => {
  const targets = selectSpeakingTargets(words, { limit: 2, now });
  assert.deepEqual(targets.map(word => word.id).sort(), ['due', 'weak']);
});

test('speaking activation detects only learner-produced target vocabulary', () => {
  const activations = detectSpeakingActivations(words.slice(0, 2), [
    { role: 'coach', text: 'Tell me about an adversary.' },
    { role: 'learner', text: 'The meal was meager, so we ordered more.' }
  ]);
  assert.deepEqual(activations.map(item => [item.word.id, item.used]), [['due', false], ['weak', true]]);
  assert.match(buildVocabularySpeakingInstruction(words.slice(0, 2)), /Do not order the learner/);
});

test('successful speaking activation is stored as strong scheduler evidence', () => {
  const settings = {};
  let savedWords = structuredClone(words.slice(0, 2));
  const persistence = {
    getWords: () => structuredClone(savedWords),
    saveWords: next => { savedWords = structuredClone(next); },
    recordReview: () => {},
    getSettings: () => structuredClone(settings),
    updateSettings: patch => Object.assign(settings, structuredClone(patch))
  };
  const transcript = [{ role: 'learner', text: 'We faced a determined adversary in the final.' }];
  const activations = storeSpeakingActivations(words.slice(0, 2), transcript, persistence);
  const updated = savedWords.find(word => word.id === 'due');
  assert.equal(activations.find(item => item.word.id === 'due').used, true);
  assert.equal(updated.mastery.speaking > 0, true);
  assert.equal(updated.lastExerciseResult.recallType, 'speaking');
  assert.equal(speakingSessionHighlights(transcript, activations).used[0].id, 'due');
});
