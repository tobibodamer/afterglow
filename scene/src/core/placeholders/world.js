// PLACEHOLDER world module: stands in for scene/src/world until the real one exists. Exercises every hook the real
// world will use: a sky bake per output frame (analytic gradient sky -> cube), an environment capture (PMREM of the
// sky cube), a planar-reflection water plane with analytic capillary rings, a jittered shadow-casting sun, and a
// simple mountain ring so reflections and DOF have something to show. Not look-dev: the real modules replace it.
import { Reflector } from 'three/addons/objects/Reflector.js';

const SKY_GLSL = /* glsl */`
uniform vec3 uSunDir;
// art-directed sunset gradient, scene-linear radiance (exposure 1 = film default)
vec3 skyRadiance(vec3 d) {
  float e = max(d.y, 0.0);
  vec2 hs = normalize(uSunDir.xz + 1e-6);
  float az = dot(normalize(d.xz + 1e-6), hs) * 0.5 + 0.5;           // 1 toward the sun, 0 away
  vec3 zen = vec3(0.050, 0.036, 0.120);
  vec3 mid = vec3(0.230, 0.080, 0.215);
  vec3 hor = mix(vec3(0.42, 0.13, 0.24), vec3(2.0, 0.70, 0.27), pow(az, 4.0));
  vec3 c = mix(hor, mid, smoothstep(0.0, 0.20, e));
  c = mix(c, zen, smoothstep(0.12, 0.75, e));
  float sd = max(dot(d, uSunDir), 0.0);
  c += vec3(2.6, 1.0, 0.35) * pow(sd, 300.0) + vec3(0.55, 0.20, 0.08) * pow(sd, 10.0) * smoothstep(-0.05, 0.05, d.y);
  if (d.y < 0.0) c = mix(c, vec3(0.020, 0.014, 0.030), smoothstep(0.0, -0.04, d.y));
  return c;
}
`;

// fixed pseudo-random ridge profile (no Math.random: a constant-seeded LCG)
function ridgeProfile(seed, n) {
  let s = seed >>> 0; const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const waves = Array.from({ length: n }, (_, i) => ({ f: 2 + i * 1.7 + rnd() * 3, a: 1 / (1 + i * 0.6), p: rnd() * 6.283 }));
  return (th) => {
    let h = 0, n2 = 0;
    for (const w of waves) { h += w.a * (1 - Math.abs(Math.sin(w.f * th + w.p))); n2 += w.a; }
    return h / n2;
  };
}

export async function create(ctx) {
  const { THREE, renderer, scene, sun, settings } = ctx;
  const group = new THREE.Group(); group.name = 'placeholder.world';

  // --- sky: analytic gradient on a sky-only scene, baked into a cube once per output frame ---
  const skyMat = new THREE.ShaderMaterial({
    name: 'placeholder.sky', side: THREE.BackSide, depthWrite: false, depthTest: false,
    uniforms: { uSunDir: { value: new THREE.Vector3(0, 0, -1) } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `${SKY_GLSL} varying vec3 vDir; void main(){ gl_FragColor = vec4(skyRadiance(normalize(vDir)), 1.0); }`,
  });
  const skyScene = new THREE.Scene();
  skyScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 96, 48), skyMat));
  const skyProbe = new ctx.core.CubeProbe(renderer, { size: settings.quality === 'preview' ? 256 : 512, near: 1, far: 1000 });
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null;

  ctx.registerSkyBake(() => {
    skyMat.uniforms.uSunDir.value.copy(sun.dir);
    skyProbe.capture(skyScene);
    scene.background = skyProbe.texture;
  });
  ctx.registerEnvCapture(() => {
    envRT = pmrem.fromCubemap(skyProbe.texture, envRT);
    scene.environment = envRT.texture;
  });

  // --- mountain ring: two silhouette layers with snow and aerial perspective toward the sky colour ---
  const mtnMat = new THREE.ShaderMaterial({
    name: 'placeholder.mountains',
    uniforms: { uSunDir: skyMat.uniforms.uSunDir },
    vertexShader: 'varying vec3 vW; varying float vH; attribute float aH; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vH = aH; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `${SKY_GLSL}
      varying vec3 vW; varying float vH;
      void main(){
        vec3 v = vW - cameraPosition; float dist = length(v); vec3 d = v / dist;
        vec3 rock = vec3(0.012, 0.010, 0.016);
        vec3 snow = vec3(0.10, 0.085, 0.13);
        vec3 c = mix(rock, snow, smoothstep(0.55, 0.8, vH));
        vec3 haze = skyRadiance(normalize(vec3(d.x, 0.02, d.z)));
        float a = 1.0 - exp(-dist / 9000.0);
        gl_FragColor = vec4(mix(c, haze, a * 0.85), 1.0);
      }`,
  });
  for (const [r, hMax, seed] of [[4200, 380, 11], [9000, 1100, 23]]) {
    const prof = ridgeProfile(seed, 9), A = 1024, R = 6;
    const pos = new Float32Array((A + 1) * (R + 1) * 3), hh = new Float32Array((A + 1) * (R + 1)), idx = [];
    for (let i = 0; i <= A; i++) {
      const th = (i / A) * Math.PI * 2, top = Math.pow(prof(th), 1.6) * hMax;
      for (let j = 0; j <= R; j++) {
        const u = j / R, o = i * (R + 1) + j, y = -40 + (top + 40) * u;
        pos[o * 3] = Math.sin(th) * r; pos[o * 3 + 1] = y; pos[o * 3 + 2] = -Math.cos(th) * r; hh[o] = u * Math.min(1, top / (hMax * 0.6));
        if (i < A && j < R) { const a = o, b = o + 1, c = o + R + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aH', new THREE.BufferAttribute(hh, 1)); g.setIndex(idx);
    const m = new THREE.Mesh(g, mtnMat); m.frustumCulled = false; m.material.side = THREE.DoubleSide; group.add(m);
  }

  // --- water: planar Reflector at y = 0 with analytic capillary-gravity rings + wind micro-ripples ---
  // dispersion w^2 = g k + (sigma/rho) k^3: lambda 0.15 m -> k = 41.9 rad/m, w = 20.4 rad/s (phase speed ~0.49 m/s)
  const K = 2 * Math.PI / 0.15, OMEGA = Math.sqrt(9.81 * K + (0.0728 / 1000) * K ** 3);
  const NSRC = 8;
  const rigSources = [[-0.62, 0.35], [0.62, 0.35], [0.0, 2.45], [-0.28, -0.75], [0.28, -0.75]]; // piano legs + bench legs (rig x,z)
  const WIND = [[0.9, 0.3, 7.0, 0.0011], [-0.4, 0.9, 11.0, 0.0008], [0.7, -0.7, 17.0, 0.0005], [-0.95, -0.2, 23.0, 0.0004], [0.2, 1.0, 31.0, 0.0003]];
  const reflScale = settings.quality === 'preview' ? 0.5 : 1.0;
  const water = new Reflector(new THREE.PlaneGeometry(40000, 40000), {
    textureWidth: Math.round(settings.width * reflScale), textureHeight: Math.round(settings.height * reflScale), clipBias: 0.0003, multisample: 0,
    shader: {
      name: 'placeholder.water',
      uniforms: {
        color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null },
        uSrc: { value: Array.from({ length: NSRC }, () => new THREE.Vector3()) }, uNumSrc: { value: 0 },
        uK: { value: K }, uPhase: { value: 0 }, uRingAmp: { value: 0.0012 },
        uWind: { value: WIND.map(([x, z, k, a]) => new THREE.Vector4(x * k, z * k, a, 0)) }, uWindPhase: { value: new Array(WIND.length).fill(0) },
        uF0: { value: 0.02 }, uDeep: { value: new THREE.Color(0.010, 0.008, 0.016) }, uDistort: { value: 0.6 },
      },
      vertexShader: 'uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vW; void main(){ vUv = textureMatrix * vec4(position,1.0); vW = (modelMatrix*vec4(position,1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse; uniform vec3 uSrc[${NSRC}]; uniform int uNumSrc; uniform float uK, uPhase, uRingAmp;
        uniform vec4 uWind[${WIND.length}]; uniform float uWindPhase[${WIND.length}]; uniform float uF0; uniform vec3 uDeep; uniform float uDistort;
        varying vec4 vUv; varying vec3 vW;
        void main(){
          vec2 grad = vec2(0.0);
          for (int i = 0; i < ${NSRC}; i++) { if (i >= uNumSrc) break;
            vec2 d = vW.xz - uSrc[i].xy; float r = max(length(d), 1e-3);
            float ph = uK * r - uPhase + uSrc[i].z;
            float aa = clamp(1.5 - fwidth(ph) / 2.0, 0.0, 1.0);             // fade rings finer than ~2 px
            float A = uRingAmp * exp(-r * 0.12) / sqrt(0.25 + r);
            grad += A * uK * cos(ph) * (d / r) * aa;
          }
          for (int i = 0; i < ${WIND.length}; i++) {
            float ph = dot(uWind[i].xy, vW.xz) - uWindPhase[i];
            float aa = clamp(1.5 - fwidth(ph) / 2.0, 0.0, 1.0);
            grad += uWind[i].z * uWind[i].xy * cos(ph) * aa;
          }
          vec3 N = normalize(vec3(-grad.x, 1.0, -grad.y));
          vec3 V = normalize(cameraPosition - vW);
          vec4 uv = vUv; uv.xy += N.xz * uDistort * uv.w * 0.1;
          vec3 refl = texture2DProj(tDiffuse, uv).rgb;
          float F = uF0 + (1.0 - uF0) * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
          gl_FragColor = vec4(refl * F + uDeep * (1.0 - F), 1.0);
        }`,
    },
  });
  water.rotation.x = -Math.PI / 2; water.name = 'placeholder.water';
  group.add(water);
  const wu = water.material.uniforms;
  const tmp = new THREE.Vector3();

  // --- sun: warm directional light, fades out below the horizon, jittered per sub-frame across a soft disk ---
  const light = new THREE.DirectionalLight(new THREE.Color(1.0, 0.52, 0.30), 3.0);
  light.castShadow = true; light.shadow.mapSize.set(2048, 2048);
  Object.assign(light.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 120 });
  light.shadow.bias = -0.0003; light.shadow.normalBias = 0.01;
  group.add(light, light.target);
  const baseDir = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
  const SOFT_DEG = 1.5; // angular radius of the shadow-light disk (sun 0.27 deg, widened to fake skylight softness)

  ctx.registerPreSubframe((sub) => {
    const r = Math.sqrt(sub.dim(0)) * SOFT_DEG * Math.PI / 180, a = 2 * Math.PI * sub.dim(1);
    right.crossVectors(baseDir, new THREE.Vector3(0, 1, 0)).normalize(); up.crossVectors(right, baseDir).normalize();
    tmp.copy(baseDir).addScaledVector(right, r * Math.cos(a)).addScaledVector(up, r * Math.sin(a)).normalize();
    light.position.copy(light.target.position).addScaledVector(tmp, 60);
  });

  return {
    group,
    beforeFrame(frame, t) {
      const elev = Math.max(sun.elevationDeg, 0.8) * Math.PI / 180;          // never light from below the water
      baseDir.set(Math.cos(elev) * sun.dir.x / Math.hypot(sun.dir.x, sun.dir.z), Math.sin(elev), Math.cos(elev) * sun.dir.z / Math.hypot(sun.dir.x, sun.dir.z)).normalize();
      light.intensity = 3.0 * THREE.MathUtils.smoothstep(sun.elevationDeg, -1.5, 1.0) + 0.25;
      ctx.rigGroup.updateMatrixWorld(true);
      light.target.position.setFromMatrixPosition(ctx.rigGroup.matrixWorld);
      light.position.copy(light.target.position).addScaledVector(baseDir, 60);
      wu.uNumSrc.value = rigSources.length;
      rigSources.forEach(([x, z], i) => { tmp.set(x, 0, z).applyMatrix4(ctx.rigGroup.matrixWorld); wu.uSrc.value[i].set(tmp.x, tmp.z, i * 1.37); });
    },
    update(t) {
      // phases wrapped on the CPU in double precision (w*t reaches ~4600 rad by the end of the film)
      wu.uPhase.value = (OMEGA * t) % (2 * Math.PI);
      WIND.forEach(([, , k], i) => { const w = Math.sqrt(9.81 * k + (0.0728 / 1000) * k ** 3); wu.uWindPhase.value[i] = (w * t) % (2 * Math.PI); });
    },
    dispose() { skyProbe.dispose(); pmrem.dispose(); envRT?.dispose(); water.dispose(); },
  };
}
