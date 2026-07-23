import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(projectRoot, 'www');
const files = ['index.html', 'manifest.json', 'sw.js'];
const directories = ['assets', 'css', 'icons', 'js'];

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

for (const file of files) {
  await cp(path.join(projectRoot, file), path.join(outputDir, file));
}

for (const directory of directories) {
  await cp(path.join(projectRoot, directory), path.join(outputDir, directory), {
    recursive: true,
  });
}

console.log(`KeepVocab web assets copied to ${outputDir}`);
