const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

function cleanDescription(desc) {
  if (!desc) return '';
  return desc
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 500);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const batchSize = parseInt(req.query.batch) || 50;

  try {
    // Ambil artikel yang description-nya masih mengandung HTML mentah (tanda &lt; atau <a href)
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/articles?select=id,description&description=like.*%26lt%3B*&limit=${batchSize}`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      }
    );
    const articles = await response.json();

    if (!articles.length) {
      return res.status(200).json({ success: true, message: 'Tidak ada lagi description yang perlu dibersihkan', processed: 0 });
    }

    let processed = 0;
    for (const a of articles) {
      const clean = cleanDescription(a.description);
      await fetch(`${SUPABASE_URL}/rest/v1/articles?id=eq.${a.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({ description: clean })
      });
      processed++;
    }

    return res.status(200).json({ success: true, processed, note: 'Panggil lagi endpoint ini untuk batch berikutnya jika masih ada' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
