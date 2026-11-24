
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
  const part = b.bagian === 'ew' ? 'ew' : 'ringkas';
  const head = `Kamu analis media senior PT PLN (Persero) UIW Papua & Papua Barat. Susun bahan ${tematik ? 'laporan tematik tentang isu "' + (b.kata_kunci || '') + '"' : (b.jenis === 'harian' ? 'laporan harian' : 'laporan mingguan')} pemantauan media untuk periode ${b.periode}.
Total berita periode ini ${b.total} (positif ${b.positif}, netral ${b.netral}, negatif ${b.negatif}). Di bawah ini ${items.length} berita yang kamu baca, diberi nomor.

${lines}

ATURAN UMUM: Hanya gunakan fakta dari daftar di atas. DILARANG mengarang nama, angka, kejadian, atau kutipan. Jangan menulis jumlah total berita. Bahasa Indonesia formal gaya humas, ringkas.
`;
  const prompt = part === 'ew' ? head + `
TUGAS: "early_warning" = maksimal 5 isu yang perlu perhatian humas, hanya dari berita negatif atau berisiko. Kelompokkan berita sejenis. Tiap isu = {"judul": 3-6 kata, "uraian": 2-3 kalimat faktual, "rekomendasi": 2-3 kalimat saran komunikasi konkret dan proporsional (mis. "dapat diarahkan pada ..."), "ids": [nomor berita terkait]}. Array kosong jika tidak ada.
Balas HANYA JSON: {"early_warning":[]}`
  : head + `
TUGAS:
- "topik_utama": 4-5 kalimat. ${tematik ? 'Uraikan perkembangan isu ini secara kronologis dari awal sampai akhir periode, siapa yang terlibat, dan arah pemberitaannya.' : 'Tema yang paling banyak diangkat dan citra PLN yang terbentuk.'}
- "isu_sensitif": 2-4 kalimat tentang berita negatif atau berisiko (keluhan warga, desakan pejabat/DPRD, kompensasi, korban, kritik). Sebut tokoh hanya bila ada di daftar. Jika tidak ada, tulis bahwa tidak ada isu sensitif yang menonjol.
- "topik_positif" dan "topik_negatif": maksimal 4 topik masing-masing, tiap topik = {"topik": frasa singkat, "ids": [nomor berita bertone itu]}.
Balas HANYA JSON: {"topik_utama":"","isu_sensitif":"","topik_positif":[],"topik_negatif":[]}`;
  const maxTok = part === 'ew' ? 1500 : 1300;
  let lastError = null;
  for (let i = 0; i < KEYS.length; i++) {
    try {
      const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 8500);
      let r; try { r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${KEYS[i]}`, {
        signal: ctrl.signal, method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.25, maxOutputTokens: maxTok, responseMimeType: 'application/json' } })
      }); } finally { clearTimeout(timer); }
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
    } catch (e) { lastError = e.name === 'AbortError' ? 'AI terlalu lama menjawab (timeout), coba lagi' : e.message; }
  }
  return res.status(500).json({ error: 'Gagal menyusun narasi', detail: lastError });
}

// ===== MODE DRAFT RESPONS (POST {mode:'draft', jenis, items, catatan}) =====
// AI hanya menyusun KERANGKA; fakta, angka, dan nama pejabat wajib dilengkapi/diverifikasi manusia.
async function draftMode(req, res) {
  const KEYS = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '').split(',').map(k => k.trim()).filter(Boolean);
  if (!KEYS.length) return res.status(500).json({ error: 'Gemini API key not configured' });
  const b = req.body || {};
  const items = Array.isArray(b.items) ? b.items.slice(0, 8) : [];
  if (!items.length) return res.status(400).json({ error: 'Tidak ada berita' });
  const jenis = { hak_jawab: 'surat hak jawab kepada redaksi media', siaran_pers: 'siaran pers klarifikasi', wa: 'pesan singkat WhatsApp untuk pimpinan (maks 5 kalimat) berisi ringkasan isu dan usulan sikap' }[b.jenis] || 'pernyataan klarifikasi resmi';
  const lines = items.map((a, i) => `${i + 1}. ${a.judul} | ${a.media}${a.tanggal ? ' | ' + a.tanggal : ''}${a.ringkas ? ' | ' + a.ringkas : ''}`).join('\n');
  const prompt = `Kamu staf komunikasi korporat PT PLN (Persero) UIW Papua dan Papua Barat. Susun KERANGKA ${jenis} menanggapi pemberitaan berikut:

${lines}
${b.catatan ? '\nCatatan dari humas: ' + String(b.catatan).slice(0, 500) + '\n' : ''}
ATURAN KETAT:
- Gunakan hanya fakta yang ada pada daftar berita di atas. DILARANG mengarang angka, penyebab gangguan, jadwal pemulihan, nama pejabat, atau kutipan.
- Setiap data yang belum diketahui tulis sebagai penanda [ISI: ...] supaya diisi dan diverifikasi manusia (mis. [ISI: penyebab gangguan], [ISI: estimasi pulih], [ISI: nama juru bicara]).
- Nada empatik, tidak defensif, tidak menyalahkan pihak lain, tidak menjanjikan hal yang tidak pasti.
- Bahasa Indonesia formal gaya humas BUMN. Panjang maksimal 220 kata (kecuali jenis WhatsApp).
Balas HANYA JSON: {"draft":"teks kerangka"}`;
  let lastError = null;
  for (let i = 0; i < KEYS.length; i++) {
    try {
      const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 8500);
      let r; try { r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${KEYS[i]}`, {
        signal: ctrl.signal, method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 1200, responseMimeType: 'application/json' } })
      }); } finally { clearTimeout(timer); }
      const data = await r.json();
      if (data.error) {
        lastError = data.error.message;
        if ((data.error.code === 429 || /quota/i.test(lastError || '')) && i < KEYS.length - 1) continue;
        return res.status(500).json({ error: 'Gemini API error', detail: lastError });
      }
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const m = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').match(/\{[\s\S]*\}/);
      if (!m) return res.status(500).json({ error: 'Format jawaban AI tidak terbaca' });
      return res.status(200).json(JSON.parse(m[0]));
    } catch (e) { lastError = e.name === 'AbortError' ? 'AI terlalu lama menjawab (timeout), coba lagi' : e.message; }
  }
  return res.status(500).json({ error: 'Gagal menyusun draft', detail: lastError });
}

// ===== MODE TEMA (laporan tematik): POST {mode:'theme-expand'|'theme-judge', tema, items?} =====
async function geminiJson(prompt, maxTokens, timeoutMs) {
  const KEYS = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '').split(',').map(k => k.trim()).filter(Boolean);
  if (!KEYS.length) throw new Error('Gemini API key not configured');
  let lastError = null;
  for (let i = 0; i < KEYS.length; i++) {
    try {
      const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let r; try { r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${KEYS[i]}`, {
        signal: ctrl.signal, method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, maxOutputTokens: maxTokens, responseMimeType: 'application/json' } })
      }); } finally { clearTimeout(timer); }
      const data = await r.json();
      if (data.error) { lastError = data.error.message; if ((data.error.code === 429 || /quota/i.test(lastError || '')) && i < KEYS.length - 1) continue; throw new Error(lastError); }
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const m = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').match(/\{[\s\S]*\}/);
      if (!m) throw new Error('Format jawaban AI tidak terbaca');
      return JSON.parse(m[0]);
    } catch (e) { lastError = e.name === 'AbortError' ? 'AI terlalu lama menjawab (timeout), coba lagi' : e.message; if (i === KEYS.length - 1) throw new Error(lastError); }
  }
  throw new Error(lastError || 'Gagal');
}
async function themeMode(req, res) {
  const b = req.body || {};
  const tema = String(b.tema || '').slice(0, 400).trim();
  if (!tema) return res.status(400).json({ error: 'Tema kosong' });
  try {
    if (b.mode === 'theme-expand') {
      const out = await geminiJson(`Kamu asisten pemantau media untuk humas PLN UIW Papua dan Papua Barat. Pengguna ingin laporan tematik dengan tema:
"${tema}"

Tugasmu menyiapkan kata penjaring berita. Balas HANYA JSON:
{"terms":[...],"place":[...],"queries":[...]}
- terms: 8 sampai 14 kata atau frasa pendek huruf kecil (bahasa Indonesia) yang kemungkinan muncul di judul atau ringkasan berita tentang POKOK tema (tanpa nama tempat), termasuk sinonim dan singkatan umum (mis. ebt, plts, kendaraan listrik, mobil listrik, motor listrik, spklu, kendaraan dinas). Jangan masukkan kata yang terlalu umum (mis. listrik saja, pln saja, pemerintah).
- place: nama tempat yang disebut pada tema (huruf kecil), mis. ["manokwari"]. Kosongkan [] jika tema tidak menyebut tempat.
- queries: 3 sampai 4 kueri pencarian berita pendek (2 sampai 4 kata), masing-masing memuat tempat dan satu aspek tema, mis. "mobil listrik manokwari".`, 900, 8500);
      const arr = x => (Array.isArray(x) ? x : []).map(s => String(s).toLowerCase().trim()).filter(s => s && s.length <= 40);
      return res.status(200).json({ terms: arr(out.terms).slice(0, 14), place: arr(out.place).slice(0, 4), queries: arr(out.queries).slice(0, 4) });
    }
    if (b.mode === 'theme-judge') {
      const items = Array.isArray(b.items) ? b.items.slice(0, 25) : [];
      if (!items.length) return res.status(200).json({ results: [] });
      const lines = items.map(a => `${a.i}. ${String(a.judul || '').slice(0, 200)} | ${String(a.media || '').slice(0, 40)}${a.ringkas ? ' | ' + String(a.ringkas).slice(0, 220) : ''}`).join('\n');
      const out = await geminiJson(`Kamu penyaring relevansi berita untuk laporan tematik humas PLN. TEMA LAPORAN: "${tema}"

Nilai tiap berita di bawah apakah relevan dengan tema tersebut, termasuk tempat yang disebut pada tema.
- "ya": pokok bahasan berita langsung tentang tema, di tempat yang dimaksud.
- "sebagian": hanya menyinggung tema, atau tema berdekatan (mis. energi terbarukan di daerah lain yang dikaitkan, atau tempat benar tetapi pokok bahasan hanya sebagian).
- "tidak": hanya kebetulan memuat kata yang sama, atau tempat/isinya berbeda dari tema.
Jangan menebak di luar judul dan ringkasan yang diberikan. Bila ragu antara "ya" dan "sebagian", pilih "sebagian".

BERITA:
${lines}

Balas HANYA JSON: {"results":[{"i":<nomor>,"v":"ya|sebagian|tidak","alasan":"maks 12 kata"}]}`, 2500, 9000);
      const ok = { ya: 1, sebagian: 1, tidak: 1 };
      const results = (Array.isArray(out.results) ? out.results : []).filter(r => r && ok[r.v]).map(r => ({ i: r.i, v: r.v, alasan: String(r.alasan || '').slice(0, 120) }));
      return res.status(200).json({ results });
    }
    return res.status(400).json({ error: 'Mode tidak dikenal' });
  } catch (e) { return res.status(500).json({ error: e.message }); }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (req.body && req.body.mode === 'report') return reportMode(req, res);
  if (req.body && req.body.mode === 'draft') return draftMode(req, res);
  if (req.body && (req.body.mode === 'theme-expand' || req.body.mode === 'theme-judge')) return themeMode(req, res);

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
