// Run after build:web using Electron (arm64 on macOS). This verifies the real
// browser/WASM worker and native model cache, without any network access.
const { app, BrowserWindow, ipcMain, protocol, session } = require('electron');
const { mkdtemp, readFile, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { modelStorageOperation, handleModelStorageRequest } = require('../desktop/modelStorage.cjs');
const root = path.resolve(__dirname, '..'), origin = 'http://127.0.0.1:8085';
let temporary;
app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async () => {
  temporary = await mkdtemp(path.join(tmpdir(), 'keepvocab-wasm-verification-'));
  const { MEANING_MODEL_ASSETS } = await import('../js/ml/meaningAssets.js');
  const { MEANING_MODEL_BASE, MEANING_CACHE } = await import('../js/ml/meaningConfig.js');
  const storage = path.join(temporary, 'models');
  ipcMain.handle('keepvocab:model-storage', (_event, args) => modelStorageOperation(storage, args));
  const rows = JSON.parse(await readFile(process.argv[2] || path.join(root, 'work/meaning-reference-validation-input.json')));
  for (const [file, asset] of Object.entries(MEANING_MODEL_ASSETS)) {
    const bytes = await readFile(path.join(root, 'models/meaning-minilm-reference', file));
    if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error('Wrong reference file: ' + file);
    const url = MEANING_MODEL_BASE + file, key = createHash('sha256').update(url).digest('hex'), token = 'a'.repeat(24);
    for (let offset = 0; offset < bytes.length; offset += 1024 * 1024) await modelStorageOperation(storage, { action: 'write', cache: MEANING_CACHE, key, token, offset, data: bytes.subarray(offset, offset + 1024 * 1024).toString('base64') });
    await modelStorageOperation(storage, { action: 'commit', cache: MEANING_CACHE, key, token, size: bytes.length, url, headers: [['content-length', String(bytes.length)]] });
  }
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith(origin) && !details.url.startsWith('blob:') }));
  protocol.handle('http', async request => {
    const url = new URL(request.url);
    if (url.origin !== origin) return new Response(null, { status: 403 });
    if (url.pathname.startsWith('/_keepvocab_models/')) return handleModelStorageRequest(storage, request);
    if (url.pathname === '/verification.html') return new Response('<!doctype html><title>Model verification</title>', { headers: { 'Content-Type': 'text/html' } });
    if (url.pathname === '/validation.json') return new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'application/json' } });
    const file = path.resolve(root, 'www', '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(path.join(root, 'www') + path.sep)) return new Response(null, { status: 403 });
    try { return new Response(await readFile(file), { headers: { 'Content-Type': file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.json') ? 'application/json' : 'text/javascript' } }); }
    catch { return new Response(null, { status: 404 }); }
  });
  const window = new BrowserWindow({ show: false, webPreferences: { preload: path.join(root, 'desktop/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await window.loadURL(origin + '/verification.html');
  const result = await window.webContents.executeJavaScript(`(async () => {
    const {preloadMeaningModel, scoreReferenceMeaningPairs, removeMeaningModel, checkMeaningModelInstalled} = await import('./js/services/meaningReference.js');
    const {MEANING_MERGE_THRESHOLD} = await import('./js/ml/meaningConfig.js');
    const rows = await (await fetch('/validation.json')).json();
    await preloadMeaningModel();
    let maxScoreError = 0, changedMergeDecisions = 0;
    const predictions = [];
    for (let start = 0; start < rows.length; start += 12) {
      const batch = rows.slice(start, start + 12);
      const senses = batch.flatMap(row => [{definition: row.textA}, {definition: row.textB}]);
      const scores = await scoreReferenceMeaningPairs(senses, batch.map((_, i) => [i * 2, i * 2 + 1]));
      scores.forEach((score, i) => {
        maxScoreError = Math.max(maxScoreError, Math.abs(score - batch[i].score));
        if ((score >= MEANING_MERGE_THRESHOLD) !== (batch[i].score >= MEANING_MERGE_THRESHOLD)) changedMergeDecisions++;
        predictions.push({pairId: batch[i].pairId, label: batch[i].label, score: batch[i].score, actual: score});
      });
    }
    await removeMeaningModel();
    const removed = !await checkMeaningModelInstalled();
    const preloadAfterRemoval = await preloadMeaningModel();
    return {runtime: 'Electron browser worker / WASM FP16', threshold: MEANING_MERGE_THRESHOLD, pairs: rows.length, maxScoreError, changedMergeDecisions, removed, noImplicitDownloadAfterRemoval: preloadAfterRemoval === null, predictions};
  })()`);
  if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, predictions: undefined }));
  if (result.maxScoreError > .005 || result.changedMergeDecisions || !result.removed || !result.noImplicitDownloadAfterRemoval) throw new Error('WASM inference verification failed.');
  window.destroy(); await rm(temporary, { recursive: true, force: true }); temporary = null; app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
app.on('will-quit', () => { if (temporary) void rm(temporary, { recursive: true, force: true }); });
