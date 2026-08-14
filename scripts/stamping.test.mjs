// Tests for the asset stamper: node --test scripts/stamping.test.mjs
//
// Written because this is the one piece of logic that has failed silently twice
// - both times producing a written file, a success message, and not a single
// stamped URL. Every assertion here is a URL shape that actually appears in the
// project, so a pattern that stops matching one of them fails loudly.

import test from 'node:test';
import assert from 'node:assert/strict';
import { stamp, bare, STAMP } from './lib/stamping.mjs';

const V = 'abcd1234';

test('module specifiers are stamped', () => {
  assert.equal(stamp(`import { x } from './scoring.js';`, V),
    `import { x } from './scoring.js?v=${V}';`);
  assert.equal(stamp(`import * as f from "./filters.js";`, V),
    `import * as f from "./filters.js?v=${V}";`);
  assert.equal(stamp(`export { a } from './lib-thing.js';`, V),
    `export { a } from './lib-thing.js?v=${V}';`);
});

test('the html entry points are stamped', () => {
  const cases = [
    [`<link rel="stylesheet" href="css/style.css">`, `<link rel="stylesheet" href="css/style.css?v=${V}">`],
    [`<script type="module" src="src/app.js"></script>`, `<script type="module" src="src/app.js?v=${V}"></script>`],
    [`<link rel="icon" href="icons/icon-192.png">`, `<link rel="icon" href="icons/icon-192.png?v=${V}">`],
    [`<link href='./css/style.css'>`, `<link href='./css/style.css?v=${V}'>`],
  ];
  for (const [input, expected] of cases) assert.equal(stamp(input, V), expected, input);
});

test('font urls inside the stylesheet are stamped, however they are quoted', () => {
  // The case that silently did nothing for several releases.
  assert.equal(stamp(`src: url('../fonts/yellowtail.woff2') format('woff2');`, V),
    `src: url('../fonts/yellowtail.woff2?v=${V}') format('woff2');`);
  assert.equal(stamp(`src: url("../fonts/barlow-condensed.woff2");`, V),
    `src: url("../fonts/barlow-condensed.woff2?v=${V}");`);
  assert.equal(stamp(`src: url(../fonts/barlow-condensed.woff2);`, V),
    `src: url(../fonts/barlow-condensed.woff2?v=${V});`);
});

test('a mismatched pair of quotes is left alone rather than mangled', () => {
  // The backreference exists for this. Without it the pattern would happily
  // match across the wrong quote and write something that is not a URL.
  const wrong = `url('../fonts/yellowtail.woff2")`;
  assert.equal(stamp(wrong, V), wrong);
});

test('absolute and third-party urls are never touched', () => {
  const external = [
    `<script src="https://sdk.scdn.co/spotify-player.js"></script>`,
    `<link href="//cdn.example.com/css/style.css">`,
    `import x from 'https://esm.sh/thing.js';`,
    `background: url('https://example.com/fonts/x.woff2');`,
  ];
  for (const line of external) assert.equal(stamp(line, V), line, line);
});

test('stamping is idempotent', () => {
  const source = `<link href="css/style.css"><script src="src/app.js"></script>`;
  const once = stamp(source, V);
  assert.equal(stamp(once, V), once, 'stamping twice should change nothing');
});

test('a new version replaces the old stamp rather than appending', () => {
  const once = stamp(`import { x } from './scoring.js';`, V);
  const twice = stamp(once, 'ffff9999');
  assert.equal(twice, `import { x } from './scoring.js?v=ffff9999';`);
  assert.equal(twice.match(/\?v=/g).length, 1, 'stamps must not accumulate');
});

test('bare() removes every stamp so the hash sees the source', () => {
  const stamped = `a='./x.js?v=abcd1234' b="css/y.css?v=00ff00ff"`;
  assert.equal(bare(stamped), `a='./x.js' b="css/y.css"`);
  assert.equal(bare(stamped).match(STAMP), null);
});

test('a stamp is only recognised in the shape the hasher writes', () => {
  // bare() must not eat a query string that happens to look similar, or the
  // hash would be computed over text that differs from what is on disk.
  const other = `<img src="pic.png?version=1"><a href="?v=notahash">`;
  assert.equal(bare(other), other);
});

test('the real project files are all matched by at least one pattern', async () => {
  // Guards against a rename quietly taking a file out of scope: if index.html
  // stops matching, nothing errors, it simply stops being cache-busted.
  const { readFile } = await import('node:fs/promises');
  for (const file of ['index.html', 'css/style.css', 'src/app.js']) {
    const text = await readFile(file, 'utf8');
    assert.notEqual(stamp(text, V), bare(text), `${file} has no stampable URL`);
  }
});
