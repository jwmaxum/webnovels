const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const envLocal = dotenv.parse(fs.readFileSync(path.join(__dirname, '..', '.env.local')));
const OPENROUTER_KEY = envLocal.OpenRouter_API_Key;

async function testGemini() {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [{ role: 'user', content: '한국 웹소설/웹툰 플랫폼용 작품 데이터 1건을 JSON으로 생성해줘. (title, author, contentType, genre, description, viewCount, isCompleted)' }],
      max_tokens: 2000,
      response_format: { type: 'json_object' }
    })
  });
  const json = await res.json();
  console.log('Response:', JSON.stringify(json, null, 2));
}

testGemini().catch(console.error);
