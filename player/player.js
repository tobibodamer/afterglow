// The real-time player page (served by player/play.mjs). Two states:
//   library   no ?song: open / drop a MIDI file (uploaded to the server, which converts and solves it) or pick one
//   playback  ?song=<id>: the film's page core (scene/src/main.js), driven by the audio clock; N sub-frames + SMAA while
//             playing, the full frame (preview N 4 / the shot's own N in final) once paused;
//             camera = the auto edit for this score (scene/src/camera/auto.js), sound = the rendered WAV or player/synth.js
// Settings (the menu, kept in localStorage): quality and resolution apply at AG.init, which runs once per page, so they
// reload the page at the same moment (?t=, paused); the rest apply at once.
//   URL overrides: ?w=&h= render size   ?quality=preview|final   ?t=<film s>
//   keys: space play/pause, arrows +-5 s, home, f / double-click fullscreen, s stats, esc closes the menu
import { createFilm } from '/scene/src/main.js';
import { PianoSynth, ScorePlayer } from './synth.js';

const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
const songId = q.get('song');
const api = (p, o) => fetch(`/player/api/${p}`, o).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j; });
const fmt = (s) => { s = Math.max(0, s); return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
const PREFS_KEY = 'afterglow.player';
const prefs = { quality: 'preview', size: 'screen', n: 1, smaa: true, refine: true, stats: false };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY)) || {}); } catch { /* defaults */ }
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* not kept */ } };
const svg = (d) => `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;
const ICON = {
  play: svg('M8 5.5v13l10.5-6.5z'), pause: svg('M7 5h3.5v14H7zm6.5 0H17v14h-3.5z'),
  fs: svg('M4 4h6v2H6v4H4zm10 0h6v6h-2V6h-4zM4 14h2v4h4v2H4zm14 0h2v6h-6v-2h4z'),
  fsExit: svg('M8 4h2v6H4V8h4zm6 0h2v4h4v2h-6zM4 14h6v6H8v-4H4zm10 0h6v2h-4v4h-2z'),
};
const STAGE = { queued: 'Waiting', solving: 'Solving the performance', camera: 'Tracking the hands', sound: 'Rendering the sound', ready: 'Ready', error: 'Failed' };

/** the song's rendered WAV (music/render_audio.py, sample 0 = music time 0) with ScorePlayer's start / tick / stop */
class WavPlayer {
  constructor(ctx, buffer) { this.ctx = ctx; this.buffer = buffer; this.src = null; }
  start(ctxTime, m) {
    this.stop();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer; src.connect(this.ctx.destination);
    if (m >= 0) src.start(ctxTime, m); else src.start(ctxTime - m, 0);
    this.src = src;
  }
  tick() {}
  stop() { if (this.src) { try { this.src.stop(); } catch { /* never started */ } this.src.disconnect(); this.src = null; } }
}

// ------------------------------------------------------------------------------------------------ library
async function library() {
  $('library').classList.remove('hidden');
  const list = await api('songs').catch(() => []);
  const ul = $('songs');
  ul.innerHTML = '';
  for (const s of list) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="t"></span><span class="s"></span>`;
    li.querySelector('.t').textContent = s.title;
    li.querySelector('.s').textContent = s.stage === 'ready' ? fmt(s.duration) : s.stage === 'solving' || s.stage === 'sound' ? `${Math.round(s.progress * 100)} %` : STAGE[s.stage] || s.stage;
    li.onclick = () => (s.stage === 'ready' ? go(s.id) : follow(s.id));
    ul.appendChild(li);
  }
  if (list.some((s) => s.stage !== 'ready' && s.stage !== 'error')) setTimeout(() => { if (!$('library').classList.contains('hidden')) library(); }, 3000);
}
const go = (id) => { location.search = `?song=${encodeURIComponent(id)}`; };

async function upload(file) {
  const st = await api(`open?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: await file.arrayBuffer() });
  if (st.stage === 'ready') go(st.id); else follow(st.id);
}

/** progress of a solve until it is ready */
async function follow(id) {
  $('library').classList.add('hidden');
  $('busy').classList.remove('hidden');
  for (;;) {
    const s = await api(`status?id=${encodeURIComponent(id)}`);
    const el = s.started && s.stage !== 'error' ? (Date.now() - s.started) / 1000 : s.elapsed;
    $('busyTitle').textContent = `${s.title}: ${STAGE[s.stage] || s.stage}${el ? `, ${fmt(el)}` : ''}`;
    $('busyBar').style.width = `${Math.round((s.progress || 0) * 100)}%`;
    $('busyLine').textContent = s.error || s.log || '';
    if (s.stage === 'ready') return go(id);
    if (s.stage === 'error') return;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

$('open').onclick = () => $('file').click();
$('file').onchange = () => { const f = $('file').files[0]; if (f) upload(f).catch((e) => alert(e.message)); };
for (const el of [document.body]) {
  el.addEventListener('dragover', (e) => { e.preventDefault(); $('drop').classList.add('over'); });
  el.addEventListener('dragleave', () => $('drop').classList.remove('over'));
  el.addEventListener('drop', (e) => { e.preventDefault(); $('drop').classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) upload(f).catch((x) => alert(x.message)); });
}
$('lib').onclick = () => { location.search = ''; };

// ------------------------------------------------------------------------------------------------ playback
async function playback(id) {
  const st = await api(`status?id=${encodeURIComponent(id)}`);
  if (st.stage !== 'ready') return follow(id);
  const dir = `/build/player/${id}`;
  const camUrl = `/scene/src/camera/auto.js?score=${encodeURIComponent(`${dir}/score.json`)}&handtrack=${encodeURIComponent(`${dir}/handtrack.json`)}`;
  $('busy').classList.remove('hidden');
  $('busyTitle').textContent = st.title;
  $('busyLine').textContent = 'Building the scene';
  $('busyBar').style.width = '30%';

  const AG = createFilm();
  window.AG = AG;
  const quality = (q.get('quality') || prefs.quality) === 'final' ? 'final' : 'preview';
  const px = prefs.size === 'screen' ? Math.min(1920, screen.width * devicePixelRatio, (screen.height * devicePixelRatio * 16) / 9) : (+prefs.size * 16) / 9;
  const W = +(q.get('w') || 2 * Math.round(px / 2)), H = +(q.get('h') || 2 * Math.round((W * 9) / 32));
  await AG.init({
    width: W, height: H, quality, motionBoost: false, warmup: false,
    cameraModule: camUrl, modules: { camera: camUrl },
    data: { score: `${dir}/score.json`, perfMeta: `${dir}/anim/perf.json`, perf: `${dir}/anim/perf.bin` },
  });
  $('stage').appendChild(AG.ctx.renderer.domElement);
  const cam = await import(camUrl);
  const score = AG.ctx.data.score;
  const END = cam.FILM_END, OFFSET = AG.MUSIC_OFFSET;
  // sound: the rendered WAV when the song has one (decoded now; the context starts on the first Play), else the synth
  const audio = new AudioContext({ latencyHint: 'interactive' });
  let wav = null;
  if (st.audio === 'ready') {
    $('busyLine').textContent = 'Loading the sound';
    wav = await fetch(`${dir}/audio.wav`).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => b && audio.decodeAudioData(b)).catch((e) => { console.warn('[player] audio.wav not used:', e); return null; });
  }

  // seek bar: section starts
  const seek = $('seek');
  for (const s of score.sections) { const d = document.createElement('div'); d.className = 'sec'; d.style.left = `${(100 * (s.t_start + OFFSET)) / END}%`; d.title = s.name; seek.appendChild(d); }
  $('title').textContent = st.title;

  // clock: film time from the audio clock while playing (minus the output latency, so picture meets sound)
  const synth = wav ? null : new PianoSynth(audio);
  const sched = wav ? new WavPlayer(audio, wav) : new ScorePlayer(synth, score);
  let base = 0, playing = false, pos = Math.min(END, Math.max(0, +(q.get('t') || 0))), timer = 0;
  const now = () => (playing ? audio.currentTime - (audio.outputLatency || audio.baseLatency || 0) - base : pos);
  window.__AG_PLAYER = { audio, synth, sched, now, source: wav ? 'wav' : 'synth' };   // debugging only
  function start() {
    audio.resume();
    if (pos >= END - 0.05) pos = 0;
    // film time pos is scheduled at context time base + pos (50 ms ahead for the first notes); now() takes the output
    // latency off, so the picture shows pos when pos is heard
    base = audio.currentTime + 0.05 - pos;
    sched.start(audio.currentTime + 0.05, pos - OFFSET);
    timer = setInterval(() => sched.tick(), 50);
    playing = true; $('play').innerHTML = ICON.pause; $('play').ariaLabel = 'Pause';
  }
  function stop() {
    if (!playing) return;
    pos = now(); playing = false; clearInterval(timer); sched.stop(); $('play').innerHTML = ICON.play; $('play').ariaLabel = 'Play';
  }
  const toggle = () => (playing ? stop() : start());
  const seekTo = (t) => { const was = playing; stop(); pos = Math.min(END, Math.max(0, t)); dirty = true; if (was) start(); };

  // render loop: the newest frame of the clock, never queued (a slow frame drops the ones it overran); a frame that
  // stays still for a moment is rendered again in full
  let rendering = false, lastFrame = -1, dirty = true, full = false, stillSince = 0;
  const presented = [];   // presentation times of the last second while playing
  let last = { shot: '', bar: null, N: 0, ms: 0 };
  async function frameLoop() {
    requestAnimationFrame(frameLoop);
    let t = now();
    if (playing && t >= END) { stop(); pos = END; }
    t = Math.min(t, END - 1 / 60);
    // paused at the very start: show the vista, not the black of the fade-in
    const f = Math.floor((!playing && t < 2.5 ? 2.5 : t) * 60);
    $('seek').querySelector('.fill').style.width = `${(100 * t) / END}%`;
    $('time').textContent = `${fmt(t)} / ${fmt(END)}`;
    if (prefs.stats) showStats();
    if (rendering) return;
    if (f !== lastFrame || dirty) { full = false; stillSince = performance.now(); }
    else if (playing || full || !prefs.refine || performance.now() - stillSince < 250) return;
    else full = true;
    rendering = true; dirty = false; lastFrame = f;
    try {
      const t0 = performance.now();
      // the full frame waits for the GPU, so its time is the real one; playing frames stay pipelined
      const r = await AG.renderFrame(f, { N: full ? undefined : prefs.n, transfer: 'none', sync: full });
      AG.present({ smaa: prefs.smaa });
      const t1 = performance.now();
      if (playing) { presented.push(t1); while (presented[0] < t1 - 1000) presented.shift(); } else presented.length = 0;
      last = { shot: r.shot, bar: window.__AG_CAMERA?.diag?.last?.bar, N: r.N, ms: full ? t1 - t0 : 0 };
    } catch (e) { console.error(e); } finally { rendering = false; }
  }
  function showStats() {
    const head = playing ? `${presented.length} fps` : last.ms ? `paused · ${Math.round(last.ms)} ms` : 'paused';
    $('stats').textContent = `${head}\nN ${last.N} · ${W}x${H} · ${quality}\n${last.shot}${last.bar != null ? ` · bar ${last.bar}` : ''}`;
  }

  // settings menu
  const reload = () => {
    const p = new URLSearchParams(location.search);
    for (const k of ['quality', 'w', 'h']) p.delete(k);
    p.set('t', now().toFixed(2));
    location.search = p;
  };
  const SETTINGS = [
    { key: 'quality', label: 'Quality', opts: [['preview', 'Preview'], ['final', 'Final']], reload: true, value: () => quality },
    { key: 'size', label: 'Resolution', opts: [['screen', 'Screen'], ['1440', '1440p'], ['1080', '1080p'], ['720', '720p']], reload: true },
    { key: 'n', label: 'Samples playing', opts: [[1, '1'], [2, '2'], [4, '4']] },
    { key: 'smaa', label: 'SMAA', opts: [[true, 'On'], [false, 'Off']] },
    { key: 'refine', label: 'Full frame paused', opts: [[true, 'On'], [false, 'Off']] },
    { key: 'stats', label: 'Stats', opts: [[true, 'On'], [false, 'Off']] },
  ];
  function buildMenu() {
    const menu = $('menu');
    menu.innerHTML = '';
    for (const s of SETTINGS) {
      const row = document.createElement('div'); row.className = 'row';
      const label = document.createElement('span'); label.textContent = s.label;
      const seg = document.createElement('div'); seg.className = 'seg';
      const cur = String(s.value ? s.value() : prefs[s.key]);
      for (const [v, text] of s.opts) {
        const b = document.createElement('button'); b.textContent = text;
        b.classList.toggle('on', String(v) === cur);
        b.onclick = () => {
          if (String(v) === cur) return;
          prefs[s.key] = v; savePrefs();
          if (s.reload) return reload();
          dirty = true; $('stats').classList.toggle('hidden', !prefs.stats); buildMenu();
        };
        seg.appendChild(b);
      }
      row.append(label, seg); menu.appendChild(row);
    }
  }
  const toggleMenu = (open = $('menu').classList.contains('hidden')) => {
    if (open) buildMenu();
    $('menu').classList.toggle('hidden', !open); $('set').classList.toggle('on', open);
  };
  const toggleStats = () => { prefs.stats = !prefs.stats; savePrefs(); $('stats').classList.toggle('hidden', !prefs.stats); if (!$('menu').classList.contains('hidden')) buildMenu(); };

  $('busy').classList.add('hidden');
  $('bar').classList.remove('hidden');
  $('play').onclick = toggle;
  $('stats').classList.toggle('hidden', !prefs.stats);
  $('set').onclick = (e) => { e.stopPropagation(); toggleMenu(); };
  $('menu').onclick = (e) => e.stopPropagation();
  addEventListener('click', () => toggleMenu(false));
  const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
  addEventListener('fullscreenchange', () => {
    const on = !!document.fullscreenElement;
    $('fs').innerHTML = on ? ICON.fsExit : ICON.fs; $('fs').ariaLabel = on ? 'Exit fullscreen' : 'Fullscreen';
  });
  $('fs').onclick = fullscreen;
  $('stage').ondblclick = fullscreen;
  seek.onclick = (e) => { const r = seek.getBoundingClientRect(); seekTo(((e.clientX - r.left) / r.width) * END); };
  addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
    else if (e.code === 'ArrowRight') seekTo(now() + 5);
    else if (e.code === 'ArrowLeft') seekTo(now() - 5);
    else if (e.code === 'Home') seekTo(0);
    else if (e.code === 'KeyF') fullscreen();
    else if (e.code === 'KeyS') toggleStats();
    else if (e.code === 'Escape') toggleMenu(false);
  });
  let idle = 0;
  addEventListener('mousemove', () => {
    $('bar').classList.remove('idle'); clearTimeout(idle);
    idle = setTimeout(() => { if (playing && $('menu').classList.contains('hidden')) $('bar').classList.add('idle'); }, 2500);
  });
  requestAnimationFrame(frameLoop);
}

if (songId) {
  $('library').classList.add('hidden');
  playback(songId).catch((e) => { console.error(e); $('busy').classList.remove('hidden'); $('busyTitle').textContent = 'Could not start'; $('busyLine').textContent = e.message; });
} else library();
