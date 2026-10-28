/* GymQuest offline-first sync verification suite.
   Usage (PowerShell):
     $env:GQ_CREDS_DIR = '<dir with cred-a.json / cred-b.json>'   # outside the repo
     $env:GQ_OLD_ROOT  = '<export of the previous release>'        # for migration tests
     $env:GQ_WORK      = '<scratch dir for disposable Chrome profiles>'
     node tests/sync/run.js [scenario-name-filter]
   Uses ONLY the two disposable test accounts. Each scenario resets their synthetic
   backup data first. Results are written to GQ_WORK/results.json (no secrets). */
'use strict';
const fs = require('fs');
const path = require('path');
const { startServer, Browser, Observer, loadCreds, readPublicConfig, waitFor } = require('./lib');
const HELPERS = require('./helpers');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
/* GQ_BASE runs the scenarios against a deployed frontend (e.g. the production URL) instead of
   the local server. Scenarios that need to swap builds (migration, update path) only run locally. */
const BASE = process.env.GQ_BASE || 'http://localhost:' + PORT + '/';
const REMOTE = !!process.env.GQ_BASE;
const WORK = process.env.GQ_WORK || path.join(require('os').tmpdir(), 'gq-sync-work');
const PROFILES = path.join(WORK, 'profiles');
let nextPort = 9520;
/* Adresy servera, ktoré „blockSupabase“ zablokuje: hostovaný projekt aj lokálny stack (doplní sa z konfigurácie). */
const SB_BLOCK = ['*supabase.co*'];

const results = [];
let current = null;
function check(name, cond, detail) {
  const ok = !!cond;
  current.checks.push({ name, ok, detail: ok ? undefined : detail });
  console.log((ok ? '  PASS ' : '  FAIL ') + name + (ok ? '' : '  -> ' + String(JSON.stringify(detail)).slice(0, 600)));
  return ok;
}
const browsers = [];
async function device(name) {
  const b = new Browser(name + '-' + Date.now().toString(36), nextPort++, PROFILES);
  browsers.push(b);
  const p = await b.launch();
  await p.navigate(BASE);
  await p.eval(HELPERS);
  return { b, p };
}
async function R(p) { const v = await p.ready(); await p.eval(HELPERS); return v; }
async function snap(p) { return p.eval('__gq.snap()'); }
/* Full browser restart with the same profile (graceful = normal exit, else process kill). */
/* Offline reopen needs the service worker installed (precache complete) first. */
async function ensureSW(p) {
  await p.eval(`(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; })()`, 120000);
  if (!(await p.eval('!!navigator.serviceWorker.controller'))) { await p.reload(); await p.eval(HELPERS); }
  return p.eval('!!navigator.serviceWorker.controller');
}
async function awaitSignOut(p) { try { await p.eval('window.__so', 120000); } catch (e) { /* reloaded */ } await R(p); }
async function relaunch(d, graceful, opts) {
  opts = opts || {};
  if (opts.offline && graceful) await ensureSW(d.p);
  d.p = await d.b.restart(graceful);
  if (opts.offline) await d.p.offline(true);
  if (opts.bypassSW) await d.p.c.send('Network.setBypassServiceWorker', { bypass: true });
  if (opts.blockSupabase) await d.p.c.send('Network.setBlockedURLs', { urls: SB_BLOCK });
  if (opts.noWait) { const before = d.p.loads; await d.p.c.send('Page.navigate', { url: BASE }); await waitFor(() => d.p.loads > before, 60000, 'load'); return d.p; }
  await d.p.navigate(BASE); await d.p.eval(HELPERS); return d.p;
}
async function signInRaw(d, creds) {
  try { await d.p.eval(`__gq.signIn(${JSON.stringify(creds.email)}, ${JSON.stringify(creds.password)})`, 120000); } catch (e) { /* page reloaded into the account workspace */ }
}
async function signIn(d, creds) { await signInRaw(d, creds); await R(d.p); }
async function signOut(d) { try { await d.p.eval('__gq.signOut()', 120000); } catch (e) {} await R(d.p); }
async function syncNow(p) { await p.eval('__gq.syncNow()'); return snap(p); }
async function preArm(p, list) { await p.eval(`sessionStorage.setItem('gq_test_arm', ${JSON.stringify(JSON.stringify(list.map((n) => (typeof n === 'string' ? { name: n } : n))))}), true`); }
async function lsFail(p, keys) { await p.eval(`sessionStorage.setItem('gq_test_lsfail', ${JSON.stringify(JSON.stringify(keys))}), true`); }
async function waitReached(p, name, ms) {
  try {
    return await waitFor(async () => {
      try { return await p.eval(`(async () => { const t = window.__GQ_TEST__; if (!t || !t.reached('${name}')) return false; await t.reached('${name}'); return true; })()`, 20000); }
      catch (e) { return false; }
    }, ms || 120000, 'reached ' + name);
  } catch (e) {
    let diag = null;
    try { diag = await p.eval(`({ log: (__GQ_TEST__.log || []).slice(-25), slot: wsSlot && wsSlot.id, err: syncLastError, status: syncStatusKey(), meta: wsSlot ? syncMetaRead() : null })`, 10000); } catch (e2) { diag = String(e2); }
    throw new Error(e.message + ' diag=' + JSON.stringify(diag).slice(0, 1500));
  }
}
async function release(p, name) { return p.eval(`__GQ_TEST__.release('${name}')`); }
async function counts(p) { return p.eval('Object.assign({}, __GQ_TEST__.counts)'); }
const cloudHist = (row) => (row && row.payload && row.payload.history ? row.payload.history.map((h) => h.id).sort() : []);
const cloudMedia = (row) => {
  const m = (row && row.payload && row.payload.media) || {};
  return [].concat((m.progress || []).map((e) => 'p:' + e.id), (m.personal || []).map((e) => 'm:' + e.id)).sort();
};
/* Every object the cloud manifest references must exist in storage. */
async function manifestRefsExist(obs, row) {
  const files = new Set(await obs.listAll(obs.creds.id));
  const m = (row && row.payload && row.payload.media) || {};
  const refs = [];
  for (const e of [].concat(m.progress || [], m.personal || [])) { if (e.ref) refs.push(e.ref); if (e.thumbRef) refs.push(e.thumbRef); if (e.posterRef) refs.push(e.posterRef); }
  const missing = refs.filter((r) => !files.has(obs.creds.id + '/' + r));
  return { ok: missing.length === 0, missing, refs: refs.length };
}
/* Account A with synthetic data on a first device (all four sections + both media kinds). */
async function seedA(ctx, name) {
  const d = await device(name || 'seedA');
  await signIn(d, ctx.A);
  await d.p.eval(`(async () => { __gq.addWorkout('w1', '2026-09-01'); __gq.addWorkout('w2', '2026-09-03'); __gq.addCustomPlan('tp1');
    __gq.addMeasurement('ms1', 81); await __gq.addProgress('p1', 'one'); await __gq.addPersonal('m1', 'one'); return true; })()`);
  const s = await syncNow(d.p);
  return { d, s };
}

const scenarios = [];
function scenario(name, fn) { scenarios.push({ name, fn }); }

/* ============================ scenarios ============================ */

scenario('smoke: new build loads cleanly in a fresh profile', async (ctx) => {
  const d = await device('smoke');
  const s = await snap(d.p);
  check('guest slot active on fresh profile', s.slot === 'legacy' && s.owner === null, s);
  check('registry created', s.registry && s.registry.v === 1 && s.registry.active === 'legacy', s.registry);
  check('no page exceptions', d.p.errors.length === 0, d.p.errors);
  const warn = d.p.console.filter((l) => /chýbajúce preklady|missing/i.test(l));
  check('no missing-translation warnings', warn.length === 0, warn);
  check('local-save line visible and separate from cloud line', s.localLine.length > 0 && s.cloudLine.length > 0 && s.localLine !== s.cloudLine, s);
  check('no sync status chip in the header (status lives in Settings)', s.chipHidden === undefined, s.chipHidden);
});

scenario('D1+auto-load: fresh device with setup+reload before sign-in loads every section and media automatically', async (ctx) => {
  const { d: d1, s: s1 } = await seedA(ctx, 'd1');
  const row = await ctx.obsA.row();
  check('device 1 uploaded (rev >= 1, 2 workouts, 2 media)', row && row.revision >= 1 && cloudHist(row).join() === 'w1,w2' && cloudMedia(row).join() === 'm:m1,p:p1', { rev: row && row.revision, h: cloudHist(row), m: cloudMedia(row) });
  const refs = await manifestRefsExist(ctx.obsA, row);
  check('every manifest reference exists in storage', refs.ok && refs.refs >= 3, refs);
  check('device 1 status synced; local and cloud lines differ', s1.status === 'sync.st.synced' && s1.localLine !== s1.cloudLine, s1.status);
  const d2 = await device('d2');
  await d2.p.eval('confirmSetup(), true');     // first-run setup writes the weekly-goal snapshot
  await d2.p.reload(); await d2.p.eval(HELPERS);
  const g = await snap(d2.p);
  check('fresh device now has a goal snapshot (the D1 trigger)', g.slot === 'legacy' && g.hist.length === 0, g);
  await signIn(d2, ctx.A);
  const s2 = await snap(d2.p);
  check('no link prompt / no conflict for an untouched device', !s2.link && !s2.meta.conflict, { link: s2.link, conflict: s2.meta && s2.meta.conflict });
  check('account workspace created and active', s2.owner === ctx.A.id && s2.slot !== 'legacy', s2.slot);
  check('calendar/workouts loaded', s2.hist.join() === 'w1,w2', s2.hist);
  check('custom plan + exercise loaded', s2.plans.indexOf('tp1') >= 0, s2.plans);
  check('motivation (achievements) of device 1 all present', s1.achIds.every((k) => s2.achIds.indexOf(k) >= 0) && g.achievements < s1.achievements, { d1: s1.achIds, d2: s2.achIds, fresh: g.achievements });
  check('measurements loaded', s2.meas === 1, s2.meas);
  check('progress + personal media loaded byte-identical', s2.media['p:p1'] === s1.media['p:p1'] && s2.media['m:m1'] === s1.media['m:m1'] && !!s2.media['p:p1'], { a: s1.media, b: s2.media });
  check('device 2 status synced, not dirty', s2.status === 'sync.st.synced' && s2.dirty === false, s2.status);
  check('loading did not upload (cloud revision unchanged)', (await ctx.obsA.row()).revision === row.revision);
  const ls = await d2.p.eval('__gq.lsKeys()');
  check('D8: no full-state copies in localStorage', !ls.gymquest_cloud_local_sig && !ls.gymquest_restore_snapshot && (ls['gymquest_sync@' + s2.slot] || 0) < 6000, ls);
  check('no page exceptions', d1.p.errors.length === 0 && d2.p.errors.length === 0, d1.p.errors.concat(d2.p.errors));
  await relaunch(d2, true);
  const k = await counts(d2.p);
  const s3 = await snap(d2.p);
  check('restart after a load: journal settled, nothing rolled back or re-downloaded', s3.journal === 0 && !k['apply:download'] && !k['apply:journaled']
    && s3.hist.join() === 'w1,w2' && s3.media['p:p1'] === s1.media['p:p1'] && s3.media['m:m1'] === s1.media['m:m1'] && !s3.notice, { k, j: s3.journal, media: s3.media });
});

scenario('D2: failed media upload stays protected (restart, newer cloud) and never publishes a dangling reference', async (ctx) => {
  const { d: d1 } = await seedA(ctx, 'd1');
  await d1.p.eval(`__GQ_TEST__.fail('upload:object', 0, 'p2'), true`);
  await d1.p.eval(`__gq.addProgress('p2', 'two')`);
  const a = await syncNow(d1.p);
  const p2hash = a.media['p:p2'];
  check('failed item recorded as unsynced (dirty)', a.meta.mediaFailed.indexOf('p:p2') >= 0 && a.dirty === true, a.meta);
  check('status not "synced"', a.status !== 'sync.st.synced', a.status);
  const row = await ctx.obsA.row();
  check('published row does not reference the failed item', cloudMedia(row).indexOf('p:p2') < 0, cloudMedia(row));
  check('all published references exist', (await manifestRefsExist(ctx.obsA, row)).ok);
  const d2 = await device('d2');
  await signIn(d2, ctx.A);
  const b = await snap(d2.p);
  check('another device can still load the account', b.hist.join() === 'w1,w2' && !!b.media['p:p1'] && b.lastError === null, b);
  await relaunch(d1, true, { offline: true });            // full restart, offline: no chance to upload
  const c = await snap(d1.p);
  check('after full restart: still unsynced + media intact', c.dirty === true && c.meta.mediaFailed.indexOf('p:p2') >= 0 && c.media['p:p2'] === p2hash, c.meta);
  await d2.p.eval(`__gq.addWorkout('w-d2', '2026-09-05')`);
  await syncNow(d2.p);
  const rowB = await ctx.obsA.row();
  check('device 2 published a newer revision', rowB.revision > row.revision, rowB.revision);
  await d1.p.offline(false);
  await d1.p.eval(`__GQ_TEST__.fail('upload:object', 0, 'p2'), true`);
  const e = await syncNow(d1.p);
  check('newer cloud did NOT overwrite unsynced media: conflict instead', !!e.meta.conflict && e.media['p:p2'] === p2hash && e.hist.indexOf('w-d2') < 0, { conflict: e.meta.conflict, hist: e.hist });
  check('cloud untouched while conflicted', (await ctx.obsA.row()).revision === rowB.revision);
  await d1.p.eval(`__GQ_TEST__.clearFail('upload:object'), true`);
  await d1.p.eval(`__gq.click('keep-device') || (syncResolveConflict('device'), true)`);
  const f = await syncNow(d1.p);
  const rowF = await ctx.obsA.row();
  check('keep-device uploaded p2 and cleared conflict', !f.meta.conflict && cloudMedia(rowF).indexOf('p:p2') >= 0 && f.meta.mediaFailed.length === 0, { m: cloudMedia(rowF), meta: f.meta });
  check('cloud-side copy saved before overwriting', f.recovery.some((r) => r.kind === 'cloud-copy' && r.hist === 3), f.recovery);
  check('all references exist after recovery', (await manifestRefsExist(ctx.obsA, rowF)).ok);
});

scenario('D3: restart with pending edits auto-syncs; unchanged restart downloads nothing', async (ctx) => {
  const { d: d1 } = await seedA(ctx, 'd1');
  const rev0 = (await ctx.obsA.row()).revision;
  await d1.p.offline(true);
  await d1.p.eval(`__gq.addWorkout('w-off', '2026-09-07')`);
  const a = await snap(d1.p);
  check('offline edit saved locally and pending', a.hist.indexOf('w-off') >= 0 && a.dirty && /offline/i.test(a.status), a.status);
  await relaunch(d1, true, { offline: true });
  const b = await snap(d1.p);
  check('pending edit survived full restart', b.hist.indexOf('w-off') >= 0 && b.dirty === true, b);
  await d1.p.offline(false);
  await d1.p.eval(`window.dispatchEvent(new Event('online')), true`);
  const c = await syncNow(d1.p);
  const row = await ctx.obsA.row();
  check('reconnect uploaded automatically without a conflict', cloudHist(row).indexOf('w-off') >= 0 && !c.meta.conflict && c.status === 'sync.st.synced', { h: cloudHist(row), st: c.status });
  check('exactly one new revision', row.revision === rev0 + 1, { rev0, rev: row.revision });
  await relaunch(d1, true);
  const k = await counts(d1.p);
  const s = await snap(d1.p);
  check('unchanged restart: no download/apply', !k['apply:download'] && !k['apply:journaled'], k);
  check('unchanged restart: no upload', (await ctx.obsA.row()).revision === row.revision && s.status === 'sync.st.synced', s.status);
});

scenario('offline: reopen offline after online preparation, save a workout, survive restart, reconnect', async (ctx) => {
  const { d: d1 } = await seedA(ctx, 'd1');
  check('service worker installed and controlling', await ensureSW(d1.p));
  await relaunch(d1, true, { offline: true });
  const a = await snap(d1.p);
  check('app opened offline from cache with account data', a.hist.join() === 'w1,w2' && a.owner === ctx.A.id, a);
  await d1.p.eval(`(() => { startWorkoutNow(); return true; })()`).catch(() => {});
  await d1.p.eval(`__gq.addWorkout('w-offline', '2026-09-08')`);
  const b = await snap(d1.p);
  check('workout saved locally while offline; local line says saved', b.hist.indexOf('w-offline') >= 0 && b.localLine.length > 0 && !b.storageWarning, b.localLine);
  check('cloud line reports offline pending (not synced)', b.status === 'sync.st.offlinePending', b.status);
  await relaunch(d1, true, { offline: true });
  const c = await snap(d1.p);
  check('survived full restart offline', c.hist.indexOf('w-offline') >= 0 && c.dirty, c.hist);
  await d1.p.offline(false);
  await d1.p.eval(`window.dispatchEvent(new Event('online')), true`);
  const e = await syncNow(d1.p);
  check('reconnected and synced', cloudHist(await ctx.obsA.row()).indexOf('w-offline') >= 0 && e.status === 'sync.st.synced', e.status);
});

scenario('D4: conflict dismissal persists and blocks uploads/pulls; both sides recoverable', async (ctx) => {
  const { d: d1 } = await seedA(ctx, 'd1');
  const d2 = await device('d2');
  await signIn(d2, ctx.A);
  await d1.p.eval(`__gq.addWorkout('w-d1', '2026-09-10')`); await syncNow(d1.p);
  await d2.p.eval(`__gq.addWorkout('w-d2', '2026-09-11')`);
  const a = await syncNow(d2.p);
  check('divergent edits produce a conflict dialog', !!a.meta.conflict && a.syncModal, { c: a.meta.conflict, m: a.syncModal });
  await d2.p.eval(`__gq.click('later')`);
  const rev = (await ctx.obsA.row()).revision;
  await d2.p.eval(`__gq.addWorkout('w-d2b', '2026-09-12')`);
  const b = await syncNow(d2.p);
  check('after dismissal: no upload', (await ctx.obsA.row()).revision === rev);
  check('after dismissal: no pull, local edits kept', b.hist.indexOf('w-d1') < 0 && b.hist.indexOf('w-d2b') >= 0 && !!b.meta.conflict, b.hist);
  await relaunch(d2, true);
  const c = await snap(d2.p);
  check('conflict persists across full restart', !!c.meta.conflict && c.status === 'sync.st.conflict', c.status);
  check('cloud still untouched after restart', (await ctx.obsA.row()).revision === rev);
  await d2.p.eval(`(__gq.click('keep-cloud') || (syncResolveConflict('cloud'), true))`);
  const e = await syncNow(d2.p);
  check('keep-account applied account data', e.hist.indexOf('w-d1') >= 0 && e.hist.indexOf('w-d2') < 0 && !e.meta.conflict, e.hist);
  check('copies of BOTH sides saved', e.recovery.some((r) => r.kind === 'device-copy' && r.hist === 4) && e.recovery.some((r) => r.kind === 'cloud-copy'), e.recovery);
  const dev = e.recovery.find((r) => r.kind === 'device-copy' && r.hist === 4);
  await d2.p.eval(`syncRestoreRecovery(${JSON.stringify(dev.id)}).then(() => syncChain)`);
  const f = await syncNow(d2.p);
  const row = await ctx.obsA.row();
  check('device copy restored and synced to account', f.hist.indexOf('w-d2b') >= 0 && cloudHist(row).indexOf('w-d2b') >= 0 && !f.meta.conflict, { local: f.hist, cloud: cloudHist(row) });
});

scenario('D5: account isolation on sign-out/switch; pending edits kept per account', async (ctx) => {
  const { d: d1 } = await seedA(ctx, 'd1');
  await d1.p.eval(`__GQ_TEST__.fail('upload:beforeRpc'), true`);
  await d1.p.eval(`__gq.addWorkout('w-pend', '2026-09-13')`);
  const a = await syncNow(d1.p);
  check('A has a pending (unsynced) edit', a.dirty && a.hist.indexOf('w-pend') >= 0, a.status);
  await signOut(d1);
  const g = await snap(d1.p);
  check('after sign-out: guest workspace, none of A data visible', g.owner === null && g.hist.length === 0 && Object.keys(g.media).length === 0, g);
  await signIn(d1, ctx.B);
  const b = await snap(d1.p);
  check('B workspace is empty (A data never shown as B)', b.owner === ctx.B.id && b.hist.length === 0 && Object.keys(b.media).length === 0 && b.mediaDb !== a.mediaDb, b);
  check('B cloud untouched (no upload of empty/A data)', (await ctx.obsB.row()) === null && (await ctx.obsB.listAll()).length === 0);
  await d1.p.eval(`__gq.addWorkout('w-B1', '2026-09-14')`);
  await syncNow(d1.p);
  const rowB = await ctx.obsB.row();
  check('B cloud contains only B data', cloudHist(rowB).join() === 'w-B1' && cloudMedia(rowB).length === 0, cloudHist(rowB));
  await signOut(d1);
  await signIn(d1, ctx.A);
  const c = await snap(d1.p);
  check('A workspace restored with its pending edit', c.owner === ctx.A.id && c.hist.indexOf('w-pend') >= 0 && c.hist.indexOf('w-B1') < 0, c.hist);
  const c2 = await syncNow(d1.p);
  const rowA = await ctx.obsA.row();
  check('A pending edit synced after switching back', cloudHist(rowA).indexOf('w-pend') >= 0 && cloudHist(rowA).indexOf('w-B1') < 0 && c2.status === 'sync.st.synced', cloudHist(rowA));
  check('B cloud still has no A data', cloudHist(await ctx.obsB.row()).join() === 'w-B1');
});

scenario('safety #2a: account switch while an upload is in flight (before RPC, during media upload)', async (ctx) => {
  const { d: d1 } = await seedA(ctx, 'd1');
  for (const point of ['upload:beforeRpc', 'upload:object']) {
    const rev0 = (await ctx.obsA.row()).revision;
    await d1.p.eval(`__GQ_TEST__.arm('${point}'), true`);
    if (point === 'upload:object') await d1.p.eval(`__gq.addProgress('px', 'x')`); else await d1.p.eval(`__gq.addWorkout('w-x', '2026-09-15')`);
    await d1.p.eval(`(syncKick('test'), true)`);
    await waitReached(d1.p, point);
    await d1.p.eval(`(window.__so = communitySignOut(), true)`);
    const mid = await d1.p.eval(`(async () => { const u = await syncSessionUser(); return { uid: u && u.id, stopping: syncStopping }; })()`);
    check(point + ': sign-out waits for the in-flight task (session unchanged, queue stopping)', mid.uid === ctx.A.id && mid.stopping === true, mid);
    await release(d1.p, point);
    await awaitSignOut(d1.p);
    const g = await snap(d1.p);
    check(point + ': now in guest workspace without A data', g.owner === null && g.hist.length === 0, g.slot);
    const row = await ctx.obsA.row();
    check(point + ': aborted upload published nothing', row.revision === rev0, row.revision);
    if (point === 'upload:object') check(point + ': no media object uploaded after stop', !(await ctx.obsA.listAll()).some((f) => f.indexOf('/px/') >= 0));
    await signIn(d1, ctx.B);
    check(point + ': B cloud untouched', (await ctx.obsB.row()) === null && (await ctx.obsB.listAll()).length === 0);
    await signOut(d1);
    await signIn(d1, ctx.A);
    const back = await snap(d1.p);
    check(point + ': A pending edit preserved in A workspace', point === 'upload:object' ? !!back.media['p:px'] : back.hist.indexOf('w-x') >= 0, back.hist);
    await syncNow(d1.p);
  }
  const row = await ctx.obsA.row();
  check('both pending edits synced later to A only', cloudHist(row).indexOf('w-x') >= 0 && cloudMedia(row).indexOf('p:px') >= 0, { h: cloudHist(row), m: cloudMedia(row) });
});

scenario('safety #2b: account switch during an in-flight restore (download / after media commit), progress + personal media', async (ctx) => {
  const { d: d0, s: s0 } = await seedA(ctx, 'd0');
  const rev = (await ctx.obsA.row()).revision;
  for (const point of ['apply:download', 'apply:mediaCommitted']) {
    const d1 = await device('d1-' + point.replace(':', ''));
    await preArm(d1.p, [point]);
    // the barrier is armed for the page that loads after sign-in creates A's workspace
    const before = d1.p.loads;
    await signInRaw(d1, ctx.A);
    await waitFor(() => d1.p.loads > before, 60000, 'reload into A');
    await preArm(d1.p, []);
    await waitReached(d1.p, point);
    await d1.p.eval(`(window.__so = communitySignOut(), true)`);
    const mid = await d1.p.eval(`(async () => { const u = await syncSessionUser(); return { uid: u && u.id, stopping: syncStopping }; })()`);
    check(point + ': sign-out waits for the in-flight restore', mid.uid === ctx.A.id && mid.stopping === true, mid);
    await release(d1.p, point);
    await awaitSignOut(d1.p);
    const g = await snap(d1.p);
    check(point + ': guest workspace has no A data/media', g.owner === null && g.hist.length === 0 && Object.keys(g.media).length === 0, g);
    await signIn(d1, ctx.B);
    const b = await snap(d1.p);
    check(point + ': B workspace has no A data/media (no contamination)', b.owner === ctx.B.id && b.hist.length === 0 && Object.keys(b.media).length === 0, b);
    check(point + ': B cloud untouched', (await ctx.obsB.row()) === null);
    await signOut(d1);
    await signIn(d1, ctx.A);
    await d1.p.reload(); await d1.p.eval(HELPERS);   // next start settles any journal of this session
    const a = await snap(d1.p);
    check(point + ': A workspace consistent (complete load, journals settled)', a.journal === 0 && a.hist.join() === 'w1,w2' && a.media['p:p1'] === s0.media['p:p1'] && a.media['m:m1'] === s0.media['m:m1'] && a.status === 'sync.st.synced', { j: a.journal, h: a.hist, st: a.status });
    check(point + ': A cloud unchanged by the interrupted restore', (await ctx.obsA.row()).revision === rev);
  }
});

scenario('edits during in-flight sync are never lost (upload and download)', async (ctx) => {
  const { d: d1 } = await seedA(ctx, 'd1');
  await d1.p.eval(`__GQ_TEST__.arm('upload:beforeRpc'), true`);
  await d1.p.eval(`__gq.addWorkout('w-up1', '2026-09-16')`);
  await d1.p.eval(`(syncKick('test'), true)`);
  await waitReached(d1.p, 'upload:beforeRpc');
  await d1.p.eval(`__gq.addWorkout('w-up2', '2026-09-17')`);
  await release(d1.p, 'upload:beforeRpc');
  const a = await d1.p.eval(`(async () => { await syncChain; const m = syncMetaRead(); return { seq: m.seq, synced: m.syncedSeq, dirty: syncIsDirty(m) }; })()`);
  check('edit made during upload stays pending (marker not cleared)', a.dirty === true && a.synced < a.seq, a);
  await syncNow(d1.p);
  const upRow = await ctx.obsA.row();
  check('both edits reach the account', ['w-up1', 'w-up2'].every((w) => cloudHist(upRow).indexOf(w) >= 0), cloudHist(upRow));
  const d2 = await device('d2');
  await signIn(d2, ctx.A);
  await d1.p.eval(`(async () => { __gq.addWorkout('w-new', '2026-09-18'); await __gq.addProgress('p3', 'three'); return true; })()`);
  await syncNow(d1.p);
  const j0 = (await snap(d2.p)).journal;
  await d2.p.eval(`__GQ_TEST__.arm('apply:mediaCommitted'), true`);
  await d2.p.eval(`(syncKick('test'), true)`);
  await waitReached(d2.p, 'apply:mediaCommitted');
  await d2.p.eval(`(async () => { __gq.addWorkout('w-local', '2026-09-19'); await __gq.addProgress('p-local', 'local'); return true; })()`);
  await release(d2.p, 'apply:mediaCommitted');
  const b = await syncNow(d2.p);
  check('edit during download kept (workout + photo)', b.hist.indexOf('w-local') >= 0 && !!b.media['p:p-local'], b.hist);
  check('interrupted apply rolled back (no half-applied cloud media/state)', !b.media['p:p3'] && b.hist.indexOf('w-new') < 0 && b.journal === j0, b);
  check('then an explicit conflict, not a silent overwrite', !!b.meta.conflict, b.meta.conflict);
});

scenario('crash during restore: journal recovery after process kill (two crash points)', async (ctx) => {
  const { s: s0 } = await seedA(ctx, 'd0');
  /* Chrome commits localStorage to disk a few seconds after a write. The journal barrier
     holds the restore while earlier writes (workspace registry) reach disk, so the crash
     below hits exactly the barrier-selected point of the restore. */
  const FLUSH_MS = 12000;
  const d1 = await device('d1');
  await preArm(d1.p, ['apply:journaled', 'apply:mediaCommitted']);
  const before = d1.p.loads;
  await signInRaw(d1, ctx.A);
  await waitFor(() => d1.p.loads > before, 60000, 'reload');
  await waitReached(d1.p, 'apply:journaled');
  await new Promise((r) => setTimeout(r, FLUSH_MS));
  await release(d1.p, 'apply:journaled');
  await waitReached(d1.p, 'apply:mediaCommitted');
  await relaunch(d1, false, { blockSupabase: true });          // process kill after media commit, before state write
  const a = await snap(d1.p);
  check('crash point 1: still in the account workspace after the crash', a.owner === ctx.A.id, a.slot);
  check('crash point 1: rolled back to the previous consistent state', a.journal === 0 && a.hist.length === 0 && Object.keys(a.media).length === 0, a);
  await d1.p.c.send('Network.setBlockedURLs', { urls: [] });
  const a2 = await syncNow(d1.p);
  check('crash point 1: next sync completes the load', a2.hist.join() === 'w1,w2' && a2.media['p:p1'] === s0.media['p:p1'] && a2.media['m:m1'] === s0.media['m:m1'], a2);
  const d2 = await device('d2');
  await preArm(d2.p, ['apply:journaled', 'apply:statePersisted']);
  const b0 = d2.p.loads;
  await signInRaw(d2, ctx.A);
  await waitFor(() => d2.p.loads > b0, 60000, 'reload');
  await waitReached(d2.p, 'apply:journaled');
  await new Promise((r) => setTimeout(r, FLUSH_MS));
  await release(d2.p, 'apply:journaled');
  await waitReached(d2.p, 'apply:statePersisted');
  await relaunch(d2, false, { blockSupabase: true });          // process kill right after the state write (flush not guaranteed)
  const b = await snap(d2.p);
  check('crash point 2: still in the account workspace after the crash', b.owner === ctx.A.id, b.slot);
  const complete = b.hist.join() === 'w1,w2' && b.media['p:p1'] === s0.media['p:p1'] && b.media['m:m1'] === s0.media['m:m1'];
  const empty = b.hist.length === 0 && Object.keys(b.media).length === 0;
  check('crash point 2: consistent (fully applied or fully rolled back), journal resolved', b.journal === 0 && (complete || empty), { journal: b.journal, hist: b.hist, media: b.media });
  check('crash point 2: if applied, revision was recorded (no false pending)', empty || (b.meta.rev !== null && b.dirty === false), b.meta);
});

scenario('no false conflict: device-only saves (running workout) do not block pulling account changes', async (ctx) => {
  const { d: d1 } = await seedA(ctx, 'd1');
  const d2 = await device('d2');
  await signIn(d2, ctx.A);
  await d2.p.eval(`(() => { startWorkoutNow(); syncClearTimers(); return !!state.activeSession; })()`);
  const a = await snap(d2.p);
  check('running workout marked the device dirty (device-only data)', a.activeSession && a.dirty, { s: a.activeSession, d: a.dirty });
  await d1.p.eval(`__gq.addWorkout('w3', '2026-09-21')`); await syncNow(d1.p);
  const b = await syncNow(d2.p);
  check('account change pulled without a conflict', b.hist.indexOf('w3') >= 0 && !b.meta.conflict, { hist: b.hist, c: b.meta.conflict });
  check('running workout kept (device-only)', b.activeSession === true);
});

scenario('D10: focus/online storm during first load does not restart or duplicate it', async (ctx) => {
  await seedA(ctx, 'd0');
  const d1 = await device('d1');
  await preArm(d1.p, ['apply:download']);
  const before = d1.p.loads;
  await signInRaw(d1, ctx.A);
  await waitFor(() => d1.p.loads > before, 60000, 'reload');
  await waitReached(d1.p, 'apply:download');
  await d1.p.eval(`(() => { for (let i = 0; i < 5; i++) { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange')); } return true; })()`);
  await release(d1.p, 'apply:download');
  await R(d1.p);
  const k = await counts(d1.p);
  const s = await snap(d1.p);
  check('exactly one apply ran', k['apply:journaled'] === 1, k);
  check('load completed', s.hist.join() === 'w1,w2' && s.status === 'sync.st.synced', s.status);
});

scenario('empty-data guard: device reset re-loads the account; deleting everything locally asks first', async (ctx) => {
  const { d: d1 } = await seedA(ctx, 'd1');
  const rev = (await ctx.obsA.row()).revision;
  const rl = d1.p.loads;
  try { await d1.p.eval(`(async () => { requestResetData(); confirmGeneric(); await new Promise((r) => setTimeout(r, 0)); confirmGeneric(); return true; })()`); } catch (e) {}
  await waitFor(() => d1.p.loads > rl, 60000, 'reset reload');
  await R(d1.p);
  const a = await snap(d1.p);
  check('after reset the account data loads again', a.hist.join() === 'w1,w2', a.hist);
  check('reset never uploaded empty data', (await ctx.obsA.row()).revision === rev);
  await d1.p.eval(`(() => { state.history = []; state.achievements = {}; state.measurements = []; delete state.plans.tp1; state.planOrder = state.planOrder.filter((x) => x !== 'tp1'); saveState(); return true; })()`);
  await d1.p.eval(`(async () => { for (const m of await idbGetAll(PROGRESS_META_STORE)) await idbDeleteProgress(m.id); for (const m of await idbGetAll(MEDIA_META_STORE)) await idbDeleteMetaAndBlob(m.id); return true; })()`);
  const b = await syncNow(d1.p);
  check('emptying the device triggers an explicit choice, not an upload', !!b.meta.conflict && b.meta.conflict.reason === 'empty-local', b.meta.conflict);
  check('populated account untouched', (await ctx.obsA.row()).revision === rev && cloudHist(await ctx.obsA.row()).length === 2);
});

scenario('local storage failure: shown to the user, account never treated as in sync with a stale copy', async (ctx) => {
  const { d: d1 } = await seedA(ctx, 'd1');
  const key = await d1.p.eval('STORAGE_KEY');
  await lsFail(d1.p, [key]);
  await d1.p.eval(`__gq.addWorkout('w-mem', '2026-09-20')`);
  const a = await syncNow(d1.p);
  check('failed local save is visible', a.storageWarning === true && /—|-/.test(a.localLine), a.localLine);
  check('in-memory change still reached the account', cloudHist(await ctx.obsA.row()).indexOf('w-mem') >= 0);
  await lsFail(d1.p, []);
  await relaunch(d1, true);
  const b = await snap(d1.p);
  check('after restart the stale local copy is refreshed from the account', b.hist.indexOf('w-mem') >= 0 && b.status === 'sync.st.synced', { hist: b.hist, st: b.status });
});

scenario('delete cloud backup: removes row, versions and media; device data kept; sync turned off', async (ctx) => {
  const { d: d1, s: s0 } = await seedA(ctx, 'd1');
  check('precondition: account has data and media objects', !!(await ctx.obsA.row()) && (await ctx.obsA.listAll()).length >= 3);
  await d1.p.eval(`(async () => { await cloudDeleteBackup(); confirmGeneric(); await new Promise((r) => setTimeout(r, 0)); await syncChain; return true; })()`);
  const a = await snap(d1.p);
  const versions = await (await fetch(ctx.obsA.cfg.url + '/rest/v1/backup_versions?select=revision&user_id=eq.' + ctx.A.id, { headers: ctx.obsA.h() })).json();
  check('row, versions and all media objects removed', (await ctx.obsA.row()) === null && (await ctx.obsA.listAll()).length === 0 && Array.isArray(versions) && versions.length === 0, { versions });
  check('device data untouched', a.hist.join() === 'w1,w2' && a.media['p:p1'] === s0.media['p:p1'] && a.media['m:m1'] === s0.media['m:m1'], a);
  check('sync turned off so the backup is not silently re-created', a.meta.disabled === true && a.status === 'sync.st.off', a.status);
  await d1.p.eval(`__gq.addWorkout('w-after', '2026-09-22')`);
  await syncNow(d1.p);
  check('later local edits stay local while sync is off', (await ctx.obsA.row()) === null);
});

/* ---------------------------- two tabs, one account ---------------------------- */
async function waitBlocked(p) { return waitFor(() => p.blocked().catch(() => false), 30000, 'tab blocked'); }
async function waitReloadedBlocked(p, loadsBefore) { await waitFor(() => p.loads > loadsBefore, 60000, 'yield reload'); return waitBlocked(p); }

scenario('two tabs: second tab is blocked; takeover waits for the in-flight upload and keeps the pending edit', async (ctx) => {
  const { d: d1 } = await seedA(ctx, 'd1');
  const t1 = d1.p;
  const rev0 = (await ctx.obsA.row()).revision;
  await t1.eval(`__GQ_TEST__.arm('upload:beforeRpc'), true`);
  await t1.eval(`__gq.addWorkout('w-t1', '2026-09-23')`);
  await t1.eval(`(syncKick('test'), true)`);
  await waitReached(t1, 'upload:beforeRpc');
  const t2 = await d1.b.newTab();
  await t2.navigate(BASE, { noReady: true });
  await waitBlocked(t2);
  check('second tab is blocked and never started the app (no state, no writes)', await t2.blocked());
  const lt1 = t1.loads;
  await t2.eval(`__GQ_TEST__.arm('sync:start'), true`);   // hold the new tab's first sync to inspect the handover
  await t2.eval(`(document.getElementById('btn-tab-take').click(), true)`);
  await waitFor(() => t1.eval('syncStopping'), 30000, 'first tab received the takeover request');
  const mid = await t1.eval(`({ stopping: syncStopping, yielded: appYielded })`);
  check('takeover waits while the first tab finishes its in-flight upload', mid.stopping === true && mid.yielded === false && (await t2.blocked()), mid);
  await release(t1, 'upload:beforeRpc');
  await waitReloadedBlocked(t1, lt1);
  check('first tab handed over and is now blocked', await t1.blocked());
  await waitReached(t2, 'sync:start');
  await t2.eval(HELPERS);
  const s = await snap(t2);
  check('new active tab has the pending edit (not lost, not overwritten)', s.hist.indexOf('w-t1') >= 0 && s.owner === ctx.A.id && s.dirty === true, { hist: s.hist, dirty: s.dirty });
  check('aborted upload in the first tab published nothing', (await ctx.obsA.row()).revision === rev0);
  await release(t2, 'sync:start');
  await R(t2);
  check('new tab uploads the handed-over edit on start', cloudHist(await ctx.obsA.row()).indexOf('w-t1') >= 0);
  await t2.eval(`__gq.addWorkout('w-t2', '2026-09-24')`);
  await syncNow(t2);
  const row = await ctx.obsA.row();
  check('both edits reach the account, one revision each', ['w-t1', 'w-t2'].every((w) => cloudHist(row).indexOf(w) >= 0) && row.revision === rev0 + 2, { h: cloudHist(row), rev: row.revision });
  const lt2 = t2.loads;
  await t1.eval(`(document.getElementById('btn-tab-take').click(), true)`);
  await waitReloadedBlocked(t2, lt2);
  await R(t1);
  const back = await snap(t1);
  check('taking the app back keeps everything (round trip)', back.hist.indexOf('w-t1') >= 0 && back.hist.indexOf('w-t2') >= 0 && back.status === 'sync.st.synced', { h: back.hist, st: back.status });
});

scenario('two tabs: restore in the active tab while the other tab asks to take over', async (ctx) => {
  const { d: d0 } = await seedA(ctx, 'd0');
  const d1 = await device('d1');
  await signIn(d1, ctx.A);
  await d0.p.eval(`(async () => { __gq.addWorkout('w-new', '2026-09-25'); await __gq.addProgress('p-new', 'new'); await __gq.addPersonal('m-new', 'new'); return true; })()`);
  await syncNow(d0.p);
  const t1 = d1.p;
  await t1.eval(`__GQ_TEST__.arm('apply:mediaCommitted'), true`);
  await t1.eval(`(syncKick('test'), true)`);
  await waitReached(t1, 'apply:mediaCommitted');
  const t2 = await d1.b.newTab();
  await t2.navigate(BASE, { noReady: true });
  await waitBlocked(t2);
  const lt1 = t1.loads;
  await t2.eval(`(document.getElementById('btn-tab-take').click(), true)`);
  await waitFor(() => t1.eval('syncStopping'), 30000, 'first tab received the takeover request');
  check('takeover does not interrupt the restore write (other tab still waiting)', (await t2.blocked()) && (await t1.eval('appYielded')) === false);
  await release(t1, 'apply:mediaCommitted');
  await waitReloadedBlocked(t1, lt1);
  await R(t2);
  const s = await snap(t2);
  check('new tab sees the completed restore (state + progress + personal media)', s.hist.indexOf('w-new') >= 0 && !!s.media['p:p-new'] && !!s.media['m:m-new'] && s.status === 'sync.st.synced', { h: s.hist, m: Object.keys(s.media), st: s.status });
  await t2.eval(`__gq.addWorkout('w-after', '2026-09-26')`);
  await syncNow(t2);
  check('edit in the new tab after the handover syncs', cloudHist(await ctx.obsA.row()).indexOf('w-after') >= 0);
  check('old tab stays blocked (cannot write stale state)', await t1.blocked());
});

scenario('two tabs: sign-out in the active tab while it is syncing; the other tab never writes across accounts', async (ctx) => {
  const { d: d1 } = await seedA(ctx, 'd1');
  const t1 = d1.p;
  const rev0 = (await ctx.obsA.row()).revision;
  const t2 = await d1.b.newTab();
  await t2.navigate(BASE, { noReady: true });
  await waitBlocked(t2);
  await t1.eval(`__GQ_TEST__.arm('upload:beforeRpc'), true`);
  await t1.eval(`__gq.addWorkout('w-pend', '2026-09-27')`);
  await t1.eval(`(syncKick('test'), true)`);
  await waitReached(t1, 'upload:beforeRpc');
  await t1.eval(`(window.__so = communitySignOut(), true)`);
  await release(t1, 'upload:beforeRpc');
  await awaitSignOut(t1);
  const g = await snap(t1);
  check('active tab signed out into the guest workspace; aborted upload published nothing', g.owner === null && g.hist.length === 0 && (await ctx.obsA.row()).revision === rev0, g.slot);
  check('other tab stayed blocked throughout', await t2.blocked());
  const lt1 = t1.loads;
  await t2.eval(`(document.getElementById('btn-tab-take').click(), true)`);
  await waitReloadedBlocked(t1, lt1);
  await R(t2);
  const s2 = await snap(t2);
  check('taking over after sign-out opens the guest workspace (no A data)', s2.owner === null && s2.hist.length === 0 && Object.keys(s2.media).length === 0, s2.slot);
  await signIn({ p: t2 }, ctx.B);
  const b = await syncNow(t2);
  check('B workspace empty; B cloud untouched', b.owner === ctx.B.id && b.hist.length === 0 && (await ctx.obsB.row()) === null);
  await signOut({ p: t2 });
  await signIn({ p: t2 }, ctx.A);
  const a = await syncNow(t2);
  const row = await ctx.obsA.row();
  check('A pending edit preserved and synced only to A', a.hist.indexOf('w-pend') >= 0 && cloudHist(row).indexOf('w-pend') >= 0 && (await ctx.obsB.row()) === null, cloudHist(row));
});

/* ---------------------------- session expiry ---------------------------- */
const EXPIRE_SESSION = `(() => {
  const k = 'gymquest-community-auth';
  const s = JSON.parse(localStorage.getItem(k));
  s.access_token = 'expired.invalid.token'; s.refresh_token = 'invalid-refresh-token'; s.expires_at = 1; s.expires_in = 0;
  localStorage.setItem(k, JSON.stringify(s));
  return true;
})()`;

scenario('session expiry: local work continues, survives restart, resumes after re-authentication', async (ctx) => {
  const { d: d1 } = await seedA(ctx, 'd1');
  const rev0 = (await ctx.obsA.row()).revision;
  await d1.p.eval(EXPIRE_SESSION);
  await d1.p.reload(); await d1.p.eval(HELPERS);
  const a = await snap(d1.p);
  check('expired session: still in A workspace with A data', a.owner === ctx.A.id && a.hist.join() === 'w1,w2', a.slot);
  check('session is gone (refresh rejected)', (await d1.p.eval(`syncSessionUser().then((u) => u === null)`)) === true);
  await d1.p.eval(`__gq.addWorkout('w-exp', '2026-09-28')`);
  const b = await syncNow(d1.p);
  check('editing and saving continue locally; status says signed out with changes saved', b.hist.indexOf('w-exp') >= 0 && b.dirty && b.status === 'sync.st.signedout' && !b.storageWarning, b.status);
  check('nothing uploaded while signed out', (await ctx.obsA.row()).revision === rev0);
  await relaunch(d1, true);
  const c = await snap(d1.p);
  check('pending edit survives a full restart', c.owner === ctx.A.id && c.hist.indexOf('w-exp') >= 0 && c.dirty === true, c);
  await signIn(d1, ctx.A);
  const e = await syncNow(d1.p);
  check('re-authentication in the same workspace resumes sync and uploads the pending edit', e.slot === c.slot && cloudHist(await ctx.obsA.row()).indexOf('w-exp') >= 0 && e.status === 'sync.st.synced', { slot: e.slot, st: e.status });
});

scenario('session expiry: re-authenticating as a different account never uploads the pending edit there', async (ctx) => {
  const { d: d1 } = await seedA(ctx, 'd1');
  await d1.p.eval(EXPIRE_SESSION);
  await d1.p.reload(); await d1.p.eval(HELPERS);
  await d1.p.eval(`__gq.addWorkout('w-expA', '2026-09-29')`);
  const a = await snap(d1.p);
  check('A pending edit saved locally while expired', a.hist.indexOf('w-expA') >= 0 && a.dirty, a.status);
  await signIn(d1, ctx.B);
  const b = await syncNow(d1.p);
  check('signing in as B opens B workspace without A data', b.owner === ctx.B.id && b.hist.indexOf('w-expA') < 0 && b.hist.length === 0, b.hist);
  check('B cloud never receives A data', (await ctx.obsB.row()) === null && (await ctx.obsB.listAll()).length === 0);
  await signOut(d1);
  await signIn(d1, ctx.A);
  const c = await syncNow(d1.p);
  check('A pending edit preserved and synced to A after signing back in', c.hist.indexOf('w-expA') >= 0 && cloudHist(await ctx.obsA.row()).indexOf('w-expA') >= 0, c.hist);
});

scenario('RLS/privacy: B cannot read A backup row or media', async (ctx) => {
  await seedA(ctx, 'd1');
  const r = await fetch(ctx.obsB.cfg.url + '/rest/v1/backups?select=revision&user_id=eq.' + ctx.A.id, { headers: ctx.obsB.h() });
  const j = await r.json();
  check('B sees no rows for A', Array.isArray(j) && j.length === 0, j);
  const files = await ctx.obsB.listAll(ctx.A.id);
  check('B lists no A objects', files.length === 0, files.length);
});

/* ---------------------------- migration from the previous release ---------------------------- */
async function oldDevice(ctx, name) {
  ctx.server.setRoot('old');
  const b = new Browser(name + '-' + Date.now().toString(36), nextPort++, PROFILES);
  browsers.push(b);
  const p = await b.launch();
  await p.c.send('Network.setBypassServiceWorker', { bypass: true });
  await p.navigate(BASE).catch(() => {});
  await waitFor(() => p.eval(`typeof communitySb === 'function' && typeof cloudReconcileOnSignIn === 'function'`).catch(() => false), 30000, 'old app');
  await p.eval(`(async () => {
    state.history.push({ id: 'L1', planId: 'push', planName: 'Push', date: '2026-08-01', xp: 20, note: '', exercises: [] });
    state.history.push({ id: 'L2', planId: 'push', planName: 'Push', date: '2026-08-02', xp: 20, note: '', exercises: [] });
    reconcileAchievements(); saveState();
    const blob = new Blob(['legacy-photo-' + 'z'.repeat(40)], { type: 'image/jpeg' });
    await idbWriteProgress({ id: 'lp1', date: '2026-08-01', note: 'legacy', view: 'front', seq: 1, w: 1, h: 1, mime: 'image/jpeg', size: blob.size, addedAt: 1 }, { id: 'lp1', blob, thumb: null, origName: '' });
    await idbWriteMetaAndBlob({ id: 'lm1', exerciseKey: 'squats', kind: 'image', name: 'lm', type: 'image/jpeg', size: 4, seq: 1, hasPoster: false }, { id: 'lm1', blob: new Blob(['lm-1']), posterBlob: null });
    return true; })()`);
  return { b, p };
}
async function toNewBuild(ctx, d) {
  ctx.server.setRoot('new');
  await d.p.reload();
  await R(d.p);
}

scenario('migration M1: v42 data with a validated owner is linked automatically without data change', async (ctx) => {
  const d = await oldDevice(ctx, 'm1');
  await d.p.eval(`(async () => { state.settings.communityOptIn = true; saveState();
    await communitySb().auth.signInWithPassword({ email: ${JSON.stringify(ctx.A.email)}, password: ${JSON.stringify(ctx.A.password)} });
    state.settings.cloudBackup = true; saveState(); await cloudReconcileOnSignIn();
    for (let i = 0; i < 120 && cloudStatus !== 'saved'; i++) await new Promise((r) => setTimeout(r, 250));
    localStorage.setItem('gymquest_restore_snapshot', JSON.stringify(state)); return cloudStatus; })()`);
  const row0 = await ctx.obsA.row();
  check('old build backed up to A (owner hint set)', row0 && cloudHist(row0).join() === 'L1,L2', row0 && row0.revision);
  const before = await d.p.eval(`(async () => { const o = {}; for (const m of await idbGetAll('progressMeta')) { o['p:' + m.id] = await cloudSha256((await idbGetProgress(m.id)).blob); } for (const m of await idbGetAll('meta')) { o['m:' + m.id] = await cloudSha256((await idbGetBlob(m.id)).blob); } return o; })()`);
  await toNewBuild(ctx, d);
  const s = await snap(d.p);
  check('legacy workspace linked to A automatically (validated owner)', s.slot === 'legacy' && s.owner === ctx.A.id && s.registry.slots.legacy.owner === ctx.A.id, s.registry);
  check('legacy data unchanged (history + media bytes)', s.hist.join() === 'L1,L2' && s.media['p:lp1'] === before['p:lp1'] && s.media['m:lm1'] === before['m:lm1'], { s: s.media, before });
  check('no conflict, no spurious upload', !s.meta.conflict && (await ctx.obsA.row()).revision === row0.revision, { c: s.meta.conflict });
  check('a separate empty guest workspace was created', s.registry.guest !== 'legacy' && !!s.registry.slots[s.registry.guest], s.registry.guest);
  const ls = await d.p.eval('__gq.lsKeys()');
  check('v42 snapshot moved out of localStorage into a recovery copy', !ls.gymquest_restore_snapshot && s.recovery.some((r) => r.kind === 'legacy-snapshot'), { ls: Object.keys(ls), rec: s.recovery });
  await signOut(d);
  const g = await snap(d.p);
  check('signed out: guest workspace does not show A data', g.owner === null && g.hist.length === 0 && Object.keys(g.media).length === 0, g);
  await signIn(d, ctx.A);
  const back = await snap(d.p);
  check('signing in again returns to the linked legacy workspace', back.slot === 'legacy' && back.hist.join() === 'L1,L2', back.slot);
});

scenario('migration M2/M3: unknown owner is never linked silently; keep-separate and link both preserve data', async (ctx) => {
  const { d: d0 } = await seedA(ctx, 'd0');
  const rev = (await ctx.obsA.row()).revision;
  const d = await oldDevice(ctx, 'm2');
  await toNewBuild(ctx, d);
  await signIn(d, ctx.A);
  const a = await snap(d.p);
  check('asks before linking unknown legacy data', a.link === true && a.syncModal && a.registry.slots.legacy.owner === null && a.slot === 'legacy', a);
  check('nothing uploaded while undecided', (await ctx.obsA.row()).revision === rev);
  await relaunch(d, true, { bypassSW: true });   // the v42 worker is updated in its own scenario
  const b = await snap(d.p);
  check('still undecided after a full restart (asked again)', b.link === true && b.registry.slots.legacy.owner === null, b.registry.slots.legacy);
  try { await d.p.eval(`__gq.click('link-separate')`); } catch (e) {}
  await R(d.p);
  const c = await snap(d.p);
  check('keep separate: new A workspace auto-loaded the account', c.owner === ctx.A.id && c.slot !== 'legacy' && c.hist.join() === 'w1,w2', c);
  await signOut(d);
  const g = await snap(d.p);
  check('legacy data preserved as the guest workspace', g.slot === 'legacy' && g.owner === null && g.hist.join() === 'L1,L2' && !!g.media['p:lp1'] && !!g.media['m:lm1'], g);
  // M3: another device, choose "link"
  const e = await oldDevice(ctx, 'm3');
  await toNewBuild(ctx, e);
  await signIn(e, ctx.A);
  try { await e.p.eval(`__gq.click('link-yes')`); } catch (err) {}
  await R(e.p);
  const f = await syncNow(e.p);
  check('link: legacy workspace now owned by A', f.registry.slots.legacy.owner === ctx.A.id && f.slot === 'legacy', f.registry.slots.legacy);
  check('link with divergent cloud: explicit conflict, nothing uploaded', !!f.meta.conflict && (await ctx.obsA.row()).revision === rev, f.meta.conflict);
  await e.p.eval(`(__gq.click('keep-device') || (syncResolveConflict('device'), true))`);
  const h = await syncNow(e.p);
  const row = await ctx.obsA.row();
  check('keep-device: account now has legacy data; cloud copy kept', cloudHist(row).join() === 'L1,L2' && h.recovery.some((r) => r.kind === 'cloud-copy' && r.hist === 2), { cloud: cloudHist(row), rec: h.recovery });
  check('all references exist', (await manifestRefsExist(ctx.obsA, row)).ok);
});

scenario('release update path: installed v42 app updates through its service worker and keeps all data', async (ctx) => {
  ctx.server.setRoot('old');
  const b = new Browser('upd-' + Date.now().toString(36), nextPort++, PROFILES);
  browsers.push(b);
  const p = await b.launch();
  await p.navigate(BASE).catch(() => {});
  await waitFor(() => p.eval(`typeof cloudReconcileOnSignIn === 'function'`).catch(() => false), 30000, 'old app');
  await p.eval(`(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; })()`, 120000);
  const lb = p.loads; await p.c.send('Page.reload', {}); await waitFor(() => p.loads > lb, 60000, 'reload');
  await waitFor(() => p.eval(`!!navigator.serviceWorker.controller && typeof cloudReconcileOnSignIn === 'function'`).catch(() => false), 30000, 'controlled old app');
  await p.eval(`(async () => {
    document.getElementById('modal-setup').hidden = true;
    state.history.push({ id: 'U1', planId: 'push', planName: 'Push', date: '2026-08-05', xp: 20, note: '', exercises: [] }); reconcileAchievements(); saveState();
    const blob = new Blob(['upd-photo-' + 'q'.repeat(40)], { type: 'image/jpeg' });
    await idbWriteProgress({ id: 'up1', date: '2026-08-05', note: '', view: 'front', seq: 1, w: 1, h: 1, mime: 'image/jpeg', size: blob.size, addedAt: 1 }, { id: 'up1', blob, thumb: null, origName: '' });
    return true; })()`);
  const oldCache = await p.eval('caches.keys()');
  check('v42 app installed and controlling, cache v42', oldCache.indexOf('gymquest-v42') >= 0, oldCache);
  ctx.server.setRoot('new');
  await p.eval(`navigator.serviceWorker.getRegistration().then((r) => r.update()).then(() => true)`);
  await waitFor(() => p.eval('swUpdateReady === true').catch(() => false), 60000, 'update ready');
  const lu = p.loads;
  await p.eval('(applyUpdate(), true)');
  await waitFor(() => p.loads > lu, 60000, 'update reload');
  await R(p);
  const s = await snap(p);
  const caches2 = await p.eval('caches.keys()');
  check('new build running from the new cache (v43), old cache removed', caches2.indexOf('gymquest-v43') >= 0 && caches2.indexOf('gymquest-v42') < 0 && (await p.eval(`!!document.querySelector('script[src="script.js?v=47"]')`)), caches2);
  check('data intact after the update; registry created; still guest/legacy', s.slot === 'legacy' && s.hist.indexOf('U1') >= 0 && !!s.media['p:up1'] && s.registry && s.registry.v === 1, s);
  check('no page exceptions after update', p.errors.length === 0, p.errors);
});

scenario('migration M4: storage failures during migration leave the original data intact', async (ctx) => {
  const d = await oldDevice(ctx, 'm4');
  ctx.server.setRoot('new');
  await lsFail(d.p, ['gymquest_workspaces']);
  await d.p.reload(); await R(d.p);
  const a = await snap(d.p);
  check('registry write failure: app still runs on the original data', a.slot === 'legacy' && a.hist.join() === 'L1,L2' && !!a.media['p:lp1'] && a.registry === null, a);
  await lsFail(d.p, []);
  await d.p.reload(); await R(d.p);
  const b = await snap(d.p);
  check('next start creates the registry; data intact', b.registry && b.registry.v === 1 && b.hist.join() === 'L1,L2', b.registry);
  await signIn(d, ctx.A);
  await lsFail(d.p, ['gymquest_workspaces']);
  await d.p.eval(`__gq.click('link-yes')`).catch(() => {});
  await d.p.eval('syncChain').catch(() => {});
  const c = await snap(d.p);
  check('link write failure: legacy stays unowned, data intact, error shown', c.registry.slots.legacy.owner === null && c.hist.join() === 'L1,L2' && c.lastError === 'local', { reg: c.registry.slots.legacy, err: c.lastError });
  await lsFail(d.p, []);
  // v42 restore snapshot: migration retried until the IndexedDB copy is verified
  await signOut(d).catch(() => {});
  await d.p.eval(`localStorage.setItem('gymquest_restore_snapshot', JSON.stringify({ version: 3, history: [{ id: 'S1' }] })), true`);
  await d.p.eval(`sessionStorage.setItem('gq_test_fail', JSON.stringify([{ name: 'migrate:snapshot' }])), true`);
  await d.p.reload(); await R(d.p);
  const e = await d.p.eval('__gq.lsKeys()');
  check('snapshot copy failure: snapshot stays in localStorage', !!e.gymquest_restore_snapshot, Object.keys(e));
  await d.p.reload(); await R(d.p);
  const f = await snap(d.p);
  const fl = await d.p.eval('__gq.lsKeys()');
  check('next start: snapshot moved after verified copy', !fl.gymquest_restore_snapshot && f.recovery.some((r) => r.kind === 'legacy-snapshot'), f.recovery);
});

/* ------------- whole-record replacement paths (2026-10-28 incident: plans + XP kept, no workouts) -------------
   Each scenario starts from an account with workouts AND an activity and asks: can the account end up with plans
   and achievements but no workouts/activities without the user explicitly choosing that? */
const ACT = (id, date) => `(state.activities.push({ id: '${id}', kind: 'run', date: '${date}', startedAt: 1700000000000, endedAt: 1700000600000, activeSeconds: 600, distanceKm: 2, note: '', xp: 15 }), saveState(), true)`;
const cloudActs = (row) => ((row && row.payload && row.payload.activities) || []).length;
async function seedFull(ctx, name) {
  const { d } = await seedA(ctx, name);
  await d.p.eval(ACT('a1', '2026-09-02'));
  const s = await syncNow(d.p);
  const row = await ctx.obsA.row();
  check('seed: account has 2 workouts, 1 activity, a custom plan', cloudHist(row).join() === 'w1,w2' && cloudActs(row) === 1 && s.plans.indexOf('tp1') >= 0, { h: cloudHist(row), a: cloudActs(row) });
  return { d, s, row };
}
async function accountIntact(ctx, label) {
  const row = await ctx.obsA.row();
  return check(label, cloudHist(row).join() === 'w1,w2' && cloudActs(row) === 1, { h: cloudHist(row), a: cloudActs(row), rev: row && row.revision });
}

scenario('overwrite O1: unreadable local data + a plan edit never silently replaces the account', async (ctx) => {
  const { d } = await seedFull(ctx, 'o1');
  const key = await d.p.eval('STORAGE_KEY');
  await d.p.eval(`(localStorage.setItem(${JSON.stringify(key)}, '{"broken'), true)`);
  await relaunch(d, true, { blockSupabase: true });            // reopened without a connection: starts from defaults
  const a = await snap(d.p);
  check('device shows no workouts now (started from defaults)', a.hist.length === 0, a.hist);
  await d.p.eval(`__gq.addCustomPlan('tp-after')`);           // the user edits a plan before reconnecting
  const ls = await d.p.eval('__gq.lsKeys()');
  check('unreadable data is kept aside unchanged (at the first save)', !!ls[key + '_unreadable'] && (await d.p.eval(`localStorage.getItem(${JSON.stringify(key + '_unreadable')})`)) === '{"broken', Object.keys(ls).filter((k) => k.indexOf('gymquest') === 0));
  await d.p.c.send('Network.setBlockedURLs', { urls: [] });
  const b = await syncNow(d.p);
  await accountIntact(ctx, 'account keeps its workouts and activity');
  check('device reloads the account or asks explicitly (never uploads a smaller record)', b.hist.join() === 'w1,w2' || !!b.meta.conflict, { hist: b.hist, conflict: b.meta.conflict });
});

scenario('overwrite O2: missing local data (state key gone, sync bookkeeping kept) + a plan edit', async (ctx) => {
  const { d } = await seedFull(ctx, 'o2');
  const key = await d.p.eval('STORAGE_KEY');
  await d.p.eval(`(localStorage.removeItem(${JSON.stringify(key)}), true)`);
  await relaunch(d, true, { blockSupabase: true });
  const a = await snap(d.p);
  check('still the account workspace, no workouts loaded', a.owner === ctx.A.id && a.hist.length === 0, { owner: a.owner, hist: a.hist });
  await d.p.eval(`__gq.addCustomPlan('tp-after')`);
  await d.p.c.send('Network.setBlockedURLs', { urls: [] });
  const b = await syncNow(d.p);
  await accountIntact(ctx, 'account keeps its workouts and activity');
  check('device reloads the account or asks explicitly', b.hist.join() === 'w1,w2' || !!b.meta.conflict, { hist: b.hist, conflict: b.meta.conflict });
});

scenario('overwrite O3: plan edited on a new device before the first download after sign-in finishes', async (ctx) => {
  await seedFull(ctx, 'o3-seed');
  const d = await device('o3');
  await preArm(d.p, ['sync:start']);
  const before = d.p.loads;
  await signInRaw(d, ctx.A);
  await waitFor(() => d.p.loads > before, 60000, 'reload');
  await waitReached(d.p, 'sync:start');
  await d.p.eval(HELPERS);
  await d.p.eval(`__gq.addCustomPlan('tp-early')`);           // edit while the first sync is held
  await release(d.p, 'sync:start');
  const b = await syncNow(d.p);
  await accountIntact(ctx, 'account keeps its workouts and activity');
  check('device gets the account data or an explicit choice', b.hist.join() === 'w1,w2' || !!b.meta.conflict, { hist: b.hist, conflict: b.meta.conflict });
});

scenario('overwrite O4: explicit "keep this device" with a plans-only device; recovery copy; version retention', async (ctx) => {
  await seedFull(ctx, 'o4-seed');
  const v0 = await ctx.obsA.versions();
  const d = await device('o4');
  await d.p.eval(`(__gq.addCustomPlan('tp-dev'), true)`);   // guest device: plans only, no workouts
  await signIn(d, ctx.A);
  let a = await snap(d.p);
  if (a.link) { try { await d.p.eval(`__gq.click('link-yes')`); } catch (e) {} await R(d.p); }
  a = await syncNow(d.p);
  check('a plans-only device and a populated account: explicit choice first, nothing uploaded', !!a.meta.conflict, a.meta.conflict);
  await accountIntact(ctx, 'account untouched while undecided');
  await d.p.eval(`(__gq.click('keep-device') || (syncResolveConflict('device'), true))`);
  const b = await syncNow(d.p);
  const row = await ctx.obsA.row();
  check('after the explicit choice the account has the device data (no workouts) — by design', cloudHist(row).length === 0, cloudHist(row));
  check('the device kept a recovery copy of the account (2 workouts)', b.recovery.some((r) => r.kind === 'cloud-copy' && r.hist === 2), b.recovery);
  const v1 = await ctx.obsA.versions();
  check('the server still keeps the previous version with the workouts', v1.some((v) => v.hist === 2 && v.acts === 1), v1);
  for (let i = 0; i < 5; i++) { await d.p.eval(`__gq.addMeasurement('mx${i}', ${80 + i})`); await syncNow(d.p); }
  const v2 = await ctx.obsA.versions();
  console.log('    versions kept after 5 more saves: ' + JSON.stringify(v2) + ' (before: ' + JSON.stringify(v0) + ')');
  check('retention: only the newest 5 versions are kept (the version with workouts is gone after 5 saves)', v2.length <= 5 && !v2.some((v) => v.hist === 2), v2);
  const c = await snap(d.p);
  check('the on-device recovery copy is still there after those saves', c.recovery.some((r) => r.kind === 'cloud-copy' && r.hist === 2), c.recovery);
});

/* ---------------------------- runner ---------------------------- */
(async () => {
  fs.mkdirSync(PROFILES, { recursive: true });
  const roots = { new: REPO, old: process.env.GQ_OLD_ROOT || REPO };
  const server = await startServer(PORT, roots);
  const cfg = readPublicConfig(REPO);
  if (!/supabase\.co/.test(cfg.url)) SB_BLOCK.push('*' + new URL(cfg.url).host + '*');
  const A = loadCreds('a'), B = loadCreds('b');
  const obsA = await new Observer(cfg, A).login();
  const obsB = await new Observer(cfg, B).login();
  const filter = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
  for (const sc of scenarios) {
    if (filter && !filter.test(sc.name)) continue;
    if (REMOTE && /^(migration|release update)/.test(sc.name)) { console.log('\n== SKIP (local-only) ' + sc.name); continue; }
    current = { name: sc.name, checks: [], error: null, ms: 0 };
    results.push(current);
    console.log('\n== ' + sc.name);
    const t0 = Date.now();
    server.setRoot('new');
    try {
      await obsA.reset(); await obsB.reset();
      await sc.fn({ A, B, obsA, obsB, server });
    } catch (e) {
      current.error = String(e && e.stack || e);
      console.log('  ERROR ' + current.error.split('\n').slice(0, 3).join(' | '));
    }
    current.ms = Date.now() - t0;
    while (browsers.length) { const b = browsers.pop(); try { await b.closeGraceful(); } catch (e) { b.killHard(true); } }
  }
  try { await obsA.reset(); await obsB.reset(); } catch (e) {}
  await server.close();
  const pass = results.reduce((n, r) => n + r.checks.filter((c) => c.ok).length, 0);
  const fail = results.reduce((n, r) => n + r.checks.filter((c) => !c.ok).length, 0);
  const errs = results.filter((r) => r.error).length;
  fs.writeFileSync(path.join(WORK, 'results.json'), JSON.stringify({ at: new Date().toISOString(), pass, fail, errors: errs, results }, null, 2));
  console.log('\n==== checks: ' + pass + ' passed, ' + fail + ' failed; scenario errors: ' + errs + ' ====');
  process.exit(fail || errs ? 1 : 0);
})();
