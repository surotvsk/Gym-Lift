'use strict';
/* GymQuest social (migration 0005) — shared helpers for the LOCAL test database.

   Safety: this harness refuses to run against anything but a local Supabase
   (http://127.0.0.1 / localhost). It uses the local stack's service key to create
   disposable users and the local db container for SQL; neither exists in
   production, and no production URL or key is ever read.

   Env:
     GQ_LOCAL_URL      default http://127.0.0.1:54321
     GQ_LOCAL_ANON     anon key of the local stack       (supabase status -o env)
     GQ_LOCAL_SERVICE  service-role key of the local stack
     GQ_LOCAL_DB       db container name, default supabase_db_gqtest */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const URL_ = (process.env.GQ_LOCAL_URL || 'http://127.0.0.1:54321').replace(/\/+$/, '');
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL_)) {
  throw new Error('refusing to run: GQ_LOCAL_URL must be a local Supabase (got ' + URL_ + ')');
}
const ANON = process.env.GQ_LOCAL_ANON;
const SERVICE = process.env.GQ_LOCAL_SERVICE;
if (!ANON || !SERVICE) throw new Error('GQ_LOCAL_ANON and GQ_LOCAL_SERVICE are required (supabase status -o env)');
const DB = process.env.GQ_LOCAL_DB || 'supabase_db_gqtest';

/* The same supabase-js build the app ships (vendor/supabase-js.js). */
function loadSupabase() {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'vendor', 'supabase-js.js'), 'utf8');
  const ctx = { console, fetch, Headers, Request, Response, URL, URLSearchParams, setTimeout, clearTimeout,
    setInterval, clearInterval, AbortController, Blob, FormData, TextEncoder, TextDecoder,
    crypto: globalThis.crypto, atob, btoa, structuredClone, queueMicrotask, WebSocket: globalThis.WebSocket };
  ctx.globalThis = ctx; ctx.self = ctx; ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(src + ';globalThis.supabase = supabase;', ctx);
  return ctx.supabase;
}
const supabase = loadSupabase();
const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const anon = () => supabase.createClient(URL_, ANON, opts);
const admin = supabase.createClient(URL_, SERVICE, opts);

/* SQL on the local db container (docker directly, or through `sg docker` when the
   current login session does not have the docker group yet). */
let dockerViaSg = null;
function dockerExec(args, input) {
  if (dockerViaSg === null) {
    try { execFileSync('docker', ['ps', '-q'], { stdio: 'pipe' }); dockerViaSg = false; } catch (e) { dockerViaSg = true; }
  }
  const quoted = args.map((a) => "'" + String(a).replace(/'/g, "'\\''") + "'").join(' ');
  return dockerViaSg
    ? execFileSync('sg', ['docker', '-c', 'docker ' + quoted], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    : execFileSync('docker', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}
function sql(query) {
  return dockerExec(['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-At', '-F', '|',
    '-v', 'ON_ERROR_STOP=1'], query).trim();
}
function sqlFile(file) {
  return dockerExec(['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q',
    '-v', 'ON_ERROR_STOP=1'], fs.readFileSync(file, 'utf8'));
}
const sqlVal = (q) => sql(q).split('\n')[0];
const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";

/* Disposable local users. `age` sets the 16+ signup flag (required after 0005). */
const runTag = Date.now().toString(36);
async function newUser(tag, { age = true } = {}) {
  const email = 'gqlocal-' + tag + '-' + runTag + '@example.test';
  const password = 'pw-' + Math.random().toString(36).slice(2) + '-A1';
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: age ? { age_16_confirmed: true } : {},
  });
  if (error) throw new Error('createUser ' + tag + ': ' + error.message);
  return signIn({ email, password, id: data.user.id, tag });
}
async function signIn(u) {
  const c = anon();
  const { error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error('signIn ' + u.tag + ': ' + error.message);
  return Object.assign({}, u, { c });
}
function makeModerator(u) { sql('update public.profiles set role = \'moderator\' where id = ' + lit(u.id) + ';'); }

/* Image fixtures: small JPEG/PNG bytes. jpegWithExif carries GPS + camera tags. */
const FIX = process.env.GQ_FIXTURES || path.join(require('os').tmpdir(), 'gq-social-fixtures');
function fixtures() {
  fs.mkdirSync(FIX, { recursive: true });
  const py = `
import sys
from PIL import Image
from PIL.ExifTags import Base, GPS
img = Image.new('RGB', (64, 48), (200, 80, 40))
exif = Image.Exif()
exif[Base.Make] = 'GQTestCam'
exif[Base.Model] = 'Secret-Model-9'
gps = exif.get_ifd(0x8825)
gps[GPS.GPSLatitudeRef] = 'N'; gps[GPS.GPSLatitude] = (48.0, 8.0, 52.0)
gps[GPS.GPSLongitudeRef] = 'E'; gps[GPS.GPSLongitude] = (17.0, 6.0, 25.0)
img.save(sys.argv[1] + '/exif.jpg', exif=exif)
img.save(sys.argv[1] + '/plain.jpg')
Image.new('RGB', (40, 40), (10, 120, 200)).save(sys.argv[1] + '/plain.png')
`;
  execFileSync('python3', ['-c', py, FIX]);
  return {
    exifJpeg: fs.readFileSync(path.join(FIX, 'exif.jpg')),
    jpeg: fs.readFileSync(path.join(FIX, 'plain.jpg')),
    png: fs.readFileSync(path.join(FIX, 'plain.png')),
  };
}
/* True when bytes still contain EXIF/GPS/camera metadata. */
function hasMetadata(buf) {
  const s = Buffer.from(buf).toString('latin1');
  return s.includes('Exif\0\0') || s.includes('GQTestCam') || s.includes('Secret-Model-9');
}

/* Result bookkeeping. */
const results = { pass: 0, fail: 0, lines: [] };
function section(name) { results.lines.push('\n== ' + name); console.log('\n== ' + name); }
function check(name, ok, detail) {
  const line = (ok ? '  PASS ' : '  FAIL ') + name + (!ok && detail ? '  -> ' + detail : '');
  results.lines.push(line); console.log(line);
  if (ok) results.pass++; else results.fail++;
  return ok;
}
const errText = (r) => (r && r.error ? (r.error.code || '') + ' ' + (r.error.message || '') : '');
function denied(r) {
  /* An RLS refusal is either an error or (for select/update/delete) zero rows. */
  return !!(r && (r.error || (Array.isArray(r.data) && r.data.length === 0) || r.data === null));
}

/* Later migrations build on earlier ones. rollbackFrom(n) rolls back every applied migration >= n,
   newest first, and returns them; reapply(list) applies them again in order (+ schema reload). */
const MIG = path.resolve(__dirname, '..', '..', 'supabase');
const STACK = [
  { n: 9, up: '0009_leaderboard.sql', down: '0009_down.sql', present: "to_regclass('public.leaderboard_entries') is not null" },
  { n: 10, up: '0010_push.sql', down: '0010_down.sql', present: "to_regclass('public.push_subscriptions') is not null" },
  { n: 11, up: '0011_social_extras.sql', down: '0011_down.sql', present: "to_regclass('public.message_reactions') is not null" },
  { n: 12, up: '0012_reminders.sql', down: '0012_down.sql', present: "to_regclass('public.push_reminders') is not null" },
];
function rollbackFrom(n) {
  const done = [];
  for (const m of STACK.slice().reverse()) {
    if (m.n < n) continue;
    if (sqlVal('select ' + m.present) === 't') { sqlFile(path.join(MIG, 'rollback', m.down)); done.unshift(m); }
  }
  sql(`notify pgrst, 'reload schema';`);
  return done;
}
function reapply(list) {
  for (const m of list) sqlFile(path.join(MIG, 'migrations', m.up));
  sql(`notify pgrst, 'reload schema';`);
}

module.exports = { URL_, anon, admin, sql, sqlFile, sqlVal, lit, newUser, signIn, makeModerator, fixtures,
  hasMetadata, section, check, errText, denied, results, runTag, rollbackFrom, reapply };
