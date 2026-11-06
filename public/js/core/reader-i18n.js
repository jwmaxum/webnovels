/* Reader presentation. Locale preferences never confer account or content access. */
(function () {
  'use strict';

  const locales = Object.freeze(['ko', 'en', 'ja', 'zh-Hans']);
  const preference = 'webnovels_reader_locale';
  const bindings = new WeakMap();
  const metadata = new Map();
  const attributes = ['placeholder', 'aria-label', 'title', 'alt'];
  const owned = (record, key) => record && Object.hasOwn(record, key) ? record[key] : undefined;
  let current = 'ko';
  try {
    const stored = window.localStorage.getItem(preference);
    if (locales.includes(stored)) current = stored;
  } catch { /* The default works when browser storage is restricted. */ }

  function t(key, values = {}) {
    const catalogs = [window.ReaderStaticMessages, window.ReaderFeatureMessages, window.ReaderShellMessages];
    let text;
    for (const catalog of catalogs) {
      const entry = owned(owned(catalog, current), key) ?? owned(owned(catalog, 'ko'), key);
      if (typeof entry === 'string') { text = entry; break; }
    }
    return (text ?? String(key)).replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g,
      (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match);
  }

  function apply(root = document) {
    for (const node of root.querySelectorAll('[data-i18n]')) {
      node.textContent = t(node.getAttribute('data-i18n'), bindings.get(node));
    }
    for (const attribute of attributes) {
      const marker = 'data-i18n-' + attribute;
      for (const node of root.querySelectorAll('[' + marker + ']')) {
        node.setAttribute(attribute, t(node.getAttribute(marker)));
      }
    }
  }

  function text(node, key, values) {
    if (!node) return;
    if (values) bindings.set(node, values);
    else bindings.delete(node);
    node.setAttribute('data-i18n', key);
    node.textContent = t(key, values);
  }

  function setLocale(locale) {
    if (!locales.includes(locale) || current === locale) return false;
    const previous = current;
    current = locale;
    try { window.localStorage.setItem(preference, locale); } catch { /* Session selection still applies. */ }
    sync();
    window.dispatchEvent(new CustomEvent('reader:localechange', {detail: {locale, previous}}));
    return true;
  }

  function sync() {
    document.documentElement.lang = current;
    for (const select of document.querySelectorAll('[data-reader-locale]')) select.value = current;
    apply();
  }

  function normalizedLocalization(value, locale) {
    if (!value || value.locale !== locale) return null;
    const title = typeof value.title === 'string' && value.title.trim() ? value.title : undefined;
    const description = typeof value.description === 'string' && value.description.trim() ? value.description : undefined;
    return title || description ? {locale, title, description} : null;
  }

  function remember(key, item, locale) {
    if (!key || !locales.includes(locale)) return;
    const slot = locale + ':' + key;
    metadata.delete(slot);
    const entry = normalizedLocalization(item?.localization, locale);
    if (!entry) return;
    metadata.set(slot, {entry, title: item.title, description: item.description, expires: Date.now() + 5 * 60 * 1000});
    if (metadata.size > 400) metadata.delete(metadata.keys().next().value);
  }

  function display(key, item) {
    if (!item) return item;
    const sourceLocale = item.originalLanguage ?? item.localization?.sourceLocale;
    const originalLanguage = locales.includes(sourceLocale) ? sourceLocale : 'ko';
    const cached = metadata.get(current + ':' + key);
    const matchesSource = cached?.expires > Date.now() && cached.title === item.title &&
      (item.description === undefined || cached.description === item.description);
    const localized = normalizedLocalization(item.localization, current) ?? (matchesSource ? cached.entry : null);
    return {
      ...item,
      title: localized?.title ?? item.title,
      ...(localized?.description ? {description: localized.description} : {}),
      titleLanguage: localized?.title ? current : originalLanguage,
      descriptionLanguage: localized?.description ? current : originalLanguage
    };
  }

  const workKey = item => item?.id ? 'work:' + String(item.id) : '';
  const episodeKey = (workId, item) => workId && (item?.id || item?.episodeNumber)
    ? 'episode:' + String(workId) + ':' + String(item.id || item.episodeNumber) : '';
  const language = code => ({ko: '한국어', en: 'English', ja: '日本語', 'zh-Hans': '简体中文'})[code] ?? '';

  window.ReaderI18n = Object.freeze({
    locales, locale: () => current, setLocale, apply, t, text, language,
    number: (value, options) => new Intl.NumberFormat(current, options).format(value),
    work: item => display(workKey(item), item),
    episode: (workId, item) => display(episodeKey(workId, item), item),
    rememberWork: (item, locale = current) => remember(workKey(item), item, locale),
    rememberEpisodes: (workId, items, locale = current) => {
      for (const item of items ?? []) remember(episodeKey(workId, item), item, locale);
    }
  });

  function init() {
    sync();
    for (const select of document.querySelectorAll('[data-reader-locale]')) {
      select.addEventListener('change', () => setLocale(select.value));
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true});
  else init();
})();
