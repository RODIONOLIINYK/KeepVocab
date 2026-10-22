import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(path.join(root, 'js/vendor'), { recursive: true });
await build({ entryPoints: [path.join(root, 'scripts/fsrs-runtime.js')], outfile: path.join(root, 'js/vendor/fsrs.js'), bundle: true, platform: 'browser', format: 'esm', target: 'es2022', minify: true, legalComments: 'eof' });
await copyFile(path.join(root, 'node_modules/ts-fsrs/LICENSE'), path.join(root, 'js/vendor/TS-FSRS-LICENSE.txt'));
