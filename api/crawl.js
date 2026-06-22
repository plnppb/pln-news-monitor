const https = require('https');
const http = require('http');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const NEWS_API_KEY = process.env.NEWS_API_KEY;
const GNEWSIO_API_KEY = process.env.GNEWSIO_API_KEY;

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

// ==================== SUMBER TAMBAHAN: NewsAPI, Google News RSS, GNews.io ====================

async function fetchFromNewsAPI(keyword) {
  if (!NEWS_API_KEY) return [];
  try {
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(keyword)}&language=id&sortBy=publishedAt&pageSize=50&apiKey=${NEWS_API_KEY}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await response.json();
    if (!data.articles) return [];
    return data.articles.map(a => ({
      title: a.title,
      url: a.url,
      source: a.source?.name || 'NewsAPI',
      published_at: a.publishedAt || new Date().toISOString(),
      description: (a.description || '').substring(0, 500)
    }));
  } catch (e) {
    return [];
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
      // Bersihkan description dari HTML entities dan tag (Google News kirim HTML mentah)
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
  if (!GNEWSIO_API_KEY) return [];
  try {
    const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(keyword)}&lang=id&country=id&max=10&apikey=${GNEWSIO_API_KEY}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await response.json();
    if (!data.articles) return [];
    return data.articles.map(a => ({
      title: a.title,
      url: a.url,
      source: a.source?.name || 'GNews.io',
      published_at: a.publishedAt || new Date().toISOString(),
      description: (a.description || '').substring(0, 500)
    }));
  } catch (e) {
    return [];
  }
}

// ==================== ANALYZE & SAVE ====================

async function analyzeArticle(title, description) {
  if (!GEMINI_API_KEY) return { tone: 'netral', resume: '', spokesperson_internal: '', spokesperson_eksternal: '' };
  try {
    const prompt = `Kamu adalah analis media untuk PLN UIW Papua & Papua Barat. Analisis berita berikut dan berikan respons HANYA dalam format JSON ini (tanpa teks lain, tanpa markdown):
{
  "tone": "positif" | "negatif" | "netral",
  "spokesperson_internal": "Nama, Jabatan (pisah semicolon jika lebih dari satu, kosongkan jika tidak ada)",
  "spokesperson_eksternal": "Nama, Jabatan (pisah semicolon jika lebih dari satu, kosongkan jika tidak ada)",
  "resume": "Ringkasan 2-3 kalimat dalam bahasa Indonesia"
}
Panduan tone:
- positif: berita menguntungkan/memuji PLN atau program PLN
- negatif: berita kritik, keluhan, masalah, atau merugikan PLN
- netral: berita informatif/faktual tanpa tendensi tertentu
Judul: ${title}
Deskripsi: ${(description || '').replace(/<[^>]+>/g, '').substring(0, 300)}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 400 }
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
  // source=feeds (default, RSS feeds dari DB) atau source=external (NewsAPI+GoogleNews+GNewsIo)
  const source = req.query.source || 'feeds';

  try {
    const keywords = keyword.toLowerCase().split(/\s+/).filter(k => k.length > 1);

    // ===== MODE: EXTERNAL (NewsAPI + Google News RSS + GNews.io) =====
    if (source === 'external') {
      const [newsApiArts, googleNewsArts, gnewsioArts] = await Promise.all([
        fetchFromNewsAPI(keyword),
        fetchFromGoogleNewsRSS(keyword),
        fetchFromGNewsIo(keyword)
      ]);

      let combined = [...newsApiArts, ...googleNewsArts, ...gnewsioArts];

      // Filter: harus mengandung semua kata keyword
      combined = combined.filter(a => {
        const text = (a.title + ' ' + a.description).toLowerCase();
        return keywords.every(k => text.includes(k));
      });

      // Filter: hanya artikel maksimal 30 hari terakhir (buang artikel lama yang baru diindex ulang Google News)
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30);
      combined = combined.filter(a => {
        const pubDate = new Date(a.published_at);
        return pubDate >= cutoffDate;
      });

      // Dedup by judul yang mirip (Google News kasih URL redirect berbeda untuk artikel sama)
      function normalizeTitle(t) {
        return t.toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .split(' ')
          .slice(0, 8) // ambil 8 kata pertama untuk perbandingan
          .join(' ');
      }
      const seenTitles = new Set();
      combined = combined.filter(a => {
        const norm = normalizeTitle(a.title);
        if (seenTitles.has(norm)) return false;
        seenTitles.add(norm);
        return true;
      });

      const saved = await saveToSupabase(combined, keyword);
      return res.status(200).json({
        success: true,
        source: 'external',
        total: combined.length,
        saved: saved.saved,
        breakdown: { newsapi: newsApiArts.length, googlenews: googleNewsArts.length, gnewsio: gnewsioArts.length }
      });
    }

    // ===== MODE: FEEDS (RSS dari database, default) =====
    const allFeeds = await getFeedsFromDB();
    if (!allFeeds.length) {
      return res.status(200).json({ success: true, message: 'No feeds in DB. Please sync feeds first.' });
    }

    // Skip feed Infonesia - feed-nya statis/tidak update, hanya buang waktu crawl
    const skipInfonesia = req.query.skipInfonesia === 'true'; // default: false, Infonesia diperlakukan sama seperti sumber lain
    const activeFeeds = skipInfonesia ? allFeeds.filter(f => !f.is_infonesia) : allFeeds;

    const start = batchIndex * batchSize;
    const batch = activeFeeds.slice(start, start + batchSize);
    if (!batch.length) {
      return res.status(200).json({ success: true, message: 'All batches processed', total: activeFeeds.length });
    }

    const results = { total: 0, saved: 0, errors: [], batchIndex, totalFeeds: activeFeeds.length, skippedInfonesia: skipInfonesia };

    await Promise.allSettled(batch.map(async (feed) => {
      try {
        const xml = await fetchUrl(feed.url);
        const articles = parseRSS(xml, feed.url);

        const filtered = articles.filter(a => {
          const text = (a.title + ' ' + a.description).toLowerCase();
          if (feed.is_infonesia) return text.includes('pln');
          return keywords.every(k => text.includes(k));
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
