#!/usr/bin/env node
//
// Confirms a built site is complete and self-consistent:
//
//   node scripts/check-site.mjs [dir]        default: _site
//
// The deploy publishes a hand-picked subset of the repository rather than all
// of it, which is the right thing to do - roughly 12MB of batch seeds, scripts
// and docs were being served to browsers that never ask for them - but a
// hand-picked list is a list that can be wrong, and getting it wrong breaks the
// app in a way no unit test can see. Nothing in the suite ever fetches a file
// over HTTP.
//
// So rather than trusting the list, this follows the references: every relative
// URL in the HTML, every url() in the CSS, every relative import in the
// modules, resolved and checked to exist. A file that stops being copied stops
// the deploy instead of stopping the app.

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] ?? '_site');

const problems = [];
const checked = new Set();

const isExternal = (url) =>
  /^(https?:)?\/\//.test(url) || url.startsWith('data:') || url.startsWith('#')
  || url.startsWith('mailto:');

/** Strips the cache-busting stamp and any fragment, leaving a path. */
const clean = (url) => url.split('#')[0].split('?')[0].trim();

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

/** Records that `from` points at `url`, and checks the target is there. */
async function follow(from, url) {
  if (!url || isExternal(url)) return;
  const target = clean(url);
  if (!target) return;

  const resolved = target.startsWith('/')
    ? path.join(ROOT, target)
    : path.resolve(path.dirname(from), target);

  const key = path.relative(ROOT, resolved);
  if (checked.has(key)) return;
  checked.add(key);

  if (!(await exists(resolved))) {
    problems.push(`${path.relative(ROOT, from)} -> ${target} (missing)`);
  }
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}

if (!(await exists(ROOT))) {
  console.error(`No such directory: ${ROOT}`);
  process.exit(1);
}

const files = await walk(ROOT);

for (const file of files) {
  const ext = path.extname(file);
  if (!['.html', '.css', '.js', '.webmanifest'].includes(ext)) continue;
  const text = await readFile(file, 'utf8');

  if (ext === '.html') {
    for (const m of text.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/g)) {
      await follow(file, m[1]);
    }
  }
  if (ext === '.css') {
    for (const m of text.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
      await follow(file, m[1]);
    }
  }
  if (ext === '.js') {
    // Relative specifiers only; bare and absolute ones are not ours to resolve.
    for (const m of text.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g)) {
      await follow(file, m[1]);
    }
  }
  if (ext === '.webmanifest') {
    for (const m of text.matchAll(/"src"\s*:\s*"([^"]+)"/g)) {
      await follow(file, m[1]);
    }
  }
}

// The pool is fetched at runtime by a string built in game.js, so no reference
// scan will ever find it. It is the one file worth naming outright.
const pool = path.join(ROOT, 'data', 'songs.json');
if (!(await exists(pool))) {
  problems.push('data/songs.json (missing - the deck would be empty)');
} else {
  const { songs } = JSON.parse(await readFile(pool, 'utf8'));
  if (!songs?.length) problems.push('data/songs.json holds no songs');
}

// Fonts are redistributed by serving them, and both of ours are under licences
// that require the licence to travel with the file.
for (const font of files.filter((f) => f.endsWith('.woff2'))) {
  const dir = path.dirname(font);
  const siblings = await readdir(dir);
  if (!siblings.some((f) => /licen[cs]e|OFL/i.test(f))) {
    problems.push(`${path.relative(ROOT, font)} is published with no licence beside it`);
  }
}

const bytes = (await Promise.all(files.map(async (f) => (await stat(f)).size)))
  .reduce((a, b) => a + b, 0);

console.log(`${files.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MB`);
console.log(`${checked.size} references followed`);

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

console.log('every reference resolves.');
