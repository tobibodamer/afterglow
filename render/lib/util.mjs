// Small shared helpers for the render driver: CLI args, hashing, git, ffprobe, JSON IO.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { REPO_ROOT } from './server.mjs';

/** --key value | --key=value | --flag  ->  { key: value|true, _: [positionals] } */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq > 0) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const k = a.slice(2), nxt = argv[i + 1];
    if (nxt === undefined || nxt.startsWith('--')) out[k] = true; else { out[k] = nxt; i++; }
  }
  return out;
}

export function parseSize(s, def = [1920, 1080]) {
  if (!s) return def;
  const named = { '540p': [960, 540], '720p': [1280, 720], '1080p': [1920, 1080], '1440p': [2560, 1440], '2160p': [3840, 2160], '4k': [3840, 2160] };
  if (named[String(s).toLowerCase()]) return named[String(s).toLowerCase()];
  const m = /^(\d+)x(\d+)$/i.exec(String(s));
  if (!m) throw new Error(`bad --size "${s}" (want WxH or 1080p)`);
  return [+m[1], +m[2]];
}

/** "0,600,1200" | "0-600:100" (start-end:step, end inclusive) | mixed comma list */
export function parseFrameList(s) {
  const out = [];
  for (const part of String(s).split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = /^(\d+)-(\d+)(?::(\d+))?$/.exec(part);
    if (m) { for (let f = +m[1]; f <= +m[2]; f += +(m[3] || 1)) out.push(f); } else out.push(Math.round(+part));
  }
  if (out.some((f) => !Number.isFinite(f) || f < 0)) throw new Error(`bad frame list "${s}"`);
  return out;
}

/** a JSON argument may be inline JSON or a path to a .json file */
export function readJsonArg(v) {
  if (v === undefined || v === null || v === true) return undefined;
  const s = String(v).trim();
  if (s.startsWith('{') || s.startsWith('[')) return JSON.parse(s);
  return JSON.parse(fs.readFileSync(path.resolve(s), 'utf8'));
}

/** --modules world=placeholder,piano=real | placeholders | auto */
export function parseModules(v, placeholders = false) {
  if (placeholders) return 'placeholders';
  if (v === undefined || v === true) return undefined;
  const s = String(v).trim();
  if (s === 'auto' || s === 'placeholders') return s;
  if (s.startsWith('{')) return JSON.parse(s);
  const o = {};
  for (const kv of s.split(',')) { const [k, ...rest] = kv.split('='); o[k.trim()] = rest.join('=').trim(); }
  return o;
}

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export function sha256File(file) {
  return new Promise((res, rej) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('error', rej).on('end', () => res(h.digest('hex')));
  });
}

/** stable JSON (sorted keys) for hashing settings */
export function stableStringify(v) {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  return JSON.stringify(v);
}

export function gitInfo(root = REPO_ROOT) {
  const run = (args) => { try { return execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; } };
  const hash = run(['rev-parse', 'HEAD']);
  const status = run(['status', '--porcelain', '--', 'scene', 'render']);
  return { hash, dirty: status === null ? null : status.length > 0 };
}

/** content hash of every file under dirs (sorted relative paths + bytes): a fingerprint that works without commits */
export function treeHash(dirs, root = REPO_ROOT) {
  const files = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules' && !e.name.startsWith('.')) walk(p); } else files.push(p);
    }
  };
  for (const d of dirs) walk(path.resolve(root, d));
  files.sort();
  const h = crypto.createHash('sha256');
  for (const f of files) { h.update(path.relative(root, f).replace(/\\/g, '/')); h.update('\0'); h.update(fs.readFileSync(f)); h.update('\0'); }
  return { files: files.length, sha256: h.digest('hex') };
}

// content hashes of files, cached by (path, size, mtime) so a long render hashes each input once
const _fileHash = new Map();
function fileHash16(p, st = fs.statSync(p)) {
  const key = `${p}|${st.size}|${st.mtimeMs}`;
  let h = _fileHash.get(key);
  if (!h) { h = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16); _fileHash.set(key, h); }
  return h;
}
const relKey = (p, root) => path.relative(root, p).replace(/\\/g, '/');

/**
 * Provenance of a render: { 'repo/relative/path': sha256[0:16] } for every file the page loaded (server `served` map).
 * A file modified after it was served is recorded as 'changed:<hash>', so it never matches another chunk.
 */
export async function inputHashes(served, root = REPO_ROOT) {
  const out = {};
  for (const [p, s] of [...served].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) {
    let st; try { st = fs.statSync(p); } catch { out[relKey(p, root)] = 'missing'; continue; }
    const h = fileHash16(p, st);
    out[relKey(p, root)] = st.size === s.size && st.mtimeMs === s.mtimeMs ? h : `changed:${h}`;
  }
  return out;
}

/** the recorded inputs whose current content differs (or that are gone): ['path (why)'] */
export function staleInputs(inputs, root = REPO_ROOT) {
  const out = [];
  for (const [rel, h] of Object.entries(inputs || {})) {
    const p = path.resolve(root, rel);
    if (!fs.existsSync(p)) { out.push(`${rel} (missing)`); continue; }
    if (fileHash16(p) !== h) out.push(rel);
  }
  return out;
}

/** ffprobe JSON */
export function ffprobe(file, args = ['-show_streams', '-show_format']) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-of', 'json', ...args, file], { maxBuffer: 64 << 20 }).toString();
  return JSON.parse(out);
}

/** packet count of the first video stream (FFV1 is intra-only: packets == frames), no decode */
export function countVideoPackets(file) {
  const j = ffprobe(file, ['-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets']);
  return +j.streams?.[0]?.nb_read_packets;
}

/** run ffmpeg, resolve with stderr; reject on non-zero exit */
export function runFfmpeg(args, { quiet = true, cwd } = {}) {
  return new Promise((res, rej) => {
    const ff = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', quiet ? 'error' : 'info', ...args], { stdio: ['ignore', 'pipe', 'pipe'], cwd });
    let err = ''; const out = [];
    ff.stdout.on('data', (d) => out.push(d));
    ff.stderr.on('data', (d) => { err += d; if (!quiet) process.stderr.write(d); });
    ff.on('close', (c) => (c === 0 ? res({ stderr: err, stdout: Buffer.concat(out) }) : rej(new Error(`ffmpeg exited ${c}\n${err.slice(-4000)}\nargs: ${args.join(' ')}`))));
  });
}

export function writeJsonAtomic(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
  fs.renameSync(tmp, file);
}

export const pad = (n, w = 6) => String(n).padStart(w, '0');
export const fmtMs = (ms) => (ms >= 60000 ? `${(ms / 60000).toFixed(1)} min` : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms.toFixed(0)} ms`);
