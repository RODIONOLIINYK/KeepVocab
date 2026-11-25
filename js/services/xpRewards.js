// XP progression, leveling, and unlockable cosmetic themes & Sprig badges.

export const XP_PER_CORRECT_EXERCISE = 10;
export const XP_PER_ATTEMPT_EXERCISE = 2;
export const XP_STREAK_EXTENDED_BONUS = 25;
export const XP_STREAK_MILESTONE_BONUS = 50;
export const XP_ALL_QUESTS_BONUS = 60;

export const XP_LEVELS = Object.freeze([
  { level: 1, minXp: 0, title: 'Seedling' },
  { level: 2, minXp: 100, title: 'Sprout' },
  { level: 3, minXp: 250, title: 'Word Explorer' },
  { level: 4, minXp: 450, title: 'Phrase Builder' },
  { level: 5, minXp: 700, title: 'Fluent Leaf' },
  { level: 6, minXp: 1000, title: 'Sentence Crafter' },
  { level: 7, minXp: 1400, title: 'Lexicon Keeper' },
  { level: 8, minXp: 1900, title: 'Language Sage' }
]);

export const UNLOCKABLE_THEMES = Object.freeze([
  {
    id: 'meadow',
    name: 'Meadow Green',
    subtitle: 'Classic KeepVocab palette',
    unlockLevel: 1,
    unlockXp: 0,
    swatch: '#22a447',
    swatchAccent: '#86efac'
  },
  {
    id: 'ocean',
    name: 'Ocean Breeze',
    subtitle: 'Crisp coastal blue',
    unlockLevel: 2,
    unlockXp: 100,
    swatch: '#0284c7',
    swatchAccent: '#7dd3fc'
  },
  {
    id: 'sunset',
    name: 'Amber Sunset',
    subtitle: 'Warm energetic coral',
    unlockLevel: 3,
    unlockXp: 250,
    swatch: '#ea580c',
    swatchAccent: '#fdba74'
  },
  {
    id: 'lavender',
    name: 'Royal Iris',
    subtitle: 'Rich violet indigo',
    unlockLevel: 4,
    unlockXp: 450,
    swatch: '#7c3aed',
    swatchAccent: '#c4b5fd'
  },
  {
    id: 'sakura',
    name: 'Blossom Rose',
    subtitle: 'Bright cherry rose',
    unlockLevel: 5,
    unlockXp: 700,
    swatch: '#db2777',
    swatchAccent: '#f9a8d4'
  },
  {
    id: 'midnight',
    name: 'Emerald Slate',
    subtitle: 'Deep botanical teal',
    unlockLevel: 6,
    unlockXp: 1000,
    swatch: '#0f766e',
    swatchAccent: '#5eead4'
  }
]);

export const UNLOCKABLE_BADGES = Object.freeze([
  {
    id: 'sprout',
    name: 'Fresh Sprout',
    subtitle: 'Every vocabulary starts small',
    unlockLevel: 1,
    unlockXp: 0,
    accent: '#22a447',
    bg: '#effbf3'
  },
  {
    id: 'spark',
    name: 'Quest Spark',
    subtitle: 'Powered by daily quests',
    unlockLevel: 2,
    unlockXp: 100,
    accent: '#d97706',
    bg: '#fffbeb'
  },
  {
    id: 'flame',
    name: 'Streak Keeper',
    subtitle: 'Consistent day after day',
    unlockLevel: 3,
    unlockXp: 250,
    accent: '#ea580c',
    bg: '#fff7ed'
  },
  {
    id: 'compass',
    name: 'Context Explorer',
    subtitle: 'Finds meaning in real usage',
    unlockLevel: 4,
    unlockXp: 450,
    accent: '#0284c7',
    bg: '#f0f9ff'
  },
  {
    id: 'quill',
    name: 'Sentence Architect',
    subtitle: 'Crafts natural expressions',
    unlockLevel: 5,
    unlockXp: 700,
    accent: '#7c3aed',
    bg: '#f5f3ff'
  },
  {
    id: 'crown',
    name: 'Lexicon Crown',
    subtitle: 'Master of active vocabulary',
    unlockLevel: 7,
    unlockXp: 1400,
    accent: '#b45309',
    bg: '#fef3c7'
  }
]);

export function normalizeXp(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

export function getLevelInfo(rawXp = 0) {
  const xp = normalizeXp(rawXp);
  const lastDefined = XP_LEVELS[XP_LEVELS.length - 1];
  if (xp >= lastDefined.minXp) {
    const extraLevels = Math.floor((xp - lastDefined.minXp) / 500);
    const level = lastDefined.level + extraLevels;
    const currentLevelXp = lastDefined.minXp + extraLevels * 500;
    const nextLevelXp = currentLevelXp + 500;
    const xpIntoLevel = xp - currentLevelXp;
    return {
      level,
      title: extraLevels > 0 ? 'Word Master' : lastDefined.title,
      xp,
      currentLevelXp,
      nextLevelXp,
      xpIntoLevel,
      xpForNextLevel: nextLevelXp - currentLevelXp,
      progressPercent: Math.min(100, Math.round(xpIntoLevel / (nextLevelXp - currentLevelXp) * 100))
    };
  }
  let current = XP_LEVELS[0];
  let next = XP_LEVELS[1];
  for (let i = 0; i < XP_LEVELS.length - 1; i += 1) {
    if (xp >= XP_LEVELS[i].minXp) {
      current = XP_LEVELS[i];
      next = XP_LEVELS[i + 1];
    }
  }
  const span = Math.max(1, next.minXp - current.minXp);
  const xpIntoLevel = xp - current.minXp;
  return {
    level: current.level,
    title: current.title,
    xp,
    currentLevelXp: current.minXp,
    nextLevelXp: next.minXp,
    xpIntoLevel,
    xpForNextLevel: span,
    progressPercent: Math.min(100, Math.round(xpIntoLevel / span * 100))
  };
}

export function isThemeUnlocked(themeId, rawXp = 0) {
  const theme = UNLOCKABLE_THEMES.find(item => item.id === themeId);
  if (!theme) return false;
  return getLevelInfo(rawXp).level >= theme.unlockLevel;
}

export function isBadgeUnlocked(badgeId, rawXp = 0) {
  const badge = UNLOCKABLE_BADGES.find(item => item.id === badgeId);
  if (!badge) return false;
  return getLevelInfo(rawXp).level >= badge.unlockLevel;
}

export function resolveEquippedTheme(themeId, rawXp = 0) {
  return isThemeUnlocked(themeId, rawXp) ? themeId : 'meadow';
}

export function resolveEquippedBadge(badgeId, rawXp = 0) {
  return isBadgeUnlocked(badgeId, rawXp) ? badgeId : 'sprout';
}

export function getThemeDefinition(themeId) {
  return UNLOCKABLE_THEMES.find(item => item.id === themeId) || UNLOCKABLE_THEMES[0];
}

export function getBadgeDefinition(badgeId) {
  return UNLOCKABLE_BADGES.find(item => item.id === badgeId) || UNLOCKABLE_BADGES[0];
}

export function getRewardSummary(settings = {}) {
  const stats = settings?.learningStats && typeof settings.learningStats === 'object' ? settings.learningStats : {};
  const xp = normalizeXp(stats.xp);
  const levelInfo = getLevelInfo(xp);
  const equippedTheme = resolveEquippedTheme(settings?.equippedTheme || stats.equippedTheme, xp);
  const equippedBadge = resolveEquippedBadge(settings?.equippedBadge || stats.equippedBadge, xp);
  const themes = UNLOCKABLE_THEMES.map(theme => ({
    ...theme,
    unlocked: levelInfo.level >= theme.unlockLevel,
    equipped: equippedTheme === theme.id
  }));
  const badges = UNLOCKABLE_BADGES.map(badge => ({
    ...badge,
    unlocked: levelInfo.level >= badge.unlockLevel,
    equipped: equippedBadge === badge.id
  }));
  const nextUnlock = [...themes, ...badges]
    .filter(item => !item.unlocked)
    .sort((a, b) => a.unlockXp - b.unlockXp)[0] || null;
  return {
    xp,
    questsCompletedTotal: Math.max(0, Math.round(Number(stats.questsCompletedTotal) || 0)),
    ...levelInfo,
    equippedTheme,
    equippedBadge,
    equippedThemeDef: getThemeDefinition(equippedTheme),
    equippedBadgeDef: getBadgeDefinition(equippedBadge),
    themes,
    badges,
    unlockedThemeCount: themes.filter(item => item.unlocked).length,
    unlockedBadgeCount: badges.filter(item => item.unlocked).length,
    nextUnlock
  };
}

export function getNewUnlocksBetween(previousXp = 0, nextXp = 0) {
  const before = getLevelInfo(previousXp);
  const after = getLevelInfo(nextXp);
  const leveledUp = after.level > before.level;
  const themes = UNLOCKABLE_THEMES.filter(theme => theme.unlockLevel > before.level && theme.unlockLevel <= after.level);
  const badges = UNLOCKABLE_BADGES.filter(badge => badge.unlockLevel > before.level && badge.unlockLevel <= after.level);
  return {
    leveledUp,
    previousLevel: before.level,
    nextLevel: after.level,
    nextTitle: after.title,
    themes,
    badges
  };
}

export function applyAppTheme(themeId, rawXp = null, doc = globalThis.document) {
  const root = doc?.documentElement;
  if (!root) return 'meadow';
  const effective = rawXp == null ? getThemeDefinition(themeId).id : resolveEquippedTheme(themeId, rawXp);
  if (effective === 'meadow') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', effective);
  }
  return effective;
}

export function renderBadgeSvg(badgeId = 'sprout', size = 24) {
  const s = Math.max(14, Number(size) || 24);
  if (badgeId === 'spark') {
    return `<svg class="sprig-badge-svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2.5l2.4 5.9 6.1 1.6-4.7 4.1 1.3 6.2L12 17.2l-5.1 3.1 1.3-6.2-4.7-4.1 6.1-1.6L12 2.5z" fill="#f59e0b" stroke="#b45309" stroke-width="1.4" stroke-linejoin="round"/><circle cx="12" cy="11.5" r="2.2" fill="#fef3c7"/></svg>`;
  }
  if (badgeId === 'flame') {
    return `<svg class="sprig-badge-svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12.7 2.2c.5 3.2-1.8 4.9-2.8 6.4-.8 1.2-.5 2.4-.5 2.4s1.5-1.1 2.4-2.5c2.7 2.2 4.7 5 4.7 8.1 0 3.1-2.5 5.4-5.6 5.4-3.2 0-5.7-2.4-5.7-5.7 0-3.4 2.4-6.2 4.3-8.7 1.3-1.7 2.3-3.5 3.2-5.4z" fill="#f97316" stroke="#c2410c" stroke-width="1.3" stroke-linejoin="round"/><path d="M11.6 13.5c1.5 1.4 2.4 2.8 2.4 4.3 0 1.4-1.1 2.5-2.5 2.5S9 19.2 9 17.8c0-1.5 1-2.8 2.6-4.3z" fill="#fde047"/></svg>`;
  }
  if (badgeId === 'compass') {
    return `<svg class="sprig-badge-svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9.2" fill="#e0f2fe" stroke="#0284c7" stroke-width="1.7"/><path d="M15.8 8.2l-2.3 5.3-5.3 2.3 2.3-5.3 5.3-2.3z" fill="#0284c7"/><circle cx="12" cy="12" r="1.3" fill="#ffffff"/></svg>`;
  }
  if (badgeId === 'quill') {
    return `<svg class="sprig-badge-svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M19.8 4.2c-4.5.3-8.9 2.7-11.6 6.7-1.4 2.1-2.2 4.4-2.6 6.9L4 20l2.2-1.6c2.5-.4 4.8-1.2 6.9-2.6 4-2.7 6.4-7.1 6.7-11.6z" fill="#8b5cf6" stroke="#5b21b6" stroke-width="1.4" stroke-linejoin="round"/><path d="M5.2 18.8l8.8-8.8" stroke="#ede9fe" stroke-width="1.6" stroke-linecap="round"/></svg>`;
  }
  if (badgeId === 'crown') {
    return `<svg class="sprig-badge-svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3.5 17.5L5 8l4.5 3.6L12 5.8l2.5 5.8L19 8l1.5 9.5H3.5z" fill="#fbbf24" stroke="#b45309" stroke-width="1.4" stroke-linejoin="round"/><rect x="4" y="17.5" width="16" height="2.6" rx="1.2" fill="#d97706"/></svg>`;
  }
  return `<svg class="sprig-badge-svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 20V11" stroke="#15803d" stroke-width="2" stroke-linecap="round"/><path d="M12 12c0-4.4 3.2-7.5 7.5-7.5 0 4.4-3.1 7.5-7.5 7.5z" fill="#4ade80" stroke="#15803d" stroke-width="1.4" stroke-linejoin="round"/><path d="M12 14c0-3.7-2.7-6.5-6.5-6.5 0 3.8 2.8 6.5 6.5 6.5z" fill="#22c55e" stroke="#15803d" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
}
