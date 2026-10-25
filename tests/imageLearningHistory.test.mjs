import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { ImageLearningHistoryStore } from '../js/services/imageLearningHistory.js';
import { DriveSyncService, MemoryStorage } from '../js/services/driveSync.js';
import { encodeFeatures } from '../js/services/imagePreferences.js';
import { CLIP_TAG } from '../js/ml/clipConfig.js';
import { createPersonalizer, validPersonalizer } from '../js/services/imagePersonalizer.js';
const features = encodeFeatures([1,...Array(514).fill(0)]);
const event = i => ({ id: `event-${i}`, key: `photo-${i}`, decisionId: `choice-${i}`, meaningId: `meaning-${i}`, encoder: CLIP_TAG,
  label: i % 2, features, updatedAt: new Date(Date.UTC(2025,0,1,0,0,i)).toISOString(), context: { word: 'run', definition: 'Move quickly on foot.' } });

test('IndexedDB retains more than 256 events, corrections and restarts without loading history at startup', async () => {
  const storage = new MemoryStorage(), indexedDB = new IDBFactory(), store = new ImageLearningHistoryStore(storage, indexedDB);
  await store.merge(Array.from({ length: 700 }, (_, i) => event(i)));
  assert.equal(store.count, 700); assert.equal(store.records.size, 0);
  const revised = { ...event(0), id:'correction', label:1, updatedAt:'2026-01-01T00:00:00Z' }; await store.append(revised);
  const restarted = new ImageLearningHistoryStore(storage,indexedDB); await restarted.ready;
  assert.equal(restarted.count, 701); assert.equal((await restarted.all()).length,701);
  assert.equal((await restarted.latest('photo-0')).id,'correction');
  assert.equal(restarted.summary.positive,351); assert.equal(restarted.summary.negative,350);
  const model=createPersonalizer(); await store.saveModel(model); assert.equal(validPersonalizer(await restarted.model()),true);
  store.database.close(); restarted.database.close();
});
test('fallback chunks retain the complete history and typed model weights across restart', async () => {
  const storage=new MemoryStorage(), store=new ImageLearningHistoryStore(storage,undefined);
  await store.merge(Array.from({length:650},(_,i)=>event(i))); await store.saveModel(createPersonalizer());
  const restarted=new ImageLearningHistoryStore(storage,undefined); assert.equal((await restarted.all()).length,650);
  assert.equal(validPersonalizer(await restarted.model()),true);
  await restarted.merge([], '2026-02-01T00:00:00Z'); await restarted.merge([event(0)]);
  assert.equal((await restarted.all()).length,0,'Old device data cannot resurrect a reset');
});
test('quota failure keeps the previous acknowledged fallback archive instead of pruning it', async () => {
  const storage=new MemoryStorage(), store=new ImageLearningHistoryStore(storage,undefined); await store.append(event(0));
  const set=storage.setItem.bind(storage); storage.setItem=(key,value)=>{if(key.includes('_v2_'))throw new Error('quota');set(key,value);};
  await assert.rejects(store.append(event(1)),/quota/); assert.match(store.error,/Free some device storage/);
  storage.setItem=set;
  assert.equal((await new ImageLearningHistoryStore(storage,undefined).all()).length,1);
});
function backupService(files,storage=new MemoryStorage()) {
  const service=new DriveSyncService(storage);
  service.findOrCreateBackupFolder=async()=>({id:'folder'});
  service.listBackupFiles=async()=>files.map(({payload,...file})=>structuredClone(file));
  service.downloadJsonFile=async id=>structuredClone(files.find(f=>f.id===id).payload);
  service.createJsonFile=async(_folder,name,kind,payload,monthYear='',extra={})=>{const file={id:`file-${files.length}`,name,appProperties:{kind,...(monthYear?{monthYear}:{}),...extra},payload:structuredClone(payload)};files.push(file);return file;};
  service.updateJsonFile=async(id,payload)=>{files.find(f=>f.id===id).payload=structuredClone(payload);};
  return service;
}
test('Drive backs up all image history in separate chunks, restores another device, and preserves offline additions',async()=>{
  const files=[],a=backupService(files);
  await a.imageHistory.merge(Array.from({length:325},(_,i)=>({...event(i),deviceId:a.deviceId})));
  await a.syncGoogleDrive(); assert.equal(files.filter(f=>f.appProperties.kind==='image-feedback-v2').length,4);
  const b=backupService(files); await b.syncGoogleDrive(); assert.equal((await b.getImageEvents()).length,325);
  await b.appendImageEvent({...event(400),id:'offline-b'}); await b.syncGoogleDrive(); await a.syncGoogleDrive();
  assert.equal((await a.getImageEvents()).length,326);
  assert.equal(files.find(f=>f.appProperties.kind==='settings').payload.settings.imageLearning.records.length,0);
  await a.imageHistory.merge([], '2026-02-01T00:00:00Z'); a.updateSettings({imageLearning:{resetAt:'2026-02-01T00:00:00Z',records:[]}});
  await a.syncGoogleDrive(); await b.syncGoogleDrive(); assert.equal((await b.getImageEvents()).length,0);
});

test('a reset marker survives a fallback manifest quota failure and prevents old data returning after restart', async () => {
  const storage=new MemoryStorage(),store=new ImageLearningHistoryStore(storage,undefined);await store.append(event(0));
  const set=storage.setItem.bind(storage);storage.setItem=(key,value)=>{if(key==='keepvocab_image_history_v2')throw new Error('quota');set(key,value);};
  await assert.rejects(store.merge([], '2026-02-01T00:00:00Z'),/quota/);
  assert.equal((await store.all()).length,0);storage.setItem=set;
  assert.equal((await new ImageLearningHistoryStore(storage,undefined).all()).length,0);
});
