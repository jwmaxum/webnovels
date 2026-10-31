import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {parse} from 'parse5';
import {transform} from 'esbuild';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('public/index.html'),reader=read('public/js/reader/reader.js');
const start=reader.indexOf('const DEFAULT_READER_PREFERENCES ='),end=reader.indexOf('// --- 5. 독자 인증',start);
assert(start>=0&&end>start,'Execute the complete production preference store and initialization');
const attr=(node,key)=>node.attrs?.find(item=>item.name===key)?.value;
const walk=node=>[node,...(node.children||[]).flatMap(walk)];
const groupDefinitions=[
  ['theme','.theme-selector-grid .theme-btn','theme'],
  ['fontFamily','.pref-btn[data-font]','font'],
  ['lineHeight','.pref-btn[data-line-height]','lineHeight'],
  ['paddingX','.pref-btn[data-padding]','padding'],
  ['paragraphGap','.pref-btn[data-gap]','gap']
];

function fixture({saved=null,remote=null,authenticated=true}={}){
  const events=new Map(),storage=new Map(saved?[['webnovels_reader_preferences',JSON.stringify(saved)]]:[]),writes=[],properties=new Map();
  let actor=authenticated?{userId:'reader-a',reader:{id:'reader-profile'}}:null;
  const document={readyState:'loading',activeElement:null};
  class Element{
    constructor(tag='div'){
      this.tag=tag;this.children=[];this.attributes={};this.dataset={};this.hidden=false;this.disabled=false;this.tabIndex=0;this.style={setProperty:(key,value)=>properties.set(key,value)};
      this.classes=new Set();this.classList={add:name=>this.classes.add(name),remove:name=>this.classes.delete(name),contains:name=>this.classes.has(name),toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name)};
    }
    append(...children){for(const child of children){child.parent=this;this.children.push(child);}}
    setAttribute(key,value){
      this.attributes[key]=String(value);
      if(key==='id')this.id=String(value);
      if(key==='class')this.classes=new Set(String(value).split(/\s+/));
      if(key==='tabindex')this.tabIndex=Number(value);
      if(key==='type')this.type=value;
      if(key==='hidden'||key==='disabled')this[key]=true;
      if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_match,char)=>char.toUpperCase())]=String(value);
    }
    getAttribute(key){return this.attributes[key]??null;}
    matches(selector){
      if(selector.startsWith('.'))return this.classes.has(selector.slice(1));
      const field=selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
      if(field)return field[2]===undefined?Object.hasOwn(this.attributes,field[1]):this.getAttribute(field[1])===field[2];
      return this.tag===selector;
    }
    querySelectorAll(selector){return walk(this).slice(1).filter(node=>selector.split(',').some(part=>node.matches(part.trim())));}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    contains(node){return walk(this).includes(node);}
    get isConnected(){return this===document.body||!!this.parent?.isConnected;}
    getClientRects(){for(let node=this;node;node=node.parent)if(node.hidden)return [];return [{}];}
    focus(){if(!this.disabled&&this.isConnected&&this.getClientRects().length)document.activeElement=this;}
    remove(){this.parent.children=this.parent.children.filter(node=>node!==this);this.parent=null;}
  }
  function convert(node){
    const result=new Element(node.tagName||'#text');
    for(const entry of node.attrs||[])result.setAttribute(entry.name,entry.value);
    for(const child of node.childNodes||[])result.append(convert(child));
    return result;
  }
  document.body=convert(parse(html));document.documentElement=new Element('html');document.createElement=tag=>new Element(tag);
  document.getElementById=id=>walk(document.body).find(node=>node.id===id)||null;
  document.addEventListener=(name,listener)=>events.set(name,listener);
  const settings=document.getElementById('modalReaderSettings'),controls=walk(settings);
  const groups=Object.fromEntries(groupDefinitions.map(([key,,data])=>[key,controls.filter(node=>node.tag==='button'&&Object.hasOwn(node.dataset,data))]));
  document.querySelectorAll=selector=>{
    const group=groupDefinitions.find(([,query])=>query===selector);
    if(group)return groups[group[0]];
    if(selector==='#readerBody .reader-paragraph')return [];
    return document.body.querySelectorAll(selector);
  };
  const context={document,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    WEBNOVELS_CONFIG:{readerServiceEnabled:!!remote},WebNovelsAuth:{getActor:()=>actor},
    ReaderHub:{active:()=>!!remote,activity:async()=>({preferences:remote}),change:async(...args)=>writes.push(args)},
    location:{pathname:'/read/10/5'},setTimeout:()=>assert.fail('Preference controls must not defer authentication or navigation')};
  context.window=context;vm.createContext(context);vm.runInContext(reader.slice(start,end),context,{filename:'reader.js preference store'});
  return {context,document,groups,storage,writes,properties,events,Element,
    init:()=>events.get('DOMContentLoaded')(),setActor:next=>actor=next,
    click:button=>vm.runInContext(button.getAttribute('onclick'),context),get:id=>document.getElementById(id)};
}

function assertSelection(app,expected){
  for(const [key,,data] of groupDefinitions){
    const buttons=app.groups[key];assert(buttons.length>1,key+' actual options exist');
    for(const button of buttons){
      const selected=String(button.dataset[data])===String(expected[key]);
      assert.equal(button.getAttribute('aria-pressed'),String(selected),key+' accessible selection '+button.dataset[data]);
      assert.equal(button.classList.contains('active'),selected,key+' visible selection '+button.dataset[data]);
    }
    assert.equal(buttons.filter(button=>button.getAttribute('aria-pressed')==='true').length,1,key+' single selection');
  }
}

test('actual reader dialogs and setting groups have resolved accessible names and one whole-dialog scrolling boundary',async()=>{
  const nodes=[];const visit=node=>{if(node.tagName)nodes.push(node);for(const child of node.childNodes||[])visit(child);};visit(parse(html));
  const byId=id=>nodes.find(node=>attr(node,'id')===id),within=(node,parent)=>{for(let current=node;current;current=current.parentNode)if(current===parent)return true;return false;};
  const text=node=>(node.childNodes||[]).map(child=>child.value||text(child)).join('').trim();
  for(const id of ['modalReaderSettings','modalSearch','modalMobileMore']){
    const root=byId(id),dialog=nodes.find(node=>attr(node,'role')==='dialog'&&within(node,root));assert(dialog,id+' labelled dialog');
    assert.equal(attr(dialog,'aria-modal'),'true');
    const labels=(attr(dialog,'aria-labelledby')||'').split(/\s+/).filter(Boolean);assert(labels.length,id+' accessible name reference');
    for(const label of labels){const heading=byId(label);assert(heading&&within(heading,dialog)&&/^h[1-6]$/.test(heading.tagName),id+' existing dialog heading');assert(text(heading).length>0);}
    if(id!=='modalMobileMore'){
      const close=nodes.find(node=>node.tagName==='button'&&(attr(node,'class')||'').split(/\s+/).includes('modal-close')&&within(node,dialog));
      assert.equal(attr(close,'type'),'button');assert((attr(close,'aria-label')||'').includes('닫기'),id+' named icon close');
    }
  }
  const settings=byId('modalReaderSettings'),groups=nodes.filter(node=>attr(node,'role')==='group'&&within(node,settings));assert.equal(groups.length,6);
  for(const group of groups){const label=byId(attr(group,'aria-labelledby'));assert(label&&text(label).length>0,'each option group has a real text label');assert(nodes.some(node=>node.tagName==='button'&&within(node,group)),'named group contains its controls');}
  const sizeButtons=nodes.filter(node=>node.tagName==='button'&&(attr(node,'onclick')||'').includes('changeFontSize(')&&within(node,settings));assert.equal(sizeButtons.length,2);
  for(const button of sizeButtons){assert((attr(button,'aria-label')||'').includes('글자 크기'));assert.match(attr(button,'style'),/width:\s*44px/);assert.match(attr(button,'style'),/height:\s*44px/);}
  assert.equal(attr(byId('fontSizeDisplay'),'role'),'status');assert.equal(attr(byId('fontSizeDisplay'),'aria-live'),'polite');
  assert(nodes.some(node=>node.tagName==='label'&&attr(node,'for')==='globalSearchInput'&&within(node,byId('modalSearch'))),'search has an explicit input label');
  const css=read('public/css/reader-experience.css');assert.deepEqual((await transform(css,{loader:'css'})).warnings,[]);
  const rules=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match=>({selector:match[1].trim(),body:match[2]}));
  const dialog=rules.filter(rule=>rule.selector==='#modalReaderSettings .modal-dialog').at(-1),body=rules.filter(rule=>rule.selector==='#modalReaderSettings .modal-body').at(-1);
  assert(dialog&&body,'settings scroll boundaries are explicit');assert.match(dialog.body,/max-height:\s*calc\(100dvh\s*-\s*16px\)/);assert.match(dialog.body,/overflow-y:\s*auto/);
  assert.match(body.body,/max-height:\s*none/);assert.match(body.body,/overflow-y:\s*visible/,'body does not create a second clipped scrolling region');
});

test('initial reader settings expose every actual selected value before any interaction without changing the reading defaults',()=>{
  const app=fixture();app.init();
  assertSelection(app,{theme:'theme-light',fontFamily:'serif',lineHeight:1.8,paddingX:20,paragraphGap:1.2});
  assert.equal(app.get('fontSizeDisplay').textContent,'18px');assert.equal(app.properties.get('--reader-font-size'),'18px');
  assert.match(app.properties.get('--reader-font'),/Noto Serif KR/);assert.equal(app.storage.size,0);
});

test('each actual option handler updates both accessible selection and reader appearance, preserving the other preferences',()=>{
  const app=fixture();app.init();const manager=app.context.ReaderPreferencesManager;
  for(const [key,,data] of groupDefinitions)for(const button of app.groups[key]){
    const before=JSON.parse(JSON.stringify(manager.pref));assert.equal(button.type,'button','native keyboard-activatable option');
    app.click(button);const after=JSON.parse(JSON.stringify(manager.pref));
    assert.equal(String(after[key]),String(button.dataset[data]));
    delete before[key];const rest={...after};delete rest[key];assert.deepEqual(rest,before,'unrelated reading preferences must remain unchanged');
    assertSelection(app,after);assert.deepEqual(JSON.parse(app.storage.get('webnovels_reader_preferences')),after);
  }
  assert.equal(app.properties.get('--reader-paragraph-gap'),app.context.ReaderPreferencesManager.pref.paragraphGap+'em');
  assert.equal(app.writes.length,0);
});

test('saved local preferences restore selected controls and account reset removes the previous reader selections',()=>{
  const saved={theme:'theme-sepia',fontFamily:'sans',fontSize:24,lineHeight:2.2,paddingX:36,paragraphGap:1.6};
  const app=fixture({saved});app.init();assertSelection(app,saved);assert.equal(app.get('fontSizeDisplay').textContent,'24px');
  app.setActor(null);app.context.ReaderPreferencesManager.reset();
  assertSelection(app,{theme:'theme-light',fontFamily:'serif',lineHeight:1.8,paddingX:20,paragraphGap:1.2});
  assert.equal(app.get('fontSizeDisplay').textContent,'18px');assert.equal(app.writes.length,0);
});

test('verified remote preferences render the same selected controls and subsequent changes retain the existing remote payload contract',async()=>{
  const remote={theme:'theme-oled',fontFamily:'sans',fontSize:22,lineHeight:1.5,paddingX:12,paragraphGap:0.8};
  const app=fixture({remote,saved:{theme:'theme-dark'}});app.init();await app.context.ReaderPreferencesManager.syncRemote('reader-a');
  assertSelection(app,remote);assert.equal(app.get('fontSizeDisplay').textContent,'22px');assert.match(app.properties.get('--reader-font'),/sans-serif/);
  app.click(app.groups.theme.find(button=>button.dataset.theme==='theme-light'));
  assert.equal(app.writes.length,1);const [action,scope,payload]=app.writes[0];
  assert.equal(action,'preferences');assert.deepEqual(Object.keys(scope),[]);assert.deepEqual(JSON.parse(JSON.stringify(payload)),{settings:{...remote,theme:'theme-light'}});
  assert.equal(app.storage.get('webnovels_reader_preferences'),JSON.stringify({theme:'theme-dark'}),'remote behavior must not overwrite local legacy settings');
});

test('guest preference changes remain local to the displayed reader when the account service is active',()=>{
  const app=fixture({remote:{theme:'theme-dark'},authenticated:false});app.init();
  app.click(app.groups.lineHeight.find(button=>button.dataset.lineHeight==='2.2'));
  assertSelection(app,{theme:'theme-light',fontFamily:'serif',lineHeight:2.2,paddingX:20,paragraphGap:1.2});
  assert.equal(app.writes.length,0);assert.equal(app.storage.size,0);
});

test('production dialog keyboard handling excludes hidden and disabled controls, wraps both directions and restores a visible invoker',()=>{
  const app=fixture(),{document,Element,context}=app;vm.runInContext(read('public/js/core/ui-utils.js'),context);
  const invoker=new Element('button'),outer=new Element('div'),inner=new Element('div');outer.id='r7Outer';inner.id='r7Inner';
  const first=new Element('button'),disabled=new Element('button'),hiddenPanel=new Element('section'),hidden=new Element('button'),last=new Element('button'),nested=new Element('button');
  disabled.disabled=true;hiddenPanel.hidden=true;hiddenPanel.append(hidden);outer.append(first,disabled,hiddenPanel,last);inner.append(nested);document.body.append(invoker,outer,inner);
  invoker.focus();context.openModal(outer.id);assert.equal(document.activeElement,first);
  const key=(value,extra={})=>{let prevented=false;app.events.get('keydown')({key:value,...extra,preventDefault(){prevented=true;}});return prevented;};
  first.focus();assert.equal(key('Tab',{shiftKey:true}),true);assert.equal(document.activeElement,last);
  assert.equal(key('Tab'),true);assert.equal(document.activeElement,first);
  context.openModal(inner.id);assert.equal(document.activeElement,nested);
  assert.equal(key('Escape',{isComposing:true}),false);assert.equal(inner.hidden,false);
  assert.equal(key('Escape'),true);assert.equal(inner.hidden,true);assert.equal(outer.hidden,false);assert.equal(document.activeElement,first);
  context.closeAllModals();assert.equal(document.activeElement,invoker);assert.equal(outer.hidden,true);
});

test('dialog fallback keeps keyboard access when all controls are disabled and a removed nested invoker cannot receive restored focus',()=>{
  const app=fixture(),{document,Element,context}=app;vm.runInContext(read('public/js/core/ui-utils.js'),context);
  const outer=new Element('div'),inner=new Element('div'),first=new Element('button'),nested=new Element('button');outer.id='fallbackOuter';inner.id='fallbackInner';outer.append(first);inner.append(nested);document.body.append(outer,inner);
  context.openModal(outer.id);context.openModal(inner.id);first.remove();context.closeModal(inner.id);
  assert.equal(document.activeElement,outer);assert.equal(outer.tabIndex,-1);
  let prevented=false;app.events.get('keydown')({key:'Tab',preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(document.activeElement,outer);
  const disabled=new Element('button');disabled.disabled=true;outer.append(disabled);context.closeModal(outer.id);context.openModal(outer.id);assert.equal(document.activeElement,outer);
});
