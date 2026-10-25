// Headless Chrome launch for offline rendering (research/rendering.md section 1) + GPU sanity check.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { launchWithGpuLock } from './gpulock.mjs';

export const CHROME = process.env.AG_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// ANGLE on D3D11 is Chrome's default on Windows; we pin it. --disable-software-rasterizer removes the SwiftShader
// fallback, so a broken GPU path fails instead of silently rendering on the CPU.
export const GPU_FLAGS = [
  '--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-gpu-watchdog', '--disable-gpu-process-crash-limit',
  '--force_high_performance_gpu', '--disable-software-rasterizer',
];

export const COMMON_FLAGS = [
  '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--hide-scrollbars',
  '--mute-audio', '--disable-dev-shm-usage', '--disable-extensions', '--disable-component-update',
  // gc() after each upload releases the frame Blobs; without it blob storage fills up at ~60 frames of 1080p and every
  // fetch fails with "Failed to fetch" (research/rendering.md section 3)
  '--js-flags=--expose-gc',
];

export async function launchChrome({ width = 1920, height = 1080, headless = true, extra = [] } = {}) {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME} (set AG_CHROME)`);
  // one GPU client machine-wide (render/lib/gpulock.mjs): concurrent renderers bluescreened the 780M twice
  return launchWithGpuLock(puppeteer, {
    executablePath: CHROME,
    headless,
    args: [...COMMON_FLAGS, ...GPU_FLAGS, ...extra, `--window-size=${Math.min(width, 3840)},${Math.min(height, 2160)}`],
    defaultViewport: { width: Math.min(width, 3840), height: Math.min(height, 2160), deviceScaleFactor: 1 },
    protocolTimeout: 30 * 60 * 1000, // a single 4K N=64 frame can take a while, but never hang forever
  }, `render:${process.argv[1] ? process.argv[1].split(/[\\/]/).pop() : 'chrome'}`);
}

const SOFTWARE = /swiftshader|llvmpipe|softpipe|microsoft basic render|software/i;

/**
 * Fail loudly unless the WebGL renderer is the expected GPU. Default expectation: Radeon 780M (this machine).
 * AG_GPU_EXPECT=<regex> changes it; AG_GPU_ANY=1 accepts any hardware GPU (never a software rasterizer).
 */
export function assertGpu(rendererString, { expect = process.env.AG_GPU_EXPECT || 'Radeon.*780M' } = {}) {
  const s = String(rendererString || '');
  if (!s) throw new Error('GPU check failed: WebGL renderer string is empty (no WEBGL_debug_renderer_info?)');
  if (SOFTWARE.test(s)) throw new Error(`GPU check FAILED: WebGL is running on a software rasterizer: "${s}". Refusing to render.`);
  if (!new RegExp(expect, 'i').test(s)) {
    if (process.env.AG_GPU_ANY === '1') { console.warn(`[gpu] WARNING: unexpected GPU "${s}" (AG_GPU_ANY=1, continuing)`); return s; }
    throw new Error(`GPU check FAILED: expected /${expect}/i, got "${s}". Set AG_GPU_EXPECT or AG_GPU_ANY=1 on another machine.`);
  }
  return s;
}
