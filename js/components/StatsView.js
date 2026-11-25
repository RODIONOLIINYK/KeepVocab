import { normalizeWordPracticeStats } from '../services/wordSelection.js?v=18908';
import { readFsrsConfig } from '../services/fsrsConfig.js';
import { driveSync } from '../services/driveSync.js?v=18908';
import { getDueWords } from '../services/srsEngine.js?v=18908';
import { masteryStage, normalizeMastery } from '../services/exerciseResult.js?v=18908';
import { equipCosmeticReward, normalizeLearningStats } from '../services/learningStats.js?v=18908';
import { getStreakSummary } from '../services/studyActivity.js';
import { getRewardSummary, renderBadgeSvg } from '../services/xpRewards.js';
import { weaknessScore } from '../services/dailySession.js?v=18908';
import { escapeHtml } from '../utils/html.js';
import { navigateTo as go } from '../utils/navigation.js';

const DISPLAY_MILESTONES = [3, 7, 14, 21, 30, 50, 100, 365];

function dateKey(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function renderStreakConsistencyCard(summary) {
  const statusLabel = summary.atRisk ? 'Goal pending'
    : summary.streakSafeToday ? 'Safe today'
      : 'Ready to start';
  const statusClass = summary.atRisk ? 'is-at-risk'
    : summary.streakSafeToday ? 'is-safe'
      : 'is-idle';
  const freezeNote = summary.bankedFreezes >= summary.maxFreezes
    ? 'Full protection banked'
    : `Next freeze at ${summary.nextFreezeAtStreak}-day streak`;
  const cells = summary.monthWindow.map(day => {
    const label = day.status === 'frozen'
      ? `${day.dateKey}: Protected by Streak Freeze`
      : `${day.dateKey}: ${day.count} exercise${day.count === 1 ? '' : 's'}${day.isGoalReached ? ' (goal reached)' : ''}`;
    return `<span class="heatmap-cell lvl-${day.intensity}${day.isFrozen ? ' is-frozen' : ''}${day.isToday ? ' is-today' : ''}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${day.isFrozen ? '<i class="fa-solid fa-shield-halved" aria-hidden="true"></i>' : ''}</span>`;
  }).join('');
  const best = Math.max(summary.currentStreak, summary.longestStreak);
  const badges = DISPLAY_MILESTONES.map(days => {
    const achieved = best >= days;
    const isNext = !achieved && summary.nextMilestone === days;
    return `<div class="milestone-badge${achieved ? ' is-achieved' : ''}${isNext ? ' is-next' : ''}"><span class="milestone-icon"><i class="fa-solid ${achieved ? 'fa-circle-check' : isNext ? 'fa-fire' : 'fa-lock'}" aria-hidden="true"></i></span><strong>${days}d</strong><small>${achieved ? 'Unlocked' : isNext ? `${summary.daysToMilestone}d left` : 'Milestone'}</small></div>`;
  }).join('');
  return `<article class="spec-card streak-stats-card" aria-labelledby="streak-rhythm-heading">
    <div class="today-section-heading"><div><span class="eyebrow">Habit momentum</span><h2 id="streak-rhythm-heading">Streak &amp; consistency</h2></div><span class="streak-status-chip ${statusClass}"><i class="fa-solid fa-fire" aria-hidden="true"></i> ${statusLabel}</span></div>
    <div class="streak-overview-grid">
      <div><span>Current streak</span><strong>${summary.currentStreak} ${summary.currentStreak === 1 ? 'day' : 'days'}</strong><small>${summary.currentStreak > 0 ? `${summary.daysToMilestone}d to ${summary.nextMilestone}d milestone` : `Finish ${summary.dailyGoal} today to start`}</small></div>
      <div><span>Longest streak</span><strong>${summary.longestStreak} ${summary.longestStreak === 1 ? 'day' : 'days'}</strong><small>Personal record</small></div>
      <div><span>Last 28 days</span><strong>${summary.activeDaysLast28} / 28</strong><small>Active study days</small></div>
      <div><span>Streak Freezes</span><strong>${summary.bankedFreezes} / ${summary.maxFreezes}</strong><small>${escapeHtml(freezeNote)}</small></div>
    </div>
    <div class="streak-heatmap-section">
      <div class="streak-heatmap-heading"><span>Last 28 days</span><div class="streak-heatmap-legend" aria-hidden="true"><span>Less</span><i class="heatmap-cell lvl-0"></i><i class="heatmap-cell lvl-1"></i><i class="heatmap-cell lvl-2"></i><i class="heatmap-cell lvl-3"></i><i class="heatmap-cell lvl-4"></i><span>More</span><i class="heatmap-cell is-frozen"></i><span>Freeze</span></div></div>
      <div class="streak-heatmap" role="img" aria-label="${summary.activeDaysLast28} active days in the last 28 days">${cells}</div>
    </div>
    <div class="streak-milestones-section">
      <span class="eyebrow">Milestones</span>
      <div class="streak-milestones">${badges}</div>
    </div>
  </article>`;
}

function renderRewardsCard(rewards) {
  const themeCards = rewards.themes.map(theme => {
    const status = theme.equipped ? 'Active' : theme.unlocked ? 'Use theme' : `Lv. ${theme.unlockLevel} · ${theme.unlockXp} XP`;
    return `<button type="button" class="unlock-card theme-card${theme.equipped ? ' is-equipped' : ''}${theme.unlocked ? ' is-unlocked' : ' is-locked'}" data-equip-theme="${escapeHtml(theme.id)}" ${theme.unlocked ? '' : 'disabled'}>
      <span class="theme-swatch" style="background:linear-gradient(135deg, ${theme.swatch}, ${theme.swatchAccent})" aria-hidden="true">${theme.unlocked ? (theme.equipped ? '<i class="fa-solid fa-check"></i>' : '') : '<i class="fa-solid fa-lock"></i>'}</span>
      <span class="unlock-copy"><strong>${escapeHtml(theme.name)}</strong><small>${escapeHtml(status)}</small></span>
    </button>`;
  }).join('');

  const badgeCards = rewards.badges.map(badge => {
    const status = badge.equipped ? 'Equipped' : badge.unlocked ? 'Equip' : `Lv. ${badge.unlockLevel} · ${badge.unlockXp} XP`;
    return `<button type="button" class="unlock-card badge-card${badge.equipped ? ' is-equipped' : ''}${badge.unlocked ? ' is-unlocked' : ' is-locked'}" data-equip-badge="${escapeHtml(badge.id)}" ${badge.unlocked ? '' : 'disabled'}>
      <span class="badge-preview" style="background:${badge.bg}" aria-hidden="true">${renderBadgeSvg(badge.id, 26)}${badge.unlocked ? '' : '<i class="fa-solid fa-lock unlock-lock-dot"></i>'}</span>
      <span class="unlock-copy"><strong>${escapeHtml(badge.name)}</strong><small>${escapeHtml(status)}</small></span>
    </button>`;
  }).join('');

  return `<article class="spec-card rewards-stats-card" id="rewards-section" aria-labelledby="rewards-heading">
    <div class="today-section-heading">
      <div><span class="eyebrow">Quests &amp; rewards</span><h2 id="rewards-heading">Level ${rewards.level} · ${escapeHtml(rewards.title)}</h2></div>
      <span class="rewards-xp-chip">${renderBadgeSvg(rewards.equippedBadge, 18)}<strong>${rewards.xp} XP</strong></span>
    </div>
    <div class="rewards-level-bar">
      <div class="rewards-level-meta">
        <span>${rewards.xpIntoLevel} / ${rewards.xpForNextLevel} XP to Level ${rewards.level + 1}</span>
        <strong>${rewards.questsCompletedTotal} quest${rewards.questsCompletedTotal === 1 ? '' : 's'} completed</strong>
      </div>
      <div class="quest-xp-track" role="progressbar" aria-label="Profile level progress" aria-valuemin="0" aria-valuemax="${rewards.xpForNextLevel}" aria-valuenow="${rewards.xpIntoLevel}"><span style="width:${rewards.progressPercent}%"></span></div>
    </div>
    <div class="rewards-group">
      <div class="rewards-group-heading"><span class="eyebrow">App themes</span><small>${rewards.unlockedThemeCount}/${rewards.themes.length} unlocked</small></div>
      <div class="unlock-grid">${themeCards}</div>
    </div>
    <div class="rewards-group">
      <div class="rewards-group-heading"><span class="eyebrow">Sprig badges</span><small>${rewards.unlockedBadgeCount}/${rewards.badges.length} unlocked</small></div>
      <div class="unlock-grid">${badgeCards}</div>
    </div>
  </article>`;
}

export function renderStatsView(container, onNavigate) {
  const words = driveSync.getWords();
  const settings = driveSync.getSettings();
  const stats = normalizeLearningStats(settings);
  const rewards = getRewardSummary(settings);
  const dueWords = getDueWords(words);
  const mastery = words.map(word => ({ word, data: normalizeMastery(word) }));
  const recognized = mastery.filter(item => ['recognized', 'recalled', 'context', 'productive'].includes(masteryStage(item.data))).length;
  const recalled = words.filter(word => normalizeWordPracticeStats(word).unaidedRecalled > 0).length;
  const context = mastery.filter(item => ['context', 'productive'].includes(masteryStage(item.data))).length;
  const productive = mastery.filter(item => item.data.productive >= .65).length;
  const spoken = mastery.filter(item => item.data.speaking >= .65).length;
  const weak = words.filter(word => weaknessScore(word) > 0).length;
  const dailyGoal = Math.max(1, Number(settings.dailyGoal || 20));
  const streakSummary = getStreakSummary(settings);
  const reviewsToday = settings.reviewsDate === dateKey(new Date()) ? Number(settings.reviewsToday || 0) : 0;
  const activity = settings.reviewActivity || {};
  const weekly = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - offset));
    return { label: date.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2), count: Number(activity[dateKey(date)] || 0) };
  });
  const maxActivity = Math.max(1, ...weekly.map(day => day.count));
  const memoryConfig = readFsrsConfig(settings);
  const recallDays = word => word.srs?.cards?.recall?.scheduled_days ?? word.srs?.scheduledDays ?? Math.max(0, (Date.parse(word.nextReviewDate) - Date.parse(word.lastReviewedAt || word.createdAt)) / 86400000);
  const intervalGroups = [
    { label: 'Learning today', count: words.filter(word => recallDays(word) < 1).length },
    { label: '1–6 days', count: words.filter(word => recallDays(word) >= 1 && recallDays(word) < 7).length },
    { label: '1–4 weeks', count: words.filter(word => recallDays(word) >= 7 && recallDays(word) < 30).length },
    { label: '1 month or longer', count: words.filter(word => recallDays(word) >= 30).length }
  ];
  const auth = driveSync.getDriveStatus();

  container.innerHTML = `<section class="full-view-stack progress-view" aria-labelledby="progress-heading"><div class="progress-hero"><div><span class="eyebrow">Your learning over time</span><h1 id="progress-heading">Your vocabulary is becoming usable</h1><p>Recognition is the start. Recall, context, and speaking show what you can actively use.</p></div><button class="btn-green-solid" id="progress-workout">${dueWords.length ? `Review ${dueWords.length} due` : 'Start a workout'}</button></div>
    <div class="progress-mastery-grid"><article><span>Saved</span><strong>${words.length}</strong><small>vocabulary cards</small></article><article><span>Recognized</span><strong>${recognized}</strong><small>meaning identified</small></article><article><span>Recalled unaided</span><strong>${recalled}</strong><small>produced from memory</small></article><article><span>Used in context</span><strong>${context}</strong><small>understood in a situation</small></article><article><span>Used productively</span><strong>${productive}</strong><small>own sentences</small></article><article><span>Used while speaking</span><strong>${spoken}</strong><small>activated with Mira</small></article></div>
    ${renderStreakConsistencyCard(streakSummary)}
    ${renderRewardsCard(rewards)}
    <div class="progress-detail-grid"><article class="spec-card"><div class="today-section-heading"><div><span class="eyebrow">Last 7 days</span><h2>${weekly.reduce((sum, day) => sum + day.count, 0)} exercises</h2></div><details class="goal-subtle-edit"><summary id="stats-today-count">${reviewsToday}/${dailyGoal} today</summary><form id="daily-goal-form" class="goal-subtle-form"><label for="daily-goal-input">Daily target</label><input type="number" id="daily-goal-input" min="1" max="200" value="${dailyGoal}" aria-label="Daily exercise goal"><button class="status-pill offline">Save</button></form><p id="goal-save-message" class="goal-subtle-message" role="status" aria-live="polite"></p></details></div><div class="activity-chart">${weekly.map(day => `<div title="${day.count} exercises"><span>${day.count || ''}</span><i style="height:${day.count ? Math.max(18, Math.round(day.count / maxActivity * 120)) : 8}px"></i><small>${day.label}</small></div>`).join('')}</div></article>
      <article class="spec-card progress-outcomes"><span class="eyebrow">Learning outcomes</span><div><span>Sessions completed</span><strong>${stats.sessionsCompleted}</strong></div><div><span>Weak words improved</span><strong>${stats.weakWordsImproved}</strong></div><div><span>Speaking minutes</span><strong>${Math.round(stats.speakingMinutes)}</strong></div><div><span>Weak words now</span><strong>${weak}</strong></div><p><i class="fa-solid fa-cloud"></i> ${auth.isConnected ? 'These stats are included in your Drive backup.' : 'Connect Drive in Settings to restore these stats on another installation.'}</p></article></div>
    <article class="spec-card algorithm-details"><div class="today-section-heading"><div><span class="eyebrow">Scheduling detail</span><h2>Recall intervals</h2></div><span>Mastered words still return</span></div><div class="box-distribution">${intervalGroups.map(group => `<div><span>${group.label}</span><i><b style="width:${Math.round(group.count / Math.max(1,...intervalGroups.map(item => item.count)) * 100)}%"></b></i><strong>${group.count}</strong></div>`).join('')}</div><p class="section-helper">FSRS-6 schedules recall against a ${Math.round(memoryConfig.retention * 100)}% target. Recognition and answers with hints have separate memory states. Older words keep their saved review dates until reviewed.</p></article></section>`;

  container.querySelector('#progress-workout').addEventListener('click', () => go('daily', onNavigate));
  container.querySelectorAll('[data-equip-theme]').forEach(button => button.addEventListener('click', () => {
    equipCosmeticReward({ themeId: button.dataset.equipTheme }, driveSync);
    renderStatsView(container, onNavigate);
  }));
  container.querySelectorAll('[data-equip-badge]').forEach(button => button.addEventListener('click', () => {
    equipCosmeticReward({ badgeId: button.dataset.equipBadge }, driveSync);
    renderStatsView(container, onNavigate);
  }));
  container.querySelector('#daily-goal-form').addEventListener('submit', event => {
    event.preventDefault();
    const value = Math.max(1, Math.min(200, Number(container.querySelector('#daily-goal-input').value) || 20));
    driveSync.updateSettings({ dailyGoal: value });
    const todayLabel = container.querySelector('#stats-today-count');
    if (todayLabel) todayLabel.textContent = `${reviewsToday}/${value} today`;
    container.querySelector('#goal-save-message').textContent = `Saved: ${value}/day.`;
  });
}
