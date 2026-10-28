const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
// Bisa lebih dari satu key, dipisah koma, dari akun Google berbeda-beda
// (kuota Gemini diikat ke project Google, bukan ke key — jadi key dari
// akun/project berbeda beneran punya kuota terpisah).
const TAX = require('../lib/taxonomy');
const FF = require('../lib/feedfind');
const TEXT_LIMIT = 800; // batas teks ke AI (naik dari 400 supaya lokasi di paragraf awal terbaca)
const GEMINI_KEYS = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '')
  .split(',').map(k => k.trim()).filter(Boolean);

const TONE_PROMPT = `Kamu adalah analis media senior untuk PT PLN (Persero) UIW Papua & Papua Barat. Tugasmu menganalisis artikel berita dan menentukan tonalitas dari sudut pandang citra PLN UIW Papua & Papua Barat.

PANDUAN TONALITAS (untuk field "tone" — ini menilai KESELURUHAN artikel):
NEGATIF: keluhan warga, kritik DPR/DPRD (kata: soroti, desak, tegur), gangguan listrik (kata: padam, mati lampu, keluhkan, protes), kecelakaan PLN, tarif naik yang meresahkan.
POSITIF: pencapaian yang BENAR-BENAR signifikan/terukur — elektrifikasi wilayah yang sebelumnya belum teraliri listrik, penghargaan dari pihak eksternal independen (bukan klaim PLN sendiri), penurunan gangguan dengan angka konkret yang jelas, kolaborasi besar di mana PLN inisiator nyata.
NETRAL: komitmen tanpa bukti, kegiatan rutin, permintaan biasa, pemeliharaan terencana, berita kebijakan umum, DAN siaran pers promosi rutin PLN sendiri (perpanjangan promo, edukasi/sosialisasi rutin, kunjungan kerja, laporan capaian rutin) — meskipun teksnya pakai kata "berhasil"/"capai"/"sukses", itu TETAP NETRAL kalau isinya cuma pengumuman rutin, bukan pencapaian luar biasa.

PENTING SOAL BIAS: banyak artikel berasal dari siaran pers PLN sendiri yang rutin pakai kata "berhasil"/"capai"/"sukses" untuk kegiatan biasa. JANGAN otomatis menilai POSITIF hanya karena ada kata-kata itu — nilai dari SUBSTANSI dampaknya, bukan dari pilihan katanya. Kalau ragu antara POSITIF dan NETRAL untuk siaran pers rutin PLN, pilih NETRAL.

KASUS KHUSUS:
- Kebakaran/korsleting di instalasi milik warga atau bangunan (bukan jaringan PLN), PLN tidak disebut atau tidak disalahkan = NETRAL. NEGATIF hanya jika aset/jaringan PLN (tiang, kabel, trafo, gardu) terlibat, PLN disalahkan, atau ada korban sengatan dari jaringan PLN. Kata "korsleting"/"listrik" saja bukan dasar NEGATIF.
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

${TAX.buildPromptSection()}

Balas HANYA JSON ini tanpa teks lain:
{"tone":"netral","kategori":"gangguan","kategori_sekunder":"","lokasi":"","cakupan":"","spokesperson_internal":"","spokesperson_internal_stance":"","spokesperson_eksternal":"","spokesperson_eksternal_stance":"","resume":"ringkasan 2-3 kalimat"}`;

// Cek apakah nama beneran ada di teks sumber — jaring pengaman kode, bukan
// andalin AI patuh instruksi doang, soalnya AI kadang "nyampur" teks yang
// dikasih dengan pengetahuan lamanya dari data training (makanya bisa nongol
// nama pejabat yang udah pensiun, padahal nggak disebut di artikelnya).
//
// Dicek sebagai SATU FRASA UTUH (nama depan+belakang berurutan persis),
// BUKAN kata-kata yang dicek terpisah-pisah — versi lama cuma cek "tiap kata
// dari nama ada DI MANA SAJA di teks", jadi kalau teks nyebut dua orang
// berbeda ("...Bambang menyampaikan..." di satu kalimat, "...Pak Suharto
// hadir..." di kalimat lain), AI yang "menggabungkan" jadi nama fiktif
// "Bambang Suharto" akan tetap LOLOS validasi lama. Dicek sebagai frasa utuh
// menutup celah ini.
function normalizeForMatch(s) {
  return (s || '').toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
}

function nameAppearsInSource(name, sourceTextNormalized) {
  const normalizedName = normalizeForMatch(name);
  const words = normalizedName.split(' ').filter(Boolean);
  // Nama orang minimal 2 suku kata (nama depan+belakang/inisial) — satu
  // kata doang gampang "kebetulan cocok" dengan kata lain di teks.
  if (words.length < 2) return false;
  return sourceTextNormalized.includes(normalizedName);
}

// Saring field spokesperson (format "Nama|Jabatan;Nama2|Jabatan2"), buang
// entri yang namanya nggak ketemu di teks sumber sama sekali.
function validateSpokespersonField(raw, sourceTextNormalized) {
  if (!raw) return '';
  const entries = raw.split(';').map(s => s.trim()).filter(Boolean);
  const valid = entries.filter(entry => {
    const name = entry.includes('|') ? entry.split('|')[0].trim() : entry.trim();
    return nameAppearsInSource(name, sourceTextNormalized);
  });
  return valid.join(';');
}

async function analyzeArticle(title, description) {
  if (!GEMINI_KEYS.length) return { error: 'NO_API_KEY' };
  // PENTING: potong deskripsi SEKALI, pakai hasil yang sama persis baik buat
  // prompt ke Gemini maupun buat validasi nama nanti. Sebelumnya validasi
  // pakai description PENUH (tidak dipotong) sementara Gemini cuma dikasih
  // 400 karakter pertama — jadi nama asli yang nongol di bagian artikel yang
  // Gemini sendiri NGGAK PERNAH BACA bisa ikut "tervalidasi" padahal
  // kecocokannya kebetulan/tidak terkait sama sekali dengan apa yang dibaca AI.
  const truncatedDescription = (description || '').replace(/<[^>]+>/g, '').substring(0, TEXT_LIMIT);
  const prompt = `${TONE_PROMPT}\n\nJudul: ${title}\nDeskripsi: ${truncatedDescription}`;

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
            generationConfig: { temperature: 0.1, maxOutputTokens: 800 }
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

      // Validasi: buang nama spokesperson yang nggak ketemu di teks YANG
      // SAMA PERSIS dibaca Gemini (truncatedDescription, bukan description penuh)
      const sourceTextNormalized = normalizeForMatch(title + ' ' + truncatedDescription);
      result.spokesperson_internal = validateSpokespersonField(result.spokesperson_internal, sourceTextNormalized);
      if (!result.spokesperson_internal) result.spokesperson_internal_stance = '';
      result.spokesperson_eksternal = validateSpokespersonField(result.spokesperson_eksternal, sourceTextNormalized);
      if (!result.spokesperson_eksternal) result.spokesperson_eksternal_stance = '';
      // Tone komentar yang tidak diisi AI: samakan dengan tone pemberitaan (bisa diubah manual)
      if (result.spokesperson_internal && !result.spokesperson_internal_stance) result.spokesperson_internal_stance = result.tone;
      if (result.spokesperson_eksternal && !result.spokesperson_eksternal_stance) result.spokesperson_eksternal_stance = result.tone;

      Object.assign(result, TAX.validateClassification(result, title + ' ' + truncatedDescription));
      return result;
    } catch (e) {
      lastError = e.message;
      continue; // exception jaringan, coba key berikutnya juga
    }
  }
  return { error: `Semua ${GEMINI_KEYS.length} API key gagal/kehabisan kuota. Error terakhir: ${lastError}` };
}


// ===== MODE ISI NARASUMBER (?mode=spk) =====
// RSS cuma membawa judul + cuplikan pendek, sedangkan kutipan narasumber biasanya
// ada di paragraf tengah artikel. Mode ini membuka halaman beritanya, membaca isi
// lengkap, lalu minta AI mengisi HANYA kolom narasumber. Nama diprioritaskan dari
// daftar yang sudah ada di database (ejaan + jabatan konsisten); nama baru boleh
// masuk asal tertulis kata per kata di isi berita (validasi kode, anti-halusinasi).
// Berita yang sudah punya narasumber, atau dikunci (manual_locked), tidak disentuh.
async function loadKnownSpeakers() {
  const headers = { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` };
  const map = new Map(); // nama -> {title(jabatan terbanyak)}
  for (let off = 0; off < 5000; off += 1000) {
    let rows = [];
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/articles?select=spokesperson_internal,spokesperson_eksternal&or=(spokesperson_internal.neq.,spokesperson_eksternal.neq.)&order=id.asc&limit=1000&offset=${off}`, { headers });
      rows = await r.json();
    } catch (e) { break; }
    if (!Array.isArray(rows) || !rows.length) break;
    rows.forEach(row => [row.spokesperson_internal, row.spokesperson_eksternal].forEach(f => {
      (f || '').split(';').forEach(e => {
        const [n, j] = e.split('|').map(x => (x || '').trim());
        if (!n || n.split(' ').length < 2) return;
        const o = map.get(n) || { jab: {} };
        if (j) o.jab[j] = (o.jab[j] || 0) + 1;
        map.set(n, o);
      });
    }));
    if (rows.length < 1000) break;
  }
  return [...map.entries()].map(([name, o]) => {
    const jab = Object.entries(o.jab).sort((a, b) => b[1] - a[1])[0];
    return { name, jab: jab ? jab[0] : '' };
  });
}

async function geminiJson(prompt) {
  if (!GEMINI_KEYS.length) return { error: 'NO_API_KEY' };
  let lastError = null;
  for (let i = 0; i < GEMINI_KEYS.length; i++) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GEMINI_KEYS[i]}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 600 } }) });
      const data = await response.json();
      if (data.error) {
        lastError = data.error.message;
        if ((data.error.code === 429 || /quota/i.test(lastError || '')) && i < GEMINI_KEYS.length - 1) continue;
        return { error: lastError, code: data.error.code };
      }
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const m = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').match(/\{[\s\S]*\}/);
      if (!m) return { error: 'NO_JSON' };
      return { json: JSON.parse(m[0]) };
    } catch (e) { lastError = e.message; }
  }
  return { error: lastError || 'gagal' };
}

async function spkFromFullText(article, known) {
  const url = article.url || '';
  if (!/^https?:\/\//i.test(url)) return { skip: 'link tidak valid' };
  if (/news\.google\.com/i.test(url)) return { skip: 'link Google News (isi tidak bisa dibuka)' };
  const page = await FF.fetchText(url, { timeout: 4500, maxBytes: 900000 });
  if (!page.ok) return { skip: 'halaman tidak bisa dibuka (' + (page.error || 'HTTP ' + page.status) + ')' };
  const body = FF.extractBodyText(page.body, 7000);
  if (body.length < 300) return { skip: 'isi berita tidak terbaca' };
  const text = (article.title + '\n' + body);
  const norm = normalizeForMatch(text);
  const hints = known.filter(k => nameAppearsInSource(k.name, norm)).slice(0, 12);
  const hintTxt = hints.length
    ? 'DAFTAR NAMA YANG SUDAH TERCATAT (pakai ejaan dan jabatan ini bila orangnya memang dikutip di teks):\n' + hints.map(h => '- ' + h.name + '|' + h.jab).join('\n') + '\n\n'
    : '';
  const prompt = `Kamu membantu humas PT PLN (Persero) UIW Papua & Papua Barat mencatat narasumber berita.
Dari teks berita di bawah, catat orang yang DIKUTIP atau disebut menyampaikan pernyataan.
- spokesperson_internal: orang dari PLN (PLN UIW PPB, PLN UID/UP3/ULP, PLN Pusat, anak usaha PLN).
- spokesperson_eksternal: orang di luar PLN (pejabat pemerintah, DPR/DPRD, warga, pihak lain).
Aturan:
1. Hanya nama orang spesifik (minimal dua kata). Jabatan/kolektif tanpa nama ("pihak PLN") JANGAN dicatat.
2. Nama WAJIB tertulis kata per kata di teks. JANGAN mengarang atau menebak. Kalau ragu, kosongkan.
3. Format "Nama Lengkap|Jabatan". Beberapa orang dipisah titik-koma (;). Jangan gabung dua nama dengan "dan".
4. Jabatan sesuai teks artikel ini; kalau teks tidak menyebut jabatan tapi orangnya ada di daftar tercatat, pakai jabatan dari daftar.
5. Stance = sikap pernyataan orang itu sendiri (positif/negatif/netral), bukan tone artikel.
${hintTxt}Judul: ${article.title}
Isi berita:
${body}

Balas HANYA JSON: {"spokesperson_internal":"","spokesperson_internal_stance":"","spokesperson_eksternal":"","spokesperson_eksternal_stance":""}`;
  const g = await geminiJson(prompt);
  if (g.error) return { error: g.error, code: g.code };
  const r = g.json;
  const out = {
    spokesperson_internal: validateSpokespersonField(r.spokesperson_internal, norm),
    spokesperson_eksternal: validateSpokespersonField(r.spokesperson_eksternal, norm)
  };
  const okTone = x => ['positif', 'negatif', 'netral'].includes(x) ? x : 'netral';
  out.spokesperson_internal_stance = out.spokesperson_internal ? okTone(r.spokesperson_internal_stance) : '';
  out.spokesperson_eksternal_stance = out.spokesperson_eksternal ? okTone(r.spokesperson_eksternal_stance) : '';
  return { out };
}

// Artikel yang sudah diedit manual (manual_locked = true) TIDAK ikut dianalisis
// ulang, supaya hasil edit (narasumber, tone) tidak ditimpa AI. Kalau kolom
// manual_locked belum dibuat di DB, jatuh balik ke query tanpa filter.
async function fetchArticlesSkippingLocked(url) {
  const headers = { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` };
  let response = await fetch(url + '&manual_locked=eq.false', { headers });
  if (!response.ok) response = await fetch(url, { headers });
  return response;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  const batchSize = parseInt(req.query.batch) || 2;
  const reanalyze = req.query.reanalyze === 'true';
  const offset = parseInt(req.query.offset) || 0;
  // ?days=30 : hanya proses artikel yang TANGGAL TAYANGNYA (published_at) dalam N hari terakhir.
  // Tanpa parameter ini = semua artikel (perilaku lama).
  const days = parseInt(req.query.days) || 0;
  const dateFilter = days > 0 ? `&published_at=gte.${new Date(Date.now() - days * 86400000).toISOString()}` : '';

  // MODE REVALIDASI (?mode=revalidate): bersihkan nama spokesperson yang
  // SUDAH TERSIMPAN dari dulu, tanpa panggil Gemini sama sekali — murni
  // jalankan ulang validator kode (yang sekarang sudah dibenerin: cek nama
  // sebagai frasa utuh + terhadap teks yang sama persis dibaca Gemini dulu,
  // 400 karakter pertama deskripsi) terhadap data yang udah ada di DB.
  // Ini jauh lebih cepat & gratis dibanding reanalyze=true (yang manggil
  // Gemini ulang buat SEMUA artikel) — pas buat bersih-bersih data lama,
  // termasuk yang kesimpan lewat /api/analyze (jalur "Cari Berita" manual)
  // yang sebelumnya sama sekali nggak divalidasi.
  if (req.query.mode === 'revalidate') {
    try {
      const url = `${SUPABASE_URL}/rest/v1/articles?select=id,title,description,spokesperson_internal,spokesperson_eksternal&or=(spokesperson_internal.neq.,spokesperson_eksternal.neq.)${dateFilter}&limit=${batchSize}&offset=${offset}&order=id.asc`;
      const response = await fetchArticlesSkippingLocked(url);
      const articles = await response.json();

      if (!Array.isArray(articles) || !articles.length) {
        return res.status(200).json({ success: true, message: 'Semua artikel ber-spokesperson sudah dicek ulang', processed: 0, cleaned: 0 });
      }

      let processed = 0, cleaned = 0;
      const examples = [];

      for (const article of articles) {
        processed++;
        const truncatedDescription = (article.description || '').replace(/<[^>]+>/g, '').substring(0, TEXT_LIMIT);
        const sourceTextNormalized = normalizeForMatch(article.title + ' ' + truncatedDescription);

        const beforeInternal = article.spokesperson_internal || '';
        const beforeEksternal = article.spokesperson_eksternal || '';
        const afterInternal = validateSpokespersonField(beforeInternal, sourceTextNormalized);
        const afterEksternal = validateSpokespersonField(beforeEksternal, sourceTextNormalized);

        if (afterInternal === beforeInternal && afterEksternal === beforeEksternal) continue;

        const patchBody = {
          spokesperson_internal: afterInternal,
          spokesperson_eksternal: afterEksternal
        };
        if (!afterInternal) patchBody.spokesperson_internal_stance = '';
        if (!afterEksternal) patchBody.spokesperson_eksternal_stance = '';

        const patchResp = await fetch(`${SUPABASE_URL}/rest/v1/articles?id=eq.${article.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
          },
          body: JSON.stringify(patchBody)
        });

        if (patchResp.ok) {
          cleaned++;
          if (examples.length < 10) {
            examples.push({
              id: article.id,
              title: article.title,
              internal: { sebelum: beforeInternal, sesudah: afterInternal },
              eksternal: { sebelum: beforeEksternal, sesudah: afterEksternal }
            });
          }
        }
      }

      const nextOffset = offset + batchSize;
      return res.status(200).json({
        success: true, filterDays: days, processed, cleaned, examples, nextOffset,
        note: articles.length < batchSize ? 'Selesai' : `Masih ada, panggil lagi dengan offset=${nextOffset}`
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // MODE KLASIFIKASI (?mode=classify): isi HANYA kategori isu + lokasi untuk artikel
  // yang belum punya kategori — termasuk artikel yang sudah dikunci (🔒), karena
  // tone/narasumber/hasil edit manual TIDAK disentuh sama sekali (hanya 4 kolom
  // klasifikasi yang ditulis, dan artikel tidak ikut dikunci). Artikel yang
  // kategorinya sudah terisi (AI maupun manual) dilewati. Panggil berulang
  // sampai 'Selesai'; ?batch= default 2 (batas 10 detik Vercel).
  if (req.query.mode === 'classify') {
    try {
      const url = `${SUPABASE_URL}/rest/v1/articles?select=id,title,description&or=(category.is.null,category.eq.)${dateFilter}&limit=${batchSize}&offset=${offset}&order=id.asc`;
      const response = await fetch(url, { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } });
      const articles = await response.json();
      if (!response.ok) {
        return res.status(500).json({ error: JSON.stringify(articles), hint: 'Kolom category belum ada? Jalankan add-category-location-columns.sql di Supabase dulu.' });
      }
      if (!Array.isArray(articles) || !articles.length) {
        return res.status(200).json({ success: true, filterDays: days, message: 'Semua artikel sudah punya kategori', processed: 0, failed: 0, remaining: 0 });
      }
      let processed = 0, failed = 0;
      const errors = [];
      const catCount = {};
      for (const article of articles) {
        const result = await analyzeArticle(article.title, article.description);
        if (result.error) { failed++; if (errors.length < 3) errors.push({ id: article.id, error: result.error }); continue; }
        const patchResp = await fetch(`${SUPABASE_URL}/rest/v1/articles?id=eq.${article.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
          body: JSON.stringify({
            category: result.category || 'lainnya',
            category_secondary: result.category_secondary || '',
            locations: result.locations || '',
            geo_scope: result.geo_scope || ''
          })
        });
        if (!patchResp.ok) { failed++; if (errors.length < 3) errors.push({ id: article.id, error: await patchResp.text() }); continue; }
        processed++;
        catCount[result.category] = (catCount[result.category] || 0) + 1;
      }
      // Artikel yang berhasil keluar dari filter; yang gagal tetap di sana, jadi offset cukup geser sebanyak yang gagal.
      const nextOffset = offset + failed;
      return res.status(200).json({
        success: true, filterDays: days, processed, failed, errors, catCount, nextOffset,
        note: articles.length < batchSize && !failed ? 'Selesai' : `Masih ada, panggil lagi dengan offset=${nextOffset}`
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // MODE ISI NARASUMBER dari isi berita lengkap (lihat komentar di atas)
  if (req.query.mode === 'spk') {
    try {
      const sel = 'id,title,url,spokesperson_internal,spokesperson_eksternal';
      const base = `${SUPABASE_URL}/rest/v1/articles?select=${sel}&hidden=eq.false&or=(spokesperson_internal.is.null,spokesperson_internal.eq.)&or=(spokesperson_eksternal.is.null,spokesperson_eksternal.eq.)${dateFilter}&limit=${batchSize}&offset=${offset}&order=id.asc`;
      const response = await fetchArticlesSkippingLocked(base);
      const arts = await response.json();
      if (!Array.isArray(arts)) return res.status(500).json({ error: 'Gagal membaca artikel', detail: arts });
      if (!arts.length) return res.status(200).json({ success: true, filterDays: days, message: 'Semua artikel sudah dicek', processed: 0 });
      const known = await loadKnownSpeakers();
      let filled = 0, skipped = 0, failed = 0, nothing = 0;
      const notes = [];
      for (const a of arts) {
        const r = await spkFromFullText(a, known);
        if (r.error) { failed++; if (notes.length < 3) notes.push({ id: a.id, error: r.error }); continue; }
        if (r.skip) { skipped++; if (notes.length < 3) notes.push({ id: a.id, skip: r.skip }); continue; }
        if (!r.out.spokesperson_internal && !r.out.spokesperson_eksternal) { nothing++; continue; }
        const pr = await fetch(`${SUPABASE_URL}/rest/v1/articles?id=eq.${a.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
          body: JSON.stringify(r.out)
        });
        if (pr.ok) filled++; else { failed++; if (notes.length < 3) notes.push({ id: a.id, error: 'simpan gagal ' + pr.status }); }
      }
      return res.status(200).json({ success: true, filterDays: days, filled, nothing, skipped, failed, notes, nextOffset: offset + (arts.length - filled), note: arts.length < batchSize ? 'Selesai' : undefined });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

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
      url = `${SUPABASE_URL}/rest/v1/articles?select=id,title,description${dateFilter}&limit=${batchSize}&offset=${offset}&order=id.asc`;
    } else {
      url = `${SUPABASE_URL}/rest/v1/articles?select=id,title,description&or=(tone.is.null,tone.eq.)${dateFilter}&limit=${batchSize}&offset=${offset}&order=id.asc`;
    }

    const response = await fetchArticlesSkippingLocked(url);
    const articles = await response.json();

    if (!Array.isArray(articles) || !articles.length) {
      return res.status(200).json({ success: true, filterDays: days, message: 'Semua artikel sudah dianalisis', processed: 0 });
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

      const fullBody = {
        tone: result.tone,
        resume: result.resume || '',
        spokesperson_internal: result.spokesperson_internal || '',
        spokesperson_internal_stance: result.spokesperson_internal_stance || '',
        spokesperson_eksternal: result.spokesperson_eksternal || '',
        spokesperson_eksternal_stance: result.spokesperson_eksternal_stance || '',
        category: result.category || '',
        category_secondary: result.category_secondary || '',
        locations: result.locations || '',
        geo_scope: result.geo_scope || ''
      };
      const doPatch = body => fetch(`${SUPABASE_URL}/rest/v1/articles?id=eq.${article.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify(body)
      });
      let patchResp = await doPatch(fullBody);
      if (!patchResp.ok) {
        const errText = await patchResp.clone().text();
        // Kolom kategori/lokasi belum dibuat di DB: simpan sisanya saja, jangan gagal total
        if (/category|locations|geo_scope/i.test(errText)) {
          const { category, category_secondary, locations, geo_scope, ...rest } = fullBody;
          patchResp = await doPatch(rest);
        }
      }

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
      success: true, filterDays: days, processed, failed, toneCount, errors,
      nextOffset,
      note: articles.length < batchSize ? 'Selesai' : `Masih ada, panggil lagi dengan offset=${nextOffset}`
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
