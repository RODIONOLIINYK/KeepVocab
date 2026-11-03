import { build } from 'esbuild';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'www/js/ml');
await mkdir(output, { recursive: true });
await build({ entryPoints: [path.join(root, 'scripts/clip-worker.js')], outfile: path.join(output, 'clipWorker.bundle.js'),
  bundle: true, platform: 'browser', format: 'esm', target: 'es2022', minify: true, legalComments: 'eof',
  alias: { '@huggingface/transformers': path.join(root, 'node_modules/@huggingface/transformers/dist/transformers.web.js') },
  plugins: process.env.KEEPVOCAB_MODEL_BASE ? [{ name: 'local-model-source', setup(bundler) {
    bundler.onLoad({ filter: /\/js\/ml\/clipConfig\.js$/ }, async args => ({ contents: (await readFile(args.path, 'utf8')).replace(/https:\/\/raw\.githubusercontent\.com\/RODIONOLIINYK\/KeepVocab\/v[\d.]+\/models\/siglip2-compact-v1\//g, process.env.KEEPVOCAB_MODEL_BASE), loader: 'js' }));
  } }] : [] });
