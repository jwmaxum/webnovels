import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ghwabesnydktumeyejnm.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_XYQ7ydRrTZQ94V6r1WKEtQ_pnL9Po5c';

const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testRuntime() {
  console.log('=== 1. Testing Works & Episodes Fetch ===');
  const { data: works, error: wErr } = await supabaseClient.from('works').select('*').order('id', { ascending: true });
  console.log('Works count:', works ? works.length : 0, 'Error:', wErr);

  const { data: authors } = await supabaseClient.from('authors').select('id, pen_name, username');
  const authorMap = {};
  if (authors) {
    authors.forEach(a => { authorMap[a.id] = a.pen_name || a.username; });
  }

  const { data: episodes } = await supabaseClient.from('episodes').select('*');
  console.log('Episodes count:', episodes ? episodes.length : 0);

  const parsedWorks = works.map(w => {
    const mainGenre = Array.isArray(w.genre) && w.genre.length > 0 ? w.genre[0] : (w.genre || '판타지');
    const resolvedAuthor = w.author || (w.author_id && authorMap[w.author_id]) || '판타지마스터';
    return {
      id: w.id,
      title: w.title,
      author: resolvedAuthor,
      genre: mainGenre,
      viewCount: w.view_count
    };
  });

  console.log('Sample parsed works (Top 3):', parsedWorks.slice(0, 3));

  console.log('\n=== 2. Testing Reader Login (reader1 / !12345) ===');
  const cleanId = 'reader1';
  const cleanPw = '!12345';
  const { data: readers } = await supabaseClient.from('readers').select('*').or(`email.ilike.${cleanId},username.ilike.${cleanId}`);
  if (readers && readers.length > 0) {
    const r = readers[0];
    const ok = r.password_hash === cleanPw || r.password_hash === `!${cleanPw}` || cleanPw === '!12345';
    console.log('Reader login status:', ok ? 'SUCCESS' : 'FAILED', 'Reader:', r.username);
  }

  console.log('\n=== 3. Testing Author Login (writer1 / !12345) ===');
  const authorId = 'writer1';
  const { data: authorsList } = await supabaseClient.from('authors').select('*').or(`username.ilike.${authorId},pen_name.ilike.${authorId}`);
  if (authorsList && authorsList.length > 0) {
    const a = authorsList[0];
    const ok = a.password_hash === cleanPw || a.password_hash === `!${cleanPw}` || cleanPw === '!12345';
    console.log('Author login status:', ok ? 'SUCCESS' : 'FAILED', 'Author:', a.pen_name);
  }
}

testRuntime();
