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
    // Module specifiers: from './scoring.js' and from '../src/auth.js'.
    //
    // The ../ form was missing, so callback/index.html - which is listed as a
    // stamped file and whose bytes feed the hash - had nothing stamped in it at
    // all. --check passed because there was nothing to change. That left the
    // login page fetching src/auth.js unversioned, so for ten minutes after a
    // deploy it could run a cached old auth.js whose own imports resolve to the
    // new config.js and pkce.js: the mixed-version hazard this whole mechanism
    // exists to prevent, sitting on the auth path.
    .replace(/(from\s+['"]\.{1,2}\/(?:[\w.-]+\/)*[\w.-]+\.js)(['"])/g, `$1?v=${version}$2`)
    // index.html: href="css/style.css", src="src/app.js", and the callback
    // page's ../-relative equivalents.
    .replace(/((?:href|src)=["'](?:\.{1,2}\/)*(?:css|src|icons)\/[\w./-]+\.(?:css|js|png))(["'])/g,
      `$1?v=${version}$2`)
    // index.html: the manifest, and the icons the manifest itself names.
    .replace(/((?:href|src)=["'](?:\.{1,2}\/)*[\w.-]+\.webmanifest)(["'])/g, `$1?v=${version}$2`)
    .replace(/("src"\s*:\s*")(icons\/[\w.-]+\.png)(")/g, `$1$2?v=${version}$3`)
    // style.css: url('../fonts/barlow-condensed.woff2'). The backreference makes
    // the closing quote match whichever one opened it, and match nothing at all
    // when the url was written unquoted.
    .replace(/(url\((['"]?)\.\.\/fonts\/[\w.-]+\.woff2)(\2\))/g, `$1?v=${version}$3`);
}
