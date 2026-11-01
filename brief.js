
// ===== MODE LAPORAN (POST {mode:'report', ...}) =====
// AI hanya menyusun narasi + pengelompokan isu; semua angka dihitung di sisi aplikasi.
async function reportMode(req, res) {
  const KEYS = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '').split(',').map(k => k.trim()).filter(Boolean);
  if (!KEYS.length) return res.status(500).json({ error: 'Gemini API key not configured' });
  const b = req.body || {};
  const items = Array.isArray(b.items) ? b.items.slice(0, 80) : [];
  if (!items.length) return res.status(400).json({ error: 'No items' });
  const lines = items.map(a => `${a.n}. [${a.tone}] ${a.judul} | ${a.media}${a.kategori ? ' | ' + a.kategori : ''}${a.lokasi ? ' | ' + a.lokasi : ''}${a.ringkas ? ' | ' + a.ringkas : ''}${a.narasumber ? ' | kutipan: ' + a.narasumber : ''}`).join('\n');
  const tematik = b.jenis === 'tematik';
  const prompt = `Kamu analis media senior PT PLN (Persero) UIW Papua & Papua Barat. Susun bahan ${tematik ? 'laporan tematik tentang isu "' + (b.kata_kunci || '') + '"' : (b.jenis === 'harian' ? 'laporan harian' : 'laporan mingguan')} pemantauan media untuk periode ${b.periode}.
Total berita periode ini ${b.total} (positif ${b.positif}, netral ${b.netral}, negatif ${b.negatif}). Di bawah ini ${items.length} berita yang kamu baca (semua berita negatif diprioritaskan), diberi nomor.

${lines}

ATURAN:
- Hanya gunakan fakta dari daftar di atas. DILARANG mengarang nama, angka, kejadian, atau kutipan. Jangan menulis jumlah total berita; angka ditangani sistem.
- Bahasa Indonesia formal, gaya laporan humas, paragraf mengalir tanpa bullet.
- "topik_utama": 4-6 kalimat. ${tematik ? 'Uraikan perkembangan isu ini secara kronologis dari awal sampai akhir periode, siapa yang terlibat, dan bagaimana arah pemberitaannya.' : 'Tema yang paling banyak diangkat dan citra PLN yang terbentuk.'}
- "isu_sensitif": 3-5 kalimat tentang berita negatif atau berisiko (keluhan warga, desakan pejabat/DPRD, tuntutan kompensasi, korban, kritik). Sebut tokoh hanya bila ada di daftar. Kalau tidak ada, tulis bahwa tidak ada isu sensitif yang menonjol.
- "topik_positif" dan "topik_negatif": maksimal 5 topik masing-masing; tiap topik = {"topik": frasa singkat, "ids": [nomor berita bertone itu yang masuk topik]}.
- "early_warning": maksimal 6 isu yang perlu perhatian humas, hanya dari berita negatif atau berisiko. Kelompokkan berita sejenis. Tiap isu = {"judul": 3-6 kata, "uraian": 3-4 kalimat faktual, "rekomendasi": 3-4 kalimat saran komunikasi yang konkret dan proporsional (mis. "dapat diarahkan pada ..."), "ids": [nomor berita terkait]}. Kosongkan array jika tidak ada.

Balas HANYA JSON: {"topik_utama":"","isu_sensitif":"","topik_positif":[],"topik_negatif":[],"early_warning":[]}`;
  let lastError = null;
  for (let i = 0; i < KEYS.length; i++) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${KEYS[i]}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.25, maxOutputTokens: 3500, responseMimeType: 'application/json' } })
      });
      const data = await r.json();
      if (data.error) {
        lastError = data.error.message;
        if ((data.error.code === 429 || /quota/i.test(lastError || '')) && i < KEYS.length - 1) continue;
        return res.status(500).json({ error: 'Gemini API error', detail: lastError });
      }
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const m = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').match(/\{[\s\S]*\}/);
      if (!m) return res.status(500).json({ error: 'Format jawaban AI tidak terbaca' });
      return res.status(200).json({ report: JSON.parse(m[0]) });
    } catch (e) { lastError = e.message; }
  }
  return res.status(500).json({ error: 'Gagal menyusun narasi', detail: lastError });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (req.body && req.body.mode === 'report') return reportMode(req, res);

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
