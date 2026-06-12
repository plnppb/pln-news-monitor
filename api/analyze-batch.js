const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function analyzeArticle(title, description) {
  const prompt = `Kamu adalah analis media untuk PLN UIW Papua & Papua Barat. Analisis berita berikut dan berikan respons HANYA dalam format JSON ini (tanpa teks lain, tanpa markdown):
{
  "tone": "positif" | "negatif" | "netral",
  "spokesperson_internal": "Nama, Jabatan (pisah semicolon jika lebih dari satu, kosongkan jika tidak ada)",
  "spokesperson_eksternal": "Nama, Jabatan (pisah semicolon jika lebih dari satu, kosongkan jika tidak ada)",
  "resume": "Ringkasan 2-3 kalimat dalam bahasa Indonesia"
}
Panduan tone:
- positif: berita menguntungkan/memuji PLN atau program PLN
- negatif: berita kritik, keluhan, masalah, atau merugikan PLN
- netral: berita informatif/faktual tanpa tendensi tertentu
Judul: ${title}
Deskripsi: ${(description || '').replace(/<[^>]+>/g, '').substring(0, 300)}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 400 }
      })
    }
  );
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

async function updateArticle(id, analysis) {
  await fetch(`${SUPABASE_URL}/rest/v1/articles?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    },
    body: JSON.stringify({
      tone: analysis.tone || 'netral',
      resume: analysis.resume || '',
      spokesperson_internal: analysis.spokesperson_internal || '',
      spokesperson_eksternal: analysis.spokesperson_eksternal || ''
    })
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth check
  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const batchSize = parseInt(req.query.batch) || 20;

  try {
    // Ambil artikel yang belum dianalisis (tone masih default 'netral' dan resume kosong)
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/articles?select=id,title,description&resume=eq.&order=id.asc&limit=${batchSize}`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      }
    );
    const articles = await response.json();

    if (!articles.length) {
      return res.status(200).json({ success: true, message: 'Semua artikel sudah dianalisis', processed: 0 });
    }

    let processed = 0;
    let errors = 0;

    for (const article of articles) {
      try {
        const analysis = await analyzeArticle(article.title, article.description);
        await updateArticle(article.id, analysis);
        processed++;
        // Delay 300ms antar request ke Gemini agar tidak kena rate limit
        await new Promise(r => setTimeout(r, 300));
      } catch (e) {
        errors++;
        // Tetap update dengan default supaya tidak diproses ulang
        await updateArticle(article.id, { tone: 'netral', resume: 'Gagal dianalisis.', spokesperson_internal: '', spokesperson_eksternal: '' });
      }
    }

    return res.status(200).json({
      success: true,
      processed,
      errors,
      remaining_note: 'Panggil endpoint ini lagi untuk batch berikutnya'
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
