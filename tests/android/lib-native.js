'use strict';
/* Fake Capacitor for the Android tests in headless Chrome.

   installFakeCapacitor(page, opts) injects, before any app script, a window.Capacitor that says
   "native Android" and whose Plugins.<Name>.<method>(...) calls are recorded in window.__nativeCalls
   as { plugin, method, args } (functions dropped from args). Each call resolves with
   window.__nativeReturns['<Name>.<method>'] (default {}); a value { __reject: 'msg' } rejects.
   Tests can change window.__nativeReturns at any time with page.eval.
   addListener(event, cb) registers cb; fireNative(page, plugin, event, data) calls them.

   opts: { returns: { 'Plugin.method': value } } */

function fakeSource(opts) {
  const returns = JSON.stringify((opts && opts.returns) || {});
  return `(() => {
    window.__nativeCalls = [];
    window.__nativeListeners = {};
    window.__nativeReturns = ${returns};
    const clean = (a) => { try { return JSON.parse(JSON.stringify(a)); } catch (e) { return String(a); } };
    const cache = {};
    function plugin(name) {
      if (cache[name]) return cache[name];
      cache[name] = new Proxy({}, { get(_, m) {
        if (m === 'then' || typeof m === 'symbol') return undefined;
        return (...args) => {
          window.__nativeCalls.push({ plugin: name, method: m, args: clean(args.filter((a) => typeof a !== 'function')) });
          if (m === 'addListener') {
            const key = name + '.' + args[0];
            (window.__nativeListeners[key] = window.__nativeListeners[key] || []).push(args[1]);
            return Promise.resolve({ remove() {
              window.__nativeListeners[key] = (window.__nativeListeners[key] || []).filter((f) => f !== args[1]);
            } });
          }
          if (m === 'removeAllListeners') {
            Object.keys(window.__nativeListeners).forEach((k) => { if (k.indexOf(name + '.') === 0) delete window.__nativeListeners[k]; });
            return Promise.resolve();
          }
          const r = window.__nativeReturns[name + '.' + m];
          if (r && r.__reject) return Promise.reject(new Error(r.__reject));
          return Promise.resolve(r !== undefined ? clean(r) : {});
        };
      } });
      return cache[name];
    }
    window.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: new Proxy({}, { get: (_, n) => (typeof n === 'string' ? plugin(n) : undefined) }),
    };
  })();`;
}

async function installFakeCapacitor(page, opts) {
  await page.c.send('Page.addScriptToEvaluateOnNewDocument', { source: fakeSource(opts) });
}

/* Calls every listener registered for plugin.event with data; resolves after they settle. */
async function fireNative(page, pluginName, event, data) {
  return page.eval(`(async () => {
    const fns = (window.__nativeListeners[${JSON.stringify(pluginName + '.' + event)}] || []).slice();
    for (const f of fns) await f(${JSON.stringify(data === undefined ? {} : data)});
    return fns.length;
  })()`);
}

/* Recorded calls, optionally filtered: calls(page, 'StatusBar') or calls(page, 'StatusBar', 'setStyle'). */
async function nativeCalls(page, pluginName, method) {
  return page.eval(`(window.__nativeCalls || []).filter((c) => (!${JSON.stringify(pluginName || '')} || c.plugin === ${JSON.stringify(pluginName || '')})
    && (!${JSON.stringify(method || '')} || c.method === ${JSON.stringify(method || '')}))`);
}

async function clearNativeCalls(page) { return page.eval('(window.__nativeCalls = [], true)'); }

/* Spoločný štart testu: server na 8124 (prázdna Community konfigurácia, ak nie je cfgPath),
   headless Chrome s telefónnym rozmerom, voliteľne falošný Capacitor, appka po úvodnom nastavení.
   Vracia { p, b, server, errors, check, done }. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');
const REPO = path.resolve(__dirname, '..', '..');

function counter() {
  const s = { pass: 0, fail: 0 };
  s.check = (name, ok, info) => {
    if (ok) { s.pass++; console.log('  PASS ' + name); }
    else { s.fail++; console.log('  FAIL ' + name + (info !== undefined ? '  -> ' + (typeof info === 'string' ? info : JSON.stringify(info)) : '')); }
  };
  return s;
}

async function startServerOnce(work, cfgPath) {
  if (!cfgPath) {
    cfgPath = path.join(work, 'community-config.empty.js');
    fs.writeFileSync(cfgPath, "window.GYMQUEST_COMMUNITY = { supabaseUrl: '', supabaseAnonKey: '' };\n");
  }
  process.env.GQ_COMMUNITY_CONFIG = cfgPath;
  return startServer(8124, { new: REPO });
}

const OPEN = [];
/* Zatvorí všetky prehliadače otvorené cez openApp (aj po páde testu, inak by na porte
   zostal starý prehliadač a ďalší beh by sa pripojil k nemu). */
function closeAll() { while (OPEN.length) { try { OPEN.pop().killHard(true); } catch (e) {} } }

async function openApp({ name, debugPort, native, returns, work, lang }) {
  work = work || process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-android');
  fs.mkdirSync(work, { recursive: true });
  const b = new Browser(name + '-' + Date.now().toString(36), debugPort, path.join(work, 'profiles'));
  OPEN.push(b);
  const p = await b.launch();
  const errors = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) errors.push(e.entry.text); });
  p.c.on('Runtime.exceptionThrown', (e) => errors.push(String(e.exceptionDetails.exception && e.exceptionDetails.exception.description || e.exceptionDetails.text)));
  await p.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  if (native) await installFakeCapacitor(p, { returns });
  await p.navigate('http://localhost:8124/');
  await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang(${JSON.stringify(lang || 'en')}); return true; })()`);
  return { p, b, errors };
}

module.exports = { installFakeCapacitor, fireNative, nativeCalls, clearNativeCalls, counter, startServerOnce, openApp, closeAll, REPO };
