import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { downloadVerifiedUpdate } from '../desktop/updateDownload.cjs';
import { verifyBundle } from '../desktop/macUpdate.cjs';

const exec = promisify(execFile);
const helper = fileURLToPath(new URL('../desktop/replaceApp.sh', import.meta.url));
async function workspace(t) {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'keepvocab-update-test-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
const bytes = Buffer.from('verified application bytes');
const update = { url: 'https://example.test/app.dmg', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };

test('download retries interrupted transfers, verifies bytes, and reuses a verified installer', async t => {
  const file = path.join(await workspace(t), 'update.dmg');
  let calls = 0; const progress = [];
  const fetch = async () => { if (++calls === 1) throw new Error('connection lost'); return new Response(bytes); };
  await downloadVerifiedUpdate(update, file, fetch, item => progress.push(item));
  assert.equal(calls, 2);
  assert.deepEqual(await readFile(file), bytes);
  assert.ok(progress.some(item => item.status === 'retrying'));
  assert.equal(progress.at(-1).received, bytes.length);
  await downloadVerifiedUpdate(update, file, fetch);
  assert.equal(calls, 2);
  await assert.rejects(access(`${file}.part`));
});

test('invalid digest and excess bytes never become installable downloads', async t => {
  const dir = await workspace(t);
  for (const data of [Buffer.alloc(bytes.length), Buffer.alloc(bytes.length + 1)]) {
    const file = path.join(dir, 'invalid.dmg');
    await assert.rejects(downloadVerifiedUpdate(update, file, async () => new Response(data)), /verification|size/);
    await assert.rejects(access(file));
    await assert.rejects(access(`${file}.part`));
  }
});

test('stalled transfers abort and surface a retryable error', async t => {
  const file = path.join(await workspace(t), 'stalled.dmg');
  await assert.rejects(downloadVerifiedUpdate(update, file, async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('stalled')), { once: true });
  }), () => {}, { stallMs: 10, retries: 0 }), /interrupted/);
  await assert.rejects(access(`${file}.part`));
});

for (const success of [true, false]) {
  test(`replacement ${success ? 'keeps a backup and reopens' : 'rolls back when reopening fails'} without touching learning data`, { skip: process.platform === 'win32' }, async t => {
    const dir = await workspace(t);
    const target = path.join(dir, "Keep Vocab's $(literal).app");
    const staged = path.join(dir, 'next.app'); const backup = path.join(dir, 'previous.app');
    await mkdir(target); await mkdir(staged);
    await writeFile(path.join(target, 'version'), 'old'); await writeFile(path.join(staged, 'version'), 'new');
    await writeFile(path.join(dir, 'learning-data'), 'saved progress');
    const pid = spawnSync('/usr/bin/true').pid;
    const run = () => exec('/bin/sh', [helper, String(pid), target, staged, backup, success ? '/usr/bin/true' : '/usr/bin/false']);
    if (success) await run(); else await assert.rejects(run());
    assert.equal(await readFile(path.join(target, 'version'), 'utf8'), success ? 'new' : 'old');
    if (success) assert.equal(await readFile(path.join(backup, 'version'), 'utf8'), 'old');
    assert.equal(await readFile(path.join(dir, 'learning-data'), 'utf8'), 'saved progress');
  });
}

test('bundle verification rejects unrelated apps and wrong release versions', { skip: process.platform !== 'darwin' }, async t => {
  const bundle = path.join(await workspace(t), 'KeepVocab.app');
  await mkdir(path.join(bundle, 'Contents/MacOS'), { recursive: true });
  await writeFile(path.join(bundle, 'Contents/MacOS/KeepVocab'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const writePlist = (id, version) => writeFile(path.join(bundle, 'Contents/Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${id}</string><key>CFBundleShortVersionString</key><string>${version}</string><key>CFBundleExecutable</key><string>KeepVocab</string></dict></plist>`);
  await writePlist('com.keepvocab.app', '1.7.2'); await verifyBundle(bundle, '1.7.2');
  await assert.rejects(verifyBundle(bundle, '1.7.1'), /identity or version/);
  await writePlist('com.other.app', '1.7.2'); await assert.rejects(verifyBundle(bundle, '1.7.2'), /identity or version/);
});
