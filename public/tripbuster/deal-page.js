/*
 * Tripbuster deal page — the behaviour, not the markup.
 *
 * The page arrives fully rendered from api/tripbuster/page.js, so this file
 * never builds the article, the price or the agent list. It does four things:
 *
 *   1. re-renders the booking panel, now that the clock and the device are known
 *   2. wires the call buttons and the callback form
 *   3. runs the click-out interstitial
 *   4. reports the impression
 *
 * WHY THE PANEL IS RE-RENDERED. The server's copy is cached at the edge for five
 * minutes and served to whoever asks next, so it cannot know whether this agency
 * is open at the moment YOU are reading, or whether you are on a phone that can
 * dial. Both answers live in that one block. Everything above it reads the same
 * at any hour, so it is left untouched — no flash, no reflow of the part you
 * came to read.
 *
 * If this file fails to load the page still works: the server's panel is correct
 * as of when it was rendered, the tel: links are real links, and the form posts
 * nowhere but also promises nothing.
 */
import * as TB from '/tripbuster/tb-site.js';

(function () {
  'use strict';

  var holder = document.getElementById('tb-deal');
  if (!holder) return;

  var deal;
  try {
    deal = JSON.parse(holder.textContent);
  } catch (e) {
    return; // server sent something we cannot read; leave its HTML alone
  }

  // ── 1. the clock-and-device half ──────────────────────────────────────────
  var book = document.getElementById('book');
  if (book) book.innerHTML = TB.bookingPanel(deal);

  // ── 2. calls and the callback form ────────────────────────────────────────
  var main = document.getElementById('main');
  TB.wireCalls(main, 'site');
  var cbf = main.querySelector('.cbf');
  if (cbf) TB.wireCallback(cbf, deal, 'site');

  // ── 3. leaving for the agent ──────────────────────────────────────────────
  var overlay = document.getElementById('overlay');
  var mAgent = document.getElementById('mAgent');
  var mProtect = document.getElementById('mProtect');
  var mGo = document.getElementById('mGo');
  var pending = null;
  var lastFocus = null;

  function openOut(entry) {
    var href = TB.safeUrl(entry.clickoutUrl);
    if (!href) return; // nothing to send them to; leave the page as it is
    pending = { id: entry.dealId || deal.id, href: href };
    lastFocus = document.activeElement;
    mAgent.textContent = entry.agent || 'the agent';
    mProtect.innerHTML = 'This holiday is sold and financially protected by <b>'
      + TB.esc(entry.agent || 'the agent') + '</b>'
      + (entry.atol ? ' under <b>ATOL ' + TB.esc(entry.atol) + '</b>' : '')
      + '. You pay them direct.';
    mGo.setAttribute('href', href);
    mGo.textContent = 'Continue to ' + (entry.agent || 'the agent');
    overlay.classList.add('on');
    mGo.focus();
  }

  function closeOut() {
    overlay.classList.remove('on');
    pending = null;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  document.getElementById('mCancel').addEventListener('click', closeOut);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) closeOut(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlay.classList.contains('on')) closeOut();
  });

  // Recorded here, at the moment the traveller commits to leaving — not when the
  // interstitial opened. Counting a click the agent never received would
  // over-bill them.
  mGo.addEventListener('click', function () {
    if (pending) TB.reportClick(pending.id, 'site');
    setTimeout(closeOut, 100);
  });

  // Delegated, so it keeps working after the panel above was re-rendered.
  main.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-idx]');
    if (!btn) return;
    var entry = TB.agentList(deal)[Number(btn.getAttribute('data-idx'))];
    if (entry) openOut(entry);
  });

  // ── 4. the deal was shown ─────────────────────────────────────────────────
  TB.reportImpressions([deal], 'site');
}());
