const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const envLocal = dotenv.parse(fs.readFileSync(path.join(__dirname, '..', '.env.local')));
const OPENROUTER_KEY = envLocal.OpenRouter_API_Key;

async function checkModels() {
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}` }
  });
  const json = await res.json();
  const geminiModels = json.data.filter(m => m.id.toLowerCase().includes('gemini'));
  console.log('Gemini models on OpenRouter:', geminiModels.map(m => m.id));
}

checkModels().catch(console.error);
