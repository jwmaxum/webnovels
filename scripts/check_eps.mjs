import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ghwabesnydktumeyejnm.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_XYQ7ydRrTZQ94V6r1WKEtQ_pnL9Po5c';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkEpisodes() {
  const { data: eps, error: epErr } = await supabase.from('episodes').select('*').limit(5);
  console.log('Episodes count:', eps ? eps.length : 0, 'error:', epErr);
  if (eps && eps.length > 0) {
    console.log('Sample episode:', eps[0]);
  }

  const { data: allWorks } = await supabase.from('works').select('id, title, author, status');
  console.log('Total works in DB:', allWorks ? allWorks.length : 0);
  if (allWorks) {
    console.log('First 3 works:', allWorks.slice(0, 3));
  }
}

checkEpisodes();
