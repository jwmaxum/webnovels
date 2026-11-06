const locales = new Set(['ko', 'en', 'ja', 'zh-Hans']);
const validId = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
const titleText = value => typeof value === 'string' && value.trim().length > 0 &&
  [...value].length <= 500 && !/[\p{Cc}<>]/u.test(value);
const descriptionText = value => typeof value === 'string' && value.trim().length > 0 &&
  [...value].length <= 8000 && !/[<>\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);

export function readerLocale(params, fail) {
  const requested = params.getAll('locale');
  if (requested.length > 1 || (requested.length && !locales.has(requested[0]))) fail(400, 'INVALID_LOCALE');
  return requested[0] || 'ko';
}

export const readerMetadataLocalizationEnabled = (env, locale) =>
  env.READER_METADATA_LOCALIZATION_ENABLED === 'true' && locales.has(locale) && locale !== 'ko';

// Callers supply records already projected by a public endpoint. The RPC separately
// checks visibility, so approved translated metadata cannot widen that scope.
export async function attachReaderTranslations({locale, env, rpc, works = [], episodes = [], webtoon = false, fail}) {
  if (!readerMetadataLocalizationEnabled(env, locale)) return;
  const ids = items => [...new Set(items.filter(Boolean).map(item => item.id).filter(validId))];
  const workIds = ids(works), episodeIds = ids(episodes);
  if (!workIds.length && !episodeIds.length) return;
  if (workIds.length > 50 || episodeIds.length > 50) fail(503, 'CATALOG_UNAVAILABLE');
  const result = await rpc('reader_catalog_translations', {
    p_locale: locale, p_work_ids: workIds, p_episode_ids: episodeIds, p_webtoon: webtoon
  });
  if (!Array.isArray(result?.works) || result.works.length > workIds.length ||
    !Array.isArray(result?.episodes) || result.episodes.length > episodeIds.length) fail(503, 'CATALOG_UNAVAILABLE');

  const approved = entries => new Map(entries.filter(item => item?.locale === locale &&
    locales.has(item.sourceLocale) && item.sourceLocale !== locale && titleText(item.title)).map(item => [item.id, item]));
  const workTranslations = approved(result.works), episodeTranslations = approved(result.episodes);
  for (const work of works) {
    const item = workTranslations.get(work?.id);
    if (!item || item.sourceTitle !== work.title ||
      (Object.hasOwn(work, 'description') && (item.sourceDescription ?? '') !== work.description)) continue;
    work.localization = {locale, sourceLocale: item.sourceLocale, title: item.title,
      ...(Object.hasOwn(work, 'description') && descriptionText(item.description) ? {description: item.description} : {})};
  }
  for (const episode of episodes) {
    const item = episodeTranslations.get(episode?.id);
    if (!item || item.workId !== episode.work_id || item.versionId !== episode.versionId) continue;
    episode.localization = {locale, sourceLocale: item.sourceLocale, title: item.title};
  }
}
