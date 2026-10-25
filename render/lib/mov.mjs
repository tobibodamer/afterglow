// QuickTime/MP4 box surgery for the ProRes archive: tag the colour range.
//
// ffmpeg's mov muxer writes a QuickTime 'nclc' colr atom (primaries, transfer, matrix) for .mov files. 'nclc' has no
// range field, so ffprobe and NLEs report the range as unknown even with -color_range tv. The ISO 'nclx' form has the
// same three fields plus a full_range flag, and QuickTime, ffmpeg and the NLEs read it in .mov too. tagMovColorRange()
// rewrites colr 'nclc' (18 bytes) as 'nclx' (19 bytes) in place. It only touches the moov box, and only when moov is
// the last top-level box (ffmpeg's default without +faststart), so no sample offset moves; otherwise it refuses.
import fs from 'node:fs';

function readBoxHeader(fd, pos, fileSize) {
  const h = Buffer.alloc(16);
  fs.readSync(fd, h, 0, 16, pos);
  let size = h.readUInt32BE(0), hdr = 8;
  const type = h.toString('latin1', 4, 8);
  if (size === 1) { size = Number(h.readBigUInt64BE(8)); hdr = 16; } else if (size === 0) size = fileSize - pos;
  return { pos, size, type, hdr };
}

// children of a box held in buf[start, end)
function* children(buf, start, end) {
  let p = start;
  while (p + 8 <= end) {
    let size = buf.readUInt32BE(p), hdr = 8;
    const type = buf.toString('latin1', p + 4, p + 8);
    if (size === 1) { size = Number(buf.readBigUInt64BE(p + 8)); hdr = 16; } else if (size === 0) size = end - p;
    if (size < hdr || p + size > end) throw new Error(`bad box ${type} at ${p}`);
    yield { p, size, type, hdr };
    p += size;
  }
}

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl']);

// media handler of a trak ('vide', 'soun', ...): trak/mdia/hdlr, handler type after version/flags + pre_defined
function handlerOf(buf, trak) {
  for (const m of children(buf, trak.p + trak.hdr, trak.p + trak.size)) {
    if (m.type !== 'mdia') continue;
    for (const h of children(buf, m.p + m.hdr, m.p + m.size)) if (h.type === 'hdlr') return buf.toString('latin1', h.p + h.hdr + 8, h.p + h.hdr + 12);
  }
  return null;
}

/** find colr boxes inside the visual sample entries of video tracks: [{ colr, ancestors }] (positions in buf) */
function findColr(buf, start, end, ancestors, out) {
  for (const b of children(buf, start, end)) {
    const anc = [...ancestors, b];
    if (b.type === 'trak' && handlerOf(buf, b) !== 'vide') continue;
    if (CONTAINERS.has(b.type)) findColr(buf, b.p + b.hdr, b.p + b.size, anc, out);
    else if (b.type === 'stsd') {
      // stsd: version/flags (4) + entry count (4), then sample entries; a visual sample entry has 78 bytes of fields
      for (const e of children(buf, b.p + b.hdr + 8, b.p + b.size)) {
        for (const c of children(buf, e.p + e.hdr + 78, e.p + e.size)) {
          if (c.type === 'colr') out.push({ colr: c, ancestors: [...anc, e] });
        }
      }
    }
  }
  return out;
}

/**
 * Tag the colour range of every video track in a .mov: colr 'nclc' -> 'nclx' with full_range_flag = fullRange.
 * Returns { changed, tracks, reason }.
 */
export function tagMovColorRange(file, { fullRange = false } = {}) {
  const fd = fs.openSync(file, 'r+');
  try {
    const fileSize = fs.fstatSync(fd).size;
    const top = [];
    for (let pos = 0; pos < fileSize;) { const b = readBoxHeader(fd, pos, fileSize); if (b.size < b.hdr) throw new Error(`bad top-level box at ${pos}`); top.push(b); pos += b.size; }
    const moov = top.find((b) => b.type === 'moov');
    if (!moov) return { changed: false, reason: 'no moov box' };
    if (moov !== top[top.length - 1]) return { changed: false, reason: 'moov is not the last box (faststart layout); not patched' };
    if (moov.hdr !== 8) return { changed: false, reason: '64-bit moov size; not patched' };
    const buf = Buffer.alloc(moov.size);
    fs.readSync(fd, buf, 0, moov.size, moov.pos);
    const hits = findColr(buf, 8, moov.size, [{ p: 0, size: moov.size, type: 'moov', hdr: 8 }], []);
    const todo = hits.filter((h) => buf.toString('latin1', h.colr.p + 8, h.colr.p + 12) === 'nclc' && h.colr.size === 18);
    if (!todo.length) {
      const nclx = hits.filter((h) => buf.toString('latin1', h.colr.p + 8, h.colr.p + 12) === 'nclx').length;
      return { changed: false, tracks: nclx, reason: nclx ? 'already nclx' : 'no colr nclc box' };
    }
    // build the new moov: copy, inserting one byte after each patched colr and growing every ancestor by one
    const grow = new Map(); // position of an ancestor header -> bytes added inside it
    for (const h of todo) for (const a of h.ancestors) if (a.hdr === 8) grow.set(a.p, (grow.get(a.p) || 0) + 1); else throw new Error('64-bit box size inside moov');
    const out = Buffer.alloc(moov.size + todo.length);
    let src = 0, dst = 0;
    for (const h of [...todo].sort((x, y) => x.colr.p - y.colr.p)) {
      const end = h.colr.p + 18;
      buf.copy(out, dst, src, end); dst += end - src; src = end;
      out[dst++] = fullRange ? 0x80 : 0x00;  // full_range_flag (1 bit) + reserved (7 bits)
    }
    buf.copy(out, dst, src);
    // fix sizes and the colr type: positions shift by the number of inserted bytes before them
    const shift = (p) => todo.filter((h) => h.colr.p + 18 <= p).length;
    for (const [p, add] of grow) { const q = p + shift(p); out.writeUInt32BE(buf.readUInt32BE(p) + add, q); }
    for (const h of todo) { const q = h.colr.p + shift(h.colr.p); out.writeUInt32BE(19, q); out.write('nclx', q + 8, 'latin1'); }
    fs.writeSync(fd, out, 0, out.length, moov.pos);
    return { changed: true, tracks: todo.length };
  } finally { fs.closeSync(fd); }
}
