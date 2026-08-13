// Version-stamp every asset URL, so a deploy is actually seen.
//
//   node scripts/stamp.mjs          stamp, and report
//   node scripts/stamp.mjs --check  exit 1 if stamping would change anything
//
// GitHub Pages serves everything with `Cache-Control: max-age=600` and offers
// no way to change that. Nothing here is versioned, so a phone that has the app
// on its home screen keeps running the old CSS and the old modules until each
// one happens to expire.
//
// Worse than merely stale: each ES module is cached independently, so they
// expire at different moments and the app can end up running new app.js against
// old scoring.js - a combination that was never tested and need not work.
//
// The fix is a query string that changes when the code does. index.html is
// still cached for up to ten minutes, but once it is refetched every asset it
// points at is refetched with it, as a set. No service worker: those solve this
// problem by taking on a harder version of it.
//
// The stamp is a hash of the source, not a timestamp, so an unchanged tree
// restamps to the same value and the script is safe to run whenever.

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';

const HTML = ['index.html', 'callback/index.html'];
const CHECK = process.argv.includes('--check');

// Any existing stamp, so hashing sees the source rather than the last stamp.
const STAMP = /\?v=[0-9a-f]{8}/g;
const bare = (text) => text.replace(STAMP, '');

const sources = (await readdir('src')).filter((f) => f.endsWith('.js')).sort();

// Fonts are referenced from inside the stylesheet, so they need stamping too -
// and their bytes have to reach the hash, or replacing a font would leave the
// old one cached behind an unchanged URL.
const fonts = (await readdir('fonts').catch(() => []))
  .filter((f) => f.endsWith('.woff2')).sort();

async function read(file) {
  return { file, text: await readFile(file, 'utf8') };
}

const files = await Promise.all([
  ...HTML.map(read),
  ...sources.map((f) => read(`src/${f}`)),
  read('css/style.css'),
]);

// One hash over everything, so any change restamps every reference. Finer
// granularity would mean tracking which module imports which, to no benefit:
// the whole app is about 40kB.
const hash = createHash('sha1');
for (const { file, text } of files) hash.update(`${file}\n${bare(text)}\n`);
for (const font of fonts) hash.update(await readFile(`fonts/${font}`));
const version = hash.digest('hex').slice(0, 8);

/** Adds or replaces the stamp on a relative URL, leaving absolute ones alone. */
function stamp(text) {
  return bare(text)
    // Module specifiers: from './scoring.js'
    .replace(/(from\s+['"]\.\/[\w.-]+\.js)(['"])/g, `$1?v=${version}$2`)
    // index.html: href="css/style.css", src="src/app.js"
    .replace(/((?:href|src)=["'](?:\.\/)?(?:css|src|icons)\/[\w./-]+\.(?:css|js|png))(["'])/g,
      `$1?v=${version}$2`)
    // style.css: url('../fonts/oswald.woff2'). The backreference makes the
    // closing quote match whichever one opened it, and match nothing at all
    // when the url was written unquoted.
    .replace(/(url\((['"]?)\.\.\/fonts\/[\w.-]+\.woff2)(\2\))/g, `$1?v=${version}$3`);
}

let changed = 0;
const touched = [];
for (const { file, text } of files) {
  const next = stamp(text);
  if (next === text) continue;
  changed++;
  touched.push(file);
  if (!CHECK) await writeFile(file, next, 'utf8');
}

console.log(`version ${version}`);

if (CHECK) {
  if (changed) {
    console.log(`\n${changed} file(s) are not stamped for this version:`);
    for (const f of touched) console.log(`  ${f}`);
    console.log('\nRun: npm run stamp');
    process.exit(1);
  }
  console.log('every asset URL is stamped for the current source.');
} else {
  console.log(changed ? `stamped ${changed} file(s):` : 'already up to date; nothing written.');
  for (const f of touched) console.log(`  ${f}`);
}
