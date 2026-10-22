import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/js/admin/admin-provider-settings.js',import.meta.url),'utf8');
class Node{
 constructor(tag){this.tag=tag;this.children=[];this.textContent='';this.attributes={};this.value='';this.disabled=false;}
 append(...nodes){for(const node of nodes){this.children.push(node);if(this.tag==='select'&&this.children.length===1)this.value=node.value||node.textContent;}}
 replaceChildren(...nodes){this.children=nodes;this.textContent='';}setAttribute(k,v){this.attributes[k]=v;}
 querySelectorAll(tags){return this.children.flatMap(n=>[...(tags.split(',').includes(n.tag)?[n]:[]),...n.querySelectorAll(tags)]);}
 set innerHTML(value){assert.fail('Never use HTML insertion for provider settings');}
}
const text=n=>n.textContent+' '+n.children.map(text).join(' ');
function setup({keyReady=true,role='SUPER_ADMIN',post}={}){
 const root=new Node('div'),calls=[];let who={userId:'admin',admin:{role}};
 const context={document:{createElement:t=>new Node(t)},WebNovelsAuth:{getActor:()=>who,api:async(path,options)=>{
  calls.push({path,body:options?.body});if(options)return post?post(JSON.parse(options.body)):{saved:true,provider:'TOSS',mode:'TEST',revision:'1',configuredFields:['secretKey'],complete:false,enabled:false};
  return {keyReady,items:['TOSS','PASS'].flatMap(provider=>['TEST','LIVE'].map(mode=>({provider,mode,revision:'0',configuredFields:[],complete:false,enabled:false})))};
 }}};context.window=context;vm.createContext(context);vm.runInContext(source,context);
 return {root,calls,context,api:context.AdminProviderSettings,setActor:v=>{who=v;}};
}
const field=(s,name)=>s.root.querySelectorAll('input,select').find(n=>n.name===name);
test('settings UI sends entered keys once, blanks fields, never displays stored values, and clears on logout',async()=>{
 const s=setup();await s.api.render(s.root);const form=s.root.querySelectorAll('form')[0];
 form.querySelectorAll('select')[0].value='TEST';field(s,'secretKey').value='synthetic-private-value';
 const password=form.querySelectorAll('input').find(n=>n.autocomplete==='current-password');password.value='synthetic-password';
 await form.onsubmit({preventDefault(){}});
 const sent=JSON.parse(s.calls.at(-1).body);assert.deepEqual(sent.values,{secretKey:'synthetic-private-value'});assert.equal(sent.password,'synthetic-password');
 assert.equal(field(s,'secretKey').value,'');assert.equal(password.value,'');assert.doesNotMatch(text(s.root),/synthetic-private-value|synthetic-password/);
 assert.match(text(s.root),/키를 저장했습니다/);
 field(s,'secretKey').value='pending-private-value';s.api.reset();assert.equal(s.root.children.length,0);assert.equal(field(s,'secretKey'),undefined);
});
test('missing server key disables writes and late save after account switch cannot render secret state',async()=>{
 const disabled=setup({keyReady:false});await disabled.api.render(disabled.root);
 assert.ok(disabled.root.querySelectorAll('button').filter(b=>b.textContent==='암호화하여 저장').every(b=>b.disabled));
 const sub=setup({role:'SUB_ADMIN'});await sub.api.render(sub.root);assert.equal(sub.calls.length,0);
 let release;const s=setup({post:()=>new Promise(r=>{release=r;})});await s.api.render(s.root);
 const form=s.root.querySelectorAll('form')[0];form.querySelectorAll('select')[0].value='TEST';field(s,'secretKey').value='sensitive';
 form.querySelectorAll('input').find(n=>n.autocomplete==='current-password').value='password';
 const pending=form.onsubmit({preventDefault(){}});s.setActor(null);s.api.reset();release({saved:true,provider:'TOSS',mode:'TEST',revision:'1',configuredFields:['secretKey']});await pending;
 assert.equal(s.root.children.length,0);
});
