export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Query parameter q is required' });

  try {
    const encoded = encodeURIComponent(q);
    const rssUrl = `https://news.google.com/rss/search?q=${encoded}&hl=id&gl=ID&ceid=ID:id`;
    const response = await fetch(rssUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)' }
    });
    const xml = await response.text();

    // Parse RSS XML manually
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const item = match[1];
      const getTag = (tag) => {
        const m = item.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`));
        return m ? (m[1] || m[2] || '').trim() : '';
      };
      const title = getTag('title');
      const link = getTag('link') || item.match(/<link\s*\/>[\s\S]*?<([^>]+)>/)?.[0] || '';
      const pubDate = getTag('pubDate');
      const source = getTag('source');
      const description = getTag('description');

      if (title) {
        items.push({
          title,
          url: link,
          publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
          source: { name: source || 'Google News' },
          description: description.replace(/<[^>]+>/g, '').substring(0, 200),
          urlToImage: null
        });
      }
    }

    return res.status(200).json({ status: 'ok', articles: items });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch Google News', detail: error.message });
  }
}
