import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'parse5';
import {transform} from 'esbuild';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const html=await read('public/index.html'),css=await read('public/css/author-studio.css'),loader=await read('public/js/core/role-modules.js');
const errors=[],tree=parse(html,{onParseError:error=>errors.push(error)}),nodes=[];
const walk=node=>{if(node.tagName)nodes.push(node);for(const child of node.childNodes||[])walk(child);};walk(tree);
const attr=(node,key)=>node?.attrs?.find(item=>item.name===key)?.value;
const byId=id=>id?nodes.find(node=>attr(node,'id')===id):undefined;
const hasClass=(node,name)=>(attr(node,'class')||'').split(/\s+/).includes(name);
const inside=(node,parent)=>{for(let at=node;at;at=at.parentNode)if(at===parent)return true;return false;};
const text=node=>(node?.childNodes||[]).map(child=>child.value||text(child)).join('');
const firstElement=node=>node.childNodes?.find(child=>child.tagName);
// Captured from the R4 entry point: moving a control cannot silently remove its JS/DOM contract.
const preservedIds=[
 'view-creator','creatorAuthorBar','creatorAuthorAvatar','creatorAuthorPenName','creatorAuthorBadge','creatorAuthorMeta','btnCreatorBackToHome','btnAuthorLogout','btnOpenCreateWork',
 'creatorAuthorDetails','creatorBankInfo','creatorTotalViews','creatorTotalEpisodes','creatorTabsBar','creatorMoreNav','creatorTab-earnings','creatorEarningsContent','creatorTab-profile',
 'creatorProfileContent','creatorTab-home','creatorHomeContent','creatorTab-help','authorWorkspaceNotice','creatorTab-works','creatorWorksCount','creatorWorksContainer','creatorTab-new-ep',
 'btnDraftFocus','formCreateEpisode','newEpWorkSelect','btnDraftNew','btnDraftLoad','btnSubmitNewEpisode','btnOpenPublication','btnSchedulePublication','btnStudioCover','btnStudioImages',
 'creatorDraftStatus','creatorPublicationNotice','draftCopyDetails','btnDraftRefresh','draftCopies','creatorDraftError','draftConflict','btnConflictCompare','btnConflictLocal','btnConflictRemote',
 'newEpTitle','creatorWordCount','btnFormatIndent','btnFormatDialogue','btnFormatClean','btnSaveDraftVersion','btnRestoreDraftVersion','creatorWordProgress','creatorRichEditor','creatorRichNotice',
 'creatorRichBody','newEpContent','newEpAuthorComment','btnDraftSettings','btnCreatorFiles','btnDraftDownload','btnLegacyDraftExport','btnDraftUndo','draftIdentity','creatorDraftChecklist',
 'creatorTab-status','creatorTab-stats','creatorAnalyticsWorkSelect','creatorCompletionRate','creatorCompletionSampleText','creatorAverageProgress','creatorAnalyticsEvents','creatorFunnelCard',
 'creatorFunnelContainer','creatorEpisodeAnalyticsCard','creatorEpisodeAnalyticsTable','creatorActivityTimelineCard','creatorTimelineActivity','creatorTab-ad-rev','creatorEstimatedRevenue',
 'creatorEstimatedSubtext','creatorConfirmedRevenue','creatorPayableRevenue','creatorTab-sales-rev','creatorSalesCount','creatorSalesRevenue','creatorTab-settlements','creatorSettlementPayableAmount',
 'creatorSettlementBankAccount','creatorSettlementActionContainer','btnRequestSettlement','creatorSettlementsHistory','creatorLedgerCard','creatorLedgerStatusFilter','creatorLedgerContainer',
 'modalDraftDiff','diffVersionList','diffPreviewHeader','diffSectionsContainer','btnConfirmRestoreRevision','modalCreatorFiles','creatorFilesWorkTitle','creatorFilesMessage','creatorFileSection-import',
 'creatorFileDrop','creatorFileInput','creatorImportRun','creatorImportStop','creatorFileSection-cover','creatorCoverInput','creatorCoverCanvas','creatorCoverZoom','creatorCoverX','creatorCoverY',
 'creatorCoverSave','creatorFileSection-export','creatorExportCurrent','creatorExportList','creatorExportItems','creatorExportAll','creatorOriginalFiles','creatorImportList','modalCreatorPublication',
 'publicationHeading','publicationMessage','publicationRetryPanel','publicationRetrySummary','publicationRetry','publicationDraftPanel','publicationSummary','publicationChecklist','publicationDesktop',
 'publicationMobile','publicationPreview','publicationPreviewTitle','publicationPreviewBody','publicationPreviewComment','publicationControls','publicationNowLabel','publicationScheduledLabel',
 'publicationScheduleFields','publicationDueAt','publicationTimezone','publicationRights','publicationCommit','publicationResult','publicationResultText','publicationRead','publicationCopy',
 'publicationNext','publicationListSection','publicationList'
];

test('studio markup parses without nested forms or duplicate IDs and preserves every R4 control',()=>{
 assert.deepEqual(errors,[]);const ids=nodes.map(node=>attr(node,'id')).filter(Boolean);assert.equal(ids.length,new Set(ids).size);
 assert.equal(preservedIds.length,154);for(const id of preservedIds)assert(byId(id),'missing persistent DOM contract: '+id);
 for(const form of nodes.filter(node=>node.tagName==='form'))assert(!nodes.some(other=>other!==form&&other.tagName==='form'&&inside(form,other)),'nested form');
 const editor=byId('formCreateEpisode');assert.equal(editor.tagName,'form');assert.equal(attr(editor,'onsubmit'),'handleCreateEpisodeSubmit(event)');
 for(const id of ['newEpWorkSelect','newEpTitle','newEpContent','newEpAuthorComment']){
  assert(inside(byId(id),editor),id+' left the editor form');assert(nodes.some(node=>node.tagName==='label'&&attr(node,'for')===id&&inside(node,editor)),id+' needs an associated label');
 }
 assert.equal(attr(byId('newEpContent'),'maxlength'),'200000');assert.equal(attr(byId('newEpTitle'),'maxlength'),'200');
 assert.equal(attr(byId('creatorRichBody'),'role'),'textbox');assert.equal(attr(byId('creatorRichBody'),'aria-multiline'),'true');
 assert.equal(attr(byId('creatorRichBody'),'contenteditable'),'false');assert.equal(attr(byId('creatorRichEditor'),'hidden'),'');
});

test('primary writing actions, current draft and save/conflict state stay reachable before secondary tools',()=>{
 const editor=byId('creatorTab-new-ep'),bar=nodes.find(node=>hasClass(node,'studio-action-bar')&&inside(node,editor));
 assert(bar);assert.equal(attr(bar,'role'),'group');assert(attr(bar,'aria-label'));
 for(const id of ['btnDraftNew','btnDraftLoad','btnSubmitNewEpisode','btnStudioPreview','btnOpenPublication','btnSchedulePublication'])assert(inside(byId(id),bar),id);
 assert.equal(attr(byId('btnSubmitNewEpisode'),'type'),'submit');
 for(const id of ['btnDraftNew','btnDraftLoad','btnStudioPreview','btnOpenPublication','btnSchedulePublication'])assert.equal(attr(byId(id),'type'),'button',id+' must not submit the form');
 for(const id of ['studioCurrentWork','studioWorkKind','studioDraftState','creatorDraftStatus','creatorPublicationNotice'])assert(inside(byId(id),editor),id);
 assert.equal(attr(byId('creatorDraftStatus'),'role'),'status');assert.equal(attr(byId('creatorDraftStatus'),'aria-live'),'polite');
 assert.equal(attr(byId('draftConflict'),'hidden'),'');assert.equal(attr(byId('draftConflict'),'role'),'alert');
 for(const id of ['btnConflictCompare','btnConflictLocal','btnConflictRemote'])assert(inside(byId(id),byId('draftConflict')),id);
 assert.equal(attr(byId('btnStudioImages'),'hidden'),'','webtoon-only tools start hidden');
 assert.equal(attr(byId('btnDraftFocus'),'aria-pressed'),'false');
});

test('native disclosure keeps publication, versions, draft copies and backup actions distinct',()=>{
 const details=nodes.filter(node=>node.tagName==='details'&&inside(node,byId('view-creator')));
 for(const disclosure of details){
  const summary=firstElement(disclosure);assert.equal(summary?.tagName,'summary');
  assert(!nodes.some(node=>node!==summary&&inside(node,summary)&&['button','input','a','select','textarea'].includes(node.tagName)),'interactive action nested in summary');
 }
 const publish=details.find(node=>hasClass(node,'studio-publish-menu'));assert(publish);
 for(const id of ['btnOpenPublication','btnSchedulePublication'])assert(inside(byId(id),publish));
 assert(!inside(byId('btnStudioPreview'),publish),'preview must remain available without opening publication options');
 const copies=byId('draftCopyDetails');assert.equal(copies.tagName,'details');assert(inside(byId('draftCopies'),copies));
 assert.equal(attr(byId('btnDraftLoad'),'aria-controls'),attr(copies,'id'));
 const backup=details.find(node=>inside(byId('btnLegacyDraftExport'),node));assert(backup);
 for(const id of ['btnCreatorFiles','btnDraftDownload','btnDraftUndo','draftIdentity','creatorDraftChecklist'])assert(inside(byId(id),backup),id);
 assert(nodes.some(node=>node.tagName==='details'&&inside(byId('btnSaveDraftVersion'),node)&&inside(byId('btnRestoreDraftVersion'),node)));
});

test('Word paste and file import notices describe their distinct supported formats',()=>{
 const notice=text(byId('creatorRichNotice'));for(const word of ['Word','문단','줄바꿈','강조','정렬'])assert(notice.includes(word),word);
 assert(/표.*그림.*쪽 배치/.test(notice));assert(/지원하지/.test(notice));assert.doesNotMatch(notice,/모든 서식|완벽|원본과 동일/);
 const imports=text(byId('creatorFileSection-import'));for(const word of ['TXT','DOCX','HWPX','평문','누락 경고','새 비공개 초안'])assert(imports.includes(word),word);
 assert.equal(attr(byId('creatorFileInput'),'accept'),'.txt,.docx,.hwpx');
 assert.equal(attr(byId('creatorCoverInput'),'accept'),'image/jpeg,image/png');
 assert.equal(Number(attr(byId('creatorCoverCanvas'),'width'))/Number(attr(byId('creatorCoverCanvas'),'height')),2/3);
 const policy=nodes.find(node=>hasClass(node,'creator-publish-policy')&&inside(node,byId('view-creator')));
 assert.match(text(policy),/공개 전 원고.*자유롭게 수정.*바로 발행.*예약 발행/);assert.match(text(policy),/이미 공개된 회차.*수정.*삭제.*관리자 승인/);
 for(const id of ['modalCreatorFiles','modalCreatorPublication']){const modal=byId(id);assert.equal(attr(modal,'hidden'),'');assert.equal(attr(modal,'role'),'dialog');assert(byId(attr(modal,'aria-labelledby')));}
});

test('studio CSS parses, stays in author surfaces and preserves keyboard/mobile/cover geometry',async()=>{
 const result=await transform(css,{loader:'css'});assert.deepEqual(result.warnings,[]);
 const toolbarRules=[...result.code.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([,selector])=>selector.includes('#creatorTab-new-ep')&&selector.includes('.studio-action-bar'));
 const normal=toolbarRules.filter(([,selector])=>selector.trim()==='#creatorTab-new-ep .studio-action-bar');
 const focus=toolbarRules.find(([,selector])=>selector.trim()==='#creatorTab-new-ep.draft-focus .studio-action-bar');
 assert(normal.some(([, ,body])=>/\bposition:\s*relative\b/.test(body)),'normal toolbar must stay in document flow below the header');
 assert(focus&&/\bposition:\s*sticky\b/.test(focus[2])&&/\btop:\s*0(?:px)?\s*;/.test(focus[2]),'only focus mode pins the toolbar at its own viewport top');
 for(const [,selector,body]of toolbarRules)if(/\bposition:\s*(?:sticky|fixed)\b/.test(body))assert(selector.includes('.draft-focus'),'main header would obscure pinned normal toolbar');
 assert.doesNotMatch(css,/@import|url\(|#view-reader|#view-admin|#readerBody|\.reader-paragraph|--reader-font\s*:/);
 const rules=[...css.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/([^{}]+)\{([^{}]*)\}/g)];assert(rules.length>30);
 for(const [,selector]of rules)assert(/#(?:view-creator|creator[\w-]*|modalCreatorFiles|modalCreatorPublication)\b/.test(selector),'unscoped selector '+selector.trim());
 assert.match(css,/:focus-visible[^{}]*\{[^}]*outline:\s*3px solid var\(--border-focus\)/);
 assert.match(css,/#view-creator :is\(\.btn, summary\)\s*\{[^}]*min-height:\s*44px/);
 assert.match(css,/@media\s*\(max-width:\s*600px\)/);assert.match(css,/safe-area-inset-(?:top|bottom)/);
 const covers=rules.filter(([,selector])=>selector.trim()==='#view-creator .cw-cover');assert.equal(covers.length,2);
 for(const [,,body]of covers){const width=Number(body.match(/\bwidth:\s*(\d+)px/)?.[1]),height=Number(body.match(/\bheight:\s*(\d+)px/)?.[1]);assert.equal(width/height,2/3);}
 assert(rules.some(([,selector,body])=>selector.includes('.studio-webtoon-thumb')&&/object-fit:\s*contain/.test(body)));
 assert(rules.some(([,selector,body])=>selector.includes('.webtoon-panel img')&&/object-fit:\s*contain/.test(body)));
});

test('studio styles and changed role modules have local cache versions in compatibility load order',async()=>{
 const style=nodes.find(node=>node.tagName==='link'&&attr(node,'rel')==='stylesheet'&&attr(node,'href')?.startsWith('/css/author-studio.css'));
 assert(style);assert.equal(attr(style,'href'),'/css/author-studio.css?v=20261101r12');
 await readFile(new URL('../public'+attr(style,'href').split('?')[0],import.meta.url));
 const scripts=nodes.filter(node=>node.tagName==='script').map(node=>attr(node,'src')).filter(Boolean);
 assert(scripts.some(src=>/^\/js\/core\/role-modules\.js\?v=[a-z0-9]+$/.test(src)));
 const files=[...loader.matchAll(/'([^']+)'/g)].map(match=>match[1]).filter(path=>path.startsWith('/js/creator/'));
 for(const name of ['creator-webtoon','creator-editor','creator-publications','creator-works']){
  const prefix='/js/creator/'+name+'.js?v=';
  assert(files.some(path=>path.startsWith(prefix)&&/^[a-z0-9]+$/.test(path.slice(prefix.length))),name+' needs a cache version');
  await readFile(new URL('../public'+prefix.split('?')[0],import.meta.url));
 }
 assert(files.findIndex(path=>path.includes('/draft-engine.js'))<files.findIndex(path=>path.includes('/creator-editor.js')));
 assert(files.findIndex(path=>path.includes('/creator-editor.js'))<files.findIndex(path=>path.includes('/creator-publications.js')));
});
