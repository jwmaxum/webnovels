// Stage 8 service-only operations. The actor comes from the verified Auth session.
const DECIMAL = /^[1-9]\d{0,18}$/;
const validId = value => DECIMAL.test(value || '') && BigInt(value) <= 9223372036854775807n;
const READER_ACTIONS = new Set(['activity','preferences','profile','favorite','subscribe','progress','comments','comment','like']);
const CREATOR_ACTIONS = new Set(['home','episodes','policy','policy-save','comments','hide','unhide',
  'report','block','unblock','statistics','notices','notice-read','serial-state','withdraw','restore-episode']);
const READ_ACTIONS = new Set(['activity','comments']);
const CREATOR_READS = new Set(['home','episodes','policy','comments','statistics','notices']);

export async function stage8Api({request,env,actor,db,readBody,fail}) {
  const url=new URL(request.url),path=url.pathname;
  if (path==='/api/v2/catalog') {
    if (request.method!=='GET') fail(405,'METHOD_NOT_ALLOWED');
    if (env.AUTHOR_PUBLISH_ENABLED!=='true' || env.READER_SERVICE_ENABLED!=='true')
      fail(503,'READER_SERVICE_NOT_ACTIVATED');
    if ([...url.searchParams.keys()].length) fail(400,'INVALID_QUERY');
    const catalog=await db('rpc/stage8_catalog',{});
    if(!Array.isArray(catalog?.works)||!Array.isArray(catalog?.episodes))fail(503,'CATALOG_UNAVAILABLE');
    // Free launch scope is enforced before serialization, including direct API callers.
    const works=catalog.works.filter(work=>['PUBLISHED','ONGOING','PAUSED','COMPLETED'].includes(work.status) &&
      ['ALL','AGE_15'].includes(work.rating) && work.content_type==='NOVEL' &&
      !(Array.isArray(work.genre)?work.genre:[work.genre]).some(value=>['성인','19세 이상'].includes(value)));
    const visible=new Set(works.map(work=>String(work.id)));
    const episodes=catalog.episodes.filter(episode=>visible.has(String(episode.work_id)) &&
      episode.status==='PUBLISHED' && episode.is_free===true && episode.access_policy==='FREE' &&
      (!episode.scheduled_at || Date.parse(episode.scheduled_at)<=Date.now()));
    return {works,episodes};
  }
  const reader=path==='/api/v2/reader/hub';
  const creator=path==='/api/v2/creator/operations';
  if (!reader&&!creator) fail(404,'NOT_FOUND');
  if (env.AUTHOR_PUBLISH_ENABLED!=='true' ||
      (reader?env.READER_SERVICE_ENABLED!=='true':env.AUTHOR_OPERATIONS_ENABLED!=='true'))
    fail(503,reader?'READER_SERVICE_NOT_ACTIVATED':'AUTHOR_OPERATIONS_NOT_ACTIVATED');
  const action=url.searchParams.get('action') || (reader?'activity':'home');
  const allowed=reader?READER_ACTIONS:CREATOR_ACTIONS;
  if (!allowed.has(action) || [...url.searchParams.keys()].some(k=>!['action','workId','episodeId'].includes(k)))
    fail(400,'INVALID_ACTION');
  if (reader && action==='comments') {
    if (request.method!=='GET') fail(405,'METHOD_NOT_ALLOWED');
    const workId=url.searchParams.get('workId'),episodeId=url.searchParams.get('episodeId');
    if (!validId(workId)||!validId(episodeId)) fail(400,'INVALID_ID');
    const result=await db('rpc/stage8_comments',{},{
      method:'POST',body:{p_work_id:workId,p_episode_id:episodeId}
    });
    if(result?.error)fail(result.status||503,result.error);
    return result;
  }
  const who=await actor();
  if (reader ? who.reader?.status!=='ACTIVE' : who.author?.status!=='APPROVED')
    fail(403,reader?'READER_REQUIRED':'AUTHOR_REQUIRED');
  if (reader?READ_ACTIONS.has(action):CREATOR_READS.has(action)) {
    if (request.method!=='GET') fail(405,'METHOD_NOT_ALLOWED');
  } else if (request.method!=='POST') fail(405,'METHOD_NOT_ALLOWED');
  else if (request.headers.get('origin')!==url.origin) fail(403,'ORIGIN_REQUIRED');
  let data={};
  if (request.method==='POST') data=await readBody(request);
  if (reader) {
    if (action==='activity'||action==='preferences'||action==='profile') {
      if (url.searchParams.has('workId')||url.searchParams.has('episodeId')) fail(400,'INVALID_QUERY');
    } else {
      const id=url.searchParams.get('workId');
      if (!validId(id)) fail(400,'INVALID_WORK_ID');
      data.workId=id;
      if (['progress','comments','comment','like'].includes(action)) {
        const episode=url.searchParams.get('episodeId');
        if (!validId(episode)) fail(400,'INVALID_EPISODE_ID');
        data.episodeId=episode;
      } else if (url.searchParams.has('episodeId')) fail(400,'INVALID_QUERY');
    }
    if (action==='progress' && (!Number.isInteger(data.progress)||data.progress<0||data.progress>100))
      fail(400,'INVALID_PROGRESS');
    if (action==='comment') {
      if (typeof data.content!=='string'||!data.content.trim()||data.content.length>2000||
          (data.parentId&&!/^[0-9a-f-]{36}$/i.test(data.parentId))||
          ('anchorIndex' in data && (!Number.isInteger(data.anchorIndex)||data.anchorIndex<0||
            !/^[0-9a-f-]{36}$/i.test(data.versionId||'')||
            !/^[a-f0-9]{64}$/.test(data.anchorHash||''))))
        fail(400,'INVALID_COMMENT');
      if (Object.keys(data).some(k=>!['workId','episodeId','content','parentId','anchorIndex',
        'anchorHash','versionId','isSpoiler'].includes(k))) fail(400,'FIELD_NOT_ALLOWED');
    }
    if (action==='like' && (!/^[0-9a-f-]{36}$/i.test(data.commentId||'')||
      Object.keys(data).some(k=>!['workId','episodeId','commentId'].includes(k))))
      fail(400,'INVALID_COMMENT_ID');
    if (action==='preferences' && (!data.settings||typeof data.settings!=='object'||
      Array.isArray(data.settings)||Object.keys(data).some(k=>k!=='settings')))
      fail(400,'INVALID_PREFERENCES');
    if (action==='preferences') {
      const p=data.settings;
      if(Object.keys(p).length!==6||
        !['theme-dark','theme-oled','theme-sepia','theme-light'].includes(p.theme)||
        !['serif','sans'].includes(p.fontFamily)||
        !Number.isInteger(p.fontSize)||p.fontSize<14||p.fontSize>26||
        ![1.5,1.8,2.2].includes(p.lineHeight)||
        ![12,20,36].includes(p.paddingX)||
        ![0.8,1.2,1.6].includes(p.paragraphGap))
        fail(400,'INVALID_PREFERENCES');
    }
    if (action==='profile') {
      if (Object.keys(data).length!==1 || typeof data.nickname!=='string' ||
        data.nickname.trim().length<2 || data.nickname.trim().length>40 ||
        /[<>\x00-\x1f\x7f]/.test(data.nickname)) fail(400,'INVALID_NICKNAME');
      const result=await db('rpc/stage10_reader_profile',{}, {
        method:'POST',body:{p_user:who.userId,p_nickname:data.nickname.trim()}
      });
      if(result?.error)fail([400,403,409].includes(result.status)?result.status:503,result.error);
      return result;
    }
    if (['favorite','subscribe'].includes(action) &&
      (typeof data.enabled!=='boolean'||Object.keys(data).some(k=>!['workId','enabled'].includes(k))))
      fail(400,'INVALID_FIELD');
    const result=await db('rpc/stage8_reader',{},{
      method:'POST',body:{p_user:who.userId,p_action:action,p_data:data}
    });
    if (result?.error) fail([400,403,404,409].includes(result.status)?result.status:503,result.error);
    return result;
  }
  const workId=url.searchParams.get('workId');
  if (!validId(workId)||url.searchParams.has('episodeId')) fail(400,'INVALID_WORK_ID');
  if (request.method==='GET' && Object.keys(data).length) fail(400,'INVALID_FIELD');
  if (action==='policy-save' && (typeof data.commentsEnabled!=='boolean'||
    !Array.isArray(data.blockedTerms)||!Number.isInteger(data.minReadEpisodes)||
    data.minReadEpisodes<0||data.minReadEpisodes>100||
    Object.keys(data).some(k=>!['commentsEnabled','blockedTerms','minReadEpisodes'].includes(k))))
    fail(400,'INVALID_POLICY');
  if (['hide','unhide','report','block'].includes(action) && !/^[0-9a-f-]{36}$/i.test(data.commentId||''))
    fail(400,'INVALID_COMMENT_ID');
  if (action==='unblock' && !/^[0-9a-f-]{36}$/i.test(data.readerUserId||''))
    fail(400,'INVALID_READER_ID');
  if (action==='notice-read' && !/^[0-9a-f-]{36}$/i.test(data.noticeId||''))
    fail(400,'INVALID_NOTICE_ID');
  if (['withdraw','restore-episode'].includes(action) && !validId(String(data.episodeId||'')))
    fail(400,'INVALID_EPISODE_ID');
  const result=await db('rpc/stage8_creator',{},{
    method:'POST',body:{p_user:who.userId,p_action:action,p_work_id:workId,p_data:data}
  });
  if (result?.error) fail([400,403,404,409].includes(result.status)?result.status:503,result.error);
  return result;
}
