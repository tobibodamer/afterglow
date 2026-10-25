// Pianist module slot (scene/src/main.js MODULE_SLOTS: './pianist/index.js'). Implementation: ./pianist.js.
// Asset: assets/pianist/pianist.glb (+ rig.json), rebuilt by tools/pianist/run_all.ps1. Options (AG.init moduleOptions.pianist):
//   glb, rig (URLs), benchHeight (0.47), scatterStrength (1.2), hairForward (1.0), keyOmega (0.35), keyMinElevDeg (10),
//   keyBlur (0.3), perfJson / perfBin (override the core's build/anim/perf.*), debugPose ([{bone, axis, deg, abs}]).
export { create, default } from './pianist.js';
