const { mkdir, readFile, writeFile, appendFile, rename, stat, rm, readdir } = require('node:fs/promises');
const path = require('node:path');
const { createReadStream } = require('node:fs');
const { Readable } = require('node:stream');

// A packed macOS app owns its downloads. Removing the .app removes this folder.
function modelStorageRoot(app) {
  return app.isPackaged ? path.join(process.resourcesPath, 'model-cache')
    : path.join(app.getPath('userData'), 'development-model-cache');
}
async function modelStorageOperation(root, args) {
  const { action, cache, key, token = '' } = args;
  if (action === 'caches') {
    try { return { names: (await readdir(root, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name) }; }
    catch (error) { if (error.code === 'ENOENT') return { names: [] }; throw error; }
  }
  if (!/^keepvocab-[a-z0-9-]{1,70}$/.test(cache || '')) throw new Error('Invalid model cache.');
  const directory = path.join(root, cache);
  if (action === 'drop') { await rm(directory, { recursive: true, force: true }); return {}; }
  if (action === 'keys') {
    try {
      const names = (await readdir(directory)).filter(n => /^[a-f0-9]{64}\.json$/.test(n));
      return { urls: await Promise.all(names.map(async name => JSON.parse(await readFile(path.join(directory, name), 'utf8')).url)) };
    } catch (error) { if (error.code === 'ENOENT') return { urls: [] }; throw error; }
  }
  if (!/^[a-f0-9]{64}$/.test(key || '')) throw new Error('Invalid model file key.');
  const file = path.join(directory, key), metadata = file + '.json';
  if (action === 'stat') {
    try { const info = JSON.parse(await readFile(metadata, 'utf8')); return (await stat(file)).size === info.size ? { ...info, readUrl: `/_keepvocab_models/${cache}/${key}` } : {}; }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  }
  if (action === 'delete') { await rm(metadata, { force: true }); await rm(file, { force: true }); return {}; }
  if (!/^[a-f0-9]{16,64}$/.test(token)) throw new Error('Invalid download token.');
  const temporary = file + '.' + token + '.part';
  await mkdir(directory, { recursive: true });
  if (action === 'write') {
    const buffer = Buffer.from(args.data, 'base64');
    if (buffer.length > 1024 * 1024 || !Number.isSafeInteger(args.offset) || args.offset < 0) throw new Error('Invalid model chunk.');
    if (args.offset === 0) await writeFile(temporary, buffer);
    else { if ((await stat(temporary)).size !== args.offset) throw new Error('Model chunk out of order.'); await appendFile(temporary, buffer); }
    return {};
  }
  if (action === 'commit') {
    if ((await stat(temporary)).size !== args.size) throw new Error('Incomplete model download.');
    await rename(temporary, file);
    await writeFile(metadata + '.' + token, JSON.stringify({ size: args.size, headers: args.headers, url: args.url }));
    await rename(metadata + '.' + token, metadata);
    return {};
  }
  if (action === 'abort') { await rm(temporary, { force: true }); return {}; }
  throw new Error('Unsupported model operation.');
}
// This route serves committed, size-checked model files only. No filesystem
// paths or partial downloads are accepted from a renderer URL.
async function handleModelStorageRequest(root, request) {
  const match = /^\/_keepvocab_models\/(keepvocab-[a-z0-9-]{1,70})\/([a-f0-9]{64})$/.exec(new URL(request.url).pathname);
  if (!match) return new Response(null, { status: 404 });
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
  const [, cache, key] = match;
  const info = await modelStorageOperation(root, { action: 'stat', cache, key });
  if (!(info.size > 0)) return new Response(null, { status: 404 });
  const body = request.method === 'HEAD' ? null : Readable.toWeb(createReadStream(path.join(root, cache, key)));
  return new Response(body, { headers: {
    'Content-Type': 'application/octet-stream', 'Content-Length': String(info.size),
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'
  } });
}
module.exports = { modelStorageRoot, modelStorageOperation, handleModelStorageRequest };
