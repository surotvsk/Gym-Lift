/* GymQuest sync test harness: static server, real Chrome processes with disposable
   profiles (graceful close, hard kill, relaunch), a minimal CDP client, deterministic
   in-page barriers (window.__GQ_TEST__) and an independent cloud observer that uses
   ONLY the disposable test accounts' own credentials (RLS-scoped, no service key).
   No credentials are stored in this file: they are read from GQ_CREDS_DIR at runtime. */
'use strict';
const { spawn, execSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const WIN = process.platform === 'win32';
const CHROME = process.env.GQ_CHROME || (WIN ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : 'google-chrome');
/* Optional: serve this file as /community-config.js (e.g. a local Supabase test stack) without
   touching the repository's community-config.js. */
const CONFIG_OVERRIDE = process.env.GQ_COMMUNITY_CONFIG || '';
/* Safety guard: only these disposable account ids may ever be touched (GQ_TEST_IDS, comma
   separated, required); GQ_PROTECTED_IDS lists accounts that must never be used. */
const idList = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
const ALLOWED_TEST_IDS = new Set(idList(process.env.GQ_TEST_IDS));
const PROTECTED_IDS = new Set(idList(process.env.GQ_PROTECTED_IDS));

function loadCreds(name) {
  const dir = process.env.GQ_CREDS_DIR;
  if (!dir) throw new Error('GQ_CREDS_DIR not set');
  if (ALLOWED_TEST_IDS.size === 0) throw new Error('GQ_TEST_IDS not set');
  const c = JSON.parse(fs.readFileSync(path.join(dir, 'cred-' + name + '.json'), 'utf8').replace(/^\uFEFF/, ''));
  if (!ALLOWED_TEST_IDS.has(c.id) || PROTECTED_IDS.has(c.id)) throw new Error('refusing non-test account');
  return c;
}

/* ---------- static server with switchable root (same origin for old/new builds) ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webm': 'video/webm', '.mp4': 'video/mp4', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
function startServer(port, roots) {
  let current = 'new';
  const requests = [];   // every requested path, in order (tests check what an update downloads)
  const sent = [];       // { path, bytes, range } for every file served
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    let p = decodeURIComponent(u.pathname);
    requests.push(p);
    if (p.endsWith('/')) p += 'index.html';
    const base = path.resolve(roots[current]);
    const fp = CONFIG_OVERRIDE && p === '/community-config.js' ? path.resolve(CONFIG_OVERRIDE) : path.resolve(path.join(base, p));
    if (!fp.startsWith(base) && fp !== path.resolve(CONFIG_OVERRIDE || '\0')) { res.writeHead(403); res.end(); return; }
    fs.readFile(fp, (err, buf) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      const type = TYPES[path.extname(fp)] || 'application/octet-stream';
      const m = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range || ''));
      if (m && Number(m[1]) < buf.length) {   // Range like GitHub Pages (tests measure how much is downloaded)
        const start = Number(m[1]), end = m[2] === '' ? buf.length - 1 : Math.min(Number(m[2]), buf.length - 1);
        sent.push({ path: p, bytes: end - start + 1, range: true });
        res.writeHead(206, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes', 'Content-Range': 'bytes ' + start + '-' + end + '/' + buf.length });
        res.end(buf.subarray(start, end + 1));
        return;
      }
      sent.push({ path: p, bytes: buf.length, range: false });
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(buf);
    });
  });
  return new Promise((resolve) => srv.listen(port, '127.0.0.1', () => resolve({
    requests, sent,
    setRoot(r) { current = r; }, root() { return current; }, close() { return new Promise((r) => srv.close(r)); },
  })));
}

/* ---------- in-page test hooks (installed before any app script) ---------- */
const HOOK_SRC = `(() => {
  /* Simulated storage failure for chosen localStorage keys (configured per tab via sessionStorage). */
  try {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (this === window.localStorage) {
        let fail = [];
        try { fail = JSON.parse(window.sessionStorage.getItem('gq_test_lsfail') || '[]'); } catch (e) {}
        if (fail.some((f) => String(k) === f || (f.endsWith('*') && String(k).indexOf(f.slice(0, -1)) === 0))) {
          const e = new Error('QuotaExceededError (injected)'); e.name = 'QuotaExceededError'; throw e;
        }
      }
      return orig.call(this, k, v);
    };
  } catch (e) {}
  const arms = {}, fails = {}, counts = {}, log = [];
  window.__GQ_TEST__ = {
    log, counts, reloading: false,
    hook(name, data) {
      counts[name] = (counts[name] || 0) + 1; log.push(name);
      if (name === 'ws:beforeReload') this.reloading = true;
      const s = data ? JSON.stringify(data) : '';
      const f = fails[name];
      if (f && (!f.match || s.indexOf(f.match) >= 0)) { if (f.times && --f.times <= 0) delete fails[name]; return Promise.reject(new Error('injected:' + name)); }
      const a = arms[name];
      if (a && (!a.match || s.indexOf(a.match) >= 0)) { delete arms[name]; a.hit(data || true); return a.gate; }
      return undefined;
    },
    arm(name, match) { let open, hit; const gate = new Promise((r) => { open = r; }); const reached = new Promise((r) => { hit = r; }); arms[name] = { gate, hit, match }; this['_o_' + name] = open; this['_r_' + name] = reached; return true; },
    reached(name) { return this['_r_' + name]; },
    release(name) { const o = this['_o_' + name]; if (o) o(); return !!o; },
    fail(name, times, match) { fails[name] = { times: times || 0, match: match || null }; return true; },
    clearFail(name) { delete fails[name]; return true; },
  };
  /* Barriers / failures requested for the NEXT page load (survive app-initiated reloads). */
  try {
    const pre = JSON.parse(sessionStorage.getItem('gq_test_arm') || '[]');
    sessionStorage.removeItem('gq_test_arm');
    pre.forEach((a) => window.__GQ_TEST__.arm(a.name, a.match));
    const pf = JSON.parse(sessionStorage.getItem('gq_test_fail') || '[]');
    sessionStorage.removeItem('gq_test_fail');
    pf.forEach((f) => window.__GQ_TEST__.fail(f.name, f.times, f.match));
  } catch (e) {}
})();`;

/* ---------- CDP ---------- */
function cdpConnect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const listeners = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== undefined) {
        const p = pending.get(m.id);
        if (p) { pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
      } else if (m.method) {
        (listeners.get(m.method) || []).slice().forEach((fn) => fn(m.params));
      }
    });
    ws.addEventListener('close', () => { for (const p of pending.values()) p.reject(new Error('cdp closed')); pending.clear(); });
    ws.addEventListener('error', (e) => reject(e));
    ws.addEventListener('open', () => resolve({
      send(method, params, timeoutMs) {
        return new Promise((res, rej) => {
          const i = ++id;
          const t = setTimeout(() => { pending.delete(i); rej(new Error('timeout ' + method)); }, timeoutMs || 120000);
          pending.set(i, { resolve: (v) => { clearTimeout(t); res(v); }, reject: (e) => { clearTimeout(t); rej(e); } });
          ws.send(JSON.stringify({ id: i, method, params: params || {} }));
        });
      },
      on(method, fn) { if (!listeners.has(method)) listeners.set(method, []); listeners.get(method).push(fn); },
      off(method, fn) { const a = listeners.get(method) || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
      close() { try { ws.close(); } catch (e) {} },
    }));
  });
}
async function waitFor(fn, ms, what) {
  const end = Date.now() + (ms || 30000);
  let last;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch (e) { last = e; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('waitFor timeout: ' + (what || '') + (last ? ' (' + last.message + ')' : ''));
}

class Page {
  constructor(browser, client) {
    this.browser = browser; this.c = client; this.loads = 0; this.errors = []; this.console = [];
    client.on('Page.loadEventFired', () => { this.loads++; });
    client.on('Runtime.exceptionThrown', (p) => { this.errors.push((p.exceptionDetails && (p.exceptionDetails.exception && p.exceptionDetails.exception.description || p.exceptionDetails.text)) || 'exception'); });
    client.on('Runtime.consoleAPICalled', (p) => {
      const text = (p.args || []).map((a) => (a.value !== undefined ? String(a.value) : (a.description || ''))).join(' ');
      this.console.push(p.type + ': ' + text);
    });
  }
  async init() {
    await this.c.send('Page.enable');
    await this.c.send('Runtime.enable');
    await this.c.send('Network.enable');
    await this.c.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK_SRC });
  }
  async eval(expr, timeoutMs) {
    const r = await this.c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }, timeoutMs || 180000);
    if (r.exceptionDetails) throw new Error('eval: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
    return r.result.value;
  }
  async navigate(url, opts) {
    const before = this.loads;
    await this.c.send('Page.navigate', { url });
    await waitFor(() => this.loads > before, 60000, 'load ' + url);
    if (opts && opts.noReady) return null;
    return this.ready();
  }
  /* A tab that could not get the single-tab lock shows the blocking overlay and never starts the app. */
  async blocked() {
    return this.eval(`!!document.getElementById('app-tab-block') && !syncStartupPromise && typeof wsSlot !== 'undefined' && wsSlot === null`);
  }
  async reload() {
    const before = this.loads;
    await this.c.send('Page.reload', { ignoreCache: false });
    await waitFor(() => this.loads > before, 60000, 'reload');
    return this.ready();
  }
  /* App is ready when startup finished and the sync queue is drained; follows
     app-initiated reloads (workspace switches) deterministically via the
     'ws:beforeReload' hook flag. */
  async ready(ms) {
    const end = Date.now() + (ms || 120000);
    for (;;) {
      if (Date.now() > end) throw new Error('ready timeout');
      const loadsBefore = this.loads;
      let v = null;
      try {
        v = await this.eval(`(async () => {
          if (typeof syncStartupPromise === 'undefined' || !syncStartupPromise) return { boot: false };
          await syncStartupPromise;
          for (let i = 0; i < 3; i++) { await syncChain; await Promise.resolve(); }
          return { boot: true, reloading: !!(window.__GQ_TEST__ && window.__GQ_TEST__.reloading), slot: wsSlot && wsSlot.id, owner: wsSlot && wsSlot.owner };
        })()`, 120000);
      } catch (e) { v = null; }
      if (v && v.boot && !v.reloading && this.loads === loadsBefore) return v;
      if (v && v.reloading) await waitFor(() => this.loads > loadsBefore, 60000, 'app reload');
      else await new Promise((r) => setTimeout(r, 150));
    }
  }
  async offline(on) {
    await this.c.send('Network.emulateNetworkConditions', { offline: !!on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  }
}

class Browser {
  constructor(name, port, profilesDir) { this.name = name; this.port = port; this.dir = path.join(profilesDir, name); this.proc = null; this.page = null; }
  async launch() {
    fs.mkdirSync(this.dir, { recursive: true });
    const args = ['--headless=new', '--user-data-dir=' + this.dir, '--remote-debugging-port=' + this.port, '--no-first-run',
      '--no-default-browser-check', '--disable-features=Translate,MediaRouter', '--password-store=basic', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', 'about:blank'];
    this.proc = spawn(CHROME, args, { stdio: 'ignore', detached: !WIN });   // own process group on POSIX (killHard)
    this.exited = new Promise((r) => this.proc.once('exit', r));
    const list = await waitFor(async () => {
      const l = await (await fetch('http://127.0.0.1:' + this.port + '/json/list')).json();
      return l.find((t) => t.type === 'page') ? l : null;
    }, 30000, 'devtools ' + this.name);
    const target = list.find((t) => t.type === 'page');
    const client = await cdpConnect(target.webSocketDebuggerUrl);
    this.page = new Page(this, client);
    await this.page.init();
    return this.page;
  }
  /* A second tab in the same browser profile (same origin storage, same session). */
  async newTab() {
    const v = await (await fetch('http://127.0.0.1:' + this.port + '/json/version')).json();
    const b = await cdpConnect(v.webSocketDebuggerUrl);
    const { targetId } = await b.send('Target.createTarget', { url: 'about:blank' });
    b.close();
    const list = await waitFor(async () => {
      const l = await (await fetch('http://127.0.0.1:' + this.port + '/json/list')).json();
      return l.find((t) => t.id === targetId) ? l : null;
    }, 30000, 'new tab');
    const client = await cdpConnect(list.find((t) => t.id === targetId).webSocketDebuggerUrl);
    const p = new Page(this, client);
    await p.init();
    return p;
  }
  /* Normal browser exit (flushes storage like a user closing the app). */
  async closeGraceful() {
    const v = await (await fetch('http://127.0.0.1:' + this.port + '/json/version')).json();
    const b = await cdpConnect(v.webSocketDebuggerUrl);
    try { await b.send('Browser.close', {}, 10000); } catch (e) {}
    await Promise.race([this.exited, new Promise((r) => setTimeout(r, 15000))]);
    this.killHard(true);
  }
  /* Process kill (simulated crash / power loss of the browser process). */
  killHard(quiet) {
    if (!this.proc) return;
    try {
      if (WIN) execSync('taskkill /PID ' + this.proc.pid + ' /T /F', { stdio: 'ignore' });
      else process.kill(-this.proc.pid, 'SIGKILL');
    } catch (e) { if (!quiet) {} }
    this.proc = null;
  }
  async restart(graceful) {
    if (graceful) await this.closeGraceful(); else { this.killHard(); await Promise.race([this.exited, new Promise((r) => setTimeout(r, 10000))]); }
    return this.launch();
  }
}

/* ---------- independent cloud observer (test accounts only, own JWT) ---------- */
function readPublicConfig(repoDir) {
  const src = fs.readFileSync(CONFIG_OVERRIDE || path.join(repoDir, 'community-config.js'), 'utf8');
  return { url: /supabaseUrl:\s*'([^']+)'/.exec(src)[1], anon: /supabaseAnonKey:\s*'([^']+)'/.exec(src)[1] };
}
class Observer {
  constructor(cfg, creds) { this.cfg = cfg; this.creds = creds; this.jwt = null; }
  async login() {
    if (!ALLOWED_TEST_IDS.has(this.creds.id)) throw new Error('refusing');
    const r = await fetch(this.cfg.url + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: this.cfg.anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: this.creds.email, password: this.creds.password }) });
    const j = await r.json();
    if (!j.access_token || !j.user || j.user.id !== this.creds.id) throw new Error('observer login failed');
    this.jwt = j.access_token;
    return this;
  }
  h(extra) { return Object.assign({ apikey: this.cfg.anon, Authorization: 'Bearer ' + this.jwt }, extra || {}); }
  async row(uid) {
    const r = await fetch(this.cfg.url + '/rest/v1/backups?select=revision,payload,device_id&user_id=eq.' + (uid || this.creds.id), { headers: this.h() });
    const j = await r.json();
    return Array.isArray(j) && j.length ? j[0] : null;
  }
  /* Uchované verzie zálohy (server drží najnovších 5): revízia + počet tréningov / aktivít. */
  async versions(uid) {
    const r = await fetch(this.cfg.url + '/rest/v1/backup_versions?select=revision,payload&order=revision.desc&user_id=eq.' + (uid || this.creds.id), { headers: this.h() });
    const j = await r.json();
    return (Array.isArray(j) ? j : []).map((v) => ({ rev: Number(v.revision), hist: ((v.payload || {}).history || []).length, acts: ((v.payload || {}).activities || []).length }));
  }
  async listAll(prefix) {
    const out = [];
    const walk = async (p, depth) => {
      const r = await fetch(this.cfg.url + '/storage/v1/object/list/backups', { method: 'POST', headers: this.h({ 'Content-Type': 'application/json' }), body: JSON.stringify({ prefix: p, limit: 1000, offset: 0 }) });
      const j = await r.json();
      for (const f of Array.isArray(j) ? j : []) {
        if (f.id) out.push(p + '/' + f.name);
        else if (depth < 4) await walk(p + '/' + f.name, depth + 1);
      }
    };
    await walk(prefix || this.creds.id, 0);
    return out;
  }
  /* Wipe ONLY this disposable account's synthetic backup data. */
  async reset() {
    if (!ALLOWED_TEST_IDS.has(this.creds.id) || PROTECTED_IDS.has(this.creds.id)) throw new Error('refusing');
    const files = await this.listAll(this.creds.id);
    for (let i = 0; i < files.length; i += 100) {
      await fetch(this.cfg.url + '/storage/v1/object/backups', { method: 'DELETE', headers: this.h({ 'Content-Type': 'application/json' }), body: JSON.stringify({ prefixes: files.slice(i, i + 100) }) });
    }
    await fetch(this.cfg.url + '/rest/v1/backup_versions?user_id=eq.' + this.creds.id, { method: 'DELETE', headers: this.h() });
    await fetch(this.cfg.url + '/rest/v1/backups?user_id=eq.' + this.creds.id, { method: 'DELETE', headers: this.h() });
    const left = await this.row();
    const leftFiles = await this.listAll(this.creds.id);
    if (left || leftFiles.length) throw new Error('reset incomplete');
  }
}

module.exports = { startServer, Browser, Observer, loadCreds, readPublicConfig, waitFor, cdpConnect, ALLOWED_TEST_IDS };
