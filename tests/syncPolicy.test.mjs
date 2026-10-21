import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DRIVE_SYNC_MIN_INTERVAL_MS, backgroundSyncDelay } from '../js/services/syncPolicy.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('automatic Drive work is capped to one sync per minute', () => {
  assert.equal(DRIVE_SYNC_MIN_INTERVAL_MS, 60_000);
  assert.equal(backgroundSyncDelay(10_000, 20_000), 50_000);
  assert.equal(backgroundSyncDelay(10_000, 80_000), 1_500);
});

test('background Drive paths never navigate or rebuild the active view', () => {
  const source = readFileSync(resolve(projectRoot, 'js/app.js'), 'utf8');
  const backgroundSection = source.slice(source.indexOf('async function runDriveSync'), source.indexOf('function renderConnectionState'));
  assert.doesNotMatch(backgroundSection, /navigateTo\(|visibilitychange/);
  assert.match(backgroundSection, /keepvocab:data-changed/);
  assert.match(backgroundSection, /hasPendingDriveChanges/);
  assert.match(backgroundSection, /await driveSync\.resumeGoogleDrive\(\)/);
  assert.match(backgroundSection, /waitForGoogleIdentity/);
});

test('progress from other devices is pulled on resume and periodically while open', async () => {
  const { shouldPullFromDrive, DRIVE_REMOTE_REFRESH_MS } = await import('../js/services/syncPolicy.js');
  assert.equal(shouldPullFromDrive(0, 30_000, { resumed: true }), false);
  assert.equal(shouldPullFromDrive(0, 61_000, { resumed: true }), true);
  assert.equal(shouldPullFromDrive(0, 61_000), false);
  assert.equal(shouldPullFromDrive(0, DRIVE_REMOTE_REFRESH_MS), true);
  const source = readFileSync(resolve(projectRoot, 'js/app.js'), 'utf8');
  const refresh = source.slice(source.indexOf('function setupRemoteProgressRefresh'));
  assert.match(refresh, /visibilitychange/);
  assert.doesNotMatch(refresh, /navigateTo\(/);
});
