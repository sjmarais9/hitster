// Reading and writing the song files, in the one format they should ever be in.
//
// One song per line. These files are edited by hand as often as by script, and
// a plain JSON.stringify with indentation turns each song into twenty lines,
// which makes a one-field change look like a rewrite and buries real edits in
// thousands of lines of reformatting.
//
// Everything that writes a song file must use this, or the format flips back
// and forth and every diff is unreadable.

import { readFile, writeFile, rename, rm } from 'node:fs/promises';

/** One song per line, with the spacing these files are written by hand in. */
export function serialise(doc) {
  const { songs, ...rest } = doc;

  // Everything but the songs, with its own braces trimmed so it can be spliced
  // into ours. When there is nothing but songs, JSON.stringify returns "{}",
  // which neither trim matches - and splicing that in produced "{\n{},\n" and a
  // file that would not parse. A document with no meta is unusual but it is not
  // an error, and it should not silently write corrupt JSON.
  const head = Object.keys(rest).length
    ? `${JSON.stringify(rest, null, 2).replace(/^\{\n/, '').replace(/\n\}$/, '')},\n`
    : '';

  // Built field by field rather than by string-replacing a compact dump: a
  // title containing a comma or a colon would corrupt the latter.
  const lines = (songs ?? []).map((song) => {
    const fields = Object.entries(song)
      .map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`)
      .join(', ');
    return `    { ${fields} }`;
  }).join(',\n');

  return `{\n${head}  "songs": [\n${lines}\n  ]\n}\n`;
}

/**
 * Writes the file, or leaves the old one exactly as it was.
 *
 * Not a plain overwrite, because the import checkpoints every 25 songs and runs
 * unattended on a schedule. That is hundreds of writes a night with nobody
 * watching, and a plain write is a window in which the pool is half a file: a
 * killed process, a power cut, or the task scheduler losing patience would
 * leave truncated JSON that the app cannot parse and the next run cannot read.
 *
 * Writing beside it and renaming closes the window. A rename over an existing
 * file is atomic on the same volume - libuv maps it to MoveFileEx with
 * REPLACE_EXISTING on Windows - so a reader sees either the whole old file or
 * the whole new one, never a splice of the two.
 *
 * The temp file is deliberately a sibling. Renaming across volumes is a copy,
 * which is exactly the non-atomic write this exists to avoid.
 */
export async function writeSongs(file, doc) {
  const temp = `${file}.tmp-${process.pid}`;
  try {
    await writeFile(temp, serialise(doc), 'utf8');
    await rename(temp, file);
  } catch (err) {
    await rm(temp, { force: true }).catch(() => {});
    throw err;
  }
}

export async function readSongs(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw new Error(`Could not read ${file}: ${err.message}`);
  }
}
