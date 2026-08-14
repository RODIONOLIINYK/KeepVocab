// Local-first vocabulary persistence with reinstall-safe Google Drive backup.

const STORAGE_KEY_WORDS = 'keepvocab_words_db';
const STORAGE_KEY_NOTEBOOKS = 'keepvocab_notebooks_db';
const STORAGE_KEY_SETTINGS = 'keepvocab_settings';
const STORAGE_KEY_DRIVE_AUTH = 'keepvocab_drive_auth';
const STORAGE_KEY_DRIVE_TOKEN = 'keepvocab_drive_token';
const STORAGE_KEY_GOOGLE_CLIENT_ID = 'keepvocab_google_client_id';
const STORAGE_KEY_TOMBSTONES = 'keepvocab_drive_tombstones';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const USERINFO_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';
const BACKUP_FOLDER_NAME = 'KeepVocab Dictionary Backup';
const BACKUP_APP_PROPERTY = 'keepVocabBackup';
const SCHEMA_VERSION = 1;
const TOKEN_RESTORE_BUFFER_MS = 30_000;

function getNativeDriveAuthPlugin() {
  const capacitor = globalThis.Capacitor;
  if (capacitor?.getPlatform?.() !== 'android') return null;
  if (capacitor.Plugins?.DriveAuth) return capacitor.Plugins.DriveAuth;
  if (typeof capacitor.registerPlugin === 'function') return capacitor.registerPlugin('DriveAuth');
  return null;
}

export function usesNativeGoogleAuthorization() {
  return Boolean(getNativeDriveAuthPlugin());
}

export function getCurrentMonthNotebookTitle(date = new Date()) {
  const monthName = date.toLocaleString('en-US', { month: 'long' });
  return `${monthName} ${date.getFullYear()} Vocabulary`;
}

function monthYearFromDate(value) {
  const date = value ? new Date(value) : new Date();
  const validDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return validDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function notebookFromMonthYear(monthYear) {
  return `${monthYear} Vocabulary`;
}

function safeJsonParse(raw, fallback) {
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function normalizeWordText(value) {
  return String(value || '').trim().replace(/^[\s\-–—•*☐☑✅📌]+/, '').trim();
}

function normalizeSenseText(value) {
  return String(value || '').trim().toLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function senseIdentity(word) {
  return [word.monthYear, word.word, word.partOfSpeech || 'unknown', normalizeSenseText(word.definition)].join('|').toLowerCase();
}

function makeSenseId(word, partOfSpeech, definition) {
  const slug = `${word}-${partOfSpeech}-${normalizeSenseText(definition)}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90);
  return `sense-${slug || Date.now()}`;
}

function makeWordId(word, monthYear, partOfSpeech = 'unknown', definition = '') {
  const slug = `${monthYear}-${word}-${partOfSpeech}-${normalizeSenseText(definition)}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90);
  return `w-${slug || Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function validIso(value, fallback = new Date().toISOString()) {
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : fallback;
}

function recordTimestamp(record) {
  return Date.parse(record?.updatedAt || record?.lastReviewedAt || record?.createdAt || 0) || 0;
}

function normalizeStoredWord(candidate, fallbackMonthYear = null, fallbackSource = 'drive') {
  const word = normalizeWordText(candidate?.word).toLowerCase();
  if (!word || word.length > 100) return null;
  const createdAt = validIso(candidate.createdAt);
  const monthYear = candidate.monthYear || fallbackMonthYear || monthYearFromDate(createdAt);
  const partOfSpeech = String(candidate.partOfSpeech || 'unknown').trim().toLowerCase();
  const definition = String(candidate.definition || '').trim();
  const id = String(candidate.id || makeWordId(word, monthYear, partOfSpeech, definition));

  return {
    ...candidate,
    id,
    senseId: String(candidate.senseId || makeSenseId(word, partOfSpeech, definition)),
    word,
    phonetic: String(candidate.phonetic || '').trim(),
    partOfSpeech,
    definition: definition || 'Definition not provided.',
    example: String(candidate.example || '').trim(),
    imageCustomConcept: String(candidate.imageCustomConcept || '').trim().slice(0, 160),
    audioUrl: String(candidate.audioUrl || '').trim(),
    imageUrl: String(candidate.imageUrl || '').trim(),
    notebook: notebookFromMonthYear(monthYear),
    monthYear,
    box: Number(candidate.box) >= 1 && Number(candidate.box) <= 5 ? Number(candidate.box) : 1,
    nextReviewDate: validIso(candidate.nextReviewDate, createdAt),
    mastered: Boolean(candidate.mastered),
    createdAt,
    updatedAt: validIso(candidate.updatedAt || candidate.lastReviewedAt, createdAt),
    source: String(candidate.source || fallbackSource)
  };
}

function normalizeTombstone(candidate, fallbackMonthYear = null) {
  const id = String(candidate?.id || '').trim();
  if (!id) return null;
  return {
    id,
    senseId: String(candidate.senseId || ''),
    monthYear: candidate.monthYear || fallbackMonthYear || monthYearFromDate(candidate.deletedAt),
    deletedAt: validIso(candidate.deletedAt)
  };
}

function sortRecords(records) {
  return [...records].sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function dataSignature(words, tombstones) {
  return JSON.stringify({ words: sortRecords(words), tombstones: sortRecords(tombstones) });
}

function seedWords() {
  const seeds = [
    ['serendipity', 'noun', 'The occurrence of events by chance in a happy or beneficial way.', 'A fortunate stroke of serendipity brought them together.', 0],
    ['ephemeral', 'adjective', 'Lasting for a very short time; fleeting or transitory.', 'The beauty of cherry blossoms is ephemeral.', 0],
    ['luminous', 'adjective', 'Emitting or reflecting light; glowing.', 'The luminous dial glowed in the dark.', -1],
    ['eloquent', 'adjective', 'Fluent or persuasive in speaking or writing.', 'Her eloquent speech inspired the audience.', -1],
    ['resilient', 'adjective', 'Able to withstand or recover quickly from difficult conditions.', 'The team proved resilient after early setbacks.', -2],
    ['ubiquitous', 'adjective', 'Present, appearing, or found everywhere.', 'Smartphones have become ubiquitous.', -2]
  ];
  const now = new Date();
  return seeds.map(([word, partOfSpeech, definition, example, monthOffset], index) => {
    const date = new Date(now.getFullYear(), now.getMonth() + monthOffset, Math.max(1, 15 - index));
    return normalizeStoredWord({
      id: `w-seed-${word}`,
      word,
      partOfSpeech,
      definition,
      example,
      box: Math.min(5, index + 1),
      mastered: index >= 4,
      createdAt: date.toISOString()
    }, monthYearFromDate(date), 'sample');
  });
}

export class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

export class DriveSyncService {
  constructor(storage = globalThis.localStorage || new MemoryStorage(), fetchImpl = globalThis.fetch?.bind(globalThis)) {
    this.storage = storage;
    this.fetchImpl = fetchImpl;
    this.accessToken = null;
    this.tokenExpiresAt = 0;
    this.syncPromise = null;
    this.suppressEvents = false;
    this.isFreshInstall = !this.storage.getItem(STORAGE_KEY_WORDS);
    this.initStorage();
    this.restoreGoogleToken();
  }

  read(key, fallback) {
    return safeJsonParse(this.storage.getItem(key), fallback);
  }

  write(key, value) {
    this.storage.setItem(key, JSON.stringify(value));
  }

  emitChange(kind = 'library') {
    if (this.suppressEvents || typeof globalThis.dispatchEvent !== 'function' || typeof globalThis.CustomEvent !== 'function') return;
    globalThis.dispatchEvent(new CustomEvent('keepvocab:data-changed', { detail: { kind } }));
  }

  initStorage() {
    if (!this.storage.getItem(STORAGE_KEY_WORDS)) this.saveWords(seedWords(), { silent: true });
    if (!this.storage.getItem(STORAGE_KEY_TOMBSTONES)) this.write(STORAGE_KEY_TOMBSTONES, []);
    if (!this.storage.getItem(STORAGE_KEY_SETTINGS)) {
      this.write(STORAGE_KEY_SETTINGS, {
        activeNotebook: getCurrentMonthNotebookTitle(),
        dailyGoal: 20,
        dailyStreak: 0,
        lastReviewDate: null,
        reviewsToday: 0,
        reviewsDate: null,
        reviewActivity: {},
        reminderEnabled: false,
        reminderTime: '19:00',
        soundEnabled: true,
        updatedAt: new Date().toISOString()
      });
    }
    if (!this.storage.getItem(STORAGE_KEY_DRIVE_AUTH)) {
      this.write(STORAGE_KEY_DRIVE_AUTH, { isConnected: false, remembered: false, email: null, lastSynced: null, lastError: null, folderId: null });
    } else {
      const storedDrive = this.read(STORAGE_KEY_DRIVE_AUTH, {});
      if (!storedDrive.remembered && storedDrive.isConnected && storedDrive.email && storedDrive.lastSynced) {
        this.write(STORAGE_KEY_DRIVE_AUTH, { ...storedDrive, remembered: true });
      }
    }
    this.refreshNotebooks();
    const settings = this.getSettings();
    if (!Number.isFinite(Number(settings.dailyGoal)) || Number(settings.dailyGoal) < 1) this.updateSettings({ dailyGoal: 20 }, { silent: true });
    const engagementDefaults = {};
    if (typeof settings.reminderEnabled !== 'boolean') engagementDefaults.reminderEnabled = false;
    if (!/^\d{2}:\d{2}$/.test(String(settings.reminderTime || ''))) engagementDefaults.reminderTime = '19:00';
    if (typeof settings.soundEnabled !== 'boolean') engagementDefaults.soundEnabled = true;
    if (Object.keys(engagementDefaults).length) this.updateSettings(engagementDefaults, { silent: true });
  }

  getGoogleClientId() {
    return this.storage.getItem(STORAGE_KEY_GOOGLE_CLIENT_ID) || '';
  }

  setGoogleClientId(clientId) {
    const clean = String(clientId || '').trim();
    if (!/^[0-9]+-[a-z0-9_-]+\.apps\.googleusercontent\.com$/i.test(clean)) {
      throw new Error('Enter a valid Google OAuth web client ID ending in .apps.googleusercontent.com.');
    }
    this.storage.setItem(STORAGE_KEY_GOOGLE_CLIENT_ID, clean);
    return clean;
  }

  getDriveStatus() {
    const metadata = this.read(STORAGE_KEY_DRIVE_AUTH, { isConnected: false });
    const hasLiveToken = Boolean(this.accessToken && Date.now() < this.tokenExpiresAt);
    return { ...metadata, remembered: Boolean(metadata.remembered), isConnected: Boolean(metadata.isConnected && hasLiveToken), folderName: BACKUP_FOLDER_NAME };
  }

  restoreGoogleToken() {
    const storedToken = this.read(STORAGE_KEY_DRIVE_TOKEN, null);
    const accessToken = String(storedToken?.accessToken || '');
    const expiresAt = Number(storedToken?.expiresAt || 0);
    if (!accessToken || !Number.isFinite(expiresAt) || expiresAt <= Date.now() + TOKEN_RESTORE_BUFFER_MS) {
      this.clearGoogleToken();
      return false;
    }
    this.accessToken = accessToken;
    this.tokenExpiresAt = expiresAt;
    return true;
  }

  persistGoogleToken() {
    this.write(STORAGE_KEY_DRIVE_TOKEN, {
      accessToken: this.accessToken,
      expiresAt: this.tokenExpiresAt
    });
  }

  clearGoogleToken() {
    this.accessToken = null;
    this.tokenExpiresAt = 0;
    this.storage.removeItem(STORAGE_KEY_DRIVE_TOKEN);
  }

  setDriveStatus(patch) {
    const previous = this.read(STORAGE_KEY_DRIVE_AUTH, {});
    const clean = {
      isConnected: Boolean(patch.isConnected),
      remembered: patch.remembered ?? previous.remembered ?? false,
      email: patch.email ?? previous.email ?? null,
      lastSynced: patch.lastSynced ?? previous.lastSynced ?? null,
      lastError: patch.lastError ?? null,
      folderId: patch.folderId ?? previous.folderId ?? null
    };
    this.write(STORAGE_KEY_DRIVE_AUTH, clean);
    return clean;
  }

  async connectGoogleDrive(clientId) {
    const nativeAuth = getNativeDriveAuthPlugin();
    if (nativeAuth) {
      const result = await nativeAuth.authorize({ interactive: true });
      this.acceptGoogleToken({ access_token: result.accessToken, expires_in: result.expiresIn });
      return this.finishGoogleConnection();
    }
    const cleanClientId = this.setGoogleClientId(clientId);
    if (!globalThis.google?.accounts?.oauth2) throw new Error('Google Identity Services did not load. Check your connection and try again.');
    const tokenResponse = await this.requestGoogleToken(cleanClientId, 'consent');
    this.acceptGoogleToken(tokenResponse);
    return this.finishGoogleConnection();
  }

  requestGoogleToken(clientId, prompt = '') {
    return new Promise((resolve, reject) => {
      const client = globalThis.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: `${USERINFO_SCOPE} ${DRIVE_SCOPE}`,
        callback: response => {
          if (response?.error) reject(new Error(response.error_description || response.error));
          else if (!response?.access_token) reject(new Error('Google did not return an access token.'));
          else resolve(response);
        },
        error_callback: error => reject(new Error(error?.message || error?.type || 'Google authorization was cancelled.'))
      });
      client.requestAccessToken({ prompt });
    });
  }

  acceptGoogleToken(tokenResponse) {
    this.accessToken = tokenResponse.access_token;
    this.tokenExpiresAt = Date.now() + Math.max(0, Number(tokenResponse.expires_in || 3600) - 60) * 1000;
    this.persistGoogleToken();
  }

  async finishGoogleConnection() {
    try {
      const profileResponse = await this.authorizedFetch('https://www.googleapis.com/oauth2/v3/userinfo');
      const profile = await profileResponse.json();
      this.setDriveStatus({ isConnected: true, remembered: true, email: profile.email || null, lastError: null });
      const sync = await this.syncGoogleDrive();
      return { email: profile.email || null, ...sync };
    } catch (error) {
      this.setDriveStatus({ isConnected: true, lastError: error.message });
      throw error;
    }
  }

  async resumeGoogleDrive() {
    const status = this.getDriveStatus();
    if (!status.remembered) return null;
    const nativeAuth = getNativeDriveAuthPlugin();
    const clientId = this.getGoogleClientId();
    if (!nativeAuth && !clientId) return null;
    if (!nativeAuth && !globalThis.google?.accounts?.oauth2) throw new Error('Google Identity Services did not load.');
    try {
      const tokenResponse = nativeAuth
        ? await nativeAuth.authorize({ interactive: false }).then(result => ({ access_token: result.accessToken, expires_in: result.expiresIn }))
        : await this.requestGoogleToken(clientId, '');
      this.acceptGoogleToken(tokenResponse);
      return await this.finishGoogleConnection();
    } catch (error) {
      this.clearGoogleToken();
      this.setDriveStatus({ isConnected: false, remembered: true, lastError: 'Google needs you to reconnect Drive once to renew access.' });
      throw error;
    }
  }

  disconnectGoogleDrive(revoke = true) {
    const nativeAuth = getNativeDriveAuthPlugin();
    if (revoke && nativeAuth) {
      nativeAuth.revoke().catch(() => {});
    } else if (revoke && this.accessToken && globalThis.google?.accounts?.oauth2?.revoke) {
      globalThis.google.accounts.oauth2.revoke(this.accessToken, () => {});
    }
    this.clearGoogleToken();
    return this.setDriveStatus({ isConnected: false, remembered: false, lastError: null });
  }

  async authorizedFetch(url, options = {}) {
    if (!this.fetchImpl) throw new Error('This browser does not support network requests.');
    if (!this.accessToken || Date.now() >= this.tokenExpiresAt) {
      this.clearGoogleToken();
      this.setDriveStatus({ isConnected: false, remembered: true, lastError: 'Your Google Drive session expired. Renewing access is required.' });
      throw new Error('Your Google Drive session expired. Reconnect to continue syncing.');
    }
    const response = await this.fetchImpl(url, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${this.accessToken}` }
    });
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json())?.error?.message || ''; } catch { /* non-JSON failure */ }
      if (response.status === 401) {
        this.clearGoogleToken();
        this.setDriveStatus({ isConnected: false, remembered: true, lastError: 'Google rejected the saved session. Reconnect to Google Drive.' });
        throw new Error('Google rejected the session. Reconnect to Google Drive.');
      }
      if (response.status === 403) throw new Error(`Google Drive access was denied.${detail ? ` ${detail}` : ''}`);
      throw new Error(`Google Drive request failed (${response.status}).${detail ? ` ${detail}` : ''}`);
    }
    return response;
  }

  async listFiles(query) {
    const params = new URLSearchParams({
      q: query,
      spaces: 'drive',
      pageSize: '1000',
      fields: 'files(id,name,mimeType,modifiedTime,appProperties,parents)'
    });
    const response = await this.authorizedFetch(`${DRIVE_API_BASE}/files?${params}`);
    const payload = await response.json();
    return Array.isArray(payload.files) ? payload.files : [];
  }

  async createMetadata(metadata) {
    const response = await this.authorizedFetch(`${DRIVE_API_BASE}/files?fields=id,name,mimeType,modifiedTime,appProperties,parents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata)
    });
    return response.json();
  }

  async findOrCreateBackupFolder() {
    const query = `trashed=false and mimeType='application/vnd.google-apps.folder' and appProperties has { key='${BACKUP_APP_PROPERTY}' and value='folder' }`;
    const folders = await this.listFiles(query);
    const folder = folders.find(item => item.name === BACKUP_FOLDER_NAME) || folders[0];
    if (folder) return folder;
    return this.createMetadata({
      name: BACKUP_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
      appProperties: { [BACKUP_APP_PROPERTY]: 'folder', schemaVersion: String(SCHEMA_VERSION) }
    });
  }

  async listBackupFiles(folderId) {
    const query = `'${folderId}' in parents and trashed=false and appProperties has { key='${BACKUP_APP_PROPERTY}' and value='data' }`;
    return this.listFiles(query);
  }

  async downloadJsonFile(fileId) {
    const response = await this.authorizedFetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`);
    return response.json();
  }

  async createJsonFile(folderId, name, kind, payload, monthYear = '') {
    const boundary = `keepvocab_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const metadata = {
      name,
      mimeType: 'application/json',
      parents: [folderId],
      appProperties: {
        [BACKUP_APP_PROPERTY]: 'data',
        kind,
        schemaVersion: String(SCHEMA_VERSION),
        ...(monthYear ? { monthYear } : {})
      }
    };
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      'Content-Type: application/json',
      '',
      JSON.stringify(payload),
      `--${boundary}--`,
      ''
    ].join('\r\n');
    const response = await this.authorizedFetch(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime,appProperties,parents`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    });
    return response.json();
  }

  async updateJsonFile(fileId, payload) {
    const response = await this.authorizedFetch(`${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name,modifiedTime`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return response.json();
  }

  getNotebooks() {
    return this.read(STORAGE_KEY_NOTEBOOKS, []);
  }

  refreshNotebooks() {
    const settings = this.getSettings();
    const names = new Set([settings.activeNotebook || getCurrentMonthNotebookTitle()]);
    for (const word of this.getWords()) names.add(word.notebook || notebookFromMonthYear(word.monthYear));
    const notebooks = [...names].filter(Boolean).map(name => ({
      name,
      isAuto: true,
      monthYear: String(name).replace(/ Vocabulary$/, '')
    })).sort((a, b) => new Date(`${b.monthYear} 1`) - new Date(`${a.monthYear} 1`));
    this.write(STORAGE_KEY_NOTEBOOKS, notebooks);
    return notebooks;
  }

  getWords() {
    const words = this.read(STORAGE_KEY_WORDS, []);
    return Array.isArray(words) ? words : [];
  }

  getWordsByMonthYear(monthYear) {
    return this.getWords().filter(word => word.monthYear === monthYear || String(word.notebook || '').includes(monthYear));
  }

  getMonthlyArchives() {
    const map = new Map();
    for (const word of this.getWords()) {
      const monthYear = word.monthYear || String(word.notebook || '').replace(/ Vocabulary$/, '');
      if (!map.has(monthYear)) map.set(monthYear, { monthYear, words: [], count: 0, mastered: 0 });
      const archive = map.get(monthYear);
      archive.words.push(word);
      archive.count += 1;
      if (word.mastered) archive.mastered += 1;
    }
    return [...map.values()].sort((a, b) => new Date(`${b.monthYear} 1`) - new Date(`${a.monthYear} 1`));
  }

  saveWords(words, { silent = false } = {}) {
    this.write(STORAGE_KEY_WORDS, Array.isArray(words) ? words : []);
    if (!silent) this.emitChange('library');
  }

  getTombstones() {
    const tombstones = this.read(STORAGE_KEY_TOMBSTONES, []);
    return Array.isArray(tombstones) ? tombstones : [];
  }

  saveTombstones(tombstones, { silent = false } = {}) {
    this.write(STORAGE_KEY_TOMBSTONES, Array.isArray(tombstones) ? tombstones : []);
    if (!silent) this.emitChange('library');
  }

  addWord(wordObj, targetNotebook = null) {
    return this.addWords([wordObj], targetNotebook)[0];
  }

  addWords(wordObjects, targetNotebook = null) {
    // Normal UI additions always belong to the real calendar month in which
    // they were created. An explicit target remains available for controlled
    // migrations and tests only.
    const notebook = targetNotebook || getCurrentMonthNotebookTitle();
    const monthYear = notebook.replace(/ Vocabulary$/, '');
    const now = new Date().toISOString();
    const candidates = (Array.isArray(wordObjects) ? wordObjects : [])
      .map(wordObj => normalizeStoredWord({ ...wordObj, createdAt: wordObj.createdAt || now, updatedAt: now }, monthYear, 'manual'));
    if (!candidates.length || candidates.some(word => !word)) throw new Error('Enter at least one valid meaning.');
    const identities = candidates.map(senseIdentity);
    if (new Set(identities).size !== identities.length) throw new Error('The selected meanings contain a duplicate definition.');
    const existing = this.getWords();
    const duplicate = candidates.find(candidate => existing.some(word => senseIdentity(word) === senseIdentity(candidate)));
    if (duplicate) {
      throw new Error(`That meaning of “${duplicate.word}” is already in ${notebook}. Choose a different meaning or edit the definition.`);
    }
    const words = [...candidates, ...existing];
    this.isFreshInstall = false;
    this.saveWords(words);
    this.refreshNotebooks();
    return candidates;
  }

  updateWord(wordId, patch = {}) {
    const words = this.getWords();
    const index = words.findIndex(word => word.id === wordId);
    if (index === -1) throw new Error('That vocabulary entry no longer exists.');
    const allowed = ['word', 'phonetic', 'partOfSpeech', 'definition', 'example', 'exampleSourceUrl', 'exampleAttribution', 'exampleLicense', 'audioUrl', 'imageUrl', 'imageSourceUrl', 'imageAttribution', 'imageLicense', 'imageSearchQuery', 'imageCustomConcept'];
    const cleanPatch = Object.fromEntries(allowed.filter(key => Object.prototype.hasOwnProperty.call(patch, key)).map(key => [key, String(patch[key] ?? '').trim()]));
    if (cleanPatch.word !== undefined) cleanPatch.word = normalizeWordText(cleanPatch.word).toLowerCase();
    if (!cleanPatch.word && cleanPatch.word !== undefined) throw new Error('Word cannot be empty.');
    if (!cleanPatch.definition && cleanPatch.definition !== undefined) throw new Error('Definition cannot be empty.');
    if (cleanPatch.imageCustomConcept !== undefined) cleanPatch.imageCustomConcept = cleanPatch.imageCustomConcept.slice(0, 160);
    if (cleanPatch.imageUrl && !/^https:\/\//i.test(cleanPatch.imageUrl)) throw new Error('Image URL must start with https://.');
    if (cleanPatch.imageSourceUrl && !/^https:\/\//i.test(cleanPatch.imageSourceUrl)) throw new Error('Image source URL must start with https://.');
    const updated = { ...words[index], ...cleanPatch, updatedAt: new Date().toISOString() };
    if (words.some((word, candidateIndex) => candidateIndex !== index && senseIdentity(word) === senseIdentity(updated))) {
      throw new Error(`That meaning of “${updated.word}” is already in ${updated.notebook}.`);
    }
    words[index] = updated;
    this.saveWords(words);
    return updated;
  }

  deleteWord(wordId) {
    const words = this.getWords();
    const deleted = words.find(word => word.id === wordId);
    if (!deleted) return false;
    const tombstones = this.getTombstones().filter(item => item.id !== deleted.id);
    tombstones.push({ id: deleted.id, senseId: deleted.senseId || '', monthYear: deleted.monthYear, deletedAt: new Date().toISOString() });
    this.suppressEvents = true;
    this.saveWords(words.filter(word => word.id !== wordId), { silent: true });
    this.saveTombstones(tombstones, { silent: true });
    this.refreshNotebooks();
    this.suppressEvents = false;
    this.emitChange('library');
    return true;
  }

  getSettings() {
    return this.read(STORAGE_KEY_SETTINGS, {});
  }

  updateSettings(patch, { silent = false } = {}) {
    const settings = { ...this.getSettings(), ...patch, updatedAt: new Date().toISOString() };
    this.write(STORAGE_KEY_SETTINGS, settings);
    if (!silent) this.emitChange('settings');
    return settings;
  }

  recordReview(date = new Date()) {
    const key = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    const settings = this.getSettings();
    const count = settings.reviewsDate === key ? Number(settings.reviewsToday || 0) + 1 : 1;
    this.updateSettings({ reviewsDate: key, reviewsToday: count });
    return count;
  }

  getActiveNotebook() {
    return this.getSettings().activeNotebook || getCurrentMonthNotebookTitle();
  }

  setActiveNotebook(notebook) {
    const exists = this.getNotebooks().some(item => item.name === notebook);
    if (!exists) throw new Error(`Notebook “${notebook}” does not exist.`);
    this.updateSettings({ activeNotebook: notebook });
    return notebook;
  }

  exportDictionaryText(notebookName = null) {
    return this.getWords().filter(word => !notebookName || word.notebook === notebookName).map(word =>
      `📌 [${word.word.toUpperCase()}]${word.phonetic ? ` (${word.phonetic})` : ''}\n• ${word.partOfSpeech}: ${word.definition}\n${word.example ? `• Example: ${word.example}\n` : ''}`
    ).join('\n---\n');
  }

  async syncGoogleDrive() {
    if (this.syncPromise) return this.syncPromise;
    this.syncPromise = this.performDriveSync().finally(() => { this.syncPromise = null; });
    return this.syncPromise;
  }

  async performDriveSync() {
    const folder = await this.findOrCreateBackupFolder();
    const files = await this.listBackupFiles(folder.id);
    const monthlyFiles = new Map();
    let settingsFile = null;
    for (const file of files) {
      if (file.appProperties?.kind === 'month' && file.appProperties?.monthYear) {
        const group = monthlyFiles.get(file.appProperties.monthYear) || [];
        group.push(file);
        monthlyFiles.set(file.appProperties.monthYear, group);
      } else if (file.appProperties?.kind === 'settings' && !settingsFile) {
        settingsFile = file;
      }
    }

    const remoteByMonth = new Map();
    for (const [monthYear, group] of monthlyFiles) {
      const payloads = [];
      for (const file of group) payloads.push({ file, payload: await this.downloadJsonFile(file.id) });
      remoteByMonth.set(monthYear, payloads);
    }

    const localWordsForSync = this.getWords().filter(word => !(remoteByMonth.size > 0 && this.isFreshInstall && word.source === 'sample'));
    const allMonths = new Set([
      ...localWordsForSync.map(word => word.monthYear),
      ...this.getTombstones().map(item => item.monthYear),
      ...remoteByMonth.keys()
    ].filter(Boolean));
    const finalWords = [];
    const finalTombstones = [];
    let createdFiles = 0;
    let updatedFiles = 0;
    let restoredWords = 0;

    for (const monthYear of allMonths) {
      const wordMap = new Map();
      const tombstoneMap = new Map();
      const localWords = localWordsForSync
        .filter(word => word.monthYear === monthYear)
        .map(word => normalizeStoredWord(word, monthYear, word.source || 'local'))
        .filter(Boolean);
      const localTombstones = this.getTombstones().filter(item => item.monthYear === monthYear).map(item => normalizeTombstone(item, monthYear)).filter(Boolean);
      for (const word of localWords) wordMap.set(word.id, word);
      for (const item of localTombstones) tombstoneMap.set(item.id, item);

      const remotePayloads = remoteByMonth.get(monthYear) || [];
      for (const { payload } of remotePayloads) {
        if (Number(payload?.schemaVersion) !== SCHEMA_VERSION || payload?.monthYear !== monthYear) continue;
        for (const candidate of Array.isArray(payload.words) ? payload.words : []) {
          const word = normalizeStoredWord(candidate, monthYear, 'drive');
          if (!word) continue;
          const existing = wordMap.get(word.id);
          if (!existing || recordTimestamp(word) > recordTimestamp(existing)) {
            if (!existing) restoredWords += 1;
            wordMap.set(word.id, word);
          }
        }
        for (const candidate of Array.isArray(payload.tombstones) ? payload.tombstones : []) {
          const item = normalizeTombstone(candidate, monthYear);
          if (!item) continue;
          const existing = tombstoneMap.get(item.id);
          if (!existing || recordTimestamp({ updatedAt: item.deletedAt }) > recordTimestamp({ updatedAt: existing.deletedAt })) tombstoneMap.set(item.id, item);
        }
      }

      for (const [id, word] of wordMap) {
        const tombstone = tombstoneMap.get(id);
        if (!tombstone || Date.parse(tombstone.deletedAt) < recordTimestamp(word)) finalWords.push(word);
      }
      finalTombstones.push(...tombstoneMap.values());

      const monthWords = finalWords.filter(word => word.monthYear === monthYear);
      const monthTombstones = finalTombstones.filter(item => item.monthYear === monthYear);
      const payload = {
        schemaVersion: SCHEMA_VERSION,
        app: 'KeepVocab',
        monthYear,
        updatedAt: new Date().toISOString(),
        words: sortRecords(monthWords),
        tombstones: sortRecords(monthTombstones)
      };
      const primary = remotePayloads[0];
      if (!primary) {
        await this.createJsonFile(folder.id, `Dictionary ${monthYear}.json`, 'month', payload, monthYear);
        createdFiles += 1;
      } else {
        const remoteWords = (Array.isArray(primary.payload.words) ? primary.payload.words : []).map(word => normalizeStoredWord(word, monthYear, 'drive')).filter(Boolean);
        const remoteTombstones = (Array.isArray(primary.payload.tombstones) ? primary.payload.tombstones : []).map(item => normalizeTombstone(item, monthYear)).filter(Boolean);
        if (dataSignature(monthWords, monthTombstones) !== dataSignature(remoteWords, remoteTombstones)) {
          await this.updateJsonFile(primary.file.id, payload);
          updatedFiles += 1;
        }
      }
    }

    let settings = this.getSettings();
    let remoteSettingsPayload = null;
    if (settingsFile) remoteSettingsPayload = await this.downloadJsonFile(settingsFile.id);
    const remoteSettings = remoteSettingsPayload?.settings;
    if (remoteSettings && (this.isFreshInstall || recordTimestamp(remoteSettings) > recordTimestamp(settings))) settings = remoteSettings;
    const settingsPayload = { schemaVersion: SCHEMA_VERSION, app: 'KeepVocab', updatedAt: new Date().toISOString(), settings };
    if (!settingsFile) {
      await this.createJsonFile(folder.id, 'KeepVocab Settings.json', 'settings', settingsPayload);
      createdFiles += 1;
    } else if (JSON.stringify(remoteSettings || {}) !== JSON.stringify(settings)) {
      await this.updateJsonFile(settingsFile.id, settingsPayload);
      updatedFiles += 1;
    }

    this.suppressEvents = true;
    this.saveWords(finalWords, { silent: true });
    this.saveTombstones(finalTombstones, { silent: true });
    this.write(STORAGE_KEY_SETTINGS, settings);
    this.refreshNotebooks();
    this.suppressEvents = false;
    const lastSynced = new Date().toISOString();
    this.setDriveStatus({ isConnected: true, folderId: folder.id, lastSynced, lastError: null });
    this.isFreshInstall = false;
    return { folderId: folder.id, folderName: BACKUP_FOLDER_NAME, months: allMonths.size, restoredWords, createdFiles, updatedFiles, totalWords: finalWords.length, lastSynced };
  }
}

export const driveSync = new DriveSyncService();
