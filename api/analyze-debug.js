// Test endpoint sementara untuk debug Gemini
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const secret = req.query.secret;
  if (secret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  
  if (!GEMINI_API_KEY) return res.status(200).json({ error: 'GEMINI_API_KEY tidak ada di env' });

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Balas hanya dengan JSON: {"tone":"positif"}' }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 50 }
        })
      }
    );
    const data = await response.json();
    return res.status(200).json({ 
      gemini_status: response.status,
      gemini_response: data,
      key_prefix: GEMINI_API_KEY.substring(0, 8) + '...'
    });
  } catch (e) {
    return res.status(200).json({ error: e.message });
  }
};
