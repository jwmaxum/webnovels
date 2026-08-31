import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ghwabesnydktumeyejnm.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_XYQ7ydRrTZQ94V6r1WKEtQ_pnL9Po5c';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkDB() {
  console.log('=== Checking Works ===');
  const { data: works, error: wErr } = await supabase.from('works').select('*').limit(5);
  console.log('Works error:', wErr);
  console.log('Works count:', works ? works.length : 0);
  if (works && works.length > 0) {
    console.log('Sample work:', works[0]);
  }

  console.log('\n=== Checking Authors ===');
  const { data: authors, error: aErr } = await supabase.from('authors').select('*').limit(5);
  console.log('Authors error:', aErr);
  console.log('Authors count:', authors ? authors.length : 0);
  if (authors && authors.length > 0) {
    console.log('Sample author:', authors[0]);
  }

  console.log('\n=== Checking Readers ===');
  const { data: readers, error: rErr } = await supabase.from('readers').select('*').limit(5);
  console.log('Readers error:', rErr);
  console.log('Readers count:', readers ? readers.length : 0);
  if (readers && readers.length > 0) {
    console.log('Sample reader:', readers[0]);
  }

  console.log('\n=== Checking Admin Users ===');
  const { data: admins, error: admErr } = await supabase.from('admin_users').select('*').limit(5);
  console.log('Admin error:', admErr);
  console.log('Admin count:', admins ? admins.length : 0);
  if (admins && admins.length > 0) {
    console.log('Sample admin:', admins[0]);
  }
}

checkDB();
