const https = require('https');
const http = require('http');

// Ikuti HTTP redirect (3xx + header Location) satu langkah.
// Return null kalau responsnya bukan redirect (nggak bisa diresolve lewat cara ini).
function followRedirectOnce(urlStr) {
  return new Promise((resolve) => {
    try {
      const url = new URL(urlStr);
      const isHttps = url.protocol === 'https:';
      const lib = isHttps ? https : http;
      const req = lib.request({
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)' },
        timeout: 6000
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let loc = res.headers.location;
          if (loc.startsWith('/')) loc = url.origin + loc;
          res.resume();
          return resolve(loc);
        }
        res.resume();
        resolve(null);
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.end();
    } catch (e) {
      resolve(null);
    }
  });
}

// Google News RSS bungkus link asli di balik news.google.com/rss/articles/...
// Sejak 2024 formatnya nggak bisa lagi didecode langsung dari base64, jadi kita
// ikuti redirect HTTP-nya. Kalau Google nggak kasih redirect HTTP biasa (butuh
// JS), kita nyerah dan balikin URL Google-nya apa adanya — lebih baik dari error.
async function resolveGoogleNewsUrl(urlStr) {
  if (!urlStr || !urlStr.includes('news.google.com')) return urlStr;
  let current = urlStr;
  for (let i = 0; i < 5; i++) {
    const next = await followRedirectOnce(current);
    if (!next) break;
    current = next;
    if (!current.includes('news.google.com')) break;
  }
  return current;
}

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
  // Batasi per request biar nggak timeout serverless function
  const limited = urls.slice(0, 30);

  const resolved = {};
  await Promise.all(limited.map(async (u) => {
    resolved[u] = await resolveGoogleNewsUrl(u);
  }));

  return res.status(200).json({ resolved });
};
