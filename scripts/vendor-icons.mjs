// Optional maintenance command. Normal builds use committed assets, without network.
// Keep the version aligned with the Font Awesome source previously used by the app.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
const version = '6.5.1';
const staging = process.argv[2];
const files = ['fontawesome.min.css', 'solid.min.css', 'regular.min.css', 'brands.min.css'];
const download = async file => {
  if (staging) return readFile(path.join(staging, path.basename(file)));
  const url = file === 'LICENSE.txt'
    ? `https://raw.githubusercontent.com/FortAwesome/Font-Awesome/${version}/LICENSE.txt`
    : `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/${version}/${file}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download icon asset ${file}: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
};
const sources = [];
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(file);
    else if (/\.(?:js|html)$/.test(file)) sources.push(await readFile(file, 'utf8'));
  }
}
await collect('js');
for (const file of ['index.html', 'quick-add.html']) sources.push(await readFile(file, 'utf8'));
const used = new Set(sources.join('\n').match(/\bfa-[a-z0-9-]+/g));
let css = (await Promise.all(files.map(async file => String(await download('css/' + file))))).join('\n');
// Retain the original layout/animation rules and only icon mappings used by code.
css = css.replace(/([^{}]+)\{content:"(\\[0-9a-f]+)"\}/g, (rule, selectors) =>
  [...selectors.matchAll(/\.(fa-[a-z0-9-]+):before/g)].some(match => used.has(match[1])) ? rule : '');
for (const font of ['fa-solid-900', 'fa-regular-400', 'fa-brands-400']) {
  const data = await download(`webfonts/${font}.woff2`);
  css = css.replaceAll(`url(../webfonts/${font}.woff2)`, `url(data:font/woff2;base64,${data.toString('base64')})`)
    .replaceAll(`,url(../webfonts/${font}.ttf) format("truetype")`, '');
}
if (/\.\.\/webfonts\//.test(css)) throw new Error('Unbundled icon font reference.');
await writeFile('css/icons.css', css + '\n');
await writeFile('assets/FONT-AWESOME-LICENSE.txt', await download('LICENSE.txt'));
console.log(`Bundled Font Awesome ${version}: ${Buffer.byteLength(css)} bytes; external icon requests removed.`);
