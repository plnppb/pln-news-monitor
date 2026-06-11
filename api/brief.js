export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { articles, keyword } = req.body;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!articles || !articles.length) return res.status(400).json({ error: 'No articles' });

  const total = articles.length;
  const pos = articles.filter(a => a.tone === 'positif').length;
  const neg = articles.filter(a => a.tone === 'negatif').length;
  const neu = articles.filter(a => a.tone === 'netral').length;

  // Send up to 40 titles for analysis
  const titleList = articles.slice(0, 40).map((a, i) => `${i+1}. ${a.title}`).join('\n');

  const prompt = `Kamu adalah analis media senior untuk PLN UIW Papua & Papua Barat. 
Berikut adalah ${total} judul berita terkait "${keyword}" yang dikumpulkan hari ini:

${titleList}

Statistik tone: ${pos} positif, ${neg} negatif, ${neu} netral.

Tulis Daily Media Brief dalam bahasa Indonesia yang DETAIL dan INFORMATIF mencakup:
1. Gambaran umum volume dan tone pemberitaan
2. Tema/isu utama yang paling banyak diangkat (sebutkan persentase atau jumlah spesifik)
3. Isu-isu kritis atau negatif yang perlu perhatian (jika ada)
4. Media yang paling aktif memberitakan
5. Rekomendasi singkat untuk tim komunikasi

Format: paragraf mengalir, 4-6 kalimat, profesional dan ringkas. JANGAN gunakan bullet point.`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 600 }
        })
      }
    );
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return res.status(200).json({ brief: text });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to generate brief' });
  }
}
