'use strict';
/* Google hranica: syntetické session, reálny prehliadač, žiadny OAuth/server. */
const { counter, startServerOnce, openApp, closeAll, nativeCalls } = require('./lib-native');
const fs = require('fs');
const work = '/tmp/gq-native-google';
fs.mkdirSync(work, { recursive: true });
(async () => {
  const t = counter(), server = await startServerOnce(work);
  try {
    const { p, errors } = await openApp({ name: 'google', debugPort: 9919, native: true, work });
    const ev = s => p.eval(s);
    const run = link => ev(`communityGoogleSignIn(${!!link})`);
    await ev(`window.__ga = { session: null, calls: [], error: null, linkUser: null };
      GYMQUEST_COMMUNITY = { supabaseUrl: 'http://127.0.0.1:54321', supabaseAnonKey: 'synthetic' };
      renderCommunity = () => { document.getElementById('community-body').innerHTML = communityAuthHtml(); };
      wsBindSession = async explicit => { __ga.calls.push({ method:'bind', explicit }); };
      window.__realQuiesce = syncQuiesce;
      syncQuiesce = async () => { __ga.calls.push({method:'quiesce'}); await __realQuiesce(); };
      communityClientRef = { auth: {
        getSession: async () => ({ data: { session: __ga.session }, error: null }),
        signInWithIdToken: async args => { __ga.calls.push({method:'signin',args}); if (__ga.error) return {error:__ga.error}; __ga.session = {user:{id:'account-a'}}; return {data:__ga.session,error:null}; },
        linkIdentity: async args => { __ga.calls.push({method:'link',args}); if (__ga.error) return {error:__ga.error}; __ga.session = {user:{id:__ga.linkUser || 'account-a'}}; return {data:__ga.session,error:null}; },
        signOut: async () => { __ga.calls.push({method:'signout'}); __ga.session = null; return {error:null}; }
      }};
      __nativeReturns['GymGoogle.signIn'] = {token:'synthetic-token',nonce:'synthetic-nonce'};
      true`);
    t.check('unconfigured native control is disabled', await ev(`googleSignInHtml().includes('disabled') && !googleReady()`));
    await run(false);
    t.check('unconfigured flow never opens Google', (await nativeCalls(p, 'GymGoogle')).length === 0);
    await ev(`GYMQUEST_COMMUNITY.googleWebClientId='123-test.apps.googleusercontent.com'; __ga.calls=[]; __nativeReturns['GymGoogle.signIn']={cancelled:true}; true`);
    const snapshot = () => ev(`JSON.stringify({state, storage: Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)]), slot:wsSlot, session:__ga.session})`);
    const before = await snapshot();
    await run(false);
    t.check('cancel leaves data, workspace and session byte-identical', before === await snapshot());
    t.check('cancel never pauses sync or mutates auth', await ev('__ga.calls.length === 0 && !syncStopping && !googleAuthBusy'));
    await ev(`__nativeReturns['GymGoogle.signIn']={token:'synthetic-token',nonce:'synthetic-nonce'}; true`);
    await run(false);
    t.check('sign-in passes token and raw nonce to Supabase', await ev(`__ga.calls.some(c => c.method==='signin' && c.args.provider==='google' && c.args.token==='synthetic-token' && c.args.nonce==='synthetic-nonce')`));
    t.check('auth mutation is quiesced and normal workspace binding follows', await ev(`__ga.calls.map(c=>c.method).join(',')==='quiesce,signin,bind' && !syncStopping`));
    t.check('sign-in itself never changes workout data', before === await ev(`JSON.stringify({state, storage: Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)]), slot:wsSlot, session:null})`));
    await ev(`__ga.calls=[]; wsSlot.owner='account-a'; true`);
    const linkedBefore = await snapshot();
    await run(true);
    t.check('linking calls linkIdentity, never sign-in or workspace bind', await ev(`__ga.calls.map(c=>c.method).join(',')==='quiesce,link'`));
    t.check('linking preserves account/workspace/workouts', linkedBefore === await snapshot());
    await ev(`__ga.calls=[]; __ga.error={code:'identity_already_exists',message:'synthetic-token secret'}; true`);
    await run(true);
    t.check('already-owned identity does not fall back to sign-in', await ev(`__ga.calls.every(c=>c.method!=='signin' && c.method!=='bind') && __ga.session.user.id==='account-a' && !syncStopping`));
    t.check('provider error details/tokens are never shown', await ev(`!document.getElementById('google-account-status').textContent.includes('synthetic-token')`));
    await ev(`__ga.error=null; __ga.calls=[]; __ga.linkUser='account-b'; true`); await run(true);
    t.check('unexpected linked identity fails closed without moving data', await ev(`__ga.session===null && wsSlot.owner==='account-a' && __ga.calls.at(-1).method==='signout' && !syncStopping`));
    await ev(`__ga.linkUser=null; __ga.calls=[]; wsSlot.owner=null; __nativeReturns['GymGoogle.signIn']={__delay:120,value:{token:'synthetic-token',nonce:'synthetic-nonce'}}; true`);
    await ev(`Promise.all([communityGoogleSignIn(false),communityGoogleSignIn(false)])`);
    t.check('double tap performs one sign-in', await ev(`__ga.calls.filter(c=>c.method==='signin').length===1`));
    await ev(`__ga.session=null; __ga.calls=[]; setTimeout(()=>{__ga.session={user:{id:'changed-account'}}},20); true`); await run(false);
    t.check('session change during chooser aborts before auth mutation', await ev(`__ga.calls.every(c=>c.method!=='signin' && c.method!=='link') && !syncStopping`));
    await ev(`__ga.session=null; __ga.calls=[]; __nativeReturns['GymGoogle.signIn']={token:'synthetic-token'}; true`); await run(false);
    t.check('missing nonce is rejected before auth mutation', await ev('__ga.calls.length===0 && !googleAuthBusy'));
    for (const lang of ['sk','en','es','pt-BR','fr','ar']) {
      await ev(`setLang(${JSON.stringify(lang)}); renderCommunity(); true`);
      t.check(lang + ': Google strings and sign-in label available', await ev(`['signin','connect','unavailable','linkHint','newAccount','passwordFirst','linked','error','noCredential','changed','offline'].every(k=>I18N[${JSON.stringify(lang)}]['google.'+k]) && document.querySelector('[data-community-action="google-signin"]').textContent===t('google.signin')`));
    }
    const web = await openApp({ name:'google-web', debugPort:9920, native:false, work });
    t.check('web retains email flow without Google controls', await web.p.eval(`googleSignInHtml()==='' && !googleReady()`));
    t.check('no page errors', !errors.length && !web.errors.length, errors);
    console.log(`==== checks: ${t.pass} passed, ${t.fail} failed ====`);
    process.exitCode = t.fail ? 1 : 0;
  } finally { closeAll(); server.close(); }
})().catch(e => { console.error(e); closeAll(); process.exitCode=1; });
