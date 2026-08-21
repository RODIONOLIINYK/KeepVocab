import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
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

test('Drive uses the built-in web client and the UI never asks users for OAuth configuration', () => {
  const html = readFileSync(resolve(projectRoot, 'index.html'), 'utf8');
  const driveSync = readFileSync(resolve(projectRoot, 'js/services/driveSync.js'), 'utf8');
  assert.match(driveSync, /GOOGLE_WEB_CLIENT_ID = '23308644025-div17rqsfbtgihgf7saoaobcjs4n9h5h\.apps\.googleusercontent\.com'/);
  assert.doesNotMatch(driveSync, /userinfo\.email|oauth2\/v3\/userinfo/);
  assert.doesNotMatch(html, /modal-client-id-input|OAuth web client ID|Authorized JavaScript origin/);
  assert.match(html, /> Connect and synchronize/);
});

test('the Library has one Edit action with Pexels-first search, public fallbacks, custom links, and file uploads', () => {
  const library = readFileSync(resolve(projectRoot, 'js/components/LibraryView.js'), 'utf8');
  const settings = readFileSync(resolve(projectRoot, 'js/components/SettingsView.js'), 'utf8');
  assert.doesNotMatch(library, /data-change-image|generate-memory-image|id="pexels-api-key"|id="settings-pexels-key"/);
  assert.match(settings, /id="settings-pexels-key"/);
  assert.match(settings, /Pexels · recommended/);
  assert.match(settings, /included in your private KeepVocab Google Drive backup/);
  assert.match(library, /Openverse, Wikimedia Commons, Library of Congress, and NASA Images/);
  assert.match(library, /searched in parallel/);
  assert.match(library, /id="custom-image-url"/);
  assert.match(library, /id="custom-image-file"/);
  assert.match(library, /> More images</);
  assert.match(library, /AI concepts stay concise at 5–7 concrete words/);
  assert.doesNotMatch(library, /Refresh suggestions/);
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
  assert.match(activity, /registerPlugin\(NativeSpeechPlugin\.class\)/);
  const speechPlugin = readFileSync(resolve(projectRoot, 'android/app/src/main/java/com/keepvocab/app/NativeSpeechPlugin.java'), 'utf8');
  assert.match(speechPlugin, /TextToSpeech/);
  assert.match(speechPlugin, /TextToSpeech\.QUEUE_FLUSH/);
  assert.match(plugin, /auth\/drive\.file/);
  assert.match(plugin, /Identity\.getAuthorizationClient/);
  assert.match(plugin, /23308644025-i69m4ncivbe9jvf3pa1kepj8fb8ruh4g\.apps\.googleusercontent\.com/);
  assert.doesNotMatch(plugin, /resultCode != Activity\.RESULT_OK \|\| data == null/);
  assert.ok(
    plugin.indexOf('if (data == null)') < plugin.indexOf('getAuthorizationResultFromIntent(data)'),
    'Native auth must parse every returned Intent instead of discarding non-OK result codes'
  );
});

test('mobile system chrome and the app header use one white top surface', () => {
  const html = readFileSync(resolve(projectRoot, 'index.html'), 'utf8');
  const manifest = JSON.parse(readFileSync(resolve(projectRoot, 'manifest.json'), 'utf8'));
  const styles = readFileSync(resolve(projectRoot, 'css/styles.css'), 'utf8');
  const androidStyles = readFileSync(resolve(projectRoot, 'android/app/src/main/res/values/styles.xml'), 'utf8');
  assert.match(html, /name="theme-color" content="#ffffff"/);
  assert.match(html, /viewport-fit=cover/);
  assert.equal(manifest.theme_color, '#ffffff');
  assert.match(styles, /env\(safe-area-inset-top\)/);
  assert.match(androidStyles, /android:statusBarColor">#FFFFFF/);
  assert.match(androidStyles, /android:windowLightStatusBar">true/);
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

test('routine settings can open from the dedicated Settings route', () => {
  const app = readFileSync(resolve(projectRoot, 'js/app.js'), 'utf8');
  const settings = readFileSync(resolve(projectRoot, 'js/components/SettingsView.js'), 'utf8');
  assert.match(settings, /id="settings-routine"/);
  assert.match(app, /control\.id === 'settings-routine'\) openSettings\(\)/);
});

test('exercise routes share an aligned header and content routes use the same title system', () => {
  const app = readFileSync(resolve(projectRoot, 'js/app.js'), 'utf8');
  const styles = readFileSync(resolve(projectRoot, 'css/styles.css'), 'utf8');
  const flashcards = readFileSync(resolve(projectRoot, 'js/components/FlashcardsMode.js'), 'utf8');
  const context = readFileSync(resolve(projectRoot, 'js/components/ContextQuizMode.js'), 'utf8');
  const daily = readFileSync(resolve(projectRoot, 'js/components/DailySessionMode.js'), 'utf8');
  const library = readFileSync(resolve(projectRoot, 'js/components/LibraryView.js'), 'utf8');
  assert.match(app, /'library', 'stats', 'settings'/);
  assert.match(styles, /\.exercise-topbar\s*\{[^}]*display:grid;[^}]*grid-template-columns:auto minmax\(0,1fr\) auto/);
  assert.match(flashcards, /class="exercise-topbar"/);
  assert.match(context, /class="exercise-topbar"/);
  assert.match(flashcards, /flashcard-exit'[\s\S]*go\('dashboard', onNavigate\)/);
  assert.match(context, /context-exit'[\s\S]*go\('dashboard', onNavigate\)/);
  assert.match(styles, /\.daily-exit-button\s*\{[^}]*width:\s*76px;[^}]*min-height:\s*40px;/);
  assert.match(styles, /\.daily-exit-button\s*\{[^}]*width:42px;[^}]*min-height:42px;[^}]*border-radius:50%/);
  assert.match(daily, /class="daily-exit-button"/);
  assert.match(daily, /daily-answer-form \$\{exercise\.exerciseType === 'use-it' \? 'is-sentence' : 'is-recall'\}/);
  assert.match(styles, /\.daily-answer-form\.is-recall, \.daily-answer-form\.is-sentence\s*\{[^}]*grid-template-columns:minmax\(0,1fr\) auto;[^}]*border-radius:16px;/);
  assert.match(styles, /\.daily-answer-form\.is-recall:focus-within,[^}]*border-color:#4ade80;/);
  assert.match(daily, /exercise\.exerciseType === 'use-it' \? `<input id="daily-answer" type="text"/);
  assert.match(library, /class="content-title-row"/);
  assert.match(styles, /\.settings-icon\.ai,[\s\S]*\.settings-icon\.routine\s*\{[^}]*primary-green/);
});

test('streak protection uses device notifications without an internal notification center', () => {
  const html = readFileSync(resolve(projectRoot, 'index.html'), 'utf8');
  const app = readFileSync(resolve(projectRoot, 'js/app.js'), 'utf8');
  const reminder = readFileSync(resolve(projectRoot, 'js/services/reminderService.js'), 'utf8');
  const capacitor = readFileSync(resolve(projectRoot, 'capacitor.config.json'), 'utf8');
  const notificationIcon = readFileSync(resolve(projectRoot, 'android/app/src/main/res/drawable/ic_stat_keepvocab.xml'), 'utf8');
  assert.doesNotMatch(html, /id="btn-notification-center"/);
  assert.doesNotMatch(html, /id="notification-popover"/);
  assert.match(html, /id="streak-reminder-enabled"/);
  assert.match(app, /buildStreakMaintenancePlan/);
  assert.doesNotMatch(app, /setupNotificationCenter/);
  assert.match(reminder, /STREAK_REMINDER_ID = 73002/);
  assert.doesNotMatch(reminder, /Notification\.requestPermission|scheduleWebTimer/);
  assert.match(reminder, /status: 'android-only'/);
  assert.match(capacitor, /"smallIcon": "ic_stat_keepvocab"/);
  assert.match(notificationIcon, /android:fillColor="#FFFFFFFF"/);
});

test('optimized Sprig artwork is preloaded and packaged for instant route changes', () => {
  const html = readFileSync(resolve(projectRoot, 'index.html'), 'utf8');
  const serviceWorker = readFileSync(resolve(projectRoot, 'sw.js'), 'utf8');
  const mascotFiles = [
    'keepvocab-sprig-thinking.webp',
    'keepvocab-sprig-celebrate.webp',
    'keepvocab-sprig-reminder.webp',
    'keepvocab-sprout-mascot.webp'
  ];
  for (const file of mascotFiles) {
    assert.match(html, new RegExp(`rel="preload"[^>]+${file}`));
    assert.match(serviceWorker, new RegExp(`assets/${file}`));
    assert.ok(statSync(resolve(projectRoot, 'assets', file)).size < 100_000, `${file} should remain under 100 KB`);
  }
});

test('mobile navigation and reduced motion are first-class behavior', () => {
  const html = readFileSync(resolve(projectRoot, 'index.html'), 'utf8');
  const styles = readFileSync(resolve(projectRoot, 'css/styles.css'), 'utf8');
  for (const label of ['Today', 'Practice', 'Speak', 'Library', 'Progress']) assert.match(html, new RegExp(`\\b${label}\\b`));
  assert.match(styles, /@media \(max-width:\s*720px\)[\s\S]*\.nav-links[\s\S]*position:\s*fixed/);
  assert.match(styles, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*animation-duration:\s*\.001ms/);
});

test('answer states include icons and status semantics instead of relying on color alone', () => {
  const daily = readFileSync(resolve(projectRoot, 'js/components/DailySessionMode.js'), 'utf8');
  const visual = readFileSync(resolve(projectRoot, 'js/components/VisualMatchMode.js'), 'utf8');
  assert.match(daily, /role="status"/);
  assert.match(daily, /fa-check|fa-xmark/);
  assert.match(visual, /choice-result-icon/);
  assert.match(visual, /fa-check/);
  assert.match(visual, /fa-xmark/);
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
