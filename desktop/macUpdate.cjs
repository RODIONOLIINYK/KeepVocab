const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { access, mkdtemp, mkdir, copyFile, chmod, open, rm, lstat, realpath } = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const run = promisify(execFile);

async function verifyBundle(bundle, version) {
  if (!(await lstat(bundle)).isDirectory() || await realpath(bundle) !== path.resolve(bundle)) throw new Error('Invalid app bundle.');
  const plist = path.join(bundle, 'Contents/Info.plist');
  const read = async key => (await run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist])).stdout.trim();
  if (await read('CFBundleIdentifier') !== 'com.keepvocab.app' || await read('CFBundleShortVersionString') !== version) {
    throw new Error('The downloaded app has an unexpected identity or version.');
  }
  const executable = await read('CFBundleExecutable');
  if (path.basename(executable) !== executable) throw new Error('Invalid app executable.');
  await access(path.join(bundle, 'Contents/MacOS', executable), constants.X_OK);
}

async function prepareMacUpdate({ dmg, executable, version, updatesDirectory, onProgress = () => {} }) {
  const target = path.resolve(executable, '../../..');
  if (!target.endsWith('.app') || target.includes('/AppTranslocation/') || target.startsWith('/Volumes/')) {
    throw new Error('Move KeepVocab into Applications and open it there before updating.');
  }
  const parent = path.dirname(target);
  try { await access(parent, constants.W_OK); }
  catch { throw new Error('KeepVocab cannot write to its installation folder. Move it to your Applications folder and try again.'); }
  // Staging beside the installed app makes both replacement moves atomic.
  const staging = await mkdtemp(path.join(parent, '.KeepVocab-update-'));
  await chmod(staging, 0o700);
  const mount = await mkdtemp(path.join(updatesDirectory, 'mount-'));
  const staged = path.join(staging, 'next.app');
  let attached = false;
  try {
    onProgress({ status: 'preparing', message: 'Verifying and preparing the new app…' });
    await run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmg], { timeout: 120_000 });
    attached = true;
    const source = path.join(mount, 'KeepVocab.app');
    await verifyBundle(source, version);
    await run('/usr/bin/ditto', [source, staged], { timeout: 180_000 });
    await verifyBundle(staged, version);
    const helper = path.join(staging, 'replace.sh');
    await copyFile(path.join(__dirname, 'replaceApp.sh'), helper);
    await chmod(helper, 0o700);
    return { target, staged, backup: path.join(staging, 'previous.app'), helper, staging };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  } finally {
    // Never recursively delete a mount point if unmounting failed.
    if (attached) await run('/usr/bin/hdiutil', ['detach', mount], { timeout: 30_000 }).catch(() => {});
    await require('node:fs/promises').rmdir(mount).catch(() => {});
  }
}

async function launchMacUpdate(prepared, pid, updatesDirectory) {
  await mkdir(updatesDirectory, { recursive: true });
  const log = await open(path.join(updatesDirectory, 'install.log'), 'a', 0o600);
  try {
    const child = spawn('/bin/sh', [prepared.helper, String(pid), prepared.target, prepared.staged, prepared.backup, '/usr/bin/open'], {
      detached: true, stdio: ['ignore', log.fd, log.fd], cwd: prepared.staging
    });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
  } finally { await log.close(); }
}

module.exports = { prepareMacUpdate, launchMacUpdate, verifyBundle };
