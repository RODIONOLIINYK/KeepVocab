import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, DriveSyncService, mergeDriveSettings } from '../js/services/driveSync.js';
import { streakFromActivity, activityByDevice, currentStudyStats } from '../js/services/studyActivity.js';
import { completionEvidence, answerMatches, startLessonAttempt } from '../js/services/lessonEngine.js';
import { LITHUANIAN_UNITS, LITHUANIAN_SESSIONS } from '../js/data/lithuanianCurriculum.js';
import { lessonVocabularyRecords } from '../js/components/LessonMode.js';
import { buildSmartReminderPlan, buildStreakMaintenancePlan, scheduleDailyReminder, cancelDailyReminder } from '../js/services/reminderService.js';
import { compareVersions, selectRelease, startAutomaticUpdateChecks } from '../js/services/appUpdates.js';

const today = new Date(2026, 8, 5, 12);
test('streak is alive yesterday, increments once today and expires after a missed day', () => {
  const activity = { '2026-09-03': 3, '2026-09-04': 8 };
  assert.equal(streakFromActivity(activity, today), 2);
  assert.equal(streakFromActivity({ ...activity, '2026-09-05': 5 }, today), 3);
  assert.equal(streakFromActivity(activity, new Date(2026, 8, 6)), 0);
  assert.equal(streakFromActivity({ '2026-09-10': 8 }, today), 0);
});
test('local calendar streak spans year boundaries and DST without a 90-day cap', () => {
  const activity = {}; const end = new Date(2026, 8, 5, 12);
  for (let i = 0; i < 400; i++) {
    const day = new Date(end); day.setDate(day.getDate() - i);
    const key = `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`;
    activity[key] = 1;
  }
  assert.equal(streakFromActivity(activity, end), 400);
  assert.equal(currentStudyStats({ reviewActivity: activity }, new Date(2026, 8, 6)).reviewsToday, 0);
});
test('study recording updates streak and daily totals together without double-counting days', () => {
  const service = new DriveSyncService(new MemoryStorage());
  service.recordReview(new Date(2026, 8, 4, 12));
  service.recordReview(today); service.recordReview(today);
  const stats = service.read('keepvocab_settings');
  assert.equal(stats.dailyStreak, 2); assert.equal(stats.reviewsToday, 2);
});
test('different active courses on different devices do not contaminate each other during sync', () => {
  const a = new DriveSyncService(new MemoryStorage());
  const b = new DriveSyncService(new MemoryStorage());
  a.recordReview(today); b.setActiveCourseId('lithuanian'); b.recordReview(today); b.recordReview(today);
  const merged = mergeDriveSettings(a.getSettings(), b.getSettings());
  assert.equal(merged.courseProfiles.english.reviewActivity['2026-09-05'], 1);
  assert.equal(merged.courseProfiles.lithuanian.reviewActivity['2026-09-05'], 2);
  assert.deepEqual(mergeDriveSettings(merged, b.getSettings()).courseProfiles.lithuanian.reviewActivity, merged.courseProfiles.lithuanian.reviewActivity);
});
test('legacy lesson activity is recovered once, excluding guides, skips and already counted answers', () => {
  const profile = { lessonAttempts: { first: { responses: [
    { exerciseId: 'guide', response: '[guidebook viewed]', answeredAt: today.toISOString() },
    { exerciseId: 'answer', response: 'labas', answeredAt: today.toISOString() },
    { exerciseId: 'skip', skipped: true, answeredAt: today.toISOString() },
    { exerciseId: 'new', activityRecorded: true, answeredAt: today.toISOString() }
  ] } } };
  assert.equal(activityByDevice(profile)['lesson-history']['2026-09-05'], 1);
  assert.deepEqual(activityByDevice({ ...profile, exerciseActivityByDevice: activityByDevice(profile) }), activityByDevice(profile));
});
test('sync keeps newer course preferences and global settings, and restores the backed-up active course', () => {
  const local = { activeCourseId: 'english', updatedAt: '2026-09-01T12:00:00Z', soundEnabled: false,
    courseProfiles: { lithuanian: { updatedAt: '2026-09-01T12:00:00Z', dailyGoal: 10 } } };
  const remote = { activeCourseId: 'lithuanian', updatedAt: '2026-09-05T12:00:00Z', soundEnabled: true,
    courseProfiles: { lithuanian: { updatedAt: '2026-09-05T12:00:00Z', dailyGoal: 15 } } };
  const merged = mergeDriveSettings(local, remote);
  assert.equal(merged.courseProfiles.lithuanian.dailyGoal, 15);
  assert.equal(merged.soundEnabled, true);
  assert.equal(merged.activeCourseId, 'english');
  assert.equal(mergeDriveSettings(local, remote, { freshInstall: true }).activeCourseId, 'lithuanian');
});
test('exactly two thirds correct passes a checkpoint, but a skipped answer never counts', () => {
  const session = { id: 'boundary', exercises: [1, 2, 3].map(id => ({ id, type: 'typed-recall' })) };
  const responses = [{ exerciseId: 1, correct: true }, { exerciseId: 2, correct: true }];
  assert.equal(completionEvidence(session, { responses }).demonstrated, true);
  assert.equal(completionEvidence(session, { responses: responses.slice(0, 1) }).demonstrated, false);
});
test('curriculum puts basic people, questions and tenses before tasks requiring them', () => {
  const at = id => LITHUANIAN_UNITS.findIndex(unit => unit.id === id);
  assert.ok(at('dec-13') < at('oct-06'));
  assert.ok(at('oct-08') < at('oct-07'));
  assert.ok(at('feb-22') < at('jan-18'));
  assert.match(LITHUANIAN_UNITS[at('feb-22')].guide.summary, /future/i);
  assert.match(LITHUANIAN_UNITS[at('feb-23')].guide.summary, /symptom/i);
});
test('checkpoints test previously learned language and cannot pass with missing or skipped responses', () => {
  const unit = LITHUANIAN_UNITS[3]; const session = unit.sessions[5];
  assert.ok(session.exercises.some(ex => unit.reviewPhrases.some(phrase => phrase.lt === ex.phrase.lt)));
  assert.equal(completionEvidence(session, { responses: [] }).demonstrated, false);
  const responses = session.exercises.slice(1).map(ex => ({ exerciseId: ex.id, correct: true }));
  assert.equal(completionEvidence(session, { responses }).demonstrated, true);
  assert.equal(completionEvidence(session, { responses: responses.slice(0, 1) }).demonstrated, false);
});
test('all authored word-order tasks accept their own tokens including dash punctuation', () => {
  for (const exercise of LITHUANIAN_SESSIONS.flatMap(s => s.exercises).filter(e => e.type === 'word-order')) {
    const text = [...exercise.answer.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)].map(item => item[0]).join(' ');
    assert.equal(answerMatches(exercise, text), true, exercise.id);
  }
});
test('lesson completion adds no vocabulary without an explicit unknown-word selection', () => {
  for (const unit of LITHUANIAN_UNITS) {
    for (const session of unit.sessions) assert.deepEqual(lessonVocabularyRecords(session, unit), []);
  }
});
test('old incompatible attempts restart but current attempts resume', () => {
  const session = LITHUANIAN_SESSIONS[0]; const attempt = startLessonAttempt(session.id);
  assert.equal(startLessonAttempt(session.id, attempt).id, attempt.id);
  assert.equal(startLessonAttempt(session.id, { ...attempt, curriculumVersion: 1, exerciseIndex: 4 }).exerciseIndex, 1);
});
test('introductory lessons open on a question instead of a vocabulary memorisation page', () => {
  for (const unit of LITHUANIAN_UNITS) {
    for (const session of unit.sessions.slice(0, 2)) {
      const attempt = startLessonAttempt(session.id);
      assert.notEqual(session.exercises[attempt.exerciseIndex].type, 'pattern');
    }
  }
});
test('repeating reminder copy never freezes numbers or yesterday’s remaining goal', () => {
  for (const dueCount of [0, 1, 54]) {
    const plan = buildSmartReminderPlan({ dueCount, reviewsToday: 2, streak: 15, hasLesson: true, courseName: 'Lithuanian', now: today });
    assert.doesNotMatch(plan.title + plan.body, /\d/);
    assert.match(plan.title, /Lithuanian/);
  }
  assert.equal(buildStreakMaintenancePlan({ streak: 5, now: new Date(2026, 8, 5, 23, 30) }), null);
});
test('native reminders preserve a specified fire date and remove a stale streak alarm', async () => {
  const calls = [];
  globalThis.Capacitor = { getPlatform: () => 'android', Plugins: { LocalNotifications: {
    checkPermissions: async () => ({ display: 'granted' }), cancel: async value => calls.push(['cancel',value]), schedule: async value => calls.push(['schedule',value])
  } } };
  try {
    const nextAt = new Date(2026, 8, 6, 19);
    await scheduleDailyReminder({ repeat: false, nextAt });
    assert.equal(calls[1][1].notifications[0].schedule.at, nextAt);
    assert.equal(calls[0][1].notifications.length, 2);
    await cancelDailyReminder(); assert.equal(calls.at(-1)[0], 'cancel');
  } finally { delete globalThis.Capacitor; }
});
test('updater accepts only newer stable matching-platform verified repository assets', () => {
  const asset = { name: 'KeepVocab-1.7.0-Android-release.apk', browser_download_url: 'https://github.com/RODIONOLIINYK/KeepVocab/releases/download/v1.7.0/KeepVocab-1.7.0-Android-release.apk', size: 100, digest: 'sha256:'+'a'.repeat(64) };
  const release = { tag_name: 'v1.7.0', assets: [asset] };
  assert.equal(selectRelease(release, 'android', '1.6.1').version, '1.7.0');
  assert.equal(selectRelease(release, 'darwin', '1.6.1'), null);
  assert.equal(selectRelease({ ...release, prerelease: true }, 'android', '1.6.1'), null);
  assert.equal(selectRelease({ ...release, assets: [{ ...asset, digest: null }] }, 'android', '1.6.1'), null);
  assert.equal(selectRelease({ ...release, assets: [{ ...asset, browser_download_url: 'https://evil.example/update.apk' }] }, 'android', '1.6.1'), null);
  assert.equal(selectRelease(release, 'android', '1.8.0'), null);
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
  assert.equal(compareVersions('v1.7.0-beta', '1.6.0'), 0);
});
test('automatic updates check silently without inserting an overlay, even when an update is ready', async () => {
  const timers = [];
  let checked = 0;
  globalThis.keepVocabDesktop = { checkForUpdates: async () => { checked++; return { status: 'available', update: { version: '9.0.0' } }; } };
  const target = {
    document: { hidden: false, addEventListener() {}, createElement() { assert.fail('Background update checks must not create UI'); } },
    navigator: { onLine: true }, setTimeout: fn => timers.push(fn), setInterval() {}
  };
  try {
    startAutomaticUpdateChecks(target);
    timers[0]();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(checked, 1);
  } finally { delete globalThis.keepVocabDesktop; }
});
