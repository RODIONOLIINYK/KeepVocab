const { app, ipcMain, net, shell } = require('electron');
const { createWriteStream } = require('node:fs');
const { mkdir, rm } = require('node:fs/promises');
const { pipeline } = require('node:stream/promises');
const { Readable, Transform } = require('node:stream');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

function configureUpdater(isAppUrl) {
  let offered = null;
  let inFlight = null;
  let installing = null;
  let autoUpdater = null;
  let downloaded = false;
  if (app.isPackaged && process.platform === 'darwin') {
    // Squirrel.Mac needs a distribution signature; personal builds use a verified DMG.
    const { spawnSync } = require('node:child_process');
    const signature = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=2', app.getPath('exe')], { encoding: 'utf8' });
    if (/Authority=Developer ID Application:/.test(signature.stderr || '')) {
      autoUpdater = require('electron-updater').autoUpdater;
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = false;
      autoUpdater.on('error', () => {});
      autoUpdater.on('update-downloaded', () => { downloaded = true; });
    }
  }
  const check = async () => {
    if (!app.isPackaged) return { status: 'development', currentVersion: app.getVersion() };
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const { RELEASE_API, selectRelease } = await import(pathToFileURL(path.join(__dirname, '../www/js/services/appUpdates.js')).href);
      const response = await net.fetch(RELEASE_API, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Cannot check for updates right now. Please try again later.');
      offered = selectRelease(await response.json(), process.platform, app.getVersion());
      if (offered && autoUpdater) await autoUpdater.checkForUpdates();
      return { status: offered ? downloaded ? 'downloaded' : 'available' : 'current', currentVersion: app.getVersion(), update: offered };
    })().finally(() => { inFlight = null; });
    return inFlight;
  };
  const install = async () => {
    if (installing) return installing;
    if (!offered) throw new Error('Check for an update first.');
    if (autoUpdater) {
      if (!downloaded) await autoUpdater.downloadUpdate();
      if (!downloaded) throw new Error('The update is still downloading. Try again shortly.');
      setImmediate(() => autoUpdater.quitAndInstall());
      return { status: 'installing', message: 'Restarting KeepVocab to install the update.' };
    }
    installing = (async () => {
      const update = { ...offered };
      const directory = path.join(app.getPath('userData'), 'updates');
      await mkdir(directory, { recursive: true });
      const destination = path.join(directory, path.basename(update.name));
      const partial = `${destination}.part`;
      try {
        const response = await net.fetch(update.url, { signal: AbortSignal.timeout(10 * 60_000) });
        if (!response.ok || !response.body) throw new Error('The download could not start.');
        const hash = createHash('sha256'); let bytes = 0;
        await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, _encoding, callback) {
          bytes += chunk.length;
          if (bytes > update.size) return callback(new Error('Unexpected update size.'));
          hash.update(chunk); callback(null, chunk);
        } }), createWriteStream(partial));
        if (bytes !== update.size || hash.digest('hex') !== update.sha256) throw new Error('The update failed verification. Please download it again.');
        await require('node:fs/promises').rename(partial, destination);
        const error = await shell.openPath(destination);
        if (error) throw new Error(error);
        return { status: 'installer-open', message: 'The verified installer is open. Replace KeepVocab in Applications, then reopen it. Your learning data stays saved.' };
      } finally { await rm(partial, { force: true }); }
    })().finally(() => { installing = null; });
    return installing;
  };
  const guard = event => { if (!isAppUrl(event.senderFrame?.url || '')) throw new Error('Untrusted update request.'); };
  ipcMain.handle('keepvocab:check-update', async event => { guard(event); return check(); });
  ipcMain.handle('keepvocab:install-update', async event => { guard(event); return install(); });
}
module.exports = { configureUpdater };
