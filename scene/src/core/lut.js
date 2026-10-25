// 3-D colour LUT slot for the final pass. Identity by default; loads an Adobe/Resolve .cube file or a Float32 table.
//
// Convention: the LUT maps display-encoded sRGB (after PBR Neutral, saturation and lift/gamma/gain, after the sRGB
// OETF) in [0,1]^3 to display-encoded sRGB. Table order is the .cube order: red changes fastest, then green, then
// blue, i.e. index = r + g*S + b*S*S, which is exactly the Data3DTexture layout (x = r, y = g, z = b).
// A Float32 table is S^3 * 3 (RGB) or S^3 * 4 (RGBA) floats; S is inferred (33 is the project default).
import * as THREE from 'three';

export function identityTable(size = 33) {
  const d = new Float32Array(size * size * size * 3);
  let o = 0;
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    d[o++] = r / (size - 1); d[o++] = g / (size - 1); d[o++] = b / (size - 1);
  }
  return { size, data: d, domainMin: [0, 0, 0], domainMax: [1, 1, 1], title: 'identity' };
}

export function parseCube(text) {
  let size = 0, title = '', domainMin = [0, 0, 0], domainMax = [1, 1, 1];
  const vals = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const kw = line.split(/\s+/)[0].toUpperCase();
    if (kw === 'TITLE') { title = line.slice(5).trim().replace(/^"|"$/g, ''); continue; }
    if (kw === 'LUT_3D_SIZE') { size = parseInt(line.split(/\s+/)[1], 10); continue; }
    if (kw === 'LUT_1D_SIZE') throw new Error('.cube: 1-D LUTs are not supported');
    if (kw === 'DOMAIN_MIN') { domainMin = line.split(/\s+/).slice(1, 4).map(Number); continue; }
    if (kw === 'DOMAIN_MAX') { domainMax = line.split(/\s+/).slice(1, 4).map(Number); continue; }
    if (kw === 'LUT_3D_INPUT_RANGE') { const [a, b] = line.split(/\s+/).slice(1, 3).map(Number); domainMin = [a, a, a]; domainMax = [b, b, b]; continue; }
    if (/^[A-Z_]+$/.test(kw)) continue; // unknown keyword
    const p = line.split(/\s+/).map(Number);
    if (p.length < 3 || p.some((x) => !Number.isFinite(x))) throw new Error(`.cube: bad data line "${line}"`);
    vals.push(p[0], p[1], p[2]);
  }
  if (!(size >= 2)) throw new Error('.cube: missing LUT_3D_SIZE');
  if (vals.length !== size ** 3 * 3) throw new Error(`.cube: expected ${size ** 3} entries, got ${vals.length / 3}`);
  return { size, data: new Float32Array(vals), domainMin, domainMax, title };
}

export function fromFloat32(arr, size = 0) {
  const f = arr instanceof Float32Array ? arr : new Float32Array(arr);
  let ch = 3;
  if (!size) {
    const s3 = Math.round(Math.cbrt(f.length / 3)), s4 = Math.round(Math.cbrt(f.length / 4));
    if (s3 ** 3 * 3 === f.length) size = s3; else if (s4 ** 3 * 4 === f.length) { size = s4; ch = 4; } else throw new Error(`LUT table length ${f.length} is not S^3*3 or S^3*4`);
  } else if (f.length === size ** 3 * 4) ch = 4;
  if (f.length !== size ** 3 * ch) throw new Error(`LUT table length ${f.length} does not match size ${size}`);
  let data = f;
  if (ch === 4) { data = new Float32Array(size ** 3 * 3); for (let i = 0; i < size ** 3; i++) { data[i * 3] = f[i * 4]; data[i * 3 + 1] = f[i * 4 + 1]; data[i * 3 + 2] = f[i * 4 + 2]; } }
  return { size, data, domainMin: [0, 0, 0], domainMax: [1, 1, 1], title: 'float32' };
}

/** THREE.Data3DTexture (RGBA32F, trilinear) from a parsed table */
export function lutTexture(lut) {
  const n = lut.size ** 3, rgba = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { rgba[i * 4] = lut.data[i * 3]; rgba[i * 4 + 1] = lut.data[i * 3 + 1]; rgba[i * 4 + 2] = lut.data[i * 3 + 2]; rgba[i * 4 + 3] = 1; }
  const tex = new THREE.Data3DTexture(rgba, lut.size, lut.size, lut.size);
  tex.format = THREE.RGBAFormat; tex.type = THREE.FloatType;
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false; tex.unpackAlignment = 1; tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  tex.userData = { size: lut.size, domainMin: lut.domainMin, domainMax: lut.domainMax, title: lut.title };
  return tex;
}

/** load a LUT from a URL (.cube text, anything else = raw little-endian Float32) */
export async function loadLut(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`LUT ${url}: HTTP ${res.status}`);
  if (/\.cube(\?|$)/i.test(url)) return parseCube(await res.text());
  return fromFloat32(new Float32Array(await res.arrayBuffer()));
}
