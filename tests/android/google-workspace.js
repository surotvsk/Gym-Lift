'use strict';
/* Skutočný lokálny Supabase + existujúce izolované priestory. Iba Google tokenový endpoint je
   nahradený prihlásením syntetických účtov heslom; žiadny Google/produkčný request. */
const fs = require('fs');
const { counter, startServerOnce, openApp, closeAll, REPO } = require('./lib-native');
const { loadCreds, readPublicConfig, waitFor } = require('../sync/lib');
const HELPERS = require('../sync/helpers');
const work = process.env.GQ_WORK || '/tmp/gq-google-workspace';
fs.mkdirSync(work, { recursive:true });
const J = JSON.stringify;
(async () => {
  if (!process.env.GQ_COMMUNITY_CONFIG) throw new Error('Local config required');
  const cfg = readPublicConfig(REPO);
  if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(cfg.url)) throw new Error('Local backend only');
  const a = loadCreds('a'), b = loadCreds('b');
  const t = counter(), server = await startServerOnce(work, process.env.GQ_COMMUNITY_CONFIG);
  const tag = 'google-' + Date.now();
  try {
    const { p } = await openApp({name:'google-workspace', debugPort:9921, native:true, work});
    const ev = s => p.eval(s,120000);
    async function ready() { await p.ready(); await ev(HELPERS); }
    async function navigating(code) {
      try { await ev(code); } catch(e) { if (!/context|navigat|closed|Cannot find|Execution/.test(e.message)) throw e; }
      await ready();
    }
    async function login(creds) {
      await ev(`(() => {
        GYMQUEST_COMMUNITY.googleWebClientId='123-test.apps.googleusercontent.com';
        __nativeReturns['GymGoogle.signIn']={token:'local-test-token',nonce:'local-test-nonce'};
        const sb=communitySb(), original=sb.auth.signInWithPassword.bind(sb.auth);
        sb.auth.signInWithIdToken=async input=> {
          if(input.provider!=='google'||input.nonce!=='local-test-nonce') throw new Error('Invalid bridge input');
          return original({email:${J(creds.email)},password:${J(creds.password)}});
        };
        return true;
      })()`);
      await navigating('communityGoogleSignIn(false)');
      if (await ev('!!wsLinkUser')) {
        t.check('guest data requires explicit ownership choice', await ev('!wsSlot.owner'));
        await navigating(`wsResolveLink('separate')`);
      }
      await waitFor(()=>ev(`wsSlot.owner===${J(creds.id)} && !syncLoading && syncMetaRead().rev !== null`),45000,'account ready');
    }
    await ready();
    await ev(`__gq.addWorkout(${J(tag+'-guest')}); true`);
    const guest = await ev(`({key:STORAGE_KEY,data:localStorage.getItem(STORAGE_KEY)})`);
    await login(a);
    t.check('Google flow selects A workspace', await ev(`wsSlot.owner===${J(a.id)}`));
    t.check('guest data is not silently imported into A', await ev(`!state.history.some(h=>h.id===${J(tag+'-guest')})`));
    t.check('guest snapshot survives sign-in byte-for-byte', await ev(`localStorage.getItem(${J(guest.key)})===${J(guest.data)}`));
    await ev(`__gq.addWorkout(${J(tag+'-a')}); true`);
    await ev(`syncKick('google-test')`);
    const aKey = await ev('STORAGE_KEY');
    await navigating('communitySignOut()');
    await login(b);
    t.check('Google flow selects B workspace', await ev(`wsSlot.owner===${J(b.id)} && STORAGE_KEY!==${J(aKey)}`));
    t.check('B never receives A or guest workout', await ev(`!state.history.some(h=>[${J(tag+'-a')},${J(tag+'-guest')}].includes(h.id))`));
    await navigating('communitySignOut()');
    await login(a);
    t.check('returning to A restores the same workspace and history', await ev(`STORAGE_KEY===${J(aKey)} && state.history.some(h=>h.id===${J(tag+'-a')})`));
    const before = await ev('JSON.stringify(state)');
    await ev(`(() => { const sb=communitySb(); sb.auth.linkIdentity=async input=> {
      if(input.provider!=='google') throw new Error('Wrong provider'); const r=await sb.auth.getUser(); return {data:{user:r.data.user},error:r.error}; }; return true; })()`);
    await ev('communityGoogleSignIn(true)');
    t.check('linking leaves real session, workspace and history unchanged', await ev(`(async () => (await communitySb().auth.getSession()).data.session.user.id===${J(a.id)} && STORAGE_KEY===${J(aKey)} && JSON.stringify(state)===${J(before)})()`));
    console.log(`==== checks: ${t.pass} passed, ${t.fail} failed ====`);
    process.exitCode=t.fail?1:0;
  } finally { closeAll(); server.close(); }
})().catch(e=>{console.error(e.message);closeAll();process.exitCode=1;});
