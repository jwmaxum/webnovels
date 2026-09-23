/* Local-only manuscript conversion. fflate 0.8.2 (MIT), no remote resources. */
(function(root){
  'use strict';
  const MAX_FILE=2*1024*1024,MAX_TEXT=200000,MAX_XML=4*1024*1024,MAX_EXPANDED=16*1024*1024;
  const fail=code=>{throw Error(code);};
  const text=(bytes,encoding='utf-8')=>{
    let value;try{value=new TextDecoder(encoding,{fatal:true}).decode(bytes);}catch{fail('TEXT_ENCODING_INVALID');}
    if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/u.test(value))fail('TEXT_BINARY_OR_INVALID');
    value=value.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');if(value.length>MAX_TEXT)fail('TEXT_TOO_LONG');return value;
  };
  function txt(bytes,encoding='auto') {
    if(bytes.length>MAX_FILE)fail('FILE_TOO_LARGE');
    if(encoding!=='auto')return {content:text(bytes,encoding),encoding,warnings:[]};
    const selected=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8';
    try{return {content:text(bytes,selected),encoding:selected,warnings:[]};}
    catch(e){if(e.message==='TEXT_TOO_LONG')throw e;return {content:text(bytes,'euc-kr'),encoding:'euc-kr',warnings:['ENCODING_CONFIRM_REQUIRED']};}
  }
  function unpack(bytes) {
    if(bytes.length>MAX_FILE)fail('FILE_TOO_LARGE');if(bytes[0]!==80||bytes[1]!==75||bytes[2]!==3||bytes[3]!==4)fail('DOCX_SIGNATURE_INVALID');
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),directory=new Map();let end=-1;
    for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50&&i+22+view.getUint16(i+20,true)===bytes.length){end=i;break;}
    if(end<0||view.getUint16(end+4,true)||view.getUint16(end+6,true))fail('DOCX_ARCHIVE_INVALID');
    const count=view.getUint16(end+10,true),start=view.getUint32(end+16,true),length=view.getUint32(end+12,true);
    if(count>256||start+length!==end)fail('DOCX_ARCHIVE_INVALID');let pos=start,declared=0;
    for(let i=0;i<count;i++){
      if(pos+46>end||view.getUint32(pos,true)!==0x02014b50)fail('DOCX_ARCHIVE_INVALID');
      const flags=view.getUint16(pos+8,true),method=view.getUint16(pos+10,true),size=view.getUint32(pos+24,true),nameLength=view.getUint16(pos+28,true),extra=view.getUint16(pos+30,true),comment=view.getUint16(pos+32,true);
      if(flags&1||![0,8].includes(method)||pos+46+nameLength+extra+comment>end)fail('DOCX_ARCHIVE_INVALID');
      const name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(pos+46,pos+46+nameLength));
      if(directory.has(name))fail('DOCX_ARCHIVE_INVALID');declared+=size;if(size>MAX_XML||declared>MAX_EXPANDED)fail('DOCX_EXPANSION_LIMIT');
      directory.set(name,{size,crc:view.getUint32(pos+16,true)});pos+=46+nameLength+extra+comment;
    }
    if(pos!==end)fail('DOCX_ARCHIVE_INVALID');
    const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let bit=0;bit<8;bit++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
    let entries=0,total=0,problem=null;const files={},seen=new Set();
    const unzip=new root.fflate.Unzip(file=>{
      if(++entries>256 || seen.has(file.name)||file.name.includes('..')||file.name.startsWith('/')||file.name.includes('\\'))fail('DOCX_ARCHIVE_INVALID');seen.add(file.name);
      if(/vbaProject|activeX|embeddings\/|\.exe$|\.bin$/i.test(file.name))fail('DOCX_ACTIVE_CONTENT');
      const wanted=file.name==='word/document.xml'||file.name==='[Content_Types].xml'||file.name.endsWith('.rels');
      const expected=directory.get(file.name);if(!expected)fail('DOCX_ARCHIVE_INVALID');let crc=0xffffffff;
      if(file.originalSize>MAX_EXPANDED)fail('DOCX_EXPANSION_LIMIT');
      let size=0;const chunks=[];
      file.ondata=(error,data,final)=>{
        if(error){problem=error;return;}size+=data.length;total+=data.length;
        if(total>MAX_EXPANDED||size>MAX_XML){file.terminate();fail('DOCX_EXPANSION_LIMIT');}
        for(const byte of data)crc=crcTable[(crc^byte)&255]^(crc>>>8);
        if(final&&(size!==expected.size||((crc^0xffffffff)>>>0)!==expected.crc))fail('DOCX_CHECKSUM_INVALID');
        if(wanted)chunks.push(data);
        if(final&&wanted){const all=new Uint8Array(size);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}files[file.name]=new TextDecoder('utf-8',{fatal:true}).decode(all);}
      };
      file.start();
    });
    unzip.register(root.fflate.UnzipInflate);
    // Bound allocations per inflater push as well as total expanded output.
    for(let offset=0;offset<bytes.length;offset+=256){unzip.push(bytes.subarray(offset,offset+256),offset+256>=bytes.length);if(problem)throw problem;}
    if(seen.size!==directory.size)fail('DOCX_ARCHIVE_INVALID');
    if(!files['word/document.xml']||!files['[Content_Types].xml'])fail('DOCX_PACKAGE_INVALID');
    for(const xml of Object.values(files))if(/<!DOCTYPE|<!ENTITY/i.test(xml))fail('DOCX_ACTIVE_CONTENT');
    if(/macroEnabled/i.test(files['[Content_Types].xml']))fail('DOCX_ACTIVE_CONTENT');
    return {files,names:[...seen]};
  }
  function docx(bytes,Parser=root.DOMParser) {
    const {files,names}=unpack(bytes),warnings=new Set();
    function xml(value){const parsed=new Parser().parseFromString(value,'application/xml');if(parsed.getElementsByTagName('parsererror').length)fail('DOCX_XML_INVALID');return parsed;}
    const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main',doc=xml(files['word/document.xml']);
    const body=doc.getElementsByTagNameNS(ns,'body')[0];if(!body)fail('DOCX_BODY_MISSING');
    if(Array.from(body.childNodes).some(n=>n.nodeType===1&&!['p','tbl','sectPr'].includes(n.localName)))warnings.add('UNSUPPORTED_BLOCK_IGNORED');
    for(const [name,value]of Object.entries(files))if(name.endsWith('.rels')){
      const rels=xml(value).getElementsByTagNameNS('*','Relationship');
      for(const rel of Array.from(rels))if(rel.getAttribute('TargetMode')==='External')warnings.add('EXTERNAL_REFERENCES_IGNORED');
    }
    const unsupported={tbl:'TABLE_IGNORED',drawing:'IMAGE_IGNORED',pict:'IMAGE_IGNORED',footnoteReference:'FOOTNOTE_IGNORED',endnoteReference:'FOOTNOTE_IGNORED',commentReference:'COMMENT_IGNORED',altChunk:'EMBEDDED_CONTENT_IGNORED',del:'DELETED_TEXT_IGNORED',instrText:'FIELD_CODE_IGNORED'};
    for(const [tag,message]of Object.entries(unsupported))if(doc.getElementsByTagNameNS(ns,tag).length)warnings.add(message);
    if(names.some(n=>/word\/(header|footer)/.test(n)))warnings.add('HEADER_FOOTER_IGNORED');
    function walk(node){
      if(node.namespaceURI===ns){if(unsupported[node.localName])return '';if(node.localName==='t')return node.textContent;
        if(node.localName==='tab')return '\t';if(['br','cr'].includes(node.localName))return '\n';}
      return Array.from(node.childNodes||[]).map(walk).join('');
    }
    const paragraphs=Array.from(body.childNodes).filter(n=>n.namespaceURI===ns&&n.localName==='p').map(walk);
    const content=paragraphs.join('\n');if(content.length>MAX_TEXT)fail('TEXT_TOO_LONG');
    return {content,encoding:'DOCX',warnings:[...warnings]};
  }
  function safeName(value){let result=String(value).normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/g,'').slice(0,100);if(!result||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result))result='원고_'+result;return result;}
  function bundle(manifest){
    const files={},encoder=new TextEncoder();
    manifest.items.forEach((item,i)=>{const name=String(i+1).padStart(4,'0')+'_'+safeName(item.state)+'_'+safeName(item.title)+'.txt';files[name]=encoder.encode(item.content);item.filename=name;});
    files['manifest.json']=encoder.encode(JSON.stringify(manifest,null,2));return root.fflate.zipSync(files,{level:0});
  }
  root.CreatorFileCodec={MAX_FILE,MAX_TEXT,txt,docx,unpack,safeName,bundle};
})(globalThis);
