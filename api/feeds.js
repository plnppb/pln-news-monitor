const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const isKeywords = req.query.resource === 'keywords';

  // GET - ambil semua feeds ATAU semua keyword dari DB
  if (req.method === 'GET') {
    try {
      const table = isKeywords ? 'crawl_keywords' : 'feeds';
      const order = isKeywords ? 'keyword.asc' : 'name.asc';
      const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&order=${order}`, {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      });
      const data = await response.json();
      return res.status(200).json(isKeywords ? { keywords: data } : { feeds: data });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // POST - tambah keyword baru (satu atau banyak)
  if (req.method === 'POST' && isKeywords) {
    const { keywords } = req.body;
    if (!keywords || !keywords.length) {
      return res.status(400).json({ error: 'No keywords provided' });
    }
    const rows = keywords.map(k => ({
      keyword: (typeof k === 'string' ? k : k.keyword).trim(),
      enabled: typeof k === 'string' ? true : (k.enabled !== false)
    })).filter(r => r.keyword);

    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/crawl_keywords?on_conflict=keyword`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Prefer': 'resolution=merge-duplicates,return=representation'
        },
        body: JSON.stringify(rows)
      });
      if (!response.ok) {
        const errText = await response.text();
        return res.status(response.status).json({ error: errText });
      }
      const saved = await response.json();
      return res.status(200).json({ success: true, synced: saved.length, keywords: saved });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // PATCH - update satu keyword (toggle enabled / ganti teks)
  if (req.method === 'PATCH' && isKeywords) {
    const { originalKeyword, keyword, enabled } = req.body;
    if (!originalKeyword) return res.status(400).json({ error: 'originalKeyword wajib diisi' });
    const patch = {};
    if (keyword !== undefined) patch.keyword = keyword;
    if (enabled !== undefined) patch.enabled = enabled;
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/crawl_keywords?keyword=eq.${encodeURIComponent(originalKeyword)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(patch)
      });
      if (!response.ok) return res.status(response.status).json({ error: await response.text() });
      const updated = await response.json();
      if (!updated.length) return res.status(404).json({ error: 'Keyword tidak ditemukan' });
      return res.status(200).json({ success: true, keyword: updated[0] });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // DELETE - hapus satu keyword
  if (req.method === 'DELETE' && isKeywords) {
    const { keyword } = req.body;
    if (!keyword) return res.status(400).json({ error: 'keyword wajib diisi' });
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/crawl_keywords?keyword=eq.${encodeURIComponent(keyword)}`, {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Prefer': 'return=representation'
        }
      });
      if (!response.ok) return res.status(response.status).json({ error: await response.text() });
      const deleted = await response.json();
      return res.status(200).json({ success: true, deleted: deleted.length });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // POST - tambah feed baru (satu atau banyak sekaligus, misal import CSV/TXT)
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
      const response = await fetch(`${SUPABASE_URL}/rest/v1/feeds?on_conflict=url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Prefer': 'resolution=merge-duplicates,return=representation'
        },
        body: JSON.stringify(rows)
      });
      if (!response.ok) {
        const errText = await response.text();
        return res.status(response.status).json({ error: errText });
      }
      const saved = await response.json();
      return res.status(200).json({ success: true, synced: saved.length, feeds: saved });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // PATCH - update satu feed (dicari berdasarkan URL lama), langsung ke DB
  if (req.method === 'PATCH') {
    const { originalUrl, name, url, enabled } = req.body;
    if (!originalUrl) return res.status(400).json({ error: 'originalUrl wajib diisi' });

    const patch = {};
    if (name !== undefined) patch.name = name;
    if (url !== undefined) { patch.url = url; patch.is_infonesia = url.includes('infonesia.net'); }
    if (enabled !== undefined) patch.enabled = enabled;

    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/feeds?url=eq.${encodeURIComponent(originalUrl)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(patch)
      });
      if (!response.ok) {
        const errText = await response.text();
        return res.status(response.status).json({ error: errText });
      }
      const updated = await response.json();
      if (!updated.length) return res.status(404).json({ error: 'Feed tidak ditemukan (mungkin sudah diubah/dihapus di device lain)' });
      return res.status(200).json({ success: true, feed: updated[0] });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // DELETE - hapus satu feed berdasarkan URL
  if (req.method === 'DELETE') {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url wajib diisi' });

    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/feeds?url=eq.${encodeURIComponent(url)}`, {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Prefer': 'return=representation'
        }
      });
      if (!response.ok) {
        const errText = await response.text();
        return res.status(response.status).json({ error: errText });
      }
      const deleted = await response.json();
      return res.status(200).json({ success: true, deleted: deleted.length });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
