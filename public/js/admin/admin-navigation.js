// Admin navigation metadata only. Existing server and leaf permissions remain authoritative.
(function(root){
  'use strict';
  const definitions=[
    {key:'home',label:'운영 홈',tabs:[{key:'dashboard',label:'운영 현황',page:'dashboard'}]},
    {key:'content',label:'콘텐츠·전시',tabs:[{key:'works',label:'작품·회차',page:'works'},{key:'episodes',label:'회차 조회',page:'episodes'},{key:'curation',label:'추천·홈 구성',page:'curation'},{key:'pages',label:'공지·정책',page:'content-pages'}]},
    {key:'members',label:'회원 관리',tabs:[{key:'reader',label:'독자',page:'accounts',kind:'reader'},{key:'author',label:'작가',page:'accounts',kind:'author'}]},
    {key:'finance',label:'결제·정산',defaultTab:'payouts',tabs:[{key:'payments',label:'결제·입금',page:'payments'},{key:'refunds',label:'환불·포인트',page:'refunds'},{key:'payouts',label:'작가 정산',page:'settlements'},{key:'reconciliation',label:'대사',page:'reconciliation'}]},
    {key:'inbox',label:'통합처리함',tabs:[{key:'cases',label:'신고·변경 검토',page:'cases'},{key:'recovery',label:'원고 복구',page:'recovery'},{key:'appeals',label:'이의제기',page:'appeals'},{key:'support',label:'문의·운영 현황',page:'beta-operations'}]},
    {key:'settings',label:'설정',tabs:[{key:'service',label:'서비스 정책',page:'settings'},{key:'connections',label:'외부 연동',page:'settings'},{key:'roles',label:'운영자·권한',page:'roles'},{key:'audit',label:'감사 기록',page:'audit'},{key:'status',label:'운영 상태',page:'beta-operations'},{key:'tools',label:'제한된 시험 도구',page:'virtual-accounts'}]}
  ];
  const aliases=new Map([
    ['dashboard',['home','dashboard']],['analytics',['home','dashboard']],
    ['works',['content','works']],['cms',['content','works']],['episodes',['content','episodes']],['curation',['content','curation']],
    ['accounts',['members','reader']],['users',['members','reader',null,'reader']],['authors',['members','author',null,'author']],['creators',['members','author',null,'author']],
    ['settlements',['finance','payouts']],['revenue',['finance','payouts']],
    ['cases',['inbox','cases']],['actionqueue',['inbox','cases']],['review',['inbox','cases','CONTENT_REVIEW']],['comments',['inbox','cases','COMMENT_REPORT']],
    ['recovery',['inbox','recovery']],['appeals',['inbox','appeals']],['beta-operations',['inbox','support']],
    ['roles',['settings','roles']],['subadmins',['settings','roles']],['audit',['settings','audit']],['security',['settings','audit']],['system',['settings','service']],['virtual-accounts',['settings','tools']]
  ]);
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const decimal=value=>/^(0|[1-9][0-9]{0,18})$/.test(value)&&BigInt(value)<=9223372036854775807n;
  const identifier=value=>uuid.test(value)||decimal(value)&&value!=='0';
  const source=value=>['CONTENT_REVIEW','COMMENT_REPORT','REPORT'].includes(value);
  const date=value=>{
    if(!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)||!Number.isFinite(Date.parse(value)))return false;
    const day=value.slice(0,10);return new Date(day).toISOString().slice(0,10)===day;
  };
  const targets=/^(?:WORK|EPISODE|AUTHOR|READER|APPEAL|CONTENT_REVIEW|COMMENT_REPORT|REPORT|author|reader):(.+)$/;
  const filters=Object.freeze({
    source,kind:value=>['reader','author'].includes(value),caseId:identifier,workId:value=>decimal(value)&&value!=='0',episodeId:value=>decimal(value)&&value!=='0',changeId:identifier,
    target:value=>{const match=value.match(targets);return !!match&&identifier(match[1]);},
    offset:value=>/^(0|[1-9][0-9]{0,5})$/.test(value)&&Number(value)<=100000,status:value=>/^[A-Z][A-Z0-9_]{0,39}$/.test(value),
    priority:value=>['LOW','NORMAL','HIGH','URGENT'].includes(value),assignee:value=>uuid.test(value)||['all','me','unassigned','UNASSIGNED'].includes(value),after:date,before:date,at:date
  });
  const failure=()=>Object.freeze({valid:false,error:'INVALID_ADMIN_ROUTE'});
  const groupFor=key=>definitions.find(group=>group.key===key);
  const tabFor=(group,key)=>group?.tabs.find(tab=>tab.key===key);
  const defaultTab=group=>group.defaultTab||group.tabs[0].key;
  function originFor(options){
    const value=options?.origin||root.location?.origin||'https://admin.invalid';
    try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&url.origin===value&&!url.username&&!url.password?url.origin:null;}catch{return null;}
  }
  function canonical(model){
    if(model?.valid===false)return null;
    const group=groupFor(model?.group),tab=tabFor(group,model?.tab);
    if(!group||!tab)return null;
    const params=new URLSearchParams();
    if(group.key==='members')params.set('kind',tab.kind);
    else if(group.key!=='home')params.set('tab',tab.key);
    if(tab.page==='cases')params.set('source',model.source||model.params?.source||'CONTENT_REVIEW');
    for(const key of Object.keys(filters)){
      if(key==='kind'||key==='source')continue;
      if(!model.params||!Object.hasOwn(model.params,key))continue;
      const value=model.params[key];if(value===undefined)continue;
      if(typeof value!=='string'||!filters[key](value))return null;params.set(key,value);
    }
    if(tab.page==='cases'&&!source(params.get('source')))return null;
    const query=params.toString();return (group.key==='home'?'/admin':'/admin/'+group.key)+(query?'?'+query:'');
  }
  function parse(input,options){
    const origin=originFor(options);if(!origin)return failure();
    let raw;if(typeof input==='string')raw=input;else if(input instanceof URL)raw=input.href;else return failure();
    if(!raw||raw.length>2048||raw.startsWith('//')||/[\\\x00-\x20\x7f]/.test(raw)||/%(?:2f|5c|2e)/i.test(raw)||/%(?![0-9a-f]{2})/i.test(raw)||/(?:^|\/)\.{1,2}(?:\/|[?#]|$)/.test(raw))return failure();
    if(/^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw)&&!/^https?:\/\/[^/]/.test(raw))return failure();
    if(!raw.startsWith('/')&&!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw))raw='/admin/'+raw;
    let url;try{url=new URL(raw,origin);}catch{return failure();}
    if(url.origin!==origin||url.username||url.password||url.hash||!['https:','http:'].includes(url.protocol))return failure();
    const match=url.pathname.match(/^\/admin(?:\/([a-z][a-z0-9-]*))?\/?$/);if(!match)return failure();
    const key=match[1]||'home',defined=groupFor(key),alias=aliases.get(key);
    if(!defined&&!alias)return failure();
    const group=defined||groupFor(alias[0]);let tabKey=defined?defaultTab(group):alias[1];
    let explicit=!!alias,kind=alias?.[3],forcedSource=alias?.[2];
    const params=Object.create(null),dropped=[];
    for(const [name,value]of url.searchParams){
      if(['__proto__','prototype','constructor'].includes(name))return failure();
      if(url.searchParams.getAll(name).length!==1)return failure();
      if(name==='tab'){
        if(!defined||!tabFor(group,value))return failure();tabKey=value;explicit=true;continue;
      }
      if(!Object.hasOwn(filters,name)){dropped.push(name);continue;}
      if(value.length>200||!filters[name](value))return failure();params[name]=value;
    }
    if(group.key!=='members'&&params.kind){delete params.kind;dropped.push('kind');}
    if(group.key==='members'){
      if(params.kind){
        if(kind&&kind!==params.kind||url.searchParams.has('tab')&&tabKey!==params.kind)return failure();
        tabKey=params.kind;explicit=true;
      }
      kind=tabKey;params.kind=kind;
    }
    const tab=tabFor(group,tabKey);if(!tab)return failure();
    if(forcedSource&&params.source&&params.source!==forcedSource)return failure();
    const chosenSource=tab.page==='cases'?(forcedSource||params.source||'CONTENT_REVIEW'):undefined;
    if(chosenSource)params.source=chosenSource;
    else if(params.source){delete params.source;dropped.push('source');}
    const model={valid:true,group:group.key,tab:tab.key,page:tab.page,...(kind?{kind}:{}),...(chosenSource?{source:chosenSource}:{}),params:Object.freeze({...params}),legacy:!!alias,explicit,droppedParams:Object.freeze([...new Set(dropped)])};
    const href=canonical(model);return href?Object.freeze({...model,href}):failure();
  }
  function path(model){return canonical(model);}
  function groups(canRead){
    if(typeof canRead!=='function')return Object.freeze([]);
    const result=[];
    for(const group of definitions){
      const tabs=group.tabs.filter(tab=>canRead(tab.page,Object.freeze({...tab,group:group.key}))===true).map(tab=>Object.freeze({...tab,group:group.key,href:canonical({group:group.key,tab:tab.key})}));
      if(!tabs.length)continue;const initial=tabs.find(tab=>tab.key===defaultTab(group))||tabs[0];
      result.push(Object.freeze({key:group.key,label:group.label,href:initial.href,tabs:Object.freeze(tabs)}));
    }
    return Object.freeze(result);
  }
  root.AdminNavigation=Object.freeze({parse,path,groups});
})(window);
