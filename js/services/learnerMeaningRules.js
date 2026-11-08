// Learner grouping is distinct from exact definition equivalence. A technical
// application of the same core action/quantity can share a learner card while
// retaining its exact scope in the original definitions and usage notes.
import { meaningGlossText } from './meaningComparison.js';
const source = sense => String(sense.sourceDefinition || sense.definition || '').toLowerCase();
const gloss = sense => meaningGlossText(source(sense));
const historical = sense => /\b(?:obsolete|archaic|historical|dated|figurativ(?:e|ely))\b/.test(source(sense) + ' ' + (sense.labels || []).join(' '));

function core(sense) {
  if (historical(sense)) return null;
  const text = gloss(sense), pos = String(sense.partOfSpeech || '').toLowerCase();
  if (/\b(?:no|not|never|without|cannot|unable|only|solely|exclusively|unless|except|at least|at most|more than|less than)\b|\d/.test(text)) return null;
  if (pos === 'verb') {
    if (/^to replenish energy\b/.test(text) && /\b(?:battery|electrical)\b/.test(source(sense)))
      return { key: 'replenish-energy', definition: 'To restore the energy in a battery or a device powered by one.' };
    if (/^to (?:make a machine operate|be operating or working normally)[.!?]?$/.test(text))
      return { key: 'machine-operation', definition: 'To operate, or make a machine operate.' };
    // Result production, including domain-specific result/return descriptions.
    // Producing evidence for inspection, presenting a person, and manufacture
    // without a result/return gloss are not inferred from the verb alone.
    if (/^to (?:give|produce|generate|create|bring about)\b/.test(text)
      && /\b(?:result|outcome|output|return)\b/.test(text)
      && /\b(?:produce|generate|create|bring about)\b|give as (?:a )?(?:result|outcome)/.test(text))
      return { key: 'produce-result', definition: 'To produce something as a result or return.' };
    if (/^to\b/.test(text) && /\b(?:give up|surrender|capitulate|relinquish)\b/.test(text)
      && !/\b(?:thread|process|processor|operating system|program|control|hope|habit|smoking|attempt)\b/.test(text))
      return { key: 'give-up-possession', definition: 'To give up or surrender something.' };
  }
  if (pos === 'noun') {
    // Taxonomic fruit descriptions can vary greatly in descriptive detail.
    // Require the literal fruit as the head and an explicit Latin genus;
    // references to a tree, wood, resemblance or a different genus stay apart.
    const original = meaningGlossText(sense.sourceDefinition || sense.definition || '');
    if (/^(?:a|an|the)\s+(?:[a-z]+[,\s]+){0,6}fruit\s+(?:produced\s+by|of|from)\b/i.test(original)) {
      const genus = original.match(/\bgenus\s+([A-Z][a-z]+)\b/)?.[1]
        || original.match(/\b(?:tree|plant|vine|bush)\s+([A-Z][a-z]+)\s+[a-z]+\b/)?.[1];
      if (genus) return { key: `fruit-genus:${genus.toLowerCase()}`, definition: `The fruit of a plant in the genus ${genus}.` };
    }
    if (/^(?:measurement of )?the (?:quantity|amount|volume) of\b/.test(text)
      && /\b(?:produced|harvested|obtained)\b|escaping from a spring/.test(text)
      || /^the harvestable population growth of an ecosystem[.!?]?$/.test(text))
      return { key: 'quantity-output', definition: 'The amount produced, obtained, or provided.' };
    if (/^(?:the )?(?:profit|return)\b/.test(text) && /\b(?:investment|stock|bond)\b/.test(text)
      || /^the current return as a percentage of\b/.test(text) && /\b(?:stock|bond)\b/.test(text))
      return { key: 'investment-return', definition: 'The return earned from an investment.' };
  }
  return null;
}
export function learnerCoreMatch(left, right) {
  if (String(left.word || '').toLowerCase() !== String(right.word || '').toLowerCase()
    || String(left.partOfSpeech || '').toLowerCase() !== String(right.partOfSpeech || '').toLowerCase()) return null;
  const a = core(left), b = core(right);
  return a && a.key === b?.key ? a : null;
}
export function learnerCorePresentation(senses) {
  if (senses.length < 2) return null;
  const first = core(senses[0]);
  if (!first || !senses.slice(1).every(s => learnerCoreMatch(senses[0], s))) return null;
  if (first.key.startsWith('fruit-genus:')) return { ...first,
    definition: [...senses].sort((a, b) => a.definition.length - b.definition.length)[0].definition, usageNote: '' };
  // Keep the specialist applications inspectable; never use these broad core
  // groups as positive labels for the exact-equivalence learning head.
  const details = senses.map(source).join(' ');
  const contexts = [];
  if (first.key === 'produce-result') {
    if (/investment/.test(details)) contexts.push('investment returns');
    if (/mathematics/.test(details)) contexts.push('mathematical results');
    if (/sound law/.test(details)) contexts.push('sound changes');
  } else if (first.key === 'quantity-output') {
    if (/harvested|crop/.test(details)) contexts.push('harvests');
    if (/ecosystem/.test(details)) contexts.push('ecosystem growth');
    if (/chemical reaction/.test(details)) contexts.push('chemical reactions');
    if (/spring/.test(details)) contexts.push('water from springs');
  }
  let usageNote = contexts.length ? `Also used for ${contexts.join(', ')}.` : '';
  if (first.key === 'quantity-output' && /per unit area of land/.test(details)) usageNote += ' Harvests may be measured per unit of land.';
  if (first.key === 'investment-return' && /percentage/.test(details)) usageNote = 'Can be expressed as an amount or as a percentage of the stock or bond price.';
  if (first.key === 'give-up-possession' && /demanded/.test(details)) usageNote = 'Can describe giving something up in response to a demand.';
  if (first.key === 'replenish-energy') usageNote = 'Used for charging a battery or device, and for the battery or device recharging.';
  if (first.key === 'machine-operation') usageNote = 'Used for a machine or computer program working, and for making it work.';
  return { ...first, usageNote: usageNote.trim() };
}
