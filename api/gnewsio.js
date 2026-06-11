export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { q, from, to } = req.query;
  const apiKey = process.env.GNEWSIO_API_KEY;

  if (!q) return res.status(400).json({ error: 'Query required' });
  if (!apiKey) return res.status(200).json({ status: 'ok', articles: [] });

  try {
    let url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&lang=id&country=id&max=10&apikey=${apiKey}`;
    if (from) url += `&from=${from}T00:00:00Z`;
    if (to) url += `&to=${to}T23:59:59Z`;

    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await response.json();

    const articles = (data.articles || []).map(a => ({
      title: a.title,
      url: a.url,
      publishedAt: a.publishedAt,
      source: { name: a.source?.name || 'GNews.io' },
      description: a.description || '',
      urlToImage: a.image || null
    }));

    return res.status(200).json({ status: 'ok', articles });
  } catch (error) {
    return res.status(200).json({ status: 'ok', articles: [] });
  }
}
