/* Builds the private review page for one batch: for every exercise and candidate, 6 frames
   (video) or the photos themselves, plus source, licence and the planned trim. Images are
   embedded as data: URIs so the page works as a single published file.
   node tools/media/review.js tools/media/batches/batch-1.json /tmp/gq-review/batch-1.html */
'use strict';
const fs = require('fs');
const path = require('path');
const [batchFile, outFile] = process.argv.slice(2);
if (!batchFile || !outFile) { console.error('usage: review.js <batch.json> <out.html>'); process.exit(2); }
const batch = JSON.parse(fs.readFileSync(batchFile, 'utf8'));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dataUri = (f) => 'data:image/jpeg;base64,' + fs.readFileSync(f).toString('base64');
const imagesFor = (c) => c.kind === 'video'
  ? [1, 2, 3, 4, 5, 6].map((i) => path.join(c.framesDir, 'frame-' + i + '.jpg')).filter((f) => fs.existsSync(f))
  : (c.photos || []).filter((f) => fs.existsSync(f));
const sections = batch.exercises.map((ex) => {
  const cands = ex.candidates.length ? ex.candidates.map((c, n) => `
    <article class="cand">
      <h3>Option ${n + 1} · ${esc(c.kind === 'video' ? 'Video' : (c.photos || []).length + ' photos')}</h3>
      <div class="frames">${imagesFor(c).map((f, i) => `<figure><img src="${dataUri(f)}" alt="${esc(ex.id)} option ${n + 1} frame ${i + 1}"><figcaption>${i + 1}</figcaption></figure>`).join('')}</div>
      <dl>
        <dt>Creator</dt><dd>${esc(c.creator)}</dd>
        <dt>Licence</dt><dd>${esc(c.license)}</dd>
        <dt>Source</dt><dd><a href="${esc(c.page)}">${esc(c.page)}</a></dd>
        ${c.trim ? `<dt>Clip</dt><dd>${esc(c.trim.start)} s – ${esc(c.trim.end)} s</dd>` : ''}
        ${c.note ? `<dt>Note</dt><dd>${esc(c.note)}</dd>` : ''}
      </dl>
    </article>`).join('') : '<p class="none">No correct, legally usable match found. This exercise keeps its current state.</p>';
  return `<section><h2>${esc(ex.id)}</h2>${cands}</section>`;
}).join('');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, `<title>GymQuest media review – batch ${esc(batch.batch)}</title>
<style>
:root { --bg: #f6f7f9; --fg: #16181d; --dim: #5b6270; --line: #dde1e7; --card: #fff; --accent: #e8572e; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #14161a; --fg: #eef0f3; --dim: #a3aab6; --line: #2a2e36; --card: #1c1f25; color-scheme: dark; } }
:root[data-theme="dark"] { --bg: #14161a; --fg: #eef0f3; --dim: #a3aab6; --line: #2a2e36; --card: #1c1f25; color-scheme: dark; }
body { background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding-block: 24px; padding-inline: 16px; }
section { border-top: 1px solid var(--line); padding-block: 16px; }
.cand { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px; margin-block: 12px; }
.frames { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
figure { margin: 0; } img { width: 100%; border-radius: 6px; display: block; }
figcaption { color: var(--dim); font-size: 12px; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 10px 0 0; }
dt { color: var(--dim); } dd { margin: 0; overflow-wrap: anywhere; }
a { color: var(--accent); } .none { color: var(--dim); }
</style>
<main><h1>Batch ${esc(batch.batch)}: pick one option per exercise, or none</h1>
<p>Reply in chat, e.g. “romanian-deadlift: option 1; adductor-machine: none”.</p>${sections}</main>
`);
console.log('wrote ' + outFile);
