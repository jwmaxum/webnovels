import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

function element(tag) {
  return {
    tag,children:[],dataset:{},style:{},className:'',textContent:'',
    append(...items){this.children.push(...items);},
    replaceChildren(...items){this.children=items;},
    addEventListener(type,callback){this[type]=callback;}
  };
}
test('owner preview and reader share paragraph, blank-line and escaped comment rendering',async()=>{
  const document={createElement:element,createDocumentFragment:()=>element('fragment'),
    createTextNode:text=>({tag:'text',textContent:text})};
  const window={};
  vm.runInNewContext(await readFile(new URL('../public/js/reader/reader-content.js',import.meta.url),'utf8'),{window,document});
  const snapshot={content:'한글 <script>\n인용 “말”\n\n\n\n끝 😀',authorComment:'말 <img onerror=1>'};
  const preview=element('body'),comment=element('comment'),reader=element('body'),readerComment=element('comment');
  window.ReaderContent.render(preview,comment,snapshot);
  window.ReaderContent.render(reader,readerComment,snapshot);
  const paragraphs=container=>container.children[0].children.map(p=>({text:p.textContent,blank:p.children.some(x=>x.tag==='br')}));
  assert.deepEqual(paragraphs(preview),paragraphs(reader));
  assert.equal(paragraphs(preview)[0].text,'한글 <script>\n인용 “말”');
  assert.ok(paragraphs(preview).some(p=>p.blank));
  assert.equal(comment.children[1].textContent,'말 <img onerror=1>');
  assert.equal(readerComment.children[1].textContent,comment.children[1].textContent);
});
