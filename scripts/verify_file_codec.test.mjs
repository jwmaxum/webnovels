import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
import * as fflate from 'fflate';import {DOMParser} from '@xmldom/xmldom';
const c=vm.createContext({fflate,TextDecoder,TextEncoder,DOMParser});vm.runInContext(await readFile('public/js/creator/file-codec.js','utf8'),c);vm.runInContext(await readFile('public/js/creator/file-image.js','utf8'),c);
const codec=c.CreatorFileCodec,encode=x=>new TextEncoder().encode(x);
const makeDoc=(body,extra={})=>fflate.zipSync({'[Content_Types].xml':encode('<Types/>'),'word/document.xml':encode('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'</w:body></w:document>'),...extra});
test('TXT preserves Korean, emoji, quotes and blank lines; BOM and explicit encodings are supported',()=>{
 const original='한글 😀 “문장”\r\n\r\n끝\r';assert.equal(codec.txt(encode(original)).content,'한글 😀 “문장”\n\n끝\n');
 assert.equal(codec.txt(Uint8Array.from([255,254,0,172])).content,'가');assert.equal(codec.txt(Uint8Array.from([176,161]),'euc-kr').content,'가');
 assert.ok(codec.txt(Uint8Array.from([176,161])).warnings.includes('ENCODING_CONFIRM_REQUIRED'));
 assert.throws(()=>codec.txt(Uint8Array.from([0,1,2])));assert.throws(()=>codec.txt(encode('x'.repeat(200001))),/TEXT_TOO_LONG/);
});
test('real DOCX paragraphs, empty paragraphs, tabs and XML entities convert as plain text',()=>{
 const result=codec.docx(makeDoc('<w:p><w:r><w:t>한글 😀 &amp; “인용”</w:t><w:tab/><w:t>끝</w:t></w:r></w:p><w:p/><w:p><w:r><w:t>다음</w:t><w:br/><w:t>줄</w:t></w:r></w:p>'));
 assert.equal(result.content,'한글 😀 & “인용”\t끝\n\n다음\n줄');assert.equal(result.warnings.length,0);
});
test('unsupported DOCX content warns; external references never fetch; active packages and XML rejected',()=>{
 const result=codec.docx(makeDoc('<w:p><w:r><w:t>보존</w:t><w:drawing/></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>제외</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',{'word/_rels/document.xml.rels':encode('<Relationships><Relationship TargetMode="External" Target="https://example.invalid/private"/></Relationships>')}));
 assert.equal(result.content,'보존');assert.ok(result.warnings.includes('TABLE_IGNORED'));assert.ok(result.warnings.includes('EXTERNAL_REFERENCES_IGNORED'));
 assert.throws(()=>codec.docx(makeDoc('<w:p/>',{'word/vbaProject.bin':encode('macro')})),/DOCX_ACTIVE_CONTENT/);
 assert.throws(()=>codec.docx(makeDoc('<w:p/>',{'word/_rels/x.rels':encode('<!DOCTYPE x [<!ENTITY a SYSTEM "file:///secret">]><x/>')})),/DOCX_ACTIVE_CONTENT/);
 assert.throws(()=>codec.docx(Uint8Array.from([1,2,3])),/DOCX_SIGNATURE_INVALID/);
});
test('ZIP expansion limit uses actual output, and damaged or oversized inputs fail',()=>{
 assert.throws(()=>codec.docx(makeDoc('<w:p/>',{'word/large.xml':encode('A'.repeat(5*1024*1024))})),/DOCX_EXPANSION_LIMIT/);
 assert.throws(()=>codec.docx(new Uint8Array(2097153)),/FILE_TOO_LARGE/);assert.throws(()=>codec.docx(makeDoc('<w:p/>').slice(0,35)));
 const damaged=makeDoc('<w:p/>');const view=new DataView(damaged.buffer,damaged.byteOffset,damaged.byteLength);for(let i=0;i<damaged.length-4;i++)if(view.getUint32(i,true)===0x02014b50){damaged[i+16]^=1;break;}
 assert.throws(()=>codec.docx(damaged),/DOCX_CHECKSUM_INVALID/);
});
test('export filenames are safe/unique and ZIP roundtrip preserves full text and metadata',()=>{
 const manifest={workTitle:'작품',items:[{title:'../CON<>',content:'한글\n\n😀',state:'PUBLISHED',number:1,authorComment:'말'},{title:'../CON<>',content:'다른 원고',state:'ACTIVE'}]};
 const files=fflate.unzipSync(codec.bundle(manifest));const restored=JSON.parse(new TextDecoder().decode(files['manifest.json']));
 assert.equal(restored.items.length,2);for(const item of restored.items){assert.ok(!item.filename.includes('/'));assert.equal(new TextDecoder().decode(files[item.filename]),item.content);}assert.equal(restored.items[0].authorComment,'말');
});
test('image header validation rejects vectors and oversized pixel dimensions before decoding',()=>{
 const png=new Uint8Array(24);png.set([137,80,78,71,13,10,26,10]);const view=new DataView(png.buffer);view.setUint32(12,0x49484452);view.setUint32(16,600);view.setUint32(20,900);
 assert.equal(c.CreatorFileImage.dimensions(png).width,600);view.setUint32(16,8193);assert.throws(()=>c.CreatorFileImage.dimensions(png),/IMAGE_PIXEL_LIMIT/);assert.throws(()=>c.CreatorFileImage.dimensions(encode('<svg/>')),/IMAGE_INVALID/);
});
