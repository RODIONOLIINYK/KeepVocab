import test from 'node:test';
import assert from 'node:assert/strict';
import { safeImageUrl, safeImageSourceUrl, savedWordImage } from '../js/utils/imageUrls.js';

test('saved image URLs support HTTPS and the raster data formats used by editing and review', () => {
  assert.equal(safeImageUrl(' https://images.test/photo.png '), 'https://images.test/photo.png');
  for (const format of ['jpeg', 'png', 'webp', 'gif']) {
    const url = `data:image/${format};base64,AAAA`;
    assert.equal(safeImageUrl(url), url);
  }
  assert.equal(safeImageUrl('data:image/PNG;base64, AA AA\n'), 'data:image/png;base64,AAAA');
  const upload = `data:image/webp;base64,${'A'.repeat(3_000_000)}`;
  assert.equal(safeImageUrl(upload), upload, 'uploaded images can contain millions of base64 characters');
});

test('image URLs reject executable, insecure, credential-bearing and malformed sources', () => {
  for (const url of [
    'javascript:alert(1)', 'http://images.test/a.png', 'file:///tmp/a.png', 'blob:https://images.test/id',
    'https://user:password@images.test/a.png', 'https://images.test:bad/a.png',
    'data:image/svg+xml;base64,AAAA', 'data:text/html;base64,AAAA',
    'data:image/png;base64,', 'data:image/png;base64,====', 'data:image/png;base64,A',
    'data:image/png;base64,AAAA<script>'
  ]) assert.equal(safeImageUrl(url), '', url);
});

test('saved inline images retain metadata without turning inline data into a credit link', () => {
  const url = 'data:image/webp;base64,AAAA';
  const image = savedWordImage({ imageUrl: url, imageSourceUrl: 'javascript:alert(1)', imageAttribution: 'My upload', imageLicense: 'Personal', word: 'jump' });
  assert.equal(image.url, url);
  assert.equal(image.thumbnailUrl, url);
  assert.equal(image.sourceUrl, '');
  assert.equal(image.attribution, 'My upload');
  assert.equal(image.license, 'Personal');
  assert.equal(safeImageSourceUrl(url), '');
  assert.equal(savedWordImage({ imageUrl: 'https://images.test/a.jpg' }).sourceUrl, 'https://images.test/a.jpg');
  assert.equal(savedWordImage({ imageUrl: 'javascript:alert(1)' }), null);
});
