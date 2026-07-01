const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const TONE_PROMPT = `Kamu adalah analis media senior untuk PT PLN (Persero) UIW Papua & Papua Barat. Tugasmu menganalisis artikel berita dan menentukan tonalitas dari sudut pandang citra PLN UIW Papua & Papua Barat.

PANDUAN TONALITAS:
NEGATIF: keluhan warga, kritik DPR/DPRD (kata: soroti, desak, tegur), gangguan listrik (kata: padam, mati lampu, keluhkan, protes), kecelakaan PLN, tarif naik yang meresahkan.
POSITIF: pencapaian konkret PLN (berhasil, capai, sukses), penghargaan, elektrifikasi desa, MoU di mana PLN sebagai inisiator, program EBT/SPKLU.
NETRAL: komitmen tanpa bukti, kegiatan rutin, permintaan biasa, pemeliharaan terencana, berita kebijakan umum.

KASUS KHUSUS:
- "keluhkan pemadaman" atau "pemadaman bergilir" = NEGATIF
- "kurangi durasi pemadaman X persen" = POSITIF  
- "jadwalkan pemadaman pemeliharaan" = NETRAL
- "DPR/DPRD soroti" = NEGATIF
- "PLN teken MoU" (PLN inisiator) = POSITIF

Balas HANYA JSON ini tanpa teks lain:
{"tone":"netral","spokesperson_internal":"","spokesperson_eksternal":"","resume":"ringkasan 2-3 kalimat"}`;

async function analyzeArticle(title, description) {
  if (!GEMINI_API_KEY) return { error: 'NO_API_KEY' };
  try {
    const prompt = `${TONE_PROMPT}\n\nJudul: ${title}\nDeskripsi: ${(description || '').replace(/<[^>]+>/g, '').substring(0, 400)}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 500 }
        })
      }
    );
    const data = await response.json();

    // Expose error dari Gemini
    if (data.error) return { error: data.error.message, code: data.error.code };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { error: 'NO_JSON', raw: text.substring(0, 100) };
    
    const result = JSON.parse(jsonMatch[0]);
    if (!['positif', 'negatif', 'netral'].includes(result.tone)) result.tone = 'netral';
    return result;
  } catch (e) {
    return { error: e.message };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  const batchSize = parseInt(req.query.batch) || 30;
  const reanalyze = req.query.reanalyze === 'true';
  const offset = parseInt(req.query.offset) || 0;

  // MODE DEBUG: test 1 artikel dan tampilkan hasil lengkap
  if (req.query.debug === 'true') {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/articles?select=id,title,description&limit=1&offset=${offset}&order=id.asc`, {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
    });
    const articles = await r.json();
    if (!articles.length) return res.status(200).json({ error: 'No articles found' });
    const result = await analyzeArticle(articles[0].title, articles[0].description);
    return res.status(200).json({ article: articles[0].title, gemini_result: result, api_key_set: !!GEMINI_API_KEY });
  }

  try {
    let url;
    if (reanalyze) {
      url = `${SUPABASE_URL}/rest/v1/articles?select=id,title,description&limit=${batchSize}&offset=${offset}&order=id.asc`;
    } else {
      url = `${SUPABASE_URL}/rest/v1/articles?select=id,title,description&resume=eq.&limit=${batchSize}&order=id.asc`;
    }

    const response = await fetch(url, {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
    });
    const articles = await response.json();

    if (!Array.isArray(articles) || !articles.length) {
      return res.status(200).json({ success: true, message: 'Semua artikel sudah dianalisis', processed: 0 });
    }

    let processed = 0, failed = 0;
    const toneCount = { positif: 0, negatif: 0, netral: 0 };
    const errors = [];

    for (const article of articles) {
      const result = await analyzeArticle(article.title, article.description);
      if (result.error) {
        failed++;
        if (errors.length < 3) errors.push({ id: article.id, error: result.error });
        continue;
      }

      await fetch(`${SUPABASE_URL}/rest/v1/articles?id=eq.${article.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({
          tone: result.tone,
          resume: result.resume || '',
          spokesperson_internal: result.spokesperson_internal || '',
          spokesperson_eksternal: result.spokesperson_eksternal || ''
        })
      });

      toneCount[result.tone] = (toneCount[result.tone] || 0) + 1;
      processed++;
      await new Promise(r => setTimeout(r, 300));
    }

    const nextOffset = offset + batchSize;
    return res.status(200).json({
      success: true, processed, failed, toneCount, errors,
      nextOffset,
      note: articles.length < batchSize ? 'Selesai' : `Masih ada, panggil lagi dengan offset=${nextOffset}`
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
