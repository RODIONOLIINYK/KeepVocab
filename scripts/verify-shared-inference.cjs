// Verify source-level shared transport in real Electron windows. No app build,
// model download or model fitting. Tiny echo workers stand in for model kernels.
const { app, BrowserWindow, protocol } = require('electron');
const { readFile, mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..'), origin = 'http://127.0.0.1:8085';
if (process.platform === 'darwin' && process.arch !== 'arm64') throw new Error('Apple Silicon verification only.');
app.disableHardwareAcceleration();
let temporary;
const timeout = setTimeout(() => { console.error('Shared inference verification timed out.'); app.exit(1); }, 30_000);
app.whenReady().then(async () => {
  temporary = await mkdtemp(path.join(tmpdir(), 'keepvocab-shared-inference-'));
  const partition = `shared-inference-${Date.now()}`;
  const { session } = require('electron');
  session.fromPartition(partition).protocol.handle('http', async request => {
    const url = new URL(request.url);
    if (url.origin !== origin) return new Response(null, { status: 403 });
    if (url.pathname === '/') return new Response('<!doctype html><title>Shared inference verification</title>', { headers: { 'content-type': 'text/html' } });
    if (['/js/ml/clipWorker.bundle.js', '/js/ml/meaningWorker.bundle.js'].includes(url.pathname)) {
      const kind = url.pathname.includes('meaning') ? 'meaning' : 'clip';
      return new Response(`
        import { sharedInferenceScope } from '../services/sharedInferenceScope.js';
        const channel = sharedInferenceScope(self, '${kind}');
        const instance = crypto.randomUUID(); let counter = 0;
        channel.onmessage = async ({data}) => {
          if (data.type === 'cancel') return;
          const text = data.payload?.blob ? await data.payload.blob.text() : data.text;
          channel.postMessage({id:data.id,result:{instance,counter:++counter,text,kind:'${kind}'}});
        };
      `, { headers: { 'content-type': 'text/javascript' } });
    }
    const file = path.resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + path.sep) || !url.pathname.startsWith('/js/')) return new Response(null, { status: 403 });
    try { return new Response(await readFile(file), { headers: { 'content-type': 'text/javascript' } }); }
    catch { return new Response(null, { status: 404 }); }
  });
  const windows = [0, 1].map(() => new BrowserWindow({ show: false,
    webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false } }));
  try {
    await Promise.all(windows.map(window => window.loadURL(origin)));
    for (const window of windows) await window.webContents.executeJavaScript(`(async()=>{
      const {createInferenceWorker}=await import('/js/services/inferenceWorker.js');
      window.connections={clip:createInferenceWorker('clip'),meaning:createInferenceWorker('meaning')};
      window.request=(kind,text,id=1)=>new Promise((resolve,reject)=>{
        const worker=connections[kind];worker.onmessage=({data})=>resolve(data.result);worker.onerror=e=>reject(Error(e.message));
        worker.postMessage(kind==='clip'?{id,type:'image',payload:{blob:new Blob([text],{type:'image/jpeg'})}}:{id,type:'compare',text});
      });
      return {shared:typeof SharedWorker==='function'};
    })()`);
    const first = await windows[0].webContents.executeJavaScript(`Promise.all([request('clip','main pixels'),request('meaning','main meaning')])`);
    const second = await windows[1].webContents.executeJavaScript(`Promise.all([request('clip','quick pixels'),request('meaning','quick meaning')])`);
    for (const i of [0, 1]) {
      if (first[i].instance !== second[i].instance || second[i].counter !== 2) throw new Error('A model was duplicated across windows.');
    }
    if (first[0].text !== 'main pixels' || second[0].text !== 'quick pixels') throw new Error('Binary image messages crossed callers.');
    windows[0].destroy();
    const afterClose = await windows[1].webContents.executeJavaScript(`Promise.all([request('clip','after close',2),request('meaning','after close',2)])`);
    for (const i of [0, 1]) if (afterClose[i].instance !== second[i].instance || afterClose[i].counter !== 3) throw new Error('Closing Main destroyed Quick Add inference.');
    const afterReset = await windows[1].webContents.executeJavaScript(`(async()=>{
      const {resetInferenceWorkers,createInferenceWorker}=await import('/js/services/inferenceWorker.js');
      resetInferenceWorkers('clip');connections.clip=createInferenceWorker('clip');
      return request('clip','after reset',3);
    })()`);
    if (afterReset.instance === afterClose[0].instance || afterReset.text !== 'after reset') throw new Error('Immediate re-enable reused a retiring model.');
    const prompt = await windows[1].webContents.executeJavaScript(`(async()=>{
      const {requestImageModelDownload}=await import('/js/components/SettingsView.js');
      const result=requestImageModelDownload({downloadMB:208,capability:{warning:'This phone reports limited memory. Adding a word can take longer.'}});
      const visible=Boolean(document.querySelector('#image-model-performance-warning'));
      const button=document.querySelector('[data-download]').textContent;
      document.querySelector('[data-decline]').click();
      return {visible,button,accepted:await result,remaining:document.querySelectorAll('.modal-backdrop').length};
    })()`);
    if (!prompt.visible || prompt.button !== 'Download anyway' || prompt.accepted || prompt.remaining) throw new Error('The phone performance warning did not allow a clean decline.');
    console.log(JSON.stringify({ runtime: process.versions.electron, arch: process.arch,
      sharedModels: 2, sourceModulesOnly: true, binaryBlobPreserved: true, survivedMainClose: true,
      immediateReenable: true, downloadWarning: true, compiledApp: false }));
  } finally {
    for (const window of windows) if (!window.isDestroyed()) window.destroy();
    clearTimeout(timeout); await rm(temporary, { recursive: true, force: true });
  }
  app.exit(0);
}).catch(error => { console.error(error); clearTimeout(timeout); app.exit(1); });
