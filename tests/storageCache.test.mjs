import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryStorage } from '../js/services/driveSync.js';
import { cacheEntryIsFresh, readObjectCache, writeRecentObjectCache } from '../js/utils/storageCache.js';

test('shared storage caches reject corrupt input and keep only the newest bounded entries', () => {
  const storage = new MemoryStorage();
  storage.setItem('cache', '{broken');
  assert.deepEqual(readObjectCache(storage, 'cache'), {});
  const cache = {
    old: { cachedAt: 1, data: 'old' },
    newest: { cachedAt: 3, data: 'newest' },
    middle: { cachedAt: 2, data: 'middle' }
  };
  assert.equal(writeRecentObjectCache(storage, 'cache', cache, 2), true);
  assert.deepEqual(Object.keys(readObjectCache(storage, 'cache')), ['newest', 'middle']);
  assert.equal(cacheEntryIsFresh(cache.newest, 5, 7), true);
  assert.equal(cacheEntryIsFresh(cache.old, 5, 7), false);
});
