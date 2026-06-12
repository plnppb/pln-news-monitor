const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET - ambil semua feeds dari DB
  if (req.method === 'GET') {
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/feeds?select=*&order=name.asc`, {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      });
      const data = await response.json();
      return res.status(200).json({ feeds: data });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // POST - sync feeds dari browser ke DB
  if (req.method === 'POST') {
    const { feeds } = req.body;
    if (!feeds || !feeds.length) {
      return res.status(400).json({ error: 'No feeds provided' });
    }

    const rows = feeds.map(f => ({
      name: f.name,
      url: f.url,
      enabled: f.enabled !== false,
      is_infonesia: f.url.includes('infonesia.net')
    }));

    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/feeds`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(rows)
      });

      return res.status(200).json({ success: true, synced: rows.length });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
