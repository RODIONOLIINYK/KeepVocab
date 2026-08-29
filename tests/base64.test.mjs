import test from 'node:test';
import assert from 'node:assert/strict';

import { base64ToBytes, blobToBase64, bytesToBase64 } from '../js/utils/base64.js';

test('shared base64 helpers preserve binary data for audio and image services', async () => {
  const bytes = Uint8Array.from({ length: 70_000 }, (_, index) => index % 251);
  const encoded = bytesToBase64(bytes);
  assert.deepEqual(base64ToBytes(encoded), bytes);
  assert.equal(await blobToBase64(new Blob([bytes])), encoded);
});
