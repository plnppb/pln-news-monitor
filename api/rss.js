export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url, q } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)' },
      signal: AbortSignal.timeout(8000)
    });
    const xml = await response.text();

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
      const link = getTag('link') || getTag('guid');
      const pubDate = getTag('pubDate');
      const description = getTag('description').replace(/<[^>]+>/g, '').substring(0, 300);
      const sourceName = xml.match(/<channel>[\s\S]*?<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/<[^>]+>/g,'') || new URL(url).hostname;

      if (!title) continue;

      // Filter by keyword if provided
      if (q) {
        const keywords = q.toLowerCase().split(/\s+/);
        const text = (title + ' ' + description).toLowerCase();
        if (!keywords.some(k => text.includes(k))) continue;
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
