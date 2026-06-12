import https from 'https';
import http from 'http';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

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

async function saveToSupabase(articles, keyword) {
  if (!articles.length) return { saved: 0 };
  const rows = articles.map(a => ({
    title: a.title,
    url: a.url,
    source: a.source,
    published_at: a.published_at,
    description: a.description || '',
    keyword: keyword
  }));

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth check
  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const keyword = req.query.keyword || 'PLN Papua';
  const batchSize = parseInt(req.query.batch) || 30;
  const batchIndex = parseInt(req.query.batchIndex) || 0;

  try {
    // Ambil feeds dari DB
    const allFeeds = await getFeedsFromDB();
    if (!allFeeds.length) {
      return res.status(200).json({ success: true, message: 'No feeds in DB. Please sync feeds first.' });
    }

    // Proses batch
    const start = batchIndex * batchSize;
    const batch = allFeeds.slice(start, start + batchSize);
    if (!batch.length) {
      return res.status(200).json({ success: true, message: 'All batches processed', total: allFeeds.length });
    }

    const results = { total: 0, saved: 0, errors: [], batchIndex, totalFeeds: allFeeds.length };
    const keywords = keyword.toLowerCase().split(/\s+/).filter(k => k.length > 1);

    await Promise.allSettled(batch.map(async (feed) => {
      try {
        const xml = await fetchUrl(feed.url);
        const articles = parseRSS(xml, feed.url);

        // Filter keyword - infonesia cukup "pln", lainnya AND semua keyword
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

    return res.status(200).json({ success: true, ...results });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
