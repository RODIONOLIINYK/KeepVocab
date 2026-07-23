import test from 'node:test';
import assert from 'node:assert/strict';

import { getUnmatchedWords } from '../js/components/MatchSprintMode.js';

test('a connected Match Sprint pair disappears from both columns', () => {
  const wordColumn = [{ id: 'alpha' }, { id: 'beta' }, { id: 'gamma' }];
  const meaningColumn = [{ id: 'gamma' }, { id: 'alpha' }, { id: 'beta' }];
  const matched = new Set(['beta']);

  assert.deepEqual(getUnmatchedWords(wordColumn, matched).map(item => item.id), ['alpha', 'gamma']);
  assert.deepEqual(getUnmatchedWords(meaningColumn, matched).map(item => item.id), ['gamma', 'alpha']);
});
