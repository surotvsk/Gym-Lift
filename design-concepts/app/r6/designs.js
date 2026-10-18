/* GymQuest r6 concepts — Bento (round 2) in five colourways, each light and dark. Only the colours change. */
window.GQ6_DESIGNS = [
  ['01', 'ocean-light', 'Bento Ocean Light', 'Bento with aqua, blues and seafoam, light mode: pale tiles, dark text.', ['bento', 'light mode']],
  ['02', 'ocean-dark', 'Bento Ocean Dark', 'Bento with aqua, blues and seafoam, dark mode: near-black background, deep tiles, light text.', ['bento', 'dark mode']],
  ['03', 'sunset-light', 'Bento Sunset Light', 'Bento with coral, rose and amber, light mode: pale tiles, dark text.', ['bento', 'light mode']],
  ['04', 'sunset-dark', 'Bento Sunset Dark', 'Bento with coral, rose and amber, dark mode: near-black background, deep tiles, light text.', ['bento', 'dark mode']],
  ['05', 'forest-light', 'Bento Forest Light', 'Bento with moss, sage and wheat, light mode: pale tiles, dark text.', ['bento', 'light mode']],
  ['06', 'forest-dark', 'Bento Forest Dark', 'Bento with moss, sage and wheat, dark mode: near-black background, deep tiles, light text.', ['bento', 'dark mode']],
  ['07', 'berry-light', 'Bento Berry Light', 'Bento with pink, lilac and orchid, light mode: pale tiles, dark text.', ['bento', 'light mode']],
  ['08', 'berry-dark', 'Bento Berry Dark', 'Bento with pink, lilac and orchid, dark mode: near-black background, deep tiles, light text.', ['bento', 'dark mode']],
  ['09', 'mono-light', 'Bento Mono Light', 'Bento with greys with one electric-orange accent, light mode: pale tiles, dark text.', ['bento', 'light mode']],
  ['10', 'mono-dark', 'Bento Mono Dark', 'Bento with greys with one electric-orange accent, dark mode: near-black background, deep tiles, light text.', ['bento', 'dark mode']],
];
(function () {
  const info = document.getElementById('info');
  if (!info) return;
  const slug = (location.pathname.split('/').pop() || '').replace(/^\d+-|\.html$/g, '');
  const L = window.GQ6_DESIGNS; const i = L.findIndex((d) => d[1] === slug); if (i < 0) return;
  const d = L[i], prev = L[(i + L.length - 1) % L.length], next = L[(i + 1) % L.length];
  const file = (x) => x[0] + '-' + x[1] + '.html';
  info.innerHTML = '<div class="num">' + d[0] + ' / 10 · BENTO COLOURWAYS</div><h1>' + d[2] + '</h1><p>' + d[3] + '</p>'
    + d[4].map((t) => '<span class="tag">' + t + '</span>').join('')
    + '<p style="margin-top:14px;font-size:13px;color:#6b665d">Same layout and features as Bento (round 2); only the colours change. Data is shared with the other rounds and stays in this browser.</p>'
    + '<div class="concept-nav"><a href="' + file(prev) + '">← Prev</a><a href="' + file(next) + '">Next →</a></div>';
  document.title = d[0] + ' · ' + d[2] + ' — GymQuest concept';
})();
