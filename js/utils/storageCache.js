export function readObjectCache(storage, key) {
  try {
    const parsed = JSON.parse(storage?.getItem(key) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function cacheEntryIsFresh(entry, ttlMs, now = Date.now()) {
  return Boolean(entry?.data && Number(entry.cachedAt) > 0 && now - Number(entry.cachedAt) < ttlMs);
}

export function writeRecentObjectCache(storage, key, cache, limit = 100) {
  if (!storage) return false;
  const recent = Object.entries(cache || {})
    .sort(([, first], [, second]) => Number(second?.cachedAt || 0) - Number(first?.cachedAt || 0))
    .slice(0, Math.max(1, Number(limit) || 100));
  try {
    storage.setItem(key, JSON.stringify(Object.fromEntries(recent)));
    return true;
  } catch {
    return false;
  }
}
