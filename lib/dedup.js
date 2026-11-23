// Kunci pembanding untuk mendeteksi berita yang sama tetapi URL-nya beda (mis. versi Google News vs link asli).
function titleKey(t) {
  let x = String(t || '').toLowerCase();
  const m = x.match(/^(.*\S)\s+[-|–—]\s+([^-|–—]{2,40})$/); // buang akhiran " - NamaMedia"
  if (m) x = m[1];
  return x.replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}
function sourceKey(s) {
  return String(s || '').toLowerCase().replace(/berita terkini|terkini|terbaru|\.com|\.id|\.co\.id|\.co|www\./g, '').replace(/[^a-z0-9]/g, '');
}
function sameOutlet(a, b) { return !!a && !!b && (a === b || a.indexOf(b) >= 0 || b.indexOf(a) >= 0); }

// Kelompokkan baris yang judul + medianya sama. Mengembalikan [{keep, dups:[...]}].
// Yang dipertahankan: terkunci manual > sudah dianalisis > paling awal masuk.
function findDuplicateGroups(rows) {
  const groups = [];
  const byKey = new Map();
  rows.forEach(r => {
    const k = titleKey(r.title); if (k.length < 15) return;
    const sk = sourceKey(r.source);
    const list = byKey.get(k) || [];
    const hit = list.find(g => sameOutlet(g.sk, sk));
    if (hit) hit.items.push(r); else { const g = { sk, items: [r] }; list.push(g); byKey.set(k, list); groups.push(g); }
  });
  const score = r => (r.manual_locked ? 4 : 0) + (r.resume ? 2 : 0) + (r.tone ? 1 : 0);
  return groups.filter(g => g.items.length > 1).map(g => {
    const s = g.items.slice().sort((a, b) => score(b) - score(a) || new Date(a.created_at || a.published_at) - new Date(b.created_at || b.published_at));
    return { keep: s[0], dups: s.slice(1) };
  });
}
module.exports = { titleKey, sourceKey, sameOutlet, findDuplicateGroups };
