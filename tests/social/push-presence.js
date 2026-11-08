'use strict';
const assert=require('node:assert/strict');
(async()=>{
 const {suppressForViewing:s}=await import('../../supabase/functions/push/presence.ts');let pass=0;
 const check=(name,value)=>{assert.equal(value,true,name);pass++;};
 check('native FCM suppressed when viewing',s(true));
 check('native delivered with no lease',!s(false));
 check('old backend fails open',!s(undefined));
 check('nonboolean lease fails open',!s('true'));
 check('Chrome suppressed',s(true,'https://fcm.googleapis.com/send/a'));
 check('Firefox suppressed',s(true,'https://updates.push.services.mozilla.com/a'));
 check('Apple always shown',!s(true,'https://web.push.apple.com/a'));
 check('Apple root always shown',!s(true,'https://push.apple.com/a'));
 check('invalid endpoint fails open',!s(true,'invalid'));
 check('nonviewed Chrome shown',!s(false,'https://fcm.googleapis.com/send/a'));
 console.log(`${pass} passed, 0 failed`);
})().catch(e=>{console.error(e.message);process.exitCode=1;});
