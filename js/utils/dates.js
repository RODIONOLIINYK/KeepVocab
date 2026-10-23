export const DAILY_EVALUATION_HOUR = 8;

export function localDateKey(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, '0'), String(value.getDate()).padStart(2, '0')].join('-');
}

export function getStudyDayStart(now = new Date(), evaluationHour = DAILY_EVALUATION_HOUR) {
  const current = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  const hour = Math.max(0, Math.min(23, Math.floor(Number(evaluationHour) || DAILY_EVALUATION_HOUR)));
  const start = new Date(current.getTime());
  start.setHours(hour, 0, 0, 0);
  if (current.getTime() < start.getTime()) {
    start.setDate(start.getDate() - 1);
    start.setHours(hour, 0, 0, 0);
  }
  return start;
}

export function getNextStudyDayStart(now = new Date(), evaluationHour = DAILY_EVALUATION_HOUR) {
  const start = getStudyDayStart(now, evaluationHour);
  const next = new Date(start.getTime());
  next.setDate(next.getDate() + 1);
  next.setHours(Math.max(0, Math.min(23, Math.floor(Number(evaluationHour) || DAILY_EVALUATION_HOUR))), 0, 0, 0);
  return next;
}

export function studyDayKey(now = new Date(), evaluationHour = DAILY_EVALUATION_HOUR) {
  return localDateKey(getStudyDayStart(now, evaluationHour));
}
