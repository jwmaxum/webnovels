import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';import {fileURLToPath} from 'node:url';
import * as fflate from 'fflate';import {DOMParser} from '@xmldom/xmldom';import {hwpx,packageFiles,paragraph,section,ns} from './fixtures/hwpx-fixtures.mjs';
const filename=fileURLToPath(new URL('../public/js/creator/file-codec.js',import.meta.url));
const context=vm.createContext({fflate,TextDecoder,TextEncoder,DOMParser});vm.runInContext(await readFile(filename,'utf8'),context,{filename});const codec=context.CreatorFileCodec;
const zip=files=>fflate.zipSync(Object.fromEntries(Object.entries(files).map(([k,v])=>[k,fflate.strToU8(v)])));
test('HWPX spine order preserves paragraphs, blank lines, tabs, breaks, Korean and emoji',()=>{
 const first=paragraph('처음')+'<hp:p/>'+paragraph('끝'),second='<hp:p><hp:run><hp:t>한글 😀 &amp; “인용”<hp:tab/>탭<hp:lineBreak/>줄</hp:t></hp:run></hp:p>';
 const bytes=hwpx({sections:[first,second],order:[1,0]}),before=bytes.slice(),result=codec.hwpx(bytes);
 assert.equal(result.content,'한글 😀 & “인용”\t탭\n줄\n처음\n\n끝');assert.equal(result.encoding,'HWPX');assert.deepEqual([...result.warnings],['FORMATTING_IGNORED']);assert.deepEqual(bytes,before);
});
test('namespace prefixes are arbitrary; relative section hrefs and standard OPF URI work',()=>{
 const files=packageFiles();files['Contents/section0.xml']=section(paragraph('보존')).replaceAll('hs:','s:').replaceAll('xmlns:hs','xmlns:s').replaceAll('hp:','p:').replaceAll('xmlns:hp','xmlns:p');
 files['Contents/content.hpf']=files['Contents/content.hpf'].replaceAll(ns.opf,ns.opf.slice(0,-1)).replace('Contents/section0.xml','section0.xml').replace('Contents/header.xml','header.xml');assert.equal(codec.hwpx(zip(files)).content,'보존');
 files['META-INF/container.xml']=files['META-INF/container.xml'].replace('</rootfiles>','<rootfile full-path="Preview/PrvText.txt" media-type="text/plain"/><rootfile full-path="Preview/PrvImage.png" media-type="image/png"/></rootfiles>');assert.equal(codec.hwpx(zip(files)).content,'보존');
});
test('tables, pictures, notes and metadata warn without injecting nested body or preview text',()=>{
 const controls=['tbl','pic','footNote','endNote','header','footer','fieldBegin','fieldEnd','memo','trackChange','ole','equation'];
 const result=codec.hwpx(hwpx({sections:[paragraph('보존')+'<hp:p><hp:run>'+controls.map(tag=>'<hp:'+tag+'>'+paragraph('누락된 부속 내용')+'</hp:'+tag+'>').join('')+'</hp:run></hp:p>'],overrides:{'Preview/PrvText.txt':'미리보기로 대체하면 안 됩니다','BinData/image1.png':new Uint8Array([1,2]),'Contents/masterpage0.xml':'<x/>'}}));
 assert.equal(result.content,'보존\n');for(const warning of ['TABLE_IGNORED','IMAGE_IGNORED','FOOTNOTE_IGNORED','HEADER_FOOTER_IGNORED','FIELD_CODE_IGNORED','COMMENT_IGNORED','DELETED_TEXT_IGNORED','EMBEDDED_CONTENT_IGNORED','UNSUPPORTED_BLOCK_IGNORED'])assert.ok(result.warnings.includes(warning));
});
test('foreign namespaces and unknown elements are omitted, never treated as Hancom text',()=>{
 const result=codec.hwpx(hwpx({sections:['<hp:p><hp:run><evil:block xmlns:evil="urn:foreign">혼입 금지</evil:block><hp:unknown>혼입 금지</hp:unknown><hp:t>본문</hp:t></hp:run></hp:p><other xmlns="urn:foreign">혼입 금지</other>']}));assert.equal(result.content,'본문');assert.ok(result.warnings.includes('UNSUPPORTED_BLOCK_IGNORED'));
 for(const tag of ['p','run','t'])assert.throws(()=>codec.hwpx(hwpx({sections:['<hp:p><hp:run><hp:t>본문</hp:t></hp:run></hp:p>'.replaceAll('hp:'+tag,'foreign:'+tag).replace('<foreign:'+tag,'<foreign:'+tag+' xmlns:foreign="urn:unsupported"')]})),/HWPX_NAMESPACE_UNSUPPORTED/);
 for(const file of ['Contents/section0.xml','Contents/header.xml','Contents/content.hpf']){const files=packageFiles();files[file]=files[file].replace(/http:\/\/[^" ]+/,'urn:unsupported');assert.throws(()=>codec.hwpx(zip(files)),/HWPX_NAMESPACE_UNSUPPORTED/);}
});
test('missing, duplicated or unreferenced sections cannot fall back to Preview',()=>{
 for(const order of [[],[0,0],[1]])assert.throws(()=>codec.hwpx(hwpx({order})),/HWPX_(PACKAGE_INVALID|EXTERNAL_REFERENCE)/);
 const files=packageFiles({sections:[paragraph('하나'),paragraph('둘')],order:[0]});files['Preview/PrvText.txt']='대체 금지';assert.throws(()=>codec.hwpx(zip(files)),/HWPX_PACKAGE_INVALID/);
 delete files['Contents/section0.xml'];assert.throws(()=>codec.hwpx(zip(files)),/HWPX_PACKAGE_INVALID/);
});
test('container path, manifest identities and section count must agree',()=>{
 const changes=[['META-INF/container.xml',s=>s.replace('Contents/content.hpf','other.hpf'),'PACKAGE_INVALID'],['Contents/content.hpf',s=>s.replace('id="section0"','id="header"'),'PACKAGE_INVALID'],['Contents/header.xml',s=>s.replace('secCnt="1"','secCnt="2"'),'SECTION_COUNT_MISMATCH'],['Contents/header.xml',s=>s.replace('secCnt="1"','secCnt="0"'),'SECTION_COUNT_MISMATCH']];
 for(const [file,change,error]of changes){const files=packageFiles();files[file]=change(files[file]);assert.throws(()=>codec.hwpx(zip(files)),new RegExp('HWPX_'+error));}
 for(const change of [s=>s.replace('application/hwpml-package+xml','application/xml'),s=>s.replace('</rootfiles>','<rootfile full-path="other.hpf" media-type="application/hwpml-package+xml"/></rootfiles>')]){const files=packageFiles();files['META-INF/container.xml']=change(files['META-INF/container.xml']);assert.throws(()=>codec.hwpx(zip(files)),/HWPX_PACKAGE_INVALID/);}
});
test('external resources only warn; external body and traversing manifest paths fail',()=>{
 const manifest='<opf:item id="external" href="https://example.invalid/secret.xml" media-type="application/xml"/>';
 assert.ok(codec.hwpx(hwpx({manifest})).warnings.includes('EXTERNAL_REFERENCES_IGNORED'));
 const files=packageFiles({manifest});files['Contents/content.hpf']=files['Contents/content.hpf'].replace('idref="section0"','idref="external"');assert.throws(()=>codec.hwpx(zip(files)),/HWPX_EXTERNAL_REFERENCE/);
 for(const href of ['../section0.xml','/Contents/section0.xml','Contents//section0.xml','Contents/%2e%2e/section0.xml']){const changed=packageFiles();changed['Contents/content.hpf']=changed['Contents/content.hpf'].replace('Contents/section0.xml',href);assert.throws(()=>codec.hwpx(zip(changed)),/HWPX_PACKAGE_INVALID/);}
});
test('renamed DOCX, binary HWP, wrong mimetype and missing metadata fail before conversion',()=>{
 assert.throws(()=>codec.hwpx(new TextEncoder().encode('HWP Document File')),/HWPX_SIGNATURE_INVALID/);
 assert.throws(()=>codec.hwpx(zip({'[Content_Types].xml':'<Types/>','word/document.xml':'<x/>'})),/HWPX_PACKAGE_INVALID/);
 for(const file of ['mimetype','META-INF/container.xml','Contents/content.hpf','Contents/header.xml']){const files=packageFiles();delete files[file];assert.throws(()=>codec.hwpx(zip(files)),/HWPX_PACKAGE_INVALID/);}
 assert.throws(()=>codec.hwpx(hwpx({overrides:{mimetype:'application/zip'}})),/HWPX_PACKAGE_INVALID/);
});
test('DTD, entity, script, OLE, executable and active media types are rejected',()=>{
 for(const name of ['Scripts/headerScripts','Scripts/sourceScripts','BinData/payload.js','BinData/payload.ole','BinData/payload.exe','BinData/payload.bin'])assert.throws(()=>codec.hwpx(hwpx({overrides:{[name]:'active'}})),/HWPX_ACTIVE_CONTENT/);
 assert.throws(()=>codec.hwpx(hwpx({overrides:{'META-INF/manifest.xml':'<!DOCTYPE x [<!ENTITY a SYSTEM "file:///secret">]><x/>'}})),/HWPX_ACTIVE_CONTENT/);
 assert.throws(()=>codec.hwpx(hwpx({manifest:'<opf:item id="active" href="payload.xml" media-type="application/javascript"/>'})),/HWPX_ACTIVE_CONTENT/);
});
test('encryption metadata and encrypted ZIP entries are rejected',()=>{
 assert.throws(()=>codec.hwpx(hwpx({overrides:{'META-INF/manifest.xml':'<manifest><encryption-data/></manifest>'}})),/HWPX_ENCRYPTED_DOCUMENT/);
 assert.throws(()=>codec.hwpx(hwpx({overrides:{'META-INF/manifest.xml':'<암호:encryption-data xmlns:암호="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>'}})),/HWPX_ENCRYPTED_DOCUMENT/);
 const bytes=hwpx(),view=new DataView(bytes.buffer);for(let i=0;i<bytes.length-46;i++)if(view.getUint32(i,true)===0x02014b50){view.setUint16(i+8,1,true);break;}assert.throws(()=>codec.hwpx(bytes),/HWPX_ARCHIVE_INVALID/);
});
test('malformed XML reports a safe parser error',()=>{
 for(const value of ['<hs:sec','<a/><b/>'])assert.throws(()=>codec.hwpx(hwpx({overrides:{'Contents/section0.xml':value}})),/HWPX_XML_INVALID/);
 assert.throws(()=>codec.hwpx(hwpx(),class {parseFromString(){return {documentElement:null};}}),/HWPX_XML_INVALID/);
});
test('ZIP paths, case aliases, duplicate entries, methods and CRC are checked',()=>{
 for(const name of ['../x.xml','/x.xml','Contents\\x.xml','Contents/a%2exml','Contents/x?.xml','Contents/x.xml ','Contents/./x.xml','contents/section0.xml'])assert.throws(()=>codec.hwpx(hwpx({overrides:{[name]:'<x/>'}})),/HWPX_ARCHIVE_INVALID/);
 for(const mode of ['crc','method','duplicate']){const bytes=hwpx(),view=new DataView(bytes.buffer);const positions=[];for(let i=0;i<bytes.length-46;i++)if(view.getUint32(i,true)===0x02014b50)positions.push(i);
  if(mode==='crc')bytes[positions[0]+16]^=1;else if(mode==='method')view.setUint16(positions[0]+10,99,true);else {const start=positions.find(p=>new TextDecoder().decode(bytes.subarray(p+46,p+46+view.getUint16(p+28,true)))==='Contents/section0.xml');const header=positions.find(p=>new TextDecoder().decode(bytes.subarray(p+46,p+46+view.getUint16(p+28,true)))==='Contents/header.xml');bytes.set(bytes.subarray(header+46,header+46+view.getUint16(header+28,true)),start+46);view.setUint16(start+28,view.getUint16(header+28,true),true);}
  assert.throws(()=>codec.hwpx(bytes),/HWPX_(CHECKSUM_INVALID|ARCHIVE_INVALID)/);
 }
});
test('compressed file, declared and actual expanded output, and manuscript limits are bounded',()=>{
 assert.throws(()=>codec.hwpx(new Uint8Array(2097153)),/FILE_TOO_LARGE/);
 assert.throws(()=>codec.hwpx(hwpx({overrides:{'Contents/large.xml':'a'.repeat(4194305)}})),/HWPX_EXPANSION_LIMIT/);
 const bytes=hwpx({overrides:{'Contents/large.xml':'a'.repeat(4194305)}}),view=new DataView(bytes.buffer);for(let i=0;i<bytes.length-46;i++)if(view.getUint32(i,true)===0x02014b50&&new TextDecoder().decode(bytes.subarray(i+46,i+46+view.getUint16(i+28,true)))==='Contents/large.xml')view.setUint32(i+24,1,true);assert.throws(()=>codec.hwpx(bytes),/HWPX_EXPANSION_LIMIT/);
 assert.throws(()=>codec.hwpx(hwpx({overrides:Object.fromEntries(Array.from({length:5},(_,i)=>['Contents/large'+i+'.xml','a'.repeat(4*1024*1024)]))})),/HWPX_EXPANSION_LIMIT/);
 assert.throws(()=>codec.hwpx(hwpx({overrides:Object.fromEntries(Array.from({length:256},(_,i)=>['Contents/extra'+i+'.xml','<x/>']))})),/HWPX_ARCHIVE_INVALID/);
 assert.throws(()=>codec.hwpx(hwpx({sections:[paragraph('가'.repeat(200001))]})),/TEXT_TOO_LONG/);
});
test('empty body stays empty and unsupported parser failure never supplies invented text',()=>{
 assert.equal(codec.hwpx(hwpx({sections:[''],overrides:{'Preview/PrvText.txt':'추정 원고'}})).content,'');
 assert.throws(()=>codec.hwpx(hwpx(),class {parseFromString(){return {documentElement:{},getElementsByTagName:()=>[{}]};}}),/HWPX_XML_INVALID/);
 assert.throws(()=>codec.unpack(hwpx(),'OTHER'),/FILE_TYPE_UNSUPPORTED/);
});
