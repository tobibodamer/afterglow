// One render session = static server + headless Chrome + the render page, initialised and GPU-checked.
// Every driver (still, render, determinism) goes through this, so flags, checks and logging are identical.
//
// Health: the page throws on a lost WebGL context (scene/src/core/gpu.js watchContext), and the session also watches
// the page itself: a CONTEXT_LOST console message, a page crash or a browser disconnect marks the session unhealthy,
// and assertHealthy() throws, so drivers stop at the next frame instead of writing frames from a broken session.
import { startServer } from './server.mjs';
import { launchChrome, assertGpu } from './chrome.mjs';
import { startForeignWatch } from './gpulock.mjs';

const NOISE = [/X4122/, /X3595/, /GPU stall due to ReadPixels/, /DevTools listening/, /Automatic fallback to software WebGL/];
const CONTEXT_LOST = /CONTEXT_LOST_WEBGL|WebGL context LOST|Context Lost/i;

export async function openSession({ width = 1920, height = 1080, init = {}, verbose = false, log = console.log } = {}) {
  let handler = null;
  // AG_SERVE_ROOT: serve a frozen snapshot of the repository (render/snapshot.mjs) instead of the live tree, so a long
  // render or a determinism check is immune to module owners editing scene/ meanwhile (docs/INTEGRATION.md)
  const root = process.env.AG_SERVE_ROOT ? process.env.AG_SERVE_ROOT : undefined;
  if (root) log(`[session] serving the snapshot ${root}`);
  const { srv, served, port, url } = await startServer(0, {
    onFrame: (i, tag, buf, q) => { if (!handler) throw new Error('no frame handler'); return handler(i, tag, buf, q); },
  }, root ? { root } : {});
  const health = { contextLost: 0, crashed: null, disconnected: false };
  let browser;
  try {
    browser = await launchChrome({ width, height });
    browser.on('disconnected', () => { health.disconnected = true; });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => { errors.push(e.message); log('[pageerror]', e.message); });
    page.on('error', (e) => { health.crashed = e.message; log('[page crashed]', e.message); });
    page.on('console', (m) => {
      const t = m.text(); const type = m.type();
      if (CONTEXT_LOST.test(t)) health.contextLost++;
      if (NOISE.some((re) => re.test(t))) return;
      // 404s are expected: HEAD probes for real modules / shots.js and optional data files (they resolve to null)
      if (!verbose && /Failed to load resource: the server responded with a status of 404/.test(t)) return;
      if (verbose || type === 'error' || type === 'warn' || type === 'warning' || /^\[AG\]/.test(t)) log(`[page:${type}]`, t.slice(0, 600));
    });
    page.on('requestfailed', (r) => { if (r.method() !== 'HEAD' && !/favicon/.test(r.url())) log('[requestfailed]', r.url(), r.failure()?.errorText); });
    page.on('response', (r) => {
      // from a snapshot every GET must be there (a 404 would silently drop an optional file the live tree has)
      if (r.status() === 404 && (verbose || (root && r.request().method() === 'GET'))) log('[404]', r.request().method(), r.url());
    });
    await page.goto(`${url}/scene/index.html`, { waitUntil: 'load' });
    await page.waitForFunction('window.AG && window.AG.ready === true', { timeout: 60000 });
    const info = await page.evaluate((o) => window.AG.init(o), { width, height, ...init });
    assertGpu(info.gpu?.renderer);
    // while this session holds the GPU slot: pause before a frame while another program's headless renderer is active
    // (render/lib/gpulock.mjs startForeignWatch; the pause is logged, pixels and page timings are unaffected)
    const foreign = startForeignWatch({ label: 'session', log: (s) => log(s) });
    browser.on('disconnected', () => foreign.stop());
    const assertHealthy = (where = '') => {
      const why = health.crashed ? `page crashed (${health.crashed})` : health.disconnected ? 'browser disconnected'
        : health.contextLost ? `WebGL context lost (${health.contextLost} console report(s))` : null;
      if (why) throw new Error(`render session unhealthy${where ? ` at ${where}` : ''}: ${why}`);
    };
    return {
      page, browser, port, url, info, errors, health, assertHealthy,
      /** files the page has loaded so far (absolute path -> {size, mtimeMs}) */
      servedFiles: () => new Map(served),
      setFrameHandler(fn) { handler = fn; },
      renderFrame: async (frame, opts = {}) => { await foreign.waitIdle(); const r = await page.evaluate((f, o) => window.AG.renderFrame(f, o), frame, opts); assertHealthy(`frame ${frame}`); return r; },
      foreignWatch: () => foreign.state(),
      // checks only: final pass again on the last accumulation (e.g. { debugView: 'nolut' }), same transfer options
      regrade: async (opts = {}) => { const r = await page.evaluate((o) => window.AG.regrade(o), opts); assertHealthy('regrade'); return r; },
      flush: async () => { const r = await page.evaluate(() => window.AG.flush()); assertHealthy('flush'); return r; },
      pageInfo: () => page.evaluate(() => window.AG.info()),
      close: () => { foreign.stop(); return closeAll(browser, srv, log); },
    };
  } catch (e) {
    await closeAll(browser, srv, log);
    throw e;
  }
}

const timeout = (ms) => new Promise((r) => setTimeout(r, ms, 'timeout'));

// Bounded shutdown: Browser.close normally takes well under a second, but after a failure it has been seen to take
// minutes. A graceful close gets AG_CLOSE_TIMEOUT_MS (default 90 s: killing Chrome while its GPU process is still
// tearing down is avoided after the 0x119 video-scheduler bluescreens); only then is the process killed (last resort,
// so a hung browser cannot hold the GPU lock forever). The server is closed after 5 s more.
async function closeAll(browser, srv, log) {
  const t0 = Date.now(), proc = browser?.process?.();
  let how = 'closed';
  if (browser) {
    const r = await Promise.race([browser.close().then(() => 'ok', () => 'error'), timeout(+(process.env.AG_CLOSE_TIMEOUT_MS || 90000))]);
    if (r !== 'ok') how = `Browser.close ${r}`;
    if (proc && proc.exitCode === null && proc.signalCode === null) { try { proc.kill('SIGKILL'); how += ', killed'; } catch {} }
  }
  const tb = Date.now() - t0;
  srv.closeAllConnections();
  const rs = await Promise.race([new Promise((r) => srv.close(() => r('ok'))), timeout(5000)]);
  const ms = Date.now() - t0;
  if (ms > 3000 || how !== 'closed' || rs !== 'ok') log(`[session] close took ${ms} ms (browser ${tb} ms: ${how}; server ${rs})`);
}
