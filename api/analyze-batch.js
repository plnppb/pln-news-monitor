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
- Berita korupsi/penyelewengan yang melibatkan PLN
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
- Permintaan/harapan pihak lain ke PLN tanpa nada tekanan (kata: "harap", "minta", "diminta" dengan nada biasa)
- Pemeliharaan jaringan terencana yang diinformasikan dengan baik
- Berita kebijakan energi nasional yang menyebut PLN secara umum
- Profil/wawancara pejabat PLN tanpa isu spesifik

## KASUS KHUSUS KATA "PEMADAMAN":
- "Warga keluhkan pemadaman" / "pemadaman bergilir bikin resah" → NEGATIF
- "PLN berhasil kurangi durasi pemadaman" / "pemadaman turun X persen" → POSITIF  
- "PLN jadwalkan pemadaman untuk pemeliharaan" → NETRAL

## KASUS KHUSUS KATA "SOROTI":
- "DPR soroti kelistrikan Papua" / "DPRD soroti PLN" → NEGATIF (tekanan legislatif)
- "Publik soroti kinerja PLN" → NEGATIF

## FORMAT RESPONS (JSON saja, tanpa teks lain, tanpa markdown):
{
  "tone": "positif" | "negatif" | "netral",
  "alasan_tone": "1 kalimat singkat alasan penentuan tone",
  "spokesperson_internal": "Nama, Jabatan PLN (kosongkan jika tidak ada, pisah semicolon jika lebih dari satu)",
  "spokesperson_eksternal": "Nama, Jabatan non-PLN (kosongkan jika tidak ada, pisah semicolon jika lebih dari satu)",
  "resume": "Ringkasan 2-3 kalimat dalam Bahasa Indonesia yang menjelaskan isi berita secara objektif"
}`;

async function analyzeArticle(title, description) {
  if (!GEMINI_API_KEY) return null;
  try {
    const prompt = `${TONE_PROMPT}

## ARTIKEL YANG DIANALISIS:
Judul: ${title}
Deskripsi: ${(description || '').replace(/<[^>]+>/g, '').substring(0, 400)}

Berikan analisis dalam format JSON:`;

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
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
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
  // reanalyze=true → re-analisis semua artikel (termasuk yang sudah punya tone)
  // reanalyze=false (default) → hanya analisis yang belum
  const reanalyze = req.query.reanalyze === 'true';

  try {
    let url = `${SUPABASE_URL}/rest/v1/articles?select=id,title,description,tone&limit=${batchSize}&order=id.asc`;
    if (!reanalyze) {
      // Hanya yang belum dianalisis (resume kosong)
      url += `&resume=eq.`;
    }

    const response = await fetch(url, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    const articles = await response.json();

    if (!articles.length) {
      return res.status(200).json({ success: true, message: 'Semua artikel sudah dianalisis', processed: 0 });
    }

    let processed = 0;
    let toneCount = { positif: 0, negatif: 0, netral: 0 };

    for (const article of articles) {
      const result = await analyzeArticle(article.title, article.description);
      if (!result) continue;

      await fetch(`${SUPABASE_URL}/rest/v1/articles?id=eq.${article.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({
          tone: result.tone || 'netral',
          resume: result.resume || '',
          spokesperson_internal: result.spokesperson_internal || '',
          spokesperson_eksternal: result.spokesperson_eksternal || ''
        })
      });

      toneCount[result.tone] = (toneCount[result.tone] || 0) + 1;
      processed++;
      await new Promise(r => setTimeout(r, 300));
    }

    return res.status(200).json({
      success: true,
      processed,
      toneCount,
      note: processed === batchSize ? 'Masih ada artikel lain, panggil lagi endpoint ini' : 'Selesai'
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
