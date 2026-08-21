export function normalizeExerciseAnswer(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ');
}

export function evaluateRecallAnswer(expected, learnerResponse) {
  return normalizeExerciseAnswer(learnerResponse) === normalizeExerciseAnswer(expected);
}

export function evaluateChoiceAnswer(expectedId, selectedId) {
  return String(selectedId || '') === String(expectedId || '');
}
