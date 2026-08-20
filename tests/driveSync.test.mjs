import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DriveSyncService,
  GOOGLE_WEB_CLIENT_ID,
  MemoryStorage,
  getCurrentMonthNotebookTitle,
  mergeDriveSettings,
  usesNativeGoogleAuthorization
} from '../js/services/driveSync.js';
import { getGeminiSettings, saveGeminiSettings } from '../js/services/geminiSettings.js';
import { getImageProviderSettings, saveImageProviderSettings } from '../js/services/imageSearch.js';

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return structuredClone(payload); }
  };
}

class MockDrive {
  constructor() {
    this.folder = null;
    this.files = new Map();
    this.calls = [];
    this.nextId = 1;
    this.fetch = this.fetch.bind(this);
  }

  parseMultipart(body, contentType) {
    const boundary = contentType.match(/boundary=([^;]+)/)?.[1];
    const pattern = new RegExp(`Content-Type: application/json(?:; charset=UTF-8)?\\r\\n\\r\\n([\\s\\S]*?)(?=\\r\\n--${boundary})`, 'g');
    const parts = [...body.matchAll(pattern)].map(match => JSON.parse(match[1]));
    return { metadata: parts[0], payload: parts[1] };
  }

  async fetch(url, options = {}) {
    this.calls.push({ url: String(url), options });
    const parsed = new URL(url);
    const method = options.method || 'GET';

    if (parsed.hostname === 'www.googleapis.com' && parsed.pathname === '/drive/v3/files' && method === 'GET') {
      const query = parsed.searchParams.get('q') || '';
      if (query.includes("value='folder'")) return response({ files: this.folder ? [this.folder] : [] });
      if (query.includes("value='data'")) return response({ files: [...this.files.values()].map(item => item.metadata) });
      return response({ files: [] });
    }

    if (parsed.pathname === '/drive/v3/files' && method === 'POST') {
      const metadata = JSON.parse(options.body);
      const id = `folder-${this.nextId++}`;
      this.folder = { id, ...metadata, modifiedTime: new Date().toISOString() };
      return response(this.folder);
    }

    if (parsed.hostname === 'www.googleapis.com' && parsed.pathname.startsWith('/drive/v3/files/') && parsed.searchParams.get('alt') === 'media') {
      const id = decodeURIComponent(parsed.pathname.split('/').pop());
      return response(this.files.get(id)?.payload ?? {}, this.files.has(id) ? 200 : 404);
    }

    if (parsed.hostname === 'www.googleapis.com' && parsed.pathname === '/upload/drive/v3/files' && method === 'POST') {
      const { metadata, payload } = this.parseMultipart(options.body, options.headers['Content-Type']);
      const id = `file-${this.nextId++}`;
      const stored = { metadata: { id, ...metadata, modifiedTime: new Date().toISOString() }, payload };
      this.files.set(id, stored);
      return response(stored.metadata);
    }

    if (parsed.hostname === 'www.googleapis.com' && parsed.pathname.startsWith('/upload/drive/v3/files/') && method === 'PATCH') {
      const id = decodeURIComponent(parsed.pathname.split('/').pop());
      const stored = this.files.get(id);
      if (!stored) return response({ error: { message: 'Missing file' } }, 404);
      stored.payload = JSON.parse(options.body);
      stored.metadata.modifiedTime = new Date().toISOString();
      return response(stored.metadata);
    }

    return response({ error: { message: `Unhandled mock request: ${method} ${parsed.pathname}` } }, 500);
  }

  payloadByName(name) {
    return [...this.files.values()].find(item => item.metadata.name === name)?.payload;
  }
}

function authorize(service) {
  service.accessToken = 'test-drive-token';
  service.tokenExpiresAt = Date.now() + 60_000;
}

test('new words always enter the real current month unless a migration target is explicit', () => {
  const service = new DriveSyncService(new MemoryStorage(), async () => { throw new Error('unused'); });
  service.updateSettings({ activeNotebook: 'January 2020 Vocabulary' }, { silent: true });
  const word = service.addWord({ word: 'calendarwise', partOfSpeech: 'adjective', definition: 'Filed by its real creation month.' });

  assert.equal(word.notebook, getCurrentMonthNotebookTitle());
  assert.equal(word.monthYear, getCurrentMonthNotebookTitle().replace(/ Vocabulary$/, ''));
  assert.equal(service.getWordsByMonthYear(word.monthYear).some(item => item.id === word.id), true);
});

test('a fresh install starts with an empty library', () => {
  const service = new DriveSyncService(new MemoryStorage(), async () => { throw new Error('unused'); });
  assert.deepEqual(service.getWords(), []);
  assert.equal(service.getNotebooks().length, 1);
});

test('library preserves separate intended senses and keeps stable identity when edited', () => {
  const service = new DriveSyncService(new MemoryStorage(), async () => { throw new Error('unused'); });
  service.saveWords([], { silent: true });
  const river = service.addWord({ word: 'bank', partOfSpeech: 'noun', definition: 'The land beside a river.' });
  const finance = service.addWord({ word: 'bank', partOfSpeech: 'noun', definition: 'A financial institution.' });
  const stableSenseId = finance.senseId;
  const edited = service.updateWord(finance.id, {
    definition: 'An institution that holds and lends money.',
    imageCustomConcept: 'customer depositing cash at a bank counter'
  });

  assert.equal(service.getWords().length, 2);
  assert.notEqual(river.id, finance.id);
  assert.equal(edited.id, finance.id);
  assert.equal(edited.senseId, stableSenseId);
  assert.equal(service.getWords().find(word => word.id === finance.id).imageCustomConcept, 'customer depositing cash at a bank counter');
  assert.throws(() => service.addWord({ word: 'bank', partOfSpeech: 'noun', definition: 'The land beside a river.' }), /meaning.*already/i);
  assert.throws(() => service.updateWord(river.id, { imageUrl: 'javascript:alert(1)' }), /https:\/\//);
});

test('multiple selected meanings are saved atomically with separate learning identities', () => {
  const service = new DriveSyncService(new MemoryStorage(), async () => { throw new Error('unused'); });
  service.saveWords([], { silent: true });
  const saved = service.addWords([
    { word: 'bank', partOfSpeech: 'noun', definition: 'A financial institution.', example: 'She deposited money at the bank.' },
    { word: 'bank', partOfSpeech: 'noun', definition: 'The land beside a river.', example: 'They rested on the river bank.' }
  ]);

  assert.equal(saved.length, 2);
  assert.equal(service.getWords().filter(item => item.word === 'bank').length, 2);
  assert.equal(service.getMonthlyArchives()[0].wordCount, 1);
  assert.equal(service.getMonthlyArchives()[0].count, 2);
  assert.notEqual(saved[0].id, saved[1].id);
  assert.notEqual(saved[0].senseId, saved[1].senseId);
  assert.throws(() => service.addWords([
    { word: 'bank', partOfSpeech: 'noun', definition: 'A place that holds money.' },
    { word: 'bank', partOfSpeech: 'noun', definition: 'A place that holds money.' }
  ]), /duplicate definition/i);
  assert.equal(service.getWords().length, 2);
});

test('first sync creates one dedicated folder, monthly files, and a settings file', async () => {
  const drive = new MockDrive();
  const service = new DriveSyncService(new MemoryStorage(), drive.fetch);
  service.saveWords([], { silent: true });
  service.addWord({ word: 'bank', partOfSpeech: 'noun', definition: 'The land beside a river.', createdAt: '2026-05-10T10:00:00.000Z' }, 'May 2026 Vocabulary');
  service.addWord({ word: 'yield', partOfSpeech: 'verb', definition: 'To furnish or produce.', createdAt: '2026-07-20T10:00:00.000Z' }, 'July 2026 Vocabulary');
  service.updateSettings({ dailyGoal: 27, learningStats: { sessionsCompleted: 4, speakingMinutes: 18 }, speakingProgress: { completed: ['rent-apartment'], level: 'B2' } }, { silent: true });
  authorize(service);

  const result = await service.syncGoogleDrive();

  assert.equal(drive.folder.name, 'KeepVocab Dictionary Backup');
  assert.equal(drive.folder.mimeType, 'application/vnd.google-apps.folder');
  assert.equal(drive.folder.appProperties.keepVocabBackup, 'folder');
  assert.deepEqual([...drive.files.values()].map(item => item.metadata.name).sort(), [
    'Dictionary July 2026.json',
    'Dictionary May 2026.json',
    'KeepVocab Settings.json'
  ]);
  assert.equal(drive.payloadByName('Dictionary May 2026.json').words[0].definition, 'The land beside a river.');
  assert.equal(drive.payloadByName('Dictionary July 2026.json').monthYear, 'July 2026');
  assert.equal(drive.payloadByName('KeepVocab Settings.json').settings.dailyGoal, 27);
  assert.equal(drive.payloadByName('KeepVocab Settings.json').settings.learningStats.sessionsCompleted, 4);
  assert.deepEqual(drive.payloadByName('KeepVocab Settings.json').settings.speakingProgress.completed, ['rent-apartment']);
  assert.equal(result.months, 2);
  assert.equal(result.createdFiles, 3);
  assert.ok(drive.calls.some(call => new URL(call.url).searchParams.get('q')?.includes("appProperties has { key='keepVocabBackup' and value='folder' }")));
  assert.ok(drive.calls.some(call => new URL(call.url).searchParams.get('q')?.includes("appProperties has { key='keepVocabBackup' and value='data' }")));
});

test('fresh reinstall restores exact meanings, original months, settings, and progress', async () => {
  const drive = new MockDrive();
  const original = new DriveSyncService(new MemoryStorage(), drive.fetch);
  original.saveWords([], { silent: true });
  const intended = original.addWord({
    word: 'run',
    partOfSpeech: 'noun',
    definition: 'An act or spell of running, not the verb meaning.',
    example: 'She went for a run.',
    createdAt: '2026-05-03T09:00:00.000Z',
    box: 4,
    nextReviewDate: '2026-08-01T00:00:00.000Z'
  }, 'May 2026 Vocabulary');
  original.addWord({ word: 'inflict', partOfSpeech: 'verb', definition: 'To cause something unpleasant to be suffered.', createdAt: '2026-07-02T09:00:00.000Z' }, 'July 2026 Vocabulary');
  original.updateSettings({ dailyGoal: 31, activeNotebook: 'May 2026 Vocabulary', learningStats: { sessionsCompleted: 7, weakWordsImproved: 3 }, speakingProgress: { completed: ['rent-apartment', 'present-idea'], level: 'B2' } }, { silent: true });
  authorize(original);
  await original.syncGoogleDrive();

  const reinstalled = new DriveSyncService(new MemoryStorage(), drive.fetch);
  authorize(reinstalled);
  const result = await reinstalled.syncGoogleDrive();
  const restored = reinstalled.getWords().find(word => word.id === intended.id);

  assert.equal(result.totalWords, 2);
  assert.equal(reinstalled.getWords().some(word => word.source === 'sample'), false);
  assert.equal(restored.word, 'run');
  assert.equal(restored.partOfSpeech, 'noun');
  assert.equal(restored.definition, 'An act or spell of running, not the verb meaning.');
  assert.equal(restored.example, 'She went for a run.');
  assert.equal(restored.monthYear, 'May 2026');
  assert.equal(restored.notebook, 'May 2026 Vocabulary');
  assert.equal(restored.box, 4);
  assert.equal(restored.nextReviewDate, '2026-08-01T00:00:00.000Z');
  assert.equal(reinstalled.getSettings().dailyGoal, 31);
  assert.equal(reinstalled.getSettings().learningStats.sessionsCompleted, 7);
  assert.deepEqual(reinstalled.getSettings().speakingProgress.completed, ['rent-apartment', 'present-idea']);
  assert.deepEqual(reinstalled.getMonthlyArchives().map(archive => archive.monthYear), ['July 2026', 'May 2026']);
});

test('Drive combines exercise activity from multiple devices without double counting repeated syncs', async () => {
  const drive = new MockDrive();
  const day = new Date(2026, 7, 21, 12);
  const firstStorage = new MemoryStorage();
  firstStorage.setItem('keepvocab_device_id', 'device-a');
  const first = new DriveSyncService(firstStorage, drive.fetch);
  first.recordReview(day);
  first.recordReview(day);
  authorize(first);
  await first.syncGoogleDrive();

  const secondStorage = new MemoryStorage();
  secondStorage.setItem('keepvocab_device_id', 'device-b');
  const second = new DriveSyncService(secondStorage, drive.fetch);
  authorize(second);
  await second.syncGoogleDrive();
  second.recordReview(day);
  second.recordReview(day);
  second.recordReview(day);
  await second.syncGoogleDrive();
  await first.syncGoogleDrive();
  await second.syncGoogleDrive();

  for (const service of [first, second]) {
    const settings = service.getSettings();
    assert.equal(settings.reviewActivity['2026-08-21'], 5);
    assert.equal(settings.reviewsDate, '2026-08-21');
    assert.equal(settings.reviewsToday, 5);
    assert.equal(settings.exerciseActivityByDevice['device-a']['2026-08-21'], 2);
    assert.equal(settings.exerciseActivityByDevice['device-b']['2026-08-21'], 3);
  }
  assert.equal(drive.payloadByName('KeepVocab Settings.json').settings.reviewActivity['2026-08-21'], 5);
});

test('legacy review activity migrates into the mergeable Drive activity format', () => {
  const merged = mergeDriveSettings(
    { reviewActivity: { '2026-08-20': 2 }, updatedAt: '2026-08-20T20:00:00.000Z' },
    { reviewActivity: { '2026-08-20': 3, '2026-08-19': 1 }, updatedAt: '2026-08-20T21:00:00.000Z' }
  );

  assert.deepEqual(merged.exerciseActivityByDevice.legacy, { '2026-08-20': 3, '2026-08-19': 1 });
  assert.deepEqual(merged.reviewActivity, { '2026-08-20': 3, '2026-08-19': 1 });
  assert.equal(merged.dailyStreak, 2);
});

test('Google Drive backs up and restores the centralized Google AI Studio key', async () => {
  const drive = new MockDrive();
  const originalStorage = new MemoryStorage();
  saveGeminiSettings({ apiKey: 'AIza-drive-backed-key-123456789', textModel: 'gemini-3.1-flash-lite' }, originalStorage, { silent: true });
  const original = new DriveSyncService(originalStorage, drive.fetch);
  original.saveWords([], { silent: true });
  original.addWord({ word: 'restore', partOfSpeech: 'verb', definition: 'To bring back.' }, 'July 2026 Vocabulary');
  authorize(original);
  await original.syncGoogleDrive();

  const payload = drive.payloadByName('KeepVocab Settings.json');
  assert.equal(payload.googleAiStudio.apiKey, 'AIza-drive-backed-key-123456789');
  assert.equal(payload.googleAiStudio.textModel, 'gemini-3.1-flash-lite');

  const reinstalledStorage = new MemoryStorage();
  const reinstalled = new DriveSyncService(reinstalledStorage, drive.fetch);
  authorize(reinstalled);
  await reinstalled.syncGoogleDrive();
  assert.equal(getGeminiSettings(reinstalledStorage).apiKey, 'AIza-drive-backed-key-123456789');
});

test('Google Drive backs up and restores the Pexels provider and API key', async () => {
  const drive = new MockDrive();
  const originalStorage = new MemoryStorage();
  saveImageProviderSettings({
    provider: 'pexels',
    pexelsApiKey: 'pexels-drive-backed-key-123456789',
    updatedAt: '2026-08-21T10:00:00.000Z'
  }, originalStorage, { silent: true });
  const original = new DriveSyncService(originalStorage, drive.fetch);
  original.saveWords([], { silent: true });
  original.addWord({ word: 'restore', partOfSpeech: 'verb', definition: 'To bring back.' }, 'July 2026 Vocabulary');
  authorize(original);
  await original.syncGoogleDrive();

  const payload = drive.payloadByName('KeepVocab Settings.json');
  assert.equal(payload.imageSearchProvider.provider, 'pexels');
  assert.equal(payload.imageSearchProvider.pexelsApiKey, 'pexels-drive-backed-key-123456789');

  const reinstalledStorage = new MemoryStorage();
  const reinstalled = new DriveSyncService(reinstalledStorage, drive.fetch);
  authorize(reinstalled);
  await reinstalled.syncGoogleDrive();
  assert.equal(getImageProviderSettings(reinstalledStorage).provider, 'pexels');
  assert.equal(getImageProviderSettings(reinstalledStorage).pexelsApiKey, 'pexels-drive-backed-key-123456789');
});

test('an older Drive backup without AI settings does not erase a local key', async () => {
  const drive = new MockDrive();
  const older = new DriveSyncService(new MemoryStorage(), drive.fetch);
  older.saveWords([], { silent: true });
  older.addWord({ word: 'legacy', partOfSpeech: 'noun', definition: 'Something inherited from the past.' }, 'July 2026 Vocabulary');
  authorize(older);
  await older.syncGoogleDrive();
  assert.equal(drive.payloadByName('KeepVocab Settings.json').googleAiStudio, undefined);

  const currentStorage = new MemoryStorage();
  saveGeminiSettings({ apiKey: 'AIza-local-key-survives-123456789' }, currentStorage, { silent: true });
  const current = new DriveSyncService(currentStorage, drive.fetch);
  authorize(current);
  await current.syncGoogleDrive();
  assert.equal(getGeminiSettings(currentStorage).apiKey, 'AIza-local-key-survives-123456789');
  assert.equal(drive.payloadByName('KeepVocab Settings.json').googleAiStudio.apiKey, 'AIza-local-key-survives-123456789');
});

test('deletion tombstones prevent a removed word from returning after reinstall', async () => {
  const drive = new MockDrive();
  const first = new DriveSyncService(new MemoryStorage(), drive.fetch);
  first.saveWords([], { silent: true });
  const keep = first.addWord({ word: 'retain', partOfSpeech: 'verb', definition: 'To keep.' }, 'July 2026 Vocabulary');
  const remove = first.addWord({ word: 'discard', partOfSpeech: 'verb', definition: 'To throw away.' }, 'July 2026 Vocabulary');
  authorize(first);
  await first.syncGoogleDrive();
  assert.equal(first.deleteWord(remove.id), true);
  await first.syncGoogleDrive();

  const payload = drive.payloadByName('Dictionary July 2026.json');
  assert.equal(payload.words.some(word => word.id === remove.id), false);
  assert.equal(payload.tombstones.some(item => item.id === remove.id), true);

  const reinstalled = new DriveSyncService(new MemoryStorage(), drive.fetch);
  authorize(reinstalled);
  await reinstalled.syncGoogleDrive();
  assert.deepEqual(reinstalled.getWords().map(word => word.id), [keep.id]);
});

test('newer local edits update the same Drive record instead of duplicating a sense', async () => {
  const drive = new MockDrive();
  const service = new DriveSyncService(new MemoryStorage(), drive.fetch);
  service.saveWords([], { silent: true });
  const word = service.addWord({ word: 'yield', partOfSpeech: 'verb', definition: 'Old intended definition.' }, 'July 2026 Vocabulary');
  authorize(service);
  await service.syncGoogleDrive();
  const beforeId = drive.payloadByName('Dictionary July 2026.json').words[0].id;

  await new Promise(resolve => setTimeout(resolve, 5));
  service.updateWord(word.id, { definition: 'To furnish, afford, or produce.' });
  const result = await service.syncGoogleDrive();
  const payload = drive.payloadByName('Dictionary July 2026.json');

  assert.equal(result.updatedFiles, 1);
  assert.equal(payload.words.length, 1);
  assert.equal(payload.words[0].id, beforeId);
  assert.equal(payload.words[0].definition, 'To furnish, afford, or produce.');
});

test('Drive API errors are explicit and never reported as successful backup', async () => {
  const service = new DriveSyncService(new MemoryStorage(), async () => response({ error: { message: 'Permission missing' } }, 403));
  authorize(service);
  await assert.rejects(() => service.syncGoogleDrive(), /Drive access was denied.*Permission missing/);
});

test('a remembered Drive connection silently renews on a later app launch', async () => {
  const drive = new MockDrive();
  const storage = new MemoryStorage();
  const service = new DriveSyncService(storage, async (url, options) => {
    if (String(url).includes('/oauth2/v3/userinfo')) return response({ email: 'learner@example.com' });
    return drive.fetch(url, options);
  });
  service.setDriveStatus({ isConnected: false, remembered: true, email: 'learner@example.com' });
  let requestedPrompt = null;
  let requestedScope = null;
  let requestedClientId = null;
  const previousGoogle = globalThis.google;
  globalThis.google = { accounts: { oauth2: {
    initTokenClient(config) {
      requestedScope = config.scope;
      requestedClientId = config.client_id;
      return { requestAccessToken({ prompt }) { requestedPrompt = prompt; config.callback({ access_token: 'renewed-token', expires_in: 3600 }); } };
    },
    revoke(_token, callback) { callback(); }
  } } };

  try {
    const result = await service.resumeGoogleDrive();
    assert.equal(requestedPrompt, '');
    assert.equal(requestedClientId, GOOGLE_WEB_CLIENT_ID);
    assert.match(requestedScope, /auth\/drive\.file/);
    assert.equal(result.folderName, 'KeepVocab Dictionary Backup');
    assert.equal(service.getDriveStatus().isConnected, true);
    assert.equal(service.getDriveStatus().remembered, true);
    service.disconnectGoogleDrive();
    assert.equal(service.getDriveStatus().remembered, false);
  } finally {
    globalThis.google = previousGoogle;
  }
});

test('the Android app authorizes Drive through the native account chooser without requesting a web client ID', async () => {
  const drive = new MockDrive();
  const storage = new MemoryStorage();
  const service = new DriveSyncService(storage, async (url, options) => {
    if (String(url).includes('/oauth2/v3/userinfo')) return response({ email: 'android@example.com' });
    return drive.fetch(url, options);
  });
  const previousCapacitor = globalThis.Capacitor;
  const calls = [];
  const plugin = {
    async authorize(options) {
      calls.push(options);
      return { accessToken: 'native-android-token', expiresIn: 3600 };
    },
    async revoke() {}
  };
  globalThis.Capacitor = {
    getPlatform: () => 'android',
    Plugins: { DriveAuth: plugin }
  };

  try {
    assert.equal(usesNativeGoogleAuthorization(), true);
    const result = await service.connectGoogleDrive();
    assert.deepEqual(calls, [{ interactive: true }]);
    assert.equal(result.folderName, 'KeepVocab Dictionary Backup');
    assert.equal(service.getGoogleClientId(), GOOGLE_WEB_CLIENT_ID);
    assert.equal(service.getDriveStatus().isConnected, true);
    assert.equal(service.accessToken, 'native-android-token');
  } finally {
    globalThis.Capacitor = previousCapacitor;
  }
});

test('a valid Drive token survives a page reload and remains connected', () => {
  const storage = new MemoryStorage();
  const firstPage = new DriveSyncService(storage, async () => { throw new Error('unused'); });
  firstPage.setDriveStatus({ isConnected: true, remembered: true, email: 'learner@example.com' });
  firstPage.acceptGoogleToken({ access_token: 'saved-short-lived-token', expires_in: 3600 });

  const reloadedPage = new DriveSyncService(storage, async () => { throw new Error('unused'); });

  assert.equal(reloadedPage.accessToken, 'saved-short-lived-token');
  assert.ok(reloadedPage.tokenExpiresAt > Date.now());
  assert.equal(reloadedPage.getDriveStatus().isConnected, true);
  assert.equal(reloadedPage.getDriveStatus().email, 'learner@example.com');
});

test('an expired Drive token is silently renewed before the next API request', async () => {
  const storage = new MemoryStorage();
  const authorizationHeaders = [];
  const service = new DriveSyncService(storage, async (_url, options) => {
    authorizationHeaders.push(options.headers.Authorization);
    return response({ ok: true });
  });
  service.setDriveStatus({ isConnected: true, remembered: true, email: 'learner@example.com' });
  service.accessToken = 'expired-token';
  service.tokenExpiresAt = Date.now() - 1;
  const previousCapacitor = globalThis.Capacitor;
  const calls = [];
  globalThis.Capacitor = {
    getPlatform: () => 'android',
    Plugins: { DriveAuth: {
      async authorize(options) {
        calls.push(options);
        return { accessToken: 'renewed-token', expiresIn: 3600 };
      }
    } }
  };

  try {
    await service.authorizedFetch('https://www.googleapis.com/drive/v3/files');
    assert.deepEqual(calls, [{ interactive: false }]);
    assert.deepEqual(authorizationHeaders, ['Bearer renewed-token']);
    assert.equal(service.getDriveStatus().isConnected, true);
    assert.equal(service.getDriveStatus().lastError, null);
  } finally {
    globalThis.Capacitor = previousCapacitor;
  }
});

test('a rejected Drive token is silently renewed and the request is retried once', async () => {
  const storage = new MemoryStorage();
  const authorizationHeaders = [];
  const service = new DriveSyncService(storage, async (_url, options) => {
    authorizationHeaders.push(options.headers.Authorization);
    return authorizationHeaders.length === 1
      ? response({ error: { message: 'Invalid Credentials' } }, 401)
      : response({ files: [] });
  });
  service.setDriveStatus({ isConnected: true, remembered: true, email: 'learner@example.com' });
  service.accessToken = 'rejected-token';
  service.tokenExpiresAt = Date.now() + 60_000;
  const previousCapacitor = globalThis.Capacitor;
  globalThis.Capacitor = {
    getPlatform: () => 'android',
    Plugins: { DriveAuth: {
      async authorize() { return { accessToken: 'replacement-token', expiresIn: 3600 }; }
    } }
  };

  try {
    const result = await service.authorizedFetch('https://www.googleapis.com/drive/v3/files');
    assert.equal(result.status, 200);
    assert.deepEqual(authorizationHeaders, ['Bearer rejected-token', 'Bearer replacement-token']);
    assert.equal(service.getDriveStatus().isConnected, true);
  } finally {
    globalThis.Capacitor = previousCapacitor;
  }
});

test('expired saved Drive tokens are discarded and require renewal', () => {
  const storage = new MemoryStorage();
  storage.setItem('keepvocab_drive_auth', JSON.stringify({ isConnected: true, remembered: true, email: 'learner@example.com' }));
  storage.setItem('keepvocab_drive_token', JSON.stringify({ accessToken: 'expired-token', expiresAt: Date.now() - 1 }));

  const service = new DriveSyncService(storage, async () => { throw new Error('unused'); });

  assert.equal(service.getDriveStatus().isConnected, false);
  assert.equal(service.getDriveStatus().remembered, true);
  assert.equal(storage.getItem('keepvocab_drive_token'), null);
});

test('legacy session-expired banner state is cleared before silent renewal', () => {
  const storage = new MemoryStorage();
  storage.setItem('keepvocab_drive_auth', JSON.stringify({
    isConnected: false,
    remembered: true,
    email: 'learner@example.com',
    lastError: 'Your Google Drive session expired. Renewing access is required.'
  }));

  const service = new DriveSyncService(storage, async () => { throw new Error('unused'); });

  assert.equal(service.getDriveStatus().remembered, true);
  assert.equal(service.getDriveStatus().lastError, null);
});

test('disconnecting removes the saved Drive token from this device', () => {
  const storage = new MemoryStorage();
  const service = new DriveSyncService(storage, async () => { throw new Error('unused'); });
  service.setDriveStatus({ isConnected: true, remembered: true, email: 'learner@example.com' });
  service.acceptGoogleToken({ access_token: 'saved-token', expires_in: 3600 });

  service.disconnectGoogleDrive(false);

  assert.equal(storage.getItem('keepvocab_drive_token'), null);
  assert.equal(service.getDriveStatus().isConnected, false);
  assert.equal(service.getDriveStatus().remembered, false);
});

test('a successful connection from the previous build migrates to remembered state', () => {
  const storage = new MemoryStorage();
  storage.setItem('keepvocab_drive_auth', JSON.stringify({
    isConnected: true,
    email: 'learner@example.com',
    lastSynced: '2026-07-23T00:00:00.000Z',
    folderId: 'folder-1'
  }));
  const service = new DriveSyncService(storage, async () => { throw new Error('unused'); });
  assert.equal(service.getDriveStatus().remembered, true);
});
