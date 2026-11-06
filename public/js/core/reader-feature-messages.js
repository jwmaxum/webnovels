/* Localized reader labels and bindings for nodes that remain mounted across locale changes. */
(function () {
  'use strict';
  const rows = [
    ['다시 시도', 'Try again', '再試行', '重试'],
    ['더보기', 'See more', 'もっと見る', '查看更多'],
    ['웹툰', 'Webtoons', 'ウェブトゥーン', '网络漫画'],
    ['웹소설', 'Web novels', 'ウェブ小説', '网络小说'],
    ['완결', 'Completed', '完結', '已完结'],
    ['휴재', 'On hiatus', '休載', '暂停连载'],
    ['연재 중', 'Ongoing', '連載中', '连载中'],
    ['15세 이상', 'Ages 15+', '15歳以上', '15岁以上'],
    ['19세 이상', 'Ages 19+', '19歳以上', '19岁以上'],
    ['전체이용가', 'All ages', '全年齢', '全年龄'],
    ['전체', 'All', 'すべて', '全部'],
    ['홈', 'Home', 'ホーム', '首页'],
    ['추천', 'Recommendations', 'おすすめ', '推荐'],
    ['랭킹', 'Rankings', 'ランキング', '排行榜'],
    ['검색', 'Search', '検索', '搜索'],
    ['장르', 'Genre', 'ジャンル', '类型'],
    ['로맨스', 'Romance', 'ロマンス', '言情'],
    ['로맨스 판타지', 'Romance fantasy', 'ロマンスファンタジー', '奇幻言情'],
    ['판타지', 'Fantasy', 'ファンタジー', '奇幻'],
    ['현대 판타지', 'Modern fantasy', '現代ファンタジー', '现代奇幻'],
    ['현대판타지', 'Modern fantasy', '現代ファンタジー', '现代奇幻'],
    ['무협', 'Martial arts', '武侠', '武侠'],
    ['드라마', 'Drama', 'ドラマ', '剧情'],
    ['액션', 'Action', 'アクション', '动作'],
    ['일상', 'Slice of life', '日常', '日常'],
    ['스릴러', 'Thriller', 'スリラー', '惊悚'],
    ['미스터리', 'Mystery', 'ミステリー', '悬疑'],
    ['코미디', 'Comedy', 'コメディ', '喜剧'],
    ['기타', 'Other', 'その他', '其他'],
    ['상태', 'Status', '状態', '状态'],
    ['등급', 'Rating', '対象年齢', '年龄分级'],
    ['회차', 'Episodes', 'エピソード', '章节'],
    ['정렬', 'Sort', '並び順', '排序'],
    ['기록 없음', 'No record', '記録なし', '暂无记录'],
    ['최신 공개순', 'Recently updated', '更新順', '按最近更新'],
    ['첫 공개순', 'Newest first', '初回公開順', '按首次发布'],
    ['최근 7일 독자순', 'Most readers in 7 days', '直近7日間の読者数順', '按近7天读者数'],
    ['회차 많은순', 'Most episodes', '話数の多い順', '按章节数'],
    ['최근 7일 많이 읽은 작품', 'Most read in the last 7 days', '直近7日間でよく読まれた作品', '近7天热门作品'],
    ['최근 {days}일 인증 독자 고유 수 · 작품별 최소 {minimum}명 · {date} 기준. 스크롤/열람 이벤트 집계이며 실제 완독이나 구매를 뜻하지 않습니다.', 'Unique verified readers over {days} days · At least {minimum} readers per work · As of {date}. Counts reflect reading activity. They do not confirm completion or purchases.', '直近{days}日間の認証済み読者数（重複なし）・各作品{minimum}人以上・{date}時点。閲覧やスクロールの集計で、読了や購入の件数ではありません。', '近{days}天去重后的已验证读者数 · 每部作品至少{minimum}人 · 截至{date}。统计基于浏览和滚动行为，不代表读完或购买。'],
    ['공개 {count}화', '{count} published episodes', '公開{count}話', '已发布{count}章'],
    ['공개 1화', '1 published episode', '公開1話', '已发布1章'],
    ['최근 7일 독자 {count}명', '{count} readers in the last 7 days', '直近7日間の読者{count}人', '近7天{count}位读者'],
    ['최근 공개 {date}', 'Last updated {date}', '最終更新 {date}', '最近发布 {date}'],
    ['목록을 불러오지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.', 'Could not load the list. Check your connection and try again.', '一覧を読み込めませんでした。接続を確認して再試行してください。', '无法加载列表。请检查网络连接并重试。'],
    ['공개 기준을 충족한 독자 집계가 아직 없습니다.', 'No readership figures are available yet.', '公開基準を満たす読者数の集計はまだありません。', '暂无符合公开条件的读者统计。'],
    ['조건에 맞는 공개 작품이 없습니다.', 'No published works match your filters.', '条件に合う公開作品はありません。', '没有符合筛选条件的已发布作品。'],
    ['작품명·작가명으로 검색하세요.', 'Search by title or author.', '作品名または作家名で検索できます。', '按作品名或作者名搜索。'],
    ['{label} 조건 해제', 'Remove filter: {label}', '「{label}」の条件を解除', '移除筛选条件：{label}'],
    ['선택된 태그: {count}개', 'Selected tags: {count}', '選択したタグ：{count}件', '已选标签：{count}个'],
    ['공개 작품을 찾고 있습니다.', 'Finding published works…', '公開作品を検索しています。', '正在查找已发布作品…'],
    ['검색 중', 'Searching…', '検索中', '搜索中'],
    ['검색 중입니다.', 'Searching…', '検索しています。', '正在搜索…'],
    ['웹툰 공개 서비스는 준비 중입니다.', 'Webtoon publishing is coming soon.', 'ウェブトゥーンの公開を準備中です。', '网络漫画发布服务正在准备中。'],
    ['검색 조건 초기화', 'Clear filters', '検索条件をリセット', '清除筛选条件'],
    ['이 페이지 {count}개 작품', '{count} works on this page', 'このページの作品：{count}件', '本页共{count}部作品'],
    ['이 페이지 1개 작품', '1 work on this page', 'このページの作品：1件', '本页共1部作品'],
    ['최신 공개순은 최근 회차 공개 시각, 신작순은 첫 공개 시각을 기준으로 합니다.', 'Recently updated uses the latest episode date. Newest first uses the first publication date.', '更新順は最新話の公開日時、新着順は初回公開日時が基準です。', '最近更新按最新章节发布时间排序，新作按首次发布时间排序。'],
    ['처음 페이지', 'First page', '最初のページ', '第一页'],
    ['다음 페이지', 'Next page', '次のページ', '下一页'],
    ['이전 페이지', 'Previous page', '前のページ', '上一页'],
    ['검색 결과를 표시했습니다.', 'Search results are ready.', '検索結果を表示しました。', '已显示搜索结果。'],
    ['조회 실패', 'Loading failed', '読み込み失敗', '加载失败'],
    ['검색 결과를 불러오지 못했습니다. 다시 시도해 주세요.', 'Could not load search results. Try again.', '検索結果を読み込めませんでした。再試行してください。', '无法加载搜索结果。请重试。'],
    ['처음 페이지부터 다시 검색', 'Search again from the first page', '最初のページから再検索', '从第一页重新搜索'],
    ['공개 작품을 불러오는 중입니다.', 'Loading published works…', '公開作品を読み込んでいます。', '正在加载已发布作品…'],
    ['아직 공개된 웹소설이 없습니다. 새로운 연재를 기다려 주세요.', 'No web novels have been published yet. Check back for new series.', '公開中のウェブ小説はまだありません。新連載をお待ちください。', '暂无已发布的网络小说，敬请期待新连载。'],
    ['아직 공개된 웹툰이 없습니다. 새로운 연재를 기다려 주세요.', 'No webtoons have been published yet. Check back for new series.', '公開中のウェブトゥーンはまだありません。新連載をお待ちください。', '暂无已发布的网络漫画，敬请期待新连载。'],
    ['편집 추천 · 운영자가 선정한 작품입니다.', 'Editorial picks selected by our team.', '運営チームが選んだおすすめ作品です。', '编辑推荐，由运营团队精选。'],
    ['{platform}에서 연재 중 ↗', 'Read on {platform} ↗', '{platform}で連載中 ↗', '在{platform}连载 ↗'],
    ['{platform} 연재 페이지, 새 탭', '{platform} series page, opens in a new tab', '{platform}の連載ページを新しいタブで開く', '{platform}连载页面，在新标签页打开'],
    ['{number}화', 'Episode {number}', '第{number}話', '第{number}章'],
    ['무료', 'Free', '無料', '免费'],
    ['무료 · 공개 {date}', 'Free · Published {date}', '無料・公開 {date}', '免费 · 发布于{date}'],
    ['다음 공개 회차를 불러오는 중입니다.', 'Loading more published episodes…', '次の公開話を読み込んでいます。', '正在加载更多已发布章节…'],
    ['공개 회차를 불러오는 중입니다.', 'Loading published episodes…', '公開話を読み込んでいます。', '正在加载已发布章节…'],
    ['회차를 불러오는 중입니다.', 'Loading episodes…', 'エピソードを読み込んでいます。', '正在加载章节…'],
    ['공개된 회차가 없습니다.', 'No episodes have been published.', '公開中のエピソードはありません。', '暂无已发布章节。'],
    ['회차 더 보기', 'Show more episodes', 'もっと見る', '查看更多章节'],
    ['현재 공개된 회차가 없습니다.', 'No episodes are currently published.', '現在公開中のエピソードはありません。', '目前没有已发布章节。'],
    ['작품 정보와 공개 회차를 표시했습니다.', 'Work information and published episodes are ready.', '作品情報と公開話を表示しました。', '已显示作品信息及已发布章节。'],
    ['공개 회차 목록을 불러오지 못했습니다. 아래에서 다시 시도해 주세요.', 'Could not load the episode list. Try again below.', '公開話一覧を読み込めませんでした。下のボタンから再試行してください。', '无法加载已发布章节列表，请在下方重试。'],
    ['공개 회차 목록을 불러오지 못했습니다. 다시 시도할 수 있습니다.', 'Could not load the episode list. You can try again.', '公開話一覧を読み込めませんでした。再試行できます。', '无法加载已发布章节列表，可以重试。'],
    ['작품 정보를 불러오는 중입니다.', 'Loading work information…', '作品情報を読み込んでいます。', '正在加载作品信息…'],
    ['공개 회차', 'Published episodes', '公開話', '已发布章节'],
    ['공개 회차 확인 중', 'Checking published episodes…', '公開話を確認中', '正在检查已发布章节…'],
    ['작가: {name}', 'Author: {name}', '作家：{name}', '作者：{name}'],
    ['작가 정보 없음', 'Author unavailable', '作家情報なし', '暂无作者信息'],
    ['AI 미사용', 'No AI used', 'AI未使用', '未使用AI'],
    ['AI 보조', 'AI-assisted', 'AI補助', 'AI辅助'],
    ['AI 생성', 'AI-generated', 'AI生成', 'AI生成'],
    ['AI 사용 정보 없음', 'AI usage unspecified', 'AI使用情報なし', '暂无AI使用信息'],
    ['등록된 작품 소개가 없습니다.', 'No description is available.', '作品紹介はありません。', '暂无作品简介。'],
    ['원문 표시 · {language}', 'Showing original · {language}', '原文を表示・{language}', '显示原文 · {language}'],
    ['공개 회차 · {count}화', 'Published episodes · {count}', '公開話・{count}話', '已发布章节 · {count}章'],
    ['등록 {created} · 첫 공개 {first} · 최근 공개 {latest}', 'Added {created} · First published {first} · Last updated {latest}', '登録 {created}・初回公開 {first}・最終更新 {latest}', '登记于{created} · 首次发布{first} · 最近发布{latest}'],
    ['첫 공개 회차 읽기 ({number}화)', 'Start reading (Episode {number})', '最初の公開話を読む（第{number}話）', '开始阅读（第{number}章）'],
    ['공개 회차 없음', 'No published episodes', '公開話なし', '暂无已发布章节'],
    ['현재 공개된 작품을 찾을 수 없습니다.', 'This work is currently unavailable.', '現在公開中の作品を見つけられません。', '当前无法找到该已发布作品。'],
    ['작품 정보를 불러오지 못했습니다. 다시 시도할 수 있습니다.', 'Could not load the work. You can try again.', '作品情報を読み込めませんでした。再試行できます。', '无法加载作品信息，可以重试。'],
    ['전체 검색 결과 보기', 'View all search results', 'すべての検索結果を見る', '查看所有搜索结果'],
    ['대표 추천', 'Featured pick', 'イチオシ作品', '精选推荐'],
    ['추천 작품', 'Recommended works', 'おすすめ作品', '推荐作品'],
    ['최근 공개', 'Recently published', '最近公開された作品', '近期发布'],
    ['공지', 'Announcements', 'お知らせ', '公告'],
    ['표지 준비 중', 'Cover coming soon', '表紙準備中', '封面准备中'],
    ['추천 전체 보기', 'View all recommendations', 'おすすめをすべて見る', '查看全部推荐'],
    ['자세히 보기', 'See details', '詳しく見る', '查看详情'],
    ['관리자가 선정한 추천을 불러오는 중입니다.', 'Loading editorial picks…', '運営のおすすめを読み込んでいます。', '正在加载编辑推荐…'],
    ['편집 추천을 불러오지 못했습니다.', 'Could not load editorial picks.', '編集部のおすすめを読み込めませんでした。', '无法加载编辑推荐。'],
    ['추천 페이지 주소를 확인해주세요.', 'Check the recommendations page address.', 'おすすめページのアドレスを確認してください。', '请检查推荐页面地址。'],
    ['관리자가 선정한 작품을 불러오는 중입니다.', 'Loading works selected by our team…', '運営が選んだ作品を読み込んでいます。', '正在加载运营团队精选作品…'],
    ['관리자가 직접 선정한 작품을 저장된 순서로 안내합니다.', 'Browse the works selected by our editorial team.', '運営チームが選んだ作品を紹介します。', '浏览运营团队精选作品。'],
    ['추천 작품 유형', 'Recommended work type', 'おすすめの作品種別', '推荐作品类别'],
    ['선정 작품 {count}개', '{count} selected works', '選定作品：{count}件', '精选作品{count}部'],
    ['선정 작품 1개', '1 selected work', '選定作品：1件', '精选作品1部'],
    ['이 페이지에 표시할 추천 작품이 없습니다.', 'No recommendations on this page.', 'このページにおすすめ作品はありません。', '本页暂无推荐作品。'],
    ['선정된 추천 작품을 준비 중입니다.', 'Recommendations are coming soon.', 'おすすめ作品を準備中です。', '推荐作品正在准备中。'],
    ['첫 페이지로', 'Go to first page', '最初のページへ', '返回第一页'],
    ['추천 목록 페이지', 'Recommendation pages', 'おすすめ一覧のページ', '推荐列表分页'],
    ['추천 작품을 불러오지 못했습니다.', 'Could not load recommendations.', 'おすすめ作品を読み込めませんでした。', '无法加载推荐作品。'],
    ['관리자 선정 추천', 'Editorial recommendations', '運営のおすすめ', '编辑精选'],
    ['선정된 추천을 불러오는 중입니다.', 'Loading selected recommendations…', '選定したおすすめを読み込んでいます。', '正在加载精选推荐…'],
    ['글 작가', 'Writer', '原作・脚本', '编剧'],
    ['그림 작가', 'Illustrator', '作画', '绘者'],
    ['원작 작가', 'Original author', '原著者', '原作者'],
    ['이미지 다시 불러오기', 'Reload image', '画像を再読み込み', '重新加载图片'],
    ['{number}번째 웹툰 이미지', 'Webtoon image {number}', 'ウェブトゥーン画像 {number}', '网络漫画第{number}张图片'],
    ['{number}번째 이미지 다시 불러오기', 'Reload image {number}', '画像 {number} を再読み込み', '重新加载第{number}张图片'],
    ['{number}번째 이미지 불러오기 대기 중', 'Image {number} is queued', '画像 {number} は読み込み待ちです', '第{number}张图片等待加载'],
    ['{number}번째 이미지를 불러오는 중입니다.', 'Loading image {number}…', '画像 {number} を読み込んでいます。', '正在加载第{number}张图片…'],
    ['{number}번째 이미지를 표시하는 중입니다.', 'Displaying image {number}…', '画像 {number} を表示しています。', '正在显示第{number}张图片…'],
    ['{number}번째 이미지를 표시하지 못했습니다. 다시 불러와 주세요.', 'Could not display image {number}. Reload the image.', '画像 {number} を表示できませんでした。再読み込みしてください。', '无法显示第{number}张图片，请重新加载。'],
    ['{number}번째 이미지의 공개 상태를 다시 확인해 주세요.', 'Image {number} may be unavailable. Check its publication status.', '画像 {number} の公開状態を確認してください。', '请检查第{number}张图片的发布状态。'],
    ['{number}번째 이미지를 불러오지 못했습니다. 다시 시도해 주세요.', 'Could not load image {number}. Try again.', '画像 {number} を読み込めませんでした。再試行してください。', '无法加载第{number}张图片。请重试。'],
    ['{number}화 이어보기 · {genre}', 'Continue Episode {number} · {genre}', '第{number}話の続きを読む・{genre}', '继续阅读第{number}章 · {genre}'],
    ['현재 회차 {progress}%', '{progress}% through this episode', 'この話の進捗 {progress}%', '当前章节进度 {progress}%'],
    ['이어서 읽을 회차를 확인하지 못했습니다.', 'Could not find your next episode.', '続きのエピソードを確認できませんでした。', '无法找到您上次阅读的章节。'],
    ['연결 상태를 확인한 뒤 다시 시도해주세요.', 'Check your connection and try again.', '接続を確認して再試行してください。', '请检查网络连接后重试。'],
    ['작가의 말: ', 'Author’s note: ', '作家コメント：', '作者的话：'],
    ['서재 더 보기', 'Show more from my library', '本棚をもっと見る', '查看更多书架内容'],
    ['독자 로그인 후 이용해주세요.', 'Sign in as a reader to continue.', '読者としてログインしてください。', '请先登录读者账号。'],
    ['독자 로그인 후 서재를 이용할 수 있습니다.', 'Sign in as a reader to use your library.', '本棚を使うには読者としてログインしてください。', '登录读者账号后即可使用书架。'],
    ['서재를 불러오는 중입니다.', 'Loading your library…', '本棚を読み込んでいます。', '正在加载书架…'],
    ['구독 중인 작가가 없습니다.', 'You do not follow any authors yet.', 'フォローしている作家はいません。', '您还没有关注作者。'],
    ['{number}화 · 현재 회차 {progress}% · 이어보기', 'Episode {number} · {progress}% complete · Continue reading', '第{number}話・進捗{progress}%・続きを読む', '第{number}章 · 进度{progress}% · 继续阅读'],
    ['이어볼 수 있는 공개 회차가 없습니다.', 'No published episodes are available to continue.', '続けて読める公開話はありません。', '暂无可继续阅读的已发布章节。'],
    ['아직 읽은 작품이 없습니다. 작품 탐색에서 읽기를 시작해 보세요.', 'You haven’t read any works yet. Find a work to start reading.', 'まだ読んだ作品はありません。作品を探して読んでみましょう。', '您还没有阅读过作品。前往作品探索开始阅读。'],
    ['이어보기 목록을 불러오지 못했습니다. 연결 상태를 확인하고 다시 시도해주세요.', 'Could not load your reading history. Check your connection and try again.', '閲覧履歴を読み込めませんでした。接続を確認して再試行してください。', '无法加载阅读记录。请检查网络连接并重试。'],
    ['등록된 공개 관심 작품이 없습니다.', 'No published favorites are available.', '公開中のお気に入り作品はありません。', '暂无已发布的收藏作品。'],
    ['관심 작품 목록을 불러오지 못했습니다. 연결 상태를 확인하고 다시 시도해주세요.', 'Could not load your favorites. Check your connection and try again.', 'お気に入りを読み込めませんでした。接続を確認して再試行してください。', '无法加载收藏。请检查网络连接并重试。'],
    ['일부 서재 목록을 불러오지 못했습니다. 각 목록에서 다시 시도해 주세요.', 'Some library lists could not be loaded. Try again in each list.', '本棚の一部を読み込めませんでした。各一覧から再試行してください。', '部分书架列表加载失败。请在相应列表中重试。'],
    ['서재를 표시했습니다.', 'Your library is ready.', '本棚を表示しました。', '已显示书架。'],
    ['서재를 불러오지 못했습니다. 연결 상태를 확인하고 다시 시도해주세요.', 'Could not load your library. Check your connection and try again.', '本棚を読み込めませんでした。接続を確認して再試行してください。', '无法加载书架。请检查网络连接并重试。'],
    ['서재를 불러오지 못했습니다. 다시 시도할 수 있습니다.', 'Could not load your library. You can try again.', '本棚を読み込めませんでした。再試行できます。', '无法加载书架，可以重试。'],
  ];
  const messages = { en: Object.create(null), ja: Object.create(null), 'zh-Hans': Object.create(null) };
  for (const [source, en, ja, zh] of rows) {
    messages.en[source] = en;
    messages.ja[source] = ja;
    messages['zh-Hans'][source] = zh;
  }
  window.ReaderFeatureMessages = messages;

  const binding = new WeakMap();
  function bind(node, render, attribute) {
    if (!node) return;
    const property = attribute || 'textContent';
    const renderers = binding.get(node) || new Map();
    renderers.set(property, render);
    binding.set(node, renderers);
    node.setAttribute('data-reader-localized', '');
    apply(node, property, render());
  }
  function apply(node, property, value) {
    if (property === 'textContent') {
      if (node.textContent !== value) node.textContent = value;
    } else {
      if (property === 'lang' && !value) node.removeAttribute(property);
      else node.setAttribute(property, value);
    }
  }
  window.addEventListener('reader:localechange', () => {
    for (const node of document.querySelectorAll('[data-reader-localized]')) {
      for (const [property, render] of binding.get(node) || []) apply(node, property, render());
    }
  });
  window.ReaderFeatureCopy = Object.freeze({ bind });
})();
