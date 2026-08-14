// The URL rewriting behind scripts/stamp.mjs, separated so it can be tested.
//
// This logic has been wrong twice and both times it failed silently: the file
// was written, the run reported success, and no URL had been stamped. Once
// because a regex backreference was mangled into a control character, once
// because the pattern never matched the quoting actually used. A pattern that
// matches nothing looks exactly like a pattern with nothing to do.

/** Any stamp already present, so hashing sees the source rather than the last run. */
export const STAMP = /\?v=[0-9a-f]{8}/g;

export const bare = (text) => text.replace(STAMP, '');

/**
 * Adds or replaces the stamp on every relative asset URL, leaving absolute ones
 * alone. Idempotent: stamping stamped text with the same version is a no-op,
 * and with a new version replaces rather than appends.
 */
export function stamp(text, version) {
  return bare(text)
    // Module specifiers: from './scoring.js'
    .replace(/(from\s+['"]\.\/[\w.-]+\.js)(['"])/g, `$1?v=${version}$2`)
    // index.html: href="css/style.css", src="src/app.js"
    .replace(/((?:href|src)=["'](?:\.\/)?(?:css|src|icons)\/[\w./-]+\.(?:css|js|png))(["'])/g,
      `$1?v=${version}$2`)
    // style.css: url('../fonts/barlow-condensed.woff2'). The backreference makes
    // the closing quote match whichever one opened it, and match nothing at all
    // when the url was written unquoted.
    .replace(/(url\((['"]?)\.\.\/fonts\/[\w.-]+\.woff2)(\2\))/g, `$1?v=${version}$3`);
}
