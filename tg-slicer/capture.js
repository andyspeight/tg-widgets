/* TG Slicer — capture engine (runs in the page's isolated content-script world)
 * Exposes globalThis.TGSCapture.capture(rootElement) -> { html, css, meta }
 *
 * Strategy for Stage 1:
 *  - Take a faithful COMPUTED-STYLE snapshot of the selected subtree. This always
 *    works regardless of cross-origin stylesheets, and reproduces the base look:
 *    layout, box model, typography, colour, background, border, shadow, transform,
 *    transition and animation.
 *  - Pull any @keyframes the subtree references, so animations survive.
 *  - Absolutise asset URLs (img src, background-image) so nothing 404s off-site.
 *  - Scope everything to generated .tgs-N classes so the output is collision-free.
 *
 * Deliberately deferred to a later stage (documented, not silently missing):
 *  - :hover / :focus state extraction and @media rewriting. These need stylesheet
 *    rule rewriting that is fragile and often CORS-blocked. The Stage 2 AI pass is
 *    a better place to re-introduce responsive + state behaviour.
 */
(function () {
  if (globalThis.TGSCapture) return; // idempotent

  // Longhand properties only — getComputedStyle does not expose shorthands reliably.
  const PROPS = [
    "display","position","top","right","bottom","left","z-index","float","clear","box-sizing",
    "width","height","min-width","max-width","min-height","max-height","aspect-ratio",
    "margin-top","margin-right","margin-bottom","margin-left",
    "padding-top","padding-right","padding-bottom","padding-left",
    "flex-direction","flex-wrap","flex-grow","flex-shrink","flex-basis",
    "justify-content","align-items","align-content","align-self","order","gap","row-gap","column-gap",
    "grid-template-columns","grid-template-rows","grid-auto-flow","grid-auto-rows","grid-auto-columns",
    "grid-column","grid-row","place-items","place-content",
    "color","font-family","font-size","font-weight","font-style","line-height","letter-spacing",
    "text-align","text-transform","text-decoration-line","text-decoration-color","text-shadow",
    "white-space","word-break","overflow-wrap","text-overflow","overflow-x","overflow-y",
    "background-color","background-image","background-size","background-position","background-repeat",
    "background-clip","-webkit-background-clip","-webkit-text-fill-color",
    "border-top-width","border-right-width","border-bottom-width","border-left-width",
    "border-top-style","border-right-style","border-bottom-style","border-left-style",
    "border-top-color","border-right-color","border-bottom-color","border-left-color",
    "border-top-left-radius","border-top-right-radius","border-bottom-right-radius","border-bottom-left-radius",
    "box-shadow","opacity","visibility","outline-width","outline-style","outline-color","outline-offset",
    "transform","transform-origin","transition","animation",
    "filter","backdrop-filter","-webkit-backdrop-filter","mix-blend-mode",
    "cursor","list-style-type","object-fit","object-position","fill","stroke","stroke-width"
  ];

  // Props we keep even if they look like a UA default, because dropping them loses meaning.
  const ALWAYS_KEEP = new Set([
    "color","font-size","font-weight","font-family","line-height",
    "background-color","background-image","border-top-left-radius","box-shadow","display",
    "text-decoration-line"
  ]);

  const STRIP_TAGS = new Set(["SCRIPT","NOSCRIPT","IFRAME","OBJECT","EMBED","LINK","META","STYLE"]);

  // --- per-tag UA defaults, read from a sandbox document so we can diff them out ---
  let sandboxDoc = null;
  const defaultsCache = new Map();
  function ensureSandbox() {
    if (sandboxDoc) return sandboxDoc;
    const f = document.createElement("iframe");
    f.style.cssText = "position:absolute;width:0;height:0;border:0;opacity:0;left:-9999px;top:-9999px;";
    document.documentElement.appendChild(f);
    sandboxDoc = f.contentDocument;
    sandboxDoc.documentElement.innerHTML = "<head></head><body></body>";
    globalThis.__tgsSandboxFrame = f; // kept for cleanup by caller if desired
    return sandboxDoc;
  }
  function defaultsFor(tag) {
    if (defaultsCache.has(tag)) return defaultsCache.get(tag);
    const doc = ensureSandbox();
    let el;
    try { el = doc.createElement(tag); } catch { el = doc.createElement("div"); }
    doc.body.appendChild(el);
    const cs = doc.defaultView.getComputedStyle(el);
    const map = {};
    for (const p of PROPS) map[p] = cs.getPropertyValue(p);
    doc.body.removeChild(el);
    defaultsCache.set(tag, map);
    return map;
  }

  function absolutise(url) {
    try { return new URL(url, location.href).href; } catch { return url; }
  }
  function fixBgImage(value) {
    // Rewrite url(...) entries to absolute, leave gradients etc. untouched.
    return value.replace(/url\((['"]?)([^'")]+)\1\)/g, (_m, q, u) => {
      if (/^data:/i.test(u)) return `url(${q}${u}${q})`;
      return `url(${q}${absolutise(u)}${q})`;
    });
  }

  function meaningfulStyles(el) {
    const cs = getComputedStyle(el);
    const def = defaultsFor(el.tagName.toLowerCase());

    // Frameworks (Tailwind etc.) set "border-style: solid; border-width: 0" on every
    // element so a width alone makes a border. We keep style (it isn't a UA default)
    // but drop width:0 as a default, which would leave style:solid with no width and
    // render a phantom 3px border. So for any side that isn't truly visible, skip the
    // whole border for that side.
    const skip = new Set();
    ["top", "right", "bottom", "left"].forEach((s) => {
      const w = parseFloat(cs.getPropertyValue("border-" + s + "-width")) || 0;
      const st = cs.getPropertyValue("border-" + s + "-style");
      if (w === 0 || st === "none") {
        skip.add("border-" + s + "-width");
        skip.add("border-" + s + "-style");
        skip.add("border-" + s + "-color");
      }
    });

    const out = [];
    for (const p of PROPS) {
      if (skip.has(p)) continue;
      let v = cs.getPropertyValue(p);
      if (!v) continue;
      if (v === "none" && !ALWAYS_KEEP.has(p)) continue;
      if (v === def[p] && !ALWAYS_KEEP.has(p)) continue;
      if (v === "normal" || v === "auto" || v === "0px" && !ALWAYS_KEEP.has(p)) {
        if (v === def[p]) continue;
      }
      if (p === "background-image" || p === "background" ) v = fixBgImage(v);
      out.push([p, v]);
    }
    return out;
  }

  function collectKeyframes(animationNames) {
    if (!animationNames.size) return "";
    const wanted = new Set([...animationNames].filter((n) => n && n !== "none"));
    if (!wanted.size) return "";
    const found = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; } // CORS-protected sheet
      if (!rules) continue;
      for (const rule of Array.from(rules)) {
        if (rule.type === CSSRule.KEYFRAMES_RULE && wanted.has(rule.name)) {
          found.push(rule.cssText);
        }
      }
    }
    return found.join("\n");
  }

  // Icons are often <use xlink:href="sprite.svg#id"> pointing at a separate file.
  // That reference can't resolve once the capture leaves the site, so the icon comes
  // through empty. Here we fetch the sprite (same-origin at capture time), find the
  // referenced symbol, and inline its artwork so the icon travels with the widget.
  async function inlineUseRefs(root, fetchFn, baseHref) {
    const uses = Array.from(root.querySelectorAll("use"));
    if (!uses.length) return;
    const cache = new Map();
    for (const use of uses) {
      try {
        const href = use.getAttribute("xlink:href") || use.getAttribute("href") || "";
        const hash = href.indexOf("#");
        if (hash === -1) continue;
        const file = href.slice(0, hash);
        const id = href.slice(hash + 1);
        if (!id || !file) continue; // pure in-page refs can't be reached from the clone
        const url = new URL(file, baseHref).href;
        if (!cache.has(url)) {
          let text = null;
          try { const res = await fetchFn(url); if (res && res.ok) text = await res.text(); } catch (_) {}
          cache.set(url, text);
        }
        const text = cache.get(url);
        if (!text) continue;
        const spriteDoc = new DOMParser().parseFromString(text, "image/svg+xml");
        const sym = spriteDoc.querySelector('[id="' + id.replace(/"/g, '\\"') + '"]');
        if (!sym) continue;
        const svg = use.closest("svg");
        if (svg && !svg.getAttribute("viewBox")) {
          const vb = sym.getAttribute("viewBox");
          if (vb) svg.setAttribute("viewBox", vb);
        }
        const frag = use.ownerDocument.createDocumentFragment();
        Array.from(sym.childNodes).forEach((ch) => frag.appendChild(use.ownerDocument.importNode(ch, true)));
        use.parentNode.replaceChild(frag, use);
      } catch (_) { /* leave this use as-is on any failure */ }
    }
  }

  function isTransparentColor(v) {
    if (!v) return true;
    const s = v.replace(/\s+/g, "");
    return s === "transparent" || s === "rgba(0,0,0,0)";
  }
  // When a sliced section is itself transparent, its visible colour usually comes
  // from a parent or the page. Walk up and adopt the nearest real background so the
  // widget keeps the colour it had on the original site.
  function effectiveBg(start) {
    let node = start;
    while (node && node.nodeType === 1) {
      const cs = getComputedStyle(node);
      const hasColor = !isTransparentColor(cs.backgroundColor);
      const hasImg = cs.backgroundImage && cs.backgroundImage !== "none";
      if (hasColor || hasImg) return { color: hasColor ? cs.backgroundColor : null, image: hasImg ? cs.backgroundImage : null };
      node = node.parentElement;
    }
    return null;
  }

  function isCssColor(v) {
    if (!v) return false;
    v = String(v).trim();
    return /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) ||
      /^rgba?\(\s*[\d.\s,%/]+\)$/i.test(v) ||
      /^hsla?\(\s*[\d.\s,%/]+\)$/i.test(v);
  }

  // Grab a still frame from a <canvas>. Works for 2D canvases. A WebGL canvas
  // (e.g. Stripe's gradient) usually reads back blank because its drawing buffer
  // is cleared after compositing, so we detect a near-uniform frame and report it
  // as blank. toDataURL throws on a cross-origin tainted canvas, hence the catch.
  function snapshotCanvas(cv) {
    try {
      const cw = cv.width || cv.clientWidth || 0;
      const ch = cv.height || cv.clientHeight || 0;
      if (!cw || !ch) return null;
      const scale = Math.min(1, 1600 / cw);
      const tmp = document.createElement("canvas");
      tmp.width = Math.max(1, Math.round(cw * scale));
      tmp.height = Math.max(1, Math.round(ch * scale));
      const ctx = tmp.getContext("2d");
      ctx.drawImage(cv, 0, 0, tmp.width, tmp.height);
      const dataUrl = tmp.toDataURL("image/jpeg", 0.85);
      const sw = Math.min(tmp.width, 48), sh = Math.min(tmp.height, 48);
      const data = ctx.getImageData(0, 0, sw, sh).data;
      let min = 255, max = 0;
      for (let i = 0; i < data.length; i += 4) {
        const lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) * (data[i + 3] / 255);
        if (lum < min) min = lum;
        if (lum > max) max = lum;
      }
      return { dataUrl, blank: (max - min) < 6 };
    } catch (_) { return null; }
  }

  async function capture(root) {
    if (!root || root.nodeType !== 1) throw new Error("Nothing selected.");

    // Walk the live subtree (for computed styles) and a clone (for output) in lockstep.
    const clone = root.cloneNode(true);

    function elements(node) {
      const list = [];
      const walk = (n) => {
        if (n.nodeType === 1) list.push(n);
        for (const c of n.childNodes) walk(c);
      };
      walk(node);
      return list;
    }
    const origEls = elements(root);
    const cloneEls = elements(clone);

    const cssRules = [];
    const animationNames = new Set();
    let n = 0;
    const canvasInfo = { present: false, frameOk: false, colors: [] };

    for (let i = 0; i < origEls.length && i < cloneEls.length; i++) {
      const o = origEls[i];
      const c = cloneEls[i];

      if (STRIP_TAGS.has(c.tagName)) {
        c.remove();
        continue;
      }

      const cls = "tgs-" + n++;
      // Clean the clone: drop leaky/host attributes, keep semantics + a/img essentials.
      for (const attr of Array.from(c.attributes)) {
        const name = attr.name.toLowerCase();
        const keep =
          name === "src" || name === "href" || name === "alt" || name === "type" ||
          name === "placeholder" || name === "value" ||
          name === "role" || name === "aria-label" || name.startsWith("data-tg") ||
          (c.namespaceURI && c.namespaceURI.includes("svg")); // keep svg geometry attrs
        if (!keep) c.removeAttribute(attr.name);
      }
      if (c.hasAttribute("src")) c.setAttribute("src", absolutise(c.getAttribute("src")));
      if (c.hasAttribute("href") && c.tagName === "A") c.setAttribute("href", absolutise(c.getAttribute("href")));
      c.setAttribute("class", cls);

      const styles = meaningfulStyles(o);
      if (i === 0) {
        const hasColor = styles.some(([p, v]) => p === "background-color" && !isTransparentColor(v));
        const hasImg = styles.some(([p, v]) => p === "background-image" && v !== "none");
        if (!hasColor && !hasImg) {
          const bg = effectiveBg(o.parentElement);
          if (bg) {
            if (bg.color) styles.push(["background-color", bg.color]);
            if (bg.image) styles.push(["background-image", bg.image]);
          }
        }
      }
      if (o.tagName === "CANVAS") {
        canvasInfo.present = true;
        const ocs = getComputedStyle(o);
        ["--gradient-color-1", "--gradient-color-2", "--gradient-color-3", "--gradient-color-4",
         "--gradientcolorzero", "--gradientcolorone", "--gradientcolortwo", "--gradientcolorthree"]
          .forEach((p) => {
            const val = ocs.getPropertyValue(p).trim();
            if (isCssColor(val) && canvasInfo.colors.indexOf(val) === -1) canvasInfo.colors.push(val);
          });
        const snap = snapshotCanvas(o);
        if (snap && !snap.blank) {
          canvasInfo.frameOk = true;
          styles.push(["background-image", `url("${snap.dataUrl}")`]);
          styles.push(["background-size", "cover"]);
          styles.push(["background-position", "center"]);
        }
      }
      const anim = getComputedStyle(o).getPropertyValue("animation-name");
      anim.split(",").forEach((a) => animationNames.add(a.trim()));

      if (styles.length) {
        const body = styles.map(([p, v]) => `  ${p}: ${v};`).join("\n");
        cssRules.push(`.${cls} {\n${body}\n}`);
      }
    }

    const keyframes = collectKeyframes(animationNames);

    // Pull external SVG sprite icons into the markup so they survive off-site.
    try { await inlineUseRefs(clone, (u) => fetch(u, { credentials: "omit" }), location.href); } catch (_) {}

    const css = [cssRules.join("\n\n"), keyframes].filter(Boolean).join("\n\n");
    const html = clone.outerHTML;

    const meta = {
      source: location.href,
      title: document.title,
      tag: root.tagName.toLowerCase(),
      elementCount: n,
      capturedAt: new Date().toISOString(),
      hasCanvas: canvasInfo.present,
      canvasFrameCaptured: canvasInfo.frameOk,
      gradientColors: canvasInfo.colors,
      notes: [
        "Computed-style snapshot. Hover/focus states and @media rules are not extracted in Stage 1.",
        "Keyframes captured only from same-origin / CORS-readable stylesheets."
      ]
    };

    // Tidy up the sandbox frame.
    try {
      if (globalThis.__tgsSandboxFrame) {
        globalThis.__tgsSandboxFrame.remove();
        globalThis.__tgsSandboxFrame = null;
        sandboxDoc = null;
        defaultsCache.clear();
      }
    } catch (_) {}

    return { html, css, meta };
  }

  globalThis.TGSCapture = { capture };
})();
