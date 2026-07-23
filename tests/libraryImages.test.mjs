import test from 'node:test';
import assert from 'node:assert/strict';

import { reusedImageUrls } from '../js/components/LibraryView.js';

test('library identifies an image reused by multiple meaning cards', () => {
  const duplicates = reusedImageUrls([
    { id: '1', imageUrl: 'https://images.example/shared.jpg' },
    { id: '2', imageUrl: 'https://images.example/shared.jpg' },
    { id: '3', imageUrl: 'https://images.example/unique.jpg' },
    { id: '4', imageUrl: '' }
  ]);

  assert.deepEqual([...duplicates], ['https://images.example/shared.jpg']);
});
