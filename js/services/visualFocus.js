export const VISUAL_FOCUS_CLASSES = ['entity', 'place', 'action', 'state', 'relation', 'abstract'];

export function normalizeVisualFocus(value) {
  if (!value || !Array.isArray(value.focus_classes) || !value.focus_classes.length
    || value.focus_classes.length > 6 || value.focus_classes.some(c => !VISUAL_FOCUS_CLASSES.includes(c))) return null;
  const strings = items => Array.isArray(items) && items.length <= 12 && items.every(s => typeof s === 'string' && s.trim() && s.length <= 240);
  if (!strings(value.required) || !value.required.length || !strings(value.incidental)) return null;
  return { focus_classes: VISUAL_FOCUS_CLASSES.filter(c => value.focus_classes.includes(c)),
    required: value.required.map(s => s.trim()), incidental: value.incidental.map(s => s.trim()) };
}
