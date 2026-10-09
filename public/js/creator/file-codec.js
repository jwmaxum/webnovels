/* Local-only manuscript conversion. fflate 0.8.3 (MIT), no remote resources. */
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
  function unpack(bytes,type='DOCX',zip=root.fflate) {
    const fail=code=>{throw Error(type==='HWPX'?code.replace(/^DOCX_/,'HWPX_'):code);};
    if(!['DOCX','HWPX'].includes(type))fail('FILE_TYPE_UNSUPPORTED');
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
    let entries=0,total=0,problem=null;const files=Object.create(null),seen=new Set(),aliases=new Set();
    const unzip=new zip.Unzip(file=>{
      if(++entries>256 || seen.has(file.name)||file.name.includes('..')||file.name.startsWith('/')||file.name.includes('\\'))fail('DOCX_ARCHIVE_INVALID');seen.add(file.name);
      if(/vbaProject|activeX|embeddings\/|\.exe$|\.bin$/i.test(file.name))fail('DOCX_ACTIVE_CONTENT');
      if(type==='HWPX'){
        const parts=file.name.replace(/\/$/,'').split('/');
        if(/[\x00-\x1f\x7f:%?#]/.test(file.name)||parts.some(part=>!part||part==='.'||part==='..'||/[. ]$/.test(part))||aliases.has(file.name.toLowerCase()))fail('DOCX_ARCHIVE_INVALID');
        aliases.add(file.name.toLowerCase());
        if(/^Scripts\/.+/i.test(file.name)||/\.(?:js|jse|vbs|ps1|bat|cmd|com|dll|msi|jar|ole)$/i.test(file.name))fail('DOCX_ACTIVE_CONTENT');
      }
      const wanted=type==='HWPX'?file.name==='mimetype'||/\.(?:xml|hpf|rels)$/i.test(file.name):
        file.name==='word/document.xml'||file.name==='[Content_Types].xml'||file.name.endsWith('.rels');
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
    unzip.register(zip.UnzipInflate);
    // Bound allocations per inflater push as well as total expanded output.
    for(let offset=0;offset<bytes.length;offset+=256){unzip.push(bytes.subarray(offset,offset+256),offset+256>=bytes.length);if(problem)throw problem;}
    if(seen.size!==directory.size)fail('DOCX_ARCHIVE_INVALID');
    if(type==='DOCX'&&(!files['word/document.xml']||!files['[Content_Types].xml']))fail('DOCX_PACKAGE_INVALID');
    if(type==='HWPX'&&(files.mimetype!=='application/hwp+zip'||!files['META-INF/container.xml']||!files['Contents/content.hpf']||!files['Contents/header.xml']))fail('HWPX_PACKAGE_INVALID');
    for(const xml of Object.values(files))if(/<!DOCTYPE|<!ENTITY/i.test(xml))fail('DOCX_ACTIVE_CONTENT');
    if(type==='HWPX'&&Object.values(files).some(xml=>/<(?:[^\s<>/:'"]+:)?(?:encryption-data|EncryptedData|CipherData|encrypted-key)\b/i.test(xml)))fail('HWPX_ENCRYPTED_DOCUMENT');
    if(type==='DOCX'&&/macroEnabled/i.test(files['[Content_Types].xml']))fail('DOCX_ACTIVE_CONTENT');
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
  function hwpx(bytes,Parser=root.DOMParser) {
    const {files,names}=unpack(bytes,'HWPX'),warnings=new Set(['FORMATTING_IGNORED']);
    const sectionNs='http://www.hancom.co.kr/hwpml/2011/section',paragraphNs='http://www.hancom.co.kr/hwpml/2011/paragraph',
      headNs='http://www.hancom.co.kr/hwpml/2011/head',containerNs='urn:oasis:names:tc:opendocument:xmlns:container',
      opfNamespaces=new Set(['http://www.idpf.org/2007/opf/','http://www.idpf.org/2007/opf']);
    function xml(value){
      let parsed;try{parsed=new Parser().parseFromString(value,'application/xml');}catch{fail('HWPX_XML_INVALID');}
      if(!parsed.documentElement||parsed.getElementsByTagName('parsererror').length)fail('HWPX_XML_INVALID');return parsed;
    }
    const elements=node=>Array.from(node.childNodes||[]).filter(child=>child.nodeType===1);
    const one=(parent,ns,tag)=>{const found=elements(parent).filter(node=>node.namespaceURI===ns&&node.localName===tag);if(found.length!==1)fail('HWPX_PACKAGE_INVALID');return found[0];};
    const container=xml(files['META-INF/container.xml']).documentElement;
    if(container.namespaceURI!==containerNs||container.localName!=='container')fail('HWPX_PACKAGE_INVALID');
    const roots=elements(one(container,containerNs,'rootfiles'));
    const packages=roots.filter(node=>node.getAttribute('media-type')==='application/hwpml-package+xml');
    if(roots.some(node=>node.namespaceURI!==containerNs||node.localName!=='rootfile')||packages.length!==1||packages[0].getAttribute('full-path')!=='Contents/content.hpf')fail('HWPX_PACKAGE_INVALID');
    const pkg=xml(files['Contents/content.hpf']).documentElement,opf=pkg.namespaceURI;
    if(!opfNamespaces.has(opf)||pkg.localName!=='package')fail('HWPX_NAMESPACE_UNSUPPORTED');
    const manifest=one(pkg,opf,'manifest'),spine=one(pkg,opf,'spine'),items=new Map();
    for(const node of elements(manifest)){
      if(node.namespaceURI!==opf||node.localName!=='item')fail('HWPX_PACKAGE_INVALID');
      const id=node.getAttribute('id'),href=node.getAttribute('href'),media=node.getAttribute('media-type');
      if(!/^[a-zA-Z_][\w.-]{0,127}$/.test(id)||items.has(id)||!href||href.length>255)fail('HWPX_PACKAGE_INVALID');
      if(/javascript|vbscript|ole|executable/i.test(media))fail('HWPX_ACTIVE_CONTENT');
      const external=/^[a-z][a-z0-9+.-]*:/i.test(href)||href.startsWith('//');
      if(external)warnings.add('EXTERNAL_REFERENCES_IGNORED');
      else if(!/^[a-zA-Z0-9_./-]+$/.test(href)||href.startsWith('/')||href.split('/').some(part=>!part||part==='.'||part==='..'))fail('HWPX_PACKAGE_INVALID');
      const file=/^(?:section\d+|header)\.xml$/.test(href)?'Contents/'+href:href;
      items.set(id,{file,external});
    }
    const sections=[],seen=new Set();
    for(const ref of elements(spine)){
      if(ref.namespaceURI!==opf||ref.localName!=='itemref')fail('HWPX_PACKAGE_INVALID');
      const item=items.get(ref.getAttribute('idref'));if(!item||item.external)fail('HWPX_EXTERNAL_REFERENCE');
      if(item.file==='Contents/header.xml')continue;
      if(!/^Contents\/section\d+\.xml$/.test(item.file)||!files[item.file]||seen.has(item.file))fail('HWPX_PACKAGE_INVALID');
      seen.add(item.file);sections.push(item.file);
    }
    if(!sections.length||names.filter(name=>/^Contents\/section\d+\.xml$/.test(name)).some(name=>!seen.has(name)))fail('HWPX_PACKAGE_INVALID');
    const header=xml(files['Contents/header.xml']).documentElement;
    if(header.namespaceURI!==headNs||header.localName!=='head')fail('HWPX_NAMESPACE_UNSUPPORTED');
    if(!/^[1-9]\d{0,2}$/.test(header.getAttribute('secCnt'))||Number(header.getAttribute('secCnt'))!==sections.length)fail('HWPX_SECTION_COUNT_MISMATCH');
    const ignored={tbl:'TABLE_IGNORED',pic:'IMAGE_IGNORED',ole:'EMBEDDED_CONTENT_IGNORED',equation:'FIELD_CODE_IGNORED',
      footNote:'FOOTNOTE_IGNORED',endNote:'FOOTNOTE_IGNORED',header:'HEADER_FOOTER_IGNORED',footer:'HEADER_FOOTER_IGNORED',
      fieldBegin:'FIELD_CODE_IGNORED',fieldEnd:'FIELD_CODE_IGNORED',memo:'COMMENT_IGNORED',trackChange:'DELETED_TEXT_IGNORED'};
    function run(node){
      if(node.namespaceURI!==paragraphNs){if(['p','run','t'].includes(node.localName))fail('HWPX_NAMESPACE_UNSUPPORTED');warnings.add('UNSUPPORTED_BLOCK_IGNORED');return '';}
      if(ignored[node.localName]){warnings.add(ignored[node.localName]);return '';}
      if(node.localName==='tab')return '\t';if(node.localName==='lineBreak')return '\n';
      if(node.localName==='t')return Array.from(node.childNodes).map(child=>[3,4].includes(child.nodeType)?child.nodeValue:child.nodeType===1?run(child):'').join('');
      if(node.localName==='run')return elements(node).map(run).join('');
      if(['secPr','ctrl','linesegarray'].includes(node.localName))return '';
      warnings.add('UNSUPPORTED_BLOCK_IGNORED');return '';
    }
    const paragraphs=[];
    for(const file of sections){
      const doc=xml(files[file]),section=doc.documentElement;
      if(section.namespaceURI!==sectionNs||section.localName!=='sec')fail('HWPX_NAMESPACE_UNSUPPORTED');
      for(const node of Array.from(doc.getElementsByTagName('*')))if(ignored[node.localName])warnings.add(ignored[node.localName]);
      for(const paragraph of elements(section)){
        if(paragraph.namespaceURI===paragraphNs&&paragraph.localName==='p')paragraphs.push(elements(paragraph).map(run).join(''));
        else {if(paragraph.localName==='p')fail('HWPX_NAMESPACE_UNSUPPORTED');warnings.add('UNSUPPORTED_BLOCK_IGNORED');}
      }
    }
    if(names.some(name=>name.startsWith('BinData/')))warnings.add('IMAGE_IGNORED');
    if(names.some(name=>/masterpage|history|memo/i.test(name)))warnings.add('UNSUPPORTED_BLOCK_IGNORED');
    const content=paragraphs.join('\n').replace(/\r\n?/g,'\n');
    if(content.length>MAX_TEXT)fail('TEXT_TOO_LONG');
    if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/u.test(content))fail('TEXT_BINARY_OR_INVALID');
    return {content,encoding:'HWPX',warnings:[...warnings]};
  }
  function safeName(value){let result=String(value).normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/g,'').slice(0,100);if(!result||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result))result='원고_'+result;return result;}
  function bundle(manifest){
    const files={},encoder=new TextEncoder();
    manifest.items.forEach((item,i)=>{const name=String(i+1).padStart(4,'0')+'_'+safeName(item.state)+'_'+safeName(item.title)+'.txt';files[name]=encoder.encode(item.content);item.filename=name;});
    files['manifest.json']=encoder.encode(JSON.stringify(manifest,null,2));return root.fflate.zipSync(files,{level:0});
  }
  root.CreatorFileCodec={MAX_FILE,MAX_TEXT,txt,docx,hwpx,unpack,safeName,bundle};
})(globalThis);
