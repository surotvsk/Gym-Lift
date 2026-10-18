/* GymQuest r5 — Bento + Mint: Mint's charts for Bento tiles. One series per chart, one hue, no legend
   (the tile title names the series), thin lines, the last point marked. Everything is inline SVG. */
window.BM = (function () {
  const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
  function scale(vals, h, pad) {
    const mn = Math.min(...vals), mx = Math.max(...vals), sp = mx - mn || 1;
    return (v) => pad + (1 - (v - mn) / sp) * (h - pad * 2);
  }
  /* Mint sparkline: line (+ optional soft fill) and a dot on the last value. */
  function spark(vals, o) {
    o = Object.assign({ w: 120, h: 30, color: 'currentColor', fill: false, dot: true, width: 2 }, o || {});
    if (!vals || vals.length < 2) return '';
    const y = scale(vals, o.h, 3), x = (i) => 1 + i / (vals.length - 1) * (o.w - 2);
    const pts = vals.map((v, i) => f1(x(i)) + ',' + f1(y(v))).join(' ');
    const last = vals.length - 1;
    return '<svg class="bm-spark" viewBox="0 0 ' + o.w + ' ' + o.h + '" preserveAspectRatio="none" aria-hidden="true">'
      + (o.fill ? '<polygon points="1,' + o.h + ' ' + pts + ' ' + f1(x(last)) + ',' + o.h + '" fill="' + o.color + '" opacity=".14"/>' : '')
      + '<polyline fill="none" stroke="' + o.color + '" stroke-width="' + o.width + '" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" points="' + pts + '"/>'
      + (o.dot ? '<circle cx="' + f1(x(last)) + '" cy="' + f1(y(vals[last])) + '" r="3" fill="' + o.color + '" vector-effect="non-scaling-stroke"/>' : '')
      + '</svg>';
  }
  /* Area chart with week labels, three faint gridlines and the last value called out. */
  function area(vals, o) {
    o = Object.assign({ w: 320, h: 130, color: '#121212', grid: 'rgba(0,0,0,.08)', text: 'rgba(0,0,0,.5)', labels: [], unit: '' }, o || {});
    if (!vals || vals.length < 2) return '';
    const lh = o.labels.length ? 16 : 0, ch = o.h - lh, y = scale(vals, ch, 10), px = o.labels.length ? 16 : 6, x = (i) => px + i / (vals.length - 1) * (o.w - px * 2);
    const pts = vals.map((v, i) => f1(x(i)) + ',' + f1(y(v))).join(' '), last = vals.length - 1;
    let g = '';
    for (let k = 1; k <= 3; k++) g += '<line x1="0" x2="' + o.w + '" y1="' + f1(ch * k / 4) + '" y2="' + f1(ch * k / 4) + '" stroke="' + o.grid + '" stroke-width="1"/>';
    return '<svg class="bm-area" viewBox="0 0 ' + o.w + ' ' + o.h + '" role="img" aria-label="' + (o.aria || 'trend') + '">' + g
      + '<polygon points="' + f1(x(0)) + ',' + ch + ' ' + pts + ' ' + f1(x(last)) + ',' + ch + '" fill="' + o.color + '" opacity=".18"/>'
      + '<polyline fill="none" stroke="' + o.color + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="' + pts + '"/>'
      + '<circle cx="' + f1(x(last)) + '" cy="' + f1(y(vals[last])) + '" r="4.5" fill="' + o.color + '"/>'
      + o.labels.map((l, i) => '<text x="' + f1(x(i)) + '" y="' + (o.h - 3) + '" text-anchor="middle" font-size="10" fill="' + o.text + '">' + l + '</text>').join('')
      + '</svg>';
  }
  /* Bars, the current one highlighted (Mint highlights "now"). */
  function bars(vals, o) {
    o = Object.assign({ w: 320, h: 110, color: '#121212', dim: 'rgba(0,0,0,.14)', text: 'rgba(0,0,0,.5)', labels: [], gap: 6, hi: vals.length - 1, active: null }, o || {});
    const on = (v, i) => (o.active ? o.active(v, i) : i === o.hi);
    const max = Math.max(1, ...vals), lh = o.labels.length ? 15 : 0, bw = (o.w - o.gap * (vals.length - 1)) / vals.length;
    return '<svg class="bm-bars" viewBox="0 0 ' + o.w + ' ' + o.h + '" role="img" aria-label="' + (o.aria || 'bars') + '">' + vals.map((v, i) => {
      const bh = Math.max(3, v / max * (o.h - lh - 4));
      return '<rect x="' + f1(i * (bw + o.gap)) + '" y="' + f1(o.h - lh - bh) + '" width="' + f1(bw) + '" height="' + f1(bh) + '" rx="5" fill="' + (on(v, i) ? o.color : o.dim) + '"/>'
        + (o.labels[i] ? '<text x="' + f1(i * (bw + o.gap) + bw / 2) + '" y="' + (o.h - 3) + '" text-anchor="middle" font-size="10"' + (i === o.hi ? ' font-weight="700"' : '') + ' fill="' + o.text + '">' + o.labels[i] + '</text>' : '');
    }).join('') + '</svg>';
  }
  function donut(pct, o) {
    o = Object.assign({ size: 72, stroke: 9, color: '#121212', track: 'rgba(0,0,0,.12)' }, o || {});
    const r = (o.size - o.stroke) / 2, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct));
    return '<svg class="bm-donut" width="' + o.size + '" height="' + o.size + '" viewBox="0 0 ' + o.size + ' ' + o.size + '" aria-hidden="true">'
      + '<circle cx="' + o.size / 2 + '" cy="' + o.size / 2 + '" r="' + r + '" fill="none" stroke="' + o.track + '" stroke-width="' + o.stroke + '"/>'
      + '<circle cx="' + o.size / 2 + '" cy="' + o.size / 2 + '" r="' + r + '" fill="none" stroke="' + o.color + '" stroke-width="' + o.stroke + '" stroke-linecap="round" stroke-dasharray="' + f1(c) + '" stroke-dashoffset="' + f1(c * (1 - p / 100)) + '" transform="rotate(-90 ' + o.size / 2 + ' ' + o.size / 2 + ')"/></svg>';
  }
  /* "▲ 12 %" against the previous value (or nothing when there is nothing to compare). */
  function delta(cur, prev, unit) {
    if (prev == null || cur == null) return '';
    const d = cur - prev;
    if (!d) return '<span class="bm-delta flat">= same as last week</span>';
    const pct = prev ? Math.round(Math.abs(d) / prev * 100) : null;
    return '<span class="bm-delta ' + (d > 0 ? 'up' : 'down') + '">' + (d > 0 ? '▲ ' : '▼ ') + (pct != null ? pct + ' %' : Math.abs(d) + (unit || '')) + '</span>';
  }
  return { spark, area, bars, donut, delta };
})();
