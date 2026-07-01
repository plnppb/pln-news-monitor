const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const TONE_PROMPT = `Kamu adalah analis media senior untuk PT PLN (Persero) UIW Papua & Papua Barat. Tugasmu menganalisis artikel berita dan menentukan tonalitas dari sudut pandang citra PLN UIW Papua & Papua Barat.

## PANDUAN TONALITAS

### NEGATIF — artikel yang menyudutkan, mengkritik, atau merugikan citra PLN:
- Keluhan warga/pelanggan terhadap PLN (pemadaman, tagihan, pelayanan buruk)
- Kritik dari legislatif/DPR/DPRD/pemerintah daerah terhadap PLN (kata: "soroti", "desak", "pertanyakan", "minta penjelasan", "tegur")
- Gangguan/kerusakan sistem kelistrikan yang merugikan masyarakat (kata: "padam", "mati lampu", "gangguan listrik", "byar pet", "keluhkan", "protes", "tuntut")
- Kecelakaan/insiden terkait infrastruktur PLN
- Berita tarif listrik naik yang menimbulkan keresahan

### POSITIF — artikel yang menguntungkan atau memuji citra PLN:
- Pencapaian konkret PLN (elektrifikasi desa, pengurangan gangguan, target terpenuhi)
- Penghargaan/apresiasi yang diterima PLN dari pihak eksternal
- Program PLN yang berdampak nyata bagi masyarakat (kata: "berhasil", "capai", "sukses", "apresiasi", "penghargaan", "listrik masuk desa")
- Kolaborasi/MoU di mana PLN sebagai inisiator atau setara
- Inovasi/program PLN yang positif (EBT, SPKLU, elektrifikasi 3T)
- Berita pembangunan infrastruktur PLN yang selesai/berjalan baik

### NETRAL — artikel informatif tanpa tendensi positif/negatif yang kuat:
- Pernyataan komitmen PLN tanpa bukti pencapaian konkret
- Kegiatan rutin PLN (rapat, sosialisasi, kunjungan kerja)
- Permintaan/harapan pihak lain ke PLN tanpa nada tekanan
- Pemeliharaan jaringan terencana yang diinformasikan dengan baik
- Berita kebijakan energi nasional yang menyebut PLN secara umum

## KASUS KHUSUS KATA "PEMADAMAN":
- "Warga keluhkan pemadaman" / "pemadaman bergilir bikin resah" → NEGATIF
- "PLN berhasil kurangi durasi pemadaman X persen" / "pemadaman turun" → POSITIF
- "PLN jadwalkan pemadaman untuk pemeliharaan" → NETRAL

## KASUS KHUSUS KATA "SOROTI":
- "DPR soroti kelistrikan Papua" / "DPRD soroti PLN" → NEGATIF
- "Publik soroti kinerja PLN" → NEGATIF

## KASUS KHUSUS MoU/KOLABORASI:
- "PLN teken MoU" / "PLN gandeng X" (PLN sebagai inisiator) → POSITIF
- "PLN diminta teken MoU" / "X minta PLN kerja sama" → NETRAL

## FORMAT RESPONS:
Balas HANYA dengan JSON berikut, tanpa teks lain, tanpa markdown, tanpa backtick:
{"tone":"positif","spokesperson_internal":"","spokesperson_eksternal":"","resume":""}

Nilai tone HARUS salah satu dari: positif, negatif, netral`;

async function analyzeArticle(title, description) {
  if (!GEMINI_API_KEY) return null;
  try {
    const prompt = `${TONE_PROMPT}

## ARTIKEL:
Judul: ${title}
Deskripsi: ${(description || '').replace(/<[^>]+>/g, '').substring(0, 400)}`;

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
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    // Bersihkan semua kemungkinan wrapper markdown
    const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    // Cari JSON object di dalam teks (antisipasi kalau Gemini masih tambah teks)
    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const result = JSON.parse(jsonMatch[0]);
    // Validasi tone
    if (!['positif', 'negatif', 'netral'].includes(result.tone)) {
      result.tone = 'netral';
    }
    return result;
  } catch (e) {
    return null;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const batchSize = parseInt(req.query.batch) || 30;
  const reanalyze = req.query.reanalyze === 'true';
  // offset untuk re-analisis manual (optional)
  const offset = parseInt(req.query.offset) || 0;

  try {
    let url;
    if (reanalyze) {
      // Re-analisis semua artikel, pakai offset untuk pagination
      url = `${SUPABASE_URL}/rest/v1/articles?select=id,title,description&limit=${batchSize}&offset=${offset}&order=id.asc`;
    } else {
      // Hanya yang belum dianalisis (resume kosong atau tone masih netral default)
      url = `${SUPABASE_URL}/rest/v1/articles?select=id,title,description&resume=eq.&limit=${batchSize}&order=id.asc`;
    }

    const response = await fetch(url, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    const articles = await response.json();

    if (!Array.isArray(articles) || !articles.length) {
      return res.status(200).json({ success: true, message: 'Semua artikel sudah dianalisis', processed: 0 });
    }

    let processed = 0;
    let failed = 0;
    const toneCount = { positif: 0, negatif: 0, netral: 0 };

    for (const article of articles) {
      const result = await analyzeArticle(article.title, article.description);
      if (!result) { failed++; continue; }

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
      success: true,
      processed,
      failed,
      toneCount,
      nextOffset,
      note: articles.length < batchSize ? 'Selesai' : `Masih ada, panggil lagi dengan offset=${nextOffset}`
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
