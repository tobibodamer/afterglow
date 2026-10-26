// Per-pass GPU / CPU profiler (render/profile.mjs; AG.init({ profile: true })). Never changes pixels.
//
// Every renderer.render() call (scenes, reflectors, cube faces, PMREM, full-screen quads) and every shadow-map update
// becomes a node keyed by its path: phase > pass > nested pass, e.g. 'subframes>scene:AG.sceneRT>scene:reflector'.
// GPU time is measured with EXT_disjoint_timer_query_webgl2. WebGL allows one TIME_ELAPSED query at a time, so a
// nested pass ends its parent's query and the parent resumes in a new one: every node's time is EXCLUSIVE (its own
// draws only), and the node times add up to the frame's GPU time. CPU time (JS submission) is exclusive the same way.
// Draw calls and primitives are counted at the GL entry points.
const now = () => performance.now();

function targetName(rt) {
  if (!rt) return 'canvas';
  const n = rt.texture?.name;
  if (n) return n;
  return `${rt.isWebGLCubeRenderTarget ? 'cube' : 'rt'}${rt.width}x${rt.height}`;
}

export class GpuProfiler {
  constructor(renderer) {
    this.renderer = renderer;
    const gl = this.gl = renderer.getContext();
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.phase = 'frame';
    this.stack = [];
    this.cur = null;          // { key, q, cpu0 }
    this.pending = [];        // [{ key, q }]
    this.nodes = new Map();   // key -> { gpu, cpu, calls, draws, prims }
    this._wrap();
  }

  get gpuTimers() { return !!this.ext; }

  _node(key) {
    let n = this.nodes.get(key);
    if (!n) { n = { gpu: 0, cpu: 0, calls: 0, draws: 0, prims: 0 }; this.nodes.set(key, n); }
    return n;
  }

  _begin(key) {
    let q = null;
    if (this.ext) { q = this.gl.createQuery(); this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q); }
    this.cur = { key, q, cpu0: now() };
  }

  _end() {
    const c = this.cur;
    if (!c) return;
    if (c.q) { this.gl.endQuery(this.ext.TIME_ELAPSED_EXT); this.pending.push({ key: c.key, q: c.q }); }
    this._node(c.key).cpu += now() - c.cpu0;
    this.cur = null;
  }

  push(label) {
    this._end();
    const parent = this.stack.length ? this.stack[this.stack.length - 1] : this.phase;
    const key = `${parent}>${label}`;
    this.stack.push(key);
    this._node(key).calls++;
    this._begin(key);
  }

  pop() {
    this._end();
    this.stack.pop();
    if (this.stack.length) this._begin(this.stack[this.stack.length - 1]);
  }

  setPhase(p) { this.phase = p; }

  /** CPU-only work outside render calls (module updates, hooks): fn() timed into the node '<phase>>js:<label>' */
  time(label, fn) {
    const key = `${this.phase}>js:${label}`, t0 = now();
    try { return fn(); } finally { const n = this._node(key); n.cpu += now() - t0; n.calls++; }
  }

  _wrap() {
    const r = this.renderer, self = this;
    const render = r.render.bind(r);
    r.render = function (scene, camera) {
      const rt = r.getRenderTarget();
      const label = scene.isScene ? `scene:${targetName(rt)}:${camera.name || camera.type}` : `quad:${scene.material?.name || scene.name || 'mesh'}`;
      self.push(label);
      try { return render(scene, camera); } finally { self.pop(); }
    };
    const sm = r.shadowMap, smRender = sm.render.bind(sm);
    sm.render = function (...a) { self.push('shadowMap'); try { return smRender(...a); } finally { self.pop(); } };
    const gl = this.gl;
    const count = (prims) => { const k = self.stack.length ? self.stack[self.stack.length - 1] : `${self.phase}>loose`; const n = self._node(k); n.draws++; n.prims += prims; };
    const per = (mode) => (mode === gl.TRIANGLES ? 1 / 3 : mode === gl.LINES ? 0.5 : mode === gl.POINTS ? 1 : 1);
    for (const [fn, prims] of [
      ['drawArrays', (m, f, c) => c * per(m)],
      ['drawElements', (m, c) => c * per(m)],
      ['drawArraysInstanced', (m, f, c, n) => c * n * per(m)],
      ['drawElementsInstanced', (m, c, t, o, n) => c * n * per(m)],
    ]) {
      const orig = gl[fn].bind(gl);
      gl[fn] = (...a) => { count(prims(...a)); return orig(...a); };
    }
  }

  /** wait for this frame's queries, then return { gpuMs, cpuMs, nodes: [{key, gpu, cpu, calls, draws, prims}], disjoint } and reset */
  async collect() {
    this._end();
    const gl = this.gl, ext = this.ext;
    let disjoint = false;
    if (ext) {
      for (let tries = 0; tries < 2000; tries++) {
        const last = this.pending[this.pending.length - 1];
        if (!last || gl.getQueryParameter(last.q, gl.QUERY_RESULT_AVAILABLE)) break;
        await new Promise((res) => setTimeout(res, 1));
      }
      disjoint = !!gl.getParameter(ext.GPU_DISJOINT_EXT);
      for (const { key, q } of this.pending) {
        if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) this._node(key).gpu += gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
        gl.deleteQuery(q);
      }
    }
    this.pending = [];
    const nodes = [...this.nodes].map(([key, n]) => ({ key, ...n, gpu: +n.gpu.toFixed(3), cpu: +n.cpu.toFixed(3), prims: Math.round(n.prims) }));
    this.nodes = new Map();
    const sum = (k) => +nodes.reduce((s, n) => s + n[k], 0).toFixed(3);
    return { gpuTimers: !!ext, disjoint, gpuMs: sum('gpu'), cpuMs: sum('cpu'), draws: sum('draws'), prims: sum('prims'), nodes };
  }
}
