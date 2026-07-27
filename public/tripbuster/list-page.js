/*
 * Tripbuster destination pages — report what was shown.
 *
 * The page itself is fully rendered by the server and needs no JavaScript to be
 * read or navigated. This exists only so an agent's dashboard can tell the
 * difference between a deal nobody saw and a deal everybody saw and ignored.
 *
 * Crawlers are dropped by /api/tripbuster/impressions on the user agent before
 * anything is counted, so an indexable page does not inflate anyone's numbers.
 */
import * as TB from '/tripbuster/tb-site.js';

(function () {
  'use strict';
  var holder = document.getElementById('tb-shown');
  if (!holder) return;
  try {
    var ids = JSON.parse(holder.textContent);
    if (Array.isArray(ids) && ids.length) {
      TB.reportImpressions(ids.map(function (id) { return { id: id }; }), 'site');
    }
  } catch (e) { /* tracking must never break the page */ }
}());
