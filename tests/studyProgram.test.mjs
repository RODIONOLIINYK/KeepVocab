import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, DriveSyncService, mergeDriveSettings } from '../js/services/driveSync.js';
import { streakFromActivity, activityByDevice, currentStudyStats } from '../js/services/studyActivity.js';
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
test('repeating reminder copy never freezes numbers or yesterday’s remaining goal', () => {
  for (const dueCount of [0, 1, 54]) {
    const plan = buildSmartReminderPlan({ dueCount, reviewsToday: 2, streak: 15, courseName: 'Vocabulary', now: today });
    assert.doesNotMatch(plan.title + plan.body, /\d/);
    assert.match(plan.title, /Vocabulary/);
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
    assert.equal(calls[0][1].notifications.length, 8);
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
test('reminders default to enabled and survive desktop Drive syncs unless explicitly disabled', () => {
  const service = new DriveSyncService(new MemoryStorage());
  assert.equal(service.getSettings().reminderEnabled, true);
  assert.equal(service.getSettings().reminderExplicitlyDisabled, false);

  const androidSettings = {
    updatedAt: '2026-09-04T10:00:00.000Z',
    courseProfiles: {
      english: {
        updatedAt: '2026-09-04T10:00:00.000Z',
        dailyGoal: 20,
        reminderEnabled: true,
        reviewStartMoments: ['2026-09-01T18:30:00.000Z']
      }
    }
  };
  const desktopSettings = {
    updatedAt: '2026-09-05T12:00:00.000Z',
    courseProfiles: {
      english: {
        updatedAt: '2026-09-05T12:00:00.000Z',
        dailyGoal: 25,
        reminderEnabled: false,
        reviewStartMoments: ['2026-09-02T19:00:00.000Z']
      }
    }
  };
  const merged = mergeDriveSettings(androidSettings, desktopSettings);
  assert.equal(merged.reminderEnabled, true);
  assert.equal(merged.dailyGoal, 25);
  assert.equal(merged.reviewStartMoments.length, 2);

  const explicitlyOff = service.updateSettings({ reminderEnabled: false });
  assert.equal(explicitlyOff.reminderEnabled, false);
  assert.equal(explicitlyOff.reminderExplicitlyDisabled, true);
});

test('daily goal and today’s exercise count sync between devices', () => {
  const phoneStorage = new MemoryStorage();
  const laptopStorage = new MemoryStorage();
  phoneStorage.setItem('keepvocab_device_id', 'phone');
  laptopStorage.setItem('keepvocab_device_id', 'laptop');
  const phone = new DriveSyncService(phoneStorage);
  const laptop = new DriveSyncService(laptopStorage);
  phone.isFreshInstall = false;
  laptop.isFreshInstall = false;
  const day = new Date();

  // The phone changes the goal first; the laptop then practises, which makes
  // its profile newer overall but must not revert the phone's goal.
  phone.updateSettings({ dailyGoal: 35 });
  phone.recordReview(day); phone.recordReview(day); phone.recordReview(day);
  const phoneSnapshot = phone.getSettings();
  for (let index = 0; index < 4; index += 1) laptop.recordReview(day);
  const laptopSnapshot = { ...laptop.getSettings(), updatedAt: new Date(Date.now() + 60_000).toISOString() };
  laptopSnapshot.courseProfiles.english.updatedAt = laptopSnapshot.updatedAt;

  const onLaptop = mergeDriveSettings(laptopSnapshot, phoneSnapshot);
  const onPhone = mergeDriveSettings(phoneSnapshot, laptopSnapshot);
  for (const merged of [onLaptop, onPhone]) {
    assert.equal(merged.dailyGoal, 35);
    assert.equal(merged.reviewsToday, 7);
  }
});

test('the most recent goal edit wins regardless of which device practised last', () => {
  const older = { courseProfiles: { english: { updatedAt: '2026-09-05T12:00:00.000Z', dailyGoal: 15, practiceSessionSize: 10,
    practicePreferenceUpdatedAt: { dailyGoal: '2026-09-01T08:00:00.000Z', practiceSessionSize: '2026-09-03T08:00:00.000Z' } } } };
  const newer = { courseProfiles: { english: { updatedAt: '2026-09-02T12:00:00.000Z', dailyGoal: 40, practiceSessionSize: 30,
    practicePreferenceUpdatedAt: { dailyGoal: '2026-09-02T08:00:00.000Z', practiceSessionSize: '2026-09-02T08:00:00.000Z' } } } };
  const merged = mergeDriveSettings(older, newer);
  assert.equal(merged.dailyGoal, 40);
  assert.equal(merged.practiceSessionSize, 10);
  assert.deepEqual(mergeDriveSettings(newer, older).dailyGoal, 40);
});

test('saving an unchanged goal does not claim a newer edit', () => {
  const service = new DriveSyncService(new MemoryStorage());
  service.updateSettings({ dailyGoal: 20 });
  assert.equal(service.getSettings().practicePreferenceUpdatedAt?.dailyGoal, undefined);
  service.updateSettings({ dailyGoal: 22 });
  assert.ok(service.getSettings().practicePreferenceUpdatedAt.dailyGoal);
});
