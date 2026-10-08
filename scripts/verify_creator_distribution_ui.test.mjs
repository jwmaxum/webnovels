import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const sourcePath=fileURLToPath(new URL('../public/js/creator/creator-distribution.js',import.meta.url));
const source=await readFile(sourcePath,'utf8');
const work={id:'10',moderation_state:'CLEAR',trashed_at:null};
const unset={workId:'10',mode:'UNSET',version:'0',externalLinks:[],declarationVersion:null,declaredAt:null};
function setup(responses=[{distribution:unset}]){
  const nodes=new Map(),calls=[];let actor={userId:'user-a',author:{id:'1',status:'APPROVED'}};
  function node(id){if(!nodes.has(id))nodes.set(id,{id,value:'',checked:false,disabled:false,hidden:id==='cwDistributionForm',textContent:'',children:[],
    appendChild(value){this.children.push(value);},replaceChildren(){this.children=[];}});return nodes.get(id);}
  const container={isConnected:true,html:'',set innerHTML(value){this.html=value;nodes.clear();},get innerHTML(){return this.html;},querySelector:selector=>node(selector.slice(1)),replaceChildren(){this.html='';nodes.clear();}};
  const context={URL,Date,location:{pathname:'/creator/works/10/settings'},confirm:()=>true,
    document:{createElement:tag=>({tag,children:[],appendChild(value){this.children.push(value);}})},
    WebNovelsAuth:{getActor:()=>actor,api:async(path,options)=>{calls.push({path,options});const result=responses.shift();if(result instanceof Error)throw result;return result;}}};
  context.window=context;vm.createContext(context);vm.runInContext(source,context,{filename:sourcePath});
  return {ui:context.CreatorDistribution,context,container,calls,node,responses,setActor:value=>{actor=value;},submit:()=>node('cwDistributionForm').onsubmit({preventDefault(){}})};
}
test('UNSET is not inferred as nonexclusive; save is separate, explicit and confirmed by a new server version',async()=>{
  const s=setup([{distribution:unset},{distribution:{...unset,mode:'NON_EXCLUSIVE',version:'1',externalLinks:['https://novel.munpia.com/123'],declarationVersion:'author-declaration-v1',declaredAt:'2026-10-08T00:00:00Z'}}]);
  await s.ui.mount(s.container,work);assert.equal(s.node('cwDistributionMode').value,'');assert.equal(s.node('cwDistributionRights').checked,false);
  assert.equal(s.ui.hasUnsavedChanges(),false);
  assert.equal(s.node('cwDistributionForm').hidden,false);assert.match(s.container.innerHTML,/계약 접수·승인/);
  s.node('cwDistributionMode').value='NON_EXCLUSIVE';s.node('cwDistributionLinks').value=' https://novel.munpia.com/123 \n\n';s.node('cwDistributionRights').checked=true;
  s.node('cwDistributionForm').oninput();assert.equal(s.ui.hasUnsavedChanges(),true);
  await s.submit();const call=s.calls.at(-1);assert.equal(call.path,'/api/v2/creator/works/10/distribution');assert.equal(call.options.method,'PATCH');
  assert.deepEqual(JSON.parse(call.options.body),{mode:'NON_EXCLUSIVE',externalLinks:['https://novel.munpia.com/123'],version:'0',rightsConfirmed:true});
  assert.match(s.node('cwDistributionMessage').textContent,/저장되었습니다/);assert.equal(s.node('cwDistributionRights').checked,false);
  assert.equal(s.ui.hasUnsavedChanges(),false);
  assert.match(s.node('cwDistributionDeclared').textContent,/마지막 권리 확인/);
  const link=s.node('cwDistributionPreview').children[0].children[0];assert.equal(link.href,'https://novel.munpia.com/123');assert.equal(link.rel,'noopener noreferrer');
  assert.ok(!s.calls.some(c=>/publications|episodes/.test(c.path)));
});
test('conflict and lost response preserve input/version; explicit reload requires confirmation',async()=>{
  for(const error of [Object.assign(new Error('conflict'),{code:'DISTRIBUTION_CONFLICT'}),new Error('lost response')]){
    const s=setup([{distribution:unset},error,{distribution:{...unset,version:'2',mode:'EXCLUSIVE_INTEREST',externalLinks:[]}}]);await s.ui.mount(s.container,work);
    s.node('cwDistributionMode').value='NON_EXCLUSIVE';s.node('cwDistributionLinks').value='https://page.kakao.com/content/123';s.node('cwDistributionRights').checked=true;
    const html=s.container.innerHTML;await s.submit();assert.equal(s.container.innerHTML,html);assert.equal(s.node('cwDistributionLinks').value,'https://page.kakao.com/content/123');
    assert.match(s.node('cwDistributionMessage').textContent,/입력은 유지/);assert.equal(s.node('cwDistributionFields').disabled,false);
    assert.equal(s.ui.hasUnsavedChanges(),true);
    s.context.confirm=()=>false;await s.node('cwDistributionReload').onclick();assert.equal(s.calls.length,2);
    s.context.confirm=()=>true;await s.node('cwDistributionReload').onclick();assert.equal(s.node('cwDistributionMode').value,'EXCLUSIVE_INTEREST');
    assert.equal(s.ui.hasUnsavedChanges(),false);
  }
});
test('unavailable/malformed reads never offer a successful empty form; restricted/trashed settings cannot submit',async()=>{
  for(const result of [new Error('offline'),{distribution:{...unset,workId:'20'}},{distribution:{...unset,version:'9223372036854775808'}},{distribution:{...unset,mode:'PLUS'}}]){
    const s=setup([result]);await s.ui.mount(s.container,work);assert.equal(s.node('cwDistributionForm').hidden,true);assert.match(s.node('cwDistributionMessage').textContent,/불러오지 못/);
    await s.submit();assert.equal(s.calls.length,1);
  }
  for(const changed of [{...work,trashed_at:'2026-10-08'},{...work,moderation_state:'RESTRICTED'}]){
    const s=setup();await s.ui.mount(s.container,changed);await s.submit();assert.equal(s.calls.length,1);assert.match(s.node('cwDistributionMessage').textContent,/변경할 수 없습니다/);
  }
});
test('links render as safe DOM attributes/text; delayed reads and saves cannot cross account/navigation boundaries',async()=>{
  const s=setup([{distribution:{...unset,externalLinks:['javascript:alert(1)','https://novel.munpia.com.evil.test/x','https://novel.munpia.com/a?<script>bad</script>']}}]);
  await s.ui.mount(s.container,work);assert.doesNotMatch(s.container.innerHTML,/<script>/);assert.equal(s.node('cwDistributionPreview').children.length,1);
  const link=s.node('cwDistributionPreview').children[0].children[0];assert.equal(link.textContent,'문피아 연재 링크 열기');assert.ok(link.href.startsWith('https://novel.munpia.com/'));
  for(const change of [state=>state.setActor({userId:'user-b',author:{id:'2',status:'APPROVED'}}),state=>state.setActor({userId:'user-a',author:{id:'1',status:'SUSPENDED'}}),
    state=>{state.container.isConnected=false;},state=>{state.context.location.pathname='/home';},state=>{state.context.location.pathname='/creator/works/20/settings';}]){
    const late=setup();let resolve;late.context.WebNovelsAuth.api=()=>new Promise(r=>{resolve=r;});
    const pending=late.ui.mount(late.container,work);change(late);resolve({distribution:{...unset,mode:'NON_EXCLUSIVE',externalLinks:['https://www.joara.com/book/123']}});await pending;
    assert.equal(late.node('cwDistributionForm').hidden,true);assert.equal(late.node('cwDistributionPreview').children.length,0);
  }
  const save=setup();await save.ui.mount(save.container,work);let resolve;save.context.WebNovelsAuth.api=()=>new Promise(r=>{resolve=r;});
  const pending=save.submit();save.setActor(null);save.ui.reset();resolve({distribution:{...unset,version:'1',mode:'NON_EXCLUSIVE'}});await pending;
  assert.doesNotMatch(save.node('cwDistributionMessage').textContent,/저장되었습니다/);
  const unauthorized=setup();unauthorized.setActor({userId:'user-a',reader:{id:'1'}});await unauthorized.ui.mount(unauthorized.container,work);assert.equal(unauthorized.calls.length,0);
});
