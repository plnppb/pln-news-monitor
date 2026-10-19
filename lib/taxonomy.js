// Taksonomi isu + master wilayah (kabupaten/kota Papua) — SATU sumber kebenaran
// untuk api/analyze.js, api/analyze-batch.js, api/articles.js, dan (lewat
// salinan yang disisipkan ke index.html) tampilan web.
//
// Prinsip anti-halusinasi sama seperti nama narasumber: AI hanya boleh MEMILIH
// dari daftar di sini, lalu KODE memeriksa bahwa lokasinya benar-benar tertulis
// di teks yang dibaca AI. Provinsi TIDAK ditebak AI — diturunkan dari tabel ini.

const CATEGORIES = [
  { key: 'gangguan',    label: 'Gangguan & Pemadaman',      desc: 'padam, mati lampu, blackout, byarpet, gangguan jaringan/pembangkit, restorasi' },
  { key: 'layanan',     label: 'Layanan Pelanggan',         desc: 'keluhan pelayanan, pemasangan baru, token/PLN Mobile, antrean, pengaduan' },
  { key: 'tarif',       label: 'Tarif, Tagihan & Subsidi',  desc: 'kenaikan/penurunan tarif, tagihan bengkak, subsidi, diskon' },
  { key: 'listrik-desa',label: 'Kelistrikan Desa & Akses',  desc: 'listrik desa, daerah 3T, elektrifikasi, Lisdes, rasio elektrifikasi' },
  { key: 'ebt',         label: 'EBT & Transisi Energi',     desc: 'PLTS, PLTMH, PLTA, energi terbarukan, kendaraan listrik, SPKLU' },
  { key: 'proyek',      label: 'Proyek & Investasi',        desc: 'pembangkit/transmisi/gardu induk baru, pembebasan lahan, pembangunan infrastruktur kelistrikan' },
  { key: 'keselamatan', label: 'Keselamatan & Insiden',     desc: 'sengatan listrik, kebakaran akibat korsleting, pencurian kabel/trafo, vandalisme, kecelakaan kerja' },
  { key: 'csr',         label: 'CSR, TJSL & Kemitraan',     desc: 'bantuan sosial, program TJSL, kerja sama/MoU dengan pemda atau mitra' },
  { key: 'korporat',    label: 'Korporasi & SDM',           desc: 'manajemen, mutasi/pelantikan, rekrutmen, kinerja keuangan, kasus hukum' },
  { key: 'lainnya',     label: 'Lainnya',                   desc: 'tidak cocok dengan kategori lain' }
];
const CATEGORY_KEYS = CATEGORIES.map(c => c.key);

// Master wilayah: provinsi -> daftar kabupaten/kota. [nama kanonik, [alias tambahan]]
// Alias dasar (nama tanpa awalan + varian "kabupaten X"/"kab X"/"kota X") dibuat otomatis.
const PROVINCES = {
  'Papua': [
    ['Kota Jayapura', ['jayapura', 'abepura', 'waena', 'entrop', 'kotaraja', 'hamadi', 'holtekamp']],
    ['Kab. Jayapura', ['sentani', 'kabupaten jayapura', 'kab jayapura', 'kab. jayapura']],
    ['Kab. Keerom', ['arso']],
    ['Kab. Sarmi', []],
    ['Kab. Mamberamo Raya', ['mamberamo raya']],
    ['Kab. Biak Numfor', ['biak', 'biak numfor']],
    ['Kab. Supiori', ['sorendiweri']],
    ['Kab. Kepulauan Yapen', ['yapen', 'serui', 'kepulauan yapen']],
    ['Kab. Waropen', ['botawa']]
  ],
  'Papua Selatan': [
    ['Kab. Merauke', ['merauke']],
    ['Kab. Boven Digoel', ['boven digoel', 'tanah merah']],
    ['Kab. Mappi', ['mappi']],
    ['Kab. Asmat', ['asmat', 'agats']]
  ],
  'Papua Tengah': [
    ['Kab. Mimika', ['mimika', 'timika']],
    ['Kab. Nabire', ['nabire']],
    ['Kab. Paniai', ['paniai', 'enarotali']],
    ['Kab. Dogiyai', ['dogiyai', 'moanemani']],
    ['Kab. Deiyai', ['deiyai', 'waghete']],
    ['Kab. Intan Jaya', ['intan jaya', 'sugapa']],
    ['Kab. Puncak', ['ilaga', 'kabupaten puncak', 'kab puncak'], true],
    ['Kab. Puncak Jaya', ['puncak jaya']]
  ],
  'Papua Pegunungan': [
    ['Kab. Jayawijaya', ['jayawijaya', 'wamena']],
    ['Kab. Lanny Jaya', ['lanny jaya', 'tiom']],
    ['Kab. Mamberamo Tengah', ['mamberamo tengah', 'kobakma']],
    ['Kab. Nduga', ['nduga', 'kenyam']],
    ['Kab. Pegunungan Bintang', ['pegunungan bintang', 'oksibil']],
    ['Kab. Tolikara', ['tolikara', 'karubaga']],
    ['Kab. Yalimo', ['yalimo', 'elelim']],
    ['Kab. Yahukimo', ['yahukimo', 'dekai']]
  ],
  'Papua Barat': [
    ['Kab. Manokwari', ['manokwari']],
    ['Kab. Manokwari Selatan', ['manokwari selatan', 'ransiki']],
    ['Kab. Pegunungan Arfak', ['pegunungan arfak', 'arfak']],
    ['Kab. Teluk Bintuni', ['teluk bintuni', 'bintuni']],
    ['Kab. Teluk Wondama', ['teluk wondama', 'wondama', 'wasior']],
    ['Kab. Fakfak', ['fakfak']],
    ['Kab. Kaimana', ['kaimana']]
  ],
  'Papua Barat Daya': [
    ['Kota Sorong', ['sorong']],
    ['Kab. Sorong', ['kabupaten sorong', 'kab sorong', 'kab. sorong', 'aimas']],
    ['Kab. Sorong Selatan', ['sorong selatan', 'teminabuan']],
    ['Kab. Raja Ampat', ['raja ampat', 'waisai']],
    ['Kab. Maybrat', ['maybrat', 'kumurkek']],
    ['Kab. Tambrauw', ['tambrauw']]
  ]
};

// Tingkat provinsi (dipakai kalau berita menyebut provinsinya saja)
const PROVINCE_ENTRIES = Object.keys(PROVINCES).map(p => ({
  name: 'Provinsi ' + p,
  province: p,
  aliases: ['provinsi ' + p.toLowerCase(), ...(p === 'Papua' ? [] : [p.toLowerCase()])]
}));

const SCOPES = [
  { key: 'papua_umum',   label: 'Papua (umum/regional)' },
  { key: 'nasional',     label: 'Nasional' },
  { key: 'luar_wilayah', label: 'Luar wilayah UIW PPB' }
];
const SCOPE_KEYS = SCOPES.map(s => s.key);

// ---- indeks lokasi ----
function normLoc(s) {
  return ' ' + String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
}

const LOCATIONS = []; // {name, province, level}
const ALIAS_LIST = []; // {alias(normalized, tanpa spasi tepi), name}
(function build() {
  for (const prov of Object.keys(PROVINCES)) {
    for (const [name, extra, noBase] of PROVINCES[prov]) {
      LOCATIONS.push({ name, province: prov, level: 'kabkota' });
      const base = name.replace(/^(Kota|Kab\.)\s+/, '');
      const isCity = name.startsWith('Kota');
      const aliases = new Set([name, ...extra]);
      if (isCity) { aliases.add('kota ' + base); } else if (!noBase) { aliases.add(base); aliases.add('kabupaten ' + base); aliases.add('kab ' + base); }
      // nama dasar kota yang ambigu (Jayapura/Sorong) sudah masuk di 'extra' sebagai default ke kota
      for (const a of aliases) ALIAS_LIST.push({ alias: normLoc(a).trim(), name });
    }
  }
  for (const pe of PROVINCE_ENTRIES) {
    LOCATIONS.push({ name: pe.name, province: pe.province, level: 'provinsi' });
    for (const a of pe.aliases) ALIAS_LIST.push({ alias: normLoc(a).trim(), name: pe.name });
  }
  ALIAS_LIST.sort((a, b) => b.alias.length - a.alias.length);
})();
const LOCATION_NAMES = LOCATIONS.map(l => l.name);
const LOC_BY_NAME = Object.fromEntries(LOCATIONS.map(l => [l.name, l]));

function provinceOf(locName) {
  return LOC_BY_NAME[locName] ? LOC_BY_NAME[locName].province : '';
}

// Buang boilerplate nama unit PLN yang selalu menyebut "Papua dan Papua Barat"
// supaya tidak terbaca sebagai lokasi kejadian.
function stripBoilerplate(normalizedText) {
  return normalizedText
    .replace(/ (pln )?(uiw |unit induk wilayah )?papua (dan|dan ke|&) papua barat /g, ' ')
    .replace(/ (pln )?(uiw|unit induk wilayah) papua( barat)? /g, ' ');
}

// Deteksi semua lokasi master yang tertulis di teks. Pencocokan frasa terpanjang
// dulu, bagian yang sudah cocok dibuang supaya "Puncak Jaya" tidak ikut dihitung
// sebagai "Puncak" dan "Sorong Selatan" tidak jadi "Sorong".
function detectLocations(text) {
  let t = stripBoilerplate(normLoc(text));
  const found = [];
  for (const { alias, name } of ALIAS_LIST) {
    if (!alias) continue;
    const needle = ' ' + alias + ' ';
    if (t.includes(needle)) {
      if (!found.includes(name)) found.push(name);
      t = t.split(needle).join(' ' + '#'.repeat(alias.length) + ' ');
    }
  }
  return found;
}

// Ubah string/array dari AI menjadi daftar nama kanonik yang VALID dan BENAR-BENAR ada di teks sumber.
function validateLocations(raw, sourceText) {
  const proposed = Array.isArray(raw) ? raw : String(raw || '').split(';');
  const inText = new Set(detectLocations(sourceText));
  const out = [];
  for (const p of proposed) {
    const s = String(p || '').trim();
    if (!s) continue;
    let name = LOC_BY_NAME[s] ? s : null;
    if (!name) { const d = detectLocations(s); name = d.length === 1 ? d[0] : null; }
    if (name && inText.has(name) && !out.includes(name)) out.push(name);
  }
  return out;
}

function buildPromptSection() {
  const cats = CATEGORIES.map(c => `- "${c.key}" = ${c.label}: ${c.desc}`).join('\n');
  return `KLASIFIKASI ISU (field "kategori" dan "kategori_sekunder"):
Pilih SATU kategori utama yang paling menggambarkan inti berita, dan boleh satu kategori sekunder bila berita jelas membahas dua isu (kalau tidak, kosongkan). Pakai HANYA kunci berikut, persis seperti tertulis:
${cats}
Kalau ragu atau tidak ada yang cocok, pakai "lainnya". Jangan membuat kategori baru.

LOKASI KEJADIAN (field "lokasi" dan "cakupan"):
"lokasi" = kabupaten/kota (atau provinsi, kalau hanya provinsinya yang disebut) yang menjadi LOKASI KEJADIAN/TOPIK utama berita, dipilih HANYA dari daftar ini, ditulis persis, dipisah titik-koma (;):
${LOCATION_NAMES.join('; ')}
ATURAN LOKASI: nama wilayah itu WAJIB benar-benar tertulis di judul/deskripsi di bawah (nama kota/distrik yang jelas masuk wilayah itu, misal Timika = Kab. Mimika, Wamena = Kab. Jayawijaya, boleh). JANGAN menebak lokasi dari pengetahuan umum. Abaikan nama unit "PLN UIW Papua dan Papua Barat" — itu bukan lokasi kejadian. Kalau tidak ada lokasi spesifik di daftar, kosongkan "lokasi" lalu isi "cakupan" dengan salah satu: "papua_umum" (soal Papua/Papua Barat secara umum), "nasional" (isu nasional/PLN pusat), "luar_wilayah" (di luar Papua), atau kosong kalau tidak jelas. Kalau "lokasi" terisi, kosongkan "cakupan".`;
}

// Rapikan & validasi hasil klasifikasi dari AI. sourceText = teks yang SAMA PERSIS dibaca AI.
function validateClassification(result, sourceText) {
  const out = {};
  let cat = String(result.kategori || '').trim().toLowerCase();
  if (!CATEGORY_KEYS.includes(cat)) cat = 'lainnya';
  let sec = String(result.kategori_sekunder || '').trim().toLowerCase();
  if (!CATEGORY_KEYS.includes(sec) || sec === cat || sec === 'lainnya') sec = '';
  out.category = cat;
  out.category_secondary = sec;
  const locs = validateLocations(result.lokasi, sourceText);
  out.locations = locs.join(';');
  let scope = String(result.cakupan || '').trim().toLowerCase();
  if (!SCOPE_KEYS.includes(scope) || locs.length) scope = '';
  out.geo_scope = scope;
  return out;
}

module.exports = {
  CATEGORIES, CATEGORY_KEYS, PROVINCES, LOCATIONS, LOCATION_NAMES, SCOPES, SCOPE_KEYS,
  provinceOf, detectLocations, validateLocations, buildPromptSection, validateClassification
};
