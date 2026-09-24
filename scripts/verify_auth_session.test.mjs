import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/js/core/auth-session.js',import.meta.url),'utf8');
function setup() {
  const storage=new Map([['webnovels_user','{"role":"SUPER_ADMIN"}'],['webnovels_token','admin-token-1']]);
  const calls=[];let listener;let session={access_token:'real.jwt.token'};let responses=[];
  const actor={userId:'uuid',author:{id:12,pen_name:'작가',status:'APPROVED'},reader:null,admin:null};
  const auth={
    getSession:async()=>({data:{session}}),
    signInWithPassword:async input=>{session={access_token:'real.jwt.token'};calls.push(['login',input]);return {data:{session}};},
    refreshSession:async()=>{calls.push(['refresh']);return {data:{session}};},
    signOut:async()=>{session=null;listener?.('SIGNED_OUT');calls.push(['logout']);return {};},
    signUp:async input=>{calls.push(['signup',input]);return {data:{session:null}};},
    resetPasswordForEmail:async(...args)=>{calls.push(['reset',...args]);return {};},
    updateUser:async input=>{calls.push(['update',input]);return {};},
    onAuthStateChange:fn=>{listener=fn;return {};}
  };
  const context={console,location:{origin:'https://app.test'},supabaseClient:{auth},initSupabaseAdmin:()=>true,
    localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    setTimeout:()=>{},updateMemberHeader:()=>{},fetch:async(path,init)=>{
      calls.push(['fetch',path,init]);return responses.shift()||Response.json(path.includes('readiness')?{ready:true}:actor);
    }};
  context.window=context;vm.createContext(context);vm.runInContext(source,context);
  return {context,api:context.WebNovelsAuth,auth,calls,storage,actor,respond:(...r)=>responses.push(...r),event:(e,session)=>listener(e,session)};
}
test('account change awaits draft checkpoint; failed checkpoint preserves the authenticated session',async()=>{
  const s=setup();await s.api.login('writer@example.test','password');let cleared=0;
  s.context.CreatorDraftEditor={beforeAccountChange:async()=>{throw Error('quota');},onAuthLost:()=>cleared++};
  const before=s.calls.length;await assert.rejects(s.api.logout(),/quota/);assert.equal(s.api.getActor().userId,'uuid');assert.equal(s.calls.length,before);assert.equal(cleared,0);
  await assert.rejects(s.api.login('other@example.test','password'),/quota/);assert.equal(s.api.getActor().userId,'uuid');
  s.context.CreatorDraftEditor.beforeAccountChange=async()=>{};await s.api.logout();assert.equal(s.api.getActor(),null);assert.ok(cleared>0);
});
test('cached role is never authority; real login preserves password and stores no fake tokens',async()=>{
  const s=setup();assert.equal(s.api.getActor(),null);
  await s.api.login(' WRITER@example.test ',' password with spaces ');
  assert.equal(s.api.getActor().author.id,12);assert.equal(s.api.getActor().admin,null);
  assert.equal(s.calls.find(c=>c[0]==='login')[1].password,' password with spaces ');
  assert.equal(s.storage.has('webnovels_token'),false);
  assert.equal(s.calls.find(c=>c[0]==='fetch')[2].headers.Authorization,'Bearer real.jwt.token');
  await s.api.logout();assert.equal(s.api.getActor(),null);assert.equal(s.storage.size,0);
});
test('401 refreshes once; repeated denial removes authority; service failure never becomes login success',async()=>{
  const s=setup();s.respond(Response.json({error:'INVALID_SESSION'},{status:401}),Response.json(s.actor));
  await s.api.login('writer@example.test','password');assert.equal(s.calls.filter(c=>c[0]==='refresh').length,1);
  s.respond(Response.json({error:'INVALID_SESSION'},{status:401}),Response.json({error:'INVALID_SESSION'},{status:401}));
  await assert.rejects(s.api.validate(),e=>e.code==='INVALID_SESSION');assert.equal(s.api.getActor(),null);
  s.respond(Response.json({error:'DATABASE_UNAVAILABLE'},{status:503}));
  await assert.rejects(s.api.login('writer@example.test','password'),e=>e.status===503);assert.equal(s.api.getActor(),null);
});
test('a denied reader action keeps the valid account session',async()=>{
  const s=setup();await s.api.login('writer@example.test','password');
  s.respond(Response.json({error:'COMMENTS_DISABLED'},{status:403}));
  await assert.rejects(s.api.api('/api/v2/reader/hub?action=comment&workId=10&episodeId=100',
    {method:'POST',body:JSON.stringify({content:'test'})}),e=>e.code==='COMMENTS_DISABLED');
  assert.equal(s.api.getActor().userId,'uuid');
  s.respond(Response.json({error:'ACCOUNT_INACTIVE'},{status:403}));
  await assert.rejects(s.api.api('/api/v2/me'),e=>e.code==='ACCOUNT_INACTIVE');
  assert.equal(s.api.getActor(),null);
});
test('signup stops before provider when closed; confirmed account can resume without another signup',async()=>{
  const s=setup();s.respond(Response.json({error:'ONBOARDING_NOT_ACTIVATED'},{status:503}));
  await assert.rejects(s.api.signup('author','writer@example.test','password','작가이름'));
  assert.equal(s.calls.filter(c=>c[0]==='signup').length,0);
  await s.api.signup('author','writer@example.test','password','작가이름');
  const signup=s.calls.find(c=>c[0]==='signup')[1];assert.equal(signup.options.emailRedirectTo,'https://app.test/?auth=confirm');assert.equal(signup.options.data,undefined);
  await s.api.login('writer@example.test','password');
  s.respond(Response.json({created:false,actor:s.actor}));
  await s.api.complete('author','작가이름');assert.equal(s.api.getActor().author.id,12);
  assert.equal(s.calls.filter(c=>c[0]==='signup').length,1);
});
test('reset uses same-origin redirect; password update requires recovery event and signs out',async()=>{
  const s=setup();await s.api.init();await s.api.reset('writer@example.test');
  assert.equal(s.calls.find(c=>c[0]==='reset')[2].redirectTo,'https://app.test/?auth=recovery');
  await assert.rejects(s.api.changePassword('new-password'));
  s.event('PASSWORD_RECOVERY');await s.api.changePassword('new-password');
  assert.equal(s.calls.filter(c=>c[0]==='update').length,1);assert.equal(s.api.getActor(),null);
});
test('late reply cannot restore a logged-out actor',async()=>{
  const s=setup();let finish;
  s.auth.getSession=()=>new Promise(resolve=>{finish=resolve;});
  const pending=s.api.validate();await Promise.resolve();await s.api.logout();
  finish({data:{session:{access_token:'old.jwt.token'}}});
  await assert.rejects(pending,e=>e.code==='INVALID_SESSION');assert.equal(s.api.getActor(),null);
});

test('network failure does not retry a mutation with unknown outcome',async()=>{
  const s=setup();let requests=0;s.context.fetch=async()=>{requests++;throw new TypeError('network offline');};
  await assert.rejects(s.api.complete('author','작가이름'));assert.equal(requests,1);
});
test('bad credentials, provider outage and confirmation failure remain distinguishable',async()=>{
  for(const [provider,expected] of [
    [{status:400,code:'invalid_credentials'},'INVALID_CREDENTIALS'],
    [{status:503},'AUTH_UNAVAILABLE'],
    [{status:400,code:'email_not_confirmed'},'EMAIL_CONFIRMATION_REQUIRED']
  ]) {
    const s=setup();s.auth.signInWithPassword=async()=>({error:provider});
    await assert.rejects(s.api.login('writer@example.test','wrong'),e=>e.code===expected);
    assert.equal(s.api.getActor(),null);assert.equal(s.calls.filter(c=>c[0]==='fetch').length,0);
  }
});

test('repeated same-user sign-in event does not erase an open creator form',async()=>{
  const s=setup();await s.api.init();let resets=0;s.context.CreatorWorks={reset:()=>{resets++;}};
  s.event('SIGNED_IN',{user:{id:s.actor.userId}});assert.equal(resets,0);
  s.event('SIGNED_IN',{user:{id:'different-user'}});assert.equal(resets,1);
});
