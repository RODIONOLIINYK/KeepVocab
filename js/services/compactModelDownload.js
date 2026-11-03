import { CLIP_MODEL_BASE, COMPACT_MODEL_ASSETS, CLIP_RUNTIME_URLS, COMPACT_RUNTIME_ASSET } from '../ml/clipConfig.js';

// Canonical cache keys describe the actual reconstructed files. Network shards
// are transport only, never a second model or an implicit upstream fallback.
export async function fetchCompactModelFile(input, options, fetchImpl = globalThis.fetch) {
  const url = typeof input === 'string' ? input : input.url;
  const runtime = url === CLIP_RUNTIME_URLS[1];
  const file = runtime ? 'runtime.wasm' : url?.startsWith(CLIP_MODEL_BASE) ? url.slice(CLIP_MODEL_BASE.length).replace(/^\/+/, '') : '';
  const asset = runtime ? COMPACT_RUNTIME_ASSET : COMPACT_MODEL_ASSETS[file];
  if (!asset) return fetchImpl(input, options);
  if ((options?.method || input?.method || '').toUpperCase() === 'HEAD') return new Response(null, { headers: { 'Content-Length': String(asset.bytes || 0) } });
  // Transformers.js probes metadata with a one-byte Range GET. Do not download
  // and decompress the full tower for that probe, or forward Range to shards.
  const range = new Headers(options?.headers || input?.headers).get('range');
  if (range === 'bytes=0-0' && asset.bytes) return new Response(new Uint8Array(1), { status: 206,
    headers: { 'Content-Length': '1', 'Content-Range': `bytes 0-0/${asset.bytes}`, 'Content-Type': 'application/octet-stream' } });
  const parts = [];
  for (const part of asset.parts) {
    const response = await fetchImpl(new URL(part, CLIP_MODEL_BASE).href, options);
    if (!response.ok) throw new Error(`Could not download ${file} (${response.status}).`);
    parts.push(await response.arrayBuffer());
  }
  const blob = new Blob(parts);
  const bytes = asset.gzip
    ? await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
    : await blob.arrayBuffer();
  if (asset.bytes && bytes.byteLength !== asset.bytes) throw new Error(`Incomplete model file: ${file}.`);
  if (asset.sha256) {
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    if (digest !== asset.sha256) throw new Error(`Model checksum failed: ${file}.`);
  }
  return new Response(bytes, { headers: { 'Content-Length': String(bytes.byteLength),
    'Content-Type': file.endsWith('.json') ? 'application/json' : file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' } });
}
