"""Minimal GLB reader (numpy only): JSON, accessors, images, node world matrices. Uncompressed GLBs only (the raw p5
export); the packed assets/pianist/pianist.glb uses EXT_meshopt_compression and is checked in three.js instead."""
import json, struct
import numpy as np

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


class GLB:
    def __init__(self, path):
        data = open(path, 'rb').read()
        magic, ver, length = struct.unpack_from('<III', data, 0)
        assert magic == 0x46546C67, 'not a GLB'
        off = 12; self.js = None; self.bin = None
        while off < length:
            clen, ctype = struct.unpack_from('<II', data, off); off += 8
            chunk = data[off:off + clen]; off += clen
            if ctype == 0x4E4F534A: self.js = json.loads(chunk)
            elif ctype == 0x004E4942: self.bin = chunk
        self.nodes = self.js['nodes']
        self.parent = {}
        for i, n in enumerate(self.nodes):
            for c in n.get('children', []):
                self.parent[c] = i
        self._world = {}

    def acc(self, i):
        a = self.js['accessors'][i]; bv = self.js['bufferViews'][a['bufferView']]
        dt = np.dtype(CT[a['componentType']]); n = NC[a['type']]
        stride = bv.get('byteStride', dt.itemsize * n)
        start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        raw = np.frombuffer(self.bin, dtype=np.uint8, count=stride * (a['count'] - 1) + dt.itemsize * n, offset=start)
        arr = np.lib.stride_tricks.as_strided(raw, shape=(a['count'], dt.itemsize * n), strides=(stride, 1)).copy()
        arr = arr.view(dt).reshape(a['count'], n)
        if a.get('normalized'):
            arr = arr.astype(np.float32) / np.iinfo(dt).max
        return arr

    def image_bytes(self, img_index):
        im = self.js['images'][img_index]
        bv = self.js['bufferViews'][im['bufferView']]
        o = bv.get('byteOffset', 0)
        return self.bin[o:o + bv['byteLength']], im.get('mimeType')

    @staticmethod
    def qmat(q):
        x, y, z, w = q
        return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                         [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                         [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])

    def local(self, i):
        n = self.nodes[i]
        if 'matrix' in n:
            return np.array(n['matrix']).reshape(4, 4).T
        M = np.eye(4)
        M[:3, :3] = self.qmat(n.get('rotation', [0, 0, 0, 1])) @ np.diag(n.get('scale', [1, 1, 1]))
        M[:3, 3] = n.get('translation', [0, 0, 0])
        return M

    def world(self, i):
        if i not in self._world:
            M = self.local(i)
            if i in self.parent: M = self.world(self.parent[i]) @ M
            self._world[i] = M
        return self._world[i]

    def node_index(self, name):
        for i, n in enumerate(self.nodes):
            if n.get('name') == name: return i
        raise KeyError(name)

    def mesh_primitives(self, node_name_part):
        out = []
        for i, n in enumerate(self.nodes):
            if 'mesh' in n and node_name_part in n.get('name', ''):
                for p in self.js['meshes'][n['mesh']]['primitives']:
                    out.append((i, p))
        return out

    def material_name(self, p):
        return self.js['materials'][p['material']]['name'] if 'material' in p else None
