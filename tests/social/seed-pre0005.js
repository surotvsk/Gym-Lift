'use strict';
/* Seed the LOCAL test database (migrations 0001–0004 only) with data created the
   way the v46 app creates it, and demonstrate the pre-0005 gaps.
   Writes the ids to GQ_STATE (a JSON file outside the repo) for run.js / rollback.js. */

const fs = require('fs');
const L = require('./lib');

(async () => {
  const STATE = process.env.GQ_STATE;
  if (!STATE) throw new Error('GQ_STATE (output json path, outside the repo) is required');
  if (L.sqlVal("select to_regclass('public.follows') is null") !== 't') throw new Error('0005 already applied: seed needs 0001–0004 only');
  const fx = L.fixtures();

  const M = await L.newUser('pre-mod', { age: false });
  L.makeModerator(M);
  const A = await L.newUser('pre-a', { age: false });
  const B = await L.newUser('pre-b', { age: false });
  const C = await L.newUser('pre-c', { age: false });

  async function v46Post(u, name, caption) {
    const img = u.id + '/' + name + '.jpg', th = u.id + '/' + name + '_thumb.jpg';
    for (const p of [img, th]) {
      const up = await u.c.storage.from('community').upload(p, fx.jpeg, { contentType: 'image/jpeg' });
      if (up.error) throw new Error('upload ' + p + ': ' + up.error.message);
    }
    const ins = await u.c.from('posts').insert({ user_id: u.id, image_path: img, thumb_path: th, caption: '' }).select('id').single();
    if (ins.error) throw new Error('insert post: ' + ins.error.message);
    if (caption) await u.c.from('posts').update({ caption }).eq('id', ins.data.id);
    return { id: ins.data.id, img, th };
  }
  const approve = (id) => M.c.from('posts').update({ status: 'approved', published_at: new Date().toISOString() }).eq('id', id).select('id');

  const a1 = await v46Post(A, 'a1', 'first post');
  await approve(a1.id);
  const a2 = await v46Post(A, 'a2', 'pending post');
  const b1 = await v46Post(B, 'b1', 'to be rejected');
  await M.c.from('posts').update({ status: 'rejected' }).eq('id', b1.id);
  const c1 = await v46Post(C, 'c1', 'approved c');
  await approve(c1.id);
  await B.c.from('reports').insert({ reporter_id: B.id, post_id: a1.id, reason: 'spam' });
  await C.c.from('blocks').insert({ blocker_id: C.id, blocked_id: B.id });
  const bk = await A.c.rpc('save_backup', { p_payload: { plan: 'private-plan', measurements: [80] }, p_schema: 1,
    p_base_revision: 0, p_device: 'seed', p_app_version: 'v46' });
  if (bk.error) throw new Error('save_backup: ' + bk.error.message);
  const bkMedia = A.id + '/media/m1/hash1';
  const bup = await A.c.storage.from('backups').upload(bkMedia, fx.jpeg, { contentType: 'image/jpeg' });
  if (bup.error) throw new Error('backup media: ' + bup.error.message);

  L.section('pre-0005 gaps (expected to be OPEN before 0005)');
  const edit = await A.c.from('posts').update({ caption: 'edited after approval' }).eq('id', a1.id).select('caption');
  L.check('gap 1 open: approved post text editable by its author', !edit.error && edit.data && edit.data[0] && edit.data[0].caption === 'edited after approval', L.errText(edit));
  const hijack = await B.c.from('posts').insert({ user_id: B.id, image_path: a2.img, thumb_path: a2.th, caption: 'not mine' }).select('id').single();
  L.check('gap 2 open: a post can reference another user\'s photo path', !hijack.error, L.errText(hijack));
  const anonProfiles = await L.anon().from('profiles').select('id,username');
  L.check('gap 3 open: signed-out (anon) can read profiles', !anonProfiles.error && (anonProfiles.data || []).length >= 4, L.errText(anonProfiles));

  fs.writeFileSync(STATE, JSON.stringify({
    users: Object.fromEntries([['M', M], ['A', A], ['B', B], ['C', C]].map(([k, u]) => [k, { email: u.email, password: u.password, id: u.id, tag: u.tag }])),
    posts: { a1, a2, b1, c1 }, hijackPostId: hijack.data && hijack.data.id, backupMedia: bkMedia,
  }, null, 2));
  console.log('\nseed written to ' + STATE + ' — ' + L.results.pass + ' passed, ' + L.results.fail + ' failed');
  process.exit(L.results.fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
