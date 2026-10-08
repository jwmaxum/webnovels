/* Public discovery reads. No private creator settings or full-catalog fallback. */
(function () {
  'use strict';
  const active = () => window.WEBNOVELS_CONFIG?.readerDiscoveryEnabled === true;
  const validId = value => /^[1-9]\d{0,18}$/.test(String(value)) && BigInt(value) <= 9223372036854775807n;
  const cover = value => typeof value === 'string' && /^(\/(?!\/)|https:\/\/)/.test(value) &&
    !/[<>"'`()\\;\s]/.test(value) ? value : '/images/stormqueen_oath.jpg';
  const episode = row => row ? { ...row, id: String(row.id), workId: String(row.work_id),
    episodeNumber: Number(row.episode_number), isFree: row.is_free === true,
    accessPolicy: row.access_policy, scheduledAt: row.scheduled_at, authorComment: row.author_comment || '' } : null;
  const mapWork = row => ({ ...row, id: String(row.id), authorId: String(row.author_id || ''),
    author: row.author || '작가 정보 없음', genre: Array.isArray(row.genre) ? row.genre.join(', ') : row.genre,
    contentType: row.content_type, coverUrl: cover(row.cover_image), aiUsageType: row.ai_usage_type || 'NONE',
    isCompleted: row.status === 'COMPLETED' || row.is_completed === true,
    episodeCount: Number(row.episode_count || 0), firstEpisodeNumber: row.firstEpisodeNumber,
    createdAt: row.created_at, firstPublishedAt: row.first_published_at, lastPublishedAt: row.last_published_at,
    rankingReaders: row.ranking_readers, episodes: [] });
  async function request(action, values = {}) {
    if (!active()) throw Error('READER_DISCOVERY_NOT_ACTIVATED');
    const params = new URLSearchParams({ action });
    for (const [key, value] of Object.entries(values)) {
      if (value == null || value === '') continue;
      if (Array.isArray(value)) value.forEach(item => params.append(key, item));
      else params.set(key, String(value));
    }
    const response = await fetch('/api/v2/catalog?' + params.toString(), { credentials: 'omit', cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) {
      const error = Error(result.error || 'CATALOG_UNAVAILABLE');
      error.code = result.error; error.status = response.status; throw error;
    }
    return result;
  }
  async function work(id) {
    if (!validId(id)) throw Object.assign(Error('WORK_NOT_FOUND'), { status: 404 });
    const result = await request('work', { workId: id });
    if (!result.work || String(result.work.id) !== String(id)) throw Error('CATALOG_UNAVAILABLE');
    return mapWork(result.work);
  }
  async function list(values = {}) {
    const result = await request('list', values);
    if (!Array.isArray(result.works)) throw Error('CATALOG_UNAVAILABLE');
    return { ...result, works: result.works.map(mapWork) };
  }
  async function home() {
    const result = await request('home');
    if (!result.sections) throw Error('CATALOG_UNAVAILABLE');
    const sections = {};
    for (const key of ['recommended', 'popular', 'new', 'completed']) {
      if (!Array.isArray(result.sections[key])) throw Error('CATALOG_UNAVAILABLE');
      sections[key] = result.sections[key].map(mapWork);
    }
    return { ...result, sections };
  }
  async function episodes(id, cursor) {
    const result = await request('episodes', { workId: id, cursor, limit: 24 });
    if (!Array.isArray(result.episodes)) throw Error('CATALOG_UNAVAILABLE');
    return { ...result, episodes: result.episodes.map(episode) };
  }
  async function reading(id, number) {
    const [item, chapter] = await Promise.all([work(id), request('chapter', { workId: id, episodeNumber: number })]);
    if (!chapter.episode) throw Error('EPISODE_NOT_FOUND');
    const current = episode(chapter.episode), previous = episode(chapter.previous), next = episode(chapter.next);
    item.episodes = [previous, current, next].filter(Boolean);
    return { work: item, episode: current, previous, next };
  }
  window.ReaderCatalog = Object.freeze({ active, request, work, list, home, episodes, reading, mapWork, episode });
})();
