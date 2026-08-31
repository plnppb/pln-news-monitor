const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
// Bisa lebih dari satu key, dipisah koma, dari akun Google berbeda-beda
// (kuota Gemini diikat ke project Google, bukan ke key — jadi key dari
// akun/project berbeda beneran punya kuota terpisah).
const GEMINI_KEYS = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '')
  .split(',').map(k => k.trim()).filter(Boolean);

const TONE_PROMPT = `Kamu adalah analis media senior untuk PT PLN (Persero) UIW Papua & Papua Barat. Tugasmu menganalisis artikel berita dan menentukan tonalitas dari sudut pandang citra PLN UIW Papua & Papua Barat.

PANDUAN TONALITAS (untuk field "tone" — ini menilai KESELURUHAN artikel):
NEGATIF: keluhan warga, kritik DPR/DPRD (kata: soroti, desak, tegur), gangguan listrik (kata: padam, mati lampu, keluhkan, protes), kecelakaan PLN, tarif naik yang meresahkan.
POSITIF: pencapaian yang BENAR-BENAR signifikan/terukur — elektrifikasi wilayah yang sebelumnya belum teraliri listrik, penghargaan dari pihak eksternal independen (bukan klaim PLN sendiri), penurunan gangguan dengan angka konkret yang jelas, kolaborasi besar di mana PLN inisiator nyata.
NETRAL: komitmen tanpa bukti, kegiatan rutin, permintaan biasa, pemeliharaan terencana, berita kebijakan umum, DAN siaran pers promosi rutin PLN sendiri (perpanjangan promo, edukasi/sosialisasi rutin, kunjungan kerja, laporan capaian rutin) — meskipun teksnya pakai kata "berhasil"/"capai"/"sukses", itu TETAP NETRAL kalau isinya cuma pengumuman rutin, bukan pencapaian luar biasa.

PENTING SOAL BIAS: banyak artikel berasal dari siaran pers PLN sendiri yang rutin pakai kata "berhasil"/"capai"/"sukses" untuk kegiatan biasa. JANGAN otomatis menilai POSITIF hanya karena ada kata-kata itu — nilai dari SUBSTANSI dampaknya, bukan dari pilihan katanya. Kalau ragu antara POSITIF dan NETRAL untuk siaran pers rutin PLN, pilih NETRAL.

KASUS KHUSUS:
- "keluhkan pemadaman" atau "pemadaman bergilir" = NEGATIF
- "kurangi durasi pemadaman X persen" = POSITIF  
- "jadwalkan pemadaman pemeliharaan" = NETRAL
- "DPR/DPRD soroti" = NEGATIF
- "PLN teken MoU" (PLN inisiator, dampak nyata) = POSITIF
- "PLN perpanjang/lanjutkan promo yang sudah ada" = NETRAL (bukan pencapaian baru)

PENTING SOAL SPOKESPERSON: field "tone" di atas menilai artikel SECARA KESELURUHAN, BUKAN sikap orang yang dikutip. Kalau ada narasumber (spokesperson) yang dikutip, nilai TERPISAH bagaimana SIKAP/PERNYATAAN orang itu sendiri di dalam kutipannya — apakah pernyataannya sendiri terdengar membela/positif, mengkritik/negatif, atau sekadar informatif/netral. Ini WAJIB dinilai independen dari tone keseluruhan artikel.
Contoh: artikel soal keluhan warga (tone artikel = NEGATIF) tapi GM PLN dikutip menjelaskan solusi dengan tenang → sikap GM tersebut = NETRAL atau POSITIF, BUKAN otomatis negatif hanya karena muncul di artikel negatif.
Kalau tidak ada spokesperson di kategori itu, isi stance dengan string kosong.

ATURAN WAJIB PENULISAN NAMA SPOKESPERSON:
1. HARUS ada NAMA ORANG SPESIFIK (nama depan+belakang). Kalau artikel cuma nyebut jabatan/kolektif tanpa nama jelas ("Manajemen PLN", "pihak PLN", "manajer terkait"), KOSONGKAN field itu — JANGAN isi dengan istilah kolektif/jabatan doang.
2. **JANGAN PERNAH MENGARANG ATAU MENEBAK NAMA.** Nama yang kamu tulis WAJIB benar-benar tertulis KATA PER KATA di teks judul/deskripsi yang diberikan di bawah. Kalau teksnya cuma bilang "PLN memutuskan..." atau semacamnya TANPA menyebut nama orang sama sekali, KOSONGKAN field spokesperson — meskipun secara logika kamu bisa menebak siapa yang biasanya menjabat itu. Mengarang nama yang tidak ada di teks adalah kesalahan FATAL karena bisa salah mengutip orang sungguhan.
3. Format SATU orang: "Nama Lengkap|Jabatan pada artikel ini" — pakai tanda pipe (|) memisahkan nama dan jabatan, BUKAN koma.
4. Format LEBIH DARI SATU orang: pisahkan tiap orang dengan titik-koma (;). JANGAN PERNAH gabung dua nama pakai kata "dan" dalam satu entri — masing-masing orang harus jadi entri "Nama|Jabatan" sendiri, dipisah ";".
   Contoh benar: "Alfons Manibui|Anggota Komisi XII DPR RI;Cheroline Chrisye Makalew|Anggota Komisi XII DPR RI"
   Contoh SALAH (jangan begini): "Alfons Manibui dan Cheroline Chrisye Makalew|Anggota Komisi XII DPR RI"
5. Tulis jabatan SESUAI KONTEKS ARTIKEL INI — kalau orang itu dikutip bukan dalam kapasitas jabatan struktural PLN-nya (misal sebagai ketua panitia acara), tulis jabatan itu, bukan jabatan struktural default dia.

Balas HANYA JSON ini tanpa teks lain:
{"tone":"netral","spokesperson_internal":"","spokesperson_internal_stance":"","spokesperson_eksternal":"","spokesperson_eksternal_stance":"","resume":"ringkasan 2-3 kalimat"}`;

async function analyzeArticle(title, description) {
  if (!GEMINI_KEYS.length) return { error: 'NO_API_KEY' };
  const prompt = `${TONE_PROMPT}\n\nJudul: ${title}\nDeskripsi: ${(description || '').replace(/<[^>]+>/g, '').substring(0, 400)}`;

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
            generationConfig: { temperature: 0.1, maxOutputTokens: 500 }
          })
        }
      );
      const data = await response.json();

      if (data.error) {
        lastError = data.error.message;
        const isQuota = data.error.code === 429 || /quota/i.test(data.error.message || '');
        if (isQuota && i < GEMINI_KEYS.length - 1) continue; // coba key berikutnya
        return { error: data.error.message, code: data.error.code, keyIndex: i };
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const jsonMatch = clean.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { error: 'NO_JSON', raw: text.substring(0, 100) };

      const result = JSON.parse(jsonMatch[0]);
      if (!['positif', 'negatif', 'netral'].includes(result.tone)) result.tone = 'netral';
      return result;
    } catch (e) {
      lastError = e.message;
      continue; // exception jaringan, coba key berikutnya juga
    }
  }
  return { error: `Semua ${GEMINI_KEYS.length} API key gagal/kehabisan kuota. Error terakhir: ${lastError}` };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  const batchSize = parseInt(req.query.batch) || 2;
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
    return res.status(200).json({ article: articles[0].title, gemini_result: result, keys_configured: GEMINI_KEYS.length });
  }

  try {
    let url;
    if (reanalyze) {
      url = `${SUPABASE_URL}/rest/v1/articles?select=id,title,description&limit=${batchSize}&offset=${offset}&order=id.asc`;
    } else {
      url = `${SUPABASE_URL}/rest/v1/articles?select=id,title,description&tone=eq.&limit=${batchSize}&offset=${offset}&order=id.asc`;
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

      const patchResp = await fetch(`${SUPABASE_URL}/rest/v1/articles?id=eq.${article.id}`, {
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
          spokesperson_internal_stance: result.spokesperson_internal_stance || '',
          spokesperson_eksternal: result.spokesperson_eksternal || '',
          spokesperson_eksternal_stance: result.spokesperson_eksternal_stance || ''
        })
      });

      if (!patchResp.ok) {
        failed++;
        if (errors.length < 3) errors.push({ id: article.id, error: `Gagal simpan ke DB: ${await patchResp.text()}` });
        continue;
      }

      toneCount[result.tone] = (toneCount[result.tone] || 0) + 1;
      processed++;
      // TIDAK ADA jeda di sini lagi — batch sengaja dibikin kecil (default 2)
      // biar satu request selesai jauh di bawah limit eksekusi 10 detik Vercel
      // Hobby. Jeda antar-request Gemini (biar tidak kena rate limit 15/menit)
      // sekarang jadi tanggung jawab PEMANGGIL endpoint ini (skrip browser /
      // GitHub Actions), bukan di dalam function ini.
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
