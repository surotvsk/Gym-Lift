'use strict';
/* GymQuest Android — files leave the app through Android's share sheet, never <a download>
   (a WebView silently ignores downloads). Headless Chrome + fake Capacitor.

     node tests/android/native-share.js

   Settings export, the automatic backup strip and "save progress photo" write the file with
   Filesystem (cache directory) and open Share with that file; the backup content equals the web
   export (no running workout); a cancelled share shows no error; web mode still downloads. */
const { counter, startServerOnce, openApp, closeAll, nativeCalls, clearNativeCalls } = require('./lib-native');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const t = counter();
const check = t.check;
const URI = 'file:///data/user/0/surotvsk.gymapp/cache/x';

/* zaznamená každé <a download>.click() namiesto skutočného sťahovania */
const HOOK_DOWNLOADS = `(() => { window.__downloads = []; const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__downloads.push(this.download); return; } return orig.call(this); }; return true; })()`;

(async () => {
  const server = await startServerOnce(require('os').tmpdir());
  try {
    const { p, errors } = await openApp({ name: 'nshare', debugPort: 9936, native: true,
      returns: { 'Filesystem.writeFile': { uri: URI } } });
    await wait(1000);
    await p.eval(HOOK_DOWNLOADS);
    await p.eval(`(seedSampleData(), ensureSession(getPlan(activePlanIds()[0])), saveState(), true)`);

    /* ručný export v Nastaveniach */
    await clearNativeCalls(p);
    await p.eval(`(exportData(), true)`);
    await wait(300);
    const w = await nativeCalls(p, 'Filesystem', 'writeFile');
    const expected = await p.eval(`backupPayload()`);
    const today = await p.eval(`todayISO()`);
    check('export: Filesystem.writeFile once', w.length === 1, w.length);
    const a = (w[0] && w[0].args[0]) || {};
    check('export: file name gymquest-backup-<today>.json', a.path === 'gymquest-backup-' + today + '.json', a.path);
    check('export: cache directory, utf8', a.directory === 'CACHE' && a.encoding === 'utf8', a);
    check('export: content = web export, no running workout', a.data === expected && !JSON.parse(a.data).activeSession, (a.data || '').slice(0, 80));
    const s = await nativeCalls(p, 'Share', 'share');
    check('export: Share.share with the written file', s.length === 1 && JSON.stringify(s[0].args[0].files) === JSON.stringify([URI]), s);
    check('export: no <a download>', (await p.eval(`window.__downloads.length`)) === 0);

    /* automatická záloha (lišta "Uložiť zálohu") */
    await clearNativeCalls(p);
    await p.eval(`(saveBackupNow(), true)`);
    await wait(300);
    const w2 = await nativeCalls(p, 'Filesystem', 'writeFile');
    check('auto backup: written with timestamped name', w2.length === 1 && /^gymquest-backup-\d{4}-\d\d-\d\d-\d{4}\.json$/.test(w2[0].args[0].path), w2[0] && w2[0].args[0].path);
    check('auto backup: shared', (await nativeCalls(p, 'Share', 'share')).length === 1);
    check('auto backup: honest strip shown (sent)', await p.eval(`!!backupStripState && backupStripState.kind === 'sent'`));
    check('auto backup: no <a download>', (await p.eval(`window.__downloads.length`)) === 0);

    /* uloženie fotky progresu */
    const added = await p.eval(`(async () => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 64;
      const g = c.getContext('2d'); g.fillStyle = '#f50'; g.fillRect(0, 0, 64, 64);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
      const err = await addProgressPhoto(new File([blob], 'p.jpg', { type: 'image/jpeg' }), todayISO(), '', 'front');
      return (err && err !== 'photos.addedOk') ? err : ((progressMeta[0] && progressMeta[0].id) || null);
    })()`);
    check('photo added for the test', !!added && !/^photos\./.test(added), added);
    await clearNativeCalls(p);
    await p.eval(`saveProgressPhotoToDevice(${JSON.stringify(added)})`);
    await wait(300);
    const w3 = await nativeCalls(p, 'Filesystem', 'writeFile');
    const a3 = (w3[0] && w3[0].args[0]) || {};
    check('photo: written as base64 JPEG gymquest-photo-<date>.jpg', w3.length === 1 && /^gymquest-photo-\d{4}-\d\d-\d\d\.jpg$/.test(a3.path)
      && !a3.encoding && typeof a3.data === 'string' && a3.data.length > 100 && !/^data:/.test(a3.data), { path: a3.path, enc: a3.encoding });
    check('photo: shared', (await nativeCalls(p, 'Share', 'share')).length === 1);
    check('photo: no <a download>', (await p.eval(`window.__downloads.length`)) === 0);

    /* zrušené zdieľanie */
    await p.eval(`(window.__nativeReturns['Share.share'] = { __reject: 'Share canceled' }, true)`);
    await p.eval(`(exportData(), true)`);
    await wait(300);
    check('cancelled share: no console error', errors.length === 0, errors.slice(0, 3));

    closeAll();
    const web = await openApp({ name: 'nshare-web', debugPort: 9937 });
    await wait(800);
    await web.p.eval(HOOK_DOWNLOADS);
    await web.p.eval(`(seedSampleData(), exportData(), true)`);
    check('web: export still downloads', (await web.p.eval(`window.__downloads`)).length === 1);
    check('web: no errors', web.errors.length === 0, web.errors);
  } catch (e) {
    check('no exception in test', false, String(e && e.stack || e));
  } finally {
    closeAll();
    server.close();
    console.log(`\n${t.pass} passed, ${t.fail} failed`);
    process.exit(t.fail ? 1 : 0);
  }
})();
