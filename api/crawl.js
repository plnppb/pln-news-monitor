const https = require('https');
const http = require('http');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const NEWS_API_KEY = process.env.NEWS_API_KEY;
const GNEWSIO_API_KEY = process.env.GNEWSIO_API_KEY;

// Semua kabupaten/kota di wilayah kerja PLN UIW Papua & Papua Barat, mencakup
// 6 provinsi hasil pemekaran (Papua, Papua Barat, Papua Tengah, Papua Pegunungan,
// Papua Selatan, Papua Barat Daya). Dipakai supaya artikel yang menyebut nama
// kabupaten/kota tanpa kata literal "papua" (mis. berita "PLN Nduga" atau feed
// "Infonesia Maybrat") tetap dianggap relevan, bukan malah ikut kesaring keluar.
const PAPUA_REGION_TERMS = [
  'papua',
  // Papua Barat Daya
  'sorong', 'maybrat', 'tambrauw', 'raja ampat',
  // Papua Barat
  'manokwari', 'arfak', 'bintuni', 'wondama', 'fakfak', 'kaimana',
  // Papua Tengah
  'nabire', 'paniai', 'mimika', 'timika', 'puncak jaya', 'kabupaten puncak', 'dogiyai', 'deiyai', 'intan jaya',
  // Papua Pegunungan
  'jayawijaya', 'wamena', 'lanny jaya', 'nduga', 'mamberamo tengah', 'yalimo', 'tolikara', 'pegunungan bintang', 'yahukimo',
  // Papua Selatan
  'merauke', 'boven digoel', 'mappi', 'asmat',
  // Papua (induk)
  'jayapura', 'keerom', 'sarmi', 'biak', 'supiori', 'waropen', 'mamberamo raya',
];

function matchesPapuaRegion(text) {
  return PAPUA_REGION_TERMS.some(term => text.includes(term));
}

// Cocokkan tiap kata kunci ke teks artikel.
// - "papua" dianggap cocok juga kalau teksnya menyebut nama kabupaten/kota
//   spesifik di wilayah Papua (tidak wajib ada kata literal "papua").
// - "pln" dianggap cocok juga kalau teksnya menyebut "listrik" (banyak berita
//   soal kelistrikan Papua yang tidak literal menyebut "PLN").
function keywordMatch(text, keywords) {
  return keywords.every(k => {
    if (k === 'papua') return matchesPapuaRegion(text);
    if (k === 'pln') return text.includes('pln') || text.includes('listrik');
    return text.includes(k);
  });
}

async function fetchUrl(urlStr) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'GET',
      rejectUnauthorized: false,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
      timeout: 8000
    };
    const req = lib.request(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function parseRSS(xml, feedUrl) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  const sourceName = xml.match(/<channel>[\s\S]*?<title>([\s\S]*?)<\/title>/)?.[1]
    ?.replace(/<[^>]+>/g, '')?.trim() || new URL(feedUrl).hostname;

  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    const getTag = (tag) => {
      const m = item.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return m ? (m[1] || m[2] || '').trim() : '';
    };
    const title = getTag('title');
    const link = getTag('link') || getTag('guid');
    const pubDate = getTag('pubDate');
    const description = getTag('description').replace(/<[^>]+>/g, '').substring(0, 500);
    if (!title || !link) continue;
    items.push({ title, url: link, source: sourceName, published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(), description });
  }
  return items;
}

async function getFeedsFromDB() {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/feeds?select=*&enabled=eq.true`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    }
  });
  return await response.json();
}

async function fetchFromNewsAPI(keyword) {
  if (!NEWS_API_KEY) return { articles: [], error: 'NEWS_API_KEY tidak diset' };
  try {
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(keyword)}&language=id&sortBy=publishedAt&pageSize=50&apiKey=${NEWS_API_KEY}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await response.json();
    if (!response.ok || data.status === 'error') {
      return { articles: [], error: `NewsAPI ${response.status}: ${data.message || data.code || 'unknown error'}` };
    }
    if (!data.articles) return { articles: [], error: null };
    return {
      articles: data.articles.map(a => ({
        title: a.title,
        url: a.url,
        source: a.source?.name || 'NewsAPI',
        published_at: a.publishedAt || new Date().toISOString(),
        description: (a.description || '').substring(0, 500)
      })),
      error: null
    };
  } catch (e) {
    return { articles: [], error: 'NewsAPI exception: ' + e.message };
  }
}

async function fetchFromGoogleNewsRSS(keyword) {
  try {
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=id&gl=ID&ceid=ID:id`;
    const xml = await fetchUrl(rssUrl);
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const item = match[1];
      const getTag = (tag) => {
        const m = item.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
        return m ? (m[1] || m[2] || '').trim() : '';
      };
      const title = getTag('title');
      const link = getTag('link');
      const pubDate = getTag('pubDate');
      const source = getTag('source');
      let description = getTag('description');
      description = description
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 500);
      if (!title || !link) continue;
      items.push({
        title,
        url: link,
        source: source || 'Google News',
        published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        description
      });
    }
    return items;
  } catch (e) {
    return [];
  }
}

async function fetchFromGNewsIo(keyword) {
  if (!GNEWSIO_API_KEY) return { articles: [], error: 'GNEWSIO_API_KEY tidak diset' };
  try {
    const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(keyword)}&lang=id&country=id&max=10&apikey=${GNEWSIO_API_KEY}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await response.json();
    if (!response.ok || data.errors) {
      return { articles: [], error: `GNews.io ${response.status}: ${(data.errors || []).join(', ') || 'unknown error'}` };
    }
    if (!data.articles) return { articles: [], error: null };
    return {
      articles: data.articles.map(a => ({
        title: a.title,
        url: a.url,
        source: a.source?.name || 'GNews.io',
        published_at: a.publishedAt || new Date().toISOString(),
        description: (a.description || '').substring(0, 500)
      })),
      error: null
    };
  } catch (e) {
    return { articles: [], error: 'GNews.io exception: ' + e.message };
  }
}

// ==================== ANALYZE & SAVE ====================

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
- Permintaan/harapan pihak lain ke PLN tanpa nada tekanan (kata: "harap", "minta", "diminta" dengan nada biasa)
- Pemeliharaan jaringan terencana yang diinformasikan dengan baik
- Berita kebijakan energi nasional yang menyebut PLN secara umum
- Profil/wawancara pejabat PLN tanpa isu spesifik

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

## FORMAT RESPONS (JSON saja, tanpa teks lain, tanpa markdown):
{
  "tone": "positif" | "negatif" | "netral",
  "spokesperson_internal": "Nama, Jabatan PLN (kosongkan jika tidak ada, pisah semicolon jika lebih dari satu)",
  "spokesperson_eksternal": "Nama, Jabatan non-PLN (kosongkan jika tidak ada, pisah semicolon jika lebih dari satu)",
  "resume": "Ringkasan 2-3 kalimat dalam Bahasa Indonesia yang menjelaskan isi berita secara objektif"
}`;

async function analyzeArticle(title, description) {
  if (!GEMINI_API_KEY) return { tone: 'netral', resume: '', spokesperson_internal: '', spokesperson_eksternal: '' };
  try {
    const prompt = `${TONE_PROMPT}

## ARTIKEL YANG DIANALISIS:
Judul: ${title}
Deskripsi: ${(description || '').replace(/<[^>]+>/g, '').substring(0, 400)}

Berikan analisis dalam format JSON:`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
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
    return { tone: 'netral', resume: '', spokesperson_internal: '', spokesperson_eksternal: '' };
  }
}

async function saveToSupabase(articles, keyword) {
  if (!articles.length) return { saved: 0 };

  const rows = [];
  for (const a of articles) {
    const analysis = await analyzeArticle(a.title, a.description);
    rows.push({
      title: a.title,
      url: a.url,
      source: a.source,
      published_at: a.published_at,
      description: a.description || '',
      keyword: keyword,
      tone: analysis.tone || 'netral',
      resume: analysis.resume || '',
      spokesperson_internal: analysis.spokesperson_internal || '',
      spokesperson_eksternal: analysis.spokesperson_eksternal || ''
    });
    await new Promise(r => setTimeout(r, 200));
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/articles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Prefer': 'resolution=ignore-duplicates'
    },
    body: JSON.stringify(rows)
  });
  return { saved: rows.length, status: response.status };
}

// ==================== MAIN HANDLER ====================

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const keyword = req.query.keyword || 'PLN Papua';
  const batchSize = parseInt(req.query.batch) || 30;
  const batchIndex = parseInt(req.query.batchIndex) || 0;
  const source = req.query.source || 'feeds';

  try {
    const keywords = keyword.toLowerCase().split(/\s+/).filter(k => k.length > 1);

    // ===== MODE: EXTERNAL =====
    if (source === 'external') {
      const [newsApiRes, googleNewsArts, gnewsioRes] = await Promise.all([
        fetchFromNewsAPI(keyword),
        fetchFromGoogleNewsRSS(keyword),
        fetchFromGNewsIo(keyword)
      ]);
      const newsApiArts = newsApiRes.articles;
      const gnewsioArts = gnewsioRes.articles;

      let combined = [...newsApiArts, ...googleNewsArts, ...gnewsioArts];
      const rawTotal = combined.length;

      combined = combined.filter(a => {
        const text = (a.title + ' ' + a.description).toLowerCase();
        return keywordMatch(text, keywords);
      });
      const afterKeywordFilter = combined.length;

      const qDateFrom = req.query.dateFrom;
      const qDateTo = req.query.dateTo;
      const cutoffDate = qDateFrom ? new Date(qDateFrom) : (() => {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        return d;
      })();
      combined = combined.filter(a => new Date(a.published_at) >= cutoffDate);
      if (qDateTo) {
        const toDate = new Date(qDateTo + 'T23:59:59');
        combined = combined.filter(a => new Date(a.published_at) <= toDate);
      }
      const afterDateFilter = combined.length;

      function normalizeTitle(t) {
        return t.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim().split(' ').slice(0, 8).join(' ');
      }
      const seenTitles = new Set();
      combined = combined.filter(a => {
        const norm = normalizeTitle(a.title);
        if (seenTitles.has(norm)) return false;
        seenTitles.add(norm);
        return true;
      });
      const afterDedup = combined.length;

      const saved = await saveToSupabase(combined, keyword);
      const sourceErrors = {};
      if (newsApiRes.error) sourceErrors.newsapi = newsApiRes.error;
      if (gnewsioRes.error) sourceErrors.gnewsio = gnewsioRes.error;

      return res.status(200).json({
        success: true,
        source: 'external',
        total: combined.length,
        saved: saved.saved,
        breakdown: { newsapi: newsApiArts.length, googlenews: googleNewsArts.length, gnewsio: gnewsioArts.length },
        sourceErrors,
        funnel: {
          mentah: rawTotal,
          lolos_kata_kunci: afterKeywordFilter,
          lolos_tanggal: afterDateFilter,
          setelah_dedup: afterDedup,
          tersimpan_baru: saved.saved
        }
      });
    }

    // ===== MODE: FEEDS =====
    const allFeeds = await getFeedsFromDB();
    if (!allFeeds.length) {
      return res.status(200).json({ success: true, message: 'No feeds in DB.' });
    }

    const skipInfonesia = req.query.skipInfonesia === 'true';
    const activeFeeds = skipInfonesia ? allFeeds.filter(f => !f.is_infonesia) : allFeeds;

    const start = batchIndex * batchSize;
    const batch = activeFeeds.slice(start, start + batchSize);
    if (!batch.length) {
      return res.status(200).json({ success: true, message: 'All batches processed', total: activeFeeds.length });
    }

    const results = { total: 0, saved: 0, errors: [], batchIndex, totalFeeds: activeFeeds.length };

    await Promise.allSettled(batch.map(async (feed) => {
      try {
        const xml = await fetchUrl(feed.url);
        const articles = parseRSS(xml, feed.url);
        // PENTING: semua feed — termasuk subdomain Infonesia manapun (is_infonesia) —
        // WAJIB lolos filter kata kunci penuh di bawah ini. Jangan buat jalan pintas
        // khusus untuk Infonesia lagi (pernah ada bug: feed is_infonesia cuma dicek
        // mengandung "pln" doang, akibatnya berita PLN di luar Papua ikut kesedot).
        const filtered = articles.filter(a => {
          const text = (a.title + ' ' + a.description).toLowerCase();
          return keywordMatch(text, keywords);
        });
        results.total += filtered.length;
        if (filtered.length > 0) {
          const saved = await saveToSupabase(filtered, keyword);
          results.saved += saved.saved;
        }
      } catch (e) {
        results.errors.push({ feed: feed.url, error: e.message });
      }
    }));

    return res.status(200).json({ success: true, source: 'feeds', ...results });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
