// Node helpers for the QC page: static server rooted at the project, headless Chrome (GPU), page handle.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { launchWithGpuLock } from '../../render/lib/gpulock.mjs';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.bin': 'application/octet-stream' };

export async function startServer() {
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const p = path.join(ROOT, u);
    if (!p.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    fs.readFile(p, (err, data) => {
      if (err) { res.writeHead(404); return res.end('404'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(data);
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { srv, url: `http://127.0.0.1:${srv.address().port}` };
}

export async function openQC({ glb, piano = 'simple', w = 1280, h = 960 } = {}) {
  const { srv, url } = await startServer();
  const browser = await launchWithGpuLock(puppeteer, {   // one GPU client machine-wide (render/lib/gpulock.mjs)
    executablePath: process.env.AG_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true,
    args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-gpu-watchdog', '--force_high_performance_gpu', '--no-first-run', '--mute-audio', `--window-size=${w},${h}`],
    defaultViewport: { width: w, height: h }, protocolTimeout: 0,
  }, 'perf-qc');
  const page = await browser.newPage();
  page.on('console', (m) => console.log('[page]', m.text()));
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`${url}/perf/qc/qc.html`);
  await page.waitForFunction('window.ready === true');
  const info = await page.evaluate((g, p) => window.QC.init({ glb: g, piano: p }), glb, piano);
  return { page, browser, srv, url, info, close: async () => { await browser.close(); srv.close(); } };
}
export function saveDataUrl(file, dataUrl) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64')); }
