import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  UNLOCKABLE_BADGES,
  UNLOCKABLE_THEMES,
  applyAppTheme,
  getLevelInfo,
  getNewUnlocksBetween,
  getRewardSummary,
  isBadgeUnlocked,
  isThemeUnlocked
} from '../js/services/xpRewards.js';
import { awardStreakXp, equipCosmeticReward, recordLearningExercise } from '../js/services/learningStats.js';
import { DriveSyncService, MemoryStorage, mergeDriveSettings } from '../js/services/driveSync.js';
import { renderDashboardView } from '../js/components/DashboardView.js';
import { renderStatsView } from '../js/components/StatsView.js';
import { renderStreakCelebrationMarkup } from '../js/components/StreakCelebration.js';

test('XP leveling unlocks themes and Sprig badges progressively and guards locked equips', () => {
  assert.equal(getLevelInfo(0).level, 1);
  assert.equal(getLevelInfo(99).level, 1);
  assert.equal(getLevelInfo(100).level, 2);
  assert.equal(getLevelInfo(250).level, 3);

  assert.equal(isThemeUnlocked('meadow', 0), true);
  assert.equal(isThemeUnlocked('ocean', 99), false);
  assert.equal(isThemeUnlocked('ocean', 100), true);
  assert.equal(isBadgeUnlocked('spark', 100), true);
  assert.equal(isBadgeUnlocked('crown', 100), false);

  const unlocks = getNewUnlocksBetween(80, 120);
  assert.equal(unlocks.leveledUp, true);
  assert.equal(unlocks.nextLevel, 2);
  assert.ok(unlocks.themes.some(t => t.id === 'ocean'));
  assert.ok(unlocks.badges.some(b => b.id === 'spark'));

  const fakeDoc = {
    documentElement: {
      attrs: new Map(),
      setAttribute(k, v) { this.attrs.set(k, v); },
      removeAttribute(k) { this.attrs.delete(k); }
    }
  };
  applyAppTheme('ocean', 150, fakeDoc);
  assert.equal(fakeDoc.documentElement.attrs.get('data-theme'), 'ocean');
  applyAppTheme('sunset', 150, fakeDoc);
  assert.equal(fakeDoc.documentElement.attrs.has('data-theme'), false, 'falls back to meadow when theme is still locked');
});

test('completing all 3 daily quests awards quest XP, chest bonus, and unlocks Level 2 rewards', () => {
  const service = new DriveSyncService(new MemoryStorage());
  const now = new Date(2026, 10, 22, 12);
  // Variety quest on 2026-11-22: trigger all variety types so the day's variety quest completes too.
  const exerciseTypes = [
    'daily-sentence-builder',
    'daily-sentence-builder',
    'daily-listening-recall',
    'daily-listening-recall',
    'daily-context-cloze',
    'daily-context-cloze',
    'daily-use-it'
  ];
  let chestAwarded = false;
  for (const exerciseType of exerciseTypes) {
    const res = recordLearningExercise({ exerciseType, correct: true, occurredAt: now.toISOString() }, service);
    if (res.chestBonusAwarded) chestAwarded = true;
  }
  assert.equal(chestAwarded, true, 'all 3 daily quests complete and award chest bonus');

  const rewards = getRewardSummary(service.getSettings());
  assert.ok(rewards.xp >= 200, `expected >=200 XP from exercises + 3 quests + chest bonus, got ${rewards.xp}`);
  assert.ok(rewards.level >= 2);
  assert.equal(rewards.questsCompletedTotal, 3);

  // Equip unlocked Level 2 theme & badge; locked Level 6 theme must be ignored.
  equipCosmeticReward({ themeId: 'ocean', badgeId: 'spark' }, service);
  assert.equal(getRewardSummary(service.getSettings()).equippedTheme, 'ocean');
  assert.equal(getRewardSummary(service.getSettings()).equippedBadge, 'spark');
  equipCosmeticReward({ themeId: 'midnight' }, service);
  assert.equal(getRewardSummary(service.getSettings()).equippedTheme, 'ocean');
});

test('awardStreakXp awards bonus once per day and Drive sync merges XP and claimed quests cleanly', () => {
  const service = new DriveSyncService(new MemoryStorage());
  const first = awardStreakXp({ date: '2026-11-25', milestone: 7 }, service);
  assert.equal(first.xpBonus, 50);
  const repeat = awardStreakXp({ date: '2026-11-25', milestone: 7 }, service);
  assert.equal(repeat.xpBonus, 0, 'streak bonus is only awarded once per day');

  const merged = mergeDriveSettings(
    {
      courseProfiles: {
        english: {
          updatedAt: '2026-11-25T10:00:00.000Z',
          learningStats: {
            xp: 180,
            questsCompletedTotal: 4,
            dailyQuests: { date: '2026-11-25', exercises: 3, currentCombo: 2, bestCombo: 2, counts: { sentence: 1 }, claimedIds: ['combo'], bonusClaimed: false }
          }
        }
      }
    },
    {
      courseProfiles: {
        english: {
          updatedAt: '2026-11-25T11:00:00.000Z',
          learningStats: {
            xp: 260,
            questsCompletedTotal: 6,
            dailyQuests: { date: '2026-11-25', exercises: 5, currentCombo: 3, bestCombo: 3, counts: { sentence: 2 }, claimedIds: ['warmup'], bonusClaimed: true }
          }
        }
      }
    }
  );
  assert.equal(merged.learningStats.xp, 260);
  assert.equal(merged.learningStats.questsCompletedTotal, 6);
  assert.deepEqual(merged.learningStats.dailyQuests.claimedIds.sort(), ['combo', 'warmup']);
  assert.equal(merged.learningStats.dailyQuests.bonusClaimed, true);
});

test('Today, Progress, and full-screen Duolingo-style streak celebration render rewards and flame animations', () => {
  const dash = { innerHTML: '', querySelector: () => ({ addEventListener: () => {} }), querySelectorAll: () => [] };
  renderDashboardView(dash, () => {});
  assert.match(dash.innerHTML, /quest-xp-summary/);
  assert.match(dash.innerHTML, /quest-xp-pill/);
  assert.match(dash.innerHTML, /quest-chest-banner/);
  assert.match(dash.innerHTML, /sprig-equipped-badge/);

  const stats = { innerHTML: '', querySelector: () => ({ addEventListener: () => {} }), querySelectorAll: () => [] };
  renderStatsView(stats, () => {});
  assert.match(stats.innerHTML, /id="rewards-section"/);
  assert.match(stats.innerHTML, /App themes/);
  assert.match(stats.innerHTML, /Sprig badges/);
  assert.equal(UNLOCKABLE_THEMES.length, 6);
  assert.equal(UNLOCKABLE_BADGES.length, 6);

  const celebrationHtml = renderStreakCelebrationMarkup(
    { streak: 7, previousStreak: 6, milestone: 7, earnedFreeze: true, bankedFreezes: 2, xpBonus: 50, leveledUp: true, nextLevel: 3 },
    { dailyGoal: 20, reviewActivity: {} }
  );
  assert.match(celebrationHtml, /class="streak-flame-svg"/);
  assert.match(celebrationHtml, /data-from="6" data-to="7"/);
  assert.match(celebrationHtml, /7 day streak!/);
  assert.match(celebrationHtml, /is-today-ignite/);
  assert.match(celebrationHtml, /\+50 XP/);
  assert.match(celebrationHtml, /\+1 Streak Freeze/);
  assert.match(celebrationHtml, /Level 3 unlocked!/);
  assert.match(celebrationHtml, /id="btn-streak-celebration-continue"/);

  const appJs = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(appJs, /showStreakCelebration/);
  assert.match(appJs, /keepvocab:quest-completed/);
  assert.match(appJs, /keepvocab:level-up/);
});
