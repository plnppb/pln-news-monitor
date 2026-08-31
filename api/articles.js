const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const GEMINI_KEYS = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '')
  .split(',').map(k => k.trim()).filter(Boolean);

const TONE_PROMPT = `Kamu adalah analis media senior untuk PT PLN (Persero) UIW Papua & Papua Barat. Tugasmu menganalisis artikel berita dan menentukan tonalitas dari sudut pandang citra PLN UIW Papua & Papua Barat.

## PANDUAN TONALITAS

### NEGATIF — artikel yang menyudutkan, mengkritik, atau merugikan citra PLN:
- Keluhan warga/pelanggan terhadap PLN (pemadaman, tagihan, pelayanan buruk)
- Kritik dari legislatif/DPR/DPRD/pemerintah daerah terhadap PLN (kata: "soroti", "desak", "pertanyakan", "minta penjelasan", "tegur")
- Gangguan/kerusakan sistem kelistrikan yang merugikan masyarakat (kata: "padam", "mati lampu", "gangguan listrik", "byar pet", "keluhkan", "protes", "tuntut")
- Kecelakaan/insiden terkait infrastruktur PLN
- Berita tarif listrik naik yang menimbulkan keresahan

### POSITIF — pencapaian yang BENAR-BENAR signifikan/terukur (bukan sekadar pengumuman rutin):
- Elektrifikasi wilayah yang SEBELUMNYA belum teraliri listrik (bukan sekadar penambahan kapasitas rutin)
- Penghargaan/apresiasi dari pihak EKSTERNAL INDEPENDEN (bukan klaim keberhasilan dari PLN sendiri)
- Penurunan gangguan dengan angka konkret yang signifikan
- Kolaborasi/MoU besar di mana PLN benar-benar inisiator dengan dampak nyata
- Inovasi yang benar-benar baru dan berdampak (EBT, SPKLU, elektrifikasi 3T skala besar)

### NETRAL — artikel informatif tanpa tendensi positif/negatif yang kuat:
- Pernyataan komitmen PLN tanpa bukti pencapaian konkret
- Kegiatan rutin PLN (rapat, sosialisasi, kunjungan kerja)
- Permintaan/harapan pihak lain ke PLN tanpa nada tekanan (kata: "harap", "minta", "diminta" dengan nada biasa)
- Pemeliharaan jaringan terencana yang diinformasikan dengan baik
- Berita kebijakan energi nasional yang menyebut PLN secara umum
- Profil/wawancara pejabat PLN tanpa isu spesifik
- **Siaran pers promosi rutin dari PLN sendiri** (perpanjangan promo yang sudah berjalan, edukasi/sosialisasi rutin, laporan capaian rutin) — INI TETAP NETRAL meskipun teksnya memakai kata "berhasil"/"capai"/"sukses"/"apresiasi". Kata-kata itu adalah gaya bahasa PR standar, BUKAN indikator otomatis bahwa ini pencapaian luar biasa. Nilai dari SUBSTANSI dampaknya, bukan dari pilihan katanya. Kalau ragu antara POSITIF dan NETRAL untuk siaran pers rutin PLN, pilih NETRAL.

## KASUS KHUSUS KATA "PEMADAMAN":
- "Warga keluhkan pemadaman" / "pemadaman bergilir bikin resah" → NEGATIF
- "PLN berhasil kurangi durasi pemadaman X persen" / "pemadaman turun" → POSITIF
- "PLN jadwalkan pemadaman untuk pemeliharaan" → NETRAL

## KASUS KHUSUS KATA "SOROTI":
- "DPR soroti kelistrikan Papua" / "DPRD soroti PLN" → NEGATIF (tekanan legislatif)
- "Publik soroti kinerja PLN" → NEGATIF

## KASUS KHUSUS MoU/KOLABORASI:
- "PLN teken MoU" / "PLN gandeng X" (PLN sebagai inisiator) → POSITIF
- "PLN diminta teken MoU" / "X minta PLN kerja sama" → NETRAL

## PENTING SOAL SPOKESPERSON
Field "tone" di atas menilai artikel SECARA KESELURUHAN, BUKAN sikap orang yang dikutip. Kalau ada narasumber (spokesperson) yang dikutip, nilai TERPISAH bagaimana SIKAP/PERNYATAAN orang itu sendiri di dalam kutipannya — apakah pernyataannya sendiri terdengar membela/positif, mengkritik/negatif, atau sekadar informatif/netral. Ini WAJIB dinilai independen dari tone keseluruhan artikel.
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

## FORMAT RESPONS (JSON saja, tanpa teks lain, tanpa markdown):
{
  "tone": "positif" | "negatif" | "netral",
  "spokesperson_internal": "Nama|Jabatan (kosongkan jika tidak ada nama spesifik, pisah pakai ; jika lebih dari satu orang)",
  "spokesperson_internal_stance": "positif" | "negatif" | "netral" | "" (sikap pernyataan spokesperson internal itu sendiri, bukan tone artikel),
  "spokesperson_eksternal": "Nama|Jabatan (kosongkan jika tidak ada nama spesifik, pisah pakai ; jika lebih dari satu orang)",
  "spokesperson_eksternal_stance": "positif" | "negatif" | "netral" | "" (sikap pernyataan spokesperson eksternal itu sendiri, bukan tone artikel),
  "resume": "Ringkasan 2-3 kalimat dalam Bahasa Indonesia yang menjelaskan isi berita secara objektif"
}`;

async function analyzeArticle(title, description) {
  if (!GEMINI_KEYS.length) return { error: 'NO_API_KEY' };
  const prompt = `${TONE_PROMPT}

## ARTIKEL YANG DIANALISIS:
Judul: ${title}
Deskripsi: ${(description || '').replace(/<[^>]+>/g, '').substring(0, 400)}

Berikan analisis dalam format JSON:`;

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
        if (isQuota && i < GEMINI_KEYS.length - 1) continue;
        return { error: data.error.message };
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const jsonMatch = clean.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { error: 'NO_JSON' };

      const result = JSON.parse(jsonMatch[0]);
      if (!['positif', 'negatif', 'netral'].includes(result.tone)) result.tone = 'netral';
      return result;
    } catch (e) {
      lastError = e.message;
      continue;
    }
  }
  return { error: `Semua ${GEMINI_KEYS.length} API key gagal/kehabisan kuota. Error terakhir: ${lastError}` };
}

// ===== POST mode=check: cek batch URL mana yang sudah ada di database =====
async function handleCheck(req, res) {
  const { urls } = req.body || {};
  if (!urls || !Array.isArray(urls) || !urls.length) {
    return res.status(400).json({ error: 'urls (array) wajib diisi' });
  }
  try {
    const existing = new Set();
    const chunkSize = 50;
    for (let i = 0; i < urls.length; i += chunkSize) {
      const chunk = urls.slice(i, i + chunkSize);
      const list = chunk.map(u => `"${u.replace(/"/g, '\\"')}"`).join(',');
      const filterValue = `in.(${list})`;
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/articles?select=url&url=${encodeURIComponent(filterValue)}`,
        { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } }
      );
      const data = await resp.json();
      if (Array.isArray(data)) data.forEach(row => existing.add(row.url));
    }
    return res.status(200).json({ existing: Array.from(existing) });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// ===== POST mode=save: simpan satu artikel manual dari hasil pencarian kustom =====
async function handleSave(req, res) {
  const secret = req.headers['x-cron-secret'] || req.body?.secret;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { title, url, source, published_at, description } = req.body || {};
  if (!title || !url) {
    return res.status(400).json({ error: 'title dan url wajib diisi' });
  }

  try {
    const existing = await fetch(
      `${SUPABASE_URL}/rest/v1/articles?select=id&url=eq.${encodeURIComponent(url)}`,
      { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } }
    ).then(r => r.json());

    if (Array.isArray(existing) && existing.length > 0) {
      return res.status(200).json({ success: true, alreadyExists: true });
    }

    const analysis = await analyzeArticle(title, description);

    const row = {
      title,
      url,
      source: source || 'Manual',
      published_at: published_at || new Date().toISOString(),
      description: description || '',
      keyword: 'manual-add',
      tone: analysis.error ? '' : (analysis.tone || 'netral'),
      resume: analysis.error ? '' : (analysis.resume || ''),
      spokesperson_internal: analysis.error ? '' : (analysis.spokesperson_internal || ''),
      spokesperson_internal_stance: analysis.error ? '' : (analysis.spokesperson_internal_stance || ''),
      spokesperson_eksternal: analysis.error ? '' : (analysis.spokesperson_eksternal || ''),
      spokesperson_eksternal_stance: analysis.error ? '' : (analysis.spokesperson_eksternal_stance || '')
    };

    const response = await fetch(`${SUPABASE_URL}/rest/v1/articles?on_conflict=url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'resolution=ignore-duplicates,return=representation'
      },
      body: JSON.stringify([row])
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: errText });
    }

    return res.status(200).json({ success: true, saved: true, analysisFailed: !!analysis.error });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// ===== GET: baca daftar artikel (perilaku asli, tidak berubah) =====
async function handleList(req, res) {
  const { keyword, source, from, to, created_from, created_to, limit = 500, offset = 0 } = req.query;
  let url = `${SUPABASE_URL}/rest/v1/articles?select=*&order=published_at.desc&limit=${limit}&offset=${offset}`;
  if (keyword) url += `&keyword=eq.${encodeURIComponent(keyword)}`;
  if (source) url += `&source=ilike.${encodeURIComponent('%' + source + '%')}`;
  if (from) url += `&published_at=gte.${from}`;
  if (to) url += `&published_at=lte.${to}`;
  if (created_from) url += `&created_at=gte.${created_from}`;
  if (created_to) url += `&created_at=lte.${created_to}`;
  try {
    const response = await fetch(url, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Range-Unit': 'items',
        'Prefer': 'count=exact'
      }
    });
    const data = await response.json();
    const count = response.headers.get('content-range')?.split('/')[1] || data.length;
    return res.status(200).json({ articles: data, total: parseInt(count) || data.length });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// ===== GET ?resource=followups: baca semua tiket tindak lanjut =====
async function handleListFollowups(req, res) {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/followups?select=*&order=created_at.desc`,
      { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    const data = await response.json();
    return res.status(200).json({ followups: data });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// ===== POST mode=pin: jadikan satu artikel tiket tindak lanjut baru =====
async function handlePin(req, res) {
  const { article_url, article_title, article_source, article_published_at } = req.body || {};
  if (!article_url || !article_title) {
    return res.status(400).json({ error: 'article_url dan article_title wajib diisi' });
  }
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/followups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'resolution=ignore-duplicates,return=representation'
      },
      body: JSON.stringify([{
        article_url, article_title, article_source, article_published_at,
        articles: [{ url: article_url, title: article_title, source: article_source, published_at: article_published_at }]
      }])
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: JSON.stringify(data) });
    return res.status(200).json({ success: true, followup: data[0] || null, alreadyExists: !data.length });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// ===== POST mode=merge-followups: gabung 2 tiket jadi satu (misal beberapa media
// muat berita yang sama tentang satu kejadian) =====
async function handleMergeFollowups(req, res) {
  const { sourceId, targetId } = req.body || {};
  if (!sourceId || !targetId || sourceId === targetId) {
    return res.status(400).json({ error: 'sourceId dan targetId (harus berbeda) wajib diisi' });
  }
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/followups?id=in.(${sourceId},${targetId})&select=*`, {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
    });
    const rows = await resp.json();
    const source = rows.find(r => String(r.id) === String(sourceId));
    const target = rows.find(r => String(r.id) === String(targetId));
    if (!source || !target) return res.status(404).json({ error: 'Salah satu tiket tidak ditemukan' });

    const seen = new Set();
    const mergedArticles = [...(target.articles || []), ...(source.articles || [])].filter(a => {
      if (!a?.url || seen.has(a.url)) return false;
      seen.add(a.url);
      return true;
    });
    const mergedNotes = [...(target.notes || []), ...(source.notes || [])]
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const updResp = await fetch(`${SUPABASE_URL}/rest/v1/followups?id=eq.${targetId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ articles: mergedArticles, notes: mergedNotes, updated_at: new Date().toISOString() })
    });
    const updData = await updResp.json();
    if (!updResp.ok) return res.status(updResp.status).json({ error: JSON.stringify(updData) });

    await fetch(`${SUPABASE_URL}/rest/v1/followups?id=eq.${sourceId}`, {
      method: 'DELETE',
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
    });

    return res.status(200).json({ success: true, followup: updData[0] });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// ===== POST mode=unpin: hapus tiket tindak lanjut =====
async function handleUnpin(req, res) {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id wajib diisi' });
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/followups?id=eq.${id}`, {
      method: 'DELETE',
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
    });
    if (!response.ok) return res.status(response.status).json({ error: await response.text() });
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// ===== POST mode=update-status: ubah status Kanban =====
async function handleUpdateStatus(req, res) {
  const { id, status } = req.body || {};
  if (!id || !['baru', 'proses', 'selesai'].includes(status)) {
    return res.status(400).json({ error: 'id dan status (baru/proses/selesai) wajib diisi' });
  }
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/followups?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ status, updated_at: new Date().toISOString() })
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: JSON.stringify(data) });
    return res.status(200).json({ success: true, followup: data[0] });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// ===== POST mode=add-note: tambah satu catatan ke log kronologis =====
async function handleAddNote(req, res) {
  const { id, note } = req.body || {};
  if (!id || !note) return res.status(400).json({ error: 'id dan note wajib diisi' });
  try {
    const existing = await fetch(
      `${SUPABASE_URL}/rest/v1/followups?id=eq.${id}&select=notes`,
      { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } }
    ).then(r => r.json());

    if (!Array.isArray(existing) || !existing.length) {
      return res.status(404).json({ error: 'Tiket tidak ditemukan' });
    }

    const notes = existing[0].notes || [];
    notes.push({ text: note, created_at: new Date().toISOString() });

    const response = await fetch(`${SUPABASE_URL}/rest/v1/followups?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ notes, updated_at: new Date().toISOString() })
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: JSON.stringify(data) });
    return res.status(200).json({ success: true, followup: data[0] });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// ===== GET ?resource=radar: baca berita radar Papua =====
async function handleListRadar(req, res) {
  const { limit = 200, offset = 0 } = req.query;
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/papua_radar?select=*&order=published_at.desc&limit=${limit}&offset=${offset}`,
      { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Prefer': 'count=exact' } }
    );
    const data = await response.json();
    const count = response.headers.get('content-range')?.split('/')[1] || data.length;
    return res.status(200).json({ articles: data, total: parseInt(count) || data.length });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// ===== POST mode=update-tone: koreksi manual tone (kalau AI salah nilai) =====
async function handleUpdateTone(req, res) {
  const { url, tone } = req.body || {};
  if (!url || !['positif', 'negatif', 'netral'].includes(tone)) {
    return res.status(400).json({ error: 'url dan tone (positif/negatif/netral) wajib diisi' });
  }
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/articles?url=eq.${encodeURIComponent(url)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ tone })
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: JSON.stringify(data) });
    if (!data.length) return res.status(404).json({ error: 'Artikel tidak ditemukan' });
    return res.status(200).json({ success: true, article: data[0] });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// ===== POST mode=clear-spokesperson: hapus nama spokesperson yang salah/hasil karangan AI =====
async function handleClearSpokesperson(req, res) {
  const { url, type } = req.body || {};
  if (!url || !['internal', 'eksternal'].includes(type)) {
    return res.status(400).json({ error: 'url dan type (internal/eksternal) wajib diisi' });
  }
  const patch = type === 'internal'
    ? { spokesperson_internal: '', spokesperson_internal_stance: '' }
    : { spokesperson_eksternal: '', spokesperson_eksternal_stance: '' };
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/articles?url=eq.${encodeURIComponent(url)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(patch)
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: JSON.stringify(data) });
    if (!data.length) return res.status(404).json({ error: 'Artikel tidak ditemukan' });
    return res.status(200).json({ success: true, article: data[0] });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    if (req.query.resource === 'followups') return handleListFollowups(req, res);
    if (req.query.resource === 'radar') return handleListRadar(req, res);
    return handleList(req, res);
  }

  if (req.method === 'POST') {
    const mode = req.body?.mode;
    if (mode === 'check') return handleCheck(req, res);
    if (mode === 'save') return handleSave(req, res);
    if (mode === 'pin') return handlePin(req, res);
    if (mode === 'unpin') return handleUnpin(req, res);
    if (mode === 'update-status') return handleUpdateStatus(req, res);
    if (mode === 'add-note') return handleAddNote(req, res);
    if (mode === 'merge-followups') return handleMergeFollowups(req, res);
    if (mode === 'update-tone') return handleUpdateTone(req, res);
    if (mode === 'clear-spokesperson') return handleClearSpokesperson(req, res);
    return res.status(400).json({ error: 'mode tidak dikenal' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
