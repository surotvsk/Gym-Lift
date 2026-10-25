'use strict';
/* GymQuest Android — release build check.

     node tests/android/release-check.js            (builds www + the signed release AAB first)
     GQ_SKIP_BUILD=1 node tests/android/release-check.js

   Checks: the release AAB exists, is ≤ 40 MB and is signed with the upload key; its manifest is not
   debuggable, has package surotvsk.gymapp and a versionName carrying the web CACHE_VERSION; the
   WebView debugging switch is not forced on; privacy.html loads without console errors in both
   languages and covers Health Connect, notifications, account deletion; no keystore,
   google-services.json, www/ or local.properties is tracked by git. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { counter, startServerOnce, closeAll } = require('./lib-native');
const { Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const JAVA_HOME = process.env.JAVA_HOME_21 || path.join(os.homedir(), '.local/share/jdk/jdk-21.0.13+9');
const SDK = process.env.ANDROID_HOME || path.join(os.homedir(), 'Android/Sdk');
const AAB = path.join(REPO, 'android/app/build/outputs/bundle/release/app-release.aab');
const t = counter();
const check = t.check;
const run = (cmd, args, opts) => execFileSync(cmd, args, Object.assign({ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }, opts || {}));

(async () => {
  let server;
  try {
    if (!process.env.GQ_SKIP_BUILD) {
      run('bash', ['tools/android/build-www.sh'], { cwd: REPO });
      run('npx', ['cap', 'sync', 'android'], { cwd: REPO });
      run('./gradlew', ['bundleRelease', '--console=plain', '-q'], { cwd: path.join(REPO, 'android'), env: Object.assign({}, process.env, { JAVA_HOME }) });
    }
    check('release AAB built', fs.existsSync(AAB));
    const mb = fs.statSync(AAB).size / 1048576;
    check('AAB ≤ 40 MB (' + mb.toFixed(1) + ' MB)', mb <= 40);

    const v = run(path.join(JAVA_HOME, 'bin/jarsigner'), ['-verify', '-verbose', '-certs', AAB]);
    check('AAB signature verifies', /jar verified/.test(v));
    check('signed by the GymQuest upload key (not the debug key)', /CN=GymQuest/.test(v) && !/Android Debug/.test(v));

    /* manifest, ktorý ide do balíka (Gradle ho zlúči pri bundleRelease) */
    const mf = path.join(REPO, 'android/app/build/intermediates/merged_manifest/release/processReleaseMainManifest/AndroidManifest.xml');
    const manifest = fs.readFileSync(mf, 'utf8');
    check('package surotvsk.gymapp', /package="surotvsk\.gymapp"/.test(manifest));
    check('not debuggable', !/android:debuggable="true"/.test(manifest));
    const cache = (/CACHE_VERSION\s*=\s*'(v\d+)'/.exec(fs.readFileSync(path.join(REPO, 'sw.js'), 'utf8')) || [])[1];
    const vn = (/android:versionName="([^"]+)"/.exec(manifest) || [])[1] || '';
    check('versionName carries CACHE_VERSION (' + vn + ')', !!cache && vn.includes(cache));
    const vc = Number((/android:versionCode="(\d+)"/.exec(manifest) || [])[1]);
    check('versionCode = tools/android/version.txt', vc > 0 && vc === Number(fs.readFileSync(path.join(REPO, 'tools/android/version.txt'), 'utf8').trim()), vc);
    const capCfg = JSON.parse(fs.readFileSync(path.join(REPO, 'capacitor.config.json'), 'utf8'));
    check('WebView debugging not forced on', !(capCfg.android && capCfg.android.webContentsDebuggingEnabled === true));

    const tracked = run('git', ['ls-files'], { cwd: REPO }).split('\n');
    const bad = tracked.filter((f) => /\.jks$|\.keystore$|google-services\.json$|^www\/|local\.properties$|gradle\.properties$/.test(f) && !/^android\/gradle\.properties$/.test(f));
    check('no keystore / google-services.json / www / local.properties in git', bad.length === 0, bad);

    /* privacy.html */
    check('privacy.html exists', fs.existsSync(path.join(REPO, 'privacy.html')));
    server = await startServerOnce(os.tmpdir());
    const b = new Browser('privacy-' + Date.now().toString(36), 9945, path.join(os.tmpdir(), 'gq-android', 'profiles'));
    const p = await b.launch();
    const errs = [];
    p.c.on('Runtime.exceptionThrown', (e) => errs.push(String(e.exceptionDetails.text)));
    await p.c.send('Log.enable');
    p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) errs.push(e.entry.text); });
    await p.navigate('http://localhost:8124/privacy.html', { noReady: true });
    const en = await p.eval(`document.body.innerText`);
    check('privacy: Health Connect section (heart rate, never shared)', /Health Connect/.test(en) && /heart rate/i.test(en) && /never/i.test(en));
    check('privacy: notifications / Firebase', /Firebase/i.test(en) && /notification/i.test(en));
    check('privacy: account deletion steps (real button label)', /Delete my community account/.test(en) && /surotvsk\.github\.io\/Gymquest/.test(en));
    check('privacy: contact section', /Contact/.test(en));
    check('privacy: mentions Android\'s own backup to Google Drive', /Android backup|Android.s backup/i.test(en) && /Google Drive/.test(en));
    await p.eval(`(document.querySelector('[data-lang="sk"]') && document.querySelector('[data-lang="sk"]').click(), true)`);
    const sk = await p.eval(`document.body.innerText`);
    check('privacy: Slovak version', /Zásady ochrany súkromia/.test(sk) && /Health Connect/.test(sk));
    check('privacy: no console errors', errs.length === 0, errs);
    b.killHard(true);
  } catch (e) {
    check('no exception', false, String(e && (e.stderr || e.stack) || e).slice(0, 1500));
  } finally {
    closeAll();
    if (server) server.close();
    console.log(`\n${t.pass} passed, ${t.fail} failed`);
    process.exit(t.fail ? 1 : 0);
  }
})();
