import test from 'node:test';
import assert from 'node:assert/strict';
import { DriveSyncService, MemoryStorage } from '../js/services/driveSync.js';
import { savedWordImage } from '../js/utils/imageUrls.js';

test('supported saved raster images survive vocabulary add, edit, and storage migration', () => {
  for (const format of ['png', 'jpeg', 'webp', 'gif']) {
    const storage = new MemoryStorage();
    const service = new DriveSyncService(storage);
    const imageUrl = `data:image/${format};base64,AAAA`;
    const word = service.addWord({ word: 'apple', partOfSpeech: 'noun', definition: 'A round fruit.', imageUrl });
    assert.equal(savedWordImage(word).url, imageUrl);
    assert.equal(savedWordImage(word).sourceUrl, '');
    service.updateWord(word.id, { imageUrl: 'https://example.com/apple.jpg', imageSourceUrl: 'https://example.com/credit' });
    const edited = service.updateWord(word.id, { imageUrl, imageSourceUrl: '' });
    assert.equal(savedWordImage(edited).url, imageUrl);
    const restored = new DriveSyncService(storage).getWords().find(item => item.id === word.id);
    assert.equal(restored.imageUrl, imageUrl);
    assert.equal(savedWordImage(restored).sourceUrl, '');
  }
});

test('unsafe image data and source links are rejected on edit and removed on migration', () => {
  const storage = new MemoryStorage();
  const service = new DriveSyncService(storage);
  const word = service.addWord({ word: 'apple', partOfSpeech: 'noun', definition: 'A round fruit.' });
  for (const imageUrl of ['javascript:alert(1)', 'data:image/svg+xml;base64,AAAA', 'https://user:password@example.com/apple.png']) {
    assert.throws(() => service.updateWord(word.id, { imageUrl }), /Image URL/);
  }
  assert.throws(() => service.updateWord(word.id, { imageSourceUrl: 'data:image/png;base64,AAAA' }), /Image source URL/);
  service.saveWords([{ ...word, imageUrl: 'data:image/svg+xml;base64,AAAA', imageSourceUrl: 'javascript:alert(1)' }]);
  const restored = new DriveSyncService(storage).getWords().find(item => item.id === word.id);
  assert.equal(restored.imageUrl, '');
  assert.equal(restored.imageSourceUrl, '');
  assert.equal(savedWordImage(restored), null);
});
