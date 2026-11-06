import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {setup,admin,reader} from './fixtures/stage17-db.mjs';
import {creatorNovelTranslation,withNovelTranslation} from '../server/novel-translation-api.mjs';

const read=name=>readFile(new URL('../'+name,import.meta.url),'utf8');
const origin='https://webnovels.test',version='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',nextVersion='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const env={FREE_BETA_ENABLED:'true',NEW_SERIALS_ENABLED:'true',AUTHOR_PUBLISH_ENABLED:'true',READER_SERVICE_ENABLED:'true',
  NOVEL_TRANSLATION_PILOT_ENABLED:'true',NOVEL_TRANSLATION_GOOGLE_PROJECT:'pilot-fixture',NOVEL_TRANSLATION_GOOGLE_LOCATION:'us-central1',
  NOVEL_TRANSLATION_GOOGLE_ACCESS_TOKEN:'synthetic-credential-for-testing'};
const work={workId:'31'},episode={...work,episodeId:'311',locale:'en'},text='  첫 문단\n대사  \n\n둘째 문단';
const fail=(status,code)=>{throw Object.assign(Error(code),{status,code});};
let db;
const rpc=async (name,_query,{body})=>{
 if(name==='rpc/novel_translation_author')return (await db.query(
  'select public.novel_translation_author($1,$2,$3,$4,$5,$6) result',
  [body.p_user,body.p_action,body.p_work,body.p_episode,body.p_locale,JSON.stringify(body.p_data)])).rows[0].result;
 if(name==='rpc/novel_translation_public')return (await db.query(
  'select public.novel_translation_public($1,$2,$3) result',[body.p_episode,body.p_version,body.p_locale])).rows[0].result;
 throw Error('unexpected RPC '+name);
};
before(async()=>{
 ({db}=await setup());
 await db.exec(await read('database/authoring/015_webtoon.sql'));
 await db.exec(await read('database/authoring/021_manuscript_documents.sql'));
 await db.exec('alter table auth.users add column if not exists deleted_at timestamptz; alter default privileges revoke execute on functions from public');
 const sql=await read('database/authoring/033_novel_translation_pilot.sql');
 await db.exec(sql);await db.exec(sql);
 await db.exec(`
  insert into works(id,author_id,status,rating,title,description,genre,published_at)
   values(31,1,'PUBLISHED','ALL','시범 작품','공개 소개',array['판타지'],now()-interval '1 day');
  insert into authoring.work_state(work_id,author_id,visibility) values(31,1,'PUBLIC');
  insert into episodes(id,work_id,episode_number,title,status,is_free,access_policy)
   values(311,31,1,'원문 제목','PUBLISHED',true,'FREE'),(312,31,2,'유료 회차','PUBLISHED',false,'PAID');
  insert into authoring.publication_versions(id,episode_id,work_id,title,content)
   values('${version}',311,31,'원문 제목','${text}'),('${nextVersion}',311,31,'바뀐 제목','바뀐 원문');
  insert into authoring.publication_heads(episode_id,version_id,published_at) values(311,'${version}',now()-interval '1 hour');
  insert into authoring.novel_translation_works(work_id,author_id,selected,glossary_resource,glossary_revision)
   values(31,1,true,'projects/pilot-fixture/locations/us-central1/glossaries/work-31-v1',1);
 `);
});
after(async()=>db?.close());
const caller=({actor=admin,bindings=env,fetchImpl=async()=>{throw Error('unexpected network');},originHeader=origin}={})=>async(action,data)=>{
 const url=new URL('/api/v2/creator/novel-translations',origin);
 const get=action==='state'||action==='detail';
 if(get)url.search=new URLSearchParams(data);
 const request=new Request(url,get?{}:{method:'POST',headers:{Origin:originHeader},body:JSON.stringify({action,...data})});
 return creatorNovelTranslation({request,url,env:bindings,db:rpc,actor:{userId:actor,author:{status:'APPROVED'}},readBody:r=>r.json(),fail,fetchImpl});
};
const publicRows=(id='311',requested='en',head=version)=>rpc('rpc/novel_translation_public',{}, {body:{p_episode:id,p_version:head,p_locale:requested}});

test('explicit ACLs deny direct table access and RPCs from browser roles',async()=>{
 for(const role of ['anon','authenticated','service_role']){
  await db.exec('set role '+role);
  try{
   await assert.rejects(db.query('select * from authoring.novel_translation_jobs'),/permission denied/);
   if(role==='service_role')assert.deepEqual(await publicRows(),[]);
   else await assert.rejects(publicRows(),/permission denied/);
  }finally{await db.exec('reset role');}
 }
});

test('requires exact owner, consent, current free source, provider configuration and budget',async()=>{
 const api=caller();
 await assert.rejects(caller({actor:reader})('state',work),{code:'WORK_NOT_FOUND'});
 await assert.rejects(caller({originHeader:'https://other.test'})('consent',work),{code:'ORIGIN_REQUIRED'});
 await assert.rejects(api('detail',episode),{code:'TRANSLATION_CONSENT_REQUIRED'});
 const state=await api('state',work);
 assert.equal(state.consented,false);assert.equal(state.generationEnabled,false);assert.deepEqual(state.episodes.map(x=>x.id),['311']);
 await assert.rejects(api('consent',{...work,accepted:true,version:'wrong'}),{code:'TRANSLATION_CONSENT_REQUIRED'});
 await api('consent',{...work,accepted:true,version:state.consentVersion});
 await assert.rejects(api('detail',{...episode,episodeId:'312'}),{code:'TRANSLATION_EPISODE_UNAVAILABLE'});
 await assert.rejects(api('generate',episode),{code:'TRANSLATION_BUDGET_OR_PROVIDER_DISABLED'});
 const noToken={...env,NOVEL_TRANSLATION_GOOGLE_ACCESS_TOKEN:''};
 await assert.rejects(caller({bindings:noToken})('generate',episode),{code:'TRANSLATION_PROVIDER_NOT_CONFIGURED'});
 assert.deepEqual(await publicRows(),[]);
});

test('reserves once across concurrent calls, reviews exact revision and serves only approved current head',async()=>{
 await db.exec('update authoring.novel_translation_settings set enabled=true,character_limit=500');
 let started,release,calls=0;
 const sent=new Promise(resolve=>{started=resolve;});
 const gate=new Promise(resolve=>{release=resolve;});
 const api=caller({fetchImpl:async (url,options)=>{
  calls++;
  assert.equal(url,'https://translation.googleapis.com/v3/projects/pilot-fixture/locations/us-central1:translateText');
  const request=JSON.parse(options.body);
  assert.deepEqual(request.contents,['원문 제목','첫 문단','대사','둘째 문단']);
  assert.deepEqual(Object.keys(request).sort(),['contents','glossaryConfig','mimeType','sourceLanguageCode','targetLanguageCode']);
  assert.equal(request.glossaryConfig.glossary,'projects/pilot-fixture/locations/us-central1/glossaries/work-31-v1');
  assert.equal(options.redirect,'error');
  started();await gate;
  return Response.json({glossaryTranslations:request.contents.map((_,i)=>({translatedText:'part '+i}))});
 }});
 const first=api('generate',episode);
 await sent;
 try{
  await assert.rejects(api('generate',episode),{code:'TRANSLATION_ALREADY_REQUESTED'});
  assert.deepEqual(await publicRows(),[]);
 }finally{release();}
 assert.equal((await first).state,'DRAFT');
 assert.equal(calls,1);
 const draft=await api('detail',episode);
 assert.equal('glossaryResource' in draft,false);
 assert.deepEqual(draft.job.segments,['part 0','part 1','part 2','part 3']);
 const payload={...episode,versionId:version,revision:draft.job.revision,segments:draft.job.segments};
 await assert.rejects(api('approve',payload),{code:'TRANSLATION_INVALID_REQUEST'});
 await assert.rejects(api('save',{...payload,segments:['incomplete']}),{code:'TRANSLATION_INVALID_SEGMENTS'});
 const saved=await api('save',{...payload,segments:['Title','Opening','Dialogue','Second']});
 await assert.rejects(api('approve',{...payload,reviewed:true}),{code:'TRANSLATION_REVISION_CHANGED'});
 assert.deepEqual(await publicRows(),[]);
 await api('approve',{...payload,reviewed:true,revision:saved.revision,segments:['Title','Opening','Dialogue','Second']});
 assert.deepEqual(await publicRows(),[{locale:'en',segments:['Title','Opening','Dialogue','Second']}]);
 const result={episode:{id:'311',versionId:version,title:'원문 제목',content:text}};
 const localized=await withNovelTranslation({result,url:new URL('?translation=en',origin),env,db:rpc,fail});
 assert.equal(localized.episode.content,text);
 assert.equal(localized.episode.translation.content,'  Opening\nDialogue  \n\nSecond');
 assert.equal(localized.episode.translation.title,'Title');
 await db.exec(`update authoring.publication_heads set version_id='${nextVersion}' where episode_id=311`);
 assert.deepEqual(await publicRows(),[]);
 await db.exec(`update authoring.publication_heads set version_id='${version}' where episode_id=311`);
 await api('withdraw',work);assert.deepEqual(await publicRows(),[]);
});

test('translated formatted text keeps marks and plain line structure without HTML rendering',async()=>{
 const doc={version:1,paragraphs:[{align:'center',indent:1,runs:[{text:'첫 ',bold:true},{text:'대사\n문장',italic:true}]},
  {align:'right',indent:0,runs:[{text:'마지막',underline:true}]}]};
 const result={episode:{id:'311',versionId:version,title:'제목',content:'첫 대사\n문장\n\n마지막',contentDocument:doc}};
 const localized=await withNovelTranslation({result,url:new URL('?translation=en',origin),env,fail,
  db:async()=>[{locale:'en',segments:['Title','First','Speech','Line','End']}]});
 const projected=localized.episode.translation.contentDocument.paragraphs;
 assert.deepEqual(projected[0],{align:'center',indent:1,runs:[{text:'First ',bold:true},{text:'Speech\nLine',italic:true}]});
 assert.equal(projected[1].runs[0].underline,true);
 assert.equal(localized.episode.versionId,version);
 assert.equal(await withNovelTranslation({result,url:new URL(origin),env:{},fail,db:async()=>{throw Error();}}),result);
});

test('a lost provider response remains charged to the budget and is never sent twice',async()=>{
 let calls=0;
 const api=caller({fetchImpl:async()=>{calls++;throw Error('connection lost');}});
 const state=await api('state',work);
 await api('consent',{...work,accepted:true,version:state.consentVersion});
 const before=(await db.query('select reserved_characters::int n from authoring.novel_translation_settings')).rows[0].n;
 const selection={...episode,locale:'ja'};
 await assert.rejects(api('generate',selection),{code:'TRANSLATION_PROVIDER_FAILED'});
 assert.equal((await api('detail',selection)).job.state,'FAILED');
 await assert.rejects(api('generate',selection),{code:'TRANSLATION_ALREADY_REQUESTED'});
 const after=(await db.query('select reserved_characters::int n from authoring.novel_translation_settings')).rows[0].n;
 assert(after>before);assert.equal(calls,1);assert.deepEqual(await publicRows(),[]);
});

test('reader switches body language at the same paragraph and keeps original comment anchors',async()=>{
 class Element {
  constructor(tag,text=''){this.tag=tag;this.children=[];this.dataset={};this.style={};this.events={};this.textContent=text;}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes.flatMap(node=>node.tag==='fragment'?node.children:[node]);}
  setAttribute(){} removeAttribute(){}
  addEventListener(type,fn){this.events[type]=fn;}
  contains(child){return this.children.some(node=>node===child||node.contains?.(child));}
  getBoundingClientRect(){const top=this.textContent==='Translated first'?35:20;return {top,bottom:top+20};}
 }
 const body=new Element('section'),panel=new Element('div'),heading=new Element('h1','원문 제목'),quotes=[],scrolls=[];
 const context={document:{createElement:tag=>new Element(tag),createDocumentFragment:()=>new Element('fragment'),
  createTextNode:text=>new Element('text',text)},scrollBy:(x,y)=>scrolls.push([x,y])};
 context.window=context;vm.createContext(context);
 vm.runInContext(await read('public/js/reader/reader-content.js'),context);
 const original={content:'원문 첫 문단\n\n둘째 문단',version};
 context.ReaderContent.render(body,null,original);
 context.ReaderContent.mountTranslation({panel,body,heading,original,locales:['en'],isCurrent:()=>true,
  load:async()=>({versionId:version,translation:{locale:'en',title:'Translated title',content:'Translated first\n\nSecond'}}),
  onParagraph:(...args)=>quotes.push(args)});
 const picker=panel.children[0].children[1];picker.value='en';await picker.events.change();
 assert.equal(body.lang,'en');assert.equal(heading.textContent,'Translated title');assert.equal(body.children[0].textContent,'Translated first');
 body.children[0].events.click();assert.deepEqual(quotes,[[0,'원문 첫 문단',version]]);assert.deepEqual(scrolls,[[0,15]]);
 picker.value='original';await picker.events.change();
 assert.equal(body.lang,'ko');assert.equal(heading.textContent,'원문 제목');assert.equal(body.children[0].textContent,'원문 첫 문단');
});
