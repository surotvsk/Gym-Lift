/* GymQuest r7 concepts — Bento (round 2): Bento default colours. Only the colours change. */
window.GQ_BENTO_R7 = [
  ["01", "classic-light", "Bento Classic Light", "Bento with its own default colours: lime, lavender, peach, sky and sand with black, light mode: pale tiles, dark text.", ['bento', 'light mode']],
  ["02", "classic-dark", "Bento Classic Dark", "Bento with its own default colours: lime, lavender, peach, sky and sand with black, dark mode: near-black background, deep tiles, light text.", ['bento', 'dark mode']],
  ["03", "soft-light", "Bento Soft Light", "Bento with the default colours a little paler and calmer, light mode: pale tiles, dark text.", ['bento', 'light mode']],
  ["04", "soft-dark", "Bento Soft Dark", "Bento with the default colours a little paler and calmer, dark mode: near-black background, deep tiles, light text.", ['bento', 'dark mode']],
  ["05", "vivid-light", "Bento Vivid Light", "Bento with the default colours a little punchier and brighter, light mode: pale tiles, dark text.", ['bento', 'light mode']],
  ["06", "vivid-dark", "Bento Vivid Dark", "Bento with the default colours a little punchier and brighter, dark mode: near-black background, deep tiles, light text.", ['bento', 'dark mode']],
];
(function () {
  const info = document.getElementById('info');
  if (!info) return;
  const slug = (location.pathname.split('/').pop() || '').replace(/^\d+-|\.html$/g, '');
  const L = window.GQ_BENTO_R7; const i = L.findIndex((d) => d[1] === slug); if (i < 0) return;
  const d = L[i], prev = L[(i + L.length - 1) % L.length], next = L[(i + 1) % L.length];
  const file = (x) => x[0] + '-' + x[1] + '.html';
  info.innerHTML = '<div class="num">' + d[0] + ' / 06 · BENTO DEFAULT COLOURS</div><h1>' + d[2] + '</h1><p>' + d[3] + '</p>'
    + d[4].map((t) => '<span class="tag">' + t + '</span>').join('')
    + '<p style="margin-top:14px;font-size:13px;color:#6b665d">Same layout and features as Bento (round 2); only the colours change. Data is shared with the other rounds and stays in this browser.</p>'
    + '<div class="concept-nav"><a href="' + file(prev) + '">← Prev</a><a href="' + file(next) + '">Next →</a></div>';
  document.title = d[0] + ' · ' + d[2] + ' — GymQuest concept';
})();
