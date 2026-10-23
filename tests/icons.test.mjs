import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  FONT_AWESOME_VERSION, collectIconSources, getIconReferences,
  getUtilityClasses, getIconMappings, subsetIconCss, validateIconReferences
} from '../scripts/vendor-icons.mjs';

test('every application icon has a bundled mapping and a free glyph in its requested style', async () => {
  const [sources, css, manifestText] = await Promise.all([
    collectIconSources(),
    readFile(new URL('../css/icons.css', import.meta.url), 'utf8'),
    readFile(new URL('../assets/fontawesome-icons.json', import.meta.url), 'utf8')
  ]);
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.version, FONT_AWESOME_VERSION);
  const references = getIconReferences(sources, manifest.utilityClasses);
  validateIconReferences(references, manifest.icons);
  const mappings = getIconMappings(css);
  for (const { name, file, line } of references) {
    assert.equal(mappings.get(name), manifest.icons[name].unicode, `${file}:${line}: ${name} must have its correct bundled glyph`);
  }
  assert.equal((css.match(/url\(data:font\/woff2;base64,/g) || []).length, 3);
  assert.doesNotMatch(css, /url\((?!data:)/, 'icons must work offline without external fonts');
});

test('icon maintenance rejects missing icons and unavailable free styles before writing assets', () => {
  const sources = [{ file: 'view.js', content: `<i class="fa-solid fa-seedling fa-spin"></i>\n<i class="fa-regular fa-seedling"></i>\n<i class="fa-solid fa-sparkles"></i>` }];
  const references = getIconReferences(sources, ['fa-solid', 'fa-regular', 'fa-spin']);
  assert.equal(references.length, 3);
  assert.throws(() => validateIconReferences(references, { 'fa-seedling': { styles: ['solid'] } }), error => {
    assert.match(error.message, /view\.js:2: fa-seedling has no free regular glyph/);
    assert.match(error.message, /view\.js:3: fa-sparkles is not in Font Awesome Free/);
    return true;
  });
});

test('icon subsetting retains aliases, dynamic template choices, and utility styles', () => {
  const css = '.fa-solid{font-weight:900}.fa-spin{animation:spin 2s linear infinite}.fa-seedling:before,.fa-sprout:before{content:"\\f4d8"}.fa-image:before{content:"\\f03e"}.fa-cloud:before{content:"\\f0c2"}';
  const utilities = getUtilityClasses(css);
  assert.deepEqual(utilities, ['fa-solid', 'fa-spin']);
  const references = getIconReferences([{ file: 'view.js', content: '<i class="fa-solid ${ready ? \'fa-sprout\' : \'fa-image\'} fa-spin"></i>' }], utilities);
  assert.deepEqual(references.map(({ name, style }) => [name, style]), [['fa-sprout', 'solid'], ['fa-image', 'solid']]);
  const subset = subsetIconCss(css, new Set(references.map(({ name }) => name)));
  assert.match(subset, /\.fa-seedling:before,\.fa-sprout:before/);
  assert.match(subset, /\.fa-image:before/);
  assert.match(subset, /\.fa-spin\{/);
  assert.doesNotMatch(subset, /\.fa-cloud:before/);
});
