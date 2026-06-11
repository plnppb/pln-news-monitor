export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { title, description } = req.body;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!title) return res.status(400).json({ error: 'Title is required' });

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

Spokesperson internal PLN: pegawai/pejabat PLN (GM, Manajer, Direktur, dll)
Spokesperson eksternal: pihak luar PLN (pejabat pemerintah, tokoh masyarakat, dll)
Jika tidak ada nama narasumber yang jelas, kosongkan field tersebut.

Judul: ${title}
Deskripsi: ${(description || '').replace(/<[^>]+>/g, '').substring(0, 300)}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
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
    const parsed = JSON.parse(clean);
    return res.status(200).json(parsed);
  } catch (error) {
    return res.status(200).json({
      tone: 'netral',
      spokesperson_internal: '',
      spokesperson_eksternal: '',
      resume: 'Gagal menganalisis artikel ini.'
    });
  }
}
