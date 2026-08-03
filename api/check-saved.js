const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { urls } = req.body || {};
  if (!urls || !Array.isArray(urls) || !urls.length) {
    return res.status(400).json({ error: 'urls (array) wajib diisi' });
  }

  try {
    const existing = new Set();
    const chunkSize = 50;
    for (let i = 0; i < urls.length; i += chunkSize) {
      const chunk = urls.slice(i, i + chunkSize);
      // PostgREST filter: url=in.("url1","url2",...)
      const list = chunk.map(u => `"${u.replace(/"/g, '\\"')}"`).join(',');
      const filterValue = `in.(${list})`;
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/articles?select=url&url=${encodeURIComponent(filterValue)}`,
        { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } }
      );
      const data = await resp.json();
      if (Array.isArray(data)) data.forEach(row => existing.add(row.url));
    }
    return res.status(200).json({ existing: Array.from(existing) });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
