#!/usr/bin/env node
// Real-time player: open a MIDI file, let the pianist solve it, watch him play it.
//   node player/play.mjs [song.mid] [--port 8137] [--no-open]      (npm run play -- song.mid)
//   node player/play.mjs song.mid --prepare                          convert + solve only, no server
//
// Per MIDI file (keyed by name + content hash) everything lands in build/player/<id>/:
//   source.mid, score.json (player/midi.js), anim/perf.json + perf.bin (perf/solve.mjs), handtrack.json (the camera's
//   solved hand track, sandbox/camera/handtrack.mjs), audio.wav (the film's sampler, music/render_audio.py, preset
//   'final'; sample 0 = music time 0), status.json. A file that was solved before plays at once.
// The solve and the audio render run side by side (one of each at a time); a song is ready when both are done. Without
// the Salamander samples (README, Soundtrack) there is no render and the page plays its Web Audio piano instead; songs
// solved before the samples were there get their render in the background. Python: AG_PYTHON, else .venv, else python.
// The page (player/index.html) uploads a file with POST /player/api/open and polls GET /player/api/status?id=.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer } from '../render/lib/server.mjs';
import { midiToScore } from './midi.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SONGS = path.join(ROOT, 'build', 'player');
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

const args = { _: [] };
{ const a = process.argv.slice(2); for (let i = 0; i < a.length; i++) { if (a[i].startsWith('--')) { const k = a[i].slice(2); args[k] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true; } else args._.push(a[i]); } }

// ------------------------------------------------------------------------------------------------ songs
const slug = (s) => s.replace(/\.(mid|midi|kar|rmi)$/i, '').normalize('NFKD').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).toLowerCase() || 'song';
const songDir = (id) => path.join(SONGS, id);
// the status of every song this server touched lives in memory (the solve and the render both update it); the file
// is its copy for the next start
const live = new Map();
const readStatus = (id) => {
  if (live.has(id)) return live.get(id);
  try { const s = JSON.parse(fs.readFileSync(path.join(songDir(id), 'status.json'), 'utf8')); live.set(id, s); return s; } catch { return null; }
};
const writeStatus = (id, s) => { live.set(id, s); fs.writeFileSync(path.join(songDir(id), 'status.json'), JSON.stringify(s, null, 1)); };

const SAMPLES = path.join(ROOT, 'music', 'samples', 'SalamanderGrandPianoV3', 'SalamanderGrandPianoV3_48khz24bit', 'SalamanderGrandPianoV3.sfz');
const PYTHON = process.env.AG_PYTHON || [path.join(ROOT, '.venv', 'Scripts', 'python.exe'), path.join(ROOT, '.venv', 'bin', 'python')].find((p) => fs.existsSync(p)) || 'python';
const hasSamples = () => fs.existsSync(SAMPLES);

/** store a MIDI file and convert it -> status (stage 'queued', or 'ready' when it was solved before) */
function addSong(name, bytes) {
  const id = `${slug(name)}-${crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 8)}`;
  const dir = songDir(id);
  const old = readStatus(id);
  if (old && old.stage !== 'error') return old;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'source.mid'), bytes);
  const title = name.replace(/\.(mid|midi|kar|rmi)$/i, '');
  const score = midiToScore(bytes, { title });
  fs.writeFileSync(path.join(dir, 'score.json'), JSON.stringify(score));
  const st = { id, title, stage: 'queued', progress: 0, created: new Date().toISOString(), report: score.report,
    duration: score.duration, sections: score.sections.map((s) => s.name), log: [], audio: { stage: hasSamples() ? 'queued' : 'off' } };
  writeStatus(id, st);
  solveQueue.push(id); pumpSolve();
  if (st.audio.stage === 'queued') { audioQueue.push(id); pumpAudio(); }
  return st;
}

// ------------------------------------------------------------------------------------------------ pipeline
// one solve at a time (all of one core for 8-12 min on a 3-4 minute piece) and, beside it, one audio render
const solveQueue = [], audioQueue = [];
let solving = null, rendering = null;
const audioDone = (st) => !st.audio || ['ready', 'error', 'off'].includes(st.audio.stage);
const finish = (st) => { if (st.perfDone && audioDone(st)) { st.stage = 'ready'; st.progress = 1; delete st.started; } };

function run(exe, argv, onLine) {
  return new Promise((resolve, reject) => {
    const p = spawn(exe, argv, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONUNBUFFERED: '1' } });
    const cmd = argv[0];
    let buf = '', err = '';
    const take = (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trimEnd(); buf = buf.slice(i + 1); if (line) onLine(line); } };
    p.stdout.on('data', take);
    p.stderr.on('data', (d) => { err += d; take(d); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited with ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`))));
  });
}

// coarse progress from the solver's log: keyframes per hand, then the 240 Hz sampling loop, then the passes after it
function solveProgress(line, p) {
  let m;
  if (/fingering [RL]:/.test(line)) return Math.max(p, 0.03);
  if (/body motion ready/.test(line)) return Math.max(p, 0.05);
  if (/^\[solve\] R: \d+ keyframes/.test(line)) return Math.max(p, 0.2);
  if (/^\[solve\] L: \d+ keyframes/.test(line)) return Math.max(p, 0.35);
  if ((m = /sample (\d+)\/(\d+)/.exec(line))) return Math.max(p, 0.4 + 0.45 * (+m[1] / +m[2]));
  if (/sampling done/.test(line)) return Math.max(p, 0.86);
  if (/wrote .*perf\.bin/.test(line)) return 0.97;
  return p;
}

const logTo = (st) => (line) => { st.log.push(line); if (st.log.length > 400) st.log.splice(0, st.log.length - 400); if (args.verbose) console.log(`[${st.id}] ${line}`); };

async function pumpSolve() {
  if (solving || !solveQueue.length) return;
  const id = solveQueue.shift(); solving = id;
  const dir = songDir(id), st = readStatus(id);
  const t0 = Date.now(), log = logTo(st);
  const save = () => { st.elapsed = (Date.now() - t0) / 1000; writeStatus(id, st); };
  try {
    st.stage = 'solving'; st.progress = 0.01; st.started = t0; save();
    let last = 0;
    await run(process.execPath, [path.join(ROOT, 'perf/solve.mjs'), '--score', rel(path.join(dir, 'score.json')), '--out', rel(path.join(dir, 'anim')), '--no-qc'], (line) => {
      log(line); st.progress = solveProgress(line, st.progress);
      if (Date.now() - last > 1000) { last = Date.now(); save(); }
    });
    st.stage = 'camera'; st.progress = 0.98; save();
    await run(process.execPath, [path.join(ROOT, 'sandbox/camera/handtrack.mjs'), '--perf', rel(path.join(dir, 'anim')), '--score', rel(path.join(dir, 'score.json')), '--out', rel(path.join(dir, 'handtrack.json'))], log);
    st.perfDone = true;
    st.stage = 'sound'; finish(st); save();
    console.log(`[play] ${id} solved after ${st.elapsed.toFixed(0)} s${st.stage === 'ready' ? '' : ', waiting for the audio render'}`);
  } catch (e) {
    st.stage = 'error'; st.error = e.message; save();
    console.error(`[play] ${id} failed: ${e.message}`);
  } finally {
    solving = null; pumpSolve();
  }
}

// the film's soundtrack render (music/render_audio.py, preset 'final') of the song's score.json: the same notes, times
// and pedal the pianist plays, so the WAV needs no alignment beyond the music offset
async function pumpAudio() {
  if (rendering || !audioQueue.length) return;
  const id = audioQueue.shift(); rendering = id;
  const dir = songDir(id), st = readStatus(id);
  const t0 = Date.now(), log = logTo(st);
  try {
    st.audio = { stage: 'rendering', started: t0 }; writeStatus(id, st);
    await run(PYTHON, [path.join(ROOT, 'music/render_audio.py'), '--score', path.join(dir, 'score.json'), '--out', path.join(dir, 'audio'),
      '--film-offset', '0', '--title', st.title], log);
    st.audio = { stage: 'ready', elapsed: (Date.now() - t0) / 1000 };
    if (st.duration) audioRate = st.audio.elapsed / st.duration;
    console.log(`[play] ${id} audio rendered in ${st.audio.elapsed.toFixed(0)} s`);
  } catch (e) {
    st.audio = { stage: 'error', error: e.message };
    console.error(`[play] ${id} audio render failed (the page plays its own piano): ${e.message}`);
  } finally {
    finish(st); writeStatus(id, st);
    rendering = null; pumpAudio();
  }
}

// work that died with the server is picked up again; songs solved before the samples were there get their render
if (fs.existsSync(SONGS)) {
  for (const id of fs.readdirSync(SONGS)) {
    const s = readStatus(id);
    if (!s) continue;
    if (['queued', 'solving', 'camera'].includes(s.stage)) { s.stage = 'queued'; s.progress = 0; solveQueue.push(id); }
    if (s.stage === 'ready' || s.stage === 'sound') s.perfDone = true;
    if (hasSamples() && (!s.audio || s.audio.stage === 'off' || s.audio.stage === 'queued' || s.audio.stage === 'rendering')) { s.audio = { stage: 'queued' }; audioQueue.push(id); }
    writeStatus(id, s);
  }
}
pumpSolve(); pumpAudio();

// ------------------------------------------------------------------------------------------------ routes
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }); res.end(JSON.stringify(obj)); };
// audio render progress is a guess from the clock (the sampler prints nothing until it is done), at the rate of the
// last render (seconds of work per second of music: 0.3-0.4 on this desktop, about 4 on the film's laptop)
let audioRate = 1;
const audioProgress = (s) => (s.audio?.started ? Math.min(0.95, (Date.now() - s.audio.started) / 1000 / (audioRate * (s.duration || 200))) : 0);
const brief = (s) => s && { id: s.id, title: s.title, stage: s.stage, progress: s.stage === 'sound' ? audioProgress(s) : s.progress, elapsed: s.elapsed,
  started: s.stage === 'sound' ? s.audio?.started : s.started, error: s.error, duration: s.duration, report: s.report, audio: s.audio?.stage ?? 'off',
  log: (s.log || []).slice(-1)[0] };

function onRequest(req, res, url) {
  if (!url.pathname.startsWith('/player/api/')) return false;
  const route = url.pathname.slice('/player/api/'.length);
  if (req.method === 'POST' && route === 'open') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try { json(res, 200, brief(addSong(url.searchParams.get('name') || 'song.mid', Buffer.concat(chunks)))); }
      catch (e) { json(res, 400, { error: e.message }); }
    });
    return true;
  }
  if (route === 'status') { const s = readStatus(url.searchParams.get('id') || ''); json(res, s ? 200 : 404, s ? brief(s) : { error: 'unknown song' }); return true; }
  if (route === 'songs') {
    const list = fs.existsSync(SONGS) ? fs.readdirSync(SONGS).map(readStatus).filter(Boolean).map(brief).sort((a, b) => (a.title || '').localeCompare(b.title || '')) : [];
    json(res, 200, list); return true;
  }
  json(res, 404, { error: 'unknown route' });
  return true;
}

// ------------------------------------------------------------------------------------------------ main
let first = null;
if (args._[0]) {
  const file = path.resolve(args._[0]);
  first = addSong(path.basename(file), fs.readFileSync(file));
  const r = first.report;
  console.log(`[play] ${first.id}: ${r.notes} notes (L ${r.hands.L}, R ${r.hands.R}), ${r.bars} bars, ${first.duration.toFixed(1)} s; ` +
    `sections ${first.sections.join(' ')}${r.dropped ? `; ${r.dropped} notes one hand could not take were dropped` : ''}`);
}
if (args.prepare) {
  if (!first) { console.error('usage: node player/play.mjs song.mid --prepare'); process.exit(2); }
  args.verbose = true;
  const wait = () => new Promise((r) => { const iv = setInterval(() => { if (!solving && !rendering && !solveQueue.length && !audioQueue.length) { clearInterval(iv); r(); } }, 500); });
  await wait();
  const s = readStatus(first.id);
  console.log(`[play] ${s.id}: ${s.stage}${s.error ? ` (${s.error})` : ''}`);
  process.exit(s.stage === 'ready' ? 0 : 1);
}
const { url } = await startServer(+(args.port || 8137), { onRequest, onFrame: async () => {} });
const page = `${url}/player/${first ? `?song=${encodeURIComponent(first.id)}` : ''}`;
console.log(`[play] ${page}`);
if (!args['no-open']) {
  const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', page]] : process.platform === 'darwin' ? ['open', [page]] : ['xdg-open', [page]];
  spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).unref();
}
