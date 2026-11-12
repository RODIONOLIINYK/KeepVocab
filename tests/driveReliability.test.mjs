import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { DriveSyncService, MemoryStorage } from '../js/services/driveSync.js';
import { backgroundSyncDelay, DRIVE_SYNC_MIN_INTERVAL_MS, shouldPullFromDrive } from '../js/services/syncPolicy.js';
import { getGeminiSettings, restoreGeminiBackupRecord, saveGeminiSettings } from '../js/services/geminiSettings.js';
import { getImageProviderSettings, restoreImageProviderBackupRecord, saveImageProviderSettings } from '../js/services/imageSearch.js';

const response = (payload, status = 200, etag = null) => ({ ok: status >= 200 && status < 300, status,
  headers: { get: name => name.toLowerCase() === 'etag' ? etag : null }, json: async () => structuredClone(payload) });

function mockGoogle(context, oauth2) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'google');
  Object.defineProperty(globalThis, 'google', { configurable: true, writable: true, value: { accounts: { oauth2 } } });
  context.after(() => descriptor ? Object.defineProperty(globalThis, 'google', descriptor) : delete globalThis.google);
}

function mockDrive(initialFiles = []) {
  const files = new Map(initialFiles.map(file => [file.metadata.id, structuredClone(file)]));
  const requests = [];
  let nextId = 1;
  const folder = { id: 'folder', name: 'KeepVocab Dictionary Backup' };
  const drive = { files, requests, async fetch(url, options = {}) {
    const parsed = new URL(url);
    requests.push({ url: parsed, options });
    if (parsed.pathname === '/drive/v3/files') return response({ files: parsed.searchParams.get('q').includes("value='folder'") ? [folder] : [...files.values()].map(file => file.metadata) });
    const fileId = decodeURIComponent(parsed.pathname.split('/').pop());
    if (parsed.searchParams.get('alt') === 'media') return response(files.get(fileId).payload, 200, drive.omitEtags ? null : `"${files.get(fileId).revision || 1}"`);
    if (options.method === 'PATCH') {
      await drive.beforePatch?.(fileId);
      const file = files.get(fileId);
      if (options.headers['If-Match'] && options.headers['If-Match'] !== `"${file.revision || 1}"`) return response({ error: { message: 'Precondition failed' } }, 412);
      file.payload = JSON.parse(options.body);
      file.revision = (file.revision || 1) + 1;
      return response(file.metadata);
    }
    if (options.method === 'POST' && parsed.pathname === '/upload/drive/v3/files') {
      const boundary = options.headers['Content-Type'].match(/boundary=([^;]+)/)[1];
      const pattern = new RegExp(`Content-Type: application/json(?:; charset=UTF-8)?\\r\\n\\r\\n([\\s\\S]*?)(?=\\r\\n--${boundary})`, 'g');
      const [metadata, payload] = [...options.body.matchAll(pattern)].map(match => JSON.parse(match[1]));
      const id = `created-${nextId++}`;
      files.set(id, { metadata: { id, ...metadata }, payload });
      return response(files.get(id).metadata);
    }
    throw new Error(`Unexpected mock request: ${url}`);
  } };
  return drive;
}

function scheduler(service) {
  const source = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const background = source.slice(source.indexOf('let driveChangeRevision ='), source.indexOf('function waitForGoogleIdentity'));
  const timers = [];
  const listeners = new Map();
  const sandbox = vm.createContext({ driveSync: service, Date, backgroundSyncDelay, shouldPullFromDrive, DRIVE_SYNC_MIN_INTERVAL_MS,
    automaticSyncTimer: null,
    navigator: { onLine: true }, console: { warn() {} },
    document: { getElementById: () => ({ style: {} }) },
    updateDashboardDerivedState() {}, queueSmartReminderRefresh() {}, renderConnectionState() {},
    window: { addEventListener: (name, callback) => listeners.set(name, callback),
      setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; }, setInterval() {}, clearTimeout() {} }
  });
  vm.runInContext(background, sandbox);
  vm.runInContext('setupAutomaticDriveBackup()', sandbox);
  return { timers, changed: () => listeners.get('keepvocab:data-changed')(),
    pull: () => vm.runInContext('pullRemoteProgress({ resumed: true })', sandbox),
    pending: () => vm.runInContext('hasPendingDriveChanges()', sandbox) };
}

test('an open app backs up vocabulary after its token expires, without interactive authorization', async context => {
  let now = Date.now();
  context.mock.method(Date, 'now', () => now);
  const drive = mockDrive();
  const service = new DriveSyncService(new MemoryStorage(), drive.fetch);
  service.setDriveStatus({ isConnected: true, remembered: true });
  service.acceptGoogleToken({ access_token: 'initial-token', expires_in: 61 });
  const prompts = [];
  mockGoogle(context, { initTokenClient(config) {
    return { requestAccessToken({ prompt }) { prompts.push(prompt); config.callback({ access_token: 'renewed-token', expires_in: 3600 }); } };
  } });
  const app = scheduler(service);
  now += 2_000;
  assert.equal(service.getDriveStatus().isConnected, false);
  service.addWord({ word: 'recover', partOfSpeech: 'verb', definition: 'To return to a normal state.' });
  app.changed();
  assert.equal(app.timers.length, 1);
  await app.timers[0].callback();
  assert.deepEqual(prompts, ['none']);
  assert.equal(service.getDriveStatus().isConnected, true);
  assert.equal(app.pending(), false);
  assert.ok([...drive.files.values()].some(file => file.payload.words?.some(word => word.word === 'recover')));
  assert.ok(drive.requests.every(request => request.options.headers.Authorization === 'Bearer renewed-token'));
  now += 3_600_000;
  app.pull();
  // Remote-only refresh also reaches renewal after an otherwise idle token expiry.
  await service.syncPromise;
  assert.deepEqual(prompts, ['none', 'none']);
});

test('failed background renewal is throttled and disconnect cancels pending renewal work', async context => {
  let now = Date.now();
  context.mock.method(Date, 'now', () => now);
  const service = new DriveSyncService(new MemoryStorage(), () => assert.fail('No Drive fetch before authorization'));
  service.setDriveStatus({ isConnected: false, remembered: true });
  const prompts = [];
  mockGoogle(context, { initTokenClient(config) {
    return { requestAccessToken({ prompt }) { prompts.push(prompt); config.callback({ error: 'interaction_required' }); } };
  } });
  const app = scheduler(service);
  app.changed();
  await app.timers[0].callback();
  assert.deepEqual(prompts, ['none']);
  assert.equal(app.pending(), true);
  assert.equal(app.timers[1].delay, DRIVE_SYNC_MIN_INTERVAL_MS);
  service.disconnectGoogleDrive(false);
  now += DRIVE_SYNC_MIN_INTERVAL_MS;
  await app.timers[1].callback();
  assert.deepEqual(prompts, ['none']);
});

test('Drive listing follows continuation tokens through more than 1,000 files and empty pages', async () => {
  const requests = [];
  const first = Array.from({ length: 1000 }, (_, index) => ({ id: `file-${index}` }));
  const last = Array.from({ length: 5 }, (_, index) => ({ id: `file-${1000 + index}` }));
  const service = new DriveSyncService(new MemoryStorage(), async url => {
    const parsed = new URL(url);
    requests.push(parsed);
    const token = parsed.searchParams.get('pageToken');
    return response(!token ? { files: first, nextPageToken: 'empty page/+' }
      : token === 'empty page/+' ? { files: [], nextPageToken: 'final page' } : { files: last });
  });
  service.acceptGoogleToken({ access_token: 'live-token', expires_in: 3600 });
  assert.deepEqual(await service.listFiles("trashed=false and 'folder' in parents"), [...first, ...last]);
  assert.deepEqual(requests.map(url => url.searchParams.get('pageToken')), [null, 'empty page/+', 'final page']);
  assert.ok(requests.every(url => url.searchParams.get('q') === "trashed=false and 'folder' in parents"
    && url.searchParams.get('fields').includes('nextPageToken') && url.searchParams.get('pageSize') === '1000'));
});

test('legacy credential backups never replace or import a device key', () => {
  const local = new MemoryStorage();
  saveGeminiSettings({ apiKey: 'AIza-local-device-key-123456789' }, local, { silent: true });
  saveImageProviderSettings({ provider: 'openverse', pexelsApiKey: 'local-pexels-key' }, local, { silent: true });
  const gemini = { apiKey: 'AIza-old-remote-key-123456789', textModel: 'remote-model' };
  const pexels = { pexelsApiKey: 'remote-pexels-key', provider: 'pexels' };
  restoreGeminiBackupRecord(gemini, local);
  restoreImageProviderBackupRecord(pexels, local);
  assert.equal(getGeminiSettings(local).apiKey, 'AIza-local-device-key-123456789');
  assert.equal(getImageProviderSettings(local).pexelsApiKey, 'local-pexels-key');
  assert.equal(getGeminiSettings(local).textModel, 'remote-model');
  const fresh = new MemoryStorage();
  restoreGeminiBackupRecord(gemini, fresh);
  restoreImageProviderBackupRecord(pexels, fresh);
  assert.equal(getGeminiSettings(fresh).apiKey, '');
  assert.equal(getImageProviderSettings(fresh).pexelsApiKey, '');
});

test('sync removes credentials from every legacy backup copy and outbound metadata while keeping device keys', async () => {
  const drive = mockDrive();
  const storage = new MemoryStorage();
  saveGeminiSettings({ apiKey: 'AIza-local-device-key-123456789' }, storage, { silent: true });
  saveImageProviderSettings({ provider: 'openverse', pexelsApiKey: 'local-pexels-key' }, storage, { silent: true });
  const service = new DriveSyncService(storage, drive.fetch);
  service.acceptGoogleToken({ access_token: 'live-token', expires_in: 3600 });
  const word = service.addWord({ word: 'private', definition: 'Belonging to a particular person.', partOfSpeech: 'adjective',
    providerMetadata: { apiKey: 'word-secret', token: 'legitimate-token-field' } });
  assert.equal(service.getWords().find(record => record.id === word.id).providerMetadata.apiKey, 'word-secret');
  service.updateSettings({ nestedProvider: { apiKey: 'settings-secret', secret: 'legitimate-secret-field' } }, { silent: true });
  for (const [index, modifiedTime] of ['2026-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z'].entries()) {
    const id = `legacy-settings-${index}`;
    drive.files.set(id, { metadata: { id, modifiedTime, appProperties: { kind: 'settings' } }, payload: {
      schemaVersion: 2, settings: { ...service.getSettings(), nestedProvider: { refreshToken: 'legacy-refresh-secret', token: 'ordinary-token', secret: 'legitimate-secret-field' } },
      googleAiStudio: { apiKey: 'legacy-gemini-secret', textModel: `remote-model-${index}`, updatedAt: modifiedTime },
      imageSearchProvider: { provider: 'pexels', pexelsApiKey: 'legacy-pexels-secret', updatedAt: modifiedTime }
    } });
  }
  drive.files.set('legacy-month', { metadata: { id: 'legacy-month', appProperties: { kind: 'month', monthYear: word.monthYear } },
    payload: { schemaVersion: 2, monthYear: word.monthYear, words: [{ ...word, updatedAt: '2000-01-01T00:00:00.000Z', providerMetadata: { apiKey: 'legacy-word-secret', token: 'ordinary-token' } }], tombstones: [] } });
  await service.syncGoogleDrive();
  assert.equal(getGeminiSettings(storage).apiKey, 'AIza-local-device-key-123456789');
  assert.equal(getImageProviderSettings(storage).pexelsApiKey, 'local-pexels-key');
  assert.equal(getGeminiSettings(storage).textModel, 'remote-model-1');
  assert.equal(getImageProviderSettings(storage).provider, 'pexels');
  const uploaded = JSON.stringify([...drive.files.values()]);
  for (const secret of ['AIza-local-device-key-123456789', 'local-pexels-key', 'word-secret', 'settings-secret', 'legacy-refresh-secret', 'legacy-gemini-secret', 'legacy-pexels-secret', 'legacy-word-secret']) assert.equal(uploaded.includes(secret), false, secret);
  assert.ok(uploaded.includes('ordinary-token'));
  assert.ok(uploaded.includes('legitimate-token-field'));
  assert.ok(uploaded.includes('legitimate-secret-field'));
  for (const id of ['legacy-settings-0', 'legacy-settings-1', 'legacy-month']) assert.ok(drive.requests.some(request => request.url.pathname.endsWith(`/${id}`) && request.options.method === 'PATCH'));
  const restoredStorage = new MemoryStorage();
  const restored = new DriveSyncService(restoredStorage, drive.fetch);
  restored.acceptGoogleToken({ access_token: 'live-token', expires_in: 3600 });
  await restored.syncGoogleDrive();
  assert.equal(getGeminiSettings(restoredStorage).apiKey, '');
  assert.equal(getImageProviderSettings(restoredStorage).pexelsApiKey, '');
});

for (const fileId of ['primary-settings', 'duplicate-settings']) test(`legacy ${fileId} cleanup preserves a concurrent remote edit`, async () => {
  const drive = mockDrive(['primary-settings', 'duplicate-settings'].map((id, index) => ({
    metadata: { id, modifiedTime: `2026-11-${12 - index}T00:00:00.000Z`, appProperties: { kind: 'settings' } },
    payload: { schemaVersion: 2, settings: { dailyGoal: 20 }, googleAiStudio: { apiKey: 'legacy-secret' } }
  })));
  const service = new DriveSyncService(new MemoryStorage(), drive.fetch);
  service.acceptGoogleToken({ access_token: 'live-token', expires_in: 3600 });
  drive.beforePatch = async id => {
    if (id !== fileId) return;
    const latest = drive.files.get(id);
    latest.revision = 2;
    latest.payload.settings.dailyGoal = 99;
    drive.beforePatch = null;
  };
  await service.syncGoogleDrive();
  assert.equal(drive.files.get(fileId).payload.settings.dailyGoal, 99);
  assert.equal(drive.files.get(fileId).payload.googleAiStudio.apiKey, 'legacy-secret');
  const attempted = drive.requests.find(request => request.url.pathname.endsWith(`/${fileId}`) && request.options.method === 'PATCH');
  assert.equal(attempted.options.headers['If-Match'], '"1"');
  await service.syncGoogleDrive();
  assert.equal(drive.files.get(fileId).payload.googleAiStudio.apiKey, undefined);
});

test('legacy cleanup skips writes when the response does not expose an ETag', async () => {
  const drive = mockDrive();
  const service = new DriveSyncService(new MemoryStorage(), drive.fetch);
  service.acceptGoogleToken({ access_token: 'live-token', expires_in: 3600 });
  await service.syncGoogleDrive();
  const legacy = [...drive.files.values()].find(file => file.metadata.appProperties.kind === 'settings');
  legacy.payload.googleAiStudio = { apiKey: 'legacy-secret' };
  drive.omitEtags = true;
  const previousRequests = drive.requests.length;
  await service.syncGoogleDrive();
  assert.equal(legacy.payload.googleAiStudio.apiKey, 'legacy-secret');
  assert.equal(drive.requests.slice(previousRequests).some(request => request.options.method === 'PATCH'), false);
  assert.equal(getGeminiSettings(service.storage).apiKey, '');
});

test('ordinary preference synchronization continues when an ETag is unavailable', async () => {
  const drive = mockDrive();
  drive.omitEtags = true;
  const service = new DriveSyncService(new MemoryStorage(), drive.fetch);
  drive.files.set('legacy', { metadata: { id: 'legacy', appProperties: { kind: 'settings' } },
    payload: { schemaVersion: 2, settings: { ...service.getSettings(), updatedAt: '2000-01-01T00:00:00.000Z' }, googleAiStudio: { apiKey: 'legacy-secret' } } });
  service.updateSettings({ dailyGoal: 35 }, { silent: true });
  service.acceptGoogleToken({ access_token: 'live-token', expires_in: 3600 });
  await service.syncGoogleDrive();
  assert.equal(drive.files.get('legacy').payload.settings.dailyGoal, 35);
  assert.equal(drive.files.get('legacy').payload.googleAiStudio.apiKey, undefined);
});

test('credential cleanup never rewrites another device review or image history shard', async () => {
  const drive = mockDrive([
    { metadata: { id: 'foreign-reviews', appProperties: { kind: 'reviews', deviceId: 'other-device' } },
      payload: { schemaVersion: 2, events: [], apiKey: 'unexpected-legacy-secret' } },
    { metadata: { id: 'foreign-images', appProperties: { kind: 'image-feedback-v2', deviceId: 'other-device', part: '000000' } },
      payload: { formatVersion: 2, records: [], apiKey: 'unexpected-legacy-secret' } }
  ]);
  const service = new DriveSyncService(new MemoryStorage(), drive.fetch);
  service.acceptGoogleToken({ access_token: 'live-token', expires_in: 3600 });
  await service.syncGoogleDrive();
  assert.equal(drive.requests.some(request => request.options.method === 'PATCH'
    && ['foreign-reviews', 'foreign-images'].includes(request.url.pathname.split('/').pop())), false);
});

test('disconnect during silent resume rejects a late token without restoring remembered authorization', async context => {
  const service = new DriveSyncService(new MemoryStorage(), () => assert.fail('Cancelled resume must not fetch Drive'));
  service.setDriveStatus({ isConnected: false, remembered: true });
  let complete;
  mockGoogle(context, { initTokenClient(config) { return { requestAccessToken() { complete = config.callback; } }; } });
  const pending = service.resumeGoogleDrive();
  const rejected = assert.rejects(pending, { code: 'DRIVE_AUTH_CANCELLED' });
  service.disconnectGoogleDrive(false);
  complete({ access_token: 'late-token', expires_in: 3600 });
  await rejected;
  assert.equal(service.getDriveStatus().isConnected, false);
  assert.equal(service.getDriveStatus().remembered, false);
  assert.equal(service.accessToken, null);
  assert.equal(service.storage.getItem('keepvocab_drive_token'), null);
});

test('disconnect during a 401 renewal prevents the retry and leaves Drive disconnected', async context => {
  let fetched = 0;
  let complete;
  let signalRequested;
  const requested = new Promise(resolve => { signalRequested = resolve; });
  const service = new DriveSyncService(new MemoryStorage(), async () => {
    fetched += 1;
    return response({ error: { message: 'Expired token' } }, 401);
  });
  service.setDriveStatus({ isConnected: true, remembered: true });
  service.acceptGoogleToken({ access_token: 'rejected-token', expires_in: 3600 });
  mockGoogle(context, { initTokenClient(config) { return { requestAccessToken() { complete = config.callback; signalRequested(); } }; } });
  const pending = service.authorizedFetch('https://www.googleapis.com/drive/v3/files');
  const rejected = assert.rejects(pending, { code: 'DRIVE_AUTH_CANCELLED' });
  await requested;
  service.disconnectGoogleDrive(false);
  complete({ access_token: 'late-token', expires_in: 3600 });
  await rejected;
  assert.equal(fetched, 1);
  assert.equal(service.getDriveStatus().isConnected, false);
  assert.equal(service.getDriveStatus().remembered, false);
});

test('a new explicit connection completes while an invalidated renewal is still pending', async context => {
  const drive = mockDrive();
  const service = new DriveSyncService(new MemoryStorage(), drive.fetch);
  service.setDriveStatus({ isConnected: false, remembered: true });
  const requests = [];
  mockGoogle(context, { initTokenClient(config) { return { requestAccessToken({ prompt }) { requests.push({ prompt, complete: config.callback }); } }; } });
  const stale = service.renewGoogleToken({ interactive: false });
  const staleRejected = assert.rejects(stale, { code: 'DRIVE_AUTH_CANCELLED' });
  service.disconnectGoogleDrive(false);
  const connected = service.connectGoogleDrive();
  assert.deepEqual(requests.map(request => request.prompt), ['none', 'consent']);
  requests[1].complete({ access_token: 'new-connection-token', expires_in: 3600 });
  await connected;
  requests[0].complete({ access_token: 'late-stale-token', expires_in: 3600 });
  await staleRejected;
  assert.equal(service.accessToken, 'new-connection-token');
  assert.equal(service.getDriveStatus().isConnected, true);
  assert.equal(service.getDriveStatus().remembered, true);
  assert.ok(drive.requests.every(request => request.options.headers.Authorization === 'Bearer new-connection-token'));
});

test('disconnect before sync finishes cannot restore connected status', async () => {
  const drive = mockDrive();
  const service = new DriveSyncService(new MemoryStorage(), drive.fetch);
  service.setDriveStatus({ isConnected: true, remembered: true });
  service.acceptGoogleToken({ access_token: 'live-token', expires_in: 3600 });
  const create = service.createJsonFile.bind(service);
  service.createJsonFile = async (...args) => {
    const result = await create(...args);
    if (args[2] === 'settings') service.disconnectGoogleDrive(false);
    return result;
  };
  await assert.rejects(service.syncGoogleDrive(), { code: 'DRIVE_AUTH_CANCELLED' });
  assert.equal(service.getDriveStatus().isConnected, false);
  assert.equal(service.getDriveStatus().remembered, false);
  assert.equal(service.accessToken, null);
});
