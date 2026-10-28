'use strict';
/* GymQuest 0011 in the app (real headless Chrome, LOCAL test stack, disposable local users):
   chat replies and reactions, sharing a plan / a finished workout in chat and saving it,
   posts with a shared plan (composer) and "Share to Community" right after a workout,
   the moderator sees the shared item, top 3 achievements on profiles (+ hide switch),
   6 languages, screenshots, and the fallback when 0011 is rolled back.

     GQ_COMMUNITY_CONFIG=<local config> node tests/social/ui-extras.js */

const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('./lib');
const { startServer, Browser, waitFor } = require('../sync/lib');
const HELPERS = require('../sync/helpers');
const { check, section, sql, sqlVal, lit, errText } = L;

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-social-extras');
const PROFILES = path.join(WORK, 'profiles');
const SHOTS = path.join(WORK, 'shots');
let nextPort = 9960;
let reapplyLater = null;   // migrácie vrátené rollbackom – obnovia sa vždy, aj po chybe
const browsers = [];
const pages = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;

async function device(name) {
  const b = new Browser(name + '-' + Date.now().toString(36), nextPort++, PROFILES);
  browsers.push(b);
  const p = await b.launch();
  p.logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error') p.logs.push(e.entry.text + ' ' + (e.entry.url || '')); });
  await p.navigate(BASE);
  await p.eval(HELPERS);
  pages.push([name, p]);
  return p;
}
async function signIn(p, u) {
  await p.eval('window.__gq.signIn(' + J(u.email) + ',' + J(u.password) + ')');
  await p.ready();
  await p.eval(HELPERS);
  await p.eval(`(state.settings.communityOptIn = true, persistState(), setLang('en'), true)`);
  await p.eval(`(switchTab('komunita'), true)`);
  await waitFor(() => p.eval(`!!communityProfile && communityVersion >= 4`), 30000, 'profile');
}
async function rendered(p) {
  await waitFor(() => p.eval(`(() => { const b = document.getElementById('community-body'); return !!b && b.innerText.indexOf(t('community.loading')) < 0 && b.innerText.length > 0; })()`), 30000, 'render');
  await wait(500);
}
async function view(p, v) { await p.eval(`(switchTab('komunita'), communitySetView(${J(v)}), true)`); await rendered(p); }
/* Po otvorení chatu sa čaká na skutočne vykreslený chat (správy), nie na obsah predchádzajúcej obrazovky. */
async function chatShown(p) {
  await waitFor(() => p.eval(`(() => { const box = document.getElementById('community-chat-msgs'); return communityView === 'chat' && communityChatMeta !== null && !!box && box.querySelectorAll('.cmsg').length === communityChatMsgs.length && !!(box.querySelector('.cmsg') || box.querySelector('.empty-state')); })()`), 30000, 'chat shown');
  await wait(300);
}
async function click(p, selector) {
  await waitFor(() => p.eval(`(() => { const el = document.querySelector(${J(selector)}); if (!el || el.disabled) return false; el.click(); return true; })()`), 15000, 'element ' + selector);
  await wait(500);
}
async function shot(p, name, selector) {
  await p.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await wait(400);
  if (selector) await p.eval(`(() => { const el = document.querySelector(${J(selector)}); if (el) el.scrollIntoView({ block: 'center' }); return true; })()`);
  await wait(300);
  const r = await p.c.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64'));
  await p.c.send('Emulation.clearDeviceMetricsOverride');
}
const bodyText = (p) => p.eval(`document.getElementById('community-body').innerText`);
async function member(tag, name) {
  const u = await L.newUser('uix-' + tag);
  u.name = name + '_' + L.runTag.slice(-5);
  const r = await u.c.from('profiles').update({ username: u.name }).eq('id', u.id).select('id');
  if (r.error) throw new Error('rename ' + errText(r));
  await u.c.rpc('community_join');
  return u;
}
async function typeMsg(p, text) {
  await p.eval(`(() => { const el = document.getElementById('community-chat-text'); el.value = ${J(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await click(p, '[data-community-action="chat-send"]');
}

(async () => {
  if (Number(sqlVal('select public.community_social_version()')) < 5) throw new Error('0011 must be applied');
  if (!process.env.GQ_COMMUNITY_CONFIG) throw new Error('GQ_COMMUNITY_CONFIG required');
  fs.mkdirSync(PROFILES, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await startServer(PORT, { new: REPO });
  /* Moderátor vidí 50 najstarších čakajúcich príspevkov – staré zvyšky z predchádzajúcich behov (len lokálny
     testovací server) sa zamietnu, aby nový testovací príspevok nebol mimo fronty. */
  sql("begin; set local session_replication_role = replica; update public.posts set status = 'rejected' where status = 'pending' and created_at < now() - interval '10 minutes'; commit;");
  const M = await member('mod', 'mia'); L.makeModerator(M);
  const A = await member('a', 'ada'), B = await member('b', 'ben');
  const req = await A.c.from('friend_requests').insert({ from_id: A.id, to_id: B.id }).select('id').single();
  await B.c.rpc('accept_friend_request', { p_request: req.data.id });
  const conv = (await A.c.rpc('open_chat', { p_friend: B.id })).data;
  try {
    const pA = await device('A');
    await signIn(pA, A);
    check('server is at version 5+ in the app', (await pA.eval('communityVersion')) >= 5);
    /* A: plán a dokončený tréning, aby bolo čo zdieľať; úspechy pre profil. */
    await pA.eval(`(() => {
      state.plans['sharetest'] = { id: 'sharetest', builtin: false, customName: 'Push day', location: null,
        exercises: [{ id: 'bench-press', name: 'Bench press', builtin: true, sets: 4, reps: 8, weight: 60 }, { name: 'Cable flyes', sets: 3, reps: 12, weight: 15 }] };
      if (!state.planOrder.includes('sharetest')) state.planOrder.push('sharetest');
      selectedPlan = 'sharetest'; saveState(); return true; })()`);
    for (let i = 0; i < 6; i++) await pA.eval(`window.__gq.addWorkout('w${i}', '2026-09-${String(10 + i).padStart(2, '0')}')`);

    section('chat: share a plan, reply, react, save');
    await pA.eval(`(communityOpenChat(${J(conv)}), true)`);
    await rendered(pA);
    await chatShown(pA);
    await click(pA, '[data-community-action="chat-share-open"]');
    check('share picker lists the plans', (await bodyText(pA)).includes('Push day'));
    await click(pA, '[data-community-action="chat-share-plan"][data-plan="sharetest"]');
    await waitFor(() => sqlVal(`select count(*) from public.messages where conversation_id = ${lit(conv)} and attachment is not null`) === '1', 15000, 'shared plan message');
    check('the plan was sent as a message with a shared item', sqlVal(`select attachment->>'name' || ':' || jsonb_array_length(attachment->'exercises') from public.messages where conversation_id = ${lit(conv)} and attachment is not null`) === 'Push day:2');
    check('the message also has a text line (for older app versions)', /Push day/.test(sqlVal(`select body from public.messages where conversation_id = ${lit(conv)} and attachment is not null`)));
    check('A sees the plan card in the chat', await pA.eval(`!!document.querySelector('#community-chat-msgs .cshare-card[data-kind="plan"]')`));
    await click(pA, '[data-community-action="chat-share-open"]');
    await click(pA, '[data-community-action="chat-share-workout"]');
    await waitFor(() => sqlVal(`select count(*) from public.messages where conversation_id = ${lit(conv)} and attachment->>'kind' = 'workout'`) === '1', 15000, 'shared workout');
    check('a finished workout was shared too', true);

    const pB = await device('B');
    await signIn(pB, B);
    await pB.eval(`(communityOpenChat(${J(conv)}), true)`);
    await rendered(pB);
    await chatShown(pB);
    check('B sees the shared plan with its exercises (in B\'s language)', await pB.eval(`(() => { const c = document.querySelector('#community-chat-msgs .cshare-card[data-kind="plan"]'); return !!c && c.innerText.includes('Push day') && c.innerText.includes(t('exercise.bench-press')) && c.innerText.includes('Cable flyes'); })()`));
    check('B sees the finished workout card', await pB.eval(`!!document.querySelector('#community-chat-msgs .cshare-card[data-kind="workout"]')`));
    const before = await pB.eval('Object.keys(state.plans).length');
    await click(pB, '#community-chat-msgs .cshare-card[data-kind="plan"] [data-community-action="save-shared"]');
    check('Save to my plans asks first, nothing saved yet', await pB.eval(`!document.getElementById('modal-generic').hidden`)
      && (await pB.eval('Object.keys(state.plans).length')) === before);
    await click(pB, '#btn-generic-ok');
    const saved = await pB.eval(`Object.values(state.plans).find((p) => p.customName === 'Push day')`);
    check('Save to my plans: B gets a copy of the plan', (await pB.eval('Object.keys(state.plans).length')) === before + 1 && saved && saved.exercises.length === 2
      && saved.exercises[0].id === 'bench-press' && saved.exercises[0].weight === 60 && saved.exercises[1].name === 'Cable flyes', saved);
    check('the saved plan is usable in Workout', await pB.eval(`(() => { switchTab('trening'); selectedPlan = Object.values(state.plans).find((p) => p.customName === 'Push day').id; renderTrening(); return document.querySelectorAll('#exercise-list .exercise').length === 2; })()`));
    await pB.eval(`(switchTab('komunita'), communityOpenChat(${J(conv)}), true)`);
    await rendered(pB);
    await chatShown(pB);
    /* B odpovie na plán a zareaguje ❤️ */
    const planMsgId = sqlVal(`select id from public.messages where conversation_id = ${lit(conv)} and attachment->>'kind' = 'plan'`);
    await click(pB, `.cmsg[data-msg-id="${planMsgId}"] .cmsg-bubble`);
    check('tapping a message opens reactions and Reply', await pB.eval(`!!document.querySelector('.cmsg-actions .cmsg-react-opt') && !!document.querySelector('[data-community-action="msg-reply"]')`),
      await pB.eval(`({ actions: communityMsgActions, panel: !!document.querySelector('.cmsg-actions'), canSend: communityChatMeta && communityChatMeta.can_send, view: communityView, tab: activeTab, msgs: communityChatMsgs.length })`));
    await click(pB, `.cmsg-actions [data-community-action="react"][data-emoji="❤️"]`);
    await waitFor(() => sqlVal(`select count(*) from public.message_reactions where message_id = ${planMsgId}`) === '1', 10000, 'reaction');
    check('❤️ saved and shown under the message', await pB.eval(`(() => { const r = document.querySelector('.cmsg[data-msg-id="${planMsgId}"] .cmsg-react.mine'); return !!r && r.textContent.includes('❤️'); })()`));
    await click(pB, `.cmsg[data-msg-id="${planMsgId}"] .cmsg-bubble`);
    await click(pB, '[data-community-action="msg-reply"]');
    check('reply bar shows the quoted message', (await pB.eval(`document.getElementById('community-reply-bar').innerText`)).includes('Push day'));
    await typeMsg(pB, 'Looks great, I will try it!');
    await waitFor(() => sqlVal(`select count(*) from public.messages where conversation_id = ${lit(conv)} and reply_to = ${planMsgId}`) === '1', 10000, 'reply');
    check('the reply is linked to the plan message', true);
    check('the reply shows the quote in the chat', await pB.eval(`Array.from(document.querySelectorAll('.cmsg-quote')).some((q) => q.textContent.includes('Push day'))`));
    check('reply bar closes after sending (and takes no space)', await pB.eval(`document.getElementById('community-reply-bar').hidden && document.getElementById('community-reply-bar').getBoundingClientRect().height === 0`));
    await shot(pB, 'chat-share-reply-react', '.cmsg-quote');
    /* A vidí reakciu po obnovení (bez Realtime pre reakcie) */
    await pA.eval(`(communityOpenChat(${J(conv)}), true)`);
    await rendered(pA);
    await chatShown(pA);
    await waitFor(() => pA.eval(`!!document.querySelector('.cmsg[data-msg-id="${planMsgId}"] .cmsg-react')`), 20000, 'A sees reaction');
    check('A sees B\'s ❤️ on the plan', true);
    check('A sees B\'s reply live with the quote', await waitFor(() => pA.eval(`Array.from(document.querySelectorAll('.cmsg-quote')).length > 0`), 15000, 'quote on A'));
    /* Odpoveď na veľmi dlhú správu (aj slovo bez medzier): citácia sa zalomí, bublina zostane na obrazovke. */
    const longText = 'This is a very very long message to check how replies look. '.repeat(12).trim();
    await typeMsg(pA, longText);
    await typeMsg(pA, 'X'.repeat(300));
    const phone = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
    await pB.c.send('Emulation.setDeviceMetricsOverride', phone);
    await pB.eval(`(communityOpenChat(${J(conv)}), true)`);
    await rendered(pB);
    await chatShown(pB);
    for (const [needle, answer] of [['very very long', 'reply to long text'], ['XXXXXXXX', 'reply to long word']]) {
      const id = sqlVal(`select id from public.messages where conversation_id = ${lit(conv)} and body like ${lit('%' + needle + '%')} order by id desc limit 1`);
      await click(pB, `.cmsg[data-msg-id="${id}"] .cmsg-bubble`);
      await click(pB, '[data-community-action="msg-reply"]');
      check('long message (' + needle + '): reply bar stays inside the screen, at most 2 lines', await pB.eval(`(() => {
        const bar = document.getElementById('community-reply-bar').getBoundingClientRect(), tx = document.querySelector('#community-reply-bar .creply-text');
        return bar.left >= 0 && bar.right <= document.documentElement.clientWidth && tx.getBoundingClientRect().height <= 2.5 * parseFloat(getComputedStyle(tx).lineHeight || 20); })()`));
      await typeMsg(pB, answer);
    }
    const layout = (p) => p.eval(`(() => {
      const vw = document.documentElement.clientWidth;
      return Array.from(document.querySelectorAll('.cmsg-quote')).map((q) => {
        const m = q.closest('.cmsg'), b = q.closest('.cmsg-bubble').getBoundingClientRect(), body = m.querySelector('.cmsg-body').getBoundingClientRect();
        return { inside: b.left >= 0 && b.right <= vw && b.right <= m.getBoundingClientRect().right + 1 && body.left >= 0 && body.right <= vw,
          lines: Math.round((q.clientHeight - parseFloat(getComputedStyle(q).paddingTop) - parseFloat(getComputedStyle(q).paddingBottom)) / parseFloat(getComputedStyle(q).lineHeight)), wraps: q.scrollWidth <= q.clientWidth + 1 };
      }); })()`);
    await waitFor(() => pB.eval(`document.querySelectorAll('.cmsg-quote').length >= 3`), 15000, 'long quotes');
    const lB = await layout(pB);
    check('replies to long messages: every bubble and reply text inside the screen (sender)', lB.length >= 3 && lB.every((q) => q.inside), J(lB));
    check('replies to long messages: quote wrapped, at most 3 lines, no sideways overflow', lB.every((q) => q.wraps && q.lines <= 3), J(lB));
    await shot(pB, 'chat-reply-long', '.cmsg:last-of-type');
    await pA.c.send('Emulation.setDeviceMetricsOverride', phone);
    await waitFor(() => pA.eval(`document.querySelectorAll('.cmsg-quote').length >= 3`), 15000, 'long quotes on A');
    const lA = await layout(pA);
    check('replies to long messages: inside the screen and wrapped (receiver)', lA.length >= 3 && lA.every((q) => q.inside && q.wraps && q.lines <= 3), J(lA));
    await pA.c.send('Emulation.clearDeviceMetricsOverride');
    await pB.c.send('Emulation.clearDeviceMetricsOverride');
    /* Ťuknutie na citáciu presunie chat na pôvodnú správu a na chvíľu ju zvýrazní. */
    await pB.c.send('Emulation.setDeviceMetricsOverride', phone);
    const longId = sqlVal(`select id from public.messages where conversation_id = ${lit(conv)} and body like '%very very long%' order by id desc limit 1`);
    const replyId = sqlVal(`select id from public.messages where conversation_id = ${lit(conv)} and reply_to = ${longId} order by id desc limit 1`);
    const inView = (p, id) => p.eval(`(() => { const r = document.querySelector('.cmsg[data-msg-id="${id}"] .cmsg-bubble').getBoundingClientRect(); const c = (r.top + r.bottom) / 2; return c > 0 && c < innerHeight; })()`);
    await pB.eval(`(window.scrollTo(0, document.body.scrollHeight), true)`);
    await wait(400);
    check('the quote says it leads to the original (title)', (await pB.eval(`document.querySelector('.cmsg[data-msg-id="${replyId}"] .cmsg-quote').title`)) === 'Show the original message');
    /* Pôvodná správa sa najprv odsunie mimo obrazovky (nad horný okraj). */
    await pB.eval(`(() => { const r = document.querySelector('.cmsg[data-msg-id="${longId}"]').getBoundingClientRect(); window.scrollBy(0, r.bottom + 20); return true; })()`);
    await wait(300);
    const hiddenBefore = !(await inView(pB, longId));
    await pB.eval(`(document.querySelector('.cmsg[data-msg-id="${replyId}"] .cmsg-quote').click(), true)`);
    await wait(900);
    check('the original was off-screen before the tap', hiddenBefore);
    check('tapping the quote scrolls to the original message and highlights it', (await inView(pB, longId))
      && await pB.eval(`document.querySelector('.cmsg[data-msg-id="${longId}"]').classList.contains('cmsg-flash')`));
    check('tapping the quote does not open the message menu', await pB.eval(`communityMsgActions === null && !document.querySelector('.cmsg-actions')`));
    await shot(pB, 'chat-jump-original', `.cmsg[data-msg-id="${longId}"]`);
    await pB.c.send('Emulation.setDeviceMetricsOverride', phone);
    await wait(1900);
    check('the highlight goes away after a moment', await pB.eval(`!document.querySelector('.cmsg-flash')`));
    /* Klávesnica / čítačka: menu odpovede má "Zobraziť pôvodnú správu". */
    await pB.eval(`(window.scrollTo(0, document.body.scrollHeight), true)`);
    await click(pB, `.cmsg[data-msg-id="${replyId}"] .cmsg-bubble`);
    check('the reply\'s menu offers "Show the original message"', await pB.eval(`!!document.querySelector('.cmsg-actions [data-community-action="goto-msg"][data-msg="${longId}"]')`));
    check('a message that is not a reply has no such button', await pB.eval(`(() => { communityToggleMsgActions(${J(longId)}); return !document.querySelector('.cmsg-actions [data-community-action="goto-msg"]'); })()`));
    await click(pB, `.cmsg[data-msg-id="${replyId}"] .cmsg-bubble`);
    await pB.eval(`(document.querySelector('.cmsg-actions [data-community-action="goto-msg"]').click(), true)`);
    await wait(900);
    check('the menu button also jumps to the original and closes the menu', (await inView(pB, longId)) && await pB.eval(`!document.querySelector('.cmsg-actions') && document.querySelector('.cmsg[data-msg-id="${longId}"]').classList.contains('cmsg-flash') && document.activeElement === document.querySelector('.cmsg[data-msg-id="${longId}"] .cmsg-bubble')`));
    /* Pôvodná správa nie je načítaná (staršia ako posledných 100) → krátka poznámka, nič sa nerozbije. */
    await pB.eval(`(() => { communityChatMsgs = communityChatMsgs.filter((m) => String(m.id) !== ${J(longId)}); communityRedrawChatMsgs(); return true; })()`);
    await pB.eval(`(document.querySelector('.cmsg[data-msg-id="${replyId}"] .cmsg-quote').click(), true)`);
    await wait(300);
    check('original not loaded: a short note says so under the reply', (await pB.eval(`(document.querySelector('.cmsg[data-msg-id="${replyId}"] .cmsg-gone') || {}).textContent`)) === 'The original message is no longer in this chat.');
    await pB.eval(`(document.querySelector('.cmsg[data-msg-id="${replyId}"] .cmsg-quote').click(), true)`);
    check('tapping again does not stack notes', (await pB.eval(`document.querySelectorAll('.cmsg-gone').length`)) === 1);
    await wait(3800);
    check('the note disappears by itself', await pB.eval(`!document.querySelector('.cmsg-gone')`));
    await pB.c.send('Emulation.clearDeviceMetricsOverride');
    await pB.eval(`(communityOpenChat(${J(conv)}), true)`);
    await rendered(pB);
    await chatShown(pB);
    /* zmena a zrušenie reakcie */
    await click(pB, `.cmsg[data-msg-id="${planMsgId}"] .cmsg-bubble`);
    await click(pB, `.cmsg-actions [data-community-action="react"][data-emoji="🔥"]`);
    await waitFor(() => sqlVal(`select emoji from public.message_reactions where message_id = ${planMsgId}`) === '🔥', 10000, 'changed reaction');
    check('changing the reaction to 🔥 replaces ❤️', true);
    await click(pB, `.cmsg[data-msg-id="${planMsgId}"] .cmsg-react.mine`);
    await waitFor(() => sqlVal(`select count(*) from public.message_reactions where message_id = ${planMsgId}`) === '0', 10000, 'removed reaction');
    check('tapping my reaction removes it', true);

    section('posts: shared plan in the composer, moderation, feed, save');
    await view(pA, 'compose');
    check('composer offers "Attach my current plan" and "Attach my last workout"', await pA.eval(`!!document.querySelector('[data-community-action="compose-share-plan"]') && !!document.querySelector('[data-community-action="compose-share-workout"]')`));
    await click(pA, '[data-community-action="compose-share-plan"]');
    check('the attached plan is previewed and the text prefilled', await pA.eval(`!!document.querySelector('.cshare-draft .cshare-card') && document.getElementById('community-compose-text').value.includes('Push day')`));
    await pA.eval(`(() => { const el = document.getElementById('community-compose-text'); el.value = 'My push routine, try it!'; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await shot(pA, 'compose-with-plan', '.cshare-draft');
    await click(pA, '[data-community-action="compose-publish"]');
    await waitFor(() => sqlVal(`select count(*) from public.posts p join public.post_attachments a on a.post_id = p.id where p.user_id = ${lit(A.id)}`) === '1', 15000, 'post with plan');
    const postId = sqlVal(`select p.id from public.posts p join public.post_attachments a on a.post_id = p.id where p.user_id = ${lit(A.id)}`);
    check('post created with the plan, waiting for review', sqlVal(`select status || ':' || caption from public.posts where id = ${lit(postId)}`) === 'pending:My push routine, try it!');
    check('My posts shows the shared plan', (await bodyText(pA)).includes('Push day'));
    const pM = await device('M');
    await signIn(pM, M);
    await view(pM, 'moderate');
    check('the moderator sees the shared plan in the review queue', await pM.eval(`(() => { const c = document.querySelector('.community-card[data-post="${postId}"] .cshare-card'); return !!c && c.innerText.includes('Push day'); })()`));
    await click(pM, `[data-community-action="approve"][data-post="${postId}"]`);
    await waitFor(() => sqlVal(`select status from public.posts where id = ${lit(postId)}`) === 'approved', 15000, 'approve');
    await view(pB, 'feed');
    await waitFor(() => pB.eval(`!!document.querySelector('.cpost[data-post="${postId}"] .cshare-card')`), 20000, 'feed card');
    check('the post shows the plan card in the feed', true);
    await shot(pB, 'feed-post-with-plan', `.cpost[data-post="${postId}"]`);
    const n2 = await pB.eval('Object.keys(state.plans).length');
    await click(pB, `.cpost[data-post="${postId}"] [data-community-action="save-shared"]`);
    check('Save to my plans asks first, nothing saved yet', await pB.eval(`!document.getElementById('modal-generic').hidden`)
      && (await pB.eval('Object.keys(state.plans).length')) === n2);
    await click(pB, '#btn-generic-ok');
    check('saving from the feed adds a plan (name made unique: "Push day (2)")', (await pB.eval('Object.keys(state.plans).length')) === n2 + 1
      && await pB.eval(`Object.values(state.plans).some((p) => p.customName === 'Push day (2)')`));

    section('share right after finishing a workout');
    await pA.eval(`(() => { switchTab('trening'); selectedPlan = 'sharetest'; renderTrening(); return true; })()`);
    await pA.eval(`(document.querySelectorAll('#exercise-list .exercise')[0].querySelectorAll('.set-btn')[0].click(), true)`);
    await pA.eval(`(finishWorkout(), confirmFinish(), true)`);
    await wait(400);
    check('the result window offers "Share to Community"', await pA.eval(`!document.getElementById('btn-result-share').hidden`));
    await shot(pA, 'result-share-button', '#btn-result-share');
    await click(pA, '#btn-result-share');
    await rendered(pA);
    check('it opens the composer with the workout attached and a text', await pA.eval(`communityView === 'compose' && !!document.querySelector('.cshare-draft .cshare-card[data-kind="workout"]') && document.getElementById('community-compose-text').value.includes('Push day')`));
    await click(pA, '[data-community-action="compose-publish"]');
    await waitFor(() => sqlVal(`select count(*) from public.post_attachments a join public.posts p on p.id = a.post_id where p.user_id = ${lit(A.id)} and a.data->>'kind' = 'workout'`) === '1', 15000, 'workout post');
    check('the finished workout was posted for review', true);

    section('profile: top 3 achievements');
    await view(pA, 'profile');
    await waitFor(() => pA.eval(`!!document.querySelector('.cprofile-ach-item')`), 15000, 'own achievements');
    const own = await pA.eval(`Array.from(document.querySelectorAll('.cprofile-ach-item')).map((x) => x.innerText.replace(/\\s+/g, ' ').trim())`);
    check('own profile shows up to 3 achievements', own.length >= 1 && own.length <= 3, own);
    await view(pA, 'editprofile');   // v80: prepínač je v Upraviť profil, úspechy v hlavičke profilu
    check('the hide switch is on by default', await pA.eval(`document.getElementById('community-profile-ach').checked`));
    await pB.eval(`(communityOpenUser ? communityOpenUser(${J(A.id)}) : communityGo('user', () => { communityViewUser = ${J(A.id)}; }), true)`).catch(() => {});
    await pB.eval(`(communityGo('user', () => { communityViewUser = ${J(A.id)}; }), true)`);
    await rendered(pB);
    const seen = await pB.eval(`Array.from(document.querySelectorAll('.cprofile-ach-item')).map((x) => x.innerText.replace(/\\s+/g, ' ').trim())`);
    check('a friend sees the same top achievements', J(seen) === J(own), { seen, own });
    await shot(pB, 'profile-achievements', '.cprofile-ach');
    await view(pA, 'editprofile');
    await click(pA, '#community-profile-ach');
    await waitFor(() => sqlVal(`select hidden from public.profile_achievements where user_id = ${lit(A.id)}`) === 't', 10000, 'hidden');
    await pB.eval(`(communityGo('user', () => { communityViewUser = ${J(A.id)}; }), true)`);
    await rendered(pB);
    check('after hiding, the friend sees none', await pB.eval(`!document.querySelector('.cprofile-ach-item')`));
    await view(pA, 'profile');
    check('the owner still sees them with a "hidden" note', await pA.eval(`!!document.querySelector('.cprofile-ach-item') && document.querySelector('.cprofile-ach').innerText.includes(t('profileAch.hiddenNote'))`));
    await view(pA, 'editprofile');
    await click(pA, '#community-profile-ach');

    section('languages');
    await pB.eval(`(communityOpenChat(${J(conv)}), true)`);
    await rendered(pB);
    await chatShown(pB);
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      await pB.eval(`(setLang(${J(lang)}), renderCommunity(), true)`);
      await rendered(pB);
      await waitFor(() => pB.eval(`document.getElementById('community-body').innerText.includes(t('share.saveAsPlan'))`), 15000, 'chat in ' + lang).catch(() => {});
      const txt = await bodyText(pB);
      check(lang + ': chat with shared items translated (no raw keys)', !/share\.|chat\.|profileAch\./.test(txt) && txt.includes(await pB.eval(`t('share.saveAsPlan')`)),
        J({ txt: txt.slice(0, 200), view: await pB.eval('communityView'), tab: await pB.eval('activeTab'), chat: await pB.eval('communityChatId') }));
      if (lang === 'ar') await shot(pB, 'chat-ar', '.cshare-card');
    }
    await pB.eval(`(setLang('en'), true)`);

    section('fallback when 0011 is rolled back');
    const undone = L.rollbackFrom(11);
    reapplyLater = undone;
    await wait(1500);
    await pB.reload(); await pB.eval(HELPERS);
    await pB.eval(`(switchTab('komunita'), true)`);
    await waitFor(() => pB.eval(`!!communityProfile && communityVersion === 4`), 30000, 'version 4');
    await pB.eval(`(communityOpenChat(${J(conv)}), true)`);
    /* nový schema cache po rollbacku chvíľu trvá – čaká sa na skutočne vykreslený chat, nie na starý obsah */
    await waitFor(() => pB.eval(`communityView === 'chat' && !!document.getElementById('community-chat-msgs')`), 30000, 'chat after rollback');
    await wait(500);
    const fb = await pB.eval(`({ text: document.getElementById('community-body').innerText.slice(0, 300), view: communityView, tab: activeTab, v: communityVersion, share: !!document.querySelector('[data-community-action="chat-share-open"]'), card: !!document.querySelector('.cshare-card') })`);
    check('chat still works without 0011 (text lines visible, no share/react UI)', fb.text.includes('Push day') && !fb.share && !fb.card, J(fb));
    await typeMsg(pB, 'plain after rollback');
    check('sending a plain message still works', (await bodyText(pB)).includes('plain after rollback'));
    await view(pB, 'compose');
    check('composer has no attach buttons without 0011', await pB.eval(`!document.querySelector('[data-community-action="compose-share-plan"]')`));
    L.reapply(undone); reapplyLater = null;
    check('0011 (and later) re-applied', sqlVal('select public.community_social_version()') === undone.versionBefore);

    section('no errors');
    for (const [name, p] of pages) {
      check(name + ': no exceptions', p.errors.length === 0, J(p.errors));
      /* pri vrátenom 0011 (a s ním 0014) appka raz zistí, že train_current už neexistuje (404), a prestane sa pýtať */
      const errs = p.logs.filter((l) => !/favicon|127\.0\.0\.1:54321\/(auth|rest|functions)\/v1\/.*(400|401|404)/.test(l)
        && !/status of 404 .*127\.0\.0\.1:54321\/rest\/v1\/rpc\/train_current$/.test(l));
      check(name + ': asked for train_current at most once after the rollback', p.logs.filter((l) => /rpc\/train_current/.test(l)).length <= 1, J(p.logs));
      check(name + ': no console errors', errs.length === 0, J(errs));
    }
  } catch (e) {
    check('test error', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | '));
  } finally {
    if (reapplyLater) { L.reapply(reapplyLater); console.log('  (migrations re-applied after an error)'); }
    for (const b of browsers) b.killHard(true);
    await server.close();
  }
  console.log('\n==== checks: ' + L.results.pass + ' passed, ' + L.results.fail + ' failed ====');
  process.exit(L.results.fail ? 1 : 0);
})().catch((e) => { console.error(e); for (const b of browsers) b.killHard(true); process.exit(2); });
