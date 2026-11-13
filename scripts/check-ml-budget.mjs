import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLIP_MODEL_FILES, COMPACT_MODEL_ASSETS, COMPACT_RUNTIME_ASSET, ORT_MJS_BYTES, ML_ASSET_BYTE_LIMIT } from '../js/ml/clipConfig.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function directoryBytes(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`ML size audit refuses symlink: ${full}`);
    total += entry.isDirectory() ? await directoryBytes(full) : (await stat(full)).size;
  }
  return total;
}

export async function auditMlAssetBudget(outputDir = path.join(root, 'www'), { limitBytes = ML_ASSET_BYTE_LIMIT } = {}) {
  let modelCacheBytes = COMPACT_RUNTIME_ASSET.bytes + ORT_MJS_BYTES;
  for (const file of CLIP_MODEL_FILES) {
    const pinned = COMPACT_MODEL_ASSETS[file];
    modelCacheBytes += pinned ? pinned.bytes : (await stat(path.join(root, 'models/siglip2-compact-v1', file))).size;
  }
  // Count all shipped JavaScript and licenses as overhead, including non-ML
  // modules. This is deliberately more conservative than counting ML files only.
  const bundledJsBytes = await directoryBytes(path.join(outputDir, 'js'));
  const installedBytes = modelCacheBytes + bundledJsBytes;
  const report = { limitBytes, modelCacheBytes, bundledJsBytes, installedBytes, headroomBytes: limitBytes - installedBytes };
  if (installedBytes > limitBytes) throw new Error(`Installed ML budget exceeded: ${JSON.stringify(report)}`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await auditMlAssetBudget(process.argv[2]), null, 2));
}
