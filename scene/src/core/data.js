// Data loading for modules: JSON / binary / text by URL, cached, optional entries resolve to null when missing.
// URLs are resolved against the server root (the repository), e.g. '/music/final/score.json'.

const cache = new Map();

function kindOf(url, type) {
  if (type) return type;
  if (/\.json(\?|$)/i.test(url)) return 'json';
  if (/\.(txt|cube|csv|glsl)(\?|$)/i.test(url)) return 'text';
  return 'binary';
}

/** load one URL -> parsed JSON | ArrayBuffer | string. { optional: true } resolves null on 404. */
export function loadData(url, { type, optional = false } = {}) {
  const kind = kindOf(url, type);
  const key = `${kind}|${url}`;
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) {
        if (optional && res.status === 404) return null;
        throw new Error(`data ${url}: HTTP ${res.status}`);
      }
      if (kind === 'json') return res.json();
      if (kind === 'text') return res.text();
      return res.arrayBuffer();
    })());
  }
  return cache.get(key);
}

/** load a { key: url | {url, type, optional} } map in parallel -> { key: value } */
export async function loadDataMap(spec = {}) {
  const out = {}, entries = Object.entries(spec);
  const vals = await Promise.all(entries.map(([, v]) => (typeof v === 'string' ? loadData(v) : loadData(v.url, v))));
  entries.forEach(([k], i) => { out[k] = vals[i]; });
  return out;
}

/** HEAD request: does a URL exist? (used to pick real modules over placeholders) */
export async function urlExists(url) {
  try { const r = await fetch(url, { method: 'HEAD', cache: 'no-cache' }); return r.ok; } catch { return false; }
}
