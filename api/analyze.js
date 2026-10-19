// CATATAN PENTING (perbaikan anti-halu spokesperson):
// File ini sebelumnya adalah endpoint TERPISAH dengan prompt sendiri yang
// JAUH lebih sederhana dan SAMA SEKALI TIDAK punya validasi nama — padahal
// ini endpoint yang dipanggil oleh tombol "Cari Berita" (pencarian manual)
// di index.html (fungsi startAnalyzeAll -> fetch('/api/analyze', ...)).
// Akibatnya, semua perbaikan anti-halu yang sudah dipasang di
// api/analyze-batch.js dan api/articles.js (instruksi prompt + validator
// nameAppearsInSource/validateSpokespersonField) TIDAK PERNAH berlaku untuk
// hasil pencarian manual — jalur ini tetap bisa mengarang nama narasumber
// sebebas-bebasnya. Sekarang disamakan dengan dua file lain itu.
const TAX = require('../lib/taxonomy');
const TEXT_LIMIT = 800; // batas teks yang dikirim ke AI (naik dari 400 supaya lokasi di paragraf awal terbaca)
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

${TAX.buildPromptSection()}

Balas HANYA JSON ini tanpa teks lain:
{"tone":"netral","kategori":"gangguan","kategori_sekunder":"","lokasi":"","cakupan":"","spokesperson_internal":"","spokesperson_internal_stance":"","spokesperson_eksternal":"","spokesperson_eksternal_stance":"","resume":"ringkasan 2-3 kalimat"}`;

// Cek apakah nama beneran ada di teks sumber — jaring pengaman kode, bukan
// andalin AI patuh instruksi doang. Dicek sebagai SATU FRASA UTUH (nama
// depan+belakang berurutan persis), BUKAN kata-kata yang dicek terpisah-pisah.
function normalizeForMatch(s) {
  return (s || '').toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
}

function nameAppearsInSource(name, sourceTextNormalized) {
  const normalizedName = normalizeForMatch(name);
  const words = normalizedName.split(' ').filter(Boolean);
  if (words.length < 2) return false;
  return sourceTextNormalized.includes(normalizedName);
}

function validateSpokespersonField(raw, sourceTextNormalized) {
  if (!raw) return '';
  const entries = raw.split(';').map(s => s.trim()).filter(Boolean);
  const valid = entries.filter(entry => {
    const name = entry.includes('|') ? entry.split('|')[0].trim() : entry.trim();
    return nameAppearsInSource(name, sourceTextNormalized);
  });
  return valid.join(';');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { title, description } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Title is required' });

  if (!GEMINI_KEYS.length) {
    return res.status(200).json({ error: 'NO_API_KEY' });
  }

  // Potong deskripsi SEKALI, pakai hasil yang sama persis buat prompt ke
  // Gemini maupun buat validasi nama nanti — biar nggak ada nama yang
  // "ketemu" cuma gara-gara nongol di bagian artikel yang Gemini sendiri
  // nggak pernah baca.
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
        if (isQuota && i < GEMINI_KEYS.length - 1) continue;
        return res.status(200).json({ error: data.error.message });
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const jsonMatch = clean.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return res.status(200).json({ error: 'NO_JSON' });

      const result = JSON.parse(jsonMatch[0]);
      if (!['positif', 'negatif', 'netral'].includes(result.tone)) result.tone = 'netral';

      // Validasi: buang nama spokesperson yang nggak ketemu di teks yang
      // SAMA PERSIS dibaca Gemini (truncatedDescription, bukan description penuh)
      const sourceTextNormalized = normalizeForMatch(title + ' ' + truncatedDescription);
      result.spokesperson_internal = validateSpokespersonField(result.spokesperson_internal, sourceTextNormalized);
      if (!result.spokesperson_internal) result.spokesperson_internal_stance = '';
      result.spokesperson_eksternal = validateSpokespersonField(result.spokesperson_eksternal, sourceTextNormalized);
      if (!result.spokesperson_eksternal) result.spokesperson_eksternal_stance = '';

      Object.assign(result, TAX.validateClassification(result, title + ' ' + truncatedDescription));
      delete result.kategori; delete result.kategori_sekunder; delete result.lokasi; delete result.cakupan;
      return res.status(200).json(result);
    } catch (e) {
      lastError = e.message;
      continue;
    }
  }
  return res.status(200).json({ error: `Semua ${GEMINI_KEYS.length} API key gagal/kehabisan kuota. Error terakhir: ${lastError}` });
};
