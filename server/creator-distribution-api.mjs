// Additional author-owned metadata; never grants publication or contract rights.
export const DISTRIBUTION_HOSTS = Object.freeze({
  'www.munpia.com':'문피아', 'novel.munpia.com':'문피아',
  'novel.naver.com':'네이버', 'comic.naver.com':'네이버',
  'page.kakao.com':'카카오', 'webtoon.kakao.com':'카카오',
  'www.joara.com':'조아라', 'www.lezhin.com':'레진코믹스'
});
export function normalizeExternalLinks(links, fail) {
  if (!Array.isArray(links) || links.length > 5) fail(400, 'INVALID_EXTERNAL_LINK');
  const normalized = links.map(value => {
    if (typeof value !== 'string' || !value || value.length > 2048 || /[\s\\\u0000-\u001f\u007f]/.test(value)) fail(400, 'INVALID_EXTERNAL_LINK');
    let url; try { url = new URL(value); } catch { fail(400, 'INVALID_EXTERNAL_LINK'); }
    const authority = value.match(/^https:\/\/([^/?#]+)/i)?.[1];
    if (url.protocol !== 'https:' || !Object.hasOwn(DISTRIBUTION_HOSTS, url.hostname) ||
        authority?.toLowerCase() !== url.hostname || url.username || url.password || url.port || url.href.length > 2048) fail(400, 'INVALID_EXTERNAL_LINK');
    return url.href;
  });
  if (new Set(normalized).size !== normalized.length) fail(400, 'INVALID_EXTERNAL_LINK');
  return normalized;
}
export async function creatorDistributionApi({request, env, who, id, db, readBody, fail}) {
  if (env.AUTHOR_DISTRIBUTION_ENABLED !== 'true') fail(503, 'AUTHOR_DISTRIBUTION_NOT_ACTIVATED');
  const url = new URL(request.url);
  if ([...url.searchParams].length) fail(400, 'FIELD_NOT_ALLOWED');
  let data = {}, action;
  if (request.method === 'GET') action = 'get';
  else if (request.method === 'PATCH') {
    if (request.headers.get('origin') !== url.origin) fail(403, 'ORIGIN_REQUIRED');
    data = await readBody(request);
    const allowed = ['mode','externalLinks','version','rightsConfirmed'];
    if (Object.keys(data).length !== allowed.length || Object.keys(data).some(k => !allowed.includes(k))) fail(400, 'FIELD_NOT_ALLOWED');
    if (typeof data.version !== 'string' || !/^(0|[1-9]\d{0,18})$/.test(data.version) || BigInt(data.version) > 9223372036854775807n) fail(400, 'VERSION_REQUIRED');
    if (!['NON_EXCLUSIVE','EXCLUSIVE_INTEREST'].includes(data.mode)) fail(400, 'INVALID_FIELD');
    if (data.rightsConfirmed !== true) fail(400, 'RIGHTS_CONFIRMATION_REQUIRED');
    data.externalLinks = normalizeExternalLinks(data.externalLinks, fail);
    action = 'update';
  } else fail(405, 'METHOD_NOT_ALLOWED');
  const result = await db('rpc/creator_work_distribution', {}, {method:'POST', body:{
    p_user_id:who.userId, p_work_id:id, p_action:action, p_data:data
  }});
  if (result?.error) fail([400,403,404,409,503].includes(result.status) ? result.status : 503, result.error);
  if (!result?.distribution || typeof result.distribution !== 'object') fail(503, 'DATABASE_UNAVAILABLE');
  return result;
}
