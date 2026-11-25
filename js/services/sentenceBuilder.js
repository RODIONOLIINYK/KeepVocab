import { definitionForLearning, exampleForLearning, isModernUsageExample } from './learningDefinitions.js?v=18908';
import { generateGeminiContent } from './geminiSettings.js?v=18908';
import { getTranslationLanguage, getTranslationName } from './translationSettings.js?v=18908';
import { sentenceUsesTargetForm, targetWordForms } from '../utils/wordForms.js?v=18908';
import { shuffleItems } from '../utils/collections.js';

export const SENTENCE_BUILDER_CACHE = 'keepvocab_ai_sentence_builder_cache_v2';

const DETERMINERS = new Set([
  'a', 'an', 'the', 'my', 'your', 'his', 'her', 'its', 'our', 'their',
  'this', 'that', 'these', 'those', 'every', 'each', 'some', 'any', 'no',
  'one', 'two', 'three', 'many', 'most', 'several', 'all', 'both'
]);

const PREPOSITIONS = new Set([
  'to', 'in', 'on', 'at', 'of', 'for', 'by', 'with', 'from', 'into', 'onto',
  'after', 'before', 'during', 'under', 'over', 'through', 'about', 'without',
  'between', 'against', 'across', 'around', 'behind', 'near', 'toward', 'towards',
  'up', 'down', 'off', 'out', 'along', 'beyond', 'within'
]);

const CLAUSE_BOUNDARIES = new Set([
  ...PREPOSITIONS,
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'has', 'have', 'had', 'do', 'does', 'did',
  'will', 'would', 'can', 'could', 'should', 'may', 'might', 'must',
  'and', 'or', 'but', 'so', 'yet', 'because', 'while', 'when', 'where', 'if', 'than', 'as', 'who', 'which', 'whose'
]);

const COMMON_VERBS = new Set([
  'gave', 'give', 'gives', 'made', 'make', 'makes', 'took', 'take', 'takes',
  'kept', 'keep', 'keeps', 'said', 'say', 'says', 'went', 'go', 'goes',
  'came', 'come', 'comes', 'saw', 'see', 'sees', 'got', 'get', 'gets',
  'found', 'find', 'finds', 'left', 'leave', 'leaves', 'felt', 'feel', 'feels',
  'put', 'puts', 'ran', 'run', 'runs', 'read', 'reads', 'wrote', 'write', 'writes',
  'told', 'tell', 'tells', 'held', 'hold', 'holds', 'stood', 'stand', 'stands',
  'lost', 'lose', 'loses', 'paid', 'pay', 'pays', 'met', 'meet', 'meets',
  'spoke', 'speak', 'speaks', 'drove', 'drive', 'drives', 'chose', 'choose', 'chooses',
  'broke', 'break', 'breaks', 'built', 'build', 'builds', 'sent', 'send', 'sends',
  'spent', 'spend', 'spends', 'won', 'win', 'wins', 'grew', 'grow', 'grows',
  'knew', 'know', 'knows', 'began', 'begin', 'begins', 'became', 'become', 'becomes',
  'showed', 'show', 'shows', 'heard', 'hear', 'hears', 'brought', 'bring', 'brings',
  'thought', 'think', 'thinks', 'bought', 'buy', 'buys', 'caught', 'catch', 'catches',
  'taught', 'teach', 'teaches', 'slept', 'sleep', 'sleeps', 'wore', 'wear', 'wears',
  'fell', 'fall', 'falls', 'flew', 'fly', 'flies', 'threw', 'throw', 'throws',
  'checked', 'painted', 'recovered', 'opened', 'closed', 'finished', 'started',
  'moved', 'stayed', 'worked', 'helped', 'called', 'asked', 'needed', 'wanted',
  'looked', 'seemed', 'tried', 'used', 'played', 'walked', 'talked', 'waited', 'watched'
]);

const COMMON_SHORT_ADJECTIVES = new Set([
  'new', 'old', 'big', 'small', 'good', 'bad', 'long', 'short', 'high', 'low',
  'great', 'little', 'own', 'other', 'right', 'left', 'young', 'early', 'late',
  'hard', 'soft', 'dark', 'bright', 'warm', 'cold', 'hot', 'cool', 'quiet', 'loud',
  'calm', 'quick', 'fast', 'slow', 'strong', 'weak', 'heavy', 'light', 'rough',
  'smooth', 'sharp', 'clear', 'deep', 'wide', 'narrow', 'clean', 'fresh', 'dry',
  'wet', 'full', 'empty', 'rich', 'poor', 'safe', 'wild', 'free', 'real', 'true',
  'whole', 'main', 'final', 'local', 'modern', 'simple', 'steady', 'candid',
  'vivid', 'brave', 'wooden', 'angry', 'tiny', 'huge', 'tall', 'happy', 'sad',
  'tired', 'busy', 'ready', 'first', 'last', 'next', 'same', 'public', 'private',
  'large', 'remote', 'close', 'far', 'open', 'broken', 'hidden', 'sudden', 'gentle',
  'strict', 'brief', 'rare', 'common', 'broad', 'dense', 'sparse', 'steep', 'flat',
  'hollow', 'solid', 'subtle', 'bold', 'plain', 'pure', 'raw', 'sweet', 'bitter',
  'sour', 'salty', 'spicy', 'mild', 'damp', 'humid', 'arid', 'vast', 'faint',
  'pale', 'dull', 'crisp', 'stale', 'neat', 'messy', 'tight', 'loose', 'stiff',
  'firm', 'harsh', 'kind', 'cruel', 'wise', 'proud', 'humble', 'eager', 'shy',
  'polite', 'rude', 'honest', 'loyal', 'clever', 'smart', 'shiny', 'dusty',
  'muddy', 'icy', 'noisy', 'silent', 'heavy', 'thick', 'thin', 'steep', 'cheap'
]);

const ADJECTIVE_SUFFIX = /(al|ic|ous|ful|less|ive|able|ible|ent|ant|ary|ory|ish|ern|ile)$/;

const MOVABLE_ADVERBS = new Set([
  'quickly', 'carefully', 'quietly', 'suddenly', 'calmly', 'slowly', 'softly',
  'loudly', 'briefly', 'easily', 'clearly', 'firmly', 'gently', 'safely',
  'yesterday', 'today', 'tomorrow', 'often', 'always', 'never', 'already',
  'soon', 'again', 'later', 'earlier', 'eventually', 'finally', 'recently'
]);

const AUXILIARIES = new Set([
  'is', 'are', 'was', 'were', 'be', 'been', 'has', 'have', 'had',
  'do', 'does', 'did', 'will', 'would', 'can', 'could', 'should', 'may', 'might', 'must', 'not', "n't"
]);

function cleanSentence(raw) {
  return String(raw || '')
    .trim()
    .replace(/^["“”'‘’]+|["“”'‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTileToken(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[“”"'`.,!?;:()[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeSentence(sentence) {
  const cleaned = cleanSentence(sentence);
  if (!cleaned) return [];
  return cleaned
    .split(/\s+/)
    .map(part => part.replace(/^[“”"'(\[]+|[“”"')\].,!?;:]+$/g, ''))
    .filter(Boolean);
}

function isLikelyAdjective(token, word, formSet) {
  const norm = normalizeTileToken(token);
  if (!norm || CLAUSE_BOUNDARIES.has(norm) || COMMON_VERBS.has(norm)) return false;
  if (word?.partOfSpeech === 'adjective' && formSet.has(norm)) return true;
  if (COMMON_SHORT_ADJECTIVES.has(norm)) return true;
  return norm.length >= 5 && ADJECTIVE_SUFFIX.test(norm);
}

function isLikelyVerbBoundary(token) {
  const norm = normalizeTileToken(token);
  if (!norm) return true;
  return CLAUSE_BOUNDARIES.has(norm) || COMMON_VERBS.has(norm);
}

function isLikelyAdverb(token) {
  const norm = normalizeTileToken(token);
  if (!norm || norm.includes(' ')) return false;
  if (MOVABLE_ADVERBS.has(norm)) return true;
  return norm.length >= 5 && norm.endsWith('ly') && !COMMON_SHORT_ADJECTIVES.has(norm);
}

function chunkContainsTarget(chunk, formSet) {
  const normChunk = normalizeTileToken(chunk);
  if (!normChunk || !formSet.size) return false;
  if (formSet.has(normChunk)) return true;
  return normChunk.split(/\s+/).some(token => formSet.has(token));
}

function wordCount(chunk) {
  return String(chunk || '').trim().split(/\s+/).filter(Boolean).length;
}

// Group a sentence into 3–6 clear grammatical phrase chunks so adjectives stay
// paired with their nouns, prepositions stay with their objects, and movable
// adverbs attach to their verb instead of floating as ambiguous single words.
export function chunkSentenceTokens(rawTokens, word = null) {
  const tokens = (Array.isArray(rawTokens) ? rawTokens : []).filter(Boolean);
  if (tokens.length <= 3) return [...tokens];

  const formSet = new Set(targetWordForms(word || {}).map(normalizeTileToken).filter(Boolean));

  // Pass 1: Build noun phrases (det + [adj...] + noun) while avoiding verb crossings.
  const units = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const current = tokens[i];
    const norm = normalizeTileToken(current);
    if (DETERMINERS.has(norm) && i + 1 < tokens.length) {
      const phrase = [current, tokens[i + 1]];
      let nextIdx = i + 2;
      while (
        nextIdx < tokens.length &&
        phrase.length < 4 &&
        isLikelyAdjective(phrase[phrase.length - 1], word, formSet) &&
        !isLikelyVerbBoundary(tokens[nextIdx]) &&
        !DETERMINERS.has(normalizeTileToken(tokens[nextIdx]))
      ) {
        phrase.push(tokens[nextIdx]);
        nextIdx += 1;
      }
      units.push(phrase.join(' '));
      i = nextIdx - 1;
      continue;
    }
    units.push(current);
  }

  // Pass 2: Attach prepositions to their following noun/object phrase.
  const withPreps = [];
  for (let i = 0; i < units.length; i += 1) {
    const current = units[i];
    const norm = normalizeTileToken(current);
    if (PREPOSITIONS.has(norm) && i + 1 < units.length && wordCount(units[i + 1]) <= 3) {
      withPreps.push(`${current} ${units[i + 1]}`);
      i += 1;
      continue;
    }
    withPreps.push(current);
  }

  // Pass 3: Attach standalone -ly adverbs to an adjacent verb/auxiliary when helpful.
  const chunks = [];
  for (let i = 0; i < withPreps.length; i += 1) {
    const current = withPreps[i];
    if (
      chunks.length > 0 &&
      isLikelyAdverb(current) &&
      wordCount(chunks[chunks.length - 1]) === 1 &&
      !DETERMINERS.has(normalizeTileToken(chunks[chunks.length - 1])) &&
      !PREPOSITIONS.has(normalizeTileToken(chunks[chunks.length - 1]))
    ) {
      chunks[chunks.length - 1] = `${chunks[chunks.length - 1]} ${current}`;
      continue;
    }
    chunks.push(current);
  }

  // Pass 4: Compact until at most 6 chunks (1 locked opening + up to 5 tiles).
  let guard = 0;
  while (chunks.length > 6 && guard < 20) {
    guard += 1;
    let mergeIndex = -1;
    let bestScore = Infinity;
    for (let i = 0; i < chunks.length - 1; i += 1) {
      const combinedWords = wordCount(chunks[i]) + wordCount(chunks[i + 1]);
      if (combinedWords > 4) continue;
      // Avoid merging chunk 0 with chunk 1 if that would pull the target word into chunk 0.
      if (i === 0 && !chunkContainsTarget(chunks[0], formSet) && chunkContainsTarget(chunks[1], formSet)) continue;
      const leftNorm = normalizeTileToken(chunks[i]);
      const auxBonus = AUXILIARIES.has(leftNorm) ? -3 : 0;
      const score = combinedWords * 2 + auxBonus + (chunks[i].length + chunks[i + 1].length) / 20;
      if (score < bestScore) {
        bestScore = score;
        mergeIndex = i;
      }
    }
    if (mergeIndex === -1) break;
    chunks.splice(mergeIndex, 2, `${chunks[mergeIndex]} ${chunks[mergeIndex + 1]}`);
  }

  // Pass 5: If aggressive grouping collapsed a short sentence to fewer than 3 chunks,
  // split the longest non-adjective-noun chunk so there are at least 3 meaningful tiles.
  guard = 0;
  while (chunks.length < 3 && guard < 10) {
    guard += 1;
    let splitIdx = -1;
    let maxWords = 1;
    for (let i = 0; i < chunks.length; i += 1) {
      const count = wordCount(chunks[i]);
      if (count > maxWords) {
        maxWords = count;
        splitIdx = i;
      }
    }
    if (splitIdx === -1) break;
    const parts = chunks[splitIdx].split(/\s+/);
    const pivot = PREPOSITIONS.has(normalizeTileToken(parts[0])) && parts.length >= 3
      ? 1
      : Math.floor(parts.length / 2);
    chunks.splice(splitIdx, 1, parts.slice(0, pivot).join(' '), parts.slice(pivot).join(' '));
  }

  return chunks;
}

function sanitizeChunks(rawChunks, sentence, word) {
  if (!Array.isArray(rawChunks) || rawChunks.length < 3 || rawChunks.length > 6) return null;
  const cleaned = rawChunks
    .map(chunk => cleanSentence(chunk).replace(/^[“”"'(\[]+|[“”"')\].,!?;:]+$/g, '').trim())
    .filter(Boolean);
  if (cleaned.length < 3 || cleaned.length > 6) return null;
  const expected = tokenizeSentence(sentence).map(normalizeTileToken).join(' ');
  const actual = cleaned.flatMap(chunk => tokenizeSentence(chunk)).map(normalizeTileToken).join(' ');
  if (!expected || actual !== expected) return null;
  // Ensure every chunk is concise (at most 5 words) and no single chunk swallows the whole sentence.
  if (cleaned.some(chunk => wordCount(chunk) > 5)) return null;
  const formSet = new Set(targetWordForms(word || {}).map(normalizeTileToken).filter(Boolean));
  if (formSet.size && !cleaned.some(chunk => chunkContainsTarget(chunk, formSet))) return null;
  return cleaned;
}

function sameWordBag(a, b) {
  const wordsA = tokenizeSentence(a).map(normalizeTileToken).filter(Boolean).sort();
  const wordsB = tokenizeSentence(b).map(normalizeTileToken).filter(Boolean).sort();
  return wordsA.length === wordsB.length && wordsA.every((word, idx) => word === wordsB[idx]);
}

function sanitizeAcceptedSentences(rawAccepted, sentence) {
  const canonical = normalizeTileToken(sentence);
  const valid = new Set(canonical ? [canonical] : []);
  for (const item of Array.isArray(rawAccepted) ? rawAccepted : []) {
    const cleaned = cleanSentence(item);
    const norm = normalizeTileToken(cleaned);
    if (!norm || !sameWordBag(cleaned, sentence)) continue;
    valid.add(norm);
  }
  return [...valid];
}

// Generate safe alternate valid orders when a standalone movable adverb tile
// could naturally sit in more than one slot (e.g., before the verb or at the end).
function deriveAcceptedSentences(opening, targetTokens, explicitAccepted = [], sentence = '') {
  const canonicalTokens = [opening, ...targetTokens].filter(Boolean);
  const canonical = normalizeTileToken(canonicalTokens.join(' '));
  const accepted = new Set([
    canonical,
    ...sanitizeAcceptedSentences(explicitAccepted, sentence || canonicalTokens.join(' '))
  ].filter(Boolean));

  const advIndices = targetTokens
    .map((chunk, idx) => (isLikelyAdverb(chunk) ? idx : -1))
    .filter(idx => idx >= 0);

  for (const advIdx of advIndices) {
    const withoutAdv = targetTokens.filter((_, idx) => idx !== advIdx);
    const adv = targetTokens[advIdx];
    // Allow placing the standalone adverb right at the start of movable tokens (after opening) or at the end.
    for (const insertAt of [0, withoutAdv.length]) {
      const candidate = [...withoutAdv.slice(0, insertAt), adv, ...withoutAdv.slice(insertAt)];
      const full = normalizeTileToken([opening, ...candidate].filter(Boolean).join(' '));
      if (full) accepted.add(full);
    }
  }

  return [...accepted];
}

export function canBuildSentenceExercise(word, sentenceOverride = null) {
  if (!word?.word) return false;
  const sentence = cleanSentence(sentenceOverride ?? exampleForLearning(word));
  if (!sentence) return false;
  const tokens = tokenizeSentence(sentence);
  if (tokens.length < 4 || tokens.length > 22) return false;
  return sentenceUsesTargetForm(sentence, word);
}

export function buildSentencePuzzle(word, allWords = [], {
  chunks: preferredChunks = null,
  acceptedSentences: preferredAccepted = null,
  sentence: sentenceOverride = null,
  source = 'saved-example'
} = {}) {
  const sentence = cleanSentence(sentenceOverride ?? exampleForLearning(word));
  const rawTokens = tokenizeSentence(sentence);
  if (rawTokens.length < 4) return null;

  const formSet = new Set(targetWordForms(word).map(normalizeTileToken).filter(Boolean));
  const chunks = sanitizeChunks(preferredChunks, sentence, word) || chunkSentenceTokens(rawTokens, word);
  if (chunks.length < 3) return null;

  // Lock chunk 0 as an unambiguous opening anchor whenever doing so leaves
  // 3–5 movable phrase tiles and does not hide the target vocabulary word inside the anchor.
  const canLockOpening = chunks.length >= 4 && !chunkContainsTarget(chunks[0], formSet);
  const opening = canLockOpening ? chunks[0] : '';
  const targetTokens = canLockOpening ? chunks.slice(1) : chunks;
  const acceptedSentences = deriveAcceptedSentences(opening, targetTokens, preferredAccepted, sentence);

  const unshuffled = targetTokens.map((text, index) => ({
    id: `t-${index}`,
    text,
    isDistractor: false
  }));

  let tiles = shuffleItems(unshuffled);
  const sameOrder = tiles.every((tile, index) => tile.text === targetTokens[index]);
  if (sameOrder && tiles.length > 1) {
    tiles = [...tiles.slice(1), tiles[0]];
  }

  return {
    sentence,
    opening,
    targetTokens,
    tiles,
    acceptedSentences,
    distractorCount: 0,
    targetWord: String(word.word || '').trim(),
    definition: definitionForLearning(word),
    source: sentenceOverride ? source : 'saved-example'
  };
}

export function evaluateSentenceAssembly(targetTokens = [], chosenTokens = [], options = {}) {
  const opening = String(options?.opening || '').trim();
  const expectedFullTokens = [opening, ...targetTokens].filter(Boolean);
  const chosenFullTokens = [opening, ...chosenTokens].filter(Boolean);
  const expected = expectedFullTokens.map(normalizeTileToken).filter(Boolean).join(' ');
  const actual = chosenFullTokens.map(normalizeTileToken).filter(Boolean).join(' ');
  const accepted = new Set([
    expected,
    ...(Array.isArray(options?.acceptedSentences) ? options.acceptedSentences : []).map(normalizeTileToken).filter(Boolean)
  ]);
  return {
    correct: Boolean(expected) && accepted.has(actual),
    assembledSentence: chosenFullTokens.join(' ').trim(),
    expectedSentence: expectedFullTokens.join(' ').trim()
  };
}

function cacheKey(words, storage) {
  return JSON.stringify([
    'chunks-v2',
    getTranslationLanguage(storage),
    (words || []).map(word => [word.id, word.word, word.translation, word.definition, word.updatedAt])
  ]);
}

function readCache(storage) {
  try {
    const cache = JSON.parse(storage?.getItem(SENTENCE_BUILDER_CACHE) || '{}');
    return cache && typeof cache === 'object' && !Array.isArray(cache) ? cache : {};
  } catch { return {}; }
}

function sanitizeGeneratedSentenceSet(result, words) {
  const byId = new Map((words || []).map(word => [String(word.id), word]));
  const items = (Array.isArray(result?.items) ? result.items : []).map(item => {
    const word = byId.get(String(item?.wordId || ''));
    const sentence = cleanSentence(item?.sentence);
    if (!word || !sentence) return null;
    const tokens = tokenizeSentence(sentence);
    if (tokens.length < 4 || tokens.length > 14) return null;
    if (!sentenceUsesTargetForm(sentence, word) || !isModernUsageExample(word, sentence)) return null;
    const chunks = sanitizeChunks(item?.chunks, sentence, word);
    const acceptedSentences = sanitizeAcceptedSentences(item?.acceptedSentences, sentence);
    return {
      wordId: String(word.id),
      sentence,
      ...(chunks ? { chunks } : {}),
      acceptedSentences,
      source: item.source === 'saved-example' ? 'saved-example' : 'ai'
    };
  }).filter(Boolean);
  const uniqueItems = [...new Map(items.map(item => [item.wordId, item])).values()];
  return {
    kind: uniqueItems.some(item => item.source === 'saved-example')
      ? (uniqueItems.every(item => item.source === 'saved-example') ? 'local' : 'mixed') : 'ai',
    items: uniqueItems,
    skippedWordIds: [...byId.keys()].filter(id => !uniqueItems.some(item => item.wordId === id))
  };
}

export function buildLocalSentenceSet(words) {
  const items = (words || []).map(word => {
    const sentence = cleanSentence(exampleForLearning(word));
    return canBuildSentenceExercise(word, sentence)
      ? { wordId: String(word.id), sentence, chunks: null, acceptedSentences: [], source: 'saved-example' }
      : null;
  }).filter(Boolean);
  if (!items.length) {
    throw new Error('Add saved examples or connect Google AI Studio to unlock Build Sentence.');
  }
  return {
    kind: 'local',
    items,
    skippedWordIds: (words || []).map(word => String(word.id)).filter(id => !items.some(item => item.wordId === id))
  };
}

export function buildSentenceGenerationPrompt(words, { storage = globalThis.localStorage } = {}) {
  const ukrainian = getTranslationLanguage(storage) === 'uk';
  const targets = (words || []).map(word => ({
    wordId: String(word.id),
    word: cleanSentence(word.word),
    partOfSpeech: cleanSentence(word.partOfSpeech || ''),
    selectedMeaning: cleanSentence(ukrainian && word.translationLanguage === 'uk' ? word.translation || word.definition : word.definition)
  }));
  return `Create short, unambiguous English phrase-chunk puzzles for a vocabulary sentence builder. Preferred meaning-hint language: ${getTranslationName(storage)}.

Return JSON only with this shape:
{"items":[{"wordId":"exact supplied id","sentence":"natural 5-9 word single-clause sentence","chunks":["Opening phrase","chunk 2","chunk 3","chunk 4"],"acceptedSentences":["optional alternate natural order"]}]}

Rules:
- Base every sentence strictly on the exact selected meaning supplied below.
- Write every sentence in clear, modern, everyday English: short and single-clause (5 to 9 words).
- Write one item for every target and preserve every wordId exactly.
- Each sentence must use its target word (or a natural grammatical inflection of it) clearly once.
- Start with a clear 1–2 word opening subject or starter BEFORE the target word so chunk 0 never contains the target word.
- Avoid competing adjectives or interchangeable nouns (at most one descriptive adjective besides the target word).
- Split each sentence into 4 to 6 natural phrase "chunks" whose words join to match "sentence" exactly:
  - Keep determiners and adjectives attached to their noun (e.g., "a candid answer", "the heavy door").
  - Keep prepositions attached to their object (e.g., "during the interview", "after the rain").
  - Keep adverbs attached to their verb (e.g., "recovered quickly").
- Do not include distractors or extra unused words.
- If the exact same chunks can also form another completely natural grammatical English sentence, include that full sentence in "acceptedSentences" (otherwise use []).
- Do not copy dictionary definitions or cram multiple targets into one sentence.

Targets: ${JSON.stringify(targets)}`;
}

export async function generateSentenceBuilderSet(words, options = {}) {
  const selected = (words || []).filter(word => word?.id && word?.word && word?.definition);
  if (!selected.length) throw new Error('Add vocabulary words to practise Build Sentence.');
  const storage = options.storage || globalThis.localStorage;
  const key = cacheKey(selected, storage);
  const cached = readCache(storage)[key];
  if (!options.force && cached) {
    try {
      const clean = sanitizeGeneratedSentenceSet(cached, selected);
      if (clean.items.length) return clean;
    } catch { /* replace invalid cache */ }
  }
  const generate = options.generate || generateGeminiContent;
  const result = await generate(buildSentenceGenerationPrompt(selected, { storage }), {
    json: true,
    maxOutputTokens: Math.max(800, selected.length * 190),
    storage
  });
  const firstPass = sanitizeGeneratedSentenceSet(result, selected);
  let items = firstPass.items;
  const missing = selected.filter(word => !items.some(item => item.wordId === String(word.id)));
  if (missing.length) {
    try {
      const retry = await generate(
        `${buildSentenceGenerationPrompt(missing, { storage })}\nThis is a repair request. Return only the ${missing.length} missing item${missing.length === 1 ? '' : 's'}, with every supplied wordId exactly.`,
        { json: true, maxOutputTokens: Math.max(550, missing.length * 190), storage }
      );
      const repaired = sanitizeGeneratedSentenceSet(retry, missing);
      items = [...items, ...repaired.items.filter(item => !items.some(existing => existing.wordId === item.wordId))];
    } catch { /* keep valid first-pass items and fall back locally below */ }
  }
  const aiItemCount = items.length;
  const localItems = selected
    .filter(word => !items.some(existing => existing.wordId === String(word.id)))
    .map(word => {
      const sentence = cleanSentence(exampleForLearning(word));
      return canBuildSentenceExercise(word, sentence)
        ? { wordId: String(word.id), sentence, chunks: null, acceptedSentences: [], source: 'saved-example' }
        : null;
    })
    .filter(Boolean);
  items = [...items, ...localItems];
  if (!items.length) {
    throw new Error('Gemini and saved examples could not create sentence puzzles for these words. Try again or check your Gemini key.');
  }
  const clean = {
    kind: localItems.length ? (aiItemCount ? 'mixed' : 'local') : 'ai',
    items,
    skippedWordIds: selected.map(word => String(word.id)).filter(id => !items.some(item => item.wordId === id))
  };
  if (storage) {
    const cache = readCache(storage);
    cache[key] = clean;
    const recent = Object.fromEntries(Object.entries(cache).slice(-12));
    try { storage.setItem(SENTENCE_BUILDER_CACHE, JSON.stringify(recent)); } catch { /* cache is disposable */ }
  }
  return clean;
}
