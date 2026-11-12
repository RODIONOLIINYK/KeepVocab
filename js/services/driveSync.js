import { replayWordFsrsHistory } from './srsEngine.js?v=18908';
import { ReviewHistoryStore, mergeReviewEvents } from './reviewHistory.js';
import { reviewHistoryIdentity, reviewHistorySources, withReviewHistorySources, normalizeReviewHistorySources, indexReviewEvents, reviewEventsForWord } from './reviewHistorySources.js';
import { ImageLearningHistoryStore, mergeImageEvents, IMAGE_HISTORY_CHUNK } from './imageLearningHistory.js';
import { CLIP_TAG, LEGACY_CLIP_TAG } from '../ml/clipConfig.js';
import { mergeFsrsConfig } from './fsrsConfig.js';
import { mergeImageLearning } from './imagePreferences.js';
// Local-first vocabulary persistence with reinstall-safe Google Drive backup.

import { getGeminiBackupRecord, restoreGeminiBackupRecord, sanitizeGeminiBackupRecord } from './geminiSettings.js?v=18908';
import { getImageProviderBackupRecord, restoreImageProviderBackupRecord, sanitizeImageProviderBackupRecord } from './imageSearch.js?v=18908';
import { activityByDevice, aggregateActivity, normalizedActivity, streakFromActivity, currentStudyStats } from './studyActivity.js';
import { localDateKey } from '../utils/dates.js';
import { safeImageUrl, safeImageSourceUrl } from '../utils/imageUrls.js';
import { getCourseDefinition, isCourseId } from '../data/courses.js';
import { migrateCourseSettings, updateActiveCourseSettings, switchActiveCourse, mergeCourseProfiles, stampPracticePreferences } from './courseProfiles.js';
import { normalizeWordPracticeStats } from './wordSelection.js?v=18908';
import { areSensesNearDuplicate, normalizeMeaningSupport, normalizeGroupedSenses, originalSenses, sourceDefinitionFingerprint } from './learningDefinitions.js?v=18908';

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
const SCHEMA_VERSION = 2;
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

function withoutDriveCredentials(value) {
  if (Array.isArray(value)) return value.map(withoutDriveCredentials);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/^(?:api[_-]?key|pexels[_-]?api[_-]?key|gemini[_-]?api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)$/i.test(key))
    .map(([key, entry]) => [key, withoutDriveCredentials(entry)]));
}

function normalizeWordText(value) {
  return String(value || '').trim().replace(/^[\s\-–—•*☐☑✅📌]+/, '').trim();
}

function normalizeSenseText(value) {
  return String(value || '').trim().toLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function senseIdentity(word) {
  return [word.courseId || 'english', word.monthYear, word.word, word.partOfSpeech || 'unknown', normalizeSenseText(word.sourceDefinition || word.definition)].join('|').toLowerCase();
}

function semanticIdentity(word) {
  const clean = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return JSON.stringify([clean(word.word), clean(word.partOfSpeech), clean(word.sourceDefinition || word.definition)]);
}

function normalizeImageScenes(value) {
  if (!value || typeof value !== 'object' || Number(value.version) !== 1 || !value.fingerprint || !value.generatorVersion || !Array.isArray(value.scenes)) return undefined;
  const scenes = [...new Set(value.scenes.filter(scene => typeof scene === 'string').map(scene => scene.trim()).filter(scene => scene && scene.length <= 180))].slice(0, 3);
  if (!scenes.length || !['object', 'curated', 'gemini'].includes(value.source)) return undefined;
  const contrasts = [...new Set((Array.isArray(value.contrasts) ? value.contrasts : []).filter(s => typeof s === 'string' && s.trim() && s.length <= 180))].slice(0, 3);
  return { version: 1, generatorVersion: String(value.generatorVersion || ''), fingerprint: String(value.fingerprint),
    source: value.source, scenes, ...(contrasts.length ? { contrasts } : {}), generatedAt: validIso(value.generatedAt) };
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

function newestTimestamp(...values) {
  return Math.max(0, ...values.map(value => Date.parse(value || '') || 0));
}

function learningTimestamp(word) {
  return newestTimestamp(word?.practiceStats?.lastAnsweredAt, word?.practiceStats?.lastUnaidedRecallAt,
    word?.lastReviewedAt, word?.lastExerciseResult?.occurredAt, word?.mastery?.lastPracticedAt);
}

const LEARNING_FIELDS = ['box', 'mastered', 'srs', 'nextReviewDate', 'lastReviewedAt', 'mastery', 'mistakes', 'productiveSamples', 'lastExerciseResult', 'practiceStats'];

function mergeStoredWord(local, remote) {
  const metadata = recordTimestamp(remote) > recordTimestamp(local) ? remote : local;
  // A conflicting identity keeps the existing whole-record conflict behavior.
  if (local.senseId !== remote.senseId || local.word !== remote.word || local.courseId !== remote.courseId) return metadata;
  const localLearningAt = learningTimestamp(local);
  const remoteLearningAt = learningTimestamp(remote);
  const learning = remoteLearningAt === localLearningAt ? metadata : remoteLearningAt > localLearningAt ? remote : local;
  const merged = { ...metadata };
  // Selecting or editing a word must not overwrite an answer from another device.
  for (const field of LEARNING_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(learning, field)) merged[field] = learning[field];
    else delete merged[field];
  }
  if (local.practiceStats || remote.practiceStats) {
    const stats = normalizeWordPracticeStats(learning);
    const localStats = normalizeWordPracticeStats(local);
    const remoteStats = normalizeWordPracticeStats(remote);
    // Keep factual dates and selection history; answer counts come from one
    // learning snapshot so syncing an overlap never counts the same answer twice.
    const lastRecall = newestTimestamp(localStats.lastUnaidedRecallAt, remoteStats.lastUnaidedRecallAt);
    const lastSelected = newestTimestamp(localStats.lastSelectedAt, remoteStats.lastSelectedAt);
    const byMode = { ...stats.byMode };
    for (const mode of new Set([...Object.keys(localStats.byMode), ...Object.keys(remoteStats.byMode)])) {
      const left = localStats.byMode[mode];
      const right = remoteStats.byMode[mode];
      const selectedAt = newestTimestamp(left?.lastSelectedAt, right?.lastSelectedAt);
      const selections = Math.max(left?.selections || 0, right?.selections || 0);
      if (byMode[mode] || selectedAt || selections) {
        byMode[mode] = { ...(byMode[mode] || { attempts: 0, recalled: 0, missed: 0, lastAnsweredAt: '' }),
          selections, lastSelectedAt: selectedAt ? new Date(selectedAt).toISOString() : '' };
      }
    }
    merged.practiceStats = { ...learning.practiceStats, ...stats,
      lastUnaidedRecallAt: lastRecall ? new Date(lastRecall).toISOString() : '',
      selections: Math.max(localStats.selections, remoteStats.selections),
      lastSelectedAt: lastSelected ? new Date(lastSelected).toISOString() : '', byMode };
  }
  return withReviewHistorySources(merged, [local, remote]
    .filter(word => reviewHistoryIdentity(word) === reviewHistoryIdentity(merged)).flatMap(reviewHistorySources));
}

function wordIsDeleted(word, tombstone) {
  if (!tombstone || (tombstone.courseId && tombstone.courseId !== (word.courseId || 'english'))) return false;
  if (tombstone.mergedInto && tombstone.sourceFingerprint !== sourceDefinitionFingerprint(word)) return false;
  return Date.parse(tombstone.deletedAt) >= recordTimestamp(word);
}

function mergeTombstone(existing, incoming) {
  if (!existing) return incoming;
  const chosen = Date.parse(incoming.deletedAt) > Date.parse(existing.deletedAt) ? incoming : existing;
  if ((existing.courseId || 'english') !== (incoming.courseId || 'english') || existing.monthYear !== incoming.monthYear) return chosen;
  // Later stale merge redirects must not erase an explicit group deletion.
  const deletedSources = normalizeReviewHistorySources([...(existing.deletedSources || []), ...(incoming.deletedSources || [])]);
  return deletedSources.length > 1 ? { ...chosen, deletedSources, courseId: chosen.courseId || 'english' } : chosen;
}

// Offline merges can select different survivors. Exact observation sources
// form a connected component, which must converge to one card before replay.
function reconcileMergedMeanings(words, tombstones) {
  const records = [...words.values()];
  const parents = records.map((_, index) => index);
  const root = index => parents[index] === index ? index : (parents[index] = root(parents[index]));
  const context = word => JSON.stringify([word.courseId || 'english', word.monthYear, word.word, word.partOfSpeech]);
  const sourceKey = (word, source) => JSON.stringify([word.courseId || 'english', word.monthYear, source.wordId, source.senseId]);
  const owners = new Map();
  records.forEach((word, index) => {
    for (const source of reviewHistorySources(word)) {
      const key = JSON.stringify([context(word), source.wordId, source.senseId]);
      if (owners.has(key)) parents[root(index)] = root(owners.get(key));
      else owners.set(key, index);
    }
  });
  const groups = new Map();
  records.forEach((word, index) => {
    const key = root(index);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(word);
  });
  const deletions = [...tombstones.values()].filter(item => item.deletedSources?.length > 1);
  for (const group of groups.values()) {
    const sources = normalizeReviewHistorySources(group.flatMap(reviewHistorySources));
    const keys = new Set(sources.map(source => sourceKey(group[0], source)));
    const deletion = deletions.filter(item => item.deletedSources.some(source => keys.has(sourceKey(item, source))))
      .sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt))[0];
    if (deletion) {
      // A deleted merged card stays deleted when a stale constituent reappears.
      for (const word of group) {
        words.delete(word.id);
        tombstones.set(word.id, { id: word.id, senseId: word.senseId || '', monthYear: word.monthYear,
          courseId: word.courseId || 'english', deletedAt: deletion.deletedAt,
          deletedSources: normalizeReviewHistorySources([...deletion.deletedSources, ...sources]) });
      }
      continue;
    }
    if (group.length < 2) continue;
    const sourceIds = new Set(sources.map(source => source.wordId));
    const live = group.filter(word => {
      const tombstone = tombstones.get(word.id);
      return !wordIsDeleted(word, tombstone) || (tombstone.mergedInto && sourceIds.has(tombstone.mergedInto));
    }).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    if (!live.length) continue;
    const target = live[0];
    const learning = [...group].sort((a, b) => learningTimestamp(b) - learningTimestamp(a)
      || recordTimestamp(b) - recordTimestamp(a) || String(a.id).localeCompare(String(b.id)))[0];
    const merged = { ...target };
    // Aggregate snapshots overlap. Adding them would count shared reviews twice.
    for (const field of LEARNING_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(learning, field)) merged[field] = learning[field];
      else delete merged[field];
    }
    merged.sourceDefinitions = [...new Set(group.flatMap(word => [word.sourceDefinition || word.definition, ...(word.sourceDefinitions || [])]))].sort().slice(0, 12);
    merged.groupedSenses = normalizeGroupedSenses([...new Map(group.flatMap(originalSenses)
      .map(sense => [JSON.stringify([sense.id, sense.sourceDefinition || sense.definition]), sense])).values()]);
    merged.updatedAt = new Date(Math.max(...group.map(recordTimestamp))).toISOString();
    const canonical = withReviewHistorySources(merged, sources);
    const targetTombstone = tombstones.get(target.id);
    if (targetTombstone?.mergedInto && !targetTombstone.deletedSources?.length) tombstones.delete(target.id);
    for (const word of group) {
      words.delete(word.id);
      if (word.id === target.id) continue;
      const existing = tombstones.get(word.id);
      if (!existing || existing.mergedInto || !wordIsDeleted(word, existing)) {
        tombstones.set(word.id, { id: word.id, senseId: word.senseId || '', monthYear: word.monthYear,
          courseId: word.courseId || 'english', sourceFingerprint: sourceDefinitionFingerprint(word), mergedInto: target.id,
          deletedAt: new Date(Math.max(recordTimestamp(canonical), Date.parse(existing?.deletedAt) || 0)).toISOString() });
      }
    }
    words.set(canonical.id, canonical);
  }
}


export function mergeDriveSettings(localSettings = {}, remoteSettings = {}, { freshInstall = false } = {}) {
  const base = remoteSettings && Object.keys(remoteSettings).length
    && (freshInstall || recordTimestamp(remoteSettings) > recordTimestamp(localSettings))
    ? remoteSettings
    : localSettings;
  const mergedCourses = mergeCourseProfiles(freshInstall ? {} : localSettings, remoteSettings);
  return migrateCourseSettings({ ...base, fsrs: mergeFsrsConfig(localSettings.fsrs, remoteSettings.fsrs, base.fsrs), imageLearning: mergeImageLearning(localSettings.imageLearning, remoteSettings.imageLearning), activeCourseId: mergedCourses.activeCourseId, courseProfiles: mergedCourses.courseProfiles });
}

function normalizeStoredWord(candidate, fallbackMonthYear = null, fallbackSource = 'drive') {
  if (!candidate || !isCourseId(candidate.courseId || 'english') || !/^en(?:-|$)/i.test(candidate.languageCode || 'en')) return null;
  const word = normalizeWordText(candidate.word).toLowerCase();
  if (!word || word.length > 100) return null;
  const createdAt = validIso(candidate.createdAt);
  const monthYear = candidate.monthYear || fallbackMonthYear || monthYearFromDate(createdAt);
  const partOfSpeech = String(candidate.partOfSpeech || 'unknown').trim().toLowerCase();
  const definition = String(candidate.definition || '').trim();
  const id = String(candidate.id || makeWordId(word, monthYear, partOfSpeech, definition));
  const courseId = String(candidate.courseId || 'english');
  const course = getCourseDefinition(courseId);
  const translation = !candidate.translationLanguage || ['en', 'uk'].includes(candidate.translationLanguage) ? String(candidate.translation || '').trim() : '';
  const translationLanguage = translation && (candidate.translationLanguage === 'uk' || (!candidate.translationLanguage && /[А-Яа-яІіЇїЄєҐґ]/u.test(translation))) ? 'uk' : 'en';

  const normalized = {
    ...candidate,
    id,
    senseId: String(candidate.senseId || makeSenseId(word, partOfSpeech, candidate.sourceDefinition || definition)),
    courseId: course.id,
    languageCode: course.languageCode,
    translationLanguage,
    lemma: String(candidate.lemma || word).trim().toLowerCase(),
    translation,
    acceptedForms: [...new Set((Array.isArray(candidate.acceptedForms) ? candidate.acceptedForms : [word]).map(value => String(value || '').trim().toLowerCase()).filter(Boolean))],
    grammaticalTags: [...new Set((Array.isArray(candidate.grammaticalTags) ? candidate.grammaticalTags : []).map(value => String(value || '').trim()).filter(Boolean))],
    labels: [...new Set((Array.isArray(candidate.labels) ? candidate.labels : []).map(value => String(value || '').trim()).filter(Boolean))],
    word,
    phonetic: String(candidate.phonetic || '').trim(),
    partOfSpeech,
    definition: definition || 'Definition not provided.',
    sourceDefinition: String(candidate.sourceDefinition || definition).trim(),
    sourceDefinitions: [...new Set((Array.isArray(candidate.sourceDefinitions) ? candidate.sourceDefinitions : []).map(String).map(value => value.trim()).filter(Boolean))].slice(0, 12),
    groupedSenses: normalizeGroupedSenses(candidate.groupedSenses),
    sourceFingerprint: String(candidate.sourceFingerprint || ''),
    explanationSource: String(candidate.explanationSource || ''),
    explanationModel: String(candidate.explanationModel || ''),
    explanationVersion: Number(candidate.explanationVersion) || 0,
    meaningSupport: normalizeMeaningSupport(candidate.meaningSupport),
    usageNote: String(candidate.usageNote || '').trim(),
    otherDefinitions: Array.isArray(candidate.otherDefinitions) ? candidate.otherDefinitions.filter(value => typeof value === 'string').map(value => value.slice(0, 1500)).slice(0, 8) : [],
    example: String(candidate.example || '').trim(),
    imageScenes: normalizeImageScenes(candidate.imageScenes),
    imageCustomConcept: String(candidate.imageCustomConcept || '').trim().slice(0, 160),
    imageFeedback: candidate.imageFeedback && typeof candidate.imageFeedback === 'object' ? {
      rejectedUrls: [...new Set((candidate.imageFeedback.rejectedUrls || []).map(String).filter(Boolean))].slice(0, 80),
      goodUrls: [...new Set((candidate.imageFeedback.goodUrls || []).map(String).filter(Boolean))].slice(0, 40),
      preferredConcepts: [...new Set((candidate.imageFeedback.preferredConcepts || []).map(String).filter(Boolean))].slice(0, 20),
      senseFingerprint: String(candidate.imageFeedback.senseFingerprint || ''),
      updatedAt: candidate.imageFeedback.updatedAt || null
    } : undefined,
    audioUrl: String(candidate.audioUrl || '').trim(),
    imageUrl: safeImageUrl(candidate.imageUrl),
    imageSourceUrl: safeImageSourceUrl(candidate.imageSourceUrl),
    notebook: notebookFromMonthYear(monthYear),
    monthYear,
    box: Number(candidate.box) >= 1 && Number(candidate.box) <= 5 ? Number(candidate.box) : 1,
    nextReviewDate: validIso(candidate.nextReviewDate, createdAt),
    mastered: Boolean(candidate.mastered),
    createdAt,
    updatedAt: validIso(candidate.updatedAt || candidate.lastReviewedAt, createdAt),
    source: String(candidate.source || fallbackSource)
  };
  return withReviewHistorySources(normalized, reviewHistorySources(normalized));
}

function normalizeTombstone(candidate, fallbackMonthYear = null) {
  const id = String(candidate?.id || '').trim();
  if (!id) return null;
  const deletedSources = normalizeReviewHistorySources(candidate.deletedSources);
  return {
    id,
    senseId: String(candidate.senseId || ''),
    monthYear: candidate.monthYear || fallbackMonthYear || monthYearFromDate(candidate.deletedAt),
    deletedAt: validIso(candidate.deletedAt),
    ...(candidate.mergedInto ? { mergedInto: String(candidate.mergedInto).slice(0, 500), sourceFingerprint: String(candidate.sourceFingerprint || ''), courseId: candidate.courseId || 'english' } : {}),
    ...(deletedSources.length > 1 ? { deletedSources, courseId: candidate.courseId || 'english' } : {})
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
    this.googleAuthGeneration = 0;
    this.tokenRefreshPromise = null;
    this.syncPromise = null;
    this.credentialCleanupPayloads = new Map();
    this.suppressEvents = false;
    this.isFreshInstall = !this.storage.getItem(STORAGE_KEY_WORDS);
    this.deviceId = this.getOrCreateDeviceId();
    this.reviewHistory = new ReviewHistoryStore(storage);
    this.imageHistory = new ImageLearningHistoryStore(storage);
    this.initStorage();
    this.restoreGoogleToken();
  }

  appendReviewEvent(event) { return this.reviewHistory.append(event); }
  getReviewEvents() { return this.reviewHistory.all(); }

  async archiveLegacyImageLearning(data = this.getSettings().imageLearning) {
    const signature = JSON.stringify(data || {});
    if (signature === this.imageMigrationSignature) return;
    const records = (data?.records || []).map(record => ({ ...record, id: `legacy:${record.id}:${record.updatedAt}`, key: record.id,
      decisionId: `legacy:${record.id}`, encoder: record.model?.replace(/:pairwise-v1$/, '') || LEGACY_CLIP_TAG, deviceId: this.deviceId }));
    await this.imageHistory.merge(records, data?.resetAt || '');
    this.imageMigrationSignature = signature;
  }
  async getImageEvents() { await this.archiveLegacyImageLearning(); return this.imageHistory.all(); }
  async appendImageEvent(event) { const result = await this.imageHistory.append({ ...event, deviceId: this.deviceId }); this.emitChange('image-preferences'); return result; }

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
        reminderEnabled: true,
        reminderExplicitlyDisabled: false,
        smartReminderEnabled: true,
        streakReminderEnabled: true,
        reminderTime: '19:00',
        reviewStartMoments: [],
        soundEnabled: true,
        updatedAt: new Date().toISOString()
      });
    }
    this.write(STORAGE_KEY_SETTINGS, migrateCourseSettings(this.read(STORAGE_KEY_SETTINGS, {})));
    const storedWords = this.getAllWords();
    const migratedWords = storedWords.map(word => normalizeStoredWord(word, word?.monthYear, word?.source || 'local')).filter(Boolean);
    const removed = storedWords.filter(word => word?.id && !normalizeStoredWord(word)).map(word => normalizeTombstone({ ...word, deletedAt: new Date().toISOString() })).filter(Boolean);
    if (removed.length) this.saveTombstones([...this.getTombstones(), ...removed], { silent: true });
    this.saveWords(migratedWords, { silent: true });
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
    if (typeof settings.reminderEnabled !== 'boolean') engagementDefaults.reminderEnabled = settings.reminderExplicitlyDisabled !== true;
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
    const generation = ++this.googleAuthGeneration;
    this.tokenRefreshPromise = null;
    const nativeAuth = getNativeDriveAuthPlugin();
    if (nativeAuth) {
      const result = await nativeAuth.authorize({ interactive: true });
      this.assertGoogleAuthGeneration(generation);
      this.acceptGoogleToken({ access_token: result.accessToken, expires_in: result.expiresIn });
      return this.finishGoogleConnection(generation);
    }
    if (!globalThis.google?.accounts?.oauth2) throw new Error('Google Identity Services did not load. Check your connection and try again.');
    const tokenResponse = await this.requestGoogleToken(GOOGLE_WEB_CLIENT_ID, 'consent');
    this.assertGoogleAuthGeneration(generation);
    this.acceptGoogleToken(tokenResponse);
    return this.finishGoogleConnection(generation);
  }

  assertGoogleAuthGeneration(generation) {
    if (generation !== this.googleAuthGeneration) {
      throw Object.assign(new Error('Google Drive authorization was cancelled.'), { code: 'DRIVE_AUTH_CANCELLED' });
    }
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
    const generation = this.googleAuthGeneration;
    const renewal = (async () => {
      const nativeAuth = getNativeDriveAuthPlugin();
      const clientId = this.getGoogleClientId();
      if (!nativeAuth && !clientId) throw new Error('Connect Google Drive once on this device to enable automatic renewal.');
      if (!nativeAuth && !globalThis.google?.accounts?.oauth2) throw new Error('Google Identity Services did not load.');
      const tokenResponse = nativeAuth
        ? await nativeAuth.authorize({ interactive }).then(result => ({ access_token: result.accessToken, expires_in: result.expiresIn }))
        : await this.requestGoogleToken(clientId, interactive ? 'consent' : 'none');
      this.assertGoogleAuthGeneration(generation);
      this.acceptGoogleToken(tokenResponse);
      this.setDriveStatus({ isConnected: true, remembered: true, lastError: null });
      return tokenResponse;
    })();
    this.tokenRefreshPromise = renewal;
    try {
      return await renewal;
    } finally {
      if (this.tokenRefreshPromise === renewal) this.tokenRefreshPromise = null;
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

  async finishGoogleConnection(generation = this.googleAuthGeneration) {
    try {
      this.assertGoogleAuthGeneration(generation);
      this.setDriveStatus({ isConnected: true, remembered: true, lastError: null });
      const sync = await this.syncGoogleDrive();
      this.assertGoogleAuthGeneration(generation);
      return { ...sync };
    } catch (error) {
      this.assertGoogleAuthGeneration(generation);
      this.setDriveStatus({ isConnected: true, lastError: error.message });
      throw error;
    }
  }

  async resumeGoogleDrive() {
    const generation = this.googleAuthGeneration;
    const status = this.getDriveStatus();
    if (!status.remembered) return null;
    try {
      await this.renewGoogleToken({ interactive: false });
      this.assertGoogleAuthGeneration(generation);
      return await this.finishGoogleConnection(generation);
    } catch (error) {
      this.assertGoogleAuthGeneration(generation);
      this.clearGoogleToken();
      this.setDriveStatus({ isConnected: false, remembered: true, lastError: this.renewalFailureMessage(error) });
      throw error;
    }
  }

  disconnectGoogleDrive(revoke = true) {
    this.googleAuthGeneration += 1;
    this.tokenRefreshPromise = null;
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
    const generation = this.googleAuthGeneration;
    if (!this.fetchImpl) throw new Error('This browser does not support network requests.');
    if (!this.accessToken || Date.now() >= this.tokenExpiresAt) {
      this.clearGoogleToken();
      if (!this.getDriveStatus().remembered) throw new Error('Connect Google Drive to start syncing.');
      try {
        await this.renewGoogleToken({ interactive: false });
        this.assertGoogleAuthGeneration(generation);
      } catch (error) {
        this.assertGoogleAuthGeneration(generation);
        const message = this.renewalFailureMessage(error);
        this.setDriveStatus({ isConnected: false, remembered: true, lastError: message });
        throw new Error(message, { cause: error });
      }
    }
    const response = await this.fetchImpl(url, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${this.accessToken}` }
    });
    this.assertGoogleAuthGeneration(generation);
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json())?.error?.message || ''; } catch { /* non-JSON failure */ }
      this.assertGoogleAuthGeneration(generation);
      if (response.status === 401 && !retriedAfterRenewal && this.getDriveStatus().remembered) {
        this.clearGoogleToken();
        try {
          await this.renewGoogleToken({ interactive: false });
          this.assertGoogleAuthGeneration(generation);
          return this.authorizedFetch(url, options, true);
        } catch (error) {
          this.assertGoogleAuthGeneration(generation);
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
      throw Object.assign(new Error(`Google Drive request failed (${response.status}).${detail ? ` ${detail}` : ''}`), { status: response.status });
    }
    return response;
  }

  async listFiles(query) {
    const params = new URLSearchParams({
      q: query,
      spaces: 'drive',
      pageSize: '1000',
      fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,appProperties,parents)'
    });
    const files = [];
    let nextPageToken;
    do {
      if (nextPageToken) params.set('pageToken', nextPageToken);
      const response = await this.authorizedFetch(`${DRIVE_API_BASE}/files?${params}`);
      const payload = await response.json();
      if (Array.isArray(payload.files)) files.push(...payload.files);
      nextPageToken = payload.nextPageToken;
    } while (nextPageToken);
    return files;
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

  async downloadJsonFile(fileId, { cleanupCredentials = false } = {}) {
    const response = await this.authorizedFetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`);
    const payload = await response.json();
    const clean = withoutDriveCredentials(payload);
    if (cleanupCredentials && JSON.stringify(clean) !== JSON.stringify(payload)) {
      this.credentialCleanupPayloads.set(fileId, { payload: clean, etag: response.headers?.get('ETag') || null });
    }
    return clean;
  }

  async createJsonFile(folderId, name, kind, payload, monthYear = '', properties = {}) {
    const boundary = `keepvocab_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const metadata = {
      name,
      mimeType: 'application/json',
      parents: [folderId],
      appProperties: {
        [BACKUP_APP_PROPERTY]: 'data',
        kind,
        schemaVersion: String(SCHEMA_VERSION),
        ...(monthYear ? { monthYear } : {}),
        ...properties
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
      JSON.stringify(withoutDriveCredentials(payload)),
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

  async updateJsonFile(fileId, payload, { ifMatch } = {}) {
    const response = await this.authorizedFetch(`${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name,modifiedTime`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(ifMatch ? { 'If-Match': ifMatch } : {}) },
      body: JSON.stringify(withoutDriveCredentials(payload))
    });
    this.credentialCleanupPayloads.delete(fileId);
    return response.json();
  }

  async updateSettingsBackup(fileId, payload) {
    const cleanup = this.credentialCleanupPayloads.get(fileId);
    // Never rewrite a downloaded legacy snapshot without a usable concurrency
    // guard. A later sync can retry when the ETag is exposed and unchanged.
    if (cleanup && (!cleanup.etag || /^W\//i.test(cleanup.etag))) return false;
    try {
      await this.updateJsonFile(fileId, payload, { ifMatch: cleanup?.etag });
      return true;
    } catch (error) {
      if (error.status !== 412 || !cleanup) throw error;
      this.credentialCleanupPayloads.delete(fileId);
      return false;
    }
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
    return this.getAllWords().filter(word => (word.courseId || 'english') === this.getActiveCourseId());
  }

  getAllWords() {
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
      .map(wordObj => normalizeStoredWord({ ...wordObj, courseId: wordObj?.courseId || this.getActiveCourseId(), createdAt: wordObj?.createdAt || now, updatedAt: now }, monthYear, 'manual'));
    if (!candidates.length || candidates.some(word => !word)) throw new Error('Enter at least one valid meaning.');
    const identities = candidates.map(senseIdentity);
    if (new Set(identities).size !== identities.length) throw new Error('The selected meanings contain a duplicate definition.');
    const existing = this.getAllWords();
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
    const words = this.getAllWords();
    const index = words.findIndex(word => word.id === wordId);
    if (index === -1) throw new Error('That vocabulary entry no longer exists.');
    const allowed = ['word', 'phonetic', 'partOfSpeech', 'definition', 'sourceDefinition', 'sourceFingerprint', 'usageNote', 'explanationSource', 'explanationModel', 'example', 'lemma', 'translation', 'translationLanguage', 'exampleSourceUrl', 'exampleAttribution', 'exampleLicense', 'audioUrl', 'imageUrl', 'imageSourceUrl', 'imageAttribution', 'imageLicense', 'imageSearchQuery', 'imageCustomConcept', 'imageKind', 'imageGeneratedModel', 'imageGeneratedAt', 'imageGeneratedPrompt'];
    const cleanPatch = Object.fromEntries(allowed.filter(key => Object.prototype.hasOwnProperty.call(patch, key)).map(key => [key, String(patch[key] ?? '').trim()]));
    if (Object.prototype.hasOwnProperty.call(patch, 'meaningSupport')) cleanPatch.meaningSupport = normalizeMeaningSupport(patch.meaningSupport);
    if (Object.prototype.hasOwnProperty.call(patch, 'explanationVersion')) cleanPatch.explanationVersion = Number(patch.explanationVersion) || 0;
    if (Object.prototype.hasOwnProperty.call(patch, 'imageScenes')) cleanPatch.imageScenes = normalizeImageScenes(patch.imageScenes);
    if (Array.isArray(patch.groupedSenses)) cleanPatch.groupedSenses = normalizeGroupedSenses(patch.groupedSenses);
    if (Array.isArray(patch.sourceDefinitions)) cleanPatch.sourceDefinitions = [...new Set(patch.sourceDefinitions.map(String).map(value => value.trim()).filter(Boolean))].slice(0, 12);
    if (Array.isArray(patch.labels)) cleanPatch.labels = [...new Set(patch.labels.map(String).map(value => value.trim()).filter(Boolean))].slice(0, 20);
    if (patch.imageFeedback && typeof patch.imageFeedback === 'object') cleanPatch.imageFeedback = {
      rejectedUrls: [...new Set((patch.imageFeedback.rejectedUrls || []).map(String).filter(Boolean))].slice(0, 80),
      goodUrls: [...new Set((patch.imageFeedback.goodUrls || []).map(String).filter(Boolean))].slice(0, 40),
      preferredConcepts: [...new Set((patch.imageFeedback.preferredConcepts || []).map(String).filter(Boolean))].slice(0, 20),
      senseFingerprint: String(patch.imageFeedback.senseFingerprint || ''),
      updatedAt: patch.imageFeedback.updatedAt || new Date().toISOString()
    };
    if (cleanPatch.word !== undefined) cleanPatch.word = normalizeWordText(cleanPatch.word).toLowerCase();
    if (!cleanPatch.word && cleanPatch.word !== undefined) throw new Error('Word cannot be empty.');
    if (!cleanPatch.definition && cleanPatch.definition !== undefined) throw new Error('Definition cannot be empty.');
    if (cleanPatch.imageCustomConcept !== undefined) cleanPatch.imageCustomConcept = cleanPatch.imageCustomConcept.slice(0, 160);
    if (cleanPatch.imageUrl !== undefined) {
      const url = safeImageUrl(cleanPatch.imageUrl);
      if (cleanPatch.imageUrl && !url) throw new Error('Image URL must start with https:// or be a PNG, JPEG, WebP, or GIF data image.');
      cleanPatch.imageUrl = url;
    }
    if (cleanPatch.imageSourceUrl !== undefined) {
      const url = safeImageSourceUrl(cleanPatch.imageSourceUrl);
      if (cleanPatch.imageSourceUrl && !url) throw new Error('Image source URL must start with https:// and contain no credentials.');
      cleanPatch.imageSourceUrl = url;
    }
    const translation = cleanPatch.translation ?? words[index].translation;
    const translationLanguage = !translation ? 'en' : ['en', 'uk'].includes(cleanPatch.translationLanguage) ? cleanPatch.translationLanguage
      : cleanPatch.translation === undefined ? words[index].translationLanguage || 'en'
        : /[А-Яа-яІіЇїЄєҐґ]/u.test(translation) ? 'uk' : 'en';
    if (cleanPatch.definition !== undefined && cleanPatch.definition !== words[index].definition && cleanPatch.sourceDefinition === undefined) {
      cleanPatch.sourceDefinition = cleanPatch.definition;
      cleanPatch.sourceFingerprint = '';
      cleanPatch.explanationSource = 'manual';
    }
    const updated = { ...words[index], ...cleanPatch, translationLanguage, updatedAt: new Date().toISOString() };
    if (sourceDefinitionFingerprint(updated) !== sourceDefinitionFingerprint(words[index])) {
      delete updated.reviewHistoryIdentity;
      delete updated.reviewHistoryAliases;
    }
    delete updated.conciseDefinition;
    delete updated.conciseDefinitionSource;
    if (semanticIdentity(updated) !== semanticIdentity(words[index])) {
      delete updated.imageScenes;
      delete updated.imageFeedback;
      delete updated.imageRejectedUrls;
      if (cleanPatch.imageUrl === undefined) {
        for (const key of ['imageUrl', 'imageSourceUrl', 'imageAttribution', 'imageLicense', 'imageSearchQuery']) updated[key] = '';
      }
    }
    if (words.some((word, candidateIndex) => candidateIndex !== index && senseIdentity(word) === senseIdentity(updated))) {
      throw new Error(`That meaning of “${updated.word}” is already in ${updated.notebook}.`);
    }
    words[index] = updated;
    this.saveWords(words);
    return updated;
  }

  mergeWordMeanings(wordIds) {
    const ids = new Set((wordIds || []).map(String));
    const words = this.getAllWords();
    const records = words.filter(word => ids.has(String(word.id)));
    if (ids.size < 2 || records.length !== ids.size) throw new Error('The duplicate meanings changed. Review them again before merging.');
    const first = records[0];
    const sameContext = records.every(word => ['word', 'partOfSpeech', 'monthYear', 'courseId'].every(key => (word[key] || '') === (first[key] || '')));
    const sameMeaning = records.every((left, index) => records.slice(index + 1).every(right => areSensesNearDuplicate(left, right)));
    if (!sameContext || !sameMeaning) throw new Error('Only near-identical meanings of the same word in this month can be merged.');
    const stats = records.map(normalizeWordPracticeStats);
    const latest = [...records].sort((a, b) => learningTimestamp(b) - learningTimestamp(a))[0];
    const target = [...records].sort((a, b) => normalizeWordPracticeStats(b).attempts - normalizeWordPracticeStats(a).attempts || String(a.id).localeCompare(String(b.id)))[0];
    let merged = { ...target };
    for (const field of ['srs', 'mastery', 'lastExerciseResult', 'lastReviewedAt']) if (latest[field] !== undefined) merged[field] = latest[field];
    const latestStats = normalizeWordPracticeStats(latest);
    const sum = key => stats.reduce((total, item) => total + Number(item[key] || 0), 0);
    const maxDate = key => { const timestamp = newestTimestamp(...stats.map(item => item[key])); return timestamp ? new Date(timestamp).toISOString() : ''; };
    const byMode = {};
    for (const mode of new Set(stats.flatMap(item => Object.keys(item.byMode)))) {
      const items = stats.map(item => item.byMode[mode]).filter(Boolean);
      byMode[mode] = Object.fromEntries(['selections', 'attempts', 'recalled', 'missed'].map(key => [key, items.reduce((total, item) => total + Number(item[key] || 0), 0)]));
      for (const key of ['lastSelectedAt', 'lastAnsweredAt']) { const at = newestTimestamp(...items.map(item => item[key])); byMode[mode][key] = at ? new Date(at).toISOString() : ''; }
    }
    merged.practiceStats = { ...latestStats,
      ...Object.fromEntries(['attempts', 'recalled', 'missed', 'selections', 'recallAttempts', 'unaidedRecalled', 'recognitionCorrect', 'assistedCorrect', 'hintsUsed', 'timedRecallCount', 'recallTimeTotalMs'].map(key => [key, sum(key)])),
      // Historical day counts lack complete date sets; adding them would invent retention days.
      successfulRecallDays: Math.max(...stats.map(item => item.successfulRecallDays)),
      legacySuccessfulReviews: Math.max(...stats.map(item => item.legacySuccessfulReviews)),
      lastUnaidedRecallAt: maxDate('lastUnaidedRecallAt'), lastCorrectAt: maxDate('lastCorrectAt'),
      lastMissedAt: maxDate('lastMissedAt'), lastSelectedAt: maxDate('lastSelectedAt'),
      recentResults: stats.flatMap(item => item.recentResults).sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt)).slice(-20), byMode };
    const mistakes = records.map(word => word.mistakes || {});
    const summedMap = key => {
      const result = {};
      for (const item of mistakes) for (const [name, count] of Object.entries(item[key] || {})) result[name] = (result[name] || 0) + Math.max(0, Number(count) || 0);
      return result;
    };
    const lastMistakeAt = newestTimestamp(...mistakes.map(item => item.lastMistakeAt));
    merged.mistakes = { version: 1,
      incorrectAttempts: mistakes.reduce((total, item) => total + Math.max(0, Number(item.incorrectAttempts) || 0), 0),
      consecutiveFailures: Math.max(0, Number(latest.mistakes?.consecutiveFailures) || 0),
      lastMistakeAt: lastMistakeAt ? new Date(lastMistakeAt).toISOString() : '',
      recentFailures: mistakes.flatMap(item => Array.isArray(item.recentFailures) ? item.recentFailures : []).filter(value => Number.isFinite(Date.parse(value))).sort((a, b) => Date.parse(a) - Date.parse(b)).slice(-20),
      byExercise: summedMap('byExercise'), confusions: summedMap('confusions') };
    merged.productiveSamples = [...new Map(records.flatMap(word => Array.isArray(word.productiveSamples) ? word.productiveSamples : []).map(sample => [JSON.stringify([sample.createdAt, sample.exerciseType, sample.text, sample.correct]), sample])).values()]
      .sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0)).slice(-20);
    for (const key of ['lastRecalledAt', 'lastPracticedAt']) {
      const at = newestTimestamp(...records.map(word => word[key]));
      if (at) merged[key] = new Date(at).toISOString();
    }
    merged.box = Math.min(...records.map(word => Number(word.box) || 1));
    merged.mastered = records.every(word => word.mastered);
    const reviewDates = records.map(word => Date.parse(word.nextReviewDate || word.createdAt)).filter(Number.isFinite);
    merged.nextReviewDate = new Date(reviewDates.length ? Math.min(...reviewDates) : Date.now()).toISOString();
    merged.sourceDefinitions = [...new Set(records.flatMap(word => [word.sourceDefinition || word.definition, ...(word.sourceDefinitions || [])]))].slice(0, 12);
    merged.groupedSenses = normalizeGroupedSenses(records.flatMap(originalSenses));
    merged = withReviewHistorySources(merged, records.flatMap(reviewHistorySources));
    merged.updatedAt = new Date().toISOString();
    const removed = records.filter(word => word.id !== merged.id);
    const tombstones = this.getTombstones().filter(item => !removed.some(word => word.id === item.id));
    tombstones.push(...removed.map(word => ({ id: word.id, senseId: word.senseId || '', monthYear: word.monthYear,
      courseId: word.courseId || 'english', sourceFingerprint: sourceDefinitionFingerprint(word), mergedInto: merged.id, deletedAt: merged.updatedAt })));
    this.saveTombstones(tombstones, { silent: true });
    this.saveWords(words.flatMap(word => !ids.has(String(word.id)) ? [word] : word.id === merged.id ? [merged] : []));
    this.refreshNotebooks();
    return merged;
  }

  deleteWord(wordId) {
    const words = this.getAllWords();
    const deleted = words.find(word => word.id === wordId);
    if (!deleted) return false;
    const tombstones = this.getTombstones().filter(item => item.id !== deleted.id);
    const deletedSources = reviewHistorySources(deleted);
    tombstones.push({ id: deleted.id, senseId: deleted.senseId || '', monthYear: deleted.monthYear, deletedAt: new Date().toISOString(),
      ...(deletedSources.length > 1 ? { deletedSources, courseId: deleted.courseId || 'english' } : {}) });
    this.suppressEvents = true;
    this.saveWords(words.filter(word => word.id !== wordId), { silent: true });
    this.saveTombstones(tombstones, { silent: true });
    this.refreshNotebooks();
    this.suppressEvents = false;
    this.emitChange('library');
    return true;
  }

  getSettings() {
    const settings = migrateCourseSettings(this.read(STORAGE_KEY_SETTINGS, {}));
    for (const profile of Object.values(settings.courseProfiles)) {
      const shards = activityByDevice(profile);
      profile.exerciseActivityByDevice = shards;
      profile.reviewActivity = aggregateActivity(shards);
      Object.assign(profile, currentStudyStats(profile));
    }
    return migrateCourseSettings(settings);
  }

  updateSettings(patch, { silent = false } = {}) {
    const settings = updateActiveCourseSettings(this.getSettings(), { ...patch, updatedAt: new Date().toISOString() });
    this.write(STORAGE_KEY_SETTINGS, settings);
    this.isFreshInstall = false;
    if (!silent) this.emitChange('settings');
    return settings;
  }

  getActiveCourseId() {
    return this.getSettings().activeCourseId || 'english';
  }

  getCourseProfile(courseId = this.getActiveCourseId()) {
    const settings = this.getSettings();
    return settings.courseProfiles?.[courseId] || null;
  }

  updateCourseProfile(courseId, patch = {}, { silent = false } = {}) {
    const settings = this.getSettings();
    if (!isCourseId(courseId)) throw new Error(`Unknown course: ${courseId}`);
    const previous = settings.courseProfiles?.[courseId] || {};
    const timestamp = new Date().toISOString();
    const profile = { ...previous, ...stampPracticePreferences(previous, patch, timestamp), courseId, updatedAt: timestamp };
    const next = { ...settings, courseProfiles: { ...settings.courseProfiles, [courseId]: profile }, updatedAt: new Date().toISOString() };
    const normalized = courseId === settings.activeCourseId ? migrateCourseSettings({ ...next, ...profile }) : next;
    this.write(STORAGE_KEY_SETTINGS, normalized);
    this.isFreshInstall = false;
    if (!silent) this.emitChange('settings');
    return profile;
  }

  setActiveCourseId(courseId) {
    const settings = switchActiveCourse(this.getSettings(), courseId);
    settings.updatedAt = new Date().toISOString();
    this.write(STORAGE_KEY_SETTINGS, settings);
    this.isFreshInstall = false;
    this.refreshNotebooks();
    this.emitChange('course');
    return courseId;
  }

  recordReview(date = new Date()) {
    const key = localDateKey(date);
    const settings = this.getSettings();
    const exerciseActivityByDevice = activityByDevice(settings);
    const previousActivity = aggregateActivity(exerciseActivityByDevice);
    const previousStreak = streakFromActivity(previousActivity, date);
    const firstActivityToday = !(Number(previousActivity[key]) > 0);
    const deviceActivity = { ...(exerciseActivityByDevice[this.deviceId] || {}) };
    deviceActivity[key] = Number(deviceActivity[key] || 0) + 1;
    exerciseActivityByDevice[this.deviceId] = normalizedActivity(deviceActivity);
    const reviewActivity = aggregateActivity(exerciseActivityByDevice);
    this.updateSettings({
      exerciseActivityByDevice,
      reviewActivity,
      reviewsDate: key,
      reviewsToday: Number(reviewActivity[key] || 0),
      lastReviewDate: key,
      dailyStreak: streakFromActivity(reviewActivity, date)
    });
    // The first exercise of a local day extends (or starts) the streak once.
    // Synced activity from another device never reaches this path.
    const streak = streakFromActivity(reviewActivity, date);
    if (firstActivityToday && streak > previousStreak && localDateKey(date) === localDateKey(new Date())
        && typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
      globalThis.dispatchEvent(new CustomEvent('keepvocab:streak-extended', { detail: { streak, previousStreak, date: key } }));
    }
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
    if (this.syncPromise && this.syncGeneration === this.googleAuthGeneration) return this.syncPromise;
    this.syncGeneration = this.googleAuthGeneration;
    const sync = this.performDriveSync().finally(() => { if (this.syncPromise === sync) this.syncPromise = null; });
    this.syncPromise = sync;
    return sync;
  }

  async performDriveSync() {
    const generation = this.googleAuthGeneration;
    this.credentialCleanupPayloads.clear();
    const folder = await this.findOrCreateBackupFolder();
    const files = await this.listBackupFiles(folder.id);
    const monthlyFiles = new Map();
    const reviewFiles = [];
    const imageFiles = [];
    const settingsFiles = [];
    let settingsFile = null;
    for (const file of files) {
      if (file.appProperties?.kind === 'month' && file.appProperties?.monthYear) {
        const group = monthlyFiles.get(file.appProperties.monthYear) || [];
        group.push(file);
        monthlyFiles.set(file.appProperties.monthYear, group);
      } else if (file.appProperties?.kind === 'reviews') {
        reviewFiles.push(file);
      } else if (file.appProperties?.kind === 'image-feedback-v2') {
        imageFiles.push(file);
      } else if (file.appProperties?.kind === 'settings') {
        settingsFiles.push(file);
      }
    }
    settingsFile = settingsFiles.sort((a, b) => (Date.parse(b.modifiedTime) || 0) - (Date.parse(a.modifiedTime) || 0))[0] || null;

    const remoteByMonth = new Map();
    for (const [monthYear, group] of monthlyFiles) {
      const payloads = [];
      for (const file of group) payloads.push({ file, payload: await this.downloadJsonFile(file.id) });
      remoteByMonth.set(monthYear, payloads);
    }

    const reviewPayloads = [];
    for (const file of reviewFiles) {
      const payload = await this.downloadJsonFile(file.id);
      if (Number(payload?.schemaVersion) !== SCHEMA_VERSION || !Array.isArray(payload.events)) continue;
      reviewPayloads.push({ file, payload });
    }
    if (reviewPayloads.length) await this.reviewHistory.merge(reviewPayloads.flatMap(({ file, payload }) => payload.events
      .map(event => ({ ...event, deviceId: event.deviceId || file.appProperties?.deviceId || '' }))));
    const localReviewEvents = await this.getReviewEvents();
    const imagePayloads = [];
    for (const file of imageFiles) {
      const payload = await this.downloadJsonFile(file.id);
      if (payload?.formatVersion !== 2 || !Array.isArray(payload.records)) continue;
      imagePayloads.push({ file, payload });
      await this.imageHistory.merge(payload.records.map(record => ({ ...record, deviceId: record.deviceId || file.appProperties?.deviceId || '' })), payload.resetAt);
    }
    const localWordsForSync = this.getAllWords();
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
        if (![1, SCHEMA_VERSION].includes(Number(payload?.schemaVersion)) || payload?.monthYear !== monthYear) continue;
        for (const candidate of Array.isArray(payload.words) ? payload.words : []) {
          const word = normalizeStoredWord(candidate, monthYear, 'drive');
          if (!word) {
            const removed = normalizeTombstone({ ...candidate, deletedAt: new Date().toISOString() }, monthYear);
            if (removed) tombstoneMap.set(removed.id, removed);
            continue;
          }
          const existing = wordMap.get(word.id);
          if (!existing) restoredWords += 1;
          wordMap.set(word.id, existing ? mergeStoredWord(existing, word) : word);
        }
        for (const candidate of Array.isArray(payload.tombstones) ? payload.tombstones : []) {
          const item = normalizeTombstone(candidate, monthYear);
          if (!item) continue;
          tombstoneMap.set(item.id, mergeTombstone(tombstoneMap.get(item.id), item));
        }
      }

      reconcileMergedMeanings(wordMap, tombstoneMap);
      for (const [id, word] of wordMap) {
        const tombstone = tombstoneMap.get(id);
        if (!wordIsDeleted(word, tombstone)) finalWords.push(word);
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
    // Read every settings copy so legacy credentials are removed from duplicate
    // backup files as well as from the primary one.
    for (const file of settingsFiles) {
      const payload = await this.downloadJsonFile(file.id, { cleanupCredentials: true });
      if (file.id === settingsFile.id) remoteSettingsPayload = payload;
    }
    const remoteSettings = remoteSettingsPayload?.settings || {};
    settings = mergeDriveSettings(localSettings, remoteSettings, { freshInstall: this.isFreshInstall });
    const localGemini = getGeminiBackupRecord(this.storage);
    const remoteGemini = sanitizeGeminiBackupRecord(remoteSettingsPayload?.googleAiStudio);
    const chosenGemini = remoteGemini && (this.isFreshInstall || !localGemini || recordTimestamp(remoteGemini) > recordTimestamp(localGemini))
      ? remoteGemini
      : localGemini;
    const localImageProvider = getImageProviderBackupRecord(this.storage);
    const remoteImageProvider = sanitizeImageProviderBackupRecord(remoteSettingsPayload?.imageSearchProvider);
    const chosenImageProvider = remoteImageProvider && (this.isFreshInstall || !localImageProvider || recordTimestamp(remoteImageProvider) > recordTimestamp(localImageProvider))
      ? remoteImageProvider
      : localImageProvider;
    const settingsPayload = {
      schemaVersion: SCHEMA_VERSION,
      app: 'KeepVocab',
      updatedAt: new Date().toISOString(),
      settings: withoutDriveCredentials(settings),
      ...(chosenGemini ? { googleAiStudio: chosenGemini } : {}),
      ...(chosenImageProvider ? { imageSearchProvider: chosenImageProvider } : {})
    };
    if (!settingsFile) {
      await this.createJsonFile(folder.id, 'KeepVocab Settings.json', 'settings', settingsPayload);
      createdFiles += 1;
    } else if (JSON.stringify(remoteSettings || {}) !== JSON.stringify(settingsPayload.settings)
      || JSON.stringify(remoteGemini || null) !== JSON.stringify(chosenGemini || null)
      || JSON.stringify(remoteImageProvider || null) !== JSON.stringify(chosenImageProvider || null)) {
      const cleanup = this.credentialCleanupPayloads.get(settingsFile.id);
      if (cleanup?.etag && !/^W\//i.test(cleanup.etag)) {
        if (await this.updateSettingsBackup(settingsFile.id, settingsPayload)) updatedFiles += 1;
      } else {
        // Preserve normal preference synchronization when an ETag is unavailable.
        // Cleanup-only writes below still require a strong ETag.
        await this.updateJsonFile(settingsFile.id, settingsPayload);
        updatedFiles += 1;
      }
    }

    // Each device writes its own append-only history shard, so another device
    // (including an older app) cannot overwrite this device's review log.
    const ownFiles = reviewPayloads.filter(({ file }) => file.appProperties?.deviceId === this.deviceId);
    const ownEvents = mergeReviewEvents(localReviewEvents.filter(event => !event.deviceId || event.deviceId === this.deviceId), ...ownFiles.map(item => item.payload.events));
    if (ownEvents.length) {
      const payload = { schemaVersion: SCHEMA_VERSION, app: 'KeepVocab', algorithm: 'FSRS-6', deviceId: this.deviceId,
        updatedAt: new Date().toISOString(), events: ownEvents };
      if (!ownFiles.length) {
        await this.createJsonFile(folder.id, `KeepVocab Reviews ${this.deviceId}.json`, 'reviews', payload, '', { deviceId: this.deviceId });createdFiles += 1;
      } else if (JSON.stringify(mergeReviewEvents(ownFiles[0].payload.events)) !== JSON.stringify(ownEvents)) {
        await this.updateJsonFile(ownFiles[0].file.id, payload);updatedFiles += 1;
      }
    }
    // Independent versioned files keep complete image decisions out of settings
    // and protect the archive from older clients' bounded legacy replay format.
    await this.archiveLegacyImageLearning(settings.imageLearning);
    const imageEvents = await this.imageHistory.all();
    const ownImages = imageEvents.filter(event => !event.deviceId || event.deviceId === this.deviceId);
    const ownImageFiles = imagePayloads.filter(({ file }) => file.appProperties?.deviceId === this.deviceId);
    const partCount = Math.max(Math.ceil(ownImages.length / IMAGE_HISTORY_CHUNK), ownImageFiles.length, this.imageHistory.resetAt ? 1 : 0);
    for (let part = 0; part < partCount; part++) {
      const key = String(part).padStart(6, '0');
      const records = ownImages.slice(part * IMAGE_HISTORY_CHUNK, (part + 1) * IMAGE_HISTORY_CHUNK);
      const existing = ownImageFiles.find(({ file }) => file.appProperties?.part === key);
      const payload = { schemaVersion: SCHEMA_VERSION, formatVersion: 2, app: 'KeepVocab', deviceId: this.deviceId,
        resetAt: this.imageHistory.resetAt, records };
      if (!existing) { await this.createJsonFile(folder.id, `KeepVocab Photo Choices ${this.deviceId} ${key}.json`, 'image-feedback-v2', payload, '', { deviceId: this.deviceId, part: key }); createdFiles++; }
      else if (JSON.stringify(mergeImageEvents(existing.payload.records)) !== JSON.stringify(records) || (existing.payload.resetAt || '') !== payload.resetAt) {
        await this.updateJsonFile(existing.file.id, payload); updatedFiles++;
      }
    }
    for (const [fileId, { payload }] of this.credentialCleanupPayloads) {
      if (await this.updateSettingsBackup(fileId, payload)) updatedFiles += 1;
    }
    settings = mergeDriveSettings(this.getSettings(), settings, { freshInstall: this.isFreshInstall });
    // Preserve edits, additions and deletions made during network requests.
    const latestWords = new Map(this.getAllWords().map(word => [word.id, word]));
    const mergedWords = new Map(finalWords.map(word => [word.id, word]));
    for (const latest of latestWords.values()) mergedWords.set(latest.id, mergedWords.has(latest.id) ? mergeStoredWord(mergedWords.get(latest.id), latest) : latest);
    const tombstones = new Map(finalTombstones.map(item => [item.id, item]));
    for (const item of this.getTombstones()) tombstones.set(item.id, mergeTombstone(tombstones.get(item.id), item));
    reconcileMergedMeanings(mergedWords, tombstones);
    finalTombstones.splice(0, finalTombstones.length, ...tombstones.values());
    const history = await this.getReviewEvents();
    const byWord = indexReviewEvents(history);
    const surviving = [...mergedWords.values()].filter(word => !wordIsDeleted(word, tombstones.get(word.id)))
      .map(word => replayWordFsrsHistory(word, reviewEventsForWord(word, byWord), settings, { sourceFingerprint: sourceDefinitionFingerprint(word) }));
    finalWords.splice(0, finalWords.length, ...surviving);
    this.assertGoogleAuthGeneration(generation);
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
