import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('stored profile fields remain text in legacy admin lists',()=>{
  const nodes=new Map([
    ['adminReadersTableBody',{innerHTML:''}],['adminCreatorsContainer',{innerHTML:''}]
  ]);
  const payload='<img src=x onerror=alert(1)>';
  const context={console:{warn(){},error(){}},setTimeout(){},
    document:{getElementById:id=>nodes.get(id)||null,querySelector:()=>null},
    SAMPLE_READERS:[{id:"1');alert(1);//",username:payload,nickname:payload,
      email:payload,subscription_status:payload}],
    SAMPLE_AUTHORS:[{id:1,pen_name:payload,username:payload,email:payload,
      work_title:payload,bank_info:payload,status:payload}]};
  context.window=context;
  vm.createContext(context);
  vm.runInContext(readFileSync('public/js/core/ui-utils.js','utf8'),context);
  vm.runInContext(readFileSync('public/js/admin/admin.js','utf8'),context);
  context.renderReadersAdminTable();
  context.renderAuthorsAdminGrid();
  for(const node of nodes.values()){
    assert.ok(!node.innerHTML.includes(payload));
    assert.ok(node.innerHTML.includes('&lt;img'));
    assert.ok(!node.innerHTML.includes('<img'));
  }
  assert.ok(!nodes.get('adminReadersTableBody').innerHTML.includes('openReaderDetailModal('));
});

test('legacy moderation and audit rows escape saved fields and reject unsafe action IDs',async()=>{
  const nodes=new Map(['adminReviewListContainer','adminReportsListContainer','securityAuditLogBody']
    .map(id=>[id,{innerHTML:''}]));
  const payload='<img src=x onerror=alert(1)>';
  const context={console:{warn(){},error(){}},setTimeout(){},
    document:{getElementById:id=>nodes.get(id)||null,querySelector:()=>null},
    WebNovelsAdmin:{
      fetchContentReviewsFromDB:async()=>[{id:"1');alert(1);//",status:'PENDING',
        work_title:payload,author_name:payload,reviewer_name:payload,reject_reason:payload}],
      fetchReportsFromDB:async()=>[{id:"1');alert(1);//",status:'PENDING',
        reason:payload,target_id:payload,reporter_id:payload,resolved_action:payload}],
      fetchAuditLogsFromDB:async()=>[{admin_id:payload,action:payload,ip_address:payload}]}};
  context.window=context;vm.createContext(context);
  vm.runInContext(readFileSync('public/js/core/ui-utils.js','utf8'),context);
  vm.runInContext(readFileSync('public/js/admin/admin.js','utf8'),context);
  await context.loadAdminContentReviews();
  await context.loadAdminReports();
  await context.loadAdminAuditLogs();
  for(const node of nodes.values()){
    assert.ok(!node.innerHTML.includes(payload));
    assert.ok(node.innerHTML.includes('&lt;img'));
  }
  assert.ok(!nodes.get('adminReviewListContainer').innerHTML.includes('handleReviewAction('));
  assert.ok(!nodes.get('adminReportsListContainer').innerHTML.includes('handleReportAction('));
});
test('reader card escapes stored text and rejects injected cover URLs and IDs',()=>{
  const context={window:null,document:{getElementById:()=>null},setTimeout(){}};
  context.window=context;vm.createContext(context);
  vm.runInContext(readFileSync('public/js/core/ui-utils.js','utf8'),context);
  const source=readFileSync('public/js/reader/reader.js','utf8');
  vm.runInContext(source.slice(source.indexOf('function renderCdgWorkCardHtml'),
    source.indexOf('// 1. HERO / Featured Works Slider')),context);
  const payload='<img src=x onerror=alert(1)>';
  const card=context.renderCdgWorkCardHtml({id:"1');alert(1);//",title:payload,
    genre:payload,author:payload,coverUrl:'https://example.test/" onerror="alert(1)',
    goldenBest:{reason:payload}},{badge:'GOLDEN',rank:'1" onclick="alert(1)'});
  assert.ok(!card.includes('<img src=x'));
  assert.ok(card.includes('src="/images/stormqueen_oath.jpg"'));
  assert.ok(!card.includes("openWorkDetailDirect('1');alert"));
  assert.ok(card.includes('/images/stormqueen_oath.jpg'));
  assert.ok(card.includes('&lt;img'));
});

test('reader comments reject unsafe IDs and escape stored content',async()=>{
  const container={innerHTML:'',textContent:''};
  const count={textContent:''};
  const payload='<img src=x onerror=alert(1)>';
  const context={document:{getElementById:id=>id==='readerCommentsList'?container:
      id==='readerCommentCount'?count:null,querySelectorAll:()=>[]},
    localStorage:{getItem:()=>null},console:{warn(){}},
    escapeReaderHtml:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')};
  context.window=context;
  context.WebNovelsAdmin={fetchCommentsByEpisode:async()=>[
    {id:"1');alert(1);//",nickname:payload,content:payload},
    {id:'11111111-1111-1111-1111-111111111111',nickname:payload,content:payload,
      likes_count:'0</span><img src=x onerror=alert(1)>',created_at:'2026-09-24T00:00:00Z'}]};
  vm.createContext(context);
  const source=readFileSync('public/js/reader/reader.js','utf8');
  vm.runInContext(source.slice(source.indexOf('window.loadEpisodeComments = async function'),
    source.indexOf('window.handleReaderCommentSubmit = async function')),context);
  await context.loadEpisodeComments(1,2);
  assert.ok(!container.innerHTML.includes("1');alert(1);//"));
  assert.ok(!container.innerHTML.includes('<img'));
  assert.ok(container.innerHTML.includes('&lt;img'));
  assert.ok(container.innerHTML.includes('likeCount-11111111-1111-1111-1111-111111111111'));
});
