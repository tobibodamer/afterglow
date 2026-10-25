// Pack the raw pianist GLB for the repo and the three.js page:
//   node tools/pianist/pack.mjs <pianist_raw.glb> <tex_dir> <out.glb>
// - images -> WebP (EXT_texture_webp, encoded by py/encode_textures.py), hand texture set attached to 'pianist_skin_hand'
// - dedup + prune, then meshopt 'high' (EXT_meshopt_compression, FILTER method): reorder + quantize (16-bit positions,
//   12-bit UVs, 8-bit colours/weights; normals via the octahedral filter). three r186 decodes it with
//   scene/src/pianist/vendor/meshopt_decoder.module.js.
// Writes <out.glb>.pack.json with sizes, counts and the gltf-transform / meshoptimizer versions.
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, prune, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const [src, texDir, out] = process.argv.slice(2);
if (!src || !texDir || !out) { console.error('usage: node pack.mjs raw.glb tex_dir out.glb'); process.exit(2); }
const t0 = Date.now();
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(src);
const root = doc.getRoot();
const man = JSON.parse(fs.readFileSync(path.join(texDir, 'manifest.json'), 'utf8'));
doc.createExtension(EXTTextureWebP).setRequired(true);

// 1. every existing image -> its WebP (same order as the GLB images array)
const textures = root.listTextures();
if (textures.length !== man.images.length) throw new Error(`texture count ${textures.length} != manifest ${man.images.length}`);
textures.forEach((tex, i) => {
  const m = man.images[i];
  tex.setImage(new Uint8Array(fs.readFileSync(path.join(texDir, m.file)))).setMimeType('image/webp')
    .setURI(`${(tex.getName() || 'img' + i).replace(/[^\w.-]+/g, '_').replace(/\.(png|jpe?g)$/i, '')}.webp`);
});

// 2. hand texture set
const hand = root.listMaterials().find((m) => m.getName() === 'pianist_skin_hand');
if (!hand) throw new Error('pianist_skin_hand material missing');
const mk = (k, name) => {
  const h = man.hand[k]; if (!h) throw new Error(`hand ${k} texture missing`);
  return doc.createTexture(name).setImage(new Uint8Array(fs.readFileSync(path.join(texDir, h.file)))).setMimeType('image/webp').setURI(`${name}.webp`);
};
const old = hand.getBaseColorTexture();
const tA = mk('albedo', 'hand_albedo'), tN = mk('normal', 'hand_normal'), tO = mk('orm', 'hand_orm');
hand.setBaseColorTexture(tA).setBaseColorFactor([1, 1, 1, 1])
  .setNormalTexture(tN).setNormalScale(1)
  .setMetallicRoughnessTexture(tO).setMetallicFactor(0).setRoughnessFactor(1)
  .setOcclusionTexture(tO).setOcclusionStrength(1);
if (old) old.dispose();
// nail plates (py/nails.py): one skinned mesh on the body's skin, material 'pianist_nail' = the hand texture set
let nailInfo = null;
if (fs.existsSync(path.join(texDir, 'nails.json'))) {
  nailInfo = JSON.parse(fs.readFileSync(path.join(texDir, 'nails.json'), 'utf8'));
  const bin = fs.readFileSync(path.join(texDir, 'nails.bin'));
  const view = (k) => {
    const L = nailInfo.layout[k]; const n = L.count * L.comps;
    const C = { f32: Float32Array, u16: Uint16Array, u32: Uint32Array }[L.type];
    return new C(bin.buffer.slice(bin.byteOffset + L.offset, bin.byteOffset + L.offset + n * C.BYTES_PER_ELEMENT));
  };
  const bodyNode = root.listNodes().find((n) => n.getMesh() && n.getMesh().listPrimitives().some((p) => p.getMaterial() === hand));
  if (!bodyNode) throw new Error('body node (pianist_skin_hand) not found');
  const buffer = root.listBuffers()[0];
  const acc = (k, type) => doc.createAccessor(k).setType(type).setArray(view(k)).setBuffer(buffer);
  const nailMat = doc.createMaterial('pianist_nail').setBaseColorTexture(tA).setBaseColorFactor([1, 1, 1, 1])
    .setNormalTexture(tN).setNormalScale(1).setMetallicRoughnessTexture(tO).setMetallicFactor(0).setRoughnessFactor(0.6)
    .setOcclusionTexture(tO).setOcclusionStrength(1);
  const prim = doc.createPrimitive().setMaterial(nailMat).setIndices(acc('indices', 'SCALAR'))
    .setAttribute('POSITION', acc('POSITION', 'VEC3')).setAttribute('NORMAL', acc('NORMAL', 'VEC3'))
    .setAttribute('TEXCOORD_0', acc('TEXCOORD_0', 'VEC2')).setAttribute('JOINTS_0', acc('JOINTS_0', 'VEC4'))
    .setAttribute('WEIGHTS_0', acc('WEIGHTS_0', 'VEC4')).setAttribute('_THICK', acc('_THICK', 'SCALAR'));
  const mesh = doc.createMesh('Pianist_nails').addPrimitive(prim);
  const node = doc.createNode('Pianist_nails').setMesh(mesh).setSkin(bodyNode.getSkin())
    .setTranslation(bodyNode.getTranslation()).setRotation(bodyNode.getRotation()).setScale(bodyNode.getScale());
  const parent = bodyNode.getParentNode();
  if (parent) parent.addChild(node); else root.listScenes().forEach((s) => { if (s.listChildren().includes(bodyNode)) s.addChild(node); });
  console.log(`[pack] nails: ${nailInfo.verts} verts, ${nailInfo.tris} tris`);
}
// suit seams / cloth unevenness (py/suit_textures.py)
const suit = root.listMaterials().find((m) => m.getName() === 'pianist_suit');
if (suit && man.suit_normal) {
  suit.setNormalTexture(doc.createTexture('suit_normal').setImage(new Uint8Array(fs.readFileSync(path.join(texDir, man.suit_normal.file)))).setMimeType('image/webp').setURI('suit_normal.webp')).setNormalScale(1);
  // button discs (UV centre + radii) -> material extras (three: material.userData.buttons) -> the module shades them as horn
  const stj = path.join(texDir, 'suit_textures.json');
  if (fs.existsSync(stj)) {
    const st = JSON.parse(fs.readFileSync(stj, 'utf8'));
    if (st.buttons && st.buttons.length) suit.setExtras({ ...(suit.getExtras() || {}), buttons: st.buttons.map((b) => ({ c: b.c, r: b.r })) });
  }
}

// 3. geometry
await doc.transform(
  dedup(),
  prune({ keepAttributes: true }),
  meshopt({ encoder: MeshoptEncoder, level: 'high', quantizePosition: 16, quantizeTexcoord: 12, quantizeNormal: 8,
            quantizeColor: 8, quantizeWeight: 8, quantizeGeneric: 12 }),
);

fs.mkdirSync(path.dirname(out), { recursive: true });
await io.write(out, doc);
const bytes = fs.statSync(out).size;
const meshes = root.listMeshes().map((m) => ({ name: m.getName(), prims: m.listPrimitives().map((p) => ({
  verts: p.getAttribute('POSITION').getCount(), tris: p.getIndices() ? p.getIndices().getCount() / 3 : null,
  material: p.getMaterial()?.getName(), attributes: p.listSemantics() })) }));
const imgBytes = root.listTextures().reduce((s, t) => s + (t.getImage()?.byteLength || 0), 0);
const rep = { src: path.basename(src), out: path.basename(out), bytes, mb: +(bytes / 1048576).toFixed(2), textureBytes: imgBytes,
  seconds: (Date.now() - t0) / 1000, versions: { gltfTransform: '4.2.1', meshoptimizer: '0.25.0' }, meshes,
  textures: root.listTextures().map((t) => ({ name: t.getName(), mime: t.getMimeType(), bytes: t.getImage()?.byteLength, size: t.getSize() })) };
fs.writeFileSync(out + '.pack.json', JSON.stringify(rep, null, 1));
console.log(`[pack] wrote ${out} ${rep.mb} MB (textures ${(imgBytes / 1048576).toFixed(2)} MB) in ${rep.seconds} s`);
