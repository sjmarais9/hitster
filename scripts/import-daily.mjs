#!/usr/bin/env node
//
// One command for a scheduled daily run:
//
//   node scripts/import-daily.mjs
//
// Works through every batch in order, resolving songs to Spotify URIs until the
// daily quota runs out, then stops cleanly. Run it again tomorrow and it picks
// up exactly where it left off, because the import checkpoints every 25 songs
// and skips anything already resolved.
//
// Needs no browser after the first run: the refresh token is cached by
// lib/cli-auth.mjs. Seed it once with an interactive import, then this can be a
// scheduled task and forgotten about.
//
// Exit codes:
//   0   everything that could be imported was
//   75  quota reached, stopped for today, progress saved (not an error)
//   1   something actually went wrong

import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readSongs } from './lib/songs-file.mjs';
import { shouldRefreshCanonicity } from './lib/import-policy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXIT_RATE_LIMITED = 75;

// When a run is locked out, Spotify says for how long. Recording that and
// refusing to call again before it expires costs nothing under any theory, and
// matters if calling while locked extends the lockout - which the evidence
// hints at:
//
//   10:24 -> Retry-After 33273s -> should clear 19:36
//   16:15 -> Retry-After 19487s -> should clear 21:39
//
// The second window ends two hours after the first predicted. Two data points
// are not proof, but polling into a closed door is worthless even if harmless,
// so there is no reason to keep doing it.
const LOCKOUT_FILE = path.join(ROOT, '.import-lockout.json');

async function lockedUntil() {
  try {
    const { until } = JSON.parse(await readFile(LOCKOUT_FILE, 'utf8'));
    const when = new Date(until);
    return when > new Date() ? when : null;
  } catch {
    return null;
  }
}

/** Reads the wait Spotify reported out of what the import just printed. */
async function recordLockout(seconds) {
  const until = new Date(Date.now() + seconds * 1000);
  try {
    await writeFile(LOCKOUT_FILE, JSON.stringify({
      until: until.toISOString(),
      note: 'Do not call Spotify before this. Delete to force an attempt.',
    }, null, 2) + '\n', 'utf8');
  } catch {
    // Not recording it only means a wasted attempt next time.
  }
  return until;
}

// Oldest first, so the batches that have been waiting longest become playable
// first. batch-002 is already in the pool.
const BATCHES = [
  'data/batch-003.seed.json',
  'data/batch-004.seed.json',
  'data/batch-005.seed.json',
  'data/batch-006.seed.json',
];

const PORT = process.argv.includes('--port')
  ? process.argv[process.argv.indexOf('--port') + 1]
  : '3001';

function runImport(file) {
  return new Promise((resolve) => {
    let seconds = null;
    // One review file per batch. They all defaulted to data/review.json, so
    // each batch overwrote the last one's findings and the file that survived
    // described whichever batch happened to run last. Batches 003, 004 and 005
    // have 22 unmatched songs between them and the file held one entry, from
    // 006 - the diagnostic record for the other 22 was destroyed nightly, and
    // then committed.
    const review = file.replace(/\.seed\.json$|\.json$/, '') + '.review.json';

    const child = spawn(
      process.execPath,
      [path.join(ROOT, 'scripts', 'import-songs.mjs'),
        '--in', file, '--review', review, '--port', PORT],
      { cwd: ROOT, stdio: ['inherit', 'pipe', 'inherit'] },
    );

    // Passed through so the log looks the same, but watched for the wait time
    // so the next run knows not to bother.
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      const match = /Rate limited for (\d+)s/.exec(chunk.toString());
      if (match) seconds = Number(match[1]);
    });

    child.on('close', (code) => resolve({ code: code ?? 1, seconds }));
  });
}

/** How many songs in a batch still have no URI. */
async function outstanding(file) {
  const doc = await readSongs(path.resolve(ROOT, file), null);
  if (!doc) return null;

  const pool = await readSongs(path.resolve(ROOT, 'data/songs.json'), { songs: [] });
  const resolved = new Set(
    (pool.songs ?? [])
      .filter((s) => s.spotify_uri)
      .map((s) => `${s.artist}|${s.title}|${s.year}`.toLowerCase()),
  );

  return (doc.songs ?? []).filter(
    (s) => !resolved.has(`${s.artist}|${s.title}|${s.year}`.toLowerCase()),
  ).length;
}

const started = new Date().toISOString().replace('T', ' ').slice(0, 19);
console.log(`=== daily import, ${started} ===\n`);

const stillLocked = await lockedUntil();
if (stillLocked) {
  const mins = Math.round((stillLocked - Date.now()) / 60000);
  console.log(`Still rate limited for about ${mins} more minutes (until ${stillLocked.toISOString().slice(11, 16)} UTC).`);
  console.log('Not calling Spotify. Delete .import-lockout.json to force an attempt.');

  // Locked-out runs are the majority, so anything that only happens on the way
  // past this point effectively never happens.
  //
  // Publish, because a previous run may have committed and failed to push, or
  // been killed between saving the pool and shipping it. Track progress, because
  // a staleness alarm that only fires on successful runs would be silent for
  // exactly the weeks it exists to notice. Neither touches Spotify.
  const held = await readSongs(path.resolve(ROOT, 'data/songs.json'), { songs: [] });
  const size = (held.songs ?? []).length;

  await publish(size);
  await trackProgress(size, await publishedSize());

  process.exit(EXIT_RATE_LIMITED);
}

let hitQuota = false;
let failed = false;

// Read before a single song is resolved, so "did the pool grow" is a fact about
// this run rather than about whatever the last one left behind.
const poolAtStart = (await readSongs(path.resolve(ROOT, 'data/songs.json'), { songs: [] })).songs?.length ?? 0;

for (const file of BATCHES) {
  const todo = await outstanding(file);

  if (todo === null) {
    console.log(`${file}: not present, skipping`);
    continue;
  }
  if (todo === 0) {
    console.log(`${file}: fully imported`);
    continue;
  }

  console.log(`\n${file}: ${todo} songs outstanding`);
  const { code, seconds } = await runImport(file);

  if (code === EXIT_RATE_LIMITED) {
    hitQuota = true;
    if (seconds) {
      const until = await recordLockout(seconds);
      console.log(`\nQuota reached. Nothing will be attempted before ${until.toISOString().slice(0, 16)}Z.`);
    } else {
      console.log(`\nQuota reached. Stopping for today; everything resolved has been saved.`);
    }
    break;
  }
  if (code !== 0) {
    console.error(`\n${file} failed with exit code ${code}. Stopping.`);
    // Not process.exit. Whatever this run checkpointed before dying is real
    // work, and exiting here would skip both the staleness marker and the
    // publish - leaving it on disk with no alarm and no route to the app.
    failed = true;
    break;
  }
}

// Keep the pool's canonicity consistent as new songs land, so the sampler is
// never weighting on scores computed from a smaller corpus.
//
// The condition is whether the pool grew, not whether the run finished tidily.
// See lib/import-policy.mjs: gating this on `!hitQuota` meant it ran only when
// nothing had landed, and it never once fired in nineteen importing runs.
const poolAfterImport = (await readSongs(path.resolve(ROOT, 'data/songs.json'), { songs: [] })).songs?.length ?? 0;

if (shouldRefreshCanonicity({ failed, poolBefore: poolAtStart, poolAfter: poolAfterImport })) {
  console.log('\nRefreshing canonicity across all files...');
  const scored = await new Promise((resolve) => {
    spawn(process.execPath, [path.join(ROOT, 'scripts', 'apply-canonicity.mjs')], {
      cwd: ROOT, stdio: 'inherit',
    }).on('close', (code) => resolve(code ?? 1));
  });

  // It refuses to write when the scores stop tracking how well known a song is,
  // and says so on stderr. Throwing the exit code away meant this wrapper
  // announced a refresh that had not happened, and then published anyway.
  if (scored !== 0) {
    console.error('\nCanonicity refused to write. Publishing the pool as it stands;');
    console.error('the scores are unchanged rather than wrong.');
  }
}

const pool = await readSongs(path.resolve(ROOT, 'data/songs.json'), { songs: [] });
const size = (pool.songs ?? []).length;
console.log(`\n=== pool is now ${size} playable songs ===`);


await publish(size);
await trackProgress(size, await publishedSize());

process.exit(failed ? 1 : hitQuota ? EXIT_RATE_LIMITED : 0);

/**
 * Notices when the import has quietly stopped working.
 *
 * This runs unattended for weeks. Every failure mode it has - expired git
 * credentials, a disabled task, a lockout that never lifts, a batch that has
 * silently finished - looks identical from the outside: nothing happens, and
 * nothing complains. The pool simply stops growing and the only symptom is a
 * deck that feels the same size it did a fortnight ago.
 *
 * So the one number that matters is remembered between runs, and a run that
 * finds it unchanged for days says so loudly in the log.
 */
async function trackProgress(local, published) {
  const FILE = path.join(ROOT, '.import-state.json');
  const now = new Date().toISOString();

  let state = {};
  try {
    state = JSON.parse(await readFile(FILE, 'utf8'));
  } catch {
    // First run, or the file was removed. Today becomes the baseline.
  }

  // The number that matters is the published one.
  //
  // This used to watch the local pool, and the local pool is not what the app
  // downloads. When five consecutive runs imported 667 songs and then failed to
  // push them, the marker advanced happily every single time - because the work
  // was real and the file on disk really was growing. It was measuring effort
  // rather than effect, and stayed silent through exactly the failure it exists
  // to catch. Somebody noticed before it did, twice.
  if (published !== null && published > (state.published ?? 0)) {
    state.published = published;
    state.publishedAt = now;
  }
  state.pool = local;
  state.checkedAt = now;
  state.note = 'Written by import-daily. `published` is what origin/main holds - '
    + 'the number the app can actually serve. Delete to reset the warnings.';

  try {
    await writeFile(FILE, JSON.stringify(state, null, 2) + '\n', 'utf8');
  } catch {
    // Losing the marker costs a warning, not the import.
  }

  // Immediate: work exists that nobody can play. No need to wait three days to
  // say so, and this is the shape every publishing failure takes.
  if (published !== null && local > published) {
    console.warn(`\nWARNING: ${local - published} songs are resolved but not published.`);
    console.warn('The app serves what is on origin/main, so they are doing nobody any good.');
    console.warn('Check the last "Could not stage" or "still unpushed" line in logs/import.log.');
  }

  // Slower: nothing has reached the app in days, whatever the reason.
  const days = state.publishedAt ? (Date.now() - Date.parse(state.publishedAt)) / 86_400_000 : 0;
  if (days >= 3) {
    console.warn(`\nWARNING: nothing new has reached the app in ${Math.floor(days)} days.`);
    console.warn('That is longer than a quota lockout, so something has stopped working.');
    console.warn('Likely: expired git credentials, a disabled scheduled task, a failing');
    console.warn('publish, or every batch already imported. Check logs/import.log.');
  }
  return state;
}

/**
 * How many songs origin/main holds - the number the app can actually serve.
 *
 * Read from the ref rather than fetched over HTTP: the ref is updated by our own
 * push, so it is exact and immediate, where the deployed file trails behind a
 * ten-minute cache and a workflow run. Returns null if it cannot be determined,
 * which is treated as "no opinion" rather than as zero.
 */
/**
 * Runs git and hands back its output.
 *
 * `out` is trimmed, which is convenient for the one-line answers most of these
 * give and was a trap for one that isn't: parsing `git status --porcelain` here
 * lost the leading space of the first line, and with it the first letter of the
 * path. Nothing parses positionally any more, but the trim is worth knowing
 * about before writing something that does.
 */
// A declaration rather than a const: the top-level code above calls publish()
// before this point in the file, and a const would still be in its temporal
// dead zone. Declarations hoist; arrow functions assigned to consts do not.
function git(...args) {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code: code ?? 1, out: out.trim() }));
    child.on('error', () => resolve({ code: 1, out: 'could not run git' }));
  });
}

async function publishedSize() {
  const shown = await git('show', 'origin/main:data/songs.json');
  if (shown.code !== 0) return null;
  try {
    return JSON.parse(shown.out).songs?.length ?? null;
  } catch {
    return null;
  }
}

/**
 * Commits the pool and pushes it, because that is the only way a resolved song
 * reaches the phone.
 *
 * Without this the import was doing all its work into a file nobody served: the
 * app fetches data/songs.json from GitHub Pages, so the deck only ever grew
 * when somebody happened to commit for an unrelated reason. Two days of
 * unattended importing sat on disk while the app kept showing the count from
 * whenever that last happened.
 *
 * Stages only the two files it owns. `git add -A` here would sweep up whatever
 * else was in the working tree at 3am, which is not a scheduled task's business.
 *
 * Never fails the run. A push can fail for reasons that have nothing to do with
 * the import - no network, expired credentials - and the commit stays put for
 * the next run to carry.
 */
async function publish(count) {
  // Everything this run is entitled to change: the pool, the review file, and
  // the batch seeds, which apply-canonicity rewrites when it re-scores. Staging
  // only the first two would leave the seeds dirty after every successful run
  // and split one logical change across two commits.
  const OURS = ['data/songs.json', 'data/*.review.json', 'data/review.json', 'data/*.seed.json',
    // The reject cache, which a run adds to whenever it establishes that a song
    // cannot be matched. Committed rather than ignored, unlike the generator's:
    // that one is rebuilt by re-asking MusicBrainz, which costs only time, while
    // this one is rebuilt by spending Spotify quota, which is the scarce thing
    // here. Leaving it unstaged would also make the working tree dirty after
    // every run that learned something.
    'data/import-rejects.json'];

  // The gate. Every bug that has hurt this project reached the pool quietly and
  // was found days later by somebody noticing something odd in the app. This is
  // the last point at which that can be stopped: if the data does not hold up,
  // it stays on this machine where it can be looked at, rather than going to
  // the phone where it becomes a mystery.
  const sound = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test', path.join(ROOT, 'scripts', 'data.test.mjs')],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ ok: code === 0, out }));
    child.on('error', () => resolve({ ok: false, out: 'could not run the data tests' }));
  });

  if (!sound.ok) {
    // The whole escape, not just its tail: dropping only the [31m leaves the
    // escape character at the head of the line, which no anchored pattern will
    // match. That printed an empty diagnosis the first time this fired.
    const plain = sound.out.replace(/\x1b\[[0-9;]*m/g, '');
    const why = plain.split('\n')
      .filter((l) => /^(✖|not ok )/.test(l.trim()) || /AssertionError|expected/.test(l))
      .slice(0, 20);

    console.error('\nNOT PUBLISHING. The pool failed its own checks:\n');
    console.error(why.length ? why.join('\n') : plain.slice(-1500));
    console.error('\nEverything is still on disk. Nothing has been committed or pushed.');
    return;
  }

  const status = await git('status', '--porcelain', '--', ...OURS);
  if (status.code !== 0) {
    console.log(`\nCould not check git status, leaving the pool uncommitted: ${status.out}`);
    return;
  }

  if (status.out) {
    // Stage the paths git names, not the patterns we asked about.
    //
    // OURS contains globs, and `git status` tolerates one that matches nothing
    // while `git add` and `git commit` treat it as fatal - so a glob with no
    // matches yet killed the commit on every run.
    //
    // The first attempt at this parsed `git status --porcelain`, whose format is
    // two status characters, a space, then the path. That was right, and it
    // still broke: the git() helper trims its output, which ate the leading
    // space of the first line, so slicing three characters took the first letter
    // of the path with it - "ata/songs.json". Five runs failed to publish while
    // the import kept working perfectly.
    //
    // So: no parsing. Two commands that emit bare paths, one per line, both of
    // which tolerate a glob that matches nothing. Nothing to mis-slice.
    const [tracked, untracked] = await Promise.all([
      git('diff', '--name-only', '--', ...OURS),
      git('ls-files', '--others', '--exclude-standard', '--', ...OURS),
    ]);

    const changed = [...new Set(
      [tracked.out, untracked.out].join('\n').split('\n').map((l) => l.trim()).filter(Boolean),
    )];

    if (!changed.length) {
      console.log('\nGit reported changes but named no files; leaving the pool alone.');
      return;
    }

    const staged = await git('add', '--', ...changed);
    if (staged.code !== 0) {
      // Discarding this is what let the pathspec failure reach the commit and
      // be reported as a commit problem.
      console.log(`\nCould not stage the pool: ${staged.out}`);
      return;
    }

    // --only, so the commit contains exactly these paths. Plain `git commit`
    // takes whatever else happens to be staged, and a scheduled task at 3am has
    // no idea what a human left in the index.
    const commit = await git('commit', '--only', '-m',
      `Import: the pool reaches ${count} playable songs\n\n` +
      'Written by scripts/import-daily.mjs on its scheduled run. Only the pool,\n' +
      'the review files and the batch seeds are touched.', '--', ...changed);

    if (commit.code !== 0) {
      console.log(`\nCommit failed, pool left staged: ${commit.out}`);
      return;
    }
  }

  // Push whenever the branch is ahead, not only when this run committed.
  //
  // The old code returned early on a clean tree, which is exactly the state
  // after a commit whose push failed - so the retry this function was written
  // for could never happen. A night that imported 700 songs, committed, and
  // lost the network would stay unpublished until some later run happened to
  // produce new data, and after the last batch finished, forever.
  const ahead = await git('rev-list', '--count', '@{upstream}..HEAD');
  const pending = Number(ahead.out) || 0;

  if (ahead.code !== 0) {
    console.log(`\nCannot tell whether anything is unpushed (${ahead.out.split('\n').pop()}).`);
    return;
  }
  if (pending === 0) {
    console.log('\nNothing new to publish, and nothing waiting to be pushed.');
    return;
  }

  const push = await git('push', 'origin', 'HEAD');
  if (push.code === 0) {
    console.log(`\nPublished ${pending} commit(s). The app will serve ${count} songs within ten minutes.`);
  } else {
    console.log(`\n${pending} commit(s) still unpushed (${push.out.split('\n').pop()}).`);
    console.log('The next run will try again, whether or not it imports anything.');
  }
}
