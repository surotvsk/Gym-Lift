/* GymQuest r4 concepts — five designs rebuilt from reference screenshots (style only, GymQuest content). */
window.GQ4_DESIGNS = [
  ['01', 'periwinkle', 'Periwinkle', 'Soft periwinkle and white cards. A greeting with a search bar, today’s progress as a big percentage with a ring, pastel tiles for calories, steps and moving time, and an activity screen with a wave card and a bar chart that highlights today.', ['periwinkle', 'white cards', 'progress ring']],
  ['02', 'pastel', 'Pastel Planner', 'Big pastel cards in pink, blue and green with a figure on each, a floating pill navigation that shows the label of the active tab, a planner with a month calendar and daily-plan cards with Replace and Play buttons.', ['pastel cards', 'floating pill nav', 'planner calendar']],
  ['03', 'rings', 'Soft Rings', 'Calm off-white with mint, teal and yellow concentric progress rings, a muscles-workload screen with a body map, and an activity page with water, heart and steps tiles. The active tab is a black circle.', ['concentric rings', 'muscle map', 'black active tab']],
  ['04', 'violet', 'Violet Studio', 'Deep violet gradients and flat illustrations. A welcome screen with a sign-in style profile card, daily, weekly and monthly activity tiles with donut rings, and a current-session screen with a schedule strip and a progress slider.', ['violet gradient', 'illustrations', 'donut rings']],
  ['05', 'lilac', 'Lilac Player', 'Lilac and white with rounded illustrations. Today’s plan card with a play button, information tiles, a colourful daily bar chart, and the workout as a music-player style screen with previous, play and next.', ['lilac', 'player controls', 'information tiles']],
];
(function () {
  const info = document.getElementById('info');
  if (!info) return;
  const slug = (location.pathname.split('/').pop() || '').replace(/^\d+-|\.html$/g, '');
  const L = window.GQ4_DESIGNS; const i = L.findIndex((d) => d[1] === slug); if (i < 0) return;
  const d = L[i], prev = L[(i + L.length - 1) % L.length], next = L[(i + 1) % L.length];
  const file = (x) => x[0] + '-' + x[1] + '.html';
  info.innerHTML = '<div class="num">' + d[0] + ' / 05 · FROM YOUR REFERENCES</div><h1>' + d[2] + '</h1><p>' + d[3] + '</p>'
    + d[4].map((t) => '<span class="tag">' + t + '</span>').join('')
    + '<p style="margin-top:14px;font-size:13px;color:#6b665d">Working prototype: every GymQuest feature works here. Data is shared with rounds 2 and 3 and stays in this browser.</p>'
    + '<div class="concept-nav"><a href="' + file(prev) + '">← Prev</a><a href="index.html">All designs</a><a href="' + file(next) + '">Next →</a></div>';
  document.title = d[0] + ' · ' + d[2] + ' — GymQuest concept';
})();
