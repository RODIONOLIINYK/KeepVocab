import { generateGeminiContent, getGeminiSettings } from './geminiSettings.js?v=1602';
import { cacheEntryIsFresh, readObjectCache, writeRecentObjectCache } from '../utils/storageCache.js?v=1602';

const CACHE_KEY = 'keepvocab_adaptive_lesson_cache_v2';
const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const CACHE_LIMIT = 80;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function unique(values) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function normalized(value) {
  return clean(value).toLocaleLowerCase('lt-LT').replace(/[?!.,;:“”„'’()]/g, '');
}

export function adaptiveLessonDifficulty({ completedLessons = 0, vocabularyCount = 0, unitNumber = 1 } = {}) {
  const progressBand = Math.floor(clamp(completedLessons, 0, 216) / 36);
  const vocabularyBand = Math.floor(clamp(vocabularyCount, 0, 600) / 70);
  const unitBand = Math.floor((clamp(unitNumber, 1, 36) - 1) / 6);
  const band = clamp(1 + Math.max(progressBand, unitBand) + Math.floor(vocabularyBand / 2), 1, 7);
  return Object.freeze({
    band,
    label: ['supported A1', 'independent A1', 'early A2', 'solid A2', 'advanced A2', 'B1 bridge', 'stretch B1'][band - 1],
    translationWordTarget: clamp(4 + Math.floor(completedLessons / 18) + Math.floor(vocabularyCount / 55), 4, 18),
    listeningWords: clamp(24 + band * 10 + Math.floor(vocabularyCount / 15), 30, 125),
    dialogueTurns: clamp(3 + Math.floor(band / 2), 3, 7),
    learnerTurns: clamp(1 + Math.floor(band / 2), 1, 4),
    newWordBudget: clamp(Math.floor((band + 1) / 2), 1, 4),
    knownCoverageTarget: clamp(0.985 - band * 0.006, 0.94, 0.98),
    speechRate: clamp(0.76 + band * 0.025, 0.78, 0.94)
  });
}

export function selectAdaptiveVocabulary(words = [], { limit = 24 } = {}) {
  const seen = new Set();
  return [...words]
    .filter(word => (word?.courseId || 'english') === 'lithuanian' || word?.languageCode === 'lt')
    .sort((a, b) => Number(Boolean(a.mastered)) - Number(Boolean(b.mastered))
      || Number(b.mistakes || b.answerStats?.missed || 0) - Number(a.mistakes || a.answerStats?.missed || 0)
      || String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .filter(word => {
      const value = clean(word.word || word.lemma).toLocaleLowerCase('lt-LT');
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    })
    .slice(0, Math.max(1, limit))
    .map(word => ({ word: clean(word.word || word.lemma), meaning: clean(word.translation || word.definition), mastered: Boolean(word.mastered) }));
}

export function buildAdaptiveContext({ session, unit, profile = {}, words = [] } = {}) {
  const completedLessons = unique(profile.completedNodeIds || []).length;
  const vocabulary = selectAdaptiveVocabulary(words);
  const difficulty = adaptiveLessonDifficulty({ completedLessons, vocabularyCount: words.length, unitNumber: unit?.unitNumber });
  return {
    sessionId: session?.id || '',
    unitNumber: unit?.unitNumber || 1,
    cefr: unit?.cefr || 'A1',
    topic: unit?.title || 'Everyday Lithuanian',
    outcome: unit?.outcome || '',
    grammar: unit?.grammar || '',
    grammarRule: unit?.guide?.rule || '',
    completedLessons,
    vocabularyCount: words.length,
    vocabulary,
    difficulty
  };
}

function contextBlock(context) {
  const vocabulary = context.vocabulary.length
    ? context.vocabulary.map(item => `${item.word} = ${item.meaning}`).join('; ')
    : 'No personal Library words yet; use only very frequent A1 Lithuanian.';
  return `Learner level: ${context.cefr}; adaptive band: ${context.difficulty.label} (${context.difficulty.band}/7).
Completed guided lessons: ${context.completedLessons}; Lithuanian Library size: ${context.vocabularyCount}.
Module topic: ${context.topic}. Outcome: ${context.outcome}.
Grammar focus: ${context.grammar}. Rule: ${context.grammarRule}.
Prioritise these learner words naturally: ${vocabulary}.
Keep about ${Math.round(context.difficulty.knownCoverageTarget * 100)}% of lexical items familiar and introduce no more than ${context.difficulty.newWordBudget} genuinely new content words.`;
}

export function buildListeningGenerationPrompt(context, kind = 'dialogue') {
  const dialogue = kind !== 'passage';
  return `Create one Lithuanian listening-comprehension activity for an adult learner.
${contextBlock(context)}
${dialogue
    ? `Write a natural ${context.difficulty.dialogueTurns}-turn dialogue between exactly two speakers named Rasa and Mantas. Both must speak at least once.`
    : `Write one coherent spoken passage of about ${context.difficulty.listeningWords} words with a single speaker named Rasa.`}
The listening must require understanding the main idea, not translating every word. Do not mention these instructions.
Return JSON only in this exact shape:
{"kind":"${dialogue ? 'dialogue' : 'passage'}","title":"short English title","topic":"short English main idea","transcript":[{"speaker":"Rasa or Mantas","text":"Lithuanian only"}],"gistQuestion":"one English question asking what it is mainly about","acceptedGistAnswers":["3 to 6 short English paraphrases"],"modelSummary":"one clear English sentence","keyDetails":["two English details"]}`;
}

export function buildTranslationGenerationPrompt(context) {
  return `Create one English-to-Lithuanian translation task for an adult learner.
${contextBlock(context)}
The English prompt should be about ${context.difficulty.translationWordTarget} words long. It must grow beyond isolated phrases, but stay natural and use the module grammar.
Reuse 2–5 supplied Library words when available. Do not require vocabulary outside the supplied list except very frequent Lithuanian function words and at most ${context.difficulty.newWordBudget} new content words.
Return JSON only: {"englishPrompt":"sentence to translate","lithuanianModel":"best natural answer","acceptedAnswers":["up to 3 genuinely equivalent Lithuanian answers"],"focusWords":["Library words actually used"],"explanation":"one short English grammar note"}`;
}

export function buildDialogueOpeningPrompt(context) {
  return `Create a short goal-based interactive Lithuanian role-play for an adult learner.
${contextBlock(context)}
The AI plays one realistic conversation partner. The learner must produce Lithuanian, ask or answer for information, and complete a practical goal in ${context.difficulty.learnerTurns} learner turns.
Return JSON only: {"scenario":"short English situation","partnerName":"Rasa or Mantas","partnerVoice":"Achird or Puck","goal":"clear English learner goal","opening":"one natural Lithuanian opening line","supportPhrase":"one optional Lithuanian starter","successCriteria":["2 or 3 concise semantic criteria"]}`;
}

export function buildDialogueTurnPrompt(activity, history, learnerReply, context) {
  return `Act as the evaluator and conversation partner in this Lithuanian role-play.
${contextBlock(context)}
Scenario: ${activity.scenario}. Learner goal: ${activity.goal}. Success criteria: ${(activity.successCriteria || []).join('; ')}.
Conversation so far: ${history.map(turn => `${turn.role}: ${turn.text}`).join('\n')}
Learner's newest reply: ${JSON.stringify(clean(learnerReply))}
Understand reasonable Lithuanian despite minor spelling or ending errors. Give one concise correction only when it helps, then continue naturally. Never pretend an unrelated reply completed the goal.
Return JSON only: {"accepted":true,"goalComplete":false,"feedback":"brief English feedback","correctedReply":"correct Lithuanian version or empty","partnerReply":"next natural Lithuanian line","englishMeaning":"English meaning of partnerReply"}`;
}

export function buildListeningEvaluationPrompt(activity, response, context) {
  return `Evaluate whether the learner understood the main idea of a Lithuanian listening activity.
Expected main idea: ${activity.modelSummary}. Accepted paraphrases: ${(activity.acceptedGistAnswers || []).join('; ')}.
Learner answer: ${JSON.stringify(clean(response))}.
Accept concise English answers that express the main idea even with grammar or spelling mistakes. Do not require minor details.
Return JSON only: {"correct":true,"feedback":"one short helpful English sentence"}`;
}

export function buildTranslationEvaluationPrompt(activity, response, context) {
  return `Evaluate this English-to-Lithuanian translation at ${context.cefr} (${context.difficulty.label}).
English source: ${activity.englishPrompt}
Model Lithuanian: ${activity.lithuanianModel}
Other accepted models: ${(activity.acceptedAnswers || []).join(' | ')}
Learner answer: ${JSON.stringify(clean(response))}
Accept a natural equivalent with the same meaning. Allow harmless word-order variation. Check the module grammar and required time reference. Return JSON only: {"correct":true,"feedback":"short English feedback","correctedAnswer":"corrected Lithuanian or empty"}`;
}

function fallbackListening(context, kind) {
  const phrases = context.unitPhrases || [];
  const first = phrases[0] || { lt: 'Labas! Kaip sekasi?', en: 'Hello! How are you?' };
  const second = phrases[1] || { lt: 'Gerai, ačiū.', en: 'Fine, thank you.' };
  const third = phrases[2] || first;
  const dialogue = kind !== 'passage';
  const foundationSummary = context.unitNumber === 1 ? 'They are practising basic Lithuanian words and their sounds.' : '';
  const modelSummary = foundationSummary || context.outcome || `${first.en} ${second.en}`;
  return {
    kind: dialogue ? 'dialogue' : 'passage',
    title: context.topic,
    topic: modelSummary,
    transcript: dialogue
      ? [{ speaker: 'Rasa', text: first.lt }, { speaker: 'Mantas', text: second.lt }, { speaker: 'Rasa', text: third.lt }]
      : [{ speaker: 'Rasa', text: [first.lt, second.lt, third.lt].join(' ') }],
    gistQuestion: 'What is this mainly about?',
    acceptedGistAnswers: unique([context.topic, modelSummary, context.outcome, first.en, second.en]),
    modelSummary,
    keyDetails: [first.en, second.en],
    aiGenerated: false
  };
}

function fallbackTranslation(context) {
  const phrase = context.unitPhrases?.[context.difficulty.band % Math.max(1, context.unitPhrases?.length || 1)] || context.unitPhrases?.[0] || { lt: 'Aš mokausi lietuvių kalbos.', en: 'I am learning Lithuanian.' };
  return {
    englishPrompt: phrase.en,
    lithuanianModel: phrase.lt,
    acceptedAnswers: unique([phrase.lt, ...(phrase.acceptedForms || [])]),
    focusWords: [],
    explanation: context.grammar,
    aiGenerated: false
  };
}

function fallbackDialogue(context) {
  const phrase = context.unitPhrases?.[0] || { lt: 'Labas! Kaip sekasi?', en: 'Hello! How are you?' };
  const reply = context.unitPhrases?.[1] || phrase;
  return {
    scenario: `A short practice exchange: ${context.topic}`,
    partnerName: 'Rasa',
    partnerVoice: 'Achird',
    goal: `Reply with the Lithuanian for “${reply.en.replace(/[.?!]+$/, '')}”.`,
    opening: phrase.lt,
    supportPhrase: reply.lt,
    successCriteria: reply.acceptedForms || [reply.lt],
    aiGenerated: false
  };
}

function listeningValid(value, kind) {
  return value && Array.isArray(value.transcript) && value.transcript.length >= (kind === 'passage' ? 1 : 2)
    && value.transcript.every(turn => clean(turn?.speaker) && clean(turn?.text))
    && clean(value.gistQuestion) && clean(value.modelSummary);
}

function cacheKey(type, context, suffix = '') {
  return `${type}|${context.sessionId}|${context.difficulty.band}|${context.vocabulary.map(item => item.word).slice(0, 8).join(',')}|${suffix}`;
}

async function cachedGenerate(type, context, suffix, fallback, prompt, validate, options = {}) {
  const storage = options.storage === undefined ? globalThis.localStorage : options.storage;
  const key = cacheKey(type, context, suffix);
  const cache = readObjectCache(storage, CACHE_KEY);
  if (!options.force && cacheEntryIsFresh(cache[key], options.cacheTtlMs || CACHE_TTL_MS)) return cache[key].data;
  if (!getGeminiSettings(storage).apiKey || globalThis.navigator?.onLine === false) return fallback;
  const generate = options.generate || generateGeminiContent;
  try {
    const result = await generate(prompt, { storage, json: true, maxOutputTokens: options.maxOutputTokens || 1400 });
    if (!validate(result)) return fallback;
    const data = { ...result, aiGenerated: true };
    cache[key] = { cachedAt: Date.now(), data };
    writeRecentObjectCache(storage, CACHE_KEY, cache, CACHE_LIMIT);
    return data;
  } catch (error) {
    console.warn(`[AdaptiveLessons] ${type} generation was unavailable; using authored fallback.`, error);
    return fallback;
  }
}

export async function generateListeningActivity(context, { kind = 'dialogue', ...options } = {}) {
  const enriched = { ...context, unitPhrases: options.unitPhrases || context.unitPhrases || [] };
  return cachedGenerate('listening', enriched, kind, fallbackListening(enriched, kind), buildListeningGenerationPrompt(enriched, kind), value => listeningValid(value, kind), options);
}

export async function generateTranslationActivity(context, options = {}) {
  const enriched = { ...context, unitPhrases: options.unitPhrases || context.unitPhrases || [] };
  return cachedGenerate('translation', enriched, '', fallbackTranslation(enriched), buildTranslationGenerationPrompt(enriched), value => value && clean(value.englishPrompt) && clean(value.lithuanianModel), options);
}

export async function generateDialogueActivity(context, options = {}) {
  const enriched = { ...context, unitPhrases: options.unitPhrases || context.unitPhrases || [] };
  return cachedGenerate('dialogue', enriched, '', fallbackDialogue(enriched), buildDialogueOpeningPrompt(enriched), value => value && clean(value.scenario) && clean(value.goal) && clean(value.opening), options);
}

export function locallyEvaluateListening(activity, response) {
  const answer = normalized(response);
  const candidates = unique([activity.modelSummary, ...(activity.acceptedGistAnswers || []), ...(activity.keyDetails || [])]);
  const correct = candidates.some(candidate => {
    const terms = normalized(candidate).split(' ').filter(term => term.length > 3);
    return terms.length && terms.filter(term => answer.includes(term)).length >= Math.min(2, terms.length);
  });
  return { correct, feedback: correct ? 'You identified the main idea.' : `Listen for the central situation: ${activity.modelSummary}` };
}

export async function evaluateListeningResponse(activity, response, context, options = {}) {
  const storage = options.storage === undefined ? globalThis.localStorage : options.storage;
  if (!getGeminiSettings(storage).apiKey || !activity.aiGenerated) return locallyEvaluateListening(activity, response);
  try {
    const generate = options.generate || generateGeminiContent;
    const result = await generate(buildListeningEvaluationPrompt(activity, response, context), { storage, json: true, maxOutputTokens: 240, dedupe: false });
    return { correct: Boolean(result?.correct), feedback: clean(result?.feedback) || 'Answer checked.' };
  } catch {
    return locallyEvaluateListening(activity, response);
  }
}

export async function evaluateTranslationResponse(activity, response, context, options = {}) {
  const storage = options.storage === undefined ? globalThis.localStorage : options.storage;
  const exact = unique([activity.lithuanianModel, ...(activity.acceptedAnswers || [])]).some(answer => normalized(answer) === normalized(response));
  if (exact) return { correct: true, feedback: 'That is a natural equivalent.', correctedAnswer: '' };
  if (!getGeminiSettings(storage).apiKey || !activity.aiGenerated) return { correct: false, feedback: activity.explanation || 'Compare the form with the model.', correctedAnswer: activity.lithuanianModel };
  try {
    const generate = options.generate || generateGeminiContent;
    const result = await generate(buildTranslationEvaluationPrompt(activity, response, context), { storage, json: true, maxOutputTokens: 320, dedupe: false });
    return { correct: Boolean(result?.correct), feedback: clean(result?.feedback), correctedAnswer: clean(result?.correctedAnswer) };
  } catch {
    return { correct: false, feedback: 'Gemini could not check this answer, so compare it with the model.', correctedAnswer: activity.lithuanianModel };
  }
}

export async function processDialogueTurn(activity, history, learnerReply, context, options = {}) {
  const storage = options.storage === undefined ? globalThis.localStorage : options.storage;
  if (!getGeminiSettings(storage).apiKey || !activity.aiGenerated) {
    const response = normalized(learnerReply);
    const meetsTarget = (activity.successCriteria || []).some(criterion => {
      const target = normalized(criterion);
      return target && response === target;
    });
    const enough = meetsTarget;
    return {
      accepted: enough,
      goalComplete: enough,
      feedback: enough ? 'You produced a relevant Lithuanian reply.' : 'Use the model phrase to answer this guided exchange.',
      correctedReply: '',
      partnerReply: enough ? 'Puiku, ačiū!' : 'Gal galite pasakyti daugiau?',
      englishMeaning: enough ? 'Great, thank you!' : 'Could you say more?'
    };
  }
  try {
    const generate = options.generate || generateGeminiContent;
    const result = await generate(buildDialogueTurnPrompt(activity, history, learnerReply, context), { storage, json: true, maxOutputTokens: 420, dedupe: false });
    return {
      accepted: Boolean(result?.accepted),
      goalComplete: Boolean(result?.goalComplete),
      feedback: clean(result?.feedback),
      correctedReply: clean(result?.correctedReply),
      partnerReply: clean(result?.partnerReply) || 'Gerai.',
      englishMeaning: clean(result?.englishMeaning)
    };
  } catch {
    return { accepted: true, goalComplete: history.filter(turn => turn.role === 'learner').length >= context.difficulty.learnerTurns - 1, feedback: 'Your reply was recorded; AI feedback is temporarily unavailable.', correctedReply: '', partnerReply: 'Supratau. Tęskite, prašau.', englishMeaning: 'I understand. Please continue.' };
  }
}
