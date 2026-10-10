'use strict';
/* GymQuest social (0005) — UI test in real headless Chrome against the LOCAL test stack.
   The app is served from http://localhost:8124 with /community-config.js replaced by a
   local config (GQ_COMMUNITY_CONFIG); disposable local users only.

     GQ_COMMUNITY_CONFIG=<local config js> GQ_STATE=<seed state> node tests/social/ui.js

   Covers: 16+ signup checkbox, composing (device file + progress photo) with metadata
   stripped before upload, moderator review, likes/shares/follow/Following feed, photo
   viewer, block, report reasons, age card for existing users, reserved names, the
   fallback when 0005 is not available (rolled back), and translations in 6 languages. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('./lib');
const { startServer, Browser, waitFor } = require('../sync/lib');
const HELPERS = require('../sync/helpers');
const { check, section, sql, sqlVal, lit } = L;

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-social-ui');
const PROFILES = path.join(WORK, 'profiles');
let nextPort = 9860;
const browsers = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function device(name) {
  const b = new Browser(name + '-' + Date.now().toString(36), nextPort++, PROFILES);
  browsers.push(b);
  const p = await b.launch();
  await p.navigate(BASE);
  await p.eval(HELPERS);
  return p;
}
const J = JSON.stringify;
async function signIn(p, u) {
  const r = await p.eval('window.__gq.signIn(' + J(u.email) + ',' + J(u.password) + ')');
  await p.ready();                    // sign-in switches to the account's workspace (reload)
  await p.eval(HELPERS);
  await p.eval(`(state.settings.communityOptIn = true, communityOpen(), true)`);
  await waitFor(() => p.eval(`!!communityProfile`), 30000, 'profile');
  return r;
}
const bodyText = (p) => p.eval(`document.getElementById('community-body').innerText`);
async function view(p, v) {
  await p.eval(`(communityOpen(), communitySetView(${J(v)}), true)`);
  await waitFor(() => p.eval(`!document.getElementById('community-body').querySelector('.card-note') || document.getElementById('community-body').innerText.indexOf(t('community.loading')) < 0`), 30000, 'render ' + v);
  await wait(400);
}
/* Clicks once the element is there (views re-render asynchronously after each action). */
async function click(p, selector) {
  await waitFor(() => p.eval(`(() => { const el = document.querySelector(${J(selector)}); if (!el || el.disabled) return false; el.click(); return true; })()`),
    15000, 'element ' + selector);
  await wait(300);
}
async function setFiles(p, selector, files) {
  const { result } = await p.c.send('Runtime.evaluate', { expression: 'document.querySelector(' + J(selector) + ')' });
  if (!result.objectId) throw new Error('no input ' + selector);
  await p.c.send('DOM.enable');
  await p.c.send('DOM.setFileInputFiles', { objectId: result.objectId, files });
}
async function confirmDialog(p) { await p.eval(`(confirmGeneric(), true)`); await wait(500); }
async function download(pathInBucket) {
  const r = await L.admin.storage.from('community').download(pathInBucket);
  if (r.error) throw new Error('download ' + pathInBucket + ': ' + r.error.message);
  return Buffer.from(await r.data.arrayBuffer());
}

(async () => {
  if (sqlVal("select to_regclass('public.follows') is not null") !== 't') throw new Error('0005 must be applied');
  if (!process.env.GQ_COMMUNITY_CONFIG) throw new Error('GQ_COMMUNITY_CONFIG required');
  const S = JSON.parse(fs.readFileSync(process.env.GQ_STATE, 'utf8'));
  fs.mkdirSync(PROFILES, { recursive: true });
  const fx = L.fixtures();
  const exifPath = path.join(process.env.GQ_FIXTURES || path.join(os.tmpdir(), 'gq-social-fixtures'), 'exif.jpg');
  const server = await startServer(PORT, { new: REPO });
  const M = await L.signIn(S.users.M);
  const author = await L.newUser('ui-author');
  const viewer = await L.newUser('ui-viewer');
  let pA, pV, pM;
  try {
    section('signup requires the 16+ checkbox');
    const pS = await device('signup');
    await pS.eval(`(state.settings.communityOptIn = true, persistState(), communityOpen(), true)`);
    await waitFor(() => pS.eval(`!!document.getElementById('community-age16')`), 30000, 'signup form');
    const email = 'gqlocal-ui-signup-' + L.runTag + '@example.test';
    await pS.eval(`(document.getElementById('community-email').value = ${J(email)}, document.getElementById('community-password').value = 'pw-ui-12345A', true)`);
    check('the signup form shows the 16+ checkbox, unchecked', await pS.eval(`document.getElementById('community-age16').checked === false && document.body.innerText.includes(t('auth.age16Label'))`));
    await pS.eval(`communitySignUp()`); await wait(800);
    check('signup without the checkbox is refused in the app (no request)', (await bodyText(pS)).includes(await pS.eval(`t('auth.errAge16')`))
      && sqlVal('select count(*) from auth.users where email = ' + lit(email)) === '0');
    await pS.eval(`(document.getElementById('community-age16').click(), document.getElementById('community-password').value = 'pw-ui-12345A', true)`);
    await pS.eval(`communitySignUp()`);
    await waitFor(() => sqlVal('select count(*) from auth.users where email = ' + lit(email)) === '1', 20000, 'signup');
    check('signup with the checkbox creates the account with a 16+ confirmation (source=signup)',
      sqlVal('select c.source from public.community_consents c join auth.users u on u.id = c.user_id where u.email = ' + lit(email)) === 'signup');

    section('compose: device file + progress photo, metadata removed before upload');
    pA = await device('author');
    await signIn(pA, author);
    // a real progress photo with GPS/camera EXIF in this device's private gallery
    const b64 = fx.exifJpeg.toString('base64');
    await pA.eval(`(async () => {
      const bin = atob(${J(b64)}); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const blob = new Blob([u8], { type: 'image/jpeg' });
      if (!mediaDb) mediaDb = await openMediaDb();
      await idbWriteProgress({ id: 'uiprog1', date: todayISO(), note: '', view: 'front', seq: 1, w: 64, h: 48, mime: 'image/jpeg', size: blob.size, addedAt: Date.now() },
        { id: 'uiprog1', blob, thumb: blob, origName: '' });
      progressMeta = (await idbGetAll(PROGRESS_META_STORE)).map(cleanProgressMeta).filter(Boolean);
      return true; })()`);
    check('fixture really contains GPS/camera metadata', L.hasMetadata(fx.exifJpeg));
    await view(pA, 'compose');
    check('composer shows privacy and review notes', (await bodyText(pA)).includes(await pA.eval(`t('community.composePrivacy')`)));
    await pA.eval(`(() => { const ta = document.getElementById('community-compose-text'); ta.value = 'UI leg day 💪'; ta.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await setFiles(pA, '#community-compose-files', [exifPath]);
    await waitFor(() => pA.eval(`communityDraft.photos.length === 1`), 10000, 'file added');
    await click(pA, '[data-community-action="compose-progress"]');
    await waitFor(() => pA.eval(`!!document.querySelector('[data-community-action="compose-add-progress"][data-photo-id="uiprog1"]')`), 10000, 'picker');
    await click(pA, '[data-community-action="compose-add-progress"][data-photo-id="uiprog1"]');
    check('draft keeps text and both photos across re-render', await pA.eval(`communityDraft.photos.length === 2 && document.getElementById('community-compose-text').value === 'UI leg day 💪'`));
    await setFiles(pA, '#community-compose-files', [path.join(REPO, 'README.md')]);
    await wait(500);
    check('a non-image file is refused in the composer', await pA.eval(`communityDraft.photos.length === 2 && document.getElementById('community-body').innerText.includes(t('community.errFileType'))`));
    await click(pA, '[data-community-action="compose-publish"]');
    await waitFor(() => pA.eval(`communityView === 'myposts' && !communityPosting`), 30000, 'published');
    const postId = sqlVal("select id from public.posts where user_id = " + lit(author.id) + " order by created_at desc limit 1");
    const row = sql('select status || \'|\' || caption || \'|\' || image_path || \'|\' || thumb_path from public.posts where id = ' + lit(postId)).split('|');
    const extra = sql('select image_path || \'|\' || thumb_path from public.post_media where post_id = ' + lit(postId)).split('|');
    check('post created as pending with its text and 2 photos', row[0] === 'pending' && row[1] === 'UI leg day 💪' && extra.length === 2, row.join('|'));
    const files = [row[2], row[3], extra[0], extra[1]];
    check('all files inside the author\'s own folder', files.every((f) => f.startsWith(author.id + '/')));
    const bufs = await Promise.all(files.map(download));
    check('stored photos and thumbnails contain no EXIF / GPS / camera data', bufs.every((b) => !L.hasMetadata(b)), bufs.map((b) => L.hasMetadata(b)));
    check('stored files are JPEG re-encodes (not the original bytes)', bufs.every((b) => b[0] === 0xff && b[1] === 0xd8) && !bufs.some((b) => b.equals(fx.exifJpeg)));
    check('My posts shows the pending post with "Edit text"', (await bodyText(pA)).includes(await pA.eval(`t('community.statusPending')`))
      && await pA.eval(`!!document.querySelector('[data-community-action="edit-caption"]')`));

    section('moderator review in the app');
    pM = await device('mod');
    await signIn(pM, S.users.M);
    await view(pM, 'moderate');
    check('pending post visible to the moderator with both photos', await pM.eval(`!!document.querySelector('[data-post="${postId}"] .community-photos[data-count="2"]')`));
    // the author changes the text after the moderator loaded the queue -> approval must not go through
    await author.c.from('posts').update({ caption: 'UI leg day 💪 (changed)' }).eq('id', postId);
    await click(pM, '[data-community-action="approve"][data-post="' + postId + '"]');
    await wait(800);
    check('approval refused when the text changed after the moderator saw it', sqlVal('select status from public.posts where id = ' + lit(postId)) === 'pending'
      && (await bodyText(pM)).includes(await pM.eval(`t('community.errChanged')`)));
    await click(pM, '[data-community-action="approve"][data-post="' + postId + '"]');
    await waitFor(() => sqlVal('select status from public.posts where id = ' + lit(postId)) === 'approved', 10000, 'approve');
    check('approve after re-checking works', true);
    await view(pA, 'myposts');
    check('approved post: no "Edit text", locked note shown', await pA.eval(`!document.querySelector('[data-community-action="edit-caption"]') && document.getElementById('community-body').innerText.includes(t('community.lockedNote'))`));

    section('viewer: like, share, follow, Following feed, photo viewer');
    pV = await device('viewer');
    await signIn(pV, viewer);
    await view(pV, 'feed');
    await waitFor(() => pV.eval(`!!document.querySelector('[data-post="${postId}"]')`), 20000, 'post in Everyone');
    check('Everyone feed shows the post with 2 photos and the author name', await pV.eval(`!!document.querySelector('[data-post="${postId}"] .community-photos[data-count="2"] img')`)
      && (await bodyText(pV)).includes(sqlVal('select username from public.profiles where id = ' + lit(author.id))));
    await click(pV, '[data-community-action="like"][data-post="' + postId + '"]');
    await waitFor(() => sqlVal('select count(*) from public.likes where post_id = ' + lit(postId) + ' and user_id = ' + lit(viewer.id)) === '1', 10000, 'like');
    check('like: stored, button pressed, count 1', await pV.eval(`(() => { const b = document.querySelector('[data-community-action="like"][data-post="${postId}"]'); return b.getAttribute('aria-pressed') === 'true' && b.textContent.trim().endsWith('1'); })()`));
    await click(pV, '[data-community-action="like"][data-post="' + postId + '"]');
    await waitFor(() => sqlVal('select count(*) from public.likes where post_id = ' + lit(postId)) === '0', 10000, 'unlike');
    check('unlike works', true);
    await click(pV, '[data-community-action="share"][data-post="' + postId + '"]');
    check('share asks for confirmation first', await pV.eval(`!document.getElementById('modal-generic').hidden`) && sqlVal('select count(*) from public.reposts where post_id = ' + lit(postId)) === '0');
    await confirmDialog(pV);
    await waitFor(() => sqlVal('select count(*) from public.reposts where post_id = ' + lit(postId) + ' and user_id = ' + lit(viewer.id)) === '1', 10000, 'share');
    check('share stored', true);
    await click(pV, '[data-post="' + postId + '"] [data-community-action="view-photo"]');
    await waitFor(() => pV.eval(`(() => { const b = document.getElementById('community-lightbox'); const i = b && b.querySelector('img'); return !!(b && !b.hidden && i && i.complete && i.naturalWidth > 0); })()`), 15000, 'lightbox');
    check('photo viewer loads the full image through a signed link', await pV.eval(`/token=/.test(document.querySelector('#community-lightbox img').src)`));
    await pV.eval(`(document.getElementById('community-lightbox').click(), true)`);
    await click(pV, '[data-post="' + postId + '"] [data-community-action="open-user"]');
    await waitFor(() => pV.eval(`communityView === 'user' && !!document.querySelector('[data-community-action="follow"]')`), 15000, 'profile');
    check('profile shows counts and Follow, no private data', (await bodyText(pV)).includes(await pV.eval(`t('community.followersCount', { n: 0 })`)));
    await click(pV, '[data-community-action="follow"]');
    await waitFor(() => sqlVal('select count(*) from public.follows where follower_id = ' + lit(viewer.id) + ' and followee_id = ' + lit(author.id)) === '1', 10000, 'follow');
    await waitFor(() => pV.eval(`!!document.querySelector('[data-community-action="follow"][data-on="0"]')`), 10000, 'following state');
    check('follow stored and button shows Following, count 1', (await bodyText(pV)).includes(await pV.eval(`t('community.followersCount', { n: 1 })`)));
    await view(pV, 'following');
    await waitFor(() => pV.eval(`!!document.querySelector('[data-post="${postId}"]')`), 15000, 'following feed');
    check('Following feed shows the followed author\'s post', true);
    await view(pA, 'feed');
    await click(pA, '[data-post="' + postId + '"] [data-community-action="open-user"]');
    await waitFor(() => pA.eval(`communityView === 'user'`), 10000, 'own profile view');
    await click(pA, '[data-community-action="open-list"][data-kind="followers"]');
    await waitFor(() => pA.eval(`communityView === 'list'`), 10000, 'list');
    check('followers list shows the viewer', (await bodyText(pA)).includes(sqlVal('select username from public.profiles where id = ' + lit(viewer.id))));

    section('report with a reason, block');
    await view(pV, 'feed');
    await click(pV, '[data-community-action="report-post"][data-post="' + postId + '"]');
    await pV.eval(`(document.getElementById('community-report-reason').value = 'harassment', true)`);
    await confirmDialog(pV);
    await waitFor(() => sqlVal('select reason from public.reports where post_id = ' + lit(postId) + ' and reporter_id = ' + lit(viewer.id)) === 'harassment', 10000, 'report');
    check('report stored with the chosen reason category', true);
    await view(pM, 'moderate');
    check('moderator sees the report with the post author and translated reason (no internal ids)', (await bodyText(pM)).includes(await pM.eval(`t('community.reason_harassment')`))
      && !(await bodyText(pM)).includes(postId));
    await view(pV, 'feed');
    await click(pV, '[data-community-action="block"][data-user="' + author.id + '"]');
    await confirmDialog(pV);
    await waitFor(() => sqlVal('select count(*) from public.blocks where blocker_id = ' + lit(viewer.id) + ' and blocked_id = ' + lit(author.id)) === '1', 10000, 'block');
    await wait(800);
    check('after blocking: post gone from the feed, follow removed', await pV.eval(`!document.querySelector('[data-post="${postId}"]')`)
      && sqlVal('select count(*) from public.follows where follower_id = ' + lit(viewer.id) + ' and followee_id = ' + lit(author.id)) === '0');
    await pV.eval(`(communityOpenUser(${J(author.id)}), true)`); await wait(1200);
    check('after blocking: the profile is unavailable', (await bodyText(pV)).includes(await pV.eval(`t('community.profileUnavailable')`)));

    section('existing user: one-time 16+ card; reserved names');
    const old = await L.signIn(S.users.B);
    sql('delete from public.community_consents where user_id = ' + lit(old.id));
    const pB = await device('olduser');
    await signIn(pB, S.users.B);
    await view(pB, 'feed');
    check('existing user without confirmation sees the age card, not posts', await pB.eval(`!!document.querySelector('[data-community-action="accept-age"]') && !document.querySelector('.community-card')`));
    await click(pB, '[data-community-action="accept-age"]');
    await waitFor(() => sqlVal('select source from public.community_consents where user_id = ' + lit(old.id)) === 'prompt', 10000, 'consent');
    await waitFor(() => pB.eval(`!document.querySelector('[data-community-action="accept-age"]')`), 10000, 'feed after consent');
    check('after confirming, the feed is shown', true);
    await view(pB, 'profile');
    await pB.eval(`(document.getElementById('community-username').value = 'Gym_Quest_Support', true)`);
    await pB.eval(`communitySaveProfile()`); await wait(800);
    check('reserved username refused with a clear message', (await bodyText(pB)).includes(await pB.eval(`t('community.errReserved')`)));

    section('translations: no raw keys in 6 languages');
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      await pV.eval(`(setLang(${J(lang)}), true)`);
      const raw = [];
      for (const v of ['feed', 'following', 'compose', 'profile', 'myposts']) {
        await view(pV, v);
        const txt = await bodyText(pV);
        const m = txt.match(/\b(community|auth)\.[a-zA-Z_]+/g);
        if (m) raw.push(v + ':' + m.join(','));
      }
      check('no untranslated keys (' + lang + ')', raw.length === 0, raw);
    }
    await pV.eval(`(setLang('en'), true)`);

    section('fallback when 0005 is not available (rolled back)');
    L.sqlFile(path.join(REPO, 'supabase', 'rollback', '0005_down.sql'));
    sql("notify pgrst, 'reload schema';"); await wait(1500);
    const pL = await device('legacy');
    await signIn(pL, viewer);
    await view(pL, 'feed');
    await wait(800);
    check('social features hidden: legacy tabs, no like/share/follow buttons', await pL.eval(`communitySocial === false && !document.querySelector('[data-community-view="following"]') && !document.querySelector('[data-community-action="like"]')`));
    check('legacy feed still renders posts, including a text-only post (text, no photo)', await pL.eval(`(() => {
      const cards = Array.from(document.querySelectorAll('.community-card'));
      return cards.length > 0 && cards.some((c) => !c.querySelector('img.community-photo') && c.querySelector('.community-caption'));
    })()`));
    check('no page exceptions in the legacy mode', pL.errors.length === 0, pL.errors);
    L.sqlFile(path.join(REPO, 'supabase', 'migrations', '0005_social_feed.sql'));
    sql("notify pgrst, 'reload schema';"); await wait(1500);
    check('0005 re-applied after the fallback test', sqlVal("select to_regclass('public.follows') is not null") === 't');

    section('page health');
    for (const [n, p] of [['author', pA], ['viewer', pV], ['moderator', pM], ['signup', pS], ['old user', pB]]) check('no page exceptions (' + n + ')', p.errors.length === 0, p.errors);
  } catch (e) {
    check('scenario error', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
  } finally {
    while (browsers.length) { const b = browsers.pop(); try { await b.closeGraceful(); } catch (e) { b.killHard(true); } }
    await server.close();
  }
  console.log('\n==== checks: ' + L.results.pass + ' passed, ' + L.results.fail + ' failed ====');
  if (process.env.GQ_RESULTS) fs.writeFileSync(process.env.GQ_RESULTS, L.results.lines.join('\n') + '\n\n==== checks: ' + L.results.pass + ' passed, ' + L.results.fail + ' failed ====\n');
  process.exit(L.results.fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
