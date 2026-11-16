import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'www/js/ml');
await mkdir(output, { recursive: true });
const runtime = path.join(output, 'runtime');
await mkdir(runtime, { recursive: true });
await cp(path.join(root, 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs'), path.join(runtime, 'ort-wasm-simd-threaded.asyncify.mjs'));
await writeFile(path.join(runtime, 'ort-wasm-simd-threaded.asyncify.wasm'), gunzipSync(await readFile(path.join(root, 'models/siglip2-compact-v1/runtime.wasm.gz'))));
await build({ entryPoints: [path.join(root, 'scripts/meaning-worker.js')], outfile: path.join(output, 'meaningWorker.bundle.js'),
  bundle: true, platform: 'browser', format: 'esm', target: 'es2022', minify: true, legalComments: 'eof',
  alias: { '@huggingface/transformers': path.join(root, 'node_modules/@huggingface/transformers/dist/transformers.web.js') } });
await build({ entryPoints: [path.join(root, 'scripts/clip-worker.js')], outfile: path.join(output, 'clipWorker.bundle.js'),
  bundle: true, platform: 'browser', format: 'esm', target: 'es2022', minify: true, legalComments: 'eof',
  alias: { '@huggingface/transformers': path.join(root, 'node_modules/@huggingface/transformers/dist/transformers.web.js') },
  plugins: process.env.KEEPVOCAB_MODEL_BASE ? [{ name: 'local-model-source', setup(bundler) {
    bundler.onLoad({ filter: /\/js\/ml\/clipConfig\.js$/ }, async args => ({ contents: (await readFile(args.path, 'utf8')).replace(/https:\/\/raw\.githubusercontent\.com\/RODIONOLIINYK\/KeepVocab\/v[\d.]+\/models\/siglip2-compact-v1\//g, process.env.KEEPVOCAB_MODEL_BASE), loader: 'js' }));
  } }] : [] });
