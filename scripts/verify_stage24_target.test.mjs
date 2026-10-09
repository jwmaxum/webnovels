import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectRestoreTarget,targetInventorySql} from './lib/restore-target.mjs';
const sourceRef='abcdefghijklmnopqrst',targetRef='zyxwvutsrqponmlkjihg',token='sbp_synthetic';
const empty={application_tables:'0',auth_users:'0',storage_buckets:'0',storage_objects:'0',foreign_servers:'0',custom_triggers:'0',cron_present:false};
const auth={disable_signup:true,external_email_enabled:false,smtp_pass:'DO_NOT_PERSIST',external_google_secret:'DO_NOT_PERSIST'};
function mock(replies){const calls=[];return {calls,fetcher:async(url,options)=>{
  calls.push({url,options});const reply=replies.shift();if(reply instanceof Error)throw reply;
  return {ok:reply?.ok!==false,json:async()=>reply?.body};
}};}
test('missing/invalid/same production refs and missing PAT fail before any network request',async()=>{
  for(const options of [{targetRef:null},{targetRef:sourceRef},{targetRef:'https://evil.test'},
    {targetRef:'../'+targetRef},{sourceRef:'unknown'},{token:''},
    {targetRef:'postgresql://user:PRIVATE_CREDENTIAL@host/db'},{sourceRef:'PRIVATE_CREDENTIAL'}]){
    const m=mock([]);const r=await inspectRestoreTarget({sourceRef,targetRef,token,...options,fetcher:m.fetcher});
    assert.equal(r.status,'BLOCKED');assert.equal(r.restoreAllowed,false);assert.equal(m.calls.length,0);
    assert.equal(JSON.stringify(r).includes('PRIVATE_CREDENTIAL'),false);
  }
});
test('empty isolated target is an observation, never hosted restore acceptance or permission',async()=>{
  const m=mock([{body:[empty]},{body:auth}]),r=await inspectRestoreTarget({sourceRef,targetRef,token,fetcher:m.fetcher});
  assert.equal(r.status,'EMPTY_ISOLATED_TARGET_OBSERVED');assert.equal(r.emptyTargetVerified,true);
  for(const key of ['restoreAllowed','restoreExecuted','hostedRestoreAccepted','flagsChanged'])assert.equal(r[key],false);
  assert.ok(r.pending.includes('EXECUTE_HOSTED_RESTORE_AND_ROLE_STORAGE_ACCEPTANCE'));
  assert.equal(JSON.stringify(r).includes('DO_NOT_PERSIST'),false);
  assert.equal(m.calls[0].url,'https://api.supabase.com/v1/projects/'+targetRef+'/database/query/read-only');
  assert.equal(JSON.parse(m.calls[0].options.body).query,targetInventorySql);
  assert.equal(m.calls[1].options.method,'GET');
  for(const call of m.calls){assert.equal(call.options.redirect,'error');assert.ok(call.options.signal instanceof AbortSignal);}
});
test('application relations, Auth accounts and Storage bytes/metadata reject a target with existing data',async()=>{
  for(const key of ['application_tables','auth_users','storage_buckets','storage_objects']){
    const m=mock([{body:[{...empty,[key]:'1'}]},{body:auth}]);
    const r=await inspectRestoreTarget({sourceRef,targetRef,token,fetcher:m.fetcher});
    assert.equal(r.emptyTargetVerified,false);assert.ok(r.blockers.includes('TARGET_HAS_EXISTING_DATA_OR_APPLICATION_SCHEMA'));
  }
});
test('custom hooks, foreign servers and active Cron must be reviewed even without application data',async()=>{
  for(const key of ['custom_triggers','foreign_servers']){
    const m=mock([{body:[{...empty,[key]:'1'}]},{body:auth}]);
    assert.ok((await inspectRestoreTarget({sourceRef,targetRef,token,fetcher:m.fetcher})).blockers.includes('TARGET_EXTERNAL_ACTIONS_REQUIRE_REVIEW'));
  }
  for(const active of ['1','0',null]){
    const m=mock([{body:[{...empty,cron_present:true}]},{body:[{active_jobs:active}]},{body:auth}]);
    const r=await inspectRestoreTarget({sourceRef,targetRef,token,fetcher:m.fetcher});
    assert.equal(r.status,active==='0'?'EMPTY_ISOLATED_TARGET_OBSERVED':'BLOCKED');
    assert.equal(JSON.parse(m.calls[1].options.body).query,'select count(*)::text active_jobs from cron.job where active');
  }
});
test('unknown/malformed inventory, access denial, unsafe or missing Auth isolation fail closed',async()=>{
  for(const replies of [[{ok:false}],[new Error('provider secret')],[{body:[]}],
    [{body:[{...empty,auth_users:0}]}],[{body:[{...empty,extra:true}]}],
    [{body:[empty]},{body:{}}],[{body:[empty]},{body:{...auth,disable_signup:false}}],
    [{body:[empty]},{body:{...auth,external_email_enabled:true}}],
    [{body:[empty]},{body:null}]]){
    const m=mock(replies),r=await inspectRestoreTarget({sourceRef,targetRef,token,fetcher:m.fetcher});
    assert.equal(r.status,'BLOCKED');assert.equal(r.restoreAllowed,false);
    assert.equal(JSON.stringify(r).includes('provider secret'),false);
  }
});
