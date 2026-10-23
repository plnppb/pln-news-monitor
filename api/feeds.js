const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const FF = require('../lib/feedfind');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const isKeywords = req.query.resource === 'keywords';
  // Alias penggabungan nama spokesperson (lihat ?resource=spokesperson-aliases
  // di bawah) — murni mapping tampilan "nama A dianggap sama dengan nama B",
  // TIDAK mengubah data mentah artikel sama sekali, jadi gampang di-undo.
  const isAliases = req.query.resource === 'spokesperson-aliases';

  // GET ?resource=discover&url=<situs> : cari alamat RSS / sitemap berita sebuah media secara otomatis (tidak menyimpan apa pun)
  if (req.method === 'GET' && req.query.resource === 'discover') {
    if (req.query.secret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const out = await FF.discoverFeed(req.query.url);
      if (out.error) return res.status(400).json(out);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(out);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // GET - ambil semua feeds, ATAU keyword (bisa difilter ?category=), ATAU alias spokesperson
  if (req.method === 'GET') {
    try {
      if (isKeywords) {
        const category = req.query.category;
        let url = `${SUPABASE_URL}/rest/v1/crawl_keywords?select=*&order=keyword.asc`;
        if (category) url += `&category=eq.${encodeURIComponent(category)}`;
        const response = await fetch(url, {
          headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
        });
        const data = await response.json();
        return res.status(200).json({ keywords: data });
      }
      if (isAliases) {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/spokesperson_aliases?select=*&order=alias_name.asc`, {
          headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
        });
        const data = await response.json();
        return res.status(200).json({ aliases: data });
      }
      const response = await fetch(`${SUPABASE_URL}/rest/v1/feeds?select=*&order=name.asc`, {
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
      });
      const data = await response.json();
      return res.status(200).json({ feeds: data });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // POST - tambah satu alias (gabungkan satu nama ke nama kanonik yang dipilih user)
  if (req.method === 'POST' && isAliases) {
    const { alias_name, canonical_name } = req.body || {};
    if (!alias_name || !canonical_name) {
      return res.status(400).json({ error: 'alias_name dan canonical_name wajib diisi' });
    }
    if (alias_name.trim().toLowerCase() === canonical_name.trim().toLowerCase()) {
      return res.status(400).json({ error: 'Nama alias dan nama kanonik tidak boleh sama' });
    }
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/spokesperson_aliases?on_conflict=alias_name`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Prefer': 'resolution=merge-duplicates,return=representation'
        },
        body: JSON.stringify([{ alias_name: alias_name.trim(), canonical_name: canonical_name.trim() }])
      });
      if (!response.ok) return res.status(response.status).json({ error: await response.text() });
      const saved = await response.json();
      return res.status(200).json({ success: true, alias: saved[0] });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // DELETE - pisahkan lagi (hapus satu alias), dicari berdasarkan alias_name
  if (req.method === 'DELETE' && isAliases) {
    const { alias_name } = req.body || {};
    if (!alias_name) return res.status(400).json({ error: 'alias_name wajib diisi' });
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/spokesperson_aliases?alias_name=eq.${encodeURIComponent(alias_name)}`, {
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

  // POST - tambah keyword baru (satu atau banyak), bisa disertai kategori
  if (req.method === 'POST' && isKeywords) {
    const { keywords } = req.body;
    if (!keywords || !keywords.length) {
      return res.status(400).json({ error: 'No keywords provided' });
    }
    const rows = keywords.map(k => ({
      keyword: (typeof k === 'string' ? k : k.keyword).trim(),
      category: (typeof k === 'string' ? 'external' : (k.category || 'external')),
      enabled: typeof k === 'string' ? true : (k.enabled !== false)
    })).filter(r => r.keyword);

    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/crawl_keywords?on_conflict=keyword,category`, {
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

  // PATCH - update satu keyword (toggle enabled / ganti teks), dicari berdasarkan keyword+category
  if (req.method === 'PATCH' && isKeywords) {
    const { originalKeyword, originalCategory, keyword, enabled } = req.body;
    if (!originalKeyword) return res.status(400).json({ error: 'originalKeyword wajib diisi' });
    const patch = {};
    if (keyword !== undefined) patch.keyword = keyword;
    if (enabled !== undefined) patch.enabled = enabled;
    try {
      let url = `${SUPABASE_URL}/rest/v1/crawl_keywords?keyword=eq.${encodeURIComponent(originalKeyword)}`;
      if (originalCategory) url += `&category=eq.${encodeURIComponent(originalCategory)}`;
      const response = await fetch(url, {
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

  // DELETE - hapus satu keyword (dicari berdasarkan keyword+category)
  if (req.method === 'DELETE' && isKeywords) {
    const { keyword, category } = req.body;
    if (!keyword) return res.status(400).json({ error: 'keyword wajib diisi' });
    try {
      let url = `${SUPABASE_URL}/rest/v1/crawl_keywords?keyword=eq.${encodeURIComponent(keyword)}`;
      if (category) url += `&category=eq.${encodeURIComponent(category)}`;
      const response = await fetch(url, {
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
