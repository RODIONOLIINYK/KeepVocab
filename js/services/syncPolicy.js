export const DRIVE_SYNC_MIN_INTERVAL_MS = 60_000;
export const DRIVE_SYNC_DEBOUNCE_MS = 1_500;

export function backgroundSyncDelay(lastSyncAt, now = Date.now()) {
  const elapsed = Math.max(0, Number(now) - Number(lastSyncAt || 0));
  return Math.max(DRIVE_SYNC_DEBOUNCE_MS, DRIVE_SYNC_MIN_INTERVAL_MS - elapsed);
}

// Pull other devices' progress even when this device has nothing to upload.
export const DRIVE_REMOTE_REFRESH_MS = 5 * 60_000;

export function shouldPullFromDrive(lastSyncAt, now = Date.now(), { resumed = false } = {}) {
  const elapsed = Math.max(0, Number(now) - Number(lastSyncAt || 0));
  return elapsed >= (resumed ? DRIVE_SYNC_MIN_INTERVAL_MS : DRIVE_REMOTE_REFRESH_MS);
}
