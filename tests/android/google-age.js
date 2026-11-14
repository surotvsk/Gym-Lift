'use strict';
/* Google nový účet + 16+ tiket (v109): syntetický token, mock RPC/auth, reálny prehliadač, žiadny server. */
const { counter, startServerOnce, openApp, closeAll } = require('./lib-native');
const fs = require('fs');
const work = '/tmp/gq-native-google-age';
fs.mkdirSync(work, { recursive: true });
const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = 'h.' + b64u({ email: 'Nova.Osoba@Example.test', sub: '1' }) + '.s';
(async () => {
  const t = counter(), server = await startServerOnce(work);
  try {
    const { p, errors } = await openApp({ name: 'google-age', debugPort: 9921, native: true, work });
    const ev = s => p.eval(s);
    const logs = [];
    await ev(`window.__ga = { session: null, calls: [], signinError: null, rpcError: null };
      GYMQUEST_COMMUNITY = { supabaseUrl: 'http://127.0.0.1:54321', supabaseAnonKey: 'synthetic', googleWebClientId: '123-test.apps.googleusercontent.com' };
      window.__con = []; ['log','warn','error','info'].forEach(k => { const o = console[k]; console[k] = (...a) => { __con.push(a.map(String).join(' ')); o.apply(console, a); }; });
      renderCommunity = () => { document.getElementById('community-body').innerHTML = communityAuthHtml(); };
      wsBindSession = async () => { __ga.calls.push('bind'); };
      communityClientRef = {
        rpc: async (fn, args) => { if (fn === 'community_social_version') return { error: { code: '42501', message: 'permission denied' } };
          if (fn === 'age_ticket_supported') { return __ga.probe === 'missing' ? { error: { code: 'PGRST202', message: 'nf' } } : { data: true, error: null }; }
          __ga.calls.push('rpc:' + fn + ':' + (args && args.p_email)); return __ga.rpcError ? { error: __ga.rpcError } : { data: null, error: null }; },
        auth: {
          getSession: async () => ({ data: { session: __ga.session }, error: null }),
          signInWithIdToken: async () => { __ga.calls.push('signin'); if (__ga.signinError) return { error: __ga.signinError }; __ga.session = { user: { id: 'u1' } }; return { data: __ga.session, error: null }; },
          signOut: async () => ({ error: null })
        } };
      __nativeReturns['GymGoogle.signIn'] = { token: ${JSON.stringify(TOKEN)}, nonce: 'n' };
      true`);
    const card = async (ticked, ver) => ev(`communityVersion = ${ver === 12 ? 0 : ver}; googleAgeSupported = ${ver === 12 ? 'null' : 'false'}; __ga.probe = null; communityAge16 = ${ticked}; __ga.calls = []; __ga.session = null; __ga.signinError = null; __ga.rpcError = null; communityMessage=''; renderCommunity(); true`);
    const msg = () => ev(`(document.getElementById('community-status')||{}).textContent || ''`);
    const checkbox = ticked => ev(`document.getElementById('community-age16').checked = ${ticked}; true`);

    await card(true, 12); await checkbox(true);
    await ev(`communityGoogleSignIn(false)`);
    t.check('ticked: ticket RPC with the token e-mail is called before sign-in', await ev(`__ga.calls.join(',') === 'rpc:age_ticket_create:Nova.Osoba@Example.test,signin,bind'`), await ev('__ga.calls'));

    await card(false, 12); await checkbox(false);
    await ev(`__ga.session = null; true`);
    await ev(`communityGoogleSignIn(false)`);
    t.check('unticked existing user: signs in, no ticket', await ev(`__ga.calls.join(',') === 'signin,bind'`), await ev('__ga.calls'));

    await card(false, 12); await checkbox(false);
    await ev(`__ga.signinError = { code: 'unexpected_failure', message: 'Database error saving new user' }; communityGoogleSignIn(false)`);
    await new Promise(r => setTimeout(r, 200));
    t.check('unticked new user: the new age message, no ticket', (await msg()) === await ev(`t('google.ageFirst')`) && await ev(`!__ga.calls.some(c => c.startsWith('rpc'))`), await msg());
    await ev(`__ga.calls = []; __ga.signinError = { status: 500, message: 'Database error saving new user' }; communityGoogleSignIn(false)`);
    await new Promise((r) => setTimeout(r, 400));
    t.check('unticked new user, error without a code (status 500 only): still the age message', (await msg()) === await ev(`t('google.ageFirst')`), await msg());

    t.check('signed-out v12: probe (not community_social_version) opens the gate, calls before sign-in', await ev(`communityVersion === 0 && googleAgeSupported === true`));
    await card(true, 12); await checkbox(true);
    await ev(`__ga.rpcError = { code: 'P0001', message: 'rate_limited' }; communityGoogleSignIn(false)`);
    await new Promise(r => setTimeout(r, 200));
    t.check('ticket RPC fails (rate_limited): ticked existing user still signs in', await ev(`__ga.calls.includes('signin') && __ga.calls.includes('bind')`), await ev('__ga.calls'));
    await card(true, 12); await checkbox(true);
    await ev(`__ga.probe = 'missing'; googleAgeSupported = null; communityGoogleSignIn(false)`);
    await new Promise(r => setTimeout(r, 200));
    t.check('server without age_ticket_supported: old behaviour (no ticket)', await ev(`googleAgeSupported === false && !__ga.calls.some(c => c.startsWith('rpc')) && __ga.calls.includes('signin')`), await ev('__ga.calls'));
    await card(true, 11); await checkbox(true);
    await ev(`communityGoogleSignIn(false)`);
    t.check('v11 server: old behaviour (no ticket, direct sign-in)', await ev(`__ga.calls.join(',') === 'signin,bind'`));
    await card(false, 11); await checkbox(false);
    await ev(`__ga.signinError = { code: 'unexpected_failure', message: 'x' }; communityGoogleSignIn(false)`);
    await new Promise(r => setTimeout(r, 200));
    t.check('v11 server: old text for refused new user', (await msg()) === await ev(`t('google.passwordFirst')`));
    await card(false, 11);
    t.check('v11 server: old hint under the button', await ev(`googleSignInHtml().includes(t('google.newAccount'))`));
    await card(false, 12);
    t.check('v12 server: age hint under the button', await ev(`googleSignInHtml().includes(escAttr(t('google.newAccountAge'))) || googleSignInHtml().includes(esc(t('google.newAccountAge')))`));

    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      await ev(`setLang(${JSON.stringify(lang)}); communityVersion = 12; renderCommunity(); true`);
      t.check(lang + ': new strings exist and differ from key', await ev(`['newAccountAge','ageFirst'].every(k => I18N[${JSON.stringify(lang)}]['google.'+k] && !/^google\\./.test(t('google.'+k)))`));
    }
    t.check('no token or e-mail in console or storage', await ev(`(() => { const all = __con.join('\\n') + JSON.stringify(Object.keys(localStorage).map(k => localStorage.getItem(k))); return !all.includes(${JSON.stringify(TOKEN)}) && !/nova\\.osoba/i.test(all); })()`));
    t.check('no page errors', !errors.length, errors);
    console.log(`==== checks: ${t.pass} passed, ${t.fail} failed ====`);
    process.exitCode = t.fail ? 1 : 0;
  } finally { closeAll(); server.close(); }
})().catch(e => { console.error(e); closeAll(); process.exitCode = 1; });
