/* Published display documents only. Rankings and catalog flags never fill manual selections. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const kinds=['ALL','NOVEL','WEBTOON'],blockKeys=['hero','recommendations','latest','ranking','notice'];
  const menuPaths={home:'/home',novel:'/discover?type=NOVEL',webtoon:'/discover?type=WEBTOON',recommendations:'/recommendations',ranking:'/discover?sort=popular'};
  const titles={hero:'대표 추천',recommendations:'추천 작품',latest:'최근 공개',ranking:'최근 7일 많이 읽은 작품',notice:'공지'};
  const decimal=value=>typeof value==='string'&&/^[1-9][0-9]{0,18}$/.test(value)&&BigInt(value)<=9223372036854775807n;
  const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const text=(value,max)=>typeof value==='string'&&value.length<=max;
  const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
  let homeTurn=0,pageTurn=0,viewerTurn=0,chromeTurn=0,homeData=null,chromeData=null;
  let currentPage=null,currentViewer=null;
  const menuDefaults=new Map();
  const view=id=>!window.currentActiveView||window.currentActiveView===id;
  const node=(parent,tag,value,cls)=>{const item=document.createElement(tag);if(value!=null)item.textContent=String(value);if(cls)item.className=cls;parent?.append(item);return item;};
  const t = (source, params = {}) => window.ReaderI18n?.t(source, params) ?? source.replace(/\{(\w+)\}/g, (_, key) => params[key] ?? '');
  function localized(item, label, attribute) {
    if (!item) return item;
    const render = typeof label === 'function' ? label : () => t(label);
    if (window.ReaderFeatureCopy) window.ReaderFeatureCopy.bind(item, render, attribute);
    else if (attribute) item.setAttribute(attribute, render());
    else item.textContent = render();
    return item;
  }
  const message = (parent, tag, label, cls) => localized(node(parent, tag, null, cls), label);
  function link(parent,label,path,cls){
    const item=label ? message(parent,'a',label,cls) : node(parent,'a',null,cls);item.href=path;
    item.onclick=event=>{if(event&&(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||event.button>0))return;
      if(typeof window.navigateTo!=='function'||!/^\/(?:works\/|home(?:$|\?)|discover(?:$|\?)|recommendations(?:$|\?))/.test(path))return;
      event?.preventDefault();window.navigateTo(path);};return item;
  }
  const status=(parent,label)=>{const item=message(parent,'p',label,'reader-display-status');item.setAttribute('role','status');return item;};
  function retry(parent,action){const button=message(parent,'button','다시 시도','btn btn-outline');button.type='button';button.onclick=action;return button;}
  function safeHref(value){
    if(typeof value!=='string')return null;
    if(/^\/(?:home|discover|recommendations)\/?$/.test(value)||/^\/company\/?$/.test(value)||/^\/policies\/(?:terms|privacy|refund|settlement)\/?$/.test(value))return value;
    const match=value.match(/^\/works\/([1-9][0-9]{0,18})$/);return match&&decimal(match[1])?value:null;
  }
  function cover(value){
    if(typeof value!=='string'||!value||/[<>"'`()\\\s]/.test(value)||!(/^(?:\/(?!\/)|https:\/\/)/.test(value)))return null;
    try{const parsed=new URL(value,window.location?.origin||'https://display.invalid');return parsed.username||parsed.password||!['https:','http:'].includes(parsed.protocol)?null:value;}catch{return null;}
  }
  function work(value){
    if(!value||!decimal(value.id)||!text(value.title,500)||!text(value.author,500)||!['NOVEL','WEBTOON'].includes(value.content_type)||
      !['ALL','AGE_15'].includes(value.rating)||!Number.isSafeInteger(value.episode_count)||value.episode_count<1)throw Error('INVALID_DISPLAY');
    return value;
  }
  function validate(value,{type='ALL',offset=0}={}){
    if(!value||value.ready!==true||!(value.revision==='0'||uuid(value.revision))||!Array.isArray(value.items)||value.items.length>24||
      value.offset!==offset||value.limit!==24||!Number.isSafeInteger(value.total)||value.total<0||typeof value.hasMore!=='boolean'||
      value.hasMore!==(value.nextOffset!==null)||value.nextOffset!==null&&value.nextOffset!==offset+24||!value.home||!Array.isArray(value.home.featured)||value.home.featured.length>8)throw Error('INVALID_DISPLAY');
    if(value.publication!==null&&(!value.publication||!uuid(value.publication.id)||!date(value.publication.startsAt)||value.publication.endsAt!==null&&!date(value.publication.endsAt)))throw Error('INVALID_DISPLAY');
    const seen=new Set();for(const item of value.items){work(item);if(seen.has(item.id)||type!=='ALL'&&item.content_type!==type)throw Error('INVALID_DISPLAY');seen.add(item.id);}
    if(value.home.hero!==null)work(value.home.hero);const featured=new Set();for(const item of value.home.featured){work(item);if(featured.has(item.id))throw Error('INVALID_DISPLAY');featured.add(item.id);}
    if(value.publication===null&&(value.items.length||value.home.hero||value.home.featured.length))throw Error('INVALID_DISPLAY');
    if(!Array.isArray(value.blocks)||value.blocks.length!==5||new Set(value.blocks.map(item=>item?.key)).size!==5||
      value.blocks.some(item=>!blockKeys.includes(item.key)||typeof item.enabled!=='boolean'||!text(item.title,60)))throw Error('INVALID_DISPLAY');
    if(!Array.isArray(value.menus)||value.menus.length!==5||new Set(value.menus.map(item=>item?.key)).size!==5||
      value.menus.some(item=>!Object.hasOwn(menuPaths,item.key)||!text(item.label,20)||!item.label.trim()||typeof item.visible!=='boolean')||
      value.menus.find(item=>item.key==='home')?.visible!==true)throw Error('INVALID_DISPLAY');
    if(!Array.isArray(value.notices)||value.notices.length>10||!text(value.footerNote,300)||value.notices.some(item=>!item||!uuid(item.id)||!text(item.title,80)||!text(item.body,2000)||
      item.href!==''&&!safeHref(item.href)||typeof item.enabled!=='boolean'||item.startsAt!==null&&!date(item.startsAt)||item.endsAt!==null&&!date(item.endsAt)))throw Error('INVALID_DISPLAY');
    return value;
  }
  async function request({type='ALL',offset=0}={}){
    const locale = window.ReaderI18n?.locale() || 'ko';
    const params = new URLSearchParams({offset:String(offset),type});
    if (locale !== 'ko') params.set('locale', locale);
    const response=await fetch('/api/v2/display?'+params,{credentials:'omit',cache:'no-store',redirect:'error'});
    if(!response.ok)throw Error('DISPLAY_UNAVAILABLE');
    const data = validate(await response.json(),{type,offset});
    for (const item of [...data.items, data.home.hero, ...data.home.featured]) {
      if (item) window.ReaderI18n?.rememberWork(item, locale);
    }
    return data;
  }
  function card(parent,item,{hero=false}={}){
    const anchor=link(parent,'','/works/'+item.id,'reader-display-card'+(hero?' reader-display-hero-card':''));
    const art=node(anchor,'div',null,'reader-display-cover'),source=cover(item.cover_image);
    if(source){const image=node(art,'img');image.src=source;image.alt='';image.loading='lazy';image.decoding='async';}
    else message(art,'span','표지 준비 중','reader-display-cover-placeholder');
    const info=node(anchor,'div',null,'reader-display-info');message(info,'span',item.content_type==='WEBTOON'?'웹툰':'웹소설','reader-display-kind');
    const copy = () => window.ReaderI18n?.work(item) || item;
    const title = message(info,'h3',() => copy().title);
    localized(title, () => copy().titleLanguage || item.originalLanguage || 'ko', 'lang');
    node(info,'p',item.author,'reader-display-author');
    message(info,'p',() => [t(item.status==='COMPLETED'||item.is_completed?'완결':item.status==='PAUSED'?'휴재':'연재 중'),
      t(item.rating==='AGE_15'?'15세 이상':'전체이용가'),t(item.episode_count===1?'공개 1화':'공개 {count}화',{count:item.episode_count})].join(' · '),'reader-display-meta');
    if(text(item.caption,120)&&item.caption)node(info,'p',item.caption,'reader-display-caption');return anchor;
  }
  function chrome(data){
    chromeData=data;
    const managed=[...document.querySelectorAll?.('[data-reader-route]')||[]].filter(item=>Object.hasOwn(menuPaths,item.dataset?.readerRoute));
    for(const item of managed){
      const key=item.dataset.readerRoute,config=data.menus.find(menu=>menu.key===key);if(!menuDefaults.has(item))menuDefaults.set(item,{hidden:item.hidden===true});
      item.hidden=menuDefaults.get(item).hidden||!config.visible;
      const label=item.querySelector?.('[data-reader-label]')||item.querySelector?.('span')||item;
      localized(label, config.label);
    }
    const parents=new Set(managed.map(item=>item.parentElement).filter(Boolean)),order=new Map(data.menus.map((item,index)=>[item.key,index]));
    for(const parent of parents){
      const children=[...parent.children],selected=children.filter(item=>managed.includes(item)).sort((a,b)=>order.get(a.dataset.readerRoute)-order.get(b.dataset.readerRoute));let index=0;
      const ordered=children.map(item=>managed.includes(item)?selected[index++]:item);
      if(ordered.some((item,position)=>item!==children[position])){const focused=document.activeElement;parent.replaceChildren(...ordered);if(managed.includes(focused))focused.focus?.({preventScroll:true});}
    }
    let footer=$('readerDisplayFooterNote');if(!footer){const parent=document.querySelector?.('.legal-footer');if(parent){footer=node(parent,'p');footer.id='readerDisplayFooterNote';}}
    if(footer){footer.textContent=data.footerNote;footer.hidden=!data.footerNote;}
  }
  async function syncChrome(){
    const turn=++chromeTurn,acceptedView=window.currentActiveView;
    if(!['view-discover','view-work-detail','view-mypage'].includes(acceptedView))return;
    const route=()=>String(window.location?.pathname||'')+String(window.location?.search||''),acceptedRoute=route();
    const current=()=>turn===chromeTurn&&window.currentActiveView===acceptedView&&route()===acceptedRoute;
    try{const data=await request();if(current())chrome(data);}catch{/* Keep the current public navigation when the published feed is unavailable. */}
  }
  function mountHome(){
    const parent=$('view-home');if(!parent)return null;
    parent.classList.add('reader-display-owned');
    let root=$('readerDisplayHome');if(!root){root=node(parent,'div');root.id='readerDisplayHome';}root.classList.add('reader-display-home');
    const ensure=(id,tag='section')=>{let item=$(id);if(!item){item=node(root,tag);item.id=id;}return item;};
    const parts={status:ensure('readerDisplayHomeStatus','div'),hero:ensure('readerDisplayHero'),recommendations:ensure('readerDisplayFeatured'),latest:ensure('readerDisplayLatest','div'),ranking:ensure('readerDisplayRanking','div'),notice:ensure('readerDisplayNotices')};
    for(const key of blockKeys)parts[key].classList.add('reader-display-block');
    for(const id of ['recentNovelsSection','webtoonsSection']){const item=$(id);if(item&&item.parentElement!==parts.latest)parts.latest.append(item);}
    const ranking=$('trendingWorksSection');if(ranking&&ranking.parentElement!==parts.ranking)parts.ranking.append(ranking);
    return {root,...parts};
  }
  function hideOld(){
    for(const id of ['heroFeaturedSection','editorialSpotlightSection','genreRecSection','goldenBestSection','todayFreeSection','newWorksSection','completedWorksSection','growthHome'])if($(id))$(id).hidden=true;
  }
  function activeNotices(data){const now=Date.now();return data.notices.filter(item=>item.enabled&&(!item.startsAt||Date.parse(item.startsAt)<=now)&&(!item.endsAt||Date.parse(item.endsAt)>now));}
  function syncHome(){
    hideOld();const parts=mountHome();if(!parts||!homeData)return;
    const notices=activeNotices(homeData);
    for(const config of homeData.blocks){
      const section=parts[config.key];section.hidden=!config.enabled;
      if(config.key==='hero')section.hidden||=homeData.home.hero===null;
      if(config.key==='recommendations')section.hidden||=homeData.home.featured.length===0;
      if(config.key==='notice')section.hidden||=notices.length===0;
      if(config.key==='latest'){
        localized($('recentNovelsHeading'), () => t(config.title||titles.latest)+' · '+t('웹소설'));
        localized($('recentWebtoonsHeading'), () => t(config.title||titles.latest)+' · '+t('웹툰'));
      }
      if(config.key==='ranking')localized($('homePopularHeading'), config.title||titles.ranking);
      parts.root.append(section);
    }
  }
  function renderHome(data,parts){
    parts.status.replaceChildren();parts.status.hidden=true;
    for(const key of ['hero','recommendations','notice'])parts[key].replaceChildren();
    const config=key=>data.blocks.find(item=>item.key===key),heading=(section,key)=>message(section,'h2',config(key).title||titles[key],'reader-display-heading');
    heading(parts.hero,'hero');if(data.home.hero)card(parts.hero,data.home.hero,{hero:true});
    const head=node(parts.recommendations,'div',null,'reader-display-section-head');message(head,'h2',config('recommendations').title||titles.recommendations,'reader-display-heading');link(head,'추천 전체 보기','/recommendations','btn btn-outline');
    const grid=node(parts.recommendations,'div',null,'reader-display-grid');for(const item of data.home.featured)card(grid,item);
    heading(parts.notice,'notice');for(const item of activeNotices(data)){
      const notice=node(parts.notice,'article',null,'reader-display-notice');node(notice,'h3',item.title);node(notice,'p',item.body);if(item.href)link(notice,'자세히 보기',safeHref(item.href),'btn btn-outline');
    }
    chrome(data);syncHome();
  }
  async function home(){
    const turn=++homeTurn;homeData=null;hideOld();const parts=mountHome();if(!parts)return;
    for(const key of ['hero','recommendations','notice']){parts[key].replaceChildren();parts[key].hidden=true;}
    parts.status.replaceChildren();parts.status.hidden=false;status(parts.status,'관리자가 선정한 추천을 불러오는 중입니다.');parts.root.setAttribute('aria-busy','true');
    const current=()=>turn===homeTurn&&view('view-home');
    try{const data=await request();if(!current())return;homeData=data;renderHome(data,parts);}
    catch{if(current()){parts.status.replaceChildren();status(parts.status,'편집 추천을 불러오지 못했습니다.');retry(parts.status,home);}}
    finally{if(current())parts.root.setAttribute('aria-busy','false');}
  }
  function path(type,offset=0){const params=new URLSearchParams();if(type!=='ALL')params.set('type',type);if(offset)params.set('offset',String(offset));return '/recommendations'+(params.size?'?'+params:'');}
  async function enter({type='ALL',offset=0,focus=true}={}){
    const root=$('readerRecommendationsContent');if(!root)return;const turn=++pageTurn;
    currentPage={type,offset};
    root.replaceChildren();root.setAttribute('aria-busy','true');root.setAttribute('tabindex','-1');
    if(!kinds.includes(type)||!Number.isInteger(offset)||offset<0||offset>100000){status(root,'추천 페이지 주소를 확인해주세요.');root.setAttribute('aria-busy','false');return;}
    const current=()=>turn===pageTurn&&view('view-recommendations');status(root,'관리자가 선정한 작품을 불러오는 중입니다.');
    try{
      const data=await request({type,offset});if(!current())return;root.replaceChildren();
      message(root,'p','관리자가 직접 선정한 작품을 저장된 순서로 안내합니다.','reader-display-intro');
      const filters=node(root,'nav',null,'reader-display-filters');localized(filters,'추천 작품 유형','aria-label');
      for(const [value,label]of [['ALL','전체'],['NOVEL','웹소설'],['WEBTOON','웹툰']]){const item=link(filters,label,path(value),'btn btn-outline');if(value===type)item.setAttribute('aria-current','page');}
      status(root,() => t(data.total===1?'선정 작품 1개':'선정 작품 {count}개',{count:data.total}));const grid=node(root,'div',null,'reader-display-grid');
      for(const item of data.items)card(grid,item);
      if(!data.items.length){status(grid,offset?'이 페이지에 표시할 추천 작품이 없습니다.':'선정된 추천 작품을 준비 중입니다.');if(offset)link(grid,'첫 페이지로',path(type),'btn btn-outline');}
      const pager=node(root,'nav',null,'reader-display-pager');localized(pager,'추천 목록 페이지','aria-label');
      if(offset)link(pager,'이전 페이지',path(type,Math.max(0,offset-24)),'btn btn-outline');
      if(data.hasMore)link(pager,'다음 페이지',path(type,data.nextOffset),'btn btn-primary');
      chrome(data);if(focus)root.focus?.({preventScroll:true});
    }catch{if(current()){root.replaceChildren();status(root,'추천 작품을 불러오지 못했습니다.');retry(root,()=>enter({type,offset}));}}
    finally{if(current())root.setAttribute('aria-busy','false');}
  }
  async function viewer(currentWorkId,{isCurrent=()=>true,refresh=false}={}){
    const grid=$('readerRecommendGrid');if(!grid)return;const turn=++viewerTurn,box=$('readerRecommendBox');
    currentViewer={currentWorkId,isCurrent};
    if(!refresh){grid.replaceChildren();if(box)box.hidden=false;status(grid,'선정된 추천을 불러오는 중입니다.');}
    localized($('readerRecommendHeading'),'관리자 선정 추천');grid.setAttribute('aria-busy','true');
    const current=()=>turn===viewerTurn&&isCurrent()&&view('view-reader');
    try{const data=await request();if(!current())return;grid.replaceChildren();const works=data.items.filter(item=>item.id!==String(currentWorkId)).slice(0,4);
      for(const item of works)card(grid,item);if(box)box.hidden=works.length===0;chrome(data);
    }catch{if(current()&&!refresh){grid.replaceChildren();status(grid,'추천 작품을 불러오지 못했습니다.');retry(grid,()=>viewer(currentWorkId,{isCurrent}));}}
    finally{if(current())grid.setAttribute('aria-busy','false');}
  }
  function leave(viewId){
    chromeTurn++;
    if(viewId!=='view-home'){homeTurn++;homeData=null;for(const id of ['readerDisplayHero','readerDisplayFeatured','readerDisplayNotices'])$(id)?.replaceChildren();}
    if(viewId!=='view-recommendations'){pageTurn++;currentPage=null;}
    if(viewId!=='view-reader'){viewerTurn++;currentViewer=null;}
  }
  function reset(){leave();$('readerRecommendationsContent')?.replaceChildren();$('readerRecommendGrid')?.replaceChildren();}
  window.addEventListener?.('reader:localechange', () => {
    if (chromeData) chrome(chromeData);
    if (currentPage && view('view-recommendations')) void enter({...currentPage,focus:false});
    if (currentViewer && view('view-reader') && currentViewer.isCurrent()) {
      const {currentWorkId,isCurrent} = currentViewer;
      void viewer(currentWorkId,{isCurrent,refresh:true});
    }
  });
  window.ReaderDisplay=Object.freeze({home,syncHome,syncChrome,enter,viewer,leave,reset,path});
})();
