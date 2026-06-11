export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { q, from, to, page = 1, pageSize = 50 } = req.query;
  const apiKey = process.env.NEWS_API_KEY;

  if (!q) return res.status(400).json({ error: 'Query parameter q is required' });

  try {
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&language=id&sortBy=publishedAt&pageSize=${pageSize}&page=${page}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}&apiKey=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch news', detail: error.message });
  }
}
