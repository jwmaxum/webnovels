import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
const [state,creator,session,reader,adapter]=await Promise.all([
  'public/js/core/state.js','public/js/creator/creator.js','public/js/core/auth-session.js',
  'public/js/reader/reader.js','public/supabase-admin.js'
].map(read));
function setup(){
  const storage=new Map(),ctx={console:{log(){},warn(){},error(){}},setTimeout(){},
    document:{readyState:'loading',getElementById:()=>null,addEventListener(){}},addEventListener(){},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    location:{origin:'https://app.test'}};
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(state,ctx);return ctx;
}
test('classic scripts load without missing Author/Creator exports and share function aliases',()=>{
  const c=setup();vm.runInContext(creator,c);
  for(const [a,b] of [['switchAuthorTab','switchCreatorTab'],['fetchAuthorDashboardData','fetchCreatorDashboardData'],
    ['handleAuthorSettlementReq','handleCreatorSettlementReq'],['handleAuthorLogoutProcess','handleCreatorLogoutProcess'],
    ['loadAuthorStudioEarnings','loadCreatorStudioEarnings']]){
    assert.equal(typeof c[a],'function',a);assert.equal(c[a],c[b],`${a} must use the same implementation as ${b}`);
  }
  vm.runInContext(adapter,c);
  assert.equal(typeof c.WebNovelsAdmin.fetchAuthorsFromSupabase,'function');
  assert.equal(c.WebNovelsAdmin.fetchCreatorsFromSupabase,c.WebNovelsAdmin.fetchAuthorsFromSupabase);
});
test('author/creator catalog aliases remain a single mutable cache, not separate accounts',()=>{
  const c=setup();assert.equal(c.SAMPLE_AUTHORS,c.SAMPLE_CREATORS);
  vm.runInContext("SAMPLE_AUTHORS.push({id:'11',pen_name:'writer'});",c);
  assert.equal(c.SAMPLE_CREATORS[0].id,'11');c.SAMPLE_CREATORS.length=0;
  assert.equal(vm.runInContext('SAMPLE_AUTHORS.length',c),0);
});
test('verified Auth identity updates both lexical/global display aliases; logout clears all four',async()=>{
  const c=setup(),who={userId:'auth-uuid',author:{id:12,status:'APPROVED',pen_name:'writer'},reader:null,admin:null};
  c.supabaseClient={auth:{getSession:async()=>({data:{session:{access_token:'verified-session'}}}),signOut:async()=>({})}};
  c.initSupabaseAdmin=()=>true;
  c.fetch=async()=>Response.json(who);vm.runInContext(session,c);await c.WebNovelsAuth.validate();
  const syntax=ts.createSourceFile('reader.js',reader,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  for(const name of ['getCurrentAuthorSession','getCurrentCreatorSession']){
    const fn=syntax.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(fn,name);vm.runInContext(fn.getText(syntax),c);
  }
  assert.equal(c.getCurrentAuthorSession(),c.getCurrentCreatorSession());
  for(const name of ['currentLoggedAuthor','currentLoggedCreator']){
    assert.equal(vm.runInContext(name,c),c.WebNovelsAuth.getActor().author);assert.equal(c[name],c.WebNovelsAuth.getActor().author);
  }
  // Forged presentation keys must not become another author identity.
  c.localStorage.setItem('webnovels_creator',JSON.stringify({id:999,role:'CREATOR'}));
  assert.equal(c.getCurrentCreatorSession().id,12);
  await c.WebNovelsAuth.logout();
  for(const name of ['currentLoggedAuthor','currentLoggedCreator']){assert.equal(vm.runInContext(name,c),null);assert.equal(c[name],null);}
  assert.equal(c.getCurrentCreatorSession(),null);
});
