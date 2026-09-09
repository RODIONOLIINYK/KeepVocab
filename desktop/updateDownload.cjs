const { createReadStream, createWriteStream } = require('node:fs');
const { stat, rename, rm } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

async function verifiedFile(file, update) {
  try {
    if ((await stat(file)).size !== update.size) return false;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest('hex') === update.sha256;
  } catch { return false; }
}

async function downloadVerifiedUpdate(update, destination, fetchImpl, onProgress = () => {}, { stallMs = 60_000, retries = 2 } = {}) {
  if (await verifiedFile(destination, update)) return destination;
  const partial = `${destination}.part`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    let timer;
    const heartbeat = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), stallMs); };
    heartbeat();
    try {
      const response = await fetchImpl(update.url, { signal: controller.signal });
      if (!response.ok || !response.body) throw new Error(`Download unavailable (HTTP ${response.status}).`);
      let bytes = 0; let lastProgress = 0;
      const hash = createHash('sha256');
      await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, _encoding, callback) {
        heartbeat(); bytes += chunk.length;
        if (bytes > update.size) return callback(Object.assign(new Error('Unexpected update size.'), { verification: true }));
        hash.update(chunk);
        if (Date.now() - lastProgress > 250 || bytes === update.size) {
          lastProgress = Date.now(); onProgress({ status: 'downloading', received: bytes, total: update.size });
        }
        callback(null, chunk);
      } }), createWriteStream(partial), { signal: controller.signal });
      if (bytes !== update.size || hash.digest('hex') !== update.sha256) {
        throw Object.assign(new Error('The update failed verification. Please try again.'), { verification: true });
      }
      await rename(partial, destination);
      return destination;
    } catch (error) {
      if (error.verification || attempt === retries) throw new Error(error.verification ? error.message : 'The update download was interrupted. Check your connection and try again.', { cause: error });
      onProgress({ status: 'retrying', message: `Download interrupted. Retrying (${attempt + 1}/${retries})…` });
    } finally {
      clearTimeout(timer);
      await rm(partial, { force: true });
    }
  }
}

module.exports = { downloadVerifiedUpdate, verifiedFile };
