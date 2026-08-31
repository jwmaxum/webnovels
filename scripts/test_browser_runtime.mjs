import fs from 'fs';
import vm from 'vm';

const supabaseAdminCode = fs.readFileSync('public/supabase-admin.js', 'utf8');
const appCode = fs.readFileSync('public/app.js', 'utf8');

// Fake Browser Window & DOM Environment
const domMock = {
  window: {
    addEventListener: () => {},
    removeEventListener: () => {},
    scrollTo: () => {},
    location: { hash: '#home' },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    },
    lucide: { createIcons: () => {} },
    supabase: {
      createClient: () => ({
        from: () => ({
          select: () => Promise.resolve({ data: [], error: null }),
          insert: () => Promise.resolve({ data: [], error: null }),
          update: () => Promise.resolve({ data: [], error: null }),
          delete: () => Promise.resolve({ data: [], error: null })
        }),
        rpc: () => Promise.resolve({ data: null, error: null }),
        auth: { signInWithPassword: () => Promise.resolve({ data: null, error: null }) }
      })
    }
  },
  document: {
    readyState: 'complete',
    addEventListener: () => {},
    getElementById: (id) => ({
      addEventListener: () => {},
      classList: { add: () => {}, remove: () => {} },
      style: {},
      value: '',
      textContent: '',
      innerHTML: '',
      dataset: {},
      querySelectorAll: () => [],
      querySelector: () => null
    }),
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: () => ({
      classList: { add: () => {}, remove: () => {} },
      appendChild: () => {},
      textContent: '',
      style: {}
    }),
    body: { setAttribute: () => {} }
  },
  localStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
  },
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: setInterval,
  clearInterval: clearInterval,
  fetch: () => Promise.resolve({ ok: false })
};

domMock.window.document = domMock.document;
const context = vm.createContext(domMock);

try {
  console.log('--- 1. Evaluating supabase-admin.js in JSDOM sandbox ---');
  vm.runInContext(supabaseAdminCode, context);
  console.log('supabase-admin.js evaluated OK. window.WebNovelsAdmin keys:', Object.keys(context.window.WebNovelsAdmin || {}));

  console.log('\n--- 2. Evaluating app.js in JSDOM sandbox ---');
  vm.runInContext(appCode, context);
  console.log('app.js evaluated OK.');

  console.log('\n--- 3. Testing openModal and closeAllModals existence ---');
  console.log('window.openModal:', typeof context.window.openModal);
  console.log('window.closeAllModals:', typeof context.window.closeAllModals);
  console.log('window.showToast:', typeof context.window.showToast);

  console.log('\n--- 4. Calling openModal in sandbox ---');
  context.window.openModal('modalAuth');
  console.log('openModal executed without throw!');

  console.log('\n✅ ALL BROWSER RUNTIME SIMULATION TESTS PASSED WITH 0 ERRORS!');
  process.exit(0);
} catch (err) {
  console.error('💥 ERROR during runtime simulation:', err);
  process.exit(1);
}
