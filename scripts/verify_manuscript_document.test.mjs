import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/js/shared/manuscript-document.js';
import {fromHTML} from '../src/manuscript-paste.mjs';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const M=globalThis.ManuscriptDocument;

test('new webtoon drafts never acquire a hidden novel document before their first upload',async()=>{
 const elements=Object.fromEntries(['creatorRichEditor','creatorRichBody','newEpContent'].map(id=>[id,{hidden:false,querySelectorAll:()=>[],replaceChildren(){}}]));
 const document={getElementById:id=>elements[id],readyState:'loading',addEventListener(){}};
 const window={WEBNOVELS_CONFIG:{authorRichTextEnabled:true},ManuscriptDocument:{...M,paragraph:p=>p}};
 vm.runInNewContext(await readFile('public/js/creator/creator-rich-editor.js','utf8'),{window,document});
 window.CreatorRichEditor.mount({content:''},false,'WEBTOON');
 assert.equal(elements.creatorRichEditor.hidden,true);assert.deepEqual(Object.keys(window.CreatorRichEditor.snapshot()),[]);
 window.CreatorRichEditor.mount({content:'소설'},false,'NOVEL');
 assert.equal(elements.creatorRichEditor.hidden,false);assert.equal(M.text(window.CreatorRichEditor.snapshot().contentDocument),'소설');
 window.CreatorRichEditor.mount({content:''},false,'WEBTOON');
 assert.equal(elements.creatorRichEditor.hidden,true);assert.deepEqual(Object.keys(window.CreatorRichEditor.snapshot()),[]);
});
test('committed browser parser is reproducible from the locked dependency and source',async()=>{
 const result=await build({entryPoints:['src/manuscript-paste.mjs'],bundle:true,format:'iife',platform:'browser',target:'es2022',minify:true,write:false,legalComments:'eof'});
 assert.equal((await readFile('public/vendor/manuscript-paste.js','utf8')).replace(/\r\n/g,'\n'),result.outputFiles[0].text.replace(/\r\n/g,'\n'));
});
test('Word paste projects paragraphs, line breaks, emphasis, alignment and indentation without remote HTML',()=>{
 const {document,warnings}=fromHTML('<html><body><p style="text-align:center"><b>제목</b></p><p style="text-indent:10pt"><span style="font-style:italic">본문</span><br>다음 줄 <u>밑줄</u></p><img src="https://attacker.invalid/pixel"><script>bad()</script></body></html>');
 assert.equal(M.text(document),'제목\n\n본문\n다음 줄 밑줄');assert.equal(document.paragraphs[0].align,'center');assert.equal(document.paragraphs[0].runs[0].bold,true);
 assert.equal(document.paragraphs[1].indent,1);assert.equal(document.paragraphs[1].runs[0].italic,true);assert.equal(document.paragraphs[1].runs.at(-1).underline,true);
 assert.ok(warnings.length);assert.ok(!JSON.stringify(document).includes('attacker'));assert.ok(!JSON.stringify(document).includes('bad()'));
});
test('malicious attributes, URLs and CSS never enter stored format, malformed markup preserves visible text',()=>{
 const {document}=fromHTML('<div onclick="bad()"><a href="javascript:bad()"><span style="background:url(https://evil.test)">읽을 내용</span></a><svg><script>attack</script></svg></div>');
 assert.equal(M.text(document),'읽을 내용');assert.equal(M.valid(document),true);
 assert.equal(M.valid({...document,html:'<img onerror=bad()>'}),false);
 assert.equal(M.valid(document,'다른 본문'),false);
});

test('Word section wrappers, nested pasted paragraphs and explicit mark resets remain editable',()=>{
 const {document}=fromHTML('<div class="WordSection1"><p><b><i>강조<span style="font-weight:normal;font-style:normal">보통</span></i></b></p><div><p style="text-align:center">둘째</p></div></div>');
 assert.equal(M.text(document),'강조보통\n\n둘째');assert.equal(document.paragraphs[0].runs[0].bold,true);
 assert.equal(document.paragraphs[0].runs[1].bold,undefined);assert.equal(document.paragraphs[0].runs[1].italic,undefined);
 assert.equal(document.paragraphs[1].align,'center');assert.ok(M.valid(document));
 assert.equal(M.text(fromHTML('<p>앞<p>붙여넣기</p>뒤</p>').document),'앞\n\n붙여넣기\n\n뒤\n\n');
});
test('ordered lists and consecutive breaks preserve reader paragraph indices',()=>{
 const {document}=fromHTML('<ol><li>하나</li><li>둘</li></ol><p>줄<br><br><b>다음</b></p>');
 assert.equal(M.text(document),'1. 하나\n\n2. 둘\n\n줄\n\n다음');
 assert.equal(document.paragraphs.length,M.text(document).split('\n\n').length);
 assert.equal(M.valid({version:1,paragraphs:[{align:'left',indent:0,runs:[{text:'a\n'},{text:'\nb'}]}]}),false);
});
test('oversize and deep paste are rejected before modifying the current document',()=>{
 assert.throws(()=>fromHTML('<p>'+'가'.repeat(200001)+'</p>'),/PASTE_TOO_LARGE/);
 assert.throws(()=>fromHTML('<span>'.repeat(90)+'text'+'</span>'.repeat(90)),/PASTE_TOO_COMPLEX/);
 assert.equal(M.valid({version:1,paragraphs:[{align:'left',indent:0,runs:[{text:'x',url:'https://evil.test'}]}]}),false);
});
