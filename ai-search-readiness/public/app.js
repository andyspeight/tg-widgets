/* ------------------------------------------------------------------
   AI Visibility Score — front end.

   Talks to /api/check. Everything that comes back is written with
   textContent, never innerHTML, so nothing read off the network can
   become markup.

   If the API cannot be reached we show a deterministic preview so the
   page is not a dead end, and we say plainly that it is a preview. It
   is never presented as a result for the visitor's site.
   ------------------------------------------------------------------ */

(function () {
  'use strict';

  var REQUEST_TIMEOUT_MS = 28000;
  var MIN_SCAN_MS = 2400;

  var $ = function (id) { return document.getElementById(id); };

  var form = $('scan-form');
  var input = $('url-input');
  var button = $('scan-btn');
  var errorEl = $('url-error');
  var results = $('results');
  var consoleState = $('console-state');
  var consoleList = $('console-list');

  var scanning = false;
  var tickTimers = [];

  /* ── Theme ─────────────────────────────────────────────────────── */

  var root = document.documentElement;
  try {
    var stored = localStorage.getItem('tg-avs-theme');
    if (stored === 'light' || stored === 'dark') root.setAttribute('data-theme', stored);
  } catch (e) { /* private mode, no preference to restore */ }

  $('theme-toggle').addEventListener('click', function () {
    var current = root.getAttribute('data-theme');
    if (!current) {
      current = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    var next = current === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('tg-avs-theme', next); } catch (e) { /* nothing to do */ }
  });

  /* ── Dial ticks ────────────────────────────────────────────────── */

  (function drawTicks() {
    var g = $('dial-ticks');
    if (!g) return;
    for (var i = 0; i <= 10; i += 1) {
      var angle = Math.PI + (i / 10) * Math.PI;
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(100 + 72 * Math.cos(angle)));
      line.setAttribute('y1', String(106 + 72 * Math.sin(angle)));
      line.setAttribute('x2', String(100 + 66 * Math.cos(angle)));
      line.setAttribute('y2', String(106 + 66 * Math.sin(angle)));
      g.appendChild(line);
    }
  })();

  /* ── Console choreography ──────────────────────────────────────── */

  var PROBE_ORDER = ['control', 'robots', 'oai-search', 'chatgpt-user', 'perplexity', 'claudebot', 'google-extended', 'googlebot'];

  function row(id) { return consoleList.querySelector('[data-probe="' + id + '"]'); }

  function setRow(id, state, label) {
    var el = row(id);
    if (!el) return;
    el.setAttribute('data-state', state);
    var stateEl = el.querySelector('.probe-state');
    if (stateEl) stateEl.textContent = label;
  }

  function resetConsole() {
    tickTimers.forEach(clearTimeout);
    tickTimers = [];
    PROBE_ORDER.forEach(function (id) {
      var el = row(id);
      if (!el) return;
      el.removeAttribute('data-state');
      var stateEl = el.querySelector('.probe-state');
      if (stateEl) stateEl.textContent = 'waiting';
    });
    consoleState.textContent = 'Idle';
  }

  function startConsole() {
    resetConsole();
    consoleState.textContent = 'Running';
    PROBE_ORDER.forEach(function (id, i) {
      tickTimers.push(setTimeout(function () { setRow(id, 'running', 'checking'); }, 140 + i * 190));
    });
  }

  var STATE_LABEL = { pass: 'through', warn: 'patchy', blocked: 'blocked', inconclusive: 'unclear' };

  function finishConsole(report) {
    tickTimers.forEach(clearTimeout);
    tickTimers = [];

    var control = report.scanned && report.scanned.control;
    if (control && control.reached && control.status >= 200 && control.status < 400 && !control.challenge) {
      setRow('control', 'pass', 'through');
    } else {
      setRow('control', 'blocked', control && control.reached ? 'refused' : 'no answer');
    }

    var robots = report.scanned && report.scanned.robots;
    if (!robots) setRow('robots', 'inconclusive', 'unclear');
    else if (robots.unknown) setRow('robots', 'warn', 'unreadable');
    else if (robots.found) setRow('robots', 'pass', 'read');
    else setRow('robots', 'warn', 'none found');

    (report.crawlers || []).forEach(function (c) {
      setRow(c.id, c.state, STATE_LABEL[c.state] || c.state);
    });

    consoleState.textContent = 'Complete';
  }

  /* ── Rendering helpers ─────────────────────────────────────────── */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  /* ── Render the report ─────────────────────────────────────────── */

  function render(report, isPreview) {
    $('preview-banner').hidden = !isPreview;

    /* Score dial */
    var scoreEl = $('score-value');
    var fill = $('dial-fill');
    var ARC = 270;

    if (typeof report.overall === 'number') {
      scoreEl.textContent = String(report.overall);
      scoreEl.classList.remove('is-inconclusive');
      fill.style.strokeDashoffset = String(ARC * (1 - report.overall / 100));
      fill.style.stroke = bandColour(report.band);
    } else {
      scoreEl.textContent = 'No score';
      scoreEl.classList.add('is-inconclusive');
      fill.style.strokeDashoffset = String(ARC);
    }

    var bandEl = $('band-value');
    bandEl.textContent = isPreview ? 'Example only' : report.band;
    bandEl.setAttribute('data-band', report.band || '');

    $('summary-value').textContent = report.summary || '';
    $('scanned-value').textContent = isPreview
      ? 'Example report. These figures do not describe your website.'
      : 'Checked ' + (report.scanned && report.scanned.final ? report.scanned.final : report.url || '');

    /* Pillars */
    var pillars = $('pillars');
    clear(pillars);
    (report.pillars || []).forEach(function (p, i) {
      var li = el('li', 'reveal');
      li.style.setProperty('--i', String(i));

      var nameWrap = el('div');
      nameWrap.appendChild(el('div', 'pillar-name', p.label));
      nameWrap.appendChild(el('div', 'pillar-blurb', p.blurb || ''));
      li.appendChild(nameWrap);

      var meter = el('div', 'meter');
      var mfill = el('span', 'meter-fill');
      if (!p.inconclusive && typeof p.score === 'number') {
        mfill.setAttribute('data-band', p.band || '');
        requestAnimationFrame(function () { mfill.style.width = p.score + '%'; });
      }
      meter.appendChild(mfill);
      li.appendChild(meter);

      var score = el('div', 'pillar-score');
      if (p.inconclusive || typeof p.score !== 'number') {
        score.classList.add('is-inconclusive');
        score.textContent = 'Not judged';
      } else {
        score.textContent = String(p.score);
      }
      li.appendChild(score);

      pillars.appendChild(li);
    });

    /* Crawlers */
    var crawlers = $('crawlers');
    clear(crawlers);
    (report.crawlers || []).forEach(function (c) {
      var li = el('li');

      var dot = el('span', 'crawler-dot');
      dot.setAttribute('data-state', c.state);
      li.appendChild(dot);

      li.appendChild(el('div', 'crawler-name', c.label));
      li.appendChild(el('div', 'crawler-token', c.token));

      var detail = el('div', 'crawler-detail');
      var pill = el('span', 'crawler-state', STATE_WORD[c.state] || c.state);
      pill.setAttribute('data-state', c.state);
      detail.appendChild(pill);
      detail.appendChild(document.createTextNode(
        c.detail + (c.robotsOnly ? ' Google-Extended is a robots.txt control rather than a separate crawler, so the live result here is Googlebot.' : '')
      ));
      li.appendChild(detail);

      crawlers.appendChild(li);
    });

    $('caveat').textContent = report.caveat || '';

    /* Findings */
    var findings = $('findings');
    clear(findings);
    (report.findings || []).forEach(function (f, i) {
      var li = el('li', 'reveal');
      li.style.setProperty('--i', String(i));

      var meta = el('div', 'finding-meta');
      var sev = el('span', 'sev', SEV_WORD[f.severity] || f.severity);
      sev.setAttribute('data-sev', f.severity);
      meta.appendChild(sev);
      meta.appendChild(el('span', 'finding-pillar', f.pillar));
      li.appendChild(meta);

      var body = el('div');
      body.appendChild(el('div', 'finding-title', f.title));
      body.appendChild(el('div', 'finding-detail', f.detail));
      var fix = el('div', 'finding-fix');
      fix.appendChild(el('strong', null, f.severity === 'good' ? 'Keep it up. ' : 'The fix. '));
      fix.appendChild(document.createTextNode(f.fix));
      body.appendChild(fix);
      li.appendChild(body);

      findings.appendChild(li);
    });

    /* Locked teaser. Never carries a result. */
    if (report.presence) {
      $('teaser-title').textContent = report.presence.title;
      $('teaser-blurb').textContent = report.presence.blurb;
    }

    results.hidden = false;
    results.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }

  var STATE_WORD = { pass: 'Through', warn: 'Patchy', blocked: 'Blocked', inconclusive: 'Unclear' };
  var SEV_WORD = {
    critical: 'Urgent', high: 'Important', medium: 'Worth doing',
    low: 'Minor', inconclusive: 'Unclear', good: 'All good',
  };

  function bandColour(band) {
    if (band === 'Strong') return 'var(--ok)';
    if (band === 'Needs work') return 'var(--warn)';
    if (band === 'At risk' || band === 'Invisible') return 'var(--bad)';
    return 'var(--teal)';
  }

  function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* ── Errors ────────────────────────────────────────────────────── */

  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  }

  function clearError() {
    errorEl.hidden = true;
    errorEl.textContent = '';
    input.removeAttribute('aria-invalid');
  }

  /* ── The scan ──────────────────────────────────────────────────── */

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (scanning) return;

    var value = input.value.trim();
    if (!value) {
      showError('Put your website address in first.');
      return;
    }
    if (/\s/.test(value) || value.indexOf('.') === -1) {
      showError('That does not look like a web address. Try something like yoursite.co.uk.');
      return;
    }

    clearError();
    run(value);
  });

  input.addEventListener('input', function () {
    if (!errorEl.hidden) clearError();
  });

  function run(value) {
    scanning = true;
    button.disabled = true;
    button.classList.add('is-busy');
    button.querySelector('.btn-label').textContent = 'Checking';
    results.hidden = true;
    startConsole();

    var started = Date.now();
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);

    fetch('/api/check?url=' + encodeURIComponent(value), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then(function (res) {
        return res.json().then(function (body) { return { status: res.status, body: body }; });
      })
      .then(function (result) {
        clearTimeout(timer);
        return hold(started).then(function () {
          if (result.status === 429) {
            settle();
            showError(result.body && result.body.error ? result.body.error : 'That is a lot of checks in a short time. Give it a minute.');
            resetConsole();
            return;
          }
          if (result.status >= 400 || !result.body || result.body.ok !== true) {
            settle();
            showError(result.body && result.body.error ? result.body.error : 'We could not check that address. Have another look at it.');
            resetConsole();
            return;
          }
          finishConsole(result.body);
          render(result.body, false);
          settle();
        });
      })
      .catch(function () {
        clearTimeout(timer);
        // The service is unreachable. Show the preview rather than a dead end,
        // and say clearly that it is a preview.
        return hold(started).then(function () {
          finishConsole(PREVIEW);
          render(PREVIEW, true);
          settle();
        });
      });
  }

  function hold(started) {
    var waited = Date.now() - started;
    var remaining = Math.max(0, MIN_SCAN_MS - waited);
    return new Promise(function (resolve) { setTimeout(resolve, remaining); });
  }

  function settle() {
    scanning = false;
    button.disabled = false;
    button.classList.remove('is-busy');
    button.querySelector('.btn-label').textContent = 'Check my site';
  }

  /* ── Deterministic preview ─────────────────────────────────────────
     Shown only when the API cannot be reached, and always behind the
     preview banner. Fixed figures, so it never looks like a live result.
     ---------------------------------------------------------------- */

  var PREVIEW = {
    ok: true,
    url: 'https://example-travel-agency.co.uk/',
    overall: 58,
    band: 'Needs work',
    summary: 'This is what a report looks like. The figures below are fixed example values, not a check of your site.',
    caveat: 'A clean result is a good sign, not a guarantee. Bot protection can fingerprint a visitor well beyond its user agent, so a crawler can still be turned away for reasons this check cannot see from the outside.',
    scanned: {
      final: 'https://example-travel-agency.co.uk/',
      robots: { found: true, unknown: false, sitemaps: [] },
      control: { reached: true, status: 200, challenge: false },
    },
    pillars: [
      { id: 'access', label: 'AI crawler access', blurb: 'Whether the AI engines can reach your pages at all.', score: 67, inconclusive: false, band: 'Needs work' },
      { id: 'schema', label: 'Structured data', blurb: 'What your pages tell a machine about themselves.', score: 45, inconclusive: false, band: 'At risk' },
      { id: 'content', label: 'Answer-ready content', blurb: 'Whether your writing can be lifted into an answer.', score: 74, inconclusive: false, band: 'Good' },
      { id: 'authority', label: 'Authority signals', blurb: 'The trust markers an engine looks for before it cites you.', score: 46, inconclusive: false, band: 'At risk' },
    ],
    crawlers: [
      { id: 'oai-search', label: 'ChatGPT Search', token: 'OAI-SearchBot', state: 'blocked', detail: 'Example only. In a real report this line says exactly what the site did.' },
      { id: 'chatgpt-user', label: 'ChatGPT live fetch', token: 'ChatGPT-User', state: 'pass', detail: 'Example only.' },
      { id: 'perplexity', label: 'Perplexity', token: 'PerplexityBot', state: 'pass', detail: 'Example only.' },
      { id: 'claudebot', label: 'Claude', token: 'ClaudeBot', state: 'warn', detail: 'Example only.' },
      { id: 'google-extended', label: 'Gemini and AI Overviews', token: 'Google-Extended', state: 'pass', detail: 'Example only.', robotsOnly: true },
      { id: 'googlebot', label: 'Google index', token: 'Googlebot', state: 'pass', detail: 'Example only.' },
    ],
    findings: [
      {
        id: 'preview-1',
        pillar: 'AI crawler access',
        severity: 'critical',
        title: 'One AI crawler cannot reach the site',
        detail: 'In a real report this is where a network level block shows up, with the crawler named and the evidence set out.',
        fix: 'Example fix text. A real report gives you the setting to change and where to find it.',
      },
      {
        id: 'preview-2',
        pillar: 'Structured data',
        severity: 'high',
        title: 'Nothing on the page says who you are',
        detail: 'Example finding. Structured data is how a page states plainly what it is and who runs it.',
        fix: 'Example fix text. A real report tells you which markup block to add and what to put in it.',
      },
    ],
    presence: {
      locked: true,
      result: null,
      title: 'Live AI presence and share of model',
      blurb: 'This is the part that tells you whether the engines actually name you when a customer asks. We do not show a number here, because guessing one would be worthless. It comes from putting real customer questions to the engines every month and counting who gets mentioned.',
    },
  };
})();
