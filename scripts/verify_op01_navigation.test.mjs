import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/js/admin/admin-navigation.js',import.meta.url),'utf8');
function load(){
  const window={location:{origin:'https://webnovels.uk'}};
  vm.runInNewContext(source,{window,URL,URLSearchParams});
  return window.AdminNavigation;
}
const plain=value=>JSON.parse(JSON.stringify(value));
const navigation=load();

test('six groups retain the existing backend leaf and choose an accessible initial tab',()=>{
  const groups=navigation.groups(()=>true);
  assert.deepEqual(Array.from(groups,group=>group.key),['home','content','members','finance','inbox','settings']);
  assert.equal(groups.find(group=>group.key==='finance').href,'/admin/finance?tab=payouts');
  assert.equal(groups.find(group=>group.key==='settings').tabs.find(tab=>tab.key==='connections').page,'settings');
  assert.equal(groups.find(group=>group.key==='content').tabs.find(tab=>tab.key==='pages').page,'content-pages');
  assert.deepEqual(Array.from(groups.find(group=>group.key==='finance').tabs,tab=>tab.page),['payments','refunds','settlements','reconciliation']);
  const restricted=navigation.groups((page,tab)=>page==='accounts'&&tab.kind==='author'||page==='audit');
  assert.deepEqual(Array.from(restricted,group=>group.key),['members','settings']);
  assert.equal(restricted[0].href,'/admin/members?kind=author');
  assert.equal(restricted[1].href,'/admin/settings?tab=audit');
  assert.equal(navigation.groups(()=>false).length,0);
  assert.equal(navigation.groups().length,0);
});

test('permission callbacks receive immutable metadata without changing permission grants',()=>{
  let count=0;
  navigation.groups((page,tab)=>{
    count++;
    assert.equal(typeof page,'string');
    assert.ok(Object.isFrozen(tab));
    assert.throws(()=>{tab.page='settings';},TypeError);
    return page==='accounts'&&tab.kind==='reader';
  });
  assert.equal(count,21);
  assert.equal(navigation.groups((page,tab)=>page==='accounts'&&tab.kind==='reader')[0].tabs.length,1);
});

test('legacy leaves and aliases preserve exact destination and review source',()=>{
  const mappings={
    dashboard:['home','dashboard','dashboard','/admin'],analytics:['home','dashboard','dashboard','/admin'],
    works:['content','works','works','/admin/content?tab=works'],cms:['content','works','works','/admin/content?tab=works'],
    episodes:['content','episodes','episodes','/admin/content?tab=episodes'],curation:['content','curation','curation','/admin/content?tab=curation'],
    accounts:['members','reader','accounts','/admin/members?kind=reader'],users:['members','reader','accounts','/admin/members?kind=reader'],
    authors:['members','author','accounts','/admin/members?kind=author'],creators:['members','author','accounts','/admin/members?kind=author'],
    settlements:['finance','payouts','settlements','/admin/finance?tab=payouts'],revenue:['finance','payouts','settlements','/admin/finance?tab=payouts'],
    cases:['inbox','cases','cases','/admin/inbox?tab=cases&source=CONTENT_REVIEW'],actionqueue:['inbox','cases','cases','/admin/inbox?tab=cases&source=CONTENT_REVIEW'],
    review:['inbox','cases','cases','/admin/inbox?tab=cases&source=CONTENT_REVIEW'],comments:['inbox','cases','cases','/admin/inbox?tab=cases&source=COMMENT_REPORT'],
    recovery:['inbox','recovery','recovery','/admin/inbox?tab=recovery'],appeals:['inbox','appeals','appeals','/admin/inbox?tab=appeals'],
    'beta-operations':['inbox','support','beta-operations','/admin/inbox?tab=support'],
    roles:['settings','roles','roles','/admin/settings?tab=roles'],subadmins:['settings','roles','roles','/admin/settings?tab=roles'],
    audit:['settings','audit','audit','/admin/settings?tab=audit'],security:['settings','audit','audit','/admin/settings?tab=audit'],
    system:['settings','service','settings','/admin/settings?tab=service'],'virtual-accounts':['settings','tools','virtual-accounts','/admin/settings?tab=tools']
  };
  for(const [legacy,expected]of Object.entries(mappings)){
    const model=navigation.parse('/admin/'+legacy);
    assert.equal(model.valid,true,legacy);
    assert.deepEqual([model.group,model.tab,model.page,model.href],expected,legacy);
    assert.equal(model.legacy,true,legacy);
    assert.equal(model.explicit,true,legacy);
    assert.equal(navigation.parse(legacy).href,model.href,legacy);
  }
});

test('canonical routes are stable and retain every explicitly selected tab',()=>{
  for(const group of navigation.groups(()=>true))for(const tab of group.tabs){
    const model=navigation.parse(tab.href);
    assert.equal(model.valid,true,tab.href);
    assert.equal(model.group,group.key,tab.href);
    assert.equal(model.tab,tab.key,tab.href);
    assert.equal(model.page,tab.page,tab.href);
    assert.equal(navigation.path(model),tab.href);
    assert.equal(model.explicit,group.key!=='home');
    assert.equal(model.legacy,false);
  }
  assert.equal(navigation.parse('/admin/members?kind=author').kind,'author');
  assert.equal(navigation.parse('/admin/accounts?kind=author').kind,'author');
  assert.equal(navigation.parse('/admin/settings?tab=roles').page,'roles');
});

test('group-only routes distinguish defaults from explicit protected selections',()=>{
  for(const [path,group,tab]of [['/admin','home','dashboard'],['/admin/','home','dashboard'],['/admin/content','content','works'],['/admin/members','members','reader'],['/admin/finance','finance','payouts'],['/admin/inbox','inbox','cases'],['/admin/settings','settings','service']]){
    const model=navigation.parse(path);
    assert.equal(model.group,group);assert.equal(model.tab,tab);assert.equal(model.explicit,false);assert.equal(model.valid,true);
  }
  assert.equal(navigation.parse('/admin/members?kind=reader').explicit,true);
  assert.equal(navigation.parse('/admin/content?tab=curation').explicit,true);
  // Access control belongs to the caller: parsing a protected route must not redirect it.
  assert.equal(navigation.parse('/admin/roles').page,'roles');
  assert.equal(navigation.parse('/admin/inbox?tab=recovery').page,'recovery');
});

test('safe filters survive canonicalization while record search and secrets are discarded',()=>{
  const input='/admin/cases?source=COMMENT_REPORT&caseId=7c45f9df-44f3-4c10-9dfe-7887464bf927&workId=123&episodeId=456&changeId=789&target=WORK%3A123&offset=20&status=PENDING&priority=HIGH&assignee=unassigned&after=2026-10-01&before=2026-11-01&at=2026-11-01T12%3A30%3A00%2B09%3A00&q=private&email=private%40example.com&token=private';
  const model=navigation.parse(input);
  assert.equal(model.valid,true);
  assert.equal(model.source,'COMMENT_REPORT');
  assert.equal(model.params.target,'WORK:123');
  assert.equal(model.params.at,'2026-11-01T12:30:00+09:00');
  assert.equal(model.href.includes('private'),false);
  assert.deepEqual(Array.from(model.droppedParams),['q','email','token']);
  assert.deepEqual(plain(navigation.parse(model.href).params),plain(model.params));
  assert.equal(navigation.path({...model,params:{...model.params,unknown:'private'}}),model.href);
});

test('irrelevant kind/source filters do not bleed into another page',()=>{
  const model=navigation.parse('/admin/works?kind=author&source=COMMENT_REPORT');
  assert.equal(model.valid,true);
  assert.equal(model.href,'/admin/content?tab=works');
  assert.deepEqual(plain(model.params),{});
  assert.deepEqual(Array.from(model.droppedParams),['kind','source']);
});

test('member detail links keep a profile ID within the selected author or reader tab',()=>{
  const author=navigation.parse('/admin/authors?accountId=17&q=private%40example.com');
  assert.equal(author.valid,true);assert.equal(author.kind,'author');assert.equal(author.params.accountId,'17');
  assert.equal(author.href,'/admin/members?kind=author&accountId=17');assert.equal(author.explicit,true);
  const readerId='7c45f9df-44f3-4c10-9dfe-7887464bf927';
  const reader=navigation.parse('/admin/members?kind=reader&accountId='+readerId);
  assert.equal(reader.valid,true);assert.equal(reader.kind,'reader');assert.equal(reader.params.accountId,readerId);
  assert.equal(navigation.path(reader),reader.href);
  const implicit=navigation.parse('/admin/members?accountId=17');
  assert.equal(implicit.explicit,true,'a selected profile must never fall back to another permitted kind');
  assert.equal(implicit.kind,'reader');
  const content=navigation.parse('/admin/content?tab=works&accountId=17');
  assert.equal(content.href,'/admin/content?tab=works');assert.deepEqual(Array.from(content.droppedParams),['accountId']);
  assert.equal(navigation.path({group:'content',tab:'works',params:{accountId:'17'}}),'/admin/content?tab=works');
  for(const id of ['0','-1','not-an-id','9223372036854775808','%3Cscript%3E'])assert.equal(navigation.parse('/admin/members?kind=reader&accountId='+id).valid,false,id);
  assert.equal(navigation.parse('/admin/members?kind=author&accountId=17&accountId=18').valid,false);
});

test('explicit alias filters cannot change a legacy route into a different permission source',()=>{
  for(const path of ['/admin/comments?source=CONTENT_REVIEW','/admin/review?source=COMMENT_REPORT','/admin/users?kind=author','/admin/authors?kind=reader','/admin/members?tab=reader&kind=author'])assert.equal(navigation.parse(path).valid,false,path);
  assert.equal(navigation.parse('/admin/comments?source=COMMENT_REPORT').source,'COMMENT_REPORT');
});

test('same-origin URL inputs are accepted and external or malformed routes fail closed',()=>{
  assert.equal(navigation.parse(new URL('https://webnovels.uk/admin/works')).href,'/admin/content?tab=works');
  assert.equal(navigation.parse('https://preview.example/admin/works',{origin:'https://preview.example'}).valid,true);
  const rejected=[null,{},'', '/admin/unknown','/admin/content?tab=unknown','/admin/roles?tab=works','/admin/works/more','/admin//works','/admin/../admin/works','/admin/./works','/admin/%2e%2e/admin/works','/admin%2fworks','/admin/works#roles','/admin/works?workId=%zz','//evil.example/admin','//webnovels.uk/admin','https://evil.example/admin/works','https://webnovels.uk.evil.example/admin/works','http://webnovels.uk/admin/works','https://name:pass@webnovels.uk/admin/works','javascript:alert(1)','data:text/plain,/admin/works','https:////webnovels.uk/admin/works','/admin\\works','/admin/works\n','/admin/works?'+ 'a'.repeat(2050)];
  for(const input of rejected){const model=navigation.parse(input);assert.equal(model.valid,false,String(input));assert.equal(model.error,'INVALID_ADMIN_ROUTE');}
  assert.equal(navigation.parse('/admin',{origin:'https://webnovels.uk/path'}).valid,false);
  assert.equal(navigation.parse('/admin',{origin:'javascript:alert(1)'}).valid,false);
});

test('invalid or ambiguous query values are rejected before reaching rendering',()=>{
  assert.equal(navigation.parse('/admin/content?offset=100000').valid,true);
  for(const query of ['tab=works&tab=episodes','workId=1&workId=2','q=a&q=b','workId=0','workId=-1','workId=1.0','workId=9223372036854775808','workId=1%20OR%201=1','episodeId=%3Cscript%3E','caseId=not-an-id','changeId=..','source=OTHER','kind=admin','offset=100001','offset=1000000','offset=-1','status=%3Csvg%3E','status=abc','priority=CRITICAL','assignee=someone%40example.com','target=WORK%3A%3Cscript%3E','after=2026-02-31','before=not-a-date','at=2026-01-01T25%3A30%3A00Z'])assert.equal(navigation.parse('/admin/content?'+query).valid,false,query);
});

test('prototype keys and inherited values cannot contaminate route state',()=>{
  for(const key of ['__proto__','prototype','constructor'])assert.equal(navigation.parse('/admin/content?'+key+'=polluted').valid,false);
  const params=Object.create({workId:'999'});
  assert.equal(navigation.path({group:'content',tab:'works',params}),'/admin/content?tab=works');
  assert.equal({}.polluted,undefined);
  assert.equal(navigation.parse('/admin/constructor').valid,false);
  assert.equal(navigation.parse('/admin/content?tab=__proto__').valid,false);
});

test('models and navigation lists are immutable and retain no user state',()=>{
  const model=navigation.parse('/admin/accounts?kind=author');
  const groups=navigation.groups(()=>true);
  assert.ok(Object.isFrozen(navigation));assert.ok(Object.isFrozen(model));assert.ok(Object.isFrozen(model.params));assert.ok(Object.isFrozen(model.droppedParams));
  assert.ok(Object.isFrozen(groups));assert.ok(Object.isFrozen(groups[0]));assert.ok(Object.isFrozen(groups[0].tabs));assert.ok(Object.isFrozen(groups[0].tabs[0]));
  assert.throws(()=>{model.params.kind='reader';},TypeError);
  assert.throws(()=>{groups[0].tabs.push({});},error=>error.name==='TypeError');
  assert.equal(load().parse('/admin/accounts').kind,'reader');
  assert.equal(navigation.path({group:'unknown',tab:'unknown'}),null);
  assert.equal(navigation.path({valid:false,group:'home',tab:'dashboard'}),null);
  assert.equal(navigation.path({group:'content',tab:'works',params:{workId:'invalid'}}),null);
});
