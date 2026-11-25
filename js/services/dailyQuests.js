import { localDateKey } from '../utils/dates.js';
import { XP_ALL_QUESTS_BONUS } from './xpRewards.js';

export const QUEST_XP_WARMUP = 25;
export const QUEST_XP_COMBO = 30;
export const QUEST_XP_VARIETY = 35;

const VARIETY_QUESTS = [
  {
    id: 'sentence',
    title: 'Build 2 sentences',
    target: 2,
    xpReward: QUEST_XP_VARIETY,
    route: 'sentence',
    icon: 'fa-align-left',
    matches: type => type.includes('sentence-builder')
  },
  {
    id: 'listening',
    title: 'Spell 2 words from audio',
    target: 2,
    xpReward: QUEST_XP_VARIETY,
    route: 'spelling',
    icon: 'fa-headphones',
    matches: type => type.includes('listening') || type.includes('spelling')
  },
  {
    id: 'context',
    title: 'Complete 2 context gaps',
    target: 2,
    xpReward: QUEST_XP_VARIETY,
    route: 'context',
    icon: 'fa-book-open-reader',
    matches: type => type.includes('context')
  },
  {
    id: 'useit',
    title: 'Use 1 word in a sentence',
    target: 1,
    xpReward: QUEST_XP_VARIETY,
    route: 'useit',
    icon: 'fa-pen-nib',
    matches: type => type.includes('use-it') || type.includes('useit')
  }
];

function dayIndex(now = new Date()) {
  const key = localDateKey(now);
  const [year, month, day] = key.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function normalizeDailyQuestState(saved, now = new Date()) {
  const today = localDateKey(now);
  if (!saved || typeof saved !== 'object' || saved.date !== today) {
    return {
      date: today,
      exercises: 0,
      currentCombo: 0,
      bestCombo: 0,
      counts: { sentence: 0, listening: 0, context: 0, useit: 0 },
      claimedIds: [],
      bonusClaimed: false
    };
  }
  const counts = saved.counts && typeof saved.counts === 'object' ? saved.counts : {};
  const claimedIds = Array.isArray(saved.claimedIds)
    ? [...new Set(saved.claimedIds.map(id => String(id || '').trim()).filter(Boolean))]
    : [];
  return {
    date: today,
    exercises: Math.max(0, Number(saved.exercises) || 0),
    currentCombo: Math.max(0, Number(saved.currentCombo) || 0),
    bestCombo: Math.max(0, Number(saved.bestCombo) || 0),
    counts: {
      sentence: Math.max(0, Number(counts.sentence) || 0),
      listening: Math.max(0, Number(counts.listening) || 0),
      context: Math.max(0, Number(counts.context) || 0),
      useit: Math.max(0, Number(counts.useit) || 0)
    },
    claimedIds,
    bonusClaimed: Boolean(saved.bonusClaimed)
  };
}

export function applyExerciseToDailyQuests(saved, result = {}, now = new Date()) {
  const next = normalizeDailyQuestState(saved, now);
  next.exercises += 1;
  if (result.correct) {
    next.currentCombo += 1;
    if (next.currentCombo > next.bestCombo) next.bestCombo = next.currentCombo;
  } else {
    next.currentCombo = 0;
  }
  const type = String(result.exerciseType || '').toLowerCase();
  for (const quest of VARIETY_QUESTS) {
    if (quest.matches(type)) next.counts[quest.id] = (next.counts[quest.id] || 0) + 1;
  }
  return next;
}

export function getDailyQuests(settings = {}, now = new Date()) {
  const state = normalizeDailyQuestState(settings?.learningStats?.dailyQuests, now);
  const todayExercises = settings?.reviewsDate === state.date
    ? Math.max(state.exercises, Number(settings.reviewsToday) || 0)
    : state.exercises;
  const variety = VARIETY_QUESTS[Math.abs(dayIndex(now)) % VARIETY_QUESTS.length];
  const varietyProgress = Math.min(variety.target, state.counts[variety.id] || 0);
  const claimed = new Set(state.claimedIds);
  const quests = [
    {
      id: 'warmup',
      title: 'Finish 5 exercises',
      progress: Math.min(5, todayExercises),
      target: 5,
      xpReward: QUEST_XP_WARMUP,
      done: todayExercises >= 5,
      claimed: claimed.has('warmup'),
      route: 'review',
      icon: 'fa-fire'
    },
    {
      id: 'combo',
      title: 'Get 3 right in a row',
      progress: Math.min(3, state.bestCombo),
      target: 3,
      xpReward: QUEST_XP_COMBO,
      done: state.bestCombo >= 3,
      claimed: claimed.has('combo'),
      route: 'review',
      icon: 'fa-bullseye'
    },
    {
      id: variety.id,
      title: variety.title,
      progress: varietyProgress,
      target: variety.target,
      xpReward: variety.xpReward,
      done: varietyProgress >= variety.target,
      claimed: claimed.has(variety.id),
      route: variety.route,
      icon: variety.icon
    }
  ];
  const completedCount = quests.filter(quest => quest.done).length;
  const allDone = completedCount === quests.length;
  const earnedQuestXp = quests.reduce((sum, q) => sum + (q.done ? q.xpReward : 0), 0)
    + (allDone ? XP_ALL_QUESTS_BONUS : 0);
  const totalPossibleXp = quests.reduce((sum, q) => sum + q.xpReward, 0) + XP_ALL_QUESTS_BONUS;
  return {
    date: state.date,
    quests,
    completedCount,
    totalCount: quests.length,
    allDone,
    bonusXp: XP_ALL_QUESTS_BONUS,
    bonusClaimed: state.bonusClaimed,
    earnedQuestXp,
    totalPossibleXp,
    currentCombo: state.currentCombo,
    bestCombo: state.bestCombo
  };
}

// Claim XP rewards for any daily quests newly completed since the previous check.
export function claimCompletedQuestRewards(state, settings = {}, now = new Date()) {
  const normalized = normalizeDailyQuestState(state, now);
  const summary = getDailyQuests({ ...settings, learningStats: { ...(settings?.learningStats || {}), dailyQuests: normalized } }, now);
  const claimedSet = new Set(normalized.claimedIds);
  const newlyCompleted = [];
  let xpAwarded = 0;

  for (const quest of summary.quests) {
    if (quest.done && !claimedSet.has(quest.id)) {
      claimedSet.add(quest.id);
      newlyCompleted.push(quest);
      xpAwarded += quest.xpReward;
    }
  }

  let chestBonusAwarded = false;
  if (summary.allDone && !normalized.bonusClaimed) {
    chestBonusAwarded = true;
    xpAwarded += XP_ALL_QUESTS_BONUS;
  }

  const nextState = {
    ...normalized,
    claimedIds: [...claimedSet],
    bonusClaimed: normalized.bonusClaimed || chestBonusAwarded
  };

  return {
    state: nextState,
    newlyCompleted,
    chestBonusAwarded,
    xpAwarded
  };
}
