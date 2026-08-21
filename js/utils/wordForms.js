const IRREGULAR_NOUNS = new Map([
  ['child', ['children']], ['foot', ['feet']], ['goose', ['geese']], ['man', ['men']],
  ['mouse', ['mice']], ['person', ['people']], ['tooth', ['teeth']], ['woman', ['women']]
]);

const IRREGULAR_VERBS = new Map([
  ['be', ['am', 'is', 'are', 'was', 'were', 'been', 'being']],
  ['begin', ['begins', 'began', 'begun', 'beginning']],
  ['break', ['breaks', 'broke', 'broken', 'breaking']],
  ['bring', ['brings', 'brought', 'bringing']],
  ['buy', ['buys', 'bought', 'buying']],
  ['come', ['comes', 'came', 'coming']],
  ['do', ['does', 'did', 'done', 'doing']],
  ['drink', ['drinks', 'drank', 'drunk', 'drinking']],
  ['drive', ['drives', 'drove', 'driven', 'driving']],
  ['eat', ['eats', 'ate', 'eaten', 'eating']],
  ['fall', ['falls', 'fell', 'fallen', 'falling']],
  ['feel', ['feels', 'felt', 'feeling']],
  ['find', ['finds', 'found', 'finding']],
  ['fly', ['flies', 'flew', 'flown', 'flying']],
  ['forget', ['forgets', 'forgot', 'forgotten', 'forgetting']],
  ['get', ['gets', 'got', 'gotten', 'getting']],
  ['give', ['gives', 'gave', 'given', 'giving']],
  ['go', ['goes', 'went', 'gone', 'going']],
  ['grow', ['grows', 'grew', 'grown', 'growing']],
  ['have', ['has', 'had', 'having']],
  ['keep', ['keeps', 'kept', 'keeping']],
  ['know', ['knows', 'knew', 'known', 'knowing']],
  ['leave', ['leaves', 'left', 'leaving']],
  ['make', ['makes', 'made', 'making']],
  ['meet', ['meets', 'met', 'meeting']],
  ['read', ['reads', 'reading']],
  ['run', ['runs', 'ran', 'running']],
  ['say', ['says', 'said', 'saying']],
  ['see', ['sees', 'saw', 'seen', 'seeing']],
  ['send', ['sends', 'sent', 'sending']],
  ['sit', ['sits', 'sat', 'sitting']],
  ['speak', ['speaks', 'spoke', 'spoken', 'speaking']],
  ['take', ['takes', 'took', 'taken', 'taking']],
  ['teach', ['teaches', 'taught', 'teaching']],
  ['tell', ['tells', 'told', 'telling']],
  ['think', ['thinks', 'thought', 'thinking']],
  ['wear', ['wears', 'wore', 'worn', 'wearing']],
  ['win', ['wins', 'won', 'winning']],
  ['write', ['writes', 'wrote', 'written', 'writing']]
]);

function normalize(value) {
  return String(value || '').trim().toLocaleLowerCase().replace(/[’]/g, "'").replace(/^to\s+/, '').replace(/\s+/g, ' ');
}

function isCvc(value) {
  return /^[a-z]*[^aeiou][aeiou][^aeiouwxy]$/.test(value);
}

function regularThirdPerson(base) {
  if (/[^aeiou]y$/.test(base)) return `${base.slice(0, -1)}ies`;
  if (/(?:s|x|z|ch|sh|o)$/.test(base)) return `${base}es`;
  return `${base}s`;
}

function regularPast(base) {
  if (/e$/.test(base)) return `${base}d`;
  if (/[^aeiou]y$/.test(base)) return `${base.slice(0, -1)}ied`;
  if (/c$/.test(base)) return `${base}ked`;
  if (isCvc(base)) return `${base}${base.at(-1)}ed`;
  return `${base}ed`;
}

function regularParticiple(base) {
  if (/ie$/.test(base)) return `${base.slice(0, -2)}ying`;
  if (/c$/.test(base)) return `${base}king`;
  if (/[^e]e$/.test(base) && !/(?:ee|ye|oe)$/.test(base)) return `${base.slice(0, -1)}ing`;
  if (isCvc(base)) return `${base}${base.at(-1)}ing`;
  return `${base}ing`;
}

function nounForms(base) {
  const plural = IRREGULAR_NOUNS.get(base) || [regularThirdPerson(base)];
  return [base, ...plural, `${base}'s`, ...plural.map(form => `${form}'`)];
}

function verbForms(base) {
  return [base, regularThirdPerson(base), regularPast(base), regularParticiple(base), ...(IRREGULAR_VERBS.get(base) || [])];
}

function adjectiveForms(base) {
  if (/[^aeiou]y$/.test(base)) return [base, `${base.slice(0, -1)}ier`, `${base.slice(0, -1)}iest`];
  if (/e$/.test(base)) return [base, `${base}r`, `${base}st`];
  if (isCvc(base)) return [base, `${base}${base.at(-1)}er`, `${base}${base.at(-1)}est`];
  return [base, `${base}er`, `${base}est`];
}

function inflectPhrase(base, partOfSpeech) {
  const tokens = base.split(' ');
  if (tokens.length === 1) {
    // A saved dictionary sense can be a noun while the learner naturally uses
    // the same lexeme as a verb ("a cuddle" -> "cuddled"). Keep every common
    // grammatical family available to the evaluator; meaning is judged later.
    return [...nounForms(base), ...verbForms(base), ...adjectiveForms(base)];
  }
  const index = /verb/.test(partOfSpeech) ? 0 : tokens.length - 1;
  const forms = /verb/.test(partOfSpeech) ? verbForms(tokens[index]) : nounForms(tokens[index]);
  return forms.map(form => tokens.map((token, tokenIndex) => tokenIndex === index ? form : token).join(' '));
}

export function targetWordForms(word) {
  const base = normalize(typeof word === 'string' ? word : word?.word);
  if (!base) return [];
  const partOfSpeech = normalize(typeof word === 'string' ? '' : word?.partOfSpeech);
  return [...new Set(inflectPhrase(base, partOfSpeech))].sort((left, right) => right.length - left.length);
}

function formsPattern(word) {
  const alternatives = targetWordForms(word).map(form => form
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+'));
  return alternatives.length ? new RegExp(`(^|[^\\p{L}\\p{M}])(${alternatives.join('|')})(?=$|[^\\p{L}\\p{M}])`, 'iu') : null;
}

export function sentenceUsesTargetForm(sentence, word) {
  return formsPattern(word)?.test(String(sentence || '').replace(/[’]/g, "'")) || false;
}

export function replaceTargetWordForm(sentence, word, replacement = '________') {
  const pattern = formsPattern(word);
  return pattern ? String(sentence || '').replace(pattern, (match, prefix) => `${prefix}${replacement}`) : String(sentence || '');
}
