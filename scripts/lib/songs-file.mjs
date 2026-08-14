// Reading and writing the song files, in the one format they should ever be in.
//
// One song per line. These files are edited by hand as often as by script, and
// a plain JSON.stringify with indentation turns each song into twenty lines,
// which makes a one-field change look like a rewrite and buries real edits in
// thousands of lines of reformatting.
//
// Everything that writes a song file must use this, or the format flips back
// and forth and every diff is unreadable.

import { readFile, writeFile } from 'node:fs/promises';

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

export async function writeSongs(file, doc) {
  await writeFile(file, serialise(doc), 'utf8');
}

export async function readSongs(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw new Error(`Could not read ${file}: ${err.message}`);
  }
}
