// Membongkar link Google News (news.google.com/rss/articles/CBM...) menjadi alamat berita aslinya.
// Dua jalur, sama seperti pustaka googlenewsdecoder:
//  1) Format lama: alamat asli tertanam di dalam ID (base64) -> dibongkar langsung, tanpa jaringan.
//  2) Format baru (ID berawalan "AU_yqL"): ambil halaman artikel Google untuk membaca tanda tangan + stempel
//     waktu, lalu tanya endpoint batchexecute Google untuk alamat aslinya.
// Google bisa mengubah jalur kedua kapan saja; karena itu hasilnya selalu dikembalikan dengan keterangan tahap
// (stage), dan pemanggil harus siap kalau gagal.

function articleId(url) {
  const m = String(url || '').match(/news\.google\.com\/(?:rss\/)?(?:articles|read)\/([^?#/]+)/i);
  return m ? m[1] : '';
}

function decodeLegacy(id) {
  try {
    let b = Buffer.from(id.replace(/-/g, '+').replace(/_/g, '/') + '==', 'base64');
    const pre = Buffer.from([0x08, 0x13, 0x22]), suf = Buffer.from([0xd2, 0x01, 0x00]);
    if (b.slice(0, 3).equals(pre)) b = b.slice(3);
    if (b.length >= 3 && b.slice(b.length - 3).equals(suf)) b = b.slice(0, b.length - 3);
    if (!b.length) return '';
    const len = b[0];
    const s = (len >= 0x80 ? b.slice(2, len + 1) : b.slice(1, len + 1)).toString('utf8');
    if (/^https?:\/\//i.test(s)) return s;
    return '';
  } catch (e) { return ''; }
}

async function timedFetch(url, opts, ms) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, Object.assign({}, opts, { signal: ctrl.signal })); } finally { clearTimeout(t); }
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function decodeViaGoogle(id, timeoutMs) {
  // a) halaman artikel -> signature & timestamp
  let html = '';
  for (const u of ['https://news.google.com/articles/' + id + '?hl=en-US&gl=US&ceid=US:en', 'https://news.google.com/rss/articles/' + id + '?hl=en-US&gl=US&ceid=US:en']) {
    try {
      const r = await timedFetch(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } }, timeoutMs);
      html = await r.text();
      if (/data-n-a-sg=/.test(html)) break;
    } catch (e) { html = ''; }
  }
  const sg = (html.match(/data-n-a-sg="([^"]+)"/) || [])[1], ts = (html.match(/data-n-a-ts="([^"]+)"/) || [])[1];
  if (!sg || !ts) return { error: 'tanda tangan tidak ditemukan di halaman Google', stage: 'page' };
  // b) batchexecute
  const inner = '["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"' + id + '",' + ts + ',"' + sg + '"]';
  const fReq = JSON.stringify([[['Fbv4je', inner]]]);
  try {
    const r = await timedFetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': UA },
      body: 'f.req=' + encodeURIComponent(fReq)
    }, timeoutMs);
    const txt = await r.text();
    const part = txt.split('\n\n')[1];
    if (!part) return { error: 'balasan Google tidak dikenali (HTTP ' + r.status + ')', stage: 'batch' };
    const parsed = JSON.parse(part.slice(0, part.lastIndexOf(']') + 1));
    const url = JSON.parse(parsed[0][2])[1];
    if (/^https?:\/\//i.test(url)) return { url };
    return { error: 'alamat asli tidak ada di balasan', stage: 'batch' };
  } catch (e) { return { error: (e.name === 'AbortError' ? 'timeout' : e.message), stage: 'batch' }; }
}

// Return { url, stage } bila berhasil; { error, stage } bila gagal; { url, stage:'bukan-google' } bila bukan link Google News.
async function decodeGoogleNews(link, opts) {
  opts = opts || {};
  if (!/news\.google\.com/i.test(link || '')) return { url: link, stage: 'bukan-google' };
  const id = articleId(link);
  if (!id) return { error: 'ID artikel tidak ditemukan di link', stage: 'id' };
  const legacy = decodeLegacy(id);
  if (legacy) return { url: legacy, stage: 'legacy' };
  const g = await decodeViaGoogle(id, opts.timeout || 4000);
  return g.url ? { url: g.url, stage: 'batchexecute' } : g;
}

module.exports = { decodeGoogleNews, decodeLegacy, articleId };
