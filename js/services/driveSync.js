// Local-first vocabulary persistence with reinstall-safe Google Drive backup.

import { getGeminiBackupRecord, restoreGeminiBackupRecord } from './geminiSettings.js?v=90';
import { getImageProviderBackupRecord, restoreImageProviderBackupRecord } from './imageSearch.js?v=90';
import { localDateKey } from '../utils/dates.js';

const STORAGE_KEY_WORDS = 'keepvocab_words_db';
const STORAGE_KEY_NOTEBOOKS = 'keepvocab_notebooks_db';
const STORAGE_KEY_SETTINGS = 'keepvocab_settings';
const STORAGE_KEY_DRIVE_AUTH = 'keepvocab_drive_auth';
const STORAGE_KEY_DRIVE_TOKEN = 'keepvocab_drive_token';
const STORAGE_KEY_TOMBSTONES = 'keepvocab_drive_tombstones';
const STORAGE_KEY_DEVICE_ID = 'keepvocab_device_id';

export const GOOGLE_WEB_CLIENT_ID = '23308644025-div17rqsfbtgihgf7saoaobcjs4n9h5h.apps.googleusercontent.com';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
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

function normalizedActivity(activity) {
  return Object.fromEntries(Object.entries(activity && typeof activity === 'object' ? activity : {})
    .filter(([date, count]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number(count) > 0)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 90)
    .map(([date, count]) => [date, Math.max(0, Math.round(Number(count) || 0))]));
}

function activityByDevice(settings) {
  const saved = settings?.exerciseActivityByDevice;
  if (saved && typeof saved === 'object' && Object.keys(saved).length) {
    return Object.fromEntries(Object.entries(saved)
      .map(([deviceId, activity]) => [String(deviceId), normalizedActivity(activity)])
      .filter(([, activity]) => Object.keys(activity).length));
  }
  const legacy = normalizedActivity(settings?.reviewActivity);
  return Object.keys(legacy).length ? { legacy: legacy } : {};
}

function mergeActivityByDevice(localSettings, remoteSettings) {
  const merged = activityByDevice(localSettings);
  for (const [deviceId, remoteActivity] of Object.entries(activityByDevice(remoteSettings))) {
    const localActivity = merged[deviceId] || {};
    const dates = [...new Set([...Object.keys(localActivity), ...Object.keys(remoteActivity)])];
    merged[deviceId] = normalizedActivity(Object.fromEntries(dates
      .map(date => [date, Math.max(Number(localActivity[date] || 0), Number(remoteActivity[date] || 0))])));
  }
  return merged;
}

function aggregateActivity(shards) {
  const totals = {};
  for (const activity of Object.values(shards || {})) {
    for (const [date, count] of Object.entries(activity || {})) totals[date] = Number(totals[date] || 0) + Number(count || 0);
  }
  return normalizedActivity(totals);
}

function streakFromActivity(activity) {
  const dates = Object.keys(activity || {}).sort((a, b) => b.localeCompare(a));
  if (!dates.length) return 0;
  let streak = 1;
  let cursor = new Date(`${dates[0]}T12:00:00`);
  for (const date of dates.slice(1)) {
    cursor.setDate(cursor.getDate() - 1);
    if (localDateKey(cursor) !== date) break;
    streak += 1;
  }
  return streak;
}

export function mergeDriveSettings(localSettings = {}, remoteSettings = {}, { freshInstall = false } = {}) {
  const base = remoteSettings && Object.keys(remoteSettings).length
    && (freshInstall || recordTimestamp(remoteSettings) > recordTimestamp(localSettings))
    ? remoteSettings
    : localSettings;
  const exerciseActivityByDevice = mergeActivityByDevice(localSettings, remoteSettings);
  const reviewActivity = aggregateActivity(exerciseActivityByDevice);
  const reviewsDate = Object.keys(reviewActivity).sort((a, b) => b.localeCompare(a))[0] || null;
  return {
    ...base,
    exerciseActivityByDevice,
    reviewActivity,
    reviewsDate,
    reviewsToday: reviewsDate ? reviewActivity[reviewsDate] : 0,
    lastReviewDate: reviewsDate || base.lastReviewDate || null,
    dailyStreak: streakFromActivity(reviewActivity)
  };
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
    imageFeedback: candidate.imageFeedback && typeof candidate.imageFeedback === 'object' ? {
      rejectedUrls: [...new Set((candidate.imageFeedback.rejectedUrls || []).map(String).filter(Boolean))].slice(0, 80),
      goodUrls: [...new Set((candidate.imageFeedback.goodUrls || []).map(String).filter(Boolean))].slice(0, 40),
      preferredConcepts: [...new Set((candidate.imageFeedback.preferredConcepts || []).map(String).filter(Boolean))].slice(0, 20),
      updatedAt: candidate.imageFeedback.updatedAt || null
    } : undefined,
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
    this.tokenRefreshPromise = null;
    this.syncPromise = null;
    this.suppressEvents = false;
    this.isFreshInstall = !this.storage.getItem(STORAGE_KEY_WORDS);
    this.deviceId = this.getOrCreateDeviceId();
    this.initStorage();
    this.restoreGoogleToken();
  }

  getOrCreateDeviceId() {
    const saved = String(this.storage.getItem(STORAGE_KEY_DEVICE_ID) || '').trim();
    if (saved) return saved;
    const generated = globalThis.crypto?.randomUUID?.() || `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    this.storage.setItem(STORAGE_KEY_DEVICE_ID, generated);
    return generated;
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
    if (!this.storage.getItem(STORAGE_KEY_WORDS)) this.saveWords([], { silent: true });
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
        exerciseActivityByDevice: {},
        reminderEnabled: false,
        smartReminderEnabled: true,
        streakReminderEnabled: true,
        reminderTime: '19:00',
        reviewStartMoments: [],
        soundEnabled: true,
        updatedAt: new Date().toISOString()
      });
    }
    if (!this.storage.getItem(STORAGE_KEY_DRIVE_AUTH)) {
      this.write(STORAGE_KEY_DRIVE_AUTH, { isConnected: false, remembered: false, email: null, lastSynced: null, lastError: null, folderId: null });
    } else {
      const storedDrive = this.read(STORAGE_KEY_DRIVE_AUTH, {});
      let normalizedDrive = storedDrive;
      if (!storedDrive.remembered && storedDrive.isConnected && storedDrive.email && storedDrive.lastSynced) {
        normalizedDrive = { ...normalizedDrive, remembered: true };
      }
      if (normalizedDrive.remembered && /session expired|renewing access is required|reconnect drive once to renew/i.test(String(normalizedDrive.lastError || ''))) {
        normalizedDrive = { ...normalizedDrive, lastError: null };
      }
      if (normalizedDrive !== storedDrive) this.write(STORAGE_KEY_DRIVE_AUTH, normalizedDrive);
    }
    this.refreshNotebooks();
    const settings = this.getSettings();
    if (!Number.isFinite(Number(settings.dailyGoal)) || Number(settings.dailyGoal) < 1) this.updateSettings({ dailyGoal: 20 }, { silent: true });
    const engagementDefaults = {};
    if (typeof settings.reminderEnabled !== 'boolean') engagementDefaults.reminderEnabled = false;
    if (typeof settings.smartReminderEnabled !== 'boolean') engagementDefaults.smartReminderEnabled = true;
    if (typeof settings.streakReminderEnabled !== 'boolean') engagementDefaults.streakReminderEnabled = true;
    if (!/^\d{2}:\d{2}$/.test(String(settings.reminderTime || ''))) engagementDefaults.reminderTime = '19:00';
    if (!Array.isArray(settings.reviewStartMoments)) engagementDefaults.reviewStartMoments = [];
    if (typeof settings.soundEnabled !== 'boolean') engagementDefaults.soundEnabled = true;
    if (Object.keys(engagementDefaults).length) this.updateSettings(engagementDefaults, { silent: true });
  }

  getGoogleClientId() {
    return GOOGLE_WEB_CLIENT_ID;
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

  async connectGoogleDrive() {
    const nativeAuth = getNativeDriveAuthPlugin();
    if (nativeAuth) {
      const result = await nativeAuth.authorize({ interactive: true });
      this.acceptGoogleToken({ access_token: result.accessToken, expires_in: result.expiresIn });
      return this.finishGoogleConnection();
    }
    if (!globalThis.google?.accounts?.oauth2) throw new Error('Google Identity Services did not load. Check your connection and try again.');
    const tokenResponse = await this.requestGoogleToken(GOOGLE_WEB_CLIENT_ID, 'consent');
    this.acceptGoogleToken(tokenResponse);
    return this.finishGoogleConnection();
  }

  requestGoogleToken(clientId, prompt = '') {
    return new Promise((resolve, reject) => {
      const client = globalThis.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_SCOPE,
        callback: response => {
          if (response?.error) {
            const accessBlocked = /access_denied|org_internal|admin_policy_enforced/i.test(String(response.error));
            reject(new Error(accessBlocked
              ? 'Google blocked this account. The KeepVocab OAuth app owner must allow external users and publish the consent screen, or add this account as a test user.'
              : (response.error_description || response.error)));
          }
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

  async renewGoogleToken({ interactive = false } = {}) {
    if (this.tokenRefreshPromise) return this.tokenRefreshPromise;
    this.tokenRefreshPromise = (async () => {
      const nativeAuth = getNativeDriveAuthPlugin();
      const clientId = this.getGoogleClientId();
      if (!nativeAuth && !clientId) throw new Error('Connect Google Drive once on this device to enable automatic renewal.');
      if (!nativeAuth && !globalThis.google?.accounts?.oauth2) throw new Error('Google Identity Services did not load.');
      const tokenResponse = nativeAuth
        ? await nativeAuth.authorize({ interactive }).then(result => ({ access_token: result.accessToken, expires_in: result.expiresIn }))
        : await this.requestGoogleToken(clientId, interactive ? 'consent' : '');
      this.acceptGoogleToken(tokenResponse);
      this.setDriveStatus({ isConnected: true, remembered: true, lastError: null });
      return tokenResponse;
    })();
    try {
      return await this.tokenRefreshPromise;
    } finally {
      this.tokenRefreshPromise = null;
    }
  }

  renewalFailureMessage(error) {
    const code = String(error?.code || error?.type || '').toUpperCase();
    if (code.includes('RECONNECT') || code.includes('CONSENT') || code.includes('INTERACTION')) {
      return 'Google Drive needs one confirmation. Tap Reconnect Drive once.';
    }
    if (globalThis.navigator?.onLine === false) return 'Drive will reconnect automatically when this device is online.';
    return 'Drive could not renew in the background. Tap Reconnect Drive once if it does not recover automatically.';
  }

  async finishGoogleConnection() {
    try {
      this.setDriveStatus({ isConnected: true, remembered: true, lastError: null });
      const sync = await this.syncGoogleDrive();
      return { ...sync };
    } catch (error) {
      this.setDriveStatus({ isConnected: true, lastError: error.message });
      throw error;
    }
  }

  async resumeGoogleDrive() {
    const status = this.getDriveStatus();
    if (!status.remembered) return null;
    try {
      await this.renewGoogleToken({ interactive: false });
      return await this.finishGoogleConnection();
    } catch (error) {
      this.clearGoogleToken();
      this.setDriveStatus({ isConnected: false, remembered: true, lastError: this.renewalFailureMessage(error) });
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

  async authorizedFetch(url, options = {}, retriedAfterRenewal = false) {
    if (!this.fetchImpl) throw new Error('This browser does not support network requests.');
    if (!this.accessToken || Date.now() >= this.tokenExpiresAt) {
      this.clearGoogleToken();
      if (!this.getDriveStatus().remembered) throw new Error('Connect Google Drive to start syncing.');
      try {
        await this.renewGoogleToken({ interactive: false });
      } catch (error) {
        const message = this.renewalFailureMessage(error);
        this.setDriveStatus({ isConnected: false, remembered: true, lastError: message });
        throw new Error(message, { cause: error });
      }
    }
    const response = await this.fetchImpl(url, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${this.accessToken}` }
    });
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json())?.error?.message || ''; } catch { /* non-JSON failure */ }
      if (response.status === 401 && !retriedAfterRenewal && this.getDriveStatus().remembered) {
        this.clearGoogleToken();
        try {
          await this.renewGoogleToken({ interactive: false });
          return this.authorizedFetch(url, options, true);
        } catch (error) {
          const message = this.renewalFailureMessage(error);
          this.setDriveStatus({ isConnected: false, remembered: true, lastError: message });
          throw new Error(message, { cause: error });
        }
      }
      if (response.status === 401) {
        this.clearGoogleToken();
        const message = 'Google Drive needs one confirmation. Tap Reconnect Drive once.';
        this.setDriveStatus({ isConnected: false, remembered: true, lastError: message });
        throw new Error(message);
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
      if (!map.has(monthYear)) map.set(monthYear, { monthYear, words: [], count: 0, wordCount: 0, mastered: 0 });
      const archive = map.get(monthYear);
      archive.words.push(word);
      archive.count += 1;
      if (word.mastered) archive.mastered += 1;
    }
    return [...map.values()].map(archive => ({
      ...archive,
      wordCount: new Set(archive.words.map(word => String(word.word || '').trim().toLowerCase())).size
    })).sort((a, b) => new Date(`${b.monthYear} 1`) - new Date(`${a.monthYear} 1`));
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
    const allowed = ['word', 'phonetic', 'partOfSpeech', 'definition', 'example', 'exampleSourceUrl', 'exampleAttribution', 'exampleLicense', 'audioUrl', 'imageUrl', 'imageSourceUrl', 'imageAttribution', 'imageLicense', 'imageSearchQuery', 'imageCustomConcept', 'imageKind', 'imageGeneratedModel', 'imageGeneratedAt', 'imageGeneratedPrompt'];
    const cleanPatch = Object.fromEntries(allowed.filter(key => Object.prototype.hasOwnProperty.call(patch, key)).map(key => [key, String(patch[key] ?? '').trim()]));
    if (patch.imageFeedback && typeof patch.imageFeedback === 'object') cleanPatch.imageFeedback = {
      rejectedUrls: [...new Set((patch.imageFeedback.rejectedUrls || []).map(String).filter(Boolean))].slice(0, 80),
      goodUrls: [...new Set((patch.imageFeedback.goodUrls || []).map(String).filter(Boolean))].slice(0, 40),
      preferredConcepts: [...new Set((patch.imageFeedback.preferredConcepts || []).map(String).filter(Boolean))].slice(0, 20),
      updatedAt: patch.imageFeedback.updatedAt || new Date().toISOString()
    };
    if (cleanPatch.word !== undefined) cleanPatch.word = normalizeWordText(cleanPatch.word).toLowerCase();
    if (!cleanPatch.word && cleanPatch.word !== undefined) throw new Error('Word cannot be empty.');
    if (!cleanPatch.definition && cleanPatch.definition !== undefined) throw new Error('Definition cannot be empty.');
    if (cleanPatch.imageCustomConcept !== undefined) cleanPatch.imageCustomConcept = cleanPatch.imageCustomConcept.slice(0, 160);
    if (cleanPatch.imageUrl && !/^https:\/\//i.test(cleanPatch.imageUrl) && !/^data:image\/(?:png|jpeg|webp);base64,/i.test(cleanPatch.imageUrl)) throw new Error('Image URL must start with https:// or be a generated image.');
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
    const key = localDateKey(date);
    const settings = this.getSettings();
    const exerciseActivityByDevice = activityByDevice(settings);
    const deviceActivity = { ...(exerciseActivityByDevice[this.deviceId] || {}) };
    deviceActivity[key] = Number(deviceActivity[key] || 0) + 1;
    exerciseActivityByDevice[this.deviceId] = normalizedActivity(deviceActivity);
    const reviewActivity = aggregateActivity(exerciseActivityByDevice);
    this.updateSettings({
      exerciseActivityByDevice,
      reviewActivity,
      reviewsDate: key,
      reviewsToday: Number(reviewActivity[key] || 0)
    });
    return Number(reviewActivity[key] || 0);
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

    const localWordsForSync = this.getWords();
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

    const localSettings = this.getSettings();
    let settings = localSettings;
    let remoteSettingsPayload = null;
    if (settingsFile) remoteSettingsPayload = await this.downloadJsonFile(settingsFile.id);
    const remoteSettings = remoteSettingsPayload?.settings || {};
    settings = mergeDriveSettings(localSettings, remoteSettings, { freshInstall: this.isFreshInstall });
    const localGemini = getGeminiBackupRecord(this.storage);
    const remoteGemini = remoteSettingsPayload?.googleAiStudio || null;
    const chosenGemini = remoteGemini && (this.isFreshInstall || !localGemini || recordTimestamp(remoteGemini) > recordTimestamp(localGemini))
      ? remoteGemini
      : localGemini;
    const localImageProvider = getImageProviderBackupRecord(this.storage);
    const remoteImageProvider = remoteSettingsPayload?.imageSearchProvider || null;
    const chosenImageProvider = remoteImageProvider && (this.isFreshInstall || !localImageProvider || recordTimestamp(remoteImageProvider) > recordTimestamp(localImageProvider))
      ? remoteImageProvider
      : localImageProvider;
    const settingsPayload = {
      schemaVersion: SCHEMA_VERSION,
      app: 'KeepVocab',
      updatedAt: new Date().toISOString(),
      settings,
      ...(chosenGemini ? { googleAiStudio: chosenGemini } : {}),
      ...(chosenImageProvider ? { imageSearchProvider: chosenImageProvider } : {})
    };
    if (!settingsFile) {
      await this.createJsonFile(folder.id, 'KeepVocab Settings.json', 'settings', settingsPayload);
      createdFiles += 1;
    } else if (JSON.stringify(remoteSettings || {}) !== JSON.stringify(settings)
      || JSON.stringify(remoteGemini || null) !== JSON.stringify(chosenGemini || null)
      || JSON.stringify(remoteImageProvider || null) !== JSON.stringify(chosenImageProvider || null)) {
      await this.updateJsonFile(settingsFile.id, settingsPayload);
      updatedFiles += 1;
    }

    this.suppressEvents = true;
    this.saveWords(finalWords, { silent: true });
    this.saveTombstones(finalTombstones, { silent: true });
    this.write(STORAGE_KEY_SETTINGS, settings);
    if (chosenGemini) restoreGeminiBackupRecord(chosenGemini, this.storage);
    if (chosenImageProvider) restoreImageProviderBackupRecord(chosenImageProvider, this.storage);
    this.refreshNotebooks();
    this.suppressEvents = false;
    const lastSynced = new Date().toISOString();
    this.setDriveStatus({ isConnected: true, folderId: folder.id, lastSynced, lastError: null });
    this.isFreshInstall = false;
    return { folderId: folder.id, folderName: BACKUP_FOLDER_NAME, months: allMonths.size, restoredWords, createdFiles, updatedFiles, totalWords: finalWords.length, lastSynced };
  }
}

export const driveSync = new DriveSyncService();
