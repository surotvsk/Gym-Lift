'use strict';
/* GymQuest — Android build: tools/android/build-www.sh copies exactly the app files into www/.

     node tests/android/build-www.js

   Checks: the app shell, vendor, fonts, icons, every MP4 demo and every poster/image are copied
   byte-for-byte; no WebM, no service worker, no tests/tools/design-concepts/docs/supabase/
   node_modules; total size < 40 MB; the repo's own web files are untouched by the build. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const WWW = path.join(REPO, 'www');
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  -> ' + JSON.stringify(info) : '')); }
}
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}

const WATCH = ['index.html', 'script.js', 'style.css', 'sw.js', 'community-config.js'];
const before = Object.fromEntries(WATCH.map((f) => [f, sha(path.join(REPO, f))]));

const script = path.join(REPO, 'tools', 'android', 'build-www.sh');
check('build script exists', fs.existsSync(script));
if (!fs.existsSync(script)) { console.log(`\n${pass} passed, ${fail} failed`); process.exit(1); }
execFileSync('bash', [script], { cwd: REPO, stdio: 'inherit' });

const shell = ['index.html', 'script.js', 'style.css', 'community-config.js', 'manifest.json',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'vendor/supabase-js.js'];
for (const f of shell) {
  const a = path.join(REPO, f), b = path.join(WWW, f);
  check('copied ' + f, fs.existsSync(b) && sha(a) === sha(b));
}
const fonts = fs.readdirSync(path.join(REPO, 'fonts'));
check('fonts copied', fonts.length > 0 && fonts.every((f) => fs.existsSync(path.join(WWW, 'fonts', f))));

const media = fs.readdirSync(path.join(REPO, 'media'));
const wanted = media.filter((f) => /\.(mp4|jpe?g|png|webp)$/i.test(f));
const missing = wanted.filter((f) => !fs.existsSync(path.join(WWW, 'media', f))
  || sha(path.join(REPO, 'media', f)) !== sha(path.join(WWW, 'media', f)));
check('every mp4 + image in media/ copied byte-identical (' + wanted.length + ')', wanted.length > 0 && missing.length === 0, missing);

const files = walk(WWW).map((f) => path.relative(WWW, f));
check('no .webm in www', !files.some((f) => /\.webm$/i.test(f)), files.filter((f) => /\.webm$/i.test(f)).slice(0, 3));
check('no sw.js in www', !files.includes('sw.js'));
for (const d of ['tests', 'tools', 'design-concepts', 'docs', 'supabase', 'node_modules', 'android', 'www'])
  check('no ' + d + '/ in www', !fs.existsSync(path.join(WWW, d)));
check('no markdown / json backups in www', !files.some((f) => /\.md$/i.test(f) || /backup.*\.json$/i.test(f)));

const total = walk(WWW).reduce((s, f) => s + fs.statSync(f).size, 0);
check('www total < 40 MB (' + (total / 1048576).toFixed(1) + ' MB)', total < 40 * 1048576);

for (const f of WATCH) check('repo ' + f + ' untouched', sha(path.join(REPO, f)) === before[f]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
