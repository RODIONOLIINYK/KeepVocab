import { getLithuanianSession, LITHUANIAN_SESSIONS, LITHUANIAN_UNITS } from '../data/lithuanianCurriculum.js?v=116';

export function normalizeAnswer(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('lt-LT')
    .replace(/[?!.,;:“”„'’]/g, '')
    .replace(/\s+/g, ' ');
}

export function answerMatches(exercise, response) {
  const normalized = normalizeAnswer(response);
  return (exercise.acceptedAnswers || [exercise.answer]).some(answer => normalizeAnswer(answer) === normalized);
}

export function currentSessionId(profile = {}) {
  const completed = new Set(profile.completedNodeIds || []);
  return LITHUANIAN_SESSIONS.find(session => !completed.has(session.id))?.id || LITHUANIAN_SESSIONS.at(-1)?.id || null;
}

export function isSessionUnlocked(sessionId, profile = {}) {
  const index = LITHUANIAN_SESSIONS.findIndex(session => session.id === sessionId);
  if (index <= 0) return index === 0;
  const completed = new Set(profile.completedNodeIds || []);
  return completed.has(sessionId) || completed.has(LITHUANIAN_SESSIONS[index - 1].id);
}

export function startLessonAttempt(sessionId, previous = null, now = new Date()) {
  const session = getLithuanianSession(sessionId);
  if (!session) throw new Error('This lesson is not available.');
  if (previous && previous.status === 'in-progress') return previous;
  return {
    id: `${sessionId}-${now.getTime()}`,
    sessionId,
    exerciseIndex: 0,
    responses: [],
    hintsUsed: 0,
    retries: 0,
    status: 'in-progress',
    startedAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}

export function recordLessonResponse(attempt, exercise, { response = '', correct = false, skipped = false, unscored = false, hintUsed = false } = {}, now = new Date()) {
  const responses = [...(attempt.responses || []), {
    exerciseId: exercise.id,
    response: String(response || ''),
    correct: Boolean(correct),
    skipped: Boolean(skipped),
    unscored: Boolean(unscored),
    hintUsed: Boolean(hintUsed),
    answeredAt: now.toISOString()
  }];
  return {
    ...attempt,
    responses,
    hintsUsed: Number(attempt.hintsUsed || 0) + (hintUsed ? 1 : 0),
    retries: Number(attempt.retries || 0) + (!correct && !skipped && !unscored ? 1 : 0),
    updatedAt: now.toISOString()
  };
}

export function advanceLessonAttempt(attempt, session, now = new Date()) {
  const nextIndex = Math.min(session.exercises.length, Number(attempt.exerciseIndex || 0) + 1);
  return {
    ...attempt,
    exerciseIndex: nextIndex,
    status: nextIndex >= session.exercises.length ? 'completed' : 'in-progress',
    completedAt: nextIndex >= session.exercises.length ? now.toISOString() : undefined,
    updatedAt: now.toISOString()
  };
}

export function buildAdaptiveReviewExercises(session, attempt) {
  const missedIds = new Set((attempt?.responses || []).filter(item => !item.correct && !item.skipped).map(item => item.exerciseId));
  return session.exercises.filter(exercise => missedIds.has(exercise.id)).slice(0, 2).map(exercise => ({
    ...exercise,
    id: `${exercise.id}-review`,
    prompt: `Quick retrieval: ${exercise.phrase.en}`,
    type: 'typed-recall'
  }));
}

export function selfPacedPathStatus(profile = {}) {
  const completed = new Set(profile.completedNodeIds || []);
  const completedUnits = LITHUANIAN_UNITS.filter(unit =>
    unit.sessions.length > 0 && unit.sessions.every(session => completed.has(session.id))
  ).length;
  return {
    completedUnits,
    nextUnit: Math.min(36, completedUnits + 1),
    remainingUnits: Math.max(0, 36 - completedUnits)
  };
}

export function completionEvidence(session, attempt, now = new Date()) {
  const scored = (attempt.responses || []).filter(item => !item.skipped && !item.unscored);
  const correct = scored.filter(item => item.correct).length;
  const total = Math.max(1, scored.length);
  return {
    id: `evidence-${session.id}`,
    nodeId: session.id,
    outcome: session.exercises[0]?.outcomeTag || '',
    level: session.unitNumber >= 36 ? 'B1 bridge' : session.unitNumber >= 17 ? 'A2' : 'A1',
    demonstrated: correct / total >= 0.67,
    correct,
    total,
    completedAt: now.toISOString(),
    note: 'Learning evidence only — not an official certificate.'
  };
}
