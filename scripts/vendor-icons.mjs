// Optional maintenance command. Normal builds use committed assets, without network.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export const FONT_AWESOME_VERSION = '6.5.1';
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Start at an icon selector so embedded font data cannot trigger quadratic
// backtracking while inspecting the committed, self-contained stylesheet.
const mappingRule = /((?:\.fa-[a-z0-9-]+:before,?)+)\{content:"(\\[0-9a-f]+)"\}/g;
const iconClass = /\bfa-[a-z0-9-]+\b/g;
const families = new Map([
  ['fa-solid', 'solid'], ['fas', 'solid'],
  ['fa-regular', 'regular'], ['far', 'regular'],
  ['fa-brands', 'brands'], ['fab', 'brands']
]);

export async function collectIconSources(root = projectRoot) {
  const sources = [];
  async function collect(directory) {
    for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await collect(file);
      else if (/\.(?:js|html)$/.test(file)) sources.push({ file, content: await readFile(path.join(root, file), 'utf8') });
    }
  }
  await collect('js');
  for (const file of ['index.html', 'quick-add.html']) sources.push({ file, content: await readFile(path.join(root, file), 'utf8') });
  return sources;
}

// Utility classes (size, animation, family, etc.) are taken from the pinned CSS,
// rather than treating a misspelled or Pro-only icon as a harmless utility.
export function getUtilityClasses(css) {
  const withoutMappings = css.replace(mappingRule, '');
  return [...new Set([...withoutMappings.matchAll(/\.(fa-[a-z0-9-]+)\b/g)].map(match => match[1]))].sort();
}

export function getIconReferences(sources, utilityClasses) {
  const utilities = new Set(utilityClasses);
  const references = [];
  for (const { file, content } of sources) {
    const classes = [...content.matchAll(/\bclass(?:Name)?\s*=\s*(["'`])([\s\S]*?)\1/g)];
    for (const match of content.matchAll(iconClass)) {
      if (utilities.has(match[0])) continue;
      const attribute = classes.find(item => match.index >= item.index && match.index < item.index + item[0].length);
      const tokens = attribute?.[2].split(/\s+/) || [];
      const style = tokens.map(token => families.get(token)).find(Boolean) || null;
      references.push({ name: match[0], style, file, line: content.slice(0, match.index).split('\n').length });
    }
  }
  return references;
}

export function validateIconReferences(references, icons) {
  const errors = [];
  for (const { name, style, file, line } of references) {
    if (!icons[name]) errors.push(`${file}:${line}: ${name} is not in Font Awesome Free ${FONT_AWESOME_VERSION}.`);
    else if (style && !icons[name].styles.includes(style)) {
      errors.push(`${file}:${line}: ${name} has no free ${style} glyph (available: ${icons[name].styles.join(', ')}).`);
    }
  }
  if (errors.length) throw new Error(`Icon validation failed:\n${[...new Set(errors)].join('\n')}`);
}

export function subsetIconCss(css, used) {
  return css.replace(mappingRule, (rule, selectors) =>
    [...selectors.matchAll(/\.(fa-[a-z0-9-]+):before/g)].some(match => used.has(match[1])) ? rule : '');
}

export function getIconMappings(css) {
  return new Map([...css.matchAll(mappingRule)]
    .flatMap(match => [...match[1].matchAll(/\.(fa-[a-z0-9-]+):before/g)].map(icon => [icon[1], match[2].slice(1)])));
}

async function bundleIcons(staging) {
  const download = async file => {
    if (staging) return readFile(path.join(staging, path.basename(file)));
    const response = await fetch(`https://raw.githubusercontent.com/FortAwesome/Font-Awesome/${FONT_AWESOME_VERSION}/${file}`);
    if (!response.ok) throw new Error(`Could not download icon asset ${file}: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  };
  const [sources, cssParts, metadataData] = await Promise.all([
    collectIconSources(),
    Promise.all(['fontawesome.min.css', 'solid.min.css', 'regular.min.css', 'brands.min.css'].map(async file => String(await download(`css/${file}`)))),
    download('metadata/icons.json')
  ]);
  const metadata = JSON.parse(String(metadataData));
  const available = {};
  for (const [name, definition] of Object.entries(metadata)) {
    for (const alias of [name, ...(definition.aliases?.names || [])]) {
      available[`fa-${alias}`] = { name, unicode: definition.unicode, styles: definition.free };
    }
  }
  const utilityClasses = getUtilityClasses(cssParts.join('\n'));
  const references = getIconReferences(sources, utilityClasses);
  validateIconReferences(references, available);
  const used = new Set(references.map(reference => reference.name));
  let css = subsetIconCss(cssParts.join('\n'), used);
  for (const font of ['fa-solid-900', 'fa-regular-400', 'fa-brands-400']) {
    const data = await download(`webfonts/${font}.woff2`);
    css = css.replaceAll(`url(../webfonts/${font}.woff2)`, `url(data:font/woff2;base64,${data.toString('base64')})`)
      .replaceAll(`,url(../webfonts/${font}.ttf) format("truetype")`, '');
  }
  if (/\.\.\/webfonts\//.test(css)) throw new Error('Unbundled icon font reference.');
  const manifest = {
    version: FONT_AWESOME_VERSION,
    source: `https://github.com/FortAwesome/Font-Awesome/tree/${FONT_AWESOME_VERSION}`,
    utilityClasses,
    icons: Object.fromEntries([...used].sort().map(name => [name, available[name]]))
  };
  await writeFile(path.join(projectRoot, 'css/icons.css'), css + '\n');
  await writeFile(path.join(projectRoot, 'assets/fontawesome-icons.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(path.join(projectRoot, 'assets/FONT-AWESOME-LICENSE.txt'), await download('LICENSE.txt'));
  console.log(`Bundled Font Awesome Free ${FONT_AWESOME_VERSION}: ${used.size} icons, ${Buffer.byteLength(css)} bytes; fonts embedded for offline use.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await bundleIcons(process.argv[2]);
}
