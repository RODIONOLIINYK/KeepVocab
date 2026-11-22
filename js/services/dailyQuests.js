import { localDateKey } from '../utils/dates.js';

const VARIETY_QUESTS = [
  {
    id: 'sentence',
    title: 'Build 2 sentences',
    target: 2,
    route: 'sentence',
    icon: 'fa-align-left',
    matches: type => type.includes('sentence-builder')
  },
  {
    id: 'listening',
    title: 'Spell 2 words from audio',
    target: 2,
    route: 'spelling',
    icon: 'fa-headphones',
    matches: type => type.includes('listening') || type.includes('spelling')
  },
  {
    id: 'context',
    title: 'Complete 2 context gaps',
    target: 2,
    route: 'context',
    icon: 'fa-book-open-reader',
    matches: type => type.includes('context')
  },
  {
    id: 'useit',
    title: 'Use 1 word in a sentence',
    target: 1,
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
      counts: { sentence: 0, listening: 0, context: 0, useit: 0 }
    };
  }
  const counts = saved.counts && typeof saved.counts === 'object' ? saved.counts : {};
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
    }
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
  const quests = [
    {
      id: 'warmup',
      title: 'Finish 5 exercises',
      progress: Math.min(5, todayExercises),
      target: 5,
      done: todayExercises >= 5,
      route: 'review',
      icon: 'fa-fire'
    },
    {
      id: 'combo',
      title: 'Get 3 right in a row',
      progress: Math.min(3, state.bestCombo),
      target: 3,
      done: state.bestCombo >= 3,
      route: 'review',
      icon: 'fa-bullseye'
    },
    {
      id: variety.id,
      title: variety.title,
      progress: varietyProgress,
      target: variety.target,
      done: varietyProgress >= variety.target,
      route: variety.route,
      icon: variety.icon
    }
  ];
  return {
    date: state.date,
    quests,
    completedCount: quests.filter(quest => quest.done).length,
    totalCount: quests.length,
    allDone: quests.every(quest => quest.done),
    currentCombo: state.currentCombo,
    bestCombo: state.bestCombo
  };
}
