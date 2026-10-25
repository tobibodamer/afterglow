// WebGL renderer creation with the settings the accumulation pipeline depends on, plus GPU identification.
import * as THREE from 'three';

export function createRenderer({ width, height, canvas = null, shadows = true } = {}) {
  canvas = canvas || document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  if (!canvas.parentNode && document.body) document.body.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: false, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance',
    preserveDrawingBuffer: false, precision: 'highp', logarithmicDepthBuffer: false,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  // three's default autoClear = true stays on for module code (CubeCamera captures, module render targets): a module
  // that renders a cube with autoClear off gets garbage from the second capture on. The accumulation quad, the only
  // draw that must NOT clear, switches it off locally (accum.js renderSub).
  renderer.autoClear = true;
  renderer.toneMapping = THREE.NoToneMapping;          // tone mapping happens once, in the final pass
  renderer.outputColorSpace = THREE.SRGBColorSpace;    // only affects drawing to the canvas (we never do, except present())
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;        // r186 removed PCFSoftShadowMap; softness comes from light jitter
  renderer.shadowMap.autoUpdate = true;                // re-rendered every sub-frame (jittered light, moving casters)
  return renderer;
}

export function gpuInfo(renderer) {
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext,
    floatBlend: !!gl.getExtension('EXT_float_blend'),
    colorBufferFloat: !!gl.getExtension('EXT_color_buffer_float'),
    floatLinear: !!gl.getExtension('OES_texture_float_linear'),
    maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    three: THREE.REVISION,
  };
}

/**
 * Force a CPU/GPU sync (1x1 readback) so timings measure GPU work, not command submission. Returns the pixel's alpha,
 * or NaN when the read did not happen (a lost context makes readPixels a silent no-op, so a sentinel is checked).
 */
const _px = new Float32Array(4);
export function syncGPU(renderer, floatTarget) {
  _px[3] = NaN;
  renderer.readRenderTargetPixels(floatTarget, 0, 0, 1, 1, _px);
  return _px[3];
}

/**
 * Context-loss watch. A lost WebGL context (GPU process crash, driver reset) turns every GL call, readPixels included,
 * into a silent no-op, and three restores the context afterwards with its GPU state gone. Either way the session's
 * frames are no longer trustworthy, so a loss is sticky: once seen, every later check throws.
 */
export function watchContext(renderer, getFrame = () => null) {
  const st = { lost: 0, restored: 0, firstFrame: null };
  const canvas = renderer.domElement;
  canvas.addEventListener('webglcontextlost', () => {
    st.lost++; if (st.firstFrame === null) st.firstFrame = getFrame();
    console.error(`[AG] WebGL context LOST (near frame ${getFrame()}): this session is invalid; the driver must retry in a fresh session`);
  });
  canvas.addEventListener('webglcontextrestored', () => { st.restored++; console.error('[AG] WebGL context restored by the browser; the session stays invalid'); });
  st.check = (where) => {
    const gl = renderer.getContext();
    if (st.lost || gl.isContextLost()) {
      throw new Error(`WebGL context lost (${where}; ${st.lost} loss event(s), first near frame ${st.firstFrame}, isContextLost=${gl.isContextLost()}): frames rendered since then are invalid; render again in a fresh session`);
    }
  };
  return st;
}
