// The Love2Shop heart: two round lobes, a soft notch, gently convex sides
// that meet in a clean point. Built from geometry so it is crisp at any size.
// size = width of the drawing box. Returns { d, box } where box is the bbox.
function loveHeartPath(size, o) {
  o = o || {};
  var overlapK = o.overlap != null ? o.overlap : 0.2;  // how far the lobes overlap (notch depth)
  var stopDeg  = o.stop != null ? o.stop : 14;         // degrees short of the tip tangent the arc stops at
  var k1       = o.k1 != null ? o.k1 : 0.26;           // side bulge (along the lobe tangent), x size
  var cp2x     = o.cp2x != null ? o.cp2x : 0.16;       // tip approach, horizontal, x size
  var cp2y     = o.cp2y != null ? o.cp2y : 0.30;       // tip approach, vertical, x size
  var tipK     = o.tip != null ? o.tip : 0.9;          // tip y, x size

  var r = size / 4;
  var cl = { x: r + r * overlapK, y: r }, cr = { x: 3 * r - r * overlapK, y: r };
  var notchY = r - Math.sqrt(r * r - (cr.x - 2 * r) * (cr.x - 2 * r));
  var tip = { x: 2 * r, y: size * tipK };
  var f = function (n) { return n.toFixed(2); };

  // Left lobe: angle of the tangent point from the tip, then stop a little short of it
  function stopPoint(c, sign) {
    var dx = tip.x - c.x, dy = tip.y - c.y, d = Math.sqrt(dx * dx + dy * dy);
    var a = Math.atan2(dy, dx), b = Math.acos(r / d);
    var t = a + sign * (b + stopDeg * Math.PI / 180);   // stop short of the tangent point, on the lobe's outer side
    return { x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t), t: t };
  }
  var sl = stopPoint(cl, +1), sr = stopPoint(cr, -1);
  // Direction of travel along each lobe at the stop point (tangent-continuous join)
  var dl = { x: Math.sin(sl.t), y: -Math.cos(sl.t) };     // left lobe runs anticlockwise on screen
  var dr = { x: -Math.sin(sr.t), y: Math.cos(sr.t) };     // right lobe, mirrored
  var c1l = { x: sl.x + dl.x * k1 * size, y: sl.y + dl.y * k1 * size };
  var c2l = { x: tip.x - cp2x * size, y: tip.y - cp2y * size };
  var c1r = { x: tip.x + cp2x * size, y: tip.y - cp2y * size };
  var c2r = { x: sr.x + dr.x * k1 * size, y: sr.y + dr.y * k1 * size };

  var d = [
    'M', f(2 * r), f(notchY),
    'A', f(r), f(r), 0, 1, 0, f(sl.x), f(sl.y),
    'C', f(c1l.x), f(c1l.y), f(c2l.x), f(c2l.y), f(tip.x), f(tip.y),
    'C', f(c1r.x), f(c1r.y), f(c2r.x), f(c2r.y), f(sr.x), f(sr.y),
    'A', f(r), f(r), 0, 1, 0, f(2 * r), f(notchY),
    'Z'
  ].join(' ');
  return { d: d, box: { x: cl.x - r, y: 0, w: (cr.x + r) - (cl.x - r), h: tip.y } };
}
if (typeof module !== 'undefined') module.exports = loveHeartPath;
