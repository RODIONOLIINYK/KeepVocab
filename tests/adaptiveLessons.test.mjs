import test from 'node:test';
import assert from 'node:assert/strict';

import {
  adaptiveLessonDifficulty,
  buildAdaptiveContext,
  buildDialogueOpeningPrompt,
  buildDialogueTurnPrompt,
  buildListeningGenerationPrompt,
  buildTranslationGenerationPrompt,
  evaluateListeningResponse,
  evaluateTranslationResponse,
  generateDialogueActivity,
  generateListeningActivity,
  generateTranslationActivity,
  processDialogueTurn,
  selectAdaptiveVocabulary
} from '../js/services/adaptiveLessons.js';
import { LITHUANIAN_UNITS } from '../js/data/lithuanianCurriculum.js';
import { MemoryStorage } from '../js/services/driveSync.js';
import { saveGeminiSettings } from '../js/services/geminiSettings.js';

function contextFor({ completed = 0, words = [] } = {}) {
  const unit = LITHUANIAN_UNITS[0];
  return {
    ...buildAdaptiveContext({
      session: unit.sessions[0],
      unit,
      profile: { completedNodeIds: Array.from({ length: completed }, (_, index) => `done-${index}`) },
      words
    }),
    unitPhrases: unit.phrases
  };
}

test('lesson length and interaction demands rise with progress and vocabulary', () => {
  const starter = adaptiveLessonDifficulty({ completedLessons: 0, vocabularyCount: 0, unitNumber: 1 });
  const experienced = adaptiveLessonDifficulty({ completedLessons: 180, vocabularyCount: 350, unitNumber: 31 });
  assert.ok(experienced.band > starter.band);
  assert.ok(experienced.translationWordTarget > starter.translationWordTarget);
  assert.ok(experienced.listeningWords > starter.listeningWords);
  assert.ok(experienced.dialogueTurns > starter.dialogueTurns);
  assert.ok(experienced.learnerTurns > starter.learnerTurns);
  assert.ok(starter.learnerTurns >= 3);
  assert.ok(experienced.speechRate > starter.speechRate);
  assert.ok(experienced.knownCoverageTarget < starter.knownCoverageTarget);
});

test('dialogue keeps going when Gemini reports completion after the first reply', async () => {
  const context = contextFor();
  const storage = new MemoryStorage();
  saveGeminiSettings({ apiKey: 'AIza-example-device-key-123456789' }, storage, { silent: true });
  const activity = { aiGenerated: true, scenario: 'Coffee', goal: 'Order coffee', successCriteria: ['Ask for coffee'] };
  const generate = async () => ({ accepted: true, goalComplete: true, partnerReply: 'Ko dar norėtumėte?' });
  const history = [{ role: 'partner', text: 'Labas!' }, { role: 'learner', text: 'Kavos, prašau.' }];
  const first = await processDialogueTurn(activity, history, 'Kavos, prašau.', context, { storage, generate });
  assert.equal(first.goalComplete, false);
  assert.equal(first.accepted, true);
  assert.match(buildDialogueTurnPrompt(activity, history, 'Kavos, prašau.', context), /at least 3 learner turns/);
  history.push({ role: 'learner', text: 'Arbatos.' }, { role: 'learner', text: 'Ačiū.' });
  const third = await processDialogueTurn(activity, history, 'Ačiū.', context, { storage, generate });
  assert.equal(third.goalComplete, true);
  const unavailable = await processDialogueTurn(activity, history, 'Ačiū.', context, { storage, generate: async () => { throw new Error('offline'); } });
  assert.equal(unavailable.goalComplete, false);
  assert.equal(unavailable.unscored, true);
});

test('authored conversation progresses through multiple distinct replies', async () => {
  const context = contextFor();
  const storage = new MemoryStorage();
  const activity = await generateDialogueActivity(context, { storage });
  const history = [];
  for (let index = 0; index < context.difficulty.learnerTurns; index++) {
    const reply = activity.guidedReplies[index].lt;
    history.push({ role: 'learner', text: reply });
    const result = await processDialogueTurn(activity, history, reply, context, { storage });
    assert.equal(result.accepted, true);
    assert.equal(result.goalComplete, index === context.difficulty.learnerTurns - 1);
    assert.equal(result.supportPhrase, activity.guidedReplies[(index + 1) % activity.guidedReplies.length].lt);
  }
});

test('adaptive vocabulary is Lithuanian-only, unique, and prioritises learning needs', () => {
  const selected = selectAdaptiveVocabulary([
    { word: 'knyga', definition: 'book', courseId: 'lithuanian', mastered: true },
    { word: 'eiti', definition: 'to go', languageCode: 'lt', mistakes: 4 },
    { word: 'eiti', definition: 'duplicate', courseId: 'lithuanian' },
    { word: 'house', definition: 'namas', courseId: 'english', mistakes: 10 }
  ]);
  assert.deepEqual(selected.map(item => item.word), ['eiti', 'knyga']);
});

test('generation prompts carry progress, personal vocabulary, comprehensibility, and two-speaker constraints', () => {
  const context = contextFor({
    completed: 42,
    words: [{ word: 'knyga', translation: 'book', courseId: 'lithuanian' }]
  });
  const listening = buildListeningGenerationPrompt(context, 'dialogue');
  const translation = buildTranslationGenerationPrompt(context);
  const dialogue = buildDialogueOpeningPrompt(context);
  assert.match(listening, /Completed guided lessons: 42/);
  assert.match(listening, /knyga = book/);
  assert.match(listening, /exactly two speakers named Rasa and Mantas/);
  assert.match(listening, /familiar/);
  assert.match(translation, new RegExp(`about ${context.difficulty.translationWordTarget} words`));
  assert.match(dialogue, new RegExp(`${context.difficulty.learnerTurns} learner turns`));
});

test('adaptive activities use authored fallbacks when Gemini is not configured', async () => {
  const context = contextFor();
  const storage = new MemoryStorage();
  const [listening, translation, dialogue] = await Promise.all([
    generateListeningActivity(context, { kind: 'dialogue', storage, unitPhrases: context.unitPhrases }),
    generateTranslationActivity(context, { storage, unitPhrases: context.unitPhrases }),
    generateDialogueActivity(context, { storage, unitPhrases: context.unitPhrases })
  ]);
  assert.equal(listening.aiGenerated, false);
  assert.equal(listening.transcript.length, 3);
  assert.equal(new Set(listening.transcript.map(turn => turn.speaker)).size, 2);
  assert.equal(translation.aiGenerated, false);
  assert.ok(translation.englishPrompt && translation.lithuanianModel);
  assert.equal(dialogue.aiGenerated, false);
});

test('valid Gemini JSON is normalised as an AI-generated listening activity', async () => {
  const context = contextFor();
  const storage = new MemoryStorage();
  saveGeminiSettings({ apiKey: 'AIza-example-device-key-123456789' }, storage, { silent: true });
  const activity = await generateListeningActivity(context, {
    kind: 'dialogue',
    storage,
    force: true,
    generate: async () => ({
      kind: 'dialogue',
      title: 'At a café',
      topic: 'ordering a drink',
      transcript: [{ speaker: 'Rasa', text: 'Ko norėtumėte?' }, { speaker: 'Mantas', text: 'Norėčiau kavos.' }],
      gistQuestion: 'What are they mainly doing?',
      acceptedGistAnswers: ['ordering coffee'],
      modelSummary: 'They are ordering a drink.',
      keyDetails: ['Mantas wants coffee.']
    })
  });
  assert.equal(activity.aiGenerated, true);
  assert.equal(activity.transcript[1].speaker, 'Mantas');
});

test('semantic lesson checks accept equivalents and keep offline dialogue productive', async () => {
  const context = contextFor();
  const storage = new MemoryStorage();
  const listening = {
    modelSummary: 'They are ordering coffee at a café.',
    acceptedGistAnswers: ['ordering coffee'],
    keyDetails: [],
    aiGenerated: false
  };
  assert.equal((await evaluateListeningResponse(listening, 'They order coffee.', context, { storage })).correct, true);

  const translation = {
    englishPrompt: 'I am learning Lithuanian.',
    lithuanianModel: 'Aš mokausi lietuvių kalbos.',
    acceptedAnswers: [],
    explanation: 'Use the present tense.',
    aiGenerated: false
  };
  assert.equal((await evaluateTranslationResponse(translation, 'aš mokausi lietuvių kalbos!', context, { storage })).correct, true);

  const turn = await processDialogueTurn({ aiGenerated: false, successCriteria: ['Aš noriu kavos'] }, [], 'Aš noriu kavos', context, { storage });
  assert.equal(turn.accepted, true);
  assert.ok(turn.partnerReply);
});
