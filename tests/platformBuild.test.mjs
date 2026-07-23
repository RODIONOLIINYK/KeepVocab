import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('the installable PWA manifest and every offline build asset resolve on all targets', () => {
  const manifest = JSON.parse(readFileSync(resolve(projectRoot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.id, '/');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.ok(manifest.icons.length > 0);
  for (const icon of manifest.icons) {
    assert.equal(existsSync(resolve(projectRoot, icon.src)), true, `Missing install icon: ${icon.src}`);
  }

  const html = readFileSync(resolve(projectRoot, 'index.html'), 'utf8');
  const headerLogo = html.match(/brand-icon-box[\s\S]*?<img src="([^"]+)"/)?.[1];
  assert.equal(headerLogo, 'icons/keepvocab-mark-v2-192.png');
  assert.ok(manifest.icons.some(icon => icon.src === headerLogo), 'Header and installed app must share the same logo source');

  const serviceWorker = readFileSync(resolve(projectRoot, 'sw.js'), 'utf8');
  const assetPaths = [...serviceWorker.matchAll(/'\.\/([^']+)'/g)]
    .map(match => match[1].split(/[?#]/)[0])
    .filter(Boolean);

  for (const assetPath of assetPaths) {
    assert.equal(existsSync(resolve(projectRoot, assetPath)), true, `Missing offline asset: ${assetPath}`);
  }
});

test('the local launch contract keeps the installed app on the API-authorized port', () => {
  const packageJson = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8'));
  const handoff = readFileSync(resolve(projectRoot, 'HANDOFF.md'), 'utf8');
  assert.match(packageJson.scripts.start, /http\.server 8085/);
  assert.match(packageJson.scripts.start, /--bind 127\.0\.0\.1/);
  assert.match(handoff, /http:\/\/127\.0\.0\.1:8085/);
});

test('the Android build declares microphone access and native Drive authorization', () => {
  const manifest = readFileSync(resolve(projectRoot, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  const gradle = readFileSync(resolve(projectRoot, 'android/app/build.gradle'), 'utf8');
  const activity = readFileSync(resolve(projectRoot, 'android/app/src/main/java/com/keepvocab/app/MainActivity.java'), 'utf8');
  const plugin = readFileSync(resolve(projectRoot, 'android/app/src/main/java/com/keepvocab/app/DriveAuthPlugin.java'), 'utf8');

  assert.match(manifest, /android\.permission\.RECORD_AUDIO/);
  assert.match(manifest, /android\.permission\.MODIFY_AUDIO_SETTINGS/);
  assert.match(gradle, /play-services-auth:21\.6\.0/);
  assert.match(activity, /registerPlugin\(DriveAuthPlugin\.class\)/);
  assert.match(plugin, /auth\/drive\.file/);
  assert.match(plugin, /Identity\.getAuthorizationClient/);
  assert.match(plugin, /23308644025-i69m4ncivbe9jvf3pa1kepj8fb8ruh4g\.apps\.googleusercontent\.com/);
  assert.doesNotMatch(plugin, /resultCode != Activity\.RESULT_OK \|\| data == null/);
  assert.ok(
    plugin.indexOf('if (data == null)') < plugin.indexOf('getAuthorizationResultFromIntent(data)'),
    'Native auth must parse every returned Intent instead of discarding non-OK result codes'
  );
});

test('the dashboard omits redundant Cloze and exposes Choose Word', () => {
  const html = readFileSync(resolve(projectRoot, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /Cloze Quiz/);
  assert.match(html, /id="btn-mode-choose"/);
  assert.match(html, />Choose Word</);
});

test('the Speak route keeps the same responsive top navigation layout as every other route', () => {
  const styles = readFileSync(resolve(projectRoot, 'css/styles.css'), 'utf8');
  assert.doesNotMatch(styles, /\.speaking-view\s+\.nav-links/);
  assert.doesNotMatch(styles, /\.speaking-view\s+\.nav-link-item/);
});

test('all cache-busted JavaScript module imports resolve to real source files', () => {
  const queue = ['js/app.js'];
  const visited = new Set();

  while (queue.length) {
    const relativePath = queue.pop();
    if (visited.has(relativePath)) continue;
    visited.add(relativePath);
    const absolutePath = resolve(projectRoot, relativePath);
    assert.equal(existsSync(absolutePath), true, `Missing module: ${relativePath}`);
    const source = readFileSync(absolutePath, 'utf8');

    for (const match of source.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const importedPath = match[1].split(/[?#]/)[0];
      const importedAbsolute = resolve(dirname(absolutePath), importedPath);
      const importedRelative = importedAbsolute.slice(projectRoot.length + 1);
      assert.equal(existsSync(importedAbsolute), true, `Missing import ${match[1]} from ${relativePath}`);
      queue.push(importedRelative);
    }
  }
});

test('every cache-busted entrypoint and module import is included in the offline package', () => {
  const serviceWorker = readFileSync(resolve(projectRoot, 'sw.js'), 'utf8');
  const precachedUrls = new Set([...serviceWorker.matchAll(/'\.\/([^']+)'/g)].map(match => match[1]));
  const html = readFileSync(resolve(projectRoot, 'index.html'), 'utf8');

  for (const match of html.matchAll(/(?:src|href)=["']([^"']+\?v=\d+)["']/g)) {
    assert.equal(precachedUrls.has(match[1]), true, `Versioned entrypoint is not available offline: ${match[1]}`);
  }

  const sourceFiles = [...precachedUrls]
    .map(url => url.split(/[?#]/)[0])
    .filter(path => path.endsWith('.js'));

  for (const relativePath of new Set(sourceFiles)) {
    const source = readFileSync(resolve(projectRoot, relativePath), 'utf8');
    for (const match of source.matchAll(/from\s+['"](\.{1,2}\/[^'"]+\?v=\d+)['"]/g)) {
      const importedUrl = new URL(match[1], `https://keepvocab.local/${relativePath}`).pathname.slice(1) + new URL(match[1], `https://keepvocab.local/${relativePath}`).search;
      assert.equal(precachedUrls.has(importedUrl), true, `Versioned module is not available offline: ${importedUrl}`);
    }
  }
});
