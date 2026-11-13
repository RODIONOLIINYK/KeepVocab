import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(projectRoot, 'www');
await import('./build-fsrs.mjs');
const files = ['index.html', 'quick-add.html', 'manifest.json', 'sw.js'];
const directories = ['assets', 'css', 'icons', 'js'];

const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
await writeFile(
  path.join(projectRoot, 'js/services/version.js'),
  `// Auto-generated from package.json by scripts/build-web.mjs\nexport const APP_VERSION = '${packageJson.version}';\n`
);

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

if (process.env.KEEPVOCAB_MODEL_BASE) {
  const configPath = path.join(outputDir, 'js/ml/clipConfig.js');
  const source = await readFile(configPath, 'utf8');
  await writeFile(configPath, source.replace(/https:\/\/raw\.githubusercontent\.com\/RODIONOLIINYK\/KeepVocab\/v[\d.]+\/models\/siglip2-compact-v1\//g, process.env.KEEPVOCAB_MODEL_BASE));
}

await import('./build-image-ml.mjs');
const { auditMlAssetBudget } = await import('./check-ml-budget.mjs');
const mlBudget = await auditMlAssetBudget(outputDir);
console.log(`Installed ML assets plus all app JS: ${mlBudget.installedBytes} / ${mlBudget.limitBytes} bytes`);

console.log(`KeepVocab web assets copied to ${outputDir}`);
