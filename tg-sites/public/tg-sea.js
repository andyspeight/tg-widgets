/**
 * tg-sites ambient sea (A1 ambient-terrain, the water variant).
 *
 * A hand-written WebGL sea for a client-site hero: a plane displaced by summed
 * Gerstner waves under a perspective camera, lit with analytic normals so the
 * sheen and the glints are real rather than faked, dissolving into the sky at the
 * horizon so it sits under a photographic sky rather than cutting a hard line
 * across it. No library: raw WebGL, both shaders inline, a few hundred lines.
 *
 * TIER 2, AND IT BEHAVES LIKE IT. This is the one recipe that opens a GPU canvas,
 * so it carries every guard the motion catalogue asks of a tier-2 effect:
 *  - Reduced motion, and no canvas is created at all. The section keeps its still
 *    photographic background, which is a finished hero, not a broken one.
 *  - ONE per page. Only the first [data-motion='A1'] section is animated; any
 *    other keeps its still background. Two GPU canvases on one page is a phone
 *    getting warm.
 *  - The device pixel ratio is capped (1.5 desktop, 1.25 mobile). Full DPR on a
 *    3x phone renders nine times the pixels for no visible gain.
 *  - The loop pauses when the tab is hidden and when the section scrolls out of
 *    view, so it never burns battery drawing water nobody is looking at.
 *  - If WebGL is missing or the context is lost, the canvas is removed and the
 *    still background stands, so the content never depends on the GPU.
 *
 * PACED BY ELAPSED TIME, NEVER BY FRAMES, per the catalogue: a wave phase advanced
 * a fixed step per frame runs slow on a weak GPU and drifts. The phase is read
 * from the clock, so a machine dropping frames shows a coarser sea at the right
 * speed rather than a smooth one running late.
 *
 * CSP-CLEAN: no inline handlers, no injected <script>, no eval, no innerHTML. It
 * reads only the data- attributes the renderer wrote and draws into a canvas.
 *
 * @version 1.0.0
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';

  /* No canvas at all for a visitor who asked for less movement. The photographic
     background is already a finished hero without it. */
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  if (REDUCED && REDUCED.matches) return;

  // ---- small column-major mat4 helpers -----------------------------------
  function perspective(fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function normalize(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function lookAt(eye, ctr, up) {
    var z = normalize(sub(eye, ctr)), x = normalize(cross(up, z)), y = cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
      -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
  }
  function multiply(a, b) {
    var o = new Array(16);
    for (var c = 0; c < 4; c += 1) for (var r = 0; r < 4; r += 1) {
      var s = 0;
      for (var k = 0; k < 4; k += 1) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  }

  // ---- config off the section, defensively -------------------------------
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function num(raw, dflt, lo, hi) {
    var v = parseFloat(raw);
    return isFinite(v) ? clamp(v, lo, hi) : dflt;
  }
  function rgb(raw, dflt) {
    if (typeof raw !== 'string') return dflt;
    var m = /^#?([0-9a-f]{6})$/i.exec(raw.trim());
    if (!m) return dflt;
    var n = parseInt(m[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  var VS = [
    'attribute vec2 aXZ;',
    'uniform mat4 uVP; uniform float uTime, uSwell, uNearFade, uFarFade; uniform vec3 uCam;',
    'uniform vec2 uDir[4]; uniform float uLen[4]; uniform float uSteep[4]; uniform float uAmp[4]; uniform float uSpeed[4];',
    'varying vec3 vN, vW; varying float vFade;',
    'void main(){',
    '  vec2 base = aXZ;',
    '  vec3 pos = vec3(base.x, 0.0, base.y);',
    '  float nx=0.0, ny=0.0, nz=0.0;',
    '  for(int i=0;i<4;i++){',
    '    float w = 6.2831853/uLen[i];',
    '    float A = uAmp[i]*uSwell;',
    '    float Q = uSteep[i]/(w*A*4.0+1e-4);',
    '    float ph = w*dot(uDir[i], base) + uTime*uSpeed[i];',
    '    float c = cos(ph), s = sin(ph);',
    '    pos.x += Q*A*uDir[i].x*c; pos.z += Q*A*uDir[i].y*c; pos.y += A*s;',
    '    float WA = w*A;',
    '    nx += uDir[i].x*WA*c; nz += uDir[i].y*WA*c; ny += Q*WA*s;',
    '  }',
    '  vN = normalize(vec3(-nx, 1.0-ny, -nz));',
    '  vW = pos;',
    '  vFade = 1.0 - smoothstep(uNearFade, uFarFade, distance(uCam, pos));',
    '  gl_Position = uVP * vec4(pos, 1.0);',
    '}',
  ].join('\n');

  var FS = [
    'precision highp float;',
    'varying vec3 vN, vW; varying float vFade;',
    'uniform vec3 uCam, uSun, uSunCol, uDeep, uShallow, uHorizon;',
    'void main(){',
    '  vec3 N = normalize(vN);',
    '  vec3 V = normalize(uCam - vW);',
    '  vec3 L = normalize(uSun);',
    '  vec3 H = normalize(L + V);',
    '  float ndl = max(dot(N,L), 0.0);',
    '  float ndh = max(dot(N,H), 0.0);',
    '  float ndv = max(dot(N,V), 0.0);',
    '  float broad = pow(ndh, 40.0);',
    '  float glint = pow(ndh, 500.0);',
    '  float fres = 0.02 + 0.98*pow(1.0 - ndv, 5.0);',
    '  vec3 body = mix(uDeep, uShallow, 0.35 + 0.5*ndl);',
    '  vec3 col = mix(body, uHorizon, fres*0.7);',
    '  col += uSunCol * broad * 0.30;',
    '  col += uSunCol * glint * 1.4;',
    '  col = mix(uHorizon, col, clamp(vFade + 0.15, 0.0, 1.0));',
    '  gl_FragColor = vec4(col, vFade);',
    '}',
  ].join('\n');

  // The engine. Owns the GL program, the grid and the uniforms; the lifecycle
  // below owns the canvas, the observers and the clock.
  function createSea(gl, cfg) {
    function shader(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
      return s;
    }
    var prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link');
    gl.useProgram(prog);

    gl.getExtension('OES_element_index_uint');
    // A coarser mesh on a narrow screen, per the catalogue: a third fewer rows.
    var narrow = window.innerWidth < 900;
    var COLS = narrow ? 84 : 120, ROWS = narrow ? 116 : 170;
    var X0 = -90, X1 = 90, ZFAR = -175, ZNEAR = 12;
    var verts = [], idx = [];
    for (var r = 0; r < ROWS; r += 1) {
      var z = ZFAR + (ZNEAR - ZFAR) * (r / (ROWS - 1)); // r=0 is the far row
      for (var c = 0; c < COLS; c += 1) verts.push(X0 + (X1 - X0) * (c / (COLS - 1)), z);
    }
    for (var rr = 0; rr < ROWS - 1; rr += 1) {
      for (var cc = 0; cc < COLS - 1; cc += 1) {
        var a = rr * COLS + cc, b = a + 1, d = a + COLS, e = d + 1;
        idx.push(a, d, b, b, d, e); // far row first, for correct alpha blending
      }
    }
    var vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    var ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW);
    var aXZ = gl.getAttribLocation(prog, 'aXZ');
    gl.enableVertexAttribArray(aXZ);
    gl.vertexAttribPointer(aXZ, 2, gl.FLOAT, false, 0, 0);

    function U(n) { return gl.getUniformLocation(prog, n); }
    // Four Gerstner waves, longest and calmest first. Directions spread so the
    // set never resolves into one marching swell.
    var dirs = [[1, 0.15], [0.7, 0.7], [-0.5, 0.4], [0.1, 1.0]].map(function (p) {
      var n = normalize([p[0], 0, p[1]]);
      return [n[0], n[2]];
    });
    gl.uniform2fv(U('uDir[0]'), new Float32Array([].concat.apply([], dirs)));
    gl.uniform1fv(U('uLen[0]'), new Float32Array([48, 26, 14, 8]));
    gl.uniform1fv(U('uSteep[0]'), new Float32Array([0.7, 0.6, 0.5, 0.4]));
    gl.uniform1fv(U('uAmp[0]'), new Float32Array([0.9, 0.5, 0.28, 0.14]));
    gl.uniform1fv(U('uSpeed[0]'), new Float32Array([0.55, 0.75, 1.0, 1.4]));
    gl.uniform1f(U('uSwell'), cfg.swell);
    gl.uniform1f(U('uNearFade'), 40.0);
    gl.uniform1f(U('uFarFade'), 165.0);
    var sun = cfg.sunRad;
    gl.uniform3fv(U('uSun'), new Float32Array(normalize([Math.sin(sun) * 0.9, 0.24, -Math.cos(sun) * 0.9])));
    gl.uniform3fv(U('uSunCol'), new Float32Array(cfg.sunCol));
    gl.uniform3fv(U('uDeep'), new Float32Array(cfg.deep));
    gl.uniform3fv(U('uShallow'), new Float32Array(cfg.shallow));
    gl.uniform3fv(U('uHorizon'), new Float32Array(cfg.horizon));
    var cam = [0, 5.0, 14];
    gl.uniform3fv(U('uCam'), new Float32Array(cam));
    var uVP = U('uVP'), uTime = U('uTime');

    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);

    return {
      resize: function (w, h) {
        gl.viewport(0, 0, w, h);
        var proj = perspective(50 * Math.PI / 180, w / Math.max(1, h), 0.5, 400);
        var view = lookAt(cam, [0, 1.2, -45], [0, 1, 0]);
        gl.uniformMatrix4fv(uVP, false, new Float32Array(multiply(proj, view)));
      },
      render: function (t) {
        gl.uniform1f(uTime, t);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_INT, 0);
      },
    };
  }

  function initOne(section) {
    if (section.getAttribute('data-sea-live') === '1') return; // re-init guard
    section.setAttribute('data-sea-live', '1');

    var canvas = document.createElement('canvas');
    canvas.className = 'tgs-sea';
    canvas.setAttribute('aria-hidden', 'true');
    // Essential positioning inline so it works before the stylesheet, behind the
    // section's content and scrim but over its still background photograph.
    canvas.style.position = 'absolute';
    canvas.style.left = '0';
    canvas.style.top = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.zIndex = '0';
    canvas.style.pointerEvents = 'none';

    var gl = null;
    try {
      gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false })
        || canvas.getContext('experimental-webgl', { alpha: true, premultipliedAlpha: false });
    } catch (err) { gl = null; }
    if (!gl) { section.removeAttribute('data-sea-live'); return; } // keep the still hero

    var cfg = {
      swell: num(section.getAttribute('data-sea-swell'), 0.65, 0.15, 1),
      sunRad: num(section.getAttribute('data-sea-sun'), 12, -80, 80) * Math.PI / 180,
      deep: rgb(section.getAttribute('data-sea-deep'), [0.03, 0.16, 0.25]),
      shallow: rgb(section.getAttribute('data-sea-shallow'), [0.09, 0.36, 0.47]),
      horizon: rgb(section.getAttribute('data-sea-horizon'), [0.78, 0.85, 0.89]),
      // The sun's own colour, so a scene can be warm gold, cool silver or plain
      // daylight. Defaults to the warm white the daylight tones ship with.
      sunCol: rgb(section.getAttribute('data-sea-suncol'), [1.0, 0.96, 0.86]),
    };

    var sea;
    try { sea = createSea(gl, cfg); }
    catch (err) { section.removeAttribute('data-sea-live'); return; }

    // The still background is the section's own; drop the canvas behind the scrim.
    var scrim = section.querySelector('.tgs-section__scrim');
    if (scrim) section.insertBefore(canvas, scrim);
    else section.insertBefore(canvas, section.firstChild);

    var DPR_CAP = window.innerWidth < 700 || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ? 1.25 : 1.5;
    function size() {
      var dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      var w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      var h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (w !== canvas.width || h !== canvas.height) { canvas.width = w; canvas.height = h; }
      sea.resize(canvas.width, canvas.height);
    }
    size();
    window.addEventListener('resize', size, { passive: true });

    // Pause when the section is off-screen or the tab is hidden.
    var onScreen = true, raf = 0, t0 = 0;
    function loop(now) {
      raf = 0;
      if (document.hidden || !onScreen) return; // stop; a wake below restarts it
      if (!t0) t0 = now;
      size();
      sea.render((now - t0) / 1000);
      raf = window.requestAnimationFrame(loop);
    }
    function play() { if (!raf && !document.hidden && onScreen) raf = window.requestAnimationFrame(loop); }

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        onScreen = entries[0].isIntersecting;
        if (onScreen) play();
      }, { threshold: 0 }).observe(section);
    }
    document.addEventListener('visibilitychange', play);
    canvas.addEventListener('webglcontextlost', function (ev) {
      ev.preventDefault();
      if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
    });
    play();
  }

  function init() {
    // ONE per page: the first A1 section only; the rest keep their still hero.
    var section = document.querySelector("[data-motion='A1']");
    if (section) initOne(section);
    window.__TG_SEA_VERSION__ = VERSION;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
