/* GymQuest r4 concepts — small flat illustrations drawn in SVG (no photos, no external images).
   Art.figure(pose, palette) returns an <svg> string. Poses: run (on a treadmill), yoga, pushup, lift, stretch, walk. */
window.Art = (function () {
  'use strict';
  const P = (o) => Object.assign({ skin: '#F2C3A0', hair: '#2B2340', top: '#6C63FF', bottom: '#2E2A6B', shoe: '#FFFFFF', prop: '#3C3A8F', line: '#2B2340' }, o || {});
  const limb = (d, c, w) => '<path d="' + d + '" stroke="' + c + '" stroke-width="' + (w || 11) + '" stroke-linecap="round" stroke-linejoin="round" fill="none"/>';
  const head = (x, y, c, hair) => '<circle cx="' + x + '" cy="' + y + '" r="11" fill="' + c.skin + '"/><path d="M' + (x - 11) + ' ' + (y - 2) + ' a11 11 0 0 1 22 0 q-6 -6 -16 -3z" fill="' + (hair || c.hair) + '"/>';
  const POSES = {
    run: (c) => '<rect x="20" y="132" width="150" height="10" rx="5" fill="' + c.prop + '"/><path d="M150 132 L172 70" stroke="' + c.prop + '" stroke-width="7" stroke-linecap="round"/><rect x="160" y="62" width="26" height="12" rx="4" fill="' + c.prop + '"/>'
      + limb('M92 84 L80 108 L60 116', c.bottom) + limb('M92 84 L108 106 L118 128', c.bottom) + '<circle cx="58" cy="117" r="6" fill="' + c.shoe + '"/><circle cx="120" cy="130" r="6" fill="' + c.shoe + '"/>'
      + limb('M96 56 L92 86', c.top, 18) + limb('M96 60 L112 74 L126 64', c.skin, 7) + limb('M95 60 L80 76 L70 70', c.skin, 7) + head(100, 40, c),
    yoga: (c) => '<ellipse cx="100" cy="146" rx="70" ry="8" fill="' + c.prop + '" opacity=".35"/>'
      + limb('M100 112 Q74 128 58 140 L96 140', c.bottom, 13) + limb('M100 112 Q126 128 142 140 L104 140', c.bottom, 13)
      + limb('M100 78 L100 112', c.top, 20) + limb('M100 82 L70 96 L60 120', c.skin, 7) + limb('M100 82 L130 96 L140 120', c.skin, 7) + head(100, 62, c),
    pushup: (c) => '<rect x="16" y="140" width="168" height="6" rx="3" fill="' + c.prop + '" opacity=".4"/>'
      + limb('M60 104 L120 112 L170 136', c.bottom, 12) + '<circle cx="172" cy="137" r="5" fill="' + c.shoe + '"/>'
      + limb('M58 102 L112 110', c.top, 18) + limb('M62 104 L64 138', c.skin, 7) + limb('M70 106 L76 138', c.skin, 7) + head(44, 96, c),
    lift: (c) => '<rect x="38" y="44" width="124" height="6" rx="3" fill="' + c.line + '"/><rect x="28" y="30" width="12" height="34" rx="4" fill="' + c.prop + '"/><rect x="160" y="30" width="12" height="34" rx="4" fill="' + c.prop + '"/>'
      + limb('M100 108 L82 140', c.bottom, 13) + limb('M100 108 L118 140', c.bottom, 13) + limb('M100 76 L100 110', c.top, 20)
      + limb('M100 80 L76 64 L72 48', c.skin, 7) + limb('M100 80 L124 64 L128 48', c.skin, 7) + head(100, 62, c),
    stretch: (c) => limb('M100 104 L70 140', c.bottom, 13) + limb('M100 104 L134 140', c.bottom, 13) + limb('M100 68 L100 106', c.top, 20)
      + limb('M100 72 L120 46 L132 24', c.skin, 7) + limb('M100 72 L84 50 L80 30', c.skin, 7) + head(100, 52, c),
    walk: (c) => limb('M100 100 L88 140', c.bottom, 13) + limb('M100 100 L116 138', c.bottom, 13) + limb('M100 66 L100 102', c.top, 20)
      + limb('M100 70 L88 92', c.skin, 7) + limb('M100 70 L114 90', c.skin, 7) + head(100, 50, c),
  };
  const figure = (pose, pal, o) => { o = o || {}; const c = P(pal); return '<svg class="art ' + (o.cls || '') + '" viewBox="0 0 200 160" role="img" aria-label="' + (o.label || pose + ' illustration') + '">' + (o.bg ? '<circle cx="100" cy="86" r="70" fill="' + o.bg + '"/>' : '') + (POSES[pose] || POSES.walk)(c) + '</svg>'; };
  /* a front body outline with muscle areas filled by intensity 0..1 */
  const body = (m, col, o) => {
    o = o || {}; const f = (k) => 'fill="' + col + '" fill-opacity="' + (0.12 + Math.min(1, m[k] || 0) * 0.8).toFixed(2) + '"';
    return '<svg class="art body" viewBox="0 0 120 220" role="img" aria-label="' + (o.label || 'muscle map') + '"><g stroke="#2B2B2B" stroke-width="1.5" fill="none">'
      + '<circle cx="60" cy="20" r="13"/><path d="M38 44 Q60 36 82 44 L90 100 L84 130 L76 210 L64 210 L60 140 L56 210 L44 210 L36 130 L30 100Z"/><path d="M38 46 L22 100 L18 130 M82 46 L98 100 L102 130"/></g>'
      + '<path d="M42 50 Q60 44 78 50 L76 72 Q60 78 44 72Z" ' + f('chest') + '/><path d="M36 46 Q30 52 30 62 L40 60Z M84 46 Q90 52 90 62 L80 60Z" ' + f('shoulders') + '/>'
      + '<path d="M28 66 L22 98 L28 100 L34 70Z M92 66 L98 98 L92 100 L86 70Z" ' + f('arms') + '/><path d="M48 76 L72 76 L70 104 L50 104Z" ' + f('core') + '/>'
      + '<path d="M40 112 L58 116 L56 170 L44 170Z M80 112 L62 116 L64 170 L76 170Z" ' + f('legs') + '/><path d="M42 104 L78 104 L80 116 L40 116Z" ' + f('glutes') + '/></svg>';
  };
  return { figure, body };
})();
