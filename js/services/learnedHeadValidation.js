// Groups, never individual images or definition pairs, define the boundary.
// This is a conservative promotion check, not a claim of benchmark accuracy.
export function validateLearnedHead(rows, { group, fit, score, baseline, rankingGroup, minimumGroups = 5 } = {}) {
  const groups = [...new Set(rows.map(group))].sort();
  if (groups.length < minimumGroups) return { accepted: false, reason: 'Waiting for more independently labeled words.' };
  const fold = row => { let h = 2166136261; for (const c of group(row)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) % 5; };
  const training = rows.filter(r => fold(r) < 3);
  const held = rows.filter(r => fold(r) >= 3);
  const head = fit(training);
  if (!head || held.filter(r => r.label === 1).length < 2 || held.filter(r => r.label === 0).length < 2) return { accepted: false, reason: 'Both labels are needed in training and held-out words.' };
  const loss = scorer => held.reduce((s, row) => {
    const p = Math.max(1e-6, Math.min(1 - 1e-6, scorer(row)));
    return s - Math.log(row.label ? p : 1 - p) / held.length;
  }, 0);
  const before = loss(baseline), after = loss(row => score(head, row));
  if (!Number.isFinite(after) || after >= before - .001) return { accepted: false, reason: 'The learned head did not improve on held-out words.', before, after };
  if (rankingGroup) {
    const choices = new Map();
    for (const row of held) { const key = rankingGroup(row); if (!choices.has(key)) choices.set(key, []); choices.get(key).push(row); }
    let beforeTop1 = 0, afterTop1 = 0, galleries = 0;
    for (const items of choices.values()) {
      if (!items.some(r => r.label === 1) || !items.some(r => r.label === 0)) continue;
      galleries++; beforeTop1 += [...items].sort((a, b) => baseline(b) - baseline(a))[0].label;
      afterTop1 += [...items].sort((a, b) => score(head, b) - score(head, a))[0].label;
    }
    if (galleries < 2 || afterTop1 < beforeTop1) return { accepted: false, reason: 'Held-out first-choice image ranking did not improve safely.', before, after, galleries, beforeTop1, afterTop1 };
  }
  return { accepted: true, head, before, after, trainingCount: training.length, heldOutCount: held.length, groups: groups.length,
    validation: 'group-held-out-log-loss', trainingGroups: [...new Set(training.map(group))] };
}
