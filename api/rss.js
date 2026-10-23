import https from 'https';
import http from 'http';

async function fetchUrl(urlStr, rejectUnauthorized = false) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'GET',
      rejectUnauthorized,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
      timeout: 8000
    };
    const req = lib.request(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location, rejectUnauthorized).then(resolve).catch(reject);
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

async function fetchWithFallback(url) {
  try {
    return await fetchUrl(url, false);
  } catch (e1) {
    if (url.startsWith('https://')) {
      try {
        return await fetchUrl(url.replace('https://', 'http://'), false);
      } catch (e2) {
        throw new Error(`fetch failed: ${e2.message}`);
      }
    }
    throw e1;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url, q } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });

  try {
    const xml = await fetchWithFallback(url);
    const items = [];

    // Sumber sitemap berita (Google News) atau Atom: ubah ke bentuk yang sama dengan RSS
    if (/<urlset[\s>]/i.test(xml) && /<news:news[\s>]/i.test(xml)) {
      const host = new URL(url).hostname.replace(/^www\./, '');
      const re = /<url>([\s\S]*?)<\/url>/gi; let m;
      const tg = (b, n) => { const x = b.match(new RegExp('<' + n + '[^>]*>([\\s\\S]*?)</' + n + '>', 'i')); return x ? x[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').trim() : ''; };
      while ((m = re.exec(xml)) !== null) {
        const b = m[1], title = tg(b, 'news:title'), link = tg(b, 'loc');
        if (!title || !link) continue;
        if (q) {
          const kws = q.toLowerCase().split(/\s+/).filter(k => k.length > 1);
          if (!kws.every(k => title.toLowerCase().includes(k))) continue;
        }
        const d = new Date(tg(b, 'news:publication_date'));
        items.push({ title, url: link, publishedAt: isNaN(d) ? new Date().toISOString() : d.toISOString(), source: { name: tg(b, 'news:name') || host }, description: '', urlToImage: null });
      }
      return res.status(200).json({ status: 'ok', articles: items, count: items.length });
    }
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const item = match[1];
      const getTag = (tag) => {
        const m = item.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
        return m ? (m[1] || m[2] || '').trim() : '';
      };

      const title = getTag('title');
      const link = getTag('link') || getTag('guid');
      const pubDate = getTag('pubDate');
      const description = getTag('description').replace(/<[^>]+>/g, '').substring(0, 300);
      const sourceName = xml.match(/<channel>[\s\S]*?<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/<[^>]+>/g,'')?.trim() || new URL(url).hostname;

      if (!title) continue;

      // Filter: semua kata dari keyword harus ada (AND logic)
      if (q) {
        const keywords = q.toLowerCase().split(/\s+/).filter(k => k.length > 1);
        const text = (title + ' ' + description).toLowerCase();
        if (!keywords.every(k => text.includes(k))) continue;
      }

      items.push({
        title,
        url: link,
        publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        source: { name: sourceName },
        description,
        urlToImage: null
      });
    }

    return res.status(200).json({ status: 'ok', articles: items, count: items.length });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch RSS', detail: error.message });
  }
}
