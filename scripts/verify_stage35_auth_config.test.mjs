import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAuthPatch,summarizeAuthConfig,configureAuth,safeAuthError,BETA_SITE_URL,BETA_REDIRECT_PATTERNS,SMTP_KEYS} from './configure_stage35_auth.mjs';
const current={site_url:'http://localhost:3000',uri_allow_list:'https://existing.example.test/auth,http://localhost:4000/**',mailer_autoconfirm:false,
 external_email_enabled:true,disable_signup:false,smtp_host:'',smtp_user:'',smtp_pass:'',rate_limit_email_sent:2};
const env={SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',SUPABASE_ACCESS_TOKEN:'sbp_fixture-secret'};
const smtp={BETA_SMTP_HOST:'smtp.example.test',BETA_SMTP_PORT:'587',BETA_SMTP_USER:'fixture-user',BETA_SMTP_PASS:'private-password-value',BETA_SMTP_ADMIN_EMAIL:'private-sender@example.test',BETA_SMTP_SENDER_NAME:'발신이름'};
test('redirect patch preserves existing destinations, adds literal query patterns, and never enables auto-confirm or expands origins',()=>{
 const patch=buildAuthPatch(current);assert.deepEqual(Object.keys(patch),['site_url','uri_allow_list','mailer_autoconfirm']);
 assert.equal(patch.site_url,BETA_SITE_URL);assert.equal(patch.mailer_autoconfirm,false);
 assert.ok(patch.uri_allow_list.startsWith(current.uri_allow_list+','));assert.ok(patch.uri_allow_list.includes('/\\?auth=confirm'));
 const repeated=buildAuthPatch({...current,...patch});assert.equal(repeated.uri_allow_list,patch.uri_allow_list);
 assert.equal(buildAuthPatch({...current,mailer_autoconfirm:true}).mailer_autoconfirm,false);
 assert.ok(BETA_REDIRECT_PATTERNS.every(url=>!url.includes('*')));
});
test('SMTP is all-or-nothing, validates values and keeps password bytes without leaking values in errors',()=>{
 assert.equal(buildAuthPatch(current,smtp).smtp_pass,smtp.BETA_SMTP_PASS);
 assert.equal(buildAuthPatch(current,{...smtp,BETA_SMTP_PASS:' spaced password '}).smtp_pass,' spaced password ');
 for(const key of SMTP_KEYS){const partial={...smtp};delete partial[key];assert.throws(()=>buildAuthPatch(current,partial),/BETA_SMTP_ALL_SIX_FIELDS_REQUIRED/);}
 for(const patch of [{BETA_SMTP_HOST:'https://private-user:private-pass@bad.test'},{BETA_SMTP_PORT:'0'},{BETA_SMTP_PORT:'65536'},
  {BETA_SMTP_ADMIN_EMAIL:'private-sender\r\nBCC:other@test'},{BETA_SMTP_SENDER_NAME:'<private-value>'},{BETA_SMTP_PASS:''}]){
  assert.throws(()=>buildAuthPatch(current,{...smtp,...patch}),e=>!Object.values(patch).some(v=>v&&e.message.includes(v))&&/^BETA_SMTP_/.test(e.message));
 }
 assert.throws(()=>buildAuthPatch({...current,hook_send_email_enabled:true},smtp),/EMAIL_HOOK_REVIEW_REQUIRED/);
 assert.equal(safeAuthError(Error('private-password-value')),'AUTH_CONFIG_OPERATION_FAILED');
});
test('summary contains only explicit safe fields and never treats configured SMTP as delivered email',()=>{
 const config={...current,...buildAuthPatch(current,smtp),external_google_secret:'do-not-print',custom_secret:'do-not-print'};
 const summary=summarizeAuthConfig(config),json=JSON.stringify(summary);
 assert.equal(summary.smtpReady,true);assert.equal(summary.emailConfigReady,true);assert.equal(summary.deliveryVerified,false);
 for(const secret of [smtp.BETA_SMTP_USER,smtp.BETA_SMTP_PASS,smtp.BETA_SMTP_ADMIN_EMAIL,smtp.BETA_SMTP_HOST,'do-not-print'])assert.ok(!json.includes(secret));
 assert.equal(summarizeAuthConfig({...config,disable_signup:true}).emailConfigReady,false);
 assert.equal(summarizeAuthConfig(current).smtpReady,false);
});
test('first SMTP configuration changes only the built-in 2/hour limit to 30/hour and preserves operator limits',()=>{
 const patch=buildAuthPatch(current,smtp);assert.equal(patch.rate_limit_email_sent,30);
 assert.equal(summarizeAuthConfig({...current,...patch}).emailRateLimit,30);
 assert.equal(Object.hasOwn(buildAuthPatch(current),'rate_limit_email_sent'),false);
 for(const rate of [1,10,30,100,null,undefined])
  assert.equal(Object.hasOwn(buildAuthPatch({...current,rate_limit_email_sent:rate},smtp),'rate_limit_email_sent'),false);
 assert.equal(Object.hasOwn(buildAuthPatch({...current,smtp_host:'existing-smtp.example.test'},smtp),'rate_limit_email_sent'),false);
});
test('inspect never mutates; apply backs up first, readbacks exact settings and reports SMTP missing honestly',async()=>{
 let config=structuredClone(current),backed=false;const methods=[],reports=[];
 const fetcher=async(url,options)=>{assert.equal(url,'https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/config/auth');
  assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);methods.push(options.method);
  if(options.method==='PATCH'){assert.equal(backed,true);config={...config,...JSON.parse(options.body)};}return Response.json(config);};
 const options={env,fetcher,saveBackup:async value=>{assert.deepEqual(value,current);backed=true;return {path:'scratch/fixture/config.json',sha256:'a'.repeat(64)};},saveReport:async r=>reports.push(structuredClone(r))};
 const observed=await configureAuth(options);assert.deepEqual(methods,['GET']);assert.equal(backed,false);assert.equal(observed.applied,false);
 const applied=await configureAuth({...options,apply:true});assert.equal(applied.applied,true);assert.equal(applied.configurationVerified,true);
 assert.equal(applied.publicRedirectsReady,true);assert.equal(applied.smtpReady,false);assert.equal(applied.emailConfigReady,false);assert.equal(applied.deliveryVerified,false);
 assert.deepEqual(methods,['GET','GET','GET','PATCH','GET']);assert.ok(reports.some(r=>r.applyAttempted&&!r.applied));
 assert.ok(!JSON.stringify(reports).includes('sbp_fixture-secret'));
});
test('changed config, upstream secrets and uncertain PATCH never become verified success',async()=>{
 let count=0;await assert.rejects(configureAuth({env,apply:true,saveBackup:async()=>({}),fetcher:async()=>Response.json(++count===1?current:{...current,uri_allow_list:'https://new.example.test/'})}),/CHANGED_RETRY/);
 const reports=[];count=0;
 await assert.rejects(configureAuth({env,apply:true,saveBackup:async()=>({}),saveReport:async r=>reports.push(structuredClone(r)),fetcher:async(url,o)=>{if(o.method==='PATCH')throw Error('provider private-secret');return Response.json(current);}}),/AUTH_CONFIG_NETWORK_FAILED/);
 assert.equal(reports.at(-1).applyAttempted,true);assert.equal(reports.at(-1).applied,false);assert.equal(reports.at(-1).configurationVerified,false);
 assert.ok(!JSON.stringify(reports).includes('private-secret'));
});
