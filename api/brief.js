export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { articles, keyword } = req.body;
  const GEMINI_KEYS = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '')
    .split(',').map(k => k.trim()).filter(Boolean);

  if (!articles?.length) return res.status(400).json({ error: 'No articles' });
  if (!GEMINI_KEYS.length) return res.status(500).json({ error: 'Gemini API key not configured' });

  const total = articles.length;
  const pos = articles.filter(a => a.tone === 'positif').length;
  const neg = articles.filter(a => a.tone === 'negatif').length;
  const neu = articles.filter(a => a.tone === 'netral').length;
  const unanalyzed = total - pos - neg - neu;

  // Group by topic keywords for theme analysis
  const titleList = articles.slice(0, 40).map((a, i) => `${i+1}. ${a.title}`).join('\n');

  const prompt = `Kamu adalah analis media senior PLN UIW Papua & Papua Barat.

Data monitoring hari ini untuk keyword "${keyword}":
- Total artikel: ${total}
- Tone positif: ${pos} artikel
- Tone negatif: ${neg} artikel  
- Tone netral: ${neu} artikel
- Belum dianalisis: ${unanalyzed} artikel

Daftar judul berita (${Math.min(40, total)} dari ${total}):
${titleList}

Tulis Daily Media Brief dalam bahasa Indonesia, format paragraf mengalir (BUKAN bullet point), 4-5 kalimat, mencakup:
1. Volume dan komposisi tone pemberitaan hari ini
2. Tema atau isu dominan yang paling banyak diangkat (sebutkan persentase atau jumlah spesifik jika bisa)
3. Isu negatif atau kritis yang perlu perhatian tim komunikasi (jika ada)
4. Media yang paling aktif memberitakan
5. Rekomendasi singkat untuk tim humas

Tulis langsung briefnya tanpa judul atau heading.`;

  let lastError = null;
  for (let i = 0; i < GEMINI_KEYS.length; i++) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GEMINI_KEYS[i]}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 800 }
          })
        }
      );

      const data = await response.json();

      if (data.error) {
        lastError = data.error.message;
        const isQuota = data.error.code === 429 || /quota/i.test(data.error.message || '');
        if (isQuota && i < GEMINI_KEYS.length - 1) continue;
        return res.status(500).json({ error: 'Gemini API error', detail: data.error.message });
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!text) return res.status(500).json({ error: 'Empty response from Gemini' });

      return res.status(200).json({ brief: text.trim() });
    } catch (error) {
      lastError = error.message;
      continue;
    }
  }
  return res.status(500).json({ error: 'Failed to generate brief', detail: `Semua ${GEMINI_KEYS.length} API key gagal/kehabisan kuota. Error terakhir: ${lastError}` });
}
