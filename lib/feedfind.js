// Penemuan feed otomatis + pembaca sitemap berita Google News.
// Dipakai oleh api/feeds.js (resource=discover), api/crawl.js (membaca sumber sitemap/atom).
// Letaknya di lib/ (di luar api/) supaya tidak menambah jumlah fungsi Vercel Hobby.
const https = require('https');
const http = require('http');

const UA = 'Mozilla/5.0 (compatible; NewsBot/1.0)';

function isBlockedHost(host) {
  if (process.env.FEEDFIND_ALLOW_LOCAL === '1') return false; // hanya untuk pengujian lokal
  const h = String(host || '').toLowerCase();
  if (!h || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return h.includes(':') || h.startsWith('[');
}

// GET satu URL: ikuti redirect (maks 4), lewati sertifikat bermasalah (banyak media lokal), batasi ukuran dan waktu.
function fetchText(urlStr, opts = {}) {
  const timeout = opts.timeout || 3000, maxBytes = opts.maxBytes || 1500000;
  return new Promise((resolve) => {
    let hops = 0;
    const go = (u) => {
      let url;
      try { url = new URL(u); } catch (e) { return resolve({ ok: false, error: 'url tidak valid' }); }
      if (!/^https?:$/.test(url.protocol) || isBlockedHost(url.hostname)) return resolve({ ok: false, error: 'alamat tidak diizinkan' });
      const lib = url.protocol === 'https:' ? https : http;
      const req = lib.request({
        hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search, method: 'GET', rejectUnauthorized: false, timeout,
        headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5', 'Accept-Language': 'id-ID,id;q=0.9,en;q=0.5' }
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (++hops > 4) return resolve({ ok: false, error: 'terlalu banyak redirect' });
          let next; try { next = new URL(res.headers.location, url).toString(); } catch (e) { return resolve({ ok: false, error: 'redirect tidak valid' }); }
          return go(next);
        }
        const chunks = []; let size = 0, done = false;
        const finish = () => { if (done) return; done = true; resolve({ ok: res.statusCode < 400, status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), finalUrl: url.toString() }); };
        res.on('data', c => { size += c.length; chunks.push(c); if (size > maxBytes) { res.destroy(); finish(); } });
        res.on('end', finish); res.on('close', finish); res.on('error', finish);
      });
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
      req.on('error', (e) => resolve({ ok: false, error: e.code || e.message }));
      req.end();
    };
    go(urlStr);
  });
}

const decode = (t) => String(t || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (m, n) => { try { return String.fromCodePoint(+n); } catch (e) { return ' '; } }).trim();
const strip = (h) => decode(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// Ambil teks isi berita dari HTML halaman: utamakan <article>, kumpulkan paragraf <p> yang cukup panjang.
function extractBodyText(html, maxChars) {
  maxChars = maxChars || 7000;
  let h = String(html || '').replace(/<(script|style|noscript|nav|footer|aside|header|form|figure|iframe|svg)[\s\S]*?<\/\1>/gi, ' ');
  const art = h.match(/<article[\s\S]*?<\/article>/i);
  if (art && art[0].length > 800) h = art[0];
  const paras = [];
  const re = /<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi; let m;
  while ((m = re.exec(h))) {
    const t = strip(m[1]);
    if (t.length < 40) continue;
    if (/^(baca juga|baca lainnya|simak juga|follow|ikuti kami|editor:|penulis:|copyright|advertisement)/i.test(t)) continue;
    paras.push(t);
    if (paras.join('\n').length > maxChars) break;
  }
  return paras.join('\n').slice(0, maxChars);
}

function tag(block, name) {
  const m = block.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i'));
  return m ? decode(m[1]) : '';
}
function toISO(v) { if (!v) return ''; const d = new Date(v); return isNaN(d) ? '' : d.toISOString(); }

// ---- jenis dokumen ----
function looksLikeNewsSitemap(xml) { return /<urlset[\s>]/i.test(xml) && /<news:news[\s>]/i.test(xml); }
function looksLikeSitemapIndex(xml) { return /<sitemapindex[\s>]/i.test(xml); }
function looksLikePlainSitemap(xml) { return /<urlset[\s>]/i.test(xml) && !/<news:news[\s>]/i.test(xml); }
function looksLikeAtom(xml) { return /<feed[\s>][\s\S]*?<entry[\s>]/i.test(xml); }
function looksLikeRss(xml) { return /<rss[\s>]|<rdf:RDF[\s>]/i.test(xml) && /<item[\s>]/i.test(xml); }

// Sitemap berita Google News: <url><loc>..</loc><news:news>...<news:title>..</news:title><news:publication_date>..
function parseNewsSitemap(xml, feedUrl) {
  const out = [];
  const re = /<url>([\s\S]*?)<\/url>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const b = m[1];
    const url = tag(b, 'loc');
    const title = tag(b, 'news:title');
    if (!url || !title) continue;
    const name = tag(b, 'news:name');
    out.push({
      title, url, source: name || new URL(feedUrl).hostname.replace(/^www\./, ''),
      published_at: toISO(tag(b, 'news:publication_date')) || new Date().toISOString(),
      description: '', origin_api: 'rss'
    });
  }
  return out;
}

function parseAtom(xml, feedUrl) {
  const out = [];
  const siteTitle = strip((xml.match(/<feed[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '') || new URL(feedUrl).hostname;
  const re = /<entry[\s>]([\s\S]*?)<\/entry>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const b = m[1];
    const title = strip(tag(b, 'title'));
    const linkM = b.match(/<link[^>]+rel=["']alternate["'][^>]*href=["']([^"']+)["']/i) || b.match(/<link[^>]+href=["']([^"']+)["']/i);
    const url = linkM ? decode(linkM[1]) : '';
    if (!title || !url) continue;
    out.push({
      title, url, source: siteTitle,
      published_at: toISO(tag(b, 'published') || tag(b, 'updated')) || new Date().toISOString(),
      description: strip(tag(b, 'summary') || tag(b, 'content')).substring(0, 500), origin_api: 'rss'
    });
  }
  return out;
}

// RSS 2.0 sederhana (untuk contoh judul saat penemuan; crawler tetap memakai parseRSS miliknya)
function sampleRss(xml) {
  const out = []; const re = /<item[\s>]([\s\S]*?)<\/item>/gi; let m;
  while ((m = re.exec(xml)) !== null) {
    const b = m[1]; const title = strip(tag(b, 'title'));
    if (title) out.push({ title, published_at: toISO(tag(b, 'pubDate') || tag(b, 'dc:date')) });
  }
  return out;
}

function sitemapLocs(xml) {
  const out = []; const re = /<loc>([\s\S]*?)<\/loc>/gi; let m;
  while ((m = re.exec(xml)) !== null) out.push(decode(m[1]));
  return out;
}

// Ringkas hasil baca satu dokumen menjadi kandidat sumber, atau null kalau bukan sumber yang bisa dipakai
function classify(res, url) {
  if (!res || !res.ok || !res.body) return null;
  const xml = res.body;
  let type = '', items = [];
  if (looksLikeNewsSitemap(xml)) { type = 'sitemap-news'; items = parseNewsSitemap(xml, url); }
  else if (looksLikeAtom(xml)) { type = 'atom'; items = parseAtom(xml, url); }
  else if (looksLikeRss(xml)) { type = 'rss'; items = sampleRss(xml); }
  else return null;
  if (!items.length) return null;
  const dates = items.map(i => new Date(i.published_at).getTime()).filter(t => !isNaN(t));
  const newest = dates.length ? Math.max(...dates) : 0;
  return {
    type, url: res.finalUrl || url, items: items.length,
    newest: newest ? new Date(newest).toISOString() : '',
    ageDays: newest ? Math.max(0, Math.round((Date.now() - newest) / 86400000 * 10) / 10) : null,
    sample: items.slice(0, 3).map(i => ({ title: i.title, published_at: i.published_at || '' }))
  };
}

const COMMON_FEED_PATHS = ['/feed', '/feed/', '/rss', '/rss.xml', '/feed.xml', '/index.xml', '/atom.xml', '/rss/feed', '/?feed=rss2', '/index.php/feed'];
const COMMON_NEWS_SITEMAPS = ['/sitemap-news.xml', '/news-sitemap.xml', '/sitemap_news.xml', '/sitemap/news.xml', '/news_sitemap.xml'];

// Cari sumber terbaik untuk satu situs. siteInput boleh "domain.com" atau URL lengkap.
async function discoverFeed(siteInput, opts = {}) {
  const deadline = Date.now() + (opts.budgetMs || 8500);
  const left = () => Math.max(500, Math.min(3000, deadline - Date.now()));
  const notes = [];
  let raw = String(siteInput || '').trim();
  if (!raw) return { error: 'alamat situs kosong' };
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
  let origin;
  try { const u = new URL(raw); origin = u.origin; if (isBlockedHost(u.hostname)) return { error: 'alamat tidak diizinkan' }; } catch (e) { return { error: 'alamat situs tidak valid' }; }
  const host = new URL(origin).hostname.replace(/^www\./, '');

  // Tahap A (paralel): beranda, robots.txt, jalur feed umum, jalur sitemap berita umum, sitemap.xml
  const tried = new Set();
  const fetchOnce = (u) => { tried.add(u); return fetchText(u, { timeout: left() }); };
  const A = {
    home: fetchOnce(origin + '/'),
    robots: fetchOnce(origin + '/robots.txt'),
    sitemap: fetchOnce(origin + '/sitemap.xml'),
    feeds: COMMON_FEED_PATHS.map(p => ({ u: origin + p, p: fetchOnce(origin + p) })),
    news: COMMON_NEWS_SITEMAPS.map(p => ({ u: origin + p, p: fetchOnce(origin + p) }))
  };
  const [home, robots, sitemap] = await Promise.all([A.home, A.robots, A.sitemap]);
  const candidates = [];
  const seen = new Set();
  const add = (c) => { if (c && !seen.has(c.url)) { seen.add(c.url); candidates.push(c); } };

  for (const f of A.feeds) add(classify(await f.p, f.u));
  for (const n of A.news) add(classify(await n.p, n.u));

  // Nama media dari beranda
  let name = '';
  if (home && home.ok) {
    const h = home.body;
    const og = (h.match(/<meta[^>]+property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i) || h.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:site_name["']/i) || [])[1];
    name = strip(og || '') || strip((h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').split(/\s+[|\-–—]\s+/).pop() || '';
    if (name.length > 60) name = '';
  }
  if (!name) name = host;

  // Tahap B: alamat dari <link rel="alternate"> di beranda, Sitemap: di robots.txt, sitemap.xml
  const extra = [];
  if (home && home.ok) {
    const re = /<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/gi; let m;
    while ((m = re.exec(home.body)) !== null) {
      const href = (m[0].match(/href=["']([^"']+)["']/i) || [])[1];
      if (href) { try { extra.push(new URL(decode(href), origin).toString()); } catch (e) {} }
    }
  }
  const sitemapUrls = [];
  if (robots && robots.ok) {
    const re = /^\s*sitemap:\s*(\S+)/gim; let m;
    while ((m = re.exec(robots.body)) !== null) { try { sitemapUrls.push(new URL(m[1], origin).toString()); } catch (e) {} }
  }
  const toFetch = [...new Set(extra)].filter(u => !tried.has(u));
  const smRoots = [...new Set(sitemapUrls)].filter(u => !tried.has(u));
  const bRes = await Promise.all([...toFetch, ...smRoots].map(u => fetchOnce(u).then(r => ({ u, r }))));
  const indexes = [];
  if (sitemap && sitemap.ok && looksLikeSitemapIndex(sitemap.body)) indexes.push({ u: origin + '/sitemap.xml', body: sitemap.body });
  if (sitemap && sitemap.ok) add(classify(sitemap, origin + '/sitemap.xml'));
  for (const { u, r } of bRes) {
    if (!r || !r.ok) continue;
    if (looksLikeSitemapIndex(r.body)) indexes.push({ u, body: r.body });
    else add(classify(r, u));
  }

  // Tahap C: dari indeks sitemap, ambil anak yang namanya mengandung news/berita/terbaru
  const kids = [];
  indexes.forEach(ix => sitemapLocs(ix.body).forEach(l => { if (/news|berita|terbaru|recent|latest|post-recent/i.test(l) && !tried.has(l) && !/image|video|tag|category|page/i.test(l)) kids.push(l); }));
  const cRes = await Promise.all([...new Set(kids)].slice(0, 4).map(u => fetchOnce(u).then(r => ({ u, r }))));
  for (const { u, r } of cRes) add(classify(r, u));

  if (home && !home.ok) notes.push('Beranda tidak bisa dibuka (' + (home.error || ('HTTP ' + home.status)) + ').');
  const plain = (sitemap && sitemap.ok && looksLikePlainSitemap(sitemap.body)) ? 1 : 0;
  if (!candidates.length && plain) notes.push('Ada sitemap biasa, tapi tanpa judul berita (bukan sitemap berita), jadi belum bisa dipakai.');

  // Pilih yang terbaik: yang masih segar (<= 14 hari) didahulukan, lalu RSS/Atom sebelum sitemap
  const fresh = c => c.ageDays !== null && c.ageDays <= 14;
  const rank = c => (fresh(c) ? 0 : 10) + (c.type === 'sitemap-news' ? 1 : 0) + (c.ageDays || 0) / 1000;
  candidates.sort((a, b) => rank(a) - rank(b));
  const best = candidates[0] || null;
  if (best && !fresh(best)) notes.push('Sumber ditemukan tetapi berita terakhirnya sudah ' + best.ageDays + ' hari lalu; kemungkinan sudah tidak diperbarui.');
  return { site: origin, host, name, found: candidates, best, notes };
}


// Ringkasan isi halaman berita (og:description atau paragraf awal) untuk sumber sitemap yang tidak menyertakan deskripsi
function pageDescription(html) {
  const meta = (key) => {
    const m = html.match(new RegExp('<meta[^>]+(?:property|name)=["\']' + key + '["\'][^>]*content=["\']([^"\']*)["\']', 'i')) ||
      html.match(new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']' + key + '["\']', 'i'));
    return m ? strip(m[1]) : '';
  };
  const metaDesc = meta('og:description') || meta('description');
  const cleaned = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ');
  const paras = []; const re = /<p[^>]*>([\s\S]*?)<\/p>/gi; let m, total = 0;
  while ((m = re.exec(cleaned)) && total < 1200) { const t = strip(m[1]); if (t.length >= 60) { paras.push(t); total += t.length; } }
  const body = paras.join(' ');
  return (body.length > metaDesc.length ? body : (metaDesc || body)).slice(0, 800);
}

module.exports = {
  pageDescription,
  extractBodyText,
  isBlockedHost, fetchText, discoverFeed, classify,
  looksLikeNewsSitemap, looksLikeAtom, parseNewsSitemap, parseAtom, sitemapLocs
};
