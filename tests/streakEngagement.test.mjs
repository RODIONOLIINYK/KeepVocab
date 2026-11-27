import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MAX_STREAK_FREEZES,
  autoApplyStreakFreezes,
  bankedStreakFreezes,
  buildStreakWindow,
  getStreakSummary,
  longestStreakFromActivity,
  nextStreakMilestone,
  shouldAwardStreakFreeze,
  streakFromActivity
} from '../js/services/studyActivity.js';
import { DriveSyncService, MemoryStorage, mergeDriveSettings } from '../js/services/driveSync.js';
import { renderDashboardView, streakMilestoneCopy, updateDashboardStreakUI } from '../js/components/DashboardView.js';
import { renderStatsView } from '../js/components/StatsView.js';
import { renderStreakCelebrationMarkup } from '../js/components/StreakCelebration.js';
import { comboCelebrationConfig, isComboMilestone, renderComboCelebrationMarkup } from '../js/components/ComboCelebration.js';
import { getInteractionSoundProfile } from '../js/services/interactionSound.js';
import { localDateKey } from '../js/utils/dates.js';

test('streak freezes bridge a missed day without inflating active streak count and require meeting daily goal', () => {
  const activity = { '2026-11-18': 4, '2026-11-19': 6, '2026-11-20': 5 };
  const nov22 = new Date(2026, 10, 22, 12);

  assert.equal(streakFromActivity(activity, nov22), 0);
  assert.equal(streakFromActivity(activity, nov22, ['2026-11-21']), 3);
  assert.equal(streakFromActivity({ ...activity, '2026-11-22': 2 }, nov22, ['2026-11-21']), 4);
  assert.equal(streakFromActivity({ ...activity, '2026-11-22': 2 }, nov22, ['2026-11-21'], 4), 3, 'partial day below daily goal does not extend the streak');
  assert.equal(streakFromActivity({ ...activity, '2026-11-22': 4 }, nov22, ['2026-11-21'], 4), 4);
  assert.equal(streakFromActivity({}, nov22, ['2026-11-21']), 0, 'floating freeze with no prior study never creates a streak');
});

test('streak freezes earn at day 3 and every 7-day milestone up to the bank cap', () => {
  assert.equal(shouldAwardStreakFreeze(2, '2026-11-20', [], []), false);
  assert.equal(shouldAwardStreakFreeze(3, '2026-11-20', [], []), true);
  assert.equal(shouldAwardStreakFreeze(3, '2026-11-20', ['2026-11-20'], []), false);
  assert.equal(shouldAwardStreakFreeze(7, '2026-11-24', ['2026-11-20'], []), true);
  assert.equal(shouldAwardStreakFreeze(14, '2026-12-01', ['2026-11-20', '2026-11-24'], []), false);
  assert.equal(bankedStreakFreezes(['2026-11-20', '2026-11-24'], ['2026-11-26']), 1);
  assert.equal(shouldAwardStreakFreeze(14, '2026-12-01', ['2026-11-20', '2026-11-24'], ['2026-11-26']), true);
  assert.equal(bankedStreakFreezes(['2026-11-01', '2026-11-08', '2026-11-15'], []), MAX_STREAK_FREEZES);
});

test('autoApplyStreakFreezes bridges saveable gaps and never wastes freezes on expired streaks', () => {
  const activity = { '2026-11-18': 3, '2026-11-19': 4, '2026-11-20': 2 };

  const oneDayMissed = autoApplyStreakFreezes({
    dailyGoal: 2,
    reviewActivity: activity,
    streakFreezeAwards: ['2026-11-20'],
    streakFreezeDates: []
  }, new Date(2026, 10, 22, 10));
  assert.equal(oneDayMissed.changed, true);
  assert.deepEqual(oneDayMissed.appliedDates, ['2026-11-21']);

  const twoDaysMissedOneFreeze = autoApplyStreakFreezes({
    dailyGoal: 2,
    reviewActivity: activity,
    streakFreezeAwards: ['2026-11-20'],
    streakFreezeDates: []
  }, new Date(2026, 10, 23, 10));
  assert.equal(twoDaysMissedOneFreeze.changed, false);
  assert.deepEqual(twoDaysMissedOneFreeze.appliedDates, []);

  const twoDaysMissedTwoFreezes = autoApplyStreakFreezes({
    dailyGoal: 2,
    reviewActivity: activity,
    streakFreezeAwards: ['2026-11-15', '2026-11-20'],
    streakFreezeDates: []
  }, new Date(2026, 10, 23, 10));
  assert.equal(twoDaysMissedTwoFreezes.changed, true);
  assert.deepEqual(twoDaysMissedTwoFreezes.appliedDates, ['2026-11-21', '2026-11-22']);
});

test('longestStreakFromActivity, milestones, and 7/28-day windows reflect real history', () => {
  const now = new Date(2026, 10, 22, 12);
  const activity = {
    '2026-10-01': 20,
    '2026-10-02': 20,
    '2026-10-03': 20,
    '2026-10-04': 20,
    '2026-10-05': 20,
    '2026-11-19': 20,
    '2026-11-21': 20,
    '2026-11-22': 4
  };
  assert.equal(longestStreakFromActivity(activity, ['2026-11-20'], 0, 20), 5);
  assert.deepEqual(nextStreakMilestone(5), { target: 7, previous: 3, remaining: 2, progressPercent: 50 });

  const week = buildStreakWindow(activity, ['2026-11-20'], { days: 7, dailyGoal: 20, now });
  assert.equal(week.length, 7);
  assert.equal(week.find(day => day.dateKey === '2026-11-19').status, 'goal');
  assert.equal(week.find(day => day.dateKey === '2026-11-20').status, 'frozen');
  assert.equal(week.find(day => day.dateKey === '2026-11-21').status, 'goal');
  assert.equal(week.find(day => day.dateKey === '2026-11-22').status, 'at-risk', 'today stays at-risk until daily goal is met');

  const summary = getStreakSummary({
    reviewActivity: activity,
    streakFreezeDates: ['2026-11-20'],
    streakFreezeAwards: ['2026-11-19'],
    dailyGoal: 20
  }, now);
  assert.equal(summary.currentStreak, 2);
  assert.equal(summary.longestStreak, 5);
  assert.equal(summary.atRisk, true);
  assert.equal(summary.bankedFreezes, 0);
  assert.equal(summary.activeDaysLast28, 3);
  assert.equal(summary.monthWindow.length, 28);
});

test('recordReview awards freezes on day 3, emits goal-reached once, and protects missed days automatically', () => {
  const service = new DriveSyncService(new MemoryStorage());
  service.updateSettings({ dailyGoal: 2 });
  const events = [];
  const originalDispatch = globalThis.dispatchEvent;
  globalThis.dispatchEvent = event => { events.push(event); return true; };
  try {
    const today = new Date();
    const dMinus2 = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 2, 12);
    const dMinus1 = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1, 12);
    service.recordReview(dMinus2);
    service.recordReview(dMinus2);
    service.recordReview(dMinus1);
    service.recordReview(dMinus1);

    // First review today is below daily goal (1 of 2): neither streak nor goal should trigger yet.
    service.recordReview(today);
    assert.equal(events.filter(event => event.type === 'keepvocab:streak-extended').length, 0);
    assert.equal(events.filter(event => event.type === 'keepvocab:goal-reached').length, 0);

    // Second review reaches daily goal: extends streak to day 3, awards freeze, and emits goal-reached.
    service.recordReview(today);
    const streakEvent = events.find(event => event.type === 'keepvocab:streak-extended');
    assert.ok(streakEvent);
    assert.equal(streakEvent.detail.streak, 3);
    assert.equal(streakEvent.detail.milestone, 3);
    assert.equal(streakEvent.detail.earnedFreeze, true);
    assert.equal(streakEvent.detail.bankedFreezes, 1);
    assert.equal(events.filter(event => event.type === 'keepvocab:goal-reached').length, 1);

    service.recordReview(today);
    assert.equal(events.filter(event => event.type === 'keepvocab:goal-reached').length, 1, 'goal-reached fires only once per day');
    assert.equal(events.filter(event => event.type === 'keepvocab:streak-extended').length, 1, 'streak-extended fires only once per day');

    const twoDaysLater = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2, 12);
    const protection = service.ensureStreakProtection(twoDaysLater);
    const missedDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 12);
    assert.deepEqual(protection.appliedDates, [localDateKey(missedDay)]);
    assert.equal(protection.streak, 3);
    assert.equal(protection.bankedFreezes, 0);
  } finally {
    if (originalDispatch === undefined) delete globalThis.dispatchEvent;
    else globalThis.dispatchEvent = originalDispatch;
  }
});

test('streak freeze awards, freeze dates, and longest streak merge cleanly across devices', () => {
  const local = {
    courseProfiles: {
      english: {
        updatedAt: '2026-11-22T10:00:00.000Z',
        longestStreak: 12,
        streakFreezeAwards: ['2026-11-10'],
        streakFreezeDates: ['2026-11-12'],
        exerciseActivityByDevice: { phone: { '2026-11-21': 4 } }
      }
    }
  };
  const remote = {
    courseProfiles: {
      english: {
        updatedAt: '2026-11-22T11:00:00.000Z',
        longestStreak: 9,
        streakFreezeAwards: ['2026-11-17'],
        streakFreezeDates: [],
        exerciseActivityByDevice: { laptop: { '2026-11-22': 5 } }
      }
    }
  };
  const merged = mergeDriveSettings(local, remote);
  assert.equal(merged.longestStreak, 12);
  assert.deepEqual(merged.streakFreezeAwards, ['2026-11-10', '2026-11-17']);
  assert.deepEqual(merged.streakFreezeDates, ['2026-11-12']);
  assert.equal(bankedStreakFreezes(merged.streakFreezeAwards, merged.streakFreezeDates), 1);
});

test('a used freeze is announced once when opening the app or starting an unfinished daily goal', () => {
  const today = new Date();
  const twoDaysAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 2, 12);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1, 12);
  const events = [];
  const originalDispatch = globalThis.dispatchEvent;
  globalThis.dispatchEvent = event => { events.push(event); return true; };
  try {
    for (const applyFreeze of [
      service => service.ensureStreakProtection(today),
      service => service.recordReview(today)
    ]) {
      const service = new DriveSyncService(new MemoryStorage());
      service.updateSettings({ dailyGoal: 2, streakFreezeAwards: [localDateKey(twoDaysAgo)] });
      service.recordReview(twoDaysAgo);
      service.recordReview(twoDaysAgo);
      events.length = 0;
      applyFreeze(service);
      service.ensureStreakProtection(today);
      const protections = events.filter(event => event.type === 'keepvocab:streak-protected');
      assert.deepEqual(protections.map(event => event.detail), [{
        streak: 1,
        appliedDates: [localDateKey(yesterday)]
      }]);
    }
  } finally {
    if (originalDispatch === undefined) delete globalThis.dispatchEvent;
    else globalThis.dispatchEvent = originalDispatch;
  }
});

test('Today and Progress views render the 7-day strip, freezes, heatmap, and milestone copy', () => {
  const dashboardContainer = { innerHTML: '', querySelector: () => ({ addEventListener: () => {} }), querySelectorAll: () => [] };
  renderDashboardView(dashboardContainer, () => {});
  assert.match(dashboardContainer.innerHTML, /id="today-streak-week"/);
  assert.match(dashboardContainer.innerHTML, /id="today-freeze-pill"/);
  assert.match(dashboardContainer.innerHTML, /id="today-milestone-note"/);

  assert.match(streakMilestoneCopy({ currentStreak: 0, longestStreak: 9 }), /Best: 9 days/);
  assert.match(streakMilestoneCopy({ currentStreak: 5, longestStreak: 5, daysToMilestone: 2, nextMilestone: 7, nextFreezeAtStreak: 7 }), /2d to 7d milestone · \+1 freeze/);

  const elements = new Map();
  const makeEl = () => ({ textContent: '', innerHTML: '', hidden: false, classList: { toggle() {} } });
  const root = {
    querySelector: selector => {
      if (!elements.has(selector)) elements.set(selector, makeEl());
      return elements.get(selector);
    }
  };
  updateDashboardStreakUI(root, { dailyGoal: 20, reviewActivity: {}, streakFreezeAwards: ['2026-11-10'], streakFreezeDates: [] });
  assert.equal(elements.get('#today-freeze-pill').textContent, '1/2 freezes');

  const statsContainer = { innerHTML: '', querySelector: () => ({ addEventListener: () => {} }), querySelectorAll: () => [] };
  renderStatsView(statsContainer, () => {});
  assert.match(statsContainer.innerHTML, /Streak &amp; consistency/);
  assert.match(statsContainer.innerHTML, /class="streak-heatmap"/);
  assert.match(statsContainer.innerHTML, /class="streak-milestones"/);
  assert.match(statsContainer.innerHTML, /Streak Freezes/);
  assert.doesNotMatch(statsContainer.innerHTML, /due-preview|Due now|goal-settings|rewards-section|App themes|Sprig badges|These stats are included in your Drive backup/);
  assert.match(statsContainer.innerHTML, /class="goal-subtle-edit"/);

  const todayKey = localDateKey(new Date());
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const twoDaysAgo = new Date();
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  const celebrationHtml = renderStreakCelebrationMarkup(
    { streak: 7, previousStreak: 6, milestone: 7, earnedFreeze: true, bankedFreezes: 2 },
    {
      dailyGoal: 20,
      reviewActivity: {
        [localDateKey(twoDaysAgo)]: 20,
        [localDateKey(yesterday)]: 20,
        [todayKey]: 20
      }
    }
  );
  assert.match(celebrationHtml, /class="streak-flame-svg is-milestone"/);
  assert.match(celebrationHtml, /class="streak-flame-unlit"/);
  assert.match(celebrationHtml, /class="streak-flame-lit"/);
  assert.match(celebrationHtml, /class="streak-sunburst"/);
  assert.match(celebrationHtml, /class="streak-counter-prev">6<\/span>/);
  assert.match(celebrationHtml, /data-from="6" data-to="7"/);
  assert.match(celebrationHtml, /7 day streak!/);
  assert.match(celebrationHtml, /is-today-ignite/);
  assert.match(celebrationHtml, /streak-connector is-left is-today-connector/);
  assert.match(celebrationHtml, /\+1 Streak Freeze/);
  assert.match(celebrationHtml, /id="btn-streak-celebration-continue"/);
  assert.doesNotMatch(celebrationHtml, /streak-celebration-sprig/);
});

test('scrollbars are hidden across both the main app and the macOS menu-bar quick-add window', () => {
  const polish = readFileSync(new URL('../css/polish.css', import.meta.url), 'utf8');
  const quickAdd = readFileSync(new URL('../css/quick-add.css', import.meta.url), 'utf8');
  assert.match(polish, /scrollbar-width:\s*none/);
  assert.match(polish, /::-webkit-scrollbar[\s\S]*display:\s*none/);
  assert.match(polish, /\.modal-box\s*\{\s*scrollbar-gutter:\s*auto/);
  assert.match(quickAdd, /scrollbar-width:\s*none/);
  assert.match(quickAdd, /::-webkit-scrollbar[\s\S]*display:\s*none/);
  assert.match(quickAdd, /scrollbar-gutter:\s*auto/);
});

test('5+ in-a-row combo milestones render tiered Duolingo-style celebrations with dedicated fanfare sounds', () => {
  assert.equal(isComboMilestone(4), false);
  assert.equal(isComboMilestone(5), true);
  assert.equal(isComboMilestone(6), false);
  assert.equal(isComboMilestone(10), true);
  assert.equal(isComboMilestone(15), true);

  assert.equal(comboCelebrationConfig(5).tier, 'blaze');
  assert.equal(comboCelebrationConfig(10).tier, 'super');
  assert.equal(comboCelebrationConfig(15).tier, 'legend');

  const html5 = renderComboCelebrationMarkup(5);
  assert.match(html5, /5 in a row!/);
  assert.match(html5, /is-blaze/);
  assert.match(html5, /keepvocab-sprig-celebrate\.webp/);
  assert.match(html5, /combo-burst-svg/);

  const html10 = renderComboCelebrationMarkup(10);
  assert.match(html10, /10 in a row!/);
  assert.match(html10, /is-super/);
  assert.match(html10, /UNSTOPPABLE/);

  const combo5 = getInteractionSoundProfile('combo5');
  const combo10 = getInteractionSoundProfile('combo10');
  assert.ok(combo5.length >= 4 && combo5.at(-1).frequency > combo5[0].frequency);
  assert.ok(combo10.length >= 5 && combo10.at(-1).frequency > combo10[0].frequency);
});
