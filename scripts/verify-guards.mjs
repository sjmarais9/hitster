#!/usr/bin/env node
//
// Checks that the data guards would actually catch the bugs they exist for:
//
//   node scripts/verify-guards.mjs
//
// A passing test suite proves the current data is clean. It proves nothing
// about whether the suite would notice if it stopped being clean - and every
// bug this project has had was a silent one that a green suite sat beside.
//
// So each guard is checked by breaking the data on purpose, in exactly the way
// it broke before, and confirming the suite goes red. A guard that stays green
// under its own bug is decoration, and is worse than nothing because it reads
// as coverage.
//
// Nothing here touches data/. Everything runs against a copy in a temp
// directory, which the data tests pick up because they read relative paths and
// this sets the working directory.

import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUITE = path.join(ROOT, 'scripts', 'data.test.mjs');
const FILES = ['songs.json', 'batch-002.seed.json', 'batch-003.seed.json',
  'batch-004.seed.json', 'batch-005.seed.json', 'batch-006.seed.json'];

/** Runs the data suite with `cwd` as its working directory. */
function runSuite(cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test', SUITE], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ green: code === 0, out }));
  });
}

/**
 * Which test names failed, so a guard can be matched to its own bug.
 *
 * Both reporter formats: node --test prints the spec reporter to a terminal and
 * TAP to a pipe, and this always runs down a pipe. Reading only the spec form
 * found nothing and reported every guard as broken - which was itself a small
 * lesson in checking that a check works.
 */
function failures(out) {
  // Colour codes sit between the test name and its timing, so matching on the
  // raw text found nothing and reported every guard as broken. Strip them
  // first - which was itself a small lesson in checking that a check works.
  const plain = out.replace(/\x1b\[[\d;]*m/g, '');
  const tap = [...plain.matchAll(/^not ok \d+ - (.+?)\s*$/gm)].map((m) => m[1]);
  const spec = [...plain.matchAll(/✖ (.+?) \(/g)].map((m) => m[1].trim());
  return [...new Set([...tap, ...spec])];
}

// Each mutation is the real bug, reproduced. `expect` is the guard that should
// notice; if some other guard fires instead, that is worth knowing too.
const MUTATIONS = [
  {
    name: 'the import drops canonicity from what it writes',
    expect: 'every playable song carries a canonicity score',
    apply: (data) => {
      for (const s of data['songs.json'].songs.slice(0, 200)) delete s.canonicity;
    },
  },
  {
    name: 'a song reaches the pool with no verified URI',
    expect: 'every playable song has a verified URI',
    apply: (data) => { data['songs.json'].songs[7].spotify_uri = null; },
  },
  {
    name: 'apply-canonicity inverts the tiers',
    expect: 'canonicity falls across the familiarity tiers',
    apply: (data) => {
      for (const file of FILES) {
        for (const s of data[file].songs) {
          if (s.canonicity != null) s.canonicity = 100 - s.canonicity;
        }
      }
    },
  },
  {
    name: 'the skew seed puts nothing before 2000 on the children\'s side',
    expect: 'the children can be dealt music from before they were born',
    apply: (data) => {
      for (const file of FILES) {
        for (const s of data[file].songs) if (s.year < 2000) s.skew = 'adults';
      }
    },
  },
  {
    name: 'a year stops matching its decade',
    expect: 'every year is plausible and matches its decade',
    apply: (data) => { data['songs.json'].songs[3].year = 1731; },
  },
  {
    name: 'a tag is misspelled',
    expect: 'every tag is one of the values the sampler knows',
    apply: (data) => { data['songs.json'].songs[11].familiarity = 'standrad'; },
  },
  {
    name: 'the same song is added twice',
    expect: 'the pool has no duplicates',
    apply: (data) => {
      data['songs.json'].songs.push({ ...data['songs.json'].songs[0] });
    },
  },
  {
    name: 'a fat field is added to every record',
    expect: 'the pool stays small enough to download at a party',
    apply: (data) => {
      for (const s of data['songs.json'].songs) s.notes = 'x'.repeat(220);
    },
  },
];

const original = {};
for (const f of FILES) {
  original[f] = await readFile(path.join(ROOT, 'data', f), 'utf8');
}

const work = await mkdtemp(path.join(tmpdir(), 'hitster-guards-'));
await mkdir(path.join(work, 'data'), { recursive: true });

async function writeAll(data) {
  for (const f of FILES) {
    await writeFile(path.join(work, 'data', f), JSON.stringify(data[f]), 'utf8');
  }
}

const parse = () => Object.fromEntries(FILES.map((f) => [f, JSON.parse(original[f])]));

console.log('Checking that each guard catches the bug it exists for.\n');

// The control. If this is not green, the mutations below prove nothing.
await writeAll(parse());
const control = await runSuite(work);
console.log(control.green
  ? '  control (data untouched)                                  green, as it must be'
  : `  control (data untouched)                                  RED - ${failures(control.out).join(', ')}`);

if (!control.green) {
  console.error('\nThe suite is already failing, so nothing below can be trusted. Fix that first.');
  await rm(work, { recursive: true, force: true });
  process.exit(1);
}

let missed = 0;
console.log();

for (const m of MUTATIONS) {
  const data = parse();
  m.apply(data);
  await writeAll(data);

  const result = await runSuite(work);
  const caught = failures(result.out);

  if (result.green) {
    missed++;
    console.log(`  MISSED  ${m.name}`);
    console.log(`          nothing failed; "${m.expect}" slept through it`);
  } else if (caught.includes(m.expect)) {
    const also = caught.filter((c) => c !== m.expect);
    console.log(`  caught  ${m.name}`);
    if (also.length) console.log(`          (also tripped: ${also.join(', ')})`);
  } else {
    // Still a failure, but not from the guard meant to own this bug - which
    // means that guard is weaker than it looks.
    missed++;
    console.log(`  WRONG   ${m.name}`);
    console.log(`          expected "${m.expect}", got ${caught.join(', ')}`);
  }
}

await rm(work, { recursive: true, force: true });

console.log(`\n${MUTATIONS.length - missed}/${MUTATIONS.length} guards catch their own bug.`);
if (missed) {
  console.error('A guard that stays green under its own bug is decoration. Strengthen it.');
  process.exit(1);
}
