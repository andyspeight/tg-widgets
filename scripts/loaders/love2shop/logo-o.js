// The O from the Love2Shop Holidays wordmark, lifted verbatim from the master
// logo (love2shop-holidays-logo.svg, "L2S Holidays Logo_Master 2023", sent by
// Kevin Doyle on 16 Jul 2026). Coordinates are the logo's own: the O is a
// solid disc with the heart knocked out of it.
var LOGO_O = {
  cx: 62.62, cy: 24.52, r: 24.62,                       // the disc
  disc: 'M62.62,0c-13.03,0-24.66,9.61-24.66,24.52s11.62,24.52,24.66,24.52,24.59-9.61,24.59-24.52S75.59,0,62.62,0Z',
  heart: 'M62.59,37.21c-1.4,0-15.94-12.88-15.94-15.94s6.52-7.97,7.97-7.97,7.97,5.19,7.97,8.01c0-2.83,6.26-8.01,7.97-8.01s7.97,4.85,7.97,7.97-14.54,15.94-15.94,15.94Z',
  heartCx: 62.59, heartCy: 25.25                        // centre of the heart's box (x 46.65..78.53, y 13.30..37.21)
};
if (typeof module !== 'undefined') module.exports = LOGO_O;
