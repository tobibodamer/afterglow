// Machine-wide GPU semaphore. Two video-scheduler bluescreens (bugcheck 0x119 VIDEO_SCHEDULER_INTERNAL_ERROR,
// 2026-10-21 16:42 and 23:22) happened while several headless Chrome renderers and Blender shared the Radeon 780M.
// Every process that renders on the GPU takes a slot first; AG_GPU_SLOTS (default 1) slots exist machine-wide.
// Locks are files in build/locks; a slot whose owner process is gone (or older than 4 h) is reclaimed.
//
//   import { launchWithGpuLock, withGpu } from '.../render/lib/gpulock.mjs'
//   const browser = await launchWithGpuLock(puppeteer, launchOptions, 'my-harness')   // released on browser close
//   await withGpu('label', async () => { ... })
//   node render/lib/gpulock.mjs run --label blender-eevee -- <command> [args...]       (CLI wrapper, e.g. Blender)
//   node render/lib/gpulock.mjs status
//   node render/lib/gpulock.mjs foreign          (active headless GPU jobs of OTHER programs; the taker waits for them)
//   startForeignWatch({ label })                 (while holding: pause our frames while such a job runs; session.mjs)
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = process.env.AG_GPU_LOCK_DIR || path.join(ROOT, 'build', 'locks');
const SLOTS = Math.max(1, Number(process.env.AG_GPU_SLOTS || 1));
const STALE_MS = 4 * 3600e3;

let held = null;   // { file, count }: re-entrant per process, so one process never deadlocks on its own slot

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
function readLock(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }

function tryTake(file, label) {
  try {
    const fd = fs.openSync(file, 'wx');
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, label, since: new Date().toISOString() }));
    fs.closeSync(fd);
    return true;
  } catch (e) {
    if (e.code === 'EEXIST' || e.code === 'EPERM' || e.code === 'EBUSY') return false;
    throw e;
  }
}

function reclaimIfStale(file) {
  const info = readLock(file);
  if (!info) return; // half-written or just released: look again on the next poll
  const age = Date.now() - Date.parse(info.since);
  if (!alive(info.pid) || age > STALE_MS) {
    console.error(`[gpulock] reclaiming ${path.basename(file)} from pid ${info.pid} (${info.label}, ${alive(info.pid) ? 'stale' : 'dead'})`);
    fs.rmSync(file, { force: true });
  }
}

// Optional shared machine-wide GPU lock with other programs (fix round 4, 2026-10-22 21:10): on the build machine, other
// GPU projects ran their jobs through a wrapper that takes one lock file (exclusive create 'wx', the holder's pid as
// plain text, a lock whose pid is gone is removed). When AG_GPU_SHARED_LOCK names that file, holding our slot we also
// take that lock, so Afterglow and those programs never render on the GPU at the same time. Order: our slot first, then
// the shared lock (no cycle: the other programs take only the shared one). When the variable is unset, the first line of
// <lock dir>/shared-lock.path (a local, untracked file) names it instead. Neither set = no shared lock (the default);
// nothing is created when the lock's folder does not exist.
function localSharedLock() { try { return fs.readFileSync(path.join(DIR, 'shared-lock.path'), 'utf8').split(/\r?\n/)[0].trim() || null; } catch { return null; } }
const SHARED = process.env.AG_GPU_SHARED_LOCK || localSharedLock();
const sharedOn = () => !!SHARED && fs.existsSync(path.dirname(SHARED));
let sharedHeld = false;
function sharedHolder() { try { return +fs.readFileSync(SHARED, 'utf8') || 0; } catch { return 0; } }
function tryTakeShared() {
  try {
    const fd = fs.openSync(SHARED, 'wx'); fs.writeSync(fd, String(process.pid)); fs.closeSync(fd);
    sharedHeld = true; return { ok: true };
  } catch (e) {
    if (!(e.code === 'EEXIST' || e.code === 'EPERM' || e.code === 'EBUSY')) throw e;
    const pid = sharedHolder();
    if (pid === process.pid) { sharedHeld = true; return { ok: true }; }
    if (pid && !alive(pid)) {
      try { fs.unlinkSync(SHARED); console.error(`[gpulock] removed a stale shared GPU lock (pid ${pid} is gone)`); } catch { /* someone else did */ }
      return { ok: false, pid: 0 };
    }
    return { ok: false, pid };
  }
}
function releaseShared() {
  if (!sharedHeld) return;
  try { if (sharedHolder() === process.pid) fs.unlinkSync(SHARED); } catch { /* already gone */ }
  sharedHeld = false;
}
function processCmd(pid) {
  try {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${+pid}").CommandLine`], { encoding: 'utf8', timeout: 20e3, windowsHide: true });
    return (r.stdout || '').trim().slice(0, 160);
  } catch { return ''; }
}

function releaseSync() {
  releaseShared();
  if (!held) return;
  const info = readLock(held.file);
  if (info && info.pid === process.pid) fs.rmSync(held.file, { force: true });
  held = null;
}
// No signal handlers on purpose (they would change how importing scripts shut down); a killed owner's slot is
// reclaimed by the next waiter because its pid is gone.
process.on('exit', releaseSync);

// Foreign GPU jobs (fix round 4, after the third 0x119 at 2026-10-22 18:27, which happened while NO Afterglow job ran
// but another project's headless Chrome (Remotion chrome-headless-shell) rendered outside this lock): when a slot is
// free, the taker also checks for ACTIVE headless-browser GPU processes that are not ours (a GPU process whose browser
// runs --headless or is a *headless* executable, using > 0.4 s CPU in a 4 s window; idle leftovers do not count) and
// gives the slot back and waits while any exist. The user's own desktop Chrome/Electron apps are never headless.
// AG_GPU_FOREIGN=0 disables the check. Windows only.
// Probe failures are TRANSIENT (final freeze, 2026-10-24): until then one failed CIM query (seen in q7_v8.log l.101 and
// q7_probe.log l.50, both with empty stderr: a process exiting during the enumeration or the 30 s timeout under load)
// switched the guard off for the rest of the process and reset the watch's `active` to [], so our frames then ran next to
// the foreign renders. Now a failure keeps the last known state, is logged and retried on the next probe; the guard is
// given up only after AG_GPU_FOREIGN_MAX_FAILS (default 20) consecutive failures. Get-CimInstance runs with
// -ErrorAction SilentlyContinue, and output that parses is used even when PowerShell's exit code is non-zero.
// AG_GPU_FOREIGN_FAIL_TEST=K (test hook) makes the first K probes of the process fail.
const FOREIGN_PS = "$p = Get-CimInstance Win32_Process -Filter \"Name like 'chrome%' or Name like 'msedge%' or Name like '%headless%'\" -ErrorAction SilentlyContinue; " +
  "@($p | ForEach-Object { [pscustomobject]@{ id = $_.ProcessId; pp = $_.ParentProcessId; n = $_.Name; " +
  "t = [double]($_.KernelModeTime + $_.UserModeTime); c = [string]$_.CommandLine } }) | ConvertTo-Json -Compress -Depth 2";
const FOREIGN_PROBE_TIMEOUT_MS = 45e3;
const FOREIGN_MAX_FAILS = Math.max(1, Number(process.env.AG_GPU_FOREIGN_MAX_FAILS) || 20);
let forcedProbeFails = Math.max(0, Number(process.env.AG_GPU_FOREIGN_FAIL_TEST) || 0);
// test hook: AG_GPU_FOREIGN_FAIL_AT='1,4' fails exactly those (1-based) PowerShell probe calls of this process
const forcedFailAt = new Set(String(process.env.AG_GPU_FOREIGN_FAIL_AT || '').split(',').filter(Boolean).map(Number));
let probeCalls = 0;
let foreignProbeBroken = false, foreignFails = 0, lastForeign = [];
const FOREIGN_CPU_S = Number(process.env.AG_GPU_FOREIGN_CPU ?? 0.4);   // CPU seconds per window that count as active (test hook)
// test hook: AG_GPU_FOREIGN_ONLY=<regex> counts only browsers whose command line matches (scratch tests next to real load)
const FOREIGN_ONLY = process.env.AG_GPU_FOREIGN_ONLY ? new RegExp(process.env.AG_GPU_FOREIGN_ONLY, 'i') : null;
function parseProbe(stdout) {
  let list = JSON.parse(String(stdout).trim() || '[]');
  if (!Array.isArray(list)) list = [list];
  const byId = new Map(list.map((p) => [p.id, p]));
  const out = new Map();
  for (const p of list) {
    if (!/--type=gpu-process/.test(p.c)) continue;
    const parent = byId.get(p.pp);
    if (FOREIGN_ONLY && !FOREIGN_ONLY.test(parent?.c || '')) continue;
    const headless = /headless/i.test(p.n) || (parent && (/--headless/.test(parent.c) || /headless/i.test(parent.n)));
    if (headless) out.set(p.id, { pid: p.id, browserPid: p.pp, browserParent: parent ? parent.pp : null, exe: (parent?.c || p.c).replace(/^"?([^"]*?\.exe).*$/i, '$1'), t: p.t });
  }
  return out;
}
// a JSON array (or one object) on stdout is a usable probe whatever the exit code; anything else is a failure
function probeOutput(stdout, why) {
  const s = String(stdout || '').trim();
  if (s && (s[0] === '[' || s[0] === '{')) { try { return parseProbe(s); } catch { /* fall through */ } }
  throw new Error(`probe ${why}${s ? `, unparsable output '${s.slice(0, 80)}'` : ', no output'}`);
}
function forcedFailure() {
  probeCalls++;
  if (forcedProbeFails > 0) { forcedProbeFails--; return new Error('forced probe failure (AG_GPU_FOREIGN_FAIL_TEST)'); }
  if (forcedFailAt.has(probeCalls)) return new Error(`forced probe failure at call ${probeCalls} (AG_GPU_FOREIGN_FAIL_AT)`);
  return null;
}
function headlessGpuProcs() {
  const ff = forcedFailure(); if (ff) throw ff;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', FOREIGN_PS], { encoding: 'utf8', timeout: FOREIGN_PROBE_TIMEOUT_MS, windowsHide: true });
  return probeOutput(r.stdout, `exit ${r.status}${r.signal ? ` signal ${r.signal}` : ''}${r.error ? ` (${r.error.message})` : ''}${r.stderr ? ` stderr '${String(r.stderr).trim().slice(0, 120)}'` : ''}`);
}
/** Active foreign headless GPU processes (CPU-time delta over windowMs), or [] when the probe is off/given up. A failed
 *  probe returns the last successful result marked `probeFailed: true` (the taker treats that as "not known to be free"). */
export async function foreignGpuJobs(windowMs = 4000) {
  if (process.platform !== 'win32' || process.env.AG_GPU_FOREIGN === '0' || foreignProbeBroken) return [];
  try {
    const a = headlessGpuProcs();
    let act = [];
    if (a.size) {
      await sleep(windowMs);
      const b = headlessGpuProcs();
      for (const [pid, q] of b) {
        const p = a.get(pid);
        if (p && (q.t - p.t) / 1e7 > FOREIGN_CPU_S) act.push({ ...q, cpuS: +((q.t - p.t) / 1e7).toFixed(2) });
      }
    }
    if (foreignFails) console.error(`[gpulock] foreign-GPU probe works again after ${foreignFails} failure(s)`);
    foreignFails = 0; lastForeign = act;
    return act;
  } catch (e) {
    foreignFails++;
    if (foreignFails >= FOREIGN_MAX_FAILS) {
      foreignProbeBroken = true;
      console.error(`[gpulock] foreign-GPU probe failed ${foreignFails} times in a row (${e.message}); continuing without it`);
      return [];
    }
    console.error(`[gpulock] foreign-GPU probe failed (${e.message}); transient ${foreignFails}/${FOREIGN_MAX_FAILS}, keeping the last result (${lastForeign.length} active) and retrying`);
    return Object.assign([...lastForeign], { probeFailed: true });
  }
}

// Mid-hold foreign watch (fix round 4, 2026-10-23 04:00): the check above runs only when a slot is taken, so a foreign
// headless renderer that STARTS while we hold the slot (seen at 04:00: another project's `node shot.mjs ... hres=4096`
// headless Chrome, outside every lock, next to an Afterglow render) runs concurrently with us for its whole length -
// the situation the 0x119 guard exists to avoid, and the reason page times of the same frames varied up to 2x between
// sessions. startForeignWatch() probes in the background (async, every everyMs) while a session holds the slot;
// waitIdle(), called by render/lib/session.mjs before every frame, pauses OUR rendering (the slot stays held, so no
// other Afterglow job starts) until the foreign job is idle, then resumes. Our own browser (a child of this process) is
// never counted. Pixels are unaffected (pure functions of t); page timings exclude the pause. AG_GPU_FOREIGN=0 disables it.
function headlessGpuProcsAsync() {
  return new Promise((resolve, reject) => {
    const ff = forcedFailure(); if (ff) return reject(ff);
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', FOREIGN_PS], { encoding: 'utf8', timeout: FOREIGN_PROBE_TIMEOUT_MS, windowsHide: true }, (err, stdout, stderr) => {
      // err.message repeats the whole command line; log only what tells the cause apart (exit code, kill by timeout, stderr)
      const why = err ? `exit ${err.code ?? '?'}${err.killed ? ` (killed${err.signal ? ` ${err.signal}` : ''}: timeout ${FOREIGN_PROBE_TIMEOUT_MS / 1e3} s?)` : ''}${String(stderr || '').trim() ? ` stderr '${String(stderr).trim().slice(0, 120)}'` : ''}` : 'exit 0';
      try { resolve(probeOutput(stdout, why)); } catch (e) { reject(e); }
    });
  });
}
// Probe interval 15 s (was 60 s until 2026-10-23 07:15: cost6 showed a foreign `tools/shot.mjs` render running ~60 s next
// to our frames before the pause; one probe = one powershell CIM query, ~1 s CPU). AG_GPU_FOREIGN_EVERY_S overrides it.
const FOREIGN_EVERY_MS = (Number(process.env.AG_GPU_FOREIGN_EVERY_S) || 15) * 1e3;
export function startForeignWatch({ label = 'gpu', everyMs = FOREIGN_EVERY_MS, windowMs = 4000, maxPauseMs = 3 * 3600e3, log = (s) => console.error(s) } = {}) {
  const off = { waitIdle: async () => 0, stop() {}, state: () => ({ off: true }) };
  if (process.platform !== 'win32' || process.env.AG_GPU_FOREIGN === '0') return off;
  let active = [], running = null, stopped = false, broken = false, pausedMs = 0, pauses = 0, fails = 0, failsTotal = 0;
  const notOurs = (q) => q.browserParent !== process.pid && q.browserPid !== process.pid;
  async function probe() {
    const a = await headlessGpuProcsAsync();
    if (![...a.values()].some(notOurs)) return [];
    await sleep(windowMs);
    const b = await headlessGpuProcsAsync(); const act = [];
    for (const [pid, q] of b) { const p = a.get(pid); if (p && notOurs(q) && (q.t - p.t) / 1e7 > FOREIGN_CPU_S) act.push({ ...q, cpuS: +((q.t - p.t) / 1e7).toFixed(2) }); }
    return act;
  }
  // a failed probe is transient: keep the previous `active` (a pause stays a pause), log, retry on the next tick; give
  // the watch up (fail open) only after FOREIGN_MAX_FAILS consecutive failures (final freeze 2026-10-24, see FOREIGN_PS)
  const onOk = (x) => { if (fails) log(`[gpulock] ${label}: mid-hold foreign probe works again after ${fails} failure(s)`); fails = 0; active = x; };
  const onFail = (e) => {
    fails++; failsTotal++;
    if (fails >= FOREIGN_MAX_FAILS) { broken = true; active = []; log(`[gpulock] ${label}: mid-hold foreign probe failed ${fails} times in a row (${e.message}); continuing without it`); }
    else log(`[gpulock] ${label}: mid-hold foreign probe failed (${e.message}); transient ${fails}/${FOREIGN_MAX_FAILS}, keeping the previous state (${active.length} active) and retrying`);
  };
  const tick = () => {
    if (stopped || broken) return Promise.resolve();
    if (!running) running = probe().then(onOk, onFail).finally(() => { running = null; });
    return running;
  };
  const timer = setInterval(tick, everyMs); timer.unref?.(); tick();
  return {
    async waitIdle() {
      if (!active.length || stopped) return 0;
      const t0 = Date.now(); pauses++;
      log(`[gpulock] ${label}: foreign headless GPU job started during our hold, pausing our frames: ${active.map((f) => `${f.exe} (gpu pid ${f.pid}, ${f.cpuS} s CPU/${windowMs / 1000} s, browser parent ${f.browserParent})`).join(', ')}`);
      while (active.length && !stopped && Date.now() - t0 < maxPauseMs) { await sleep(10e3); await tick(); }
      const ms = Date.now() - t0; pausedMs += ms;
      log(`[gpulock] ${label}: resuming after ${(ms / 1000).toFixed(0)} s${active.length ? ' (pause limit reached, foreign job still active)' : ''}`);
      return ms;
    },
    stop() { stopped = true; clearInterval(timer); },
    state: () => ({ active, pauses, pausedMs, broken, fails, failsTotal }),
  };
}

// FIFO tickets (fix round 4, 22:40): the slot used to go to whichever waiter polled first after a release, so a job could
// wait for hours behind a stream of fresh arrivals. Every waiter now writes build/locks/queue/<ms>-<pid>.ticket and
// touches it on every poll; a free slot is taken only by the waiter whose ticket is among the SLOTS oldest live ones
// (owner alive and touched within 60 s). Processes that loaded an older gpulock.mjs ignore tickets (they just poll).
const QDIR = path.join(DIR, 'queue');
const TICKET_FRESH_MS = 60e3;
let myTicket = null;
function dropTicket() { if (myTicket) { try { fs.rmSync(myTicket, { force: true }); } catch { /* gone */ } myTicket = null; } }
process.on('exit', dropTicket);
function ticketRank() {
  if (!myTicket) return 0;
  try { const now = new Date(); fs.utimesSync(myTicket, now, now); } catch { /* re-created below */ }
  if (!fs.existsSync(myTicket)) fs.writeFileSync(myTicket, JSON.stringify({ pid: process.pid }));
  const live = [];
  for (const f of fs.readdirSync(QDIR).filter((x) => /^\d+-\d+\.ticket$/.test(x)).sort()) {
    const full = path.join(QDIR, f), pid = +f.split('-')[1].split('.')[0];
    let fresh = false; try { fresh = Date.now() - fs.statSync(full).mtimeMs < TICKET_FRESH_MS; } catch { continue; }
    if (!alive(pid)) { try { fs.rmSync(full, { force: true }); } catch { /* raced */ } continue; }
    if (fresh || full === myTicket) live.push(full);
  }
  const r = live.indexOf(myTicket);
  return r < 0 ? 0 : r;
}

/** Wait for a GPU slot. Returns release(); safe to call twice. */
// AG_GPU_WAIT_MIN overrides the wait limit (minutes) for every caller of this process (integration queues behind
// multi-hour animatics, fix round 4)
export async function acquireGpu(label = 'gpu', { timeoutMs = (Number(process.env.AG_GPU_WAIT_MIN) || 90) * 60e3, pollMs = 2000 } = {}) {
  if (held) { held.count++; return () => releaseGpu(); }
  fs.mkdirSync(DIR, { recursive: true });
  const t0 = Date.now();
  let warned = false, warnedForeign = false, foreignNote = '';
  try { fs.mkdirSync(QDIR, { recursive: true }); myTicket = path.join(QDIR, `${String(Date.now()).padStart(15, '0')}-${process.pid}.ticket`); fs.writeFileSync(myTicket, JSON.stringify({ pid: process.pid, label })); } catch { myTicket = null; }
  for (;;) {
    let yielded = false;
    let rank = 0; try { rank = ticketRank(); } catch { rank = 0; }
    for (let i = 0; i < SLOTS; i++) {
      const file = path.join(DIR, `gpu-slot-${i}.lock`);
      if (rank >= SLOTS) { reclaimIfStale(file); continue; }   // older waiters first
      if (tryTake(file, label)) {
        if (sharedOn()) {
          // holding our slot, wait for the other projects' machine-wide lock (their jobs are <= 10 min + cool-down)
          let said = 0;
          for (;;) {
            let r;
            try { r = tryTakeShared(); } catch (e) { console.error(`[gpulock] shared GPU lock unusable (${e.message}); continuing without it`); break; }
            if (r.ok) { if (said) console.error(`[gpulock] ${label}: got the shared GPU lock after ${((Date.now() - t0) / 1000).toFixed(0)} s`); break; }
            if (r.pid && said !== r.pid) { console.error(`[gpulock] ${label}: holding ${path.basename(file)}, waiting for the shared GPU lock ${SHARED} (pid ${r.pid}: ${processCmd(r.pid)})`); said = r.pid; }
            if (Date.now() - t0 > timeoutMs) { fs.rmSync(file, { force: true }); throw new Error(`[gpulock] ${label}: shared GPU lock ${SHARED} not free within ${timeoutMs / 60e3} min (pid ${r.pid})`); }
            await sleep(1000);
          }
        }
        const foreign = await foreignGpuJobs();
        if (foreign.length || foreign.probeFailed) {
          // give the slot back while another program renders on the GPU, or while the probe cannot tell (transient
          // failure: retried in 15 s; after FOREIGN_MAX_FAILS in a row foreignGpuJobs gives up and returns [])
          releaseShared();
          fs.rmSync(file, { force: true });
          foreignNote = foreign.length ? foreign.map((f) => `${f.exe} (gpu pid ${f.pid}, ${f.cpuS} s CPU/4 s)`).join(', ') : 'probe failed, state unknown';
          if (!warnedForeign) console.error(`[gpulock] ${label}: foreign headless GPU job active, waiting: ${foreignNote}`);
          warnedForeign = true; yielded = true;
          break;
        }
        held = { file, count: 1 };
        dropTicket();
        if (warned || warnedForeign) console.error(`[gpulock] got ${path.basename(file)} for ${label} after ${((Date.now() - t0) / 1000).toFixed(0)} s`);
        return () => releaseGpu();
      }
      reclaimIfStale(file);
    }
    if (!warned && !yielded) {
      const holders = status().map((h) => `${h.label} (pid ${h.pid})`).join(', ');
      console.error(`[gpulock] ${label}: waiting for a GPU slot, held by ${holders || '?'}`);
      warned = true;
    }
    if (Date.now() - t0 > timeoutMs) { dropTicket(); throw new Error(`[gpulock] ${label}: no GPU slot within ${timeoutMs / 60e3} min${foreignNote ? ` (last foreign GPU job: ${foreignNote})` : ''}`); }
    await sleep(yielded ? 15000 : pollMs);
  }
}

export function releaseGpu() {
  if (!held) return;
  if (--held.count <= 0) releaseSync();
}

export async function withGpu(label, fn) {
  const release = await acquireGpu(label);
  try { return await fn(); } finally { release(); }
}

/** puppeteer.launch behind the GPU lock; the slot is released when the browser closes or disconnects. */
export async function launchWithGpuLock(puppeteer, options, label = 'chrome') {
  const release = await acquireGpu(label);
  let browser;
  try { browser = await puppeteer.launch(options); } catch (e) { release(); throw e; }
  let done = false;
  const once = () => { if (!done) { done = true; release(); } };
  browser.on('disconnected', once);
  const close = browser.close.bind(browser);
  browser.close = async (...a) => { try { return await close(...a); } finally { once(); } };
  return browser;
}

export function status() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).filter((f) => /^gpu-slot-\d+\.lock$/.test(f))
    .map((f) => ({ slot: f, ...(readLock(path.join(DIR, f)) || {}) }))
    .map((h) => ({ ...h, alive: h.pid ? alive(h.pid) : false }));
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'foreign') {
    const pid = sharedOn() ? sharedHolder() : 0;
    const foreign = await foreignGpuJobs();
    console.log(JSON.stringify({ foreign, probeFailed: !!foreign.probeFailed, broken: foreignProbeBroken, sharedLock: sharedOn() ? SHARED : null, sharedHolder: pid ? { pid, alive: alive(pid), cmd: processCmd(pid) } : null }, null, 1));
  } else if (cmd === 'status') {
    console.log(JSON.stringify({ slots: SLOTS, dir: DIR, holders: status() }, null, 1));
  } else if (cmd === 'run') {
    const sep = rest.indexOf('--');
    const opts = sep >= 0 ? rest.slice(0, sep) : [];
    const argv = sep >= 0 ? rest.slice(sep + 1) : rest;
    const li = opts.indexOf('--label');
    const label = li >= 0 ? opts[li + 1] : path.basename(argv[0] || 'cmd');
    if (!argv.length) { console.error('usage: node gpulock.mjs run [--label name] -- <command> [args...]'); process.exit(2); }
    await acquireGpu(label);
    const child = spawn(argv[0], argv.slice(1), { stdio: 'inherit', shell: false });
    child.on('exit', (code, signal) => { releaseSync(); process.exit(code ?? (signal ? 1 : 0)); });
    child.on('error', (e) => { console.error(e.message); releaseSync(); process.exit(1); });
  } else {
    console.error('usage: node gpulock.mjs status | run [--label name] -- <command> [args...]');
    process.exit(2);
  }
}
