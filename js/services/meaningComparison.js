// Comparison-only preprocessing. Original dictionary definitions, annotations,
// source IDs and explicit user judgments keep their exact text.
export const MEANING_COMPARISON_VERSION = 'parenthetical-free-v1';
export function meaningComparisonText(value) {
  let text = String(value || '');
  // Remove balanced nested round/square brackets from the inside out. An
  // unmatched bracket must not erase the rest of a dictionary definition.
  for (;;) {
    const next = text.replace(/\([^()[\]]*\)|\[[^()[\]]*\]/gu, ' ');
    if (next === text) return text.replace(/\s+/g, ' ').replace(/\s+([,;.!?])/g, '$1').trim();
    text = next;
  }
}
export function meaningGlossText(value) {
  return meaningComparisonText(value)
    // Dictionary subject/domain introductions qualify a use of the following
    // gloss; they are retained in the source rather than treated as its words.
    .replace(/^(?:of|said of|used of)\s+[^:;.!?]+?(?::|,)(?=\s*(?:to|a|an|the|having|being|not)\b)\s*/i, '')
    .trim();
}

const OPPOSITES = [['happy', 'unhappy'], ['possible', 'impossible'], ['able', 'unable'], ['legal', 'illegal'],
  ['allowed', 'forbidden'], ['permitted', 'forbidden'], ['allowed', 'prohibited'], ['permitted', 'prohibited'],
  ['permit', 'prohibit'], ['increase', 'decrease'], ['give', 'receive'], ['buy', 'sell'],
  ['open', 'closed'], ['include', 'exclude'], ['present', 'absent'], ['wet', 'dry'], ['alive', 'dead'],
  ['hot', 'cold'], ['full', 'empty'], ['before', 'after'], ['above', 'below'], ['internal', 'external'],
  ['temporary', 'permanent'], ['voluntary', 'involuntary'], ['win', 'lose']];
// Normalize common explicit polarity paraphrases without touching the vectors
// or rewriting weaker claims such as “not hot” to “cold”.
const NEGATED_EQUIVALENTS = Object.freeze({ allowed: 'forbidden', permitted: 'forbidden', possible: 'impossible',
  legal: 'illegal', real: 'fake', happy: 'unhappy' });
function polarityNormalized(text) {
  return text.replace(/\bnot\s+(allowed|permitted|possible|legal|real|happy)\b/g, (_, word) => NEGATED_EQUIVALENTS[word]);
}
export function meaningEmbeddingText(value) {
  return polarityNormalized(meaningComparisonText(value).toLowerCase());
}

function transferRoles(text) {
  const match = text.match(/^(.*?)\b(?:give|gives|giving|gave|send|sends|sending|sent|lend|lends|lending|lent)\s+(.+?)\s+to\s+([^.;,]+)[.!?]?$/);
  if (!match) return null;
  return match.slice(1).map(part => part.replace(/\b(?:a|an|the|to)\b|[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim());
}

function processOrResult(text) {
  const gloss = meaningGlossText(text);
  if (/^(?:(?:an?|the) )?(?:act|action|activity|process) of\b/.test(gloss)) return 'process';
  if (/^(?:(?:an?|the) )?(?:result|outcome|product) of\b/.test(gloss)) return 'result';
  return null;
}
// Contradiction vetoes only. Similarity decides equivalence; these rules can
// only keep apart definitions that reuse the same content with opposite
// polarity, opposite terms, different quantities/bounds or reversed roles.
export function hasExplicitMeaningConflict(left, right) {
  const a = polarityNormalized(String(left.sourceDefinition || left.definition || '').toLowerCase().replaceAll('’', "'"));
  const b = polarityNormalized(String(right.sourceDefinition || right.definition || '').toLowerCase().replaceAll('’', "'"));
  const kindA = processOrResult(a), kindB = processOrResult(b);
  if (kindA && kindB && kindA !== kindB) return true;
  const negation = /\b(?:no|not|never|non(?=[-\s])|without|cannot|unable|lacking|can't|isn't|aren't|doesn't|don't|fail(?:s|ed)? to)\b/;
  const tokensA = new Set(a.match(/[a-z]+/g)), tokensB = new Set(b.match(/[a-z]+/g));
  const meaningful = set => [...set].filter(t => t.length > 2 && !/^(?:the|and|that|which|who|with|for|from|having|being|capable|thing|person|fail|failed|fails)$/.test(t));
  const ma = meaningful(tokensA), mb = meaningful(tokensB), shared = ma.filter(t => mb.includes(t)).length;
  const sameContent = shared / Math.max(1, ma.length, mb.length) >= .4 || shared / Math.max(1, Math.min(ma.length, mb.length)) >= .6;
  if (negation.test(a) !== negation.test(b)) {
    const strip = text => text.replace(new RegExp(negation.source, 'g'), '').replace(/[^a-z0-9]+/g, ' ').trim();
    // "Not real" may paraphrase "fake". Only assert a polarity conflict when
    // both definitions reuse the same content or differ solely in negation.
    if (strip(a) === strip(b) || sameContent) return true;
  }
  if (OPPOSITES.some(([x, y]) => tokensA.has(x) && tokensB.has(y) && !tokensA.has(y) && !tokensB.has(x)
    || tokensA.has(y) && tokensB.has(x) && !tokensA.has(x) && !tokensB.has(y))) return true;
  if (JSON.stringify(meaningComparisonText(a).match(/\b\d+(?:\.\d+)?\b/g) || []) !== JSON.stringify(meaningComparisonText(b).match(/\b\d+(?:\.\d+)?\b/g) || [])) return true;
  const bounds = text => [...new Set(text.match(/\b(?:at least|at most|more than|less than|only|solely|exclusively|unless|except)\b/g) || [])].sort();
  if (JSON.stringify(bounds(a)) !== JSON.stringify(bounds(b))) return true;
  const relations = text => [...new Set(meaningComparisonText(text).match(/\b(?:before|after|until|since|during|above|below|inside|outside|into|out of)\b/g) || [])].sort();
  const relationA = relations(a), relationB = relations(b);
  // Additional detail alone is not a contradictory relation. For example,
  // “plugged into a power outlet” is optional detail in a charging gloss.
  if (sameContent && relationA.length && relationB.length && JSON.stringify(relationA) !== JSON.stringify(relationB)) return true;
  const rolesA = transferRoles(meaningComparisonText(a)), rolesB = transferRoles(meaningComparisonText(b));
  if (!rolesA || !rolesB) return false;
  const [agentA, objectA, recipientA] = rolesA;
  const [agentB, objectB, recipientB] = rolesB;
  return Boolean(agentA && agentA !== recipientA && agentA === recipientB && agentB === recipientA && objectA === objectB
    || agentA === agentB && objectA !== recipientA && objectA === recipientB && objectB === recipientA);
}
