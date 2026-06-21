const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const { keyword, source, from, to, created_from, created_to, limit = 500, offset = 0 } = req.query;
  let url = `${SUPABASE_URL}/rest/v1/articles?select=*&order=published_at.desc&limit=${limit}&offset=${offset}`;
  if (keyword) url += `&keyword=eq.${encodeURIComponent(keyword)}`;
  if (source) url += `&source=ilike.${encodeURIComponent('%' + source + '%')}`;
  if (from) url += `&published_at=gte.${from}`;
  if (to) url += `&published_at=lte.${to}`;
  if (created_from) url += `&created_at=gte.${created_from}`;
  if (created_to) url += `&created_at=lte.${created_to}`;
  try {
    const response = await fetch(url, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Range-Unit': 'items',
        'Prefer': 'count=exact'
      }
    });
    const data = await response.json();
    const count = response.headers.get('content-range')?.split('/')[1] || data.length;
    return res.status(200).json({ articles: data, total: parseInt(count) || data.length });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
