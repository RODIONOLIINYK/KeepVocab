const { app, ipcMain, net, BrowserWindow } = require('electron');
const { mkdir } = require('node:fs/promises');
const { downloadVerifiedUpdate } = require('./updateDownload.cjs');
const { prepareMacUpdate, launchMacUpdate } = require('./macUpdate.cjs');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

function configureUpdater(isAppUrl, beforeQuit = () => {}) {
  let offered = null;
  let inFlight = null;
  let installing = null;
  let autoUpdater = null;
  let downloaded = false;
  const notify = detail => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.webContents.isDestroyed() && isAppUrl(window.webContents.getURL())) window.webContents.send('keepvocab:update-progress', detail);
    }
  };
  if (app.isPackaged && process.platform === 'darwin') {
    // Squirrel.Mac requires a distribution signature. Personal builds stage a verified DMG.
    const { spawnSync } = require('node:child_process');
    const signature = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=2', app.getPath('exe')], { encoding: 'utf8' });
    if (/Authority=Developer ID Application:/.test(signature.stderr || '')) {
      autoUpdater = require('electron-updater').autoUpdater;
      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = false;
      autoUpdater.on('error', () => {});
      autoUpdater.on('update-downloaded', () => { downloaded = true; });
      autoUpdater.on('download-progress', progress => notify({ status: 'downloading', received: progress.transferred, total: progress.total }));
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
    installing = (async () => {
      if (autoUpdater) {
        if (!downloaded) await autoUpdater.downloadUpdate();
        if (!downloaded) throw new Error('The update is still downloading. Try again shortly.');
        setImmediate(() => { beforeQuit(); autoUpdater.quitAndInstall(); });
        return { status: 'installing', message: 'Restarting KeepVocab to install the update.' };
      }
      const update = { ...offered };
      const directory = path.join(app.getPath('userData'), 'updates');
      await mkdir(directory, { recursive: true });
      const destination = path.join(directory, path.basename(update.name));
      await downloadVerifiedUpdate(update, destination, (...args) => net.fetch(...args), notify);
      const prepared = await prepareMacUpdate({ dmg: destination, executable: app.getPath('exe'), version: update.version, updatesDirectory: directory, onProgress: notify });
      await launchMacUpdate(prepared, process.pid, directory);
      // Give the renderer time to display the final status before quitting.
      setTimeout(() => { beforeQuit(); app.quit(); }, 500);
      return { status: 'installing', message: 'Restarting KeepVocab to install the update. Your Library and progress stay saved.' };
    })().finally(() => { installing = null; });
    return installing;
  };
  const guard = event => { if (!isAppUrl(event.senderFrame?.url || '')) throw new Error('Untrusted update request.'); };
  ipcMain.handle('keepvocab:check-update', async event => { guard(event); return check(); });
  ipcMain.handle('keepvocab:install-update', async event => { guard(event); return install(); });
}
module.exports = { configureUpdater };
