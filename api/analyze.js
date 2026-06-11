export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { title, description } = req.body;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!title) return res.status(400).json({ error: 'Title is required' });

  const prompt = `Analisis berita berikut dan berikan respons HANYA dalam format JSON ini (tanpa teks lain):
{
  "sentiment": "positif" | "negatif" | "netral",
  "tone": "informatif" | "kritis" | "aspiratif" | "investigatif" | "promosi",
  "summary": "ringkasan 1-2 kalimat dalam bahasa Indonesia",
  "score": angka 1-10 (tingkat relevansi untuk PLN Papua)
}

Judul: ${title}
Deskripsi: ${description || '(tidak ada)'}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 300 }
        })
      }
    );
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return res.status(200).json(parsed);
  } catch (error) {
    return res.status(200).json({
      sentiment: 'netral',
      tone: 'informatif',
      summary: 'Gagal menganalisis artikel ini.',
      score: 5
    });
  }
}
