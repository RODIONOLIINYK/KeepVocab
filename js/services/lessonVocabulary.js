export function vocabularyKey(value) {
  return String(value || '').normalize('NFC').trim().toLocaleLowerCase('lt-LT');
}

export function recordVocabularySelection(attempt, unknownWords, pending = true, now = new Date()) {
  return { ...attempt, unknownWords: [...unknownWords], vocabularyReviewPending: pending,
    updatedAt: new Date(Math.max(now.getTime(), (Date.parse(attempt.updatedAt) || 0) + 1)).toISOString() };
}

// Keep inflected words as encountered. A sentence translation is never a word definition.
export function lessonWordCandidates(session, attempt = {}) {
  const phrases = [
    ...(session.vocabulary || []),
    ...session.exercises.flatMap(exercise => [exercise.phrase, ...(exercise.matchPairs || [])]),
    ...(attempt.responses || []).flatMap(response => response.vocabularyPhrases || [])
  ];
  const words = new Map();
  for (const phrase of phrases) {
    const tokens = String(phrase?.lt || '').normalize('NFC').match(/\p{L}+(?:[-’']\p{L}+)*/gu) || [];
    for (const token of tokens) {
      const word = vocabularyKey(token);
      if (!words.has(word)) words.set(word, { word, example: phrase.lt, definition: '' });
      if (tokens.length === 1 && phrase.en) words.get(word).definition = phrase.en;
    }
  }
  return [...words.values()];
}

export function lessonVocabularyRecords(session, unit, attempt = {}) {
  const selected = new Map((attempt.unknownWords || []).map(item => [vocabularyKey(item.word), item]));
  return lessonWordCandidates(session, attempt).filter(item => selected.has(item.word)).map(item => {
    const choice = selected.get(item.word);
    const definition = String(choice.definition || item.definition || '').trim();
    if (!definition) throw new Error(`Add an English meaning for “${item.word}”, or unselect it.`);
    return {
      id: `lt-course-word-${encodeURIComponent(item.word)}-${encodeURIComponent(vocabularyKey(definition))}`,
      courseId: 'lithuanian', languageCode: 'lt', word: item.word, lemma: item.word,
      definition, translation: definition, example: item.example, lessonId: session.id,
      acceptedForms: [item.word], partOfSpeech: 'word',
      grammaticalTags: [`Module ${unit.unitNumber}`, unit.grammar], source: 'lesson',
      ...(choice.sourceUrl ? { sourceUrl: choice.sourceUrl, attribution: choice.attribution } : {})
    };
  });
}

export function missingLessonWords(records, existing) {
  return records.filter(candidate => !existing.some(word =>
    (word.courseId || 'english') === 'lithuanian'
    && vocabularyKey(word.word) === candidate.word
    && vocabularyKey(word.definition) === vocabularyKey(candidate.definition)
  ));
}
