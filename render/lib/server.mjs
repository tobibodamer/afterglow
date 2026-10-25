// Tiny static server for the render page + frame upload endpoint (ported from sandbox/render-test/lib/server.mjs).
//
// Serves the repository root, so the page is /scene/index.html, three is /node_modules/three/..., and data is
// /music/final/score.json, /build/anim/perf.bin etc. Binds to 127.0.0.1 only.
//
// POST /frame?i=<frame>&tag=<tag>&part=<k>&parts=<n>  body = raw RGBA bytes of slice k of frame i.
// The response is sent only after hooks.onFrame(i, tag, Buffer, searchParams) resolves, so the page's upload
// promise carries backpressure from the encoder all the way back into the render loop.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ktx2': 'image/ktx2', '.hdr': 'application/octet-stream', '.exr': 'application/octet-stream', '.bin': 'application/octet-stream',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.wasm': 'application/wasm', '.map': 'application/json',
  '.cube': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav', '.svg': 'image/svg+xml',
};

// Every file served with GET 200 is recorded in `served` (absolute path -> {size, mtimeMs}): the exact set of code,
// data and assets the page loaded, which render.mjs hashes into each chunk manifest (provenance for encode.mjs).
export function startServer(port = 0, hooks = {}, { root = REPO_ROOT, host = '127.0.0.1' } = {}) {
  const served = new Map();
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'POST' && url.pathname === '/frame') {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('error', (e) => console.error('[server] request error', e.code, e.message));
        req.on('end', async () => {
          const buf = Buffer.concat(chunks);
          try {
            if (!hooks.onFrame) throw new Error('no frame handler installed');
            await hooks.onFrame(+url.searchParams.get('i'), url.searchParams.get('tag') || '', buf, url.searchParams);
            res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok');
          } catch (e) {
            console.error('[server] frame handler failed:', e.message);
            res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end(String(e.message || e));
          }
        });
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
      let rel;
      try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
      let p = path.resolve(root, '.' + rel);
      if (p !== root && !p.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
      fs.stat(p, (err, st) => {
        if (!err && st.isDirectory()) { p = path.join(p, 'index.html'); }
        fs.stat(p, (err2, st2) => {
          if (err2 || !st2.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('404 ' + rel); }
          const headers = { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream',
            'Content-Length': st2.size, 'Cache-Control': 'no-cache' };
          res.writeHead(200, headers);
          if (req.method === 'HEAD') return res.end();
          served.set(p, { size: st2.size, mtimeMs: st2.mtimeMs });
          fs.createReadStream(p).on('error', () => res.destroy()).pipe(res);
        });
      });
    });
    // keep-alive races reset pipelined uploads (seen in render-test): long timeouts, no request timeout
    srv.keepAliveTimeout = 120000; srv.headersTimeout = 125000; srv.requestTimeout = 0;
    srv.on('clientError', (err, sock) => { if (err.code !== 'ECONNRESET') console.error('[server] clientError', err.code, err.message); try { sock.destroy(); } catch {} });
    srv.on('error', reject);
    srv.listen(port, host, () => resolve({ srv, served, port: srv.address().port, url: `http://${host}:${srv.address().port}` }));
  });
}
