import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { answerEncouragement, practiceProgress, renderPracticeHeader, renderAnswerFeedback } from '../js/components/PracticeElements.js';

const source = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('existing progress advances immediately on both correct and missed submissions', () => {
  assert.deepEqual(practiceProgress({ current: 2, total: 8, score: 2 }), { completed: 2, percent: 25, status: '2 correct' });
  assert.deepEqual(practiceProgress({ current: 2, total: 8, score: 2, answered: true }), { completed: 3, percent: 38, status: '2 correct' });
  const html = renderPracticeHeader({ exitId: 'exit', current: 2, total: 8, score: 2, answered: true });
  assert.match(html, /aria-valuenow="3"/);
  assert.match(html, /width:38%/);
  assert.equal((html.match(/<button/g) || []).length, 1, 'existing exit button is the only header action');
});

test('milestones occupy existing status only after completing an exercise', () => {
  assert.equal(practiceProgress({ current: 3, total: 8, answered: false }).status, '0 correct');
  assert.equal(practiceProgress({ current: 3, total: 8, answered: true }).status, 'Halfway through');
  assert.equal(practiceProgress({ current: 4, total: 8, answered: true, score: 3 }).status, '3 correct');
  assert.equal(practiceProgress({ current: 6, total: 8, answered: true }).status, 'One exercise left');
  assert.equal(practiceProgress({ current: 7, total: 8, answered: true, score: 4 }).status, '4 correct');
  assert.equal(practiceProgress({ current: 0, total: 2, answered: true, score: 1 }).status, '1 correct');
  assert.equal(practiceProgress({ total: 0 }).percent, 0);
});

test('encouragement describes the actual task and never claims unaided recall after a hint', () => {
  assert.equal(answerEncouragement({ correct: true }), 'You matched the meaning');
  assert.equal(answerEncouragement({ correct: true, recallType: 'free-recall' }), 'Recalled without a hint');
  assert.equal(answerEncouragement({ correct: true, recallType: 'free-recall', hintsUsed: 1 }), 'Correct — with a hint');
  assert.equal(answerEncouragement({ correct: true, recallType: 'context' }), 'You found the right fit');
  assert.equal(answerEncouragement({ correct: false }), 'Not quite');
});

test('feedback preserves a single immediate Next action and escaped correction', () => {
  const pending = renderAnswerFeedback({ answered: false });
  assert.doesNotMatch(pending, /<button|answer-feedback-card/);
  const answer = renderAnswerFeedback({ answered: true, correct: false, answer: '<test>', nextId: 'next', nextLabel: 'Next question' });
  assert.match(answer, /&lt;test&gt;/);
  assert.equal((answer.match(/<button/g) || []).length, 1);
  assert.match(answer, /id="next">Next question/);
  assert.doesNotMatch(answer, /disabled|success-burst|completion-streak/);
});

test('Use It finishes through its original navigation without an added result step', async () => {
  const useIt = await source('js/components/UseItMode.js');
  assert.match(useIt, /if \(index \+ 1 >= words.length\) \{\s*exerciseController\?\.destroy\(\);\s*teardownUseItMode\(\);\s*go\('dashboard', onNavigate\);\s*return;/);
  assert.doesNotMatch(useIt, /mode-completion-card|useit-home|useit-again|mountPracticeCompletion/);
});

test('removed celebration cannot load through app startup, components, or offline assets', async () => {
  for (const file of ['index.html', 'sw.js', 'js/app.js', ...['DailySessionMode', 'FlashcardsMode', 'PracticeModes', 'ContextQuizMode', 'UseItMode', 'MatchSprintMode', 'VisualMatchMode', 'SpeakingMode'].map(name => `js/components/${name}.js`)]) {
    assert.doesNotMatch(await source(file), /StreakCelebration|completion\.css|mountPracticeCompletion/, file);
  }
});
