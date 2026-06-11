/* TG Slicer — local emitter (runs in the content-script world, has DOM access)
 * Exposes globalThis.TGSEmit.buildSheet(slice) -> Duda build sheet object.
 *
 * Why this exists: the faithful reproduction already lives in the captured
 * slice (real HTML, real computed-style CSS, real images). So we do NOT send it
 * to a model to regenerate. We parse the captured markup here, in code, expose
 * each text block and image as an editable Duda input with the original content
 * as its default, and emit the same build-sheet shape the review page renders.
 * No network, no model: it cannot time out, truncate, or drift from the source.
 */
(function () {
  if (globalThis.TGSEmit) return; // idempotent

  function collapse(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }
  function snippet(s, n) { s = collapse(s); return s.length > n ? s.slice(0, n - 1) + "\u2026" : s; }
  function hostnameOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (_) { return "site"; } }
  function firstClass(el) { var c = el && el.getAttribute ? (el.getAttribute("class") || "") : ""; return c.split(/\s+/)[0] || ""; }

  function roleFor(el) {
    if (!el || !el.tagName) return "Text";
    var t = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(t)) return "Heading";
    if (t === "p") return "Text";
    if (t === "a") return "Link text";
    if (t === "button") return "Button label";
    if (t === "li") return "List item";
    if (t === "blockquote") return "Quote";
    return "Text";
  }

  function inSvg(node) {
    var n = node;
    while (n) {
      if (n.nodeType === 1 && n.tagName && n.tagName.toLowerCase() === "svg") return true;
      n = n.parentNode;
    }
    return false;
  }

  function isCssColor(v) {
    if (!v) return false;
    v = String(v).trim();
    return /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) ||
      /^rgba?\(\s*[\d.\s,%/]+\)$/i.test(v) ||
      /^hsla?\(\s*[\d.\s,%/]+\)$/i.test(v);
  }

  function buildSheet(slice) {
    var html = (slice && slice.html) || "";
    var css = (slice && slice.css) || "";
    var meta = (slice && slice.meta) || {};

    var doc = new DOMParser().parseFromString(html, "text/html");
    var root = doc.body.firstElementChild;
    if (!root) throw new Error("the captured markup was empty");

    var contentInputs = [];
    var nText = 0, nImg = 0;
    var firstHeadingClass = null;

    // Images -> Image inputs, default = the real (absolute) src.
    var imgs = root.querySelectorAll("img");
    Array.prototype.forEach.call(imgs, function (im) {
      var src = im.getAttribute("src") || "";
      nImg++;
      var v = "image" + nImg;
      var alt = im.getAttribute("alt");
      contentInputs.push({
        type: "Image", variable: v,
        label: "Image " + nImg + (alt ? ' ("' + snippet(alt, 24) + '")' : ""),
        default: src, required: false, note: ""
      });
      im.setAttribute("src", "{{" + v + "}}");
    });

    // Text nodes -> Text / Large Text inputs, default = the real text.
    // Working at the text-node level keeps all inline structure (spans, icons,
    // arrows) intact and faithful; nothing is flattened or restyled.
    var walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    var tn;
    while ((tn = walker.nextNode())) {
      if (!tn.nodeValue || !tn.nodeValue.trim()) continue;
      if (inSvg(tn)) continue;
      nodes.push(tn);
    }
    nodes.forEach(function (node) {
      var parent = node.parentElement;
      var role = roleFor(parent);
      var raw = node.nodeValue;
      var lead = /^\s/.test(raw) ? " " : "";
      var trail = /\s$/.test(raw) ? " " : "";
      var val = collapse(raw);
      if (!val) return;
      nText++;
      var v = "text" + nText;
      var type = val.length > 120 ? "Large Text" : "Text";
      contentInputs.push({
        type: type, variable: v,
        label: role + ': "' + snippet(val, 32) + '"',
        default: val, required: false, note: ""
      });
      node.nodeValue = lead + "{{" + v + "}}" + trail;
      if (!firstHeadingClass && parent && /^h[1-6]$/.test(parent.tagName.toLowerCase())) {
        firstHeadingClass = firstClass(parent);
      }
    });

    var outHtml = root.outerHTML;

    // A couple of sensible design inputs so colours/type can be tuned in Duda.
    var designInputs = [];
    var rootClass = firstClass(root);
    if (rootClass) designInputs.push({ type: "Background", label: "Section background", selector: "." + rootClass });
    if (firstHeadingClass) designInputs.push({ type: "Text Style", label: "Heading style", selector: "." + firstHeadingClass });

    var host = hostnameOf(meta.source || "");

    var notes = [
      "Faithful local capture of the original section. No AI step, so it can't time out, truncate or drift.",
      "Every text block and image is an editable input with the original content set as its default.",
      "Repeated items are exposed one by one. They are not grouped into a single list yet.",
      "Hover and responsive states are not captured. Add those in Duda after you drop it in.",
      "Links keep their original address and are static. Re-point them in Duda if you need to."
    ];
    if (/@keyframes/i.test(css)) notes.push("CSS animations were captured and will play.");

    // Canvas backgrounds: a 2D canvas gives us a still frame (already set as the
    // background image at capture). A WebGL canvas (e.g. Stripe's gradient) reads
    // back blank, so we stand in an editable, pure-CSS animated gradient seeded
    // from any brand colours the canvas exposed. No JS: CSP-safe and Duda-friendly.
    var animBg = "";
    var hasCanvas = !!meta.hasCanvas || /<canvas[\s>]/i.test(outHtml);
    if (hasCanvas) {
      var canvasEl = root.querySelector("canvas");
      var canvasClass = canvasEl ? firstClass(canvasEl) : rootClass;
      if (meta.canvasFrameCaptured) {
        notes.push("A still frame of the canvas background was captured and used as the background image. It is a static image, not a live animation.");
      } else if (canvasClass) {
        var seeds = (meta.gradientColors || []).filter(isCssColor);
        if (seeds.length < 2) seeds = ["#6ec3f4", "#3a3aff", "#ff61ab", "#e63946"];
        seeds = seeds.slice(0, 4);
        seeds.forEach(function (c, idx) {
          designInputs.push({ type: "Color", label: "Gradient colour " + (idx + 1), selector: "." + canvasClass, variable: "gcol" + (idx + 1), default: c });
        });
        animBg =
          "\n\n/* TG Slicer animated background (pure CSS, no JS, editable). The original\n" +
          "   was painted by JavaScript (e.g. a WebGL gradient) which cannot be copied as\n" +
          "   code, so this editable animated gradient stands in. */\n" +
          "." + canvasClass + " {\n" +
          "  background-image: linear-gradient(120deg, " + seeds.join(", ") + ");\n" +
          "  background-size: 300% 300%;\n" +
          "  animation: tgsFlow 18s ease-in-out infinite;\n" +
          "}\n" +
          "@keyframes tgsFlow {\n" +
          "  0% { background-position: 0% 50%; }\n" +
          "  50% { background-position: 100% 50%; }\n" +
          "  100% { background-position: 0% 50%; }\n" +
          "}\n";
        notes.push("The original background was painted by JavaScript (e.g. a WebGL gradient) and can't be copied as code. An editable, animated CSS gradient stands in. Recolour it with the gradient colour inputs or swap it for a still image in Duda.");
      }
    }

    var acceptanceTest = [
      "Drop the widget on a blank Duda page. It should look like the section you captured.",
      "Change a text input. The matching text on the widget should update.",
      "Swap an image input. The image on the widget should update."
    ];

    return {
      widgetName: "Captured section \u2014 " + host,
      classPrefix: "tgs-",
      description: "Faithful capture of a " + (meta.tag || "section") + " from " + host + ", rebuilt as an editable Duda widget.",
      contentInputs: contentInputs,
      designInputs: designInputs,
      html: outHtml,
      cssDesktop: css + animBg,
      cssMobile: "",
      notes: notes,
      acceptanceTest: acceptanceTest
    };
  }

  globalThis.TGSEmit = { buildSheet: buildSheet };
})();
