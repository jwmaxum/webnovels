import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import '../public/js/shared/manuscript-document.js';
import {fromHTML} from '../src/manuscript-paste.mjs';

const M=globalThis.ManuscriptDocument,source=await readFile(new URL('../public/js/creator/creator-rich-editor.js',import.meta.url),'utf8');
const copy=value=>JSON.parse(JSON.stringify(value)),escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

function fixture(){
 const ids=new Map(),documentListeners=new Map(),calls=[],events=[],states={justifyLeft:true},ui={hasDraft:true,readOnly:false,composing:false};let document;
 class Node{
  constructor(tag){this.tagName=tag?.toUpperCase();this.nodeType=tag==='#text'?3:tag==='#fragment'?11:1;this.childNodes=[];this.parentNode=null;this.style={};this.dataset={};this.attributes={};this.listeners=new Map();this.hidden=false;this.disabled=false;this.value='';this.data='';this.raw=null;}
  get firstChild(){return this.childNodes[0]||null;}get lastChild(){return this.childNodes.at(-1)||null;}
  append(...values){for(let value of values){if(typeof value==='string')value=document.createTextNode(value);if(value.nodeType===11){this.append(...[...value.childNodes]);continue;}if(value.parentNode)value.parentNode.childNodes=value.parentNode.childNodes.filter(child=>child!==value);this.childNodes.push(value);value.parentNode=this;}this.raw=null;}
  replaceChildren(...values){for(const child of this.childNodes)child.parentNode=null;this.childNodes=[];this.raw=null;this.append(...values);}
  contains(node){return !!node&&(node===this||this.childNodes.some(child=>child.contains(node)));}
  setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key]??null;}
  addEventListener(type,listener){const listeners=this.listeners.get(type)||new Set();listeners.add(listener);this.listeners.set(type,listeners);}
  dispatchEvent(event){events.push({target:this.id,type:event.type});if(this.id==='newEpContent'){if(event.type==='compositionstart')ui.composing=true;if(event.type==='compositionend')ui.composing=false;}for(const listener of this.listeners.get(event.type)||[])listener(event);return !event.defaultPrevented;}
  querySelectorAll(selector){const visit=node=>node.childNodes.flatMap(child=>[child,...visit(child)]);return visit(this).filter(node=>selector==='[data-rich-command]'?!!node.dataset.richCommand:selector==='button'?node.tagName==='BUTTON':false);}
  focus(options){calls.push({action:'focus',options});document.activeElement=this;}
  get textContent(){return this.nodeType===3?this.data:this.childNodes.map(node=>node.textContent).join('');}
  set textContent(value){if(this.nodeType===3)this.data=String(value);else this.replaceChildren(document.createTextNode(value));}
  get innerHTML(){return this.raw??this.childNodes.map(serialize).join('');}
 }
 const serialize=node=>{
  if(node.nodeType===3)return escape(node.data);if(node.nodeType===11)return node.childNodes.map(serialize).join('');
  const tag=node.tagName.toLowerCase(),style=Object.entries(node.style).map(([name,value])=>name.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())+':'+value).join(';');
  return '<'+tag+(style?' style="'+escape(style)+'"':'')+'>'+node.childNodes.map(serialize).join('')+(tag==='br'?'':'</'+tag+'>');
 };
 const create=(id,tag='div')=>{const node=new Node(tag);node.id=id;ids.set(id,node);return node;};
 const rich=create('creatorRichEditor'),body=create('creatorRichBody'),plain=create('newEpContent','textarea'),notice=create('creatorRichNotice','p'),toolbar=create('toolbar');
 rich.append(toolbar,notice,body);const buttons={};for(const command of ['bold','italic','underline','justifyLeft','justifyCenter','justifyRight']){const button=new Node('button');button.dataset.richCommand=command;toolbar.append(button);buttons[command]=button;}
 const range=(start,end=start,selectedText='')=>({startContainer:start,endContainer:end,selectedText,
  cloneRange(){return range(this.startContainer,this.endContainer,this.selectedText);},
  deleteContents(){calls.push({action:'delete'});body.replaceChildren();},insertNode(fragment){calls.push({action:'insert'});body.append(fragment);},
  setStartAfter(node){this.startContainer=node;this.endContainer=node;},collapse(){this.selectedText='';}});
 const selection={ranges:[],anchorNode:null,focusNode:null,get rangeCount(){return this.ranges.length;},getRangeAt(index){return this.ranges[index];},toString(){return this.ranges[0]?.selectedText||'';},removeAllRanges(){this.ranges=[];this.anchorNode=null;this.focusNode=null;},addRange(value){this.ranges=[value];this.anchorNode=value.startContainer;this.focusNode=value.endContainer;}};
 document={readyState:'complete',activeElement:body,getElementById:id=>ids.get(id),createElement:tag=>new Node(tag),createTextNode:value=>{const node=new Node('#text');node.data=String(value);return node;},createDocumentFragment:()=>new Node('#fragment'),
  addEventListener(type,listener){const listeners=documentListeners.get(type)||new Set();listeners.add(listener);documentListeners.set(type,listeners);},removeEventListener(type,listener){documentListeners.get(type)?.delete(listener);},
  queryCommandState(command){calls.push({action:'query',command,inside:body.contains(selection.anchorNode)});return states[command]===true;},
  execCommand(command){
   assert(body.contains(selection.anchorNode)&&body.contains(selection.focusNode),'native commands require the selected body');calls.push({action:'command',command});
   const p=body.firstChild;if(command.startsWith('justify')){for(const key of ['justifyLeft','justifyCenter','justifyRight'])states[key]=key===command;p.style.textAlign={justifyLeft:'left',justifyCenter:'center',justifyRight:'right'}[command];}
   else {states[command]=!states[command];const tag={bold:'strong',italic:'em',underline:'u'}[command];if(states[command]){const wrapper=new Node(tag);wrapper.append(...[...p.childNodes]);p.append(wrapper);}else if(p.firstChild?.tagName===tag.toUpperCase())p.replaceChildren(...[...p.firstChild.childNodes]);}
   const node=p.firstChild||p;selection.removeAllRanges();selection.addRange(range(node));return true;
  }};
 const window={WEBNOVELS_CONFIG:{authorRichTextEnabled:true},currentActiveView:'view-creator',CreatorDraftEditor:{getUiState:()=>({...ui})},
  ManuscriptDocument:{...M,paragraph:p=>M.paragraph(p,document)},ManuscriptPaste:{fromHTML},getSelection:()=>selection};
 vm.runInNewContext(source,{window,document,Event},{filename:'public/js/creator/creator-rich-editor.js'});
 const emitSelection=()=>{for(const listener of documentListeners.get('selectionchange')||[])listener();};
 const emitFocus=()=>{for(const listener of documentListeners.get('focusin')||[])listener();};
 const inside=(newStates={})=>{Object.assign(states,newStates);const node=body.firstChild?.firstChild||body;selection.removeAllRanges();selection.addRange(range(node));document.activeElement=body;emitSelection();};
 const mount=(text='원고 본문',readOnly=false,type='NOVEL')=>{plain.value=text;window.CreatorRichEditor.mount({content:text},readOnly,type);};
 const paste=(html,plainText='')=>{let prevented=false;const event={type:'paste',clipboardData:{getData:type=>type==='text/html'?html:plainText},preventDefault(){prevented=true;}};body.dispatchEvent(event);return prevented;};
 mount();return {window,document,body,plain,notice,rich,buttons,selection,states,ui,calls,events,mount,inside,paste,emitSelection,emitFocus,range,node:tag=>new Node(tag),listenerCount:()=>documentListeners.get('selectionchange')?.size||0};
}

test('actual selected formatting is exposed with pressed toggles and one alignment without a draft write',()=>{
 const f=fixture();f.inside({bold:true,underline:true,justifyCenter:true,justifyRight:true});
 assert.equal(f.buttons.bold.getAttribute('aria-pressed'),'true');assert.equal(f.buttons.italic.getAttribute('aria-pressed'),'false');assert.equal(f.buttons.underline.getAttribute('aria-pressed'),'true');
 assert.equal(f.buttons.justifyCenter.getAttribute('aria-pressed'),'true');assert.equal(f.buttons.justifyRight.getAttribute('aria-pressed'),'false');assert.equal(f.buttons.justifyLeft.getAttribute('aria-pressed'),'false');
 assert.equal(f.events.filter(event=>event.target==='newEpContent').length,0);assert(!f.calls.some(call=>call.action==='command'));
});

test('keyboard toolbar focus restores only its saved body range and persists the canonical command result',()=>{
 const f=fixture();f.inside();f.document.activeElement=f.buttons.bold;f.selection.removeAllRanges();f.emitSelection();f.buttons.bold.onclick();
 assert.deepEqual(f.calls.filter(call=>call.action==='command').map(call=>call.command),['bold']);assert.equal(f.buttons.bold.getAttribute('aria-pressed'),'true');
 assert.equal(f.window.CreatorRichEditor.snapshot().contentDocument.paragraphs[0].runs[0].bold,true);assert.equal(f.plain.value,'원고 본문');assert.equal(f.events.filter(event=>event.target==='newEpContent'&&event.type==='input').length,1);
 assert.equal(f.calls.find(call=>call.action==='focus').options.preventScroll,true);
});

test('native keyboard format changes refresh state even when the caret does not move',()=>{
 const f=fixture();f.inside();f.states.bold=true;f.body.dispatchEvent(new Event('keyup'));assert.equal(f.buttons.bold.getAttribute('aria-pressed'),'true');assert.equal(f.events.filter(event=>event.target==='newEpContent').length,0);
});

test('focusing another input clears a retained body bookmark before returning to a toolbar button',()=>{
 const f=fixture();f.inside({bold:true});f.document.activeElement=f.node('input');f.emitFocus();assert.equal(f.buttons.bold.getAttribute('aria-pressed'),'false');f.buttons.bold.onclick();
 f.document.activeElement=f.buttons.bold;f.emitFocus();f.buttons.bold.onclick();assert(!f.calls.some(call=>call.action==='command'||call.action==='focus'));
});

test('formatting cannot steal an outside selection or reuse a range removed by another manuscript mount',()=>{
 const f=fixture();f.inside({bold:true});const other=f.node('p');f.selection.removeAllRanges();f.selection.addRange(f.range(other));f.document.activeElement=other;f.emitSelection();f.buttons.bold.onclick();
 assert.equal(f.buttons.bold.getAttribute('aria-pressed'),'false');assert(!f.calls.some(call=>call.action==='command'||call.action==='focus'));assert.match(f.notice.textContent,/본문 위치/);
 f.inside();f.document.activeElement=f.buttons.italic;f.selection.removeAllRanges();f.mount('다음 원고');f.buttons.italic.onclick();assert(!f.calls.some(call=>call.action==='command'));assert.equal(f.window.CreatorRichEditor.snapshot().contentDocument.paragraphs[0].runs[0].text,'다음 원고');
});

test('read-only, webtoon and absent-current-draft states clear formatting and selection listeners',()=>{
 const f=fixture();f.inside({bold:true});assert.equal(f.listenerCount(),1);f.mount('보관 원고',true);
 assert.equal(f.listenerCount(),0);for(const button of Object.values(f.buttons)){assert.equal(button.disabled,true);assert.equal(button.getAttribute('aria-pressed'),'false');button.onclick();}
 assert(!f.calls.some(call=>call.action==='command'));f.mount('편집 원고');f.mount('편집 원고');assert.equal(f.listenerCount(),1);f.inside();f.ui.hasDraft=false;f.emitSelection();f.buttons.bold.onclick();assert(!f.calls.some(call=>call.action==='command'));
 f.ui.hasDraft=true;f.mount('',false,'WEBTOON');assert.equal(f.listenerCount(),0);assert.equal(f.body.contentEditable,'false');assert.equal(f.rich.hidden,true);assert.deepEqual(Object.keys(f.window.CreatorRichEditor.snapshot()),[]);
});

test('a departed creator view cannot format a retained hidden selection',()=>{
 const f=fixture();f.inside({italic:true});f.window.currentActiveView='view-reader';f.emitSelection();f.buttons.italic.onclick();
 assert.equal(f.buttons.italic.disabled,true);assert.equal(f.buttons.italic.getAttribute('aria-pressed'),'false');assert(!f.calls.some(call=>call.action==='command'||call.action==='focus'));
});

test('IME composition forwards the existing engine events and defers toolbar commands and paste',()=>{
 const f=fixture();f.inside();const before=copy(f.window.CreatorRichEditor.snapshot());f.body.dispatchEvent(new Event('compositionstart'));f.buttons.bold.onclick();
 assert.equal(f.buttons.bold.disabled,true);assert.equal(f.paste('<p>조합 중 삽입</p>'),true);assert.deepEqual(copy(f.window.CreatorRichEditor.snapshot()),before);assert.match(f.notice.textContent,/한글 입력을 마친/);assert(!f.calls.some(call=>call.action==='command'));
 f.body.dispatchEvent(new Event('compositionend'));assert.equal(f.buttons.bold.disabled,false);assert.deepEqual(f.events.filter(event=>event.target==='newEpContent').map(event=>event.type),['compositionstart','compositionend']);
});

test('paste events insert only the actual sanitized document and forward its canonical content once',()=>{
 const f=fixture();f.mount('');f.inside();assert.equal(f.paste('<p style="text-align:center"><b>가운데 제목</b></p><p><i>기울임</i><br><u>밑줄</u></p><img src="https://evil.invalid/pixel"><script>bad()</script>'),true);
 const doc=f.window.CreatorRichEditor.snapshot().contentDocument;assert.equal(M.valid(doc,f.plain.value),true);assert.equal(f.plain.value,'가운데 제목\n\n기울임\n밑줄');assert.equal(doc.paragraphs[0].align,'center');assert.equal(doc.paragraphs[0].runs[0].bold,true);assert.equal(doc.paragraphs[1].runs[0].italic,true);assert.equal(doc.paragraphs[1].runs.at(-1).underline,true);
 assert.doesNotMatch(f.body.innerHTML,/evil|script|bad\(\)/);assert.match(f.notice.textContent,/보존되지 않습니다/);assert.equal(f.events.filter(event=>event.target==='newEpContent'&&event.type==='input').length,1);
});

test('outside paste and rejected oversized clipboard content preserve the prior manuscript',()=>{
 const f=fixture(),before=copy(f.window.CreatorRichEditor.snapshot()),other=f.node('p');f.selection.removeAllRanges();f.selection.addRange(f.range(other));f.paste('<p>바깥 선택</p>');assert.deepEqual(copy(f.window.CreatorRichEditor.snapshot()),before);assert(!f.calls.some(call=>call.action==='delete'||call.action==='insert'));
 f.inside();f.paste('<p>'+'가'.repeat(200001)+'</p>');assert.deepEqual(copy(f.window.CreatorRichEditor.snapshot()),before);assert.match(f.notice.textContent,/원본은 유지/);assert.equal(f.events.filter(event=>event.target==='newEpContent').length,0);f.window.CreatorRichEditor.assertValid();
});

test('unavailable formatting queries fail closed and invalid input restores the last valid document',()=>{
 const f=fixture();f.document.queryCommandState=()=>{throw Error('unsupported');};f.inside();for(const button of Object.values(f.buttons))assert.equal(button.getAttribute('aria-pressed'),'false');
 f.body.raw='<p>'+'가'.repeat(200001)+'</p>';f.body.dispatchEvent(new Event('input'));assert.equal(f.body.textContent,'원고 본문');assert.equal(f.plain.value,'원고 본문');assert.throws(()=>f.window.CreatorRichEditor.assertValid(),/INVALID_CONTENT_DOCUMENT/);
 f.body.dispatchEvent(new Event('input'));f.window.CreatorRichEditor.assertValid();
});
