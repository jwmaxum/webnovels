export type TagDefinition = { slug: string; label: string; aliases?: string[] };

// 운영자가 확장할 수 있는 초기 표준 태그 사전이다. 저장 값은 slug로 통일한다.
export const STANDARD_TAGS: TagDefinition[] = [
  { slug: 'regression', label: '회귀', aliases: ['회귀물'] }, { slug: 'possession', label: '빙의', aliases: ['빙의물'] },
  { slug: 'reincarnation', label: '환생', aliases: ['환생물'] }, { slug: 'misunderstanding', label: '착각계' },
  { slug: 'catharsis', label: '사이다' }, { slug: 'academy', label: '아카데미' }, { slug: 'professional', label: '전문직' },
  { slug: 'system', label: '시스템' }, { slug: 'game', label: '게임빙의' }, { slug: 'hunter', label: '헌터' },
  { slug: 'dungeon', label: '던전' }, { slug: 'growth', label: '성장' }, { slug: 'survival', label: '생존' },
  { slug: 'politics', label: '정치' }, { slug: 'war', label: '전쟁' }, { slug: 'romance', label: '로맨스' },
  { slug: 'romance-fantasy', label: '로맨스판타지', aliases: ['로판'] }, { slug: 'martial-arts', label: '무협' },
  { slug: 'modern-fantasy', label: '현대판타지', aliases: ['현판'] }, { slug: 'healing', label: '힐링' },
  { slug: 'mystery', label: '미스터리' }, { slug: 'horror', label: '공포' }, { slug: 'sf', label: 'SF' },
  { slug: 'slice-of-life', label: '일상' }, { slug: 'comedy', label: '코미디' }, { slug: 'revenge', label: '복수' },
  { slug: 'family', label: '육아' }, { slug: 'chef', label: '요리' }, { slug: 'sports', label: '스포츠' },
  { slug: 'medical', label: '의학' }, { slug: 'business', label: '경영' }, { slug: 'historical', label: '대체역사' }
];

export function normalizeTags(input: unknown): string[] {
  const values = Array.isArray(input) ? input : String(input || '').split(',');
  const resolved = values.map((value) => String(value).trim()).filter(Boolean).map((value) => {
    const found = STANDARD_TAGS.find((tag) => tag.slug === value || tag.label === value || tag.aliases?.includes(value));
    return found?.slug || value.toLowerCase().replace(/\s+/g, '-');
  });
  return [...new Set(resolved)].slice(0, 10);
}
