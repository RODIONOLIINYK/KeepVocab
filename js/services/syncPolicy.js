export const DRIVE_SYNC_MIN_INTERVAL_MS = 60_000;
export const DRIVE_SYNC_DEBOUNCE_MS = 1_500;

export function backgroundSyncDelay(lastSyncAt, now = Date.now()) {
  const elapsed = Math.max(0, Number(now) - Number(lastSyncAt || 0));
  return Math.max(DRIVE_SYNC_DEBOUNCE_MS, DRIVE_SYNC_MIN_INTERVAL_MS - elapsed);
}
