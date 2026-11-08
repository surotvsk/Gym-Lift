'use strict';
/* LOCAL ONLY. Synthetic users; restores migration state. No real push delivery. */
const path=require('path'), crypto=require('crypto');
const L=require('./lib'); const {check,sql,sqlVal,lit,errText}=L;
const root=path.resolve(__dirname,'../../supabase');
const up=path.join(root,'migrations/0018_feed_presence.sql'), down=path.join(root,'rollback/0018_down.sql');
let moderator;
const users=[]; const pause=()=>new Promise(r=>setTimeout(r,600));
async function member(tag){const u=await L.newUser('p7-'+tag);users.push(u);const r=await u.c.rpc('community_join');if(r.error)throw Error(errText(r));return u;}
const reload=async()=>{sql("notify pgrst, 'reload schema'");await pause();};
async function feed(u,args={}){const r=await u.c.rpc('community_feed_ranked',args);if(r.error)throw Error(errText(r));return r.data;}
function post(u,minutes,status='approved',visibility='public') {
 const id=crypto.randomUUID();
 sql(`begin; select set_config('request.jwt.claim.sub',${lit(u.id)},true); insert into public.posts(id,user_id,caption,visibility) values(${lit(id)},${lit(u.id)},'synthetic phase7',${lit(visibility)}); select set_config('request.jwt.claim.sub',${lit(moderator.id)},true); update public.posts set status=${lit(status)},created_at=now()-interval '${minutes} minutes',published_at=now()-interval '${minutes} minutes' where id=${lit(id)}; commit;`);
 return id;
}
(async()=>{
 let saved;
 try {
  saved=L.rollbackFrom(18); await reload();
  check('base is v9',sqlVal('select public.community_social_version()')==='9');
  L.sqlFile(up);await reload();
  check('version10 installed',sqlVal('select public.community_social_version()')==='10');
  let twice=false;try{L.sqlFile(up);}catch(e){twice=/already applied/.test(String(e.stderr||e.message));}check('repeat migration refused',twice);
  moderator=await member('mod');L.makeModerator(moderator);
  const a=await member('a'),b=await member('b'),c=await member('c'),d=await member('d'), outsider=await member('outsider');
  sql(`insert into public.blocks(blocker_id,blocked_id) select ${lit(a.id)},id from public.profiles where id not in (${users.map(u=>lit(u.id)).join(',')}) on conflict do nothing`);
  sql(`insert into public.follows(follower_id,followee_id) values(${lit(a.id)},${lit(b.id)})`);
  sql(`insert into public.friendships(user_a,user_b) values(least(${lit(a.id)}::uuid,${lit(d.id)}::uuid),greatest(${lit(a.id)}::uuid,${lit(d.id)}::uuid))`);
  const followed=post(b,90),friend=post(d,100,'approved','friends');
  const c1=post(c,10),c2=post(c,11),c3=post(c,12),other=post(outsider,14);
  const pending=post(c,1,'pending'),priv=post(c,2,'approved','friends');
  sql(`insert into public.likes(post_id,user_id) values(${lit(other)},${lit(b.id)})`);
  let all=await feed(a,{p_limit:50});
  const ours=new Set([followed,friend,c1,c2,c3,other,pending,priv]);
  let rows=all.filter(x=>ours.has(x.post_id));
  check('friends/follows first in publication order',rows[0].post_id===followed&&rows[1].post_id===friend&&rows[1].rank_tier===1);
  check('suggested labels only tier2',rows.every(x=>x.suggested===(x.rank_tier===2)));
  check('five-minute followed-like boost',rows.findIndex(x=>x.post_id===other)<rows.findIndex(x=>x.post_id===c1));
  check('pending/private stranger posts excluded',!all.some(x=>[pending,priv].includes(x.post_id)));
  check('liker identities not disclosed',rows.every(x=>!('likers' in x)&&!('score_at' in x)));
  const stranger=await feed(outsider,{p_limit:50});
  check('new member has only suggestions',stranger.every(x=>x.rank_tier===2));
  const historySize=Number(sqlVal('select count(*) from public.posts')),started=Date.now();
  const deep=await feed(outsider,{p_before_tier:2,p_before:'1900-01-01T00:00:00Z',p_before_id:'00000000-0000-0000-0000-000000000000',p_asof:new Date().toISOString(),p_limit:1});
  const elapsed=Date.now()-started;
  check('deep cursor finishes within5 seconds without payload materialization',deep.length===0&&elapsed<5000,elapsed+'ms / '+historySize+' local posts');
  console.log('  PERF deep cursor: '+elapsed+'ms / '+historySize+' local posts');

  check('anon cannot call feed or boost',!!(await L.anon().rpc('community_feed_ranked')).error&&!!(await L.anon().rpc('community_feed_boost',{p_post:other,p_asof:new Date().toISOString()})).error);
  const first=await feed(a,{p_limit:1}), page=first.slice();let cursor=first[0];
  const fresh=post(c,0);
  for(let i=0;i<100&&cursor;i++){
    const next=await feed(a,{p_limit:1,p_before_tier:cursor.rank_tier,p_before:cursor.rank_at,p_before_id:cursor.post_id,p_asof:cursor.rank_asof});
    page.push(...next);cursor=next[0];
  }
  check('keyset pages have no duplicates',new Set(page.map(x=>x.post_id)).size===page.length);
  check('page traversal matches snapshot order',JSON.stringify(page.map(x=>x.post_id))===JSON.stringify(all.map(x=>x.post_id)));
  check('new posts wait for refresh',!page.some(x=>x.post_id===fresh));
  check('invalid partial cursor refused',!!(await a.c.rpc('community_feed_ranked',{p_before_tier:2})).error);
  // Isolate the author cap in a reader with two authors; other fixtures remain invisible through blocks.
  sql(`begin; select set_config('request.jwt.claim.sub',${lit(moderator.id)},true); delete from public.likes where post_id=${lit(other)}; update public.posts set published_at=now()-interval '30 minutes' where id=${lit(other)}; commit;`);
  rows=(await feed(a,{p_limit:50})).filter(x=>[c1,c2,c3,other,fresh].includes(x.post_id));
  check('third consecutive author deferred across page boundaries',rows[2].post_id===other);
  sql(`insert into public.blocks(blocker_id,blocked_id) values(${lit(c.id)},${lit(a.id)})`);
  check('reverse block hides all author posts',!(await feed(a,{p_limit:50})).some(x=>x.author_id===c.id));
  sql(`update public.profiles set suspended=true where id=${lit(b.id)}`);
  check('suspended author excluded',!(await feed(a,{p_limit:50})).some(x=>x.author_id===b.id));
  sql(`update public.profiles set suspended=false where id=${lit(b.id)}`);
  sql(`delete from public.community_consents where user_id=${lit(outsider.id)}`);
  check('missing age consent sees no ranked posts',(await feed(outsider)).length===0);
  const opened=await a.c.rpc('open_chat',{p_friend:d.id});if(opened.error)throw Error(errText(opened)); const conv=opened.data;
  const v1=crypto.randomUUID(),v2=crypto.randomUUID();
  const view=(u,v,cid=conv)=>u.c.rpc('chat_viewing',{p_viewer:v,p_conversation:cid});
  check('participant creates viewing lease',!(await view(d,v1)).error);
  check('server bounds expiry to30 seconds',sqlVal(`select until>now() and until<=now()+interval '30 seconds' from public.chat_presence where user_id=${lit(d.id)}`)==='t');
  check('outsider cannot set chat presence',!!(await view(b,v1)).error);
  check('anon cannot heartbeat',!!(await L.anon().rpc('chat_viewing',{p_viewer:v1,p_conversation:conv})).error);
  check('authenticated cannot read presence table',!!(await a.c.from('chat_presence').select('*')).error);
  check('authenticated cannot bypass targeting or call legacy helper',!!(await a.c.rpc('push_targets',{p_sender:a.id,p_message:1})).error&&!!(await L.admin.rpc('push_targets_v9',{p_sender:a.id,p_message:1})).error);
  const msg=async()=>{sql(`delete from public.push_sent where conversation_id=${lit(conv)}`);const r=await a.c.from('messages').insert({conversation_id:conv,sender_id:a.id,body:'synthetic'}).select('id').single();if(r.error)throw Error(errText(r));return r.data.id;};
  const target=async()=>{const r=await L.admin.rpc('push_targets',{p_sender:a.id,p_message:await msg()});if(r.error)throw Error(errText(r));return r.data;};
  check('target reports recipient viewing',(await target()).viewing===true);
  await view(d,v1,null);
  const followup=await a.c.from('messages').insert({conversation_id:conv,sender_id:a.id,body:'after closing'}).select('id').single();
  const immediate=await L.admin.rpc('push_targets',{p_sender:a.id,p_message:followup.data.id});
  check('suppressed push does not start cooldown after closing',immediate.data?.ok===true&&immediate.data?.viewing===false);
  await view(d,v1);
  sql(`insert into public.push_subscriptions(user_id,endpoint,p256dh,auth) values(${lit(d.id)},'https://web.push.apple.com/synthetic-phase7-${L.runTag}',${lit('A'.repeat(87))},${lit('A'.repeat(22))})`);
  const apple=await target();
  check('viewing Apple recipient keeps target for visible delivery',apple.viewing===true&&apple.subs.length===1);
  check('Apple delivery retains normal cooldown',sqlVal(`select notified from public.push_sent where conversation_id=${lit(conv)} order by message_id desc limit 1`)==='t');
  sql(`delete from public.push_subscriptions where user_id=${lit(d.id)}`);
  await view(d,v2);await view(d,v1,null);
  check('closing one tab preserves other lease',(await target()).viewing===true);
  await view(d,v2,null);check('clear restores delivery',(await target()).viewing===false);
  await view(d,v1);sql(`update public.chat_presence set until=now()-interval '1 second'`);
  check('expired lease cannot suppress',(await target()).viewing===false);
  await view(d,v1);sql(`update public.conversations set closed_at=now() where id=${lit(conv)}`);
  check('closed chat rejects heartbeat',!!(await view(d,v1)).error);
  sql(`delete from public.conversations where id=${lit(conv)}`);
  check('chat deletion cascades leases',sqlVal(`select count(*) from public.chat_presence where conversation_id=${lit(conv)}`)==='0');
  const kept=sqlVal(`select count(*) from public.posts where id=${lit(followed)}`);
  L.sqlFile(down);await reload();
  check('rollback restores v9',sqlVal('select public.community_social_version()')==='9');
  check('rollback keeps posts',sqlVal(`select count(*) from public.posts where id=${lit(followed)}`)===kept);
  check('rank RPC missing after rollback',!!(await a.c.rpc('community_feed_ranked')).error);
  check('legacy feed remains usable',!(await a.c.rpc('community_feed',{p_scope:'everyone'})).error);
 } catch(e){check('no exception',false,String(e.message).slice(0,1500));}
 finally{
  try{if(sqlVal("select to_regclass('public.chat_presence') is not null")==='t')L.sqlFile(down);if(saved)L.reapply(saved);await reload();}catch(e){check('restore migration state',false,e.message);}
  for(const u of users){const r=await L.admin.auth.admin.deleteUser(u.id);if(r.error)check('cleanup synthetic user',false,r.error.message);}
  console.log(`\n==== checks: ${L.results.pass} passed, ${L.results.fail} failed ====`);process.exitCode=L.results.fail?1:0;
 }
})();
