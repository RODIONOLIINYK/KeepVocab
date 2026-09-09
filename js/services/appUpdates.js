import { APP_VERSION } from './version.js';
export { APP_VERSION };
export const RELEASE_API = 'https://api.github.com/repos/RODIONOLIINYK/KeepVocab/releases/latest';
const RELEASE_PREFIX = 'https://github.com/RODIONOLIINYK/KeepVocab/releases/download/';

export function compareVersions(a, b) {
  const parse = value => /^v?\d+\.\d+\.\d+$/.test(String(value)) ? String(value).replace(/^v/, '').split('.').map(Number) : null;
  const left = parse(a); const right = parse(b);
  if (!left || !right) return 0;
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}

export function selectRelease(release, platform, currentVersion = APP_VERSION) {
  if (!release || release.draft || release.prerelease || compareVersions(release.tag_name, currentVersion) <= 0) return null;
  const version = release.tag_name.replace(/^v/, '');
  const suffix = platform === 'android' ? /-Android-(?:debug|release)\.apk$/ : platform === 'darwin' ? /-macOS-universal\.dmg$/ : null;
  if (!suffix) return null;
  const asset = release.assets?.find(item => item.name?.startsWith(`KeepVocab-${version}-`) && suffix.test(item.name)
    && item.browser_download_url?.startsWith(`${RELEASE_PREFIX}${release.tag_name}/`)
    && /^sha256:[a-f0-9]{64}$/i.test(item.digest || '') && item.size > 0 && item.size < 600_000_000);
  return asset ? { version, url: asset.browser_download_url, name: asset.name, sha256: asset.digest.slice(7).toLowerCase(), size: asset.size } : null;
}

function androidUpdater() {
  const capacitor = globalThis.Capacitor;
  if (capacitor?.getPlatform?.() !== 'android') return null;
  return capacitor.Plugins?.AppUpdate || capacitor.registerPlugin?.('AppUpdate');
}

export async function checkAppUpdate() {
  if (globalThis.keepVocabDesktop?.checkForUpdates) return globalThis.keepVocabDesktop.checkForUpdates();
  const android = androidUpdater();
  if (android) {
    const { version } = await android.getVersion();
    const response = await fetch(RELEASE_API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error('Cannot check for updates right now. Try again when you are online.');
    const update = selectRelease(await response.json(), 'android', version);
    return { status: update ? 'available' : 'current', currentVersion: version, update };
  }
  const registration = await globalThis.navigator?.serviceWorker?.getRegistration();
  if (registration) {
    await registration.update();
    return { status: registration.waiting ? 'web-ready' : 'web-current', currentVersion: APP_VERSION };
  }
  return { status: 'development', currentVersion: APP_VERSION };
}

export async function installAppUpdate(update) {
  if (globalThis.keepVocabDesktop?.installUpdate) return globalThis.keepVocabDesktop.installUpdate();
  const android = androidUpdater();
  if (android) {
    return android.downloadAndInstall({
      url: update.url,
      sha256: update.sha256 || '',
      size: Number(update.size) || 0
    });
  }
  const registration = await globalThis.navigator?.serviceWorker?.getRegistration();
  if (registration?.waiting) {
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
    registration.waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
  }
  return { status: 'web-ready' };
}

let pendingCheck = null;
export function startAutomaticUpdateChecks(target = globalThis) {
  if (!target.document || target.__keepVocabUpdateChecks) return;
  target.__keepVocabUpdateChecks = true;
  const check = () => {
    if (target.document.hidden || target.navigator?.onLine === false || pendingCheck) return;
    // Background checks must never cover or interrupt the learning interface.
    // Installation controls live exclusively in Settings.
    pendingCheck = checkAppUpdate().catch(() => {}).finally(() => { pendingCheck = null; });
  };
  target.setTimeout(check, 15_000);
  target.setInterval(check, 6 * 60 * 60_000);
  target.document.addEventListener('visibilitychange', () => {
    if (!target.document.hidden) {
      const last = Number(target.sessionStorage.getItem('keepvocab_update_checked_at') || 0);
      if (Date.now() - last > 60 * 60_000) { target.sessionStorage.setItem('keepvocab_update_checked_at', String(Date.now())); check(); }
    }
  });
}
