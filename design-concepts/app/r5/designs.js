/* GymQuest r5 concepts — Bento (round 2) with Mint's charts (round 3), three variants. */
window.GQ5_DESIGNS = [
  ['01', 'bento-trends', 'Bento Trends', 'Bento as it is, but every number tile now carries a Mint trend line: workouts, minutes, level, body weight and your best lift over the last eight weeks, each in the ink of its tile.', ['bento tiles', 'mint sparklines', 'closest to bento']],
  ['02', 'bento-dashboard', 'Bento Dashboard', 'A big dark chart tile leads the home screen: the last eight weeks of minutes, sets or XP (tap to switch) with the change against last week, then Mint’s four vitals as Bento tiles.', ['hero chart', 'switch minutes / sets / XP', 'vitals']],
  ['03', 'bento-mint', 'Bento Mint', 'Bento’s grid in Mint’s colours: clinic white, mint and deep green. Every tile is a small chart — this week’s days as bars, minutes as an area, body weight with its range, level as a ring.', ['mint palette', 'a chart in every tile', 'ring + bars + area']],
];
(function () {
  const info = document.getElementById('info');
  if (!info) return;
  const slug = (location.pathname.split('/').pop() || '').replace(/^\d+-|\.html$/g, '');
  const L = window.GQ5_DESIGNS; const i = L.findIndex((d) => d[1] === slug); if (i < 0) return;
  const d = L[i], prev = L[(i + L.length - 1) % L.length], next = L[(i + 1) % L.length];
  const file = (x) => x[0] + '-' + x[1] + '.html';
  info.innerHTML = '<div class="num">' + d[0] + ' / 03 · BENTO + MINT</div><h1>' + d[2] + '</h1><p>' + d[3] + '</p>'
    + d[4].map((t) => '<span class="tag">' + t + '</span>').join('')
    + '<p style="margin-top:14px;font-size:13px;color:#6b665d">Working prototype on the round 2 engine. Data is shared with the other rounds and stays in this browser.</p>'
    + '<div class="concept-nav"><a href="' + file(prev) + '">← Prev</a><a href="' + file(next) + '">Next →</a></div>';
  document.title = d[0] + ' · ' + d[2] + ' — GymQuest concept';
})();
