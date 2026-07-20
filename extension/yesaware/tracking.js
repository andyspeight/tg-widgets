/**
 * YesAware — pure tracking transforms (no DOM, no chrome APIs).
 *
 * Shared by the Gmail content script (gmail.js) and the send-time hook
 * (send-hook.js), and unit-tested in tests/test-yesaware-ext.cjs. Keeping the
 * string work here — link extraction, href rewriting, pixel insertion — means
 * the fragile Gmail glue stays thin and the logic that matters is testable.
 */
(function (root) {
  'use strict';

  // Pull unique http(s) hrefs out of an HTML string, in document order.
  function extractLinks(html) {
    var out = [], seen = {};
    var re = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+))/gi;
    var m;
    while ((m = re.exec(String(html || '')))) {
      var url = (m[1] || m[2] || m[3] || '').trim();
      if (/^https?:\/\//i.test(url) && !seen[url]) { seen[url] = 1; out.push(url); }
    }
    return out;
  }

  function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Replace every href whose value is exactly `orig` with `tracked`, keeping the
  // original quote style. Anchored so a longer URL that starts with `orig` is
  // never partially rewritten.
  function replaceHref(html, orig, tracked) {
    if (!orig || !tracked) return String(html || '');
    var e = escapeRe(orig);
    var re = new RegExp('(\\bhref\\s*=\\s*)("' + e + '"|\'' + e + '\'|' + e + '(?=[\\s">]))', 'gi');
    return String(html).replace(re, function (_, pre, val) {
      var q = val.charAt(0) === '"' ? '"' : (val.charAt(0) === "'" ? "'" : '');
      return pre + q + tracked + q;
    });
  }

  // Given compose HTML, a { originalUrl: trackedUrl } map and a pixel <img>
  // string, return the tracked HTML: links rewritten, pixel appended once.
  function applyTracking(html, urlMap, pixelHtml) {
    var out = String(html || '');
    if (urlMap) Object.keys(urlMap).forEach(function (orig) { out = replaceHref(out, orig, urlMap[orig]); });
    if (pixelHtml && out.indexOf(pixelHtml) === -1) out += pixelHtml;
    return out;
  }

  // Build the { original: tracked } map from the register endpoint's links array.
  function urlMapFromLinks(links) {
    var map = {};
    (links || []).forEach(function (l) { if (l && l.url && l.trackedUrl) map[l.url] = l.trackedUrl; });
    return map;
  }

  var api = {
    extractLinks: extractLinks,
    replaceHref: replaceHref,
    applyTracking: applyTracking,
    urlMapFromLinks: urlMapFromLinks
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.YesAwareTracking = api;
})(typeof self !== 'undefined' ? self : this);
