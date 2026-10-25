# Production pianist build: one command rebuilds assets/pianist/ from CC0 MakeHuman assets + our scripts.
#   pwsh -File tools/pianist/run_all.ps1 [-Work build/pianist/work] [-RebakeCloth] [-From p1|p3|p2|p4|p5|tex|pack|rig]
# Stages (headless Blender 5.2.2 + MPFB 2.0.18, then Python/numpy and Node):
#   p1 build -> p3 dress+groom -> p2 seated pose -> p4 cloth (only with -RebakeCloth or when the frozen bake is missing)
#   -> p5 export raw GLB (bind = seated, frozen cloth) -> tex (hand texture set, nail plates, suit seams, WebP)
#   -> pack (meshopt GLB, adds the nail mesh)
#   -> inspect + rig contract -> assets/pianist/{pianist.glb, rig.json, pianist.inspect.json}
# Deterministic: every stage is seeded or analytic except the Blender cloth solve, which is baked once into
# tools/pianist/frozen/cloth_suit.npz (reviewed, committed) and reused by every later run.
param(
  [string]$Work = "$PSScriptRoot\..\..\build\pianist\work",
  [switch]$RebakeCloth,
  [string]$From = 'p1',
  # fix round 1: compression folds in the suit geometry (mm, p5 + py/suitfolds.py) on a subdivision-2 suit; the suit
  # normal map then keeps only a light fold layer (suit_textures --fold-mm)
  [double]$SuitFolds = 5.0,
  [int]$SuitSubdiv = 2,
  [double]$FoldMm = 1.0
)
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path "$PSScriptRoot\..\..").Path
$B = "E:\experimentswithclaude\tools\blender\blender-5.2.2-windows-x64\blender.exe"
if ($env:AG_BLENDER) { $B = $env:AG_BLENDER }
$PY = "$Root\.venv\Scripts\python.exe"
$S = $PSScriptRoot
$Frozen = "$S\frozen\cloth_suit.npz"
$Assets = "$Root\assets\pianist"
New-Item -ItemType Directory -Force $Work, $Assets | Out-Null
$Work = (Resolve-Path $Work).Path
$log = "$Work\run_all.log"
"run_all $(Get-Date -Format o) from=$From rebake=$RebakeCloth" | Add-Content $log
$order = @('p1', 'p3', 'p2', 'p4', 'p5', 'tex', 'pack', 'rig')
$start = [array]::IndexOf($order, $From)
if ($start -lt 0) { throw "unknown -From $From" }
function Run { $exe, $rest = $args; & $exe @rest; if ($LASTEXITCODE -ne 0) { throw "$exe $rest failed (exit $LASTEXITCODE)" } }
function Stage($name, [scriptblock]$cmd) {
  if ([array]::IndexOf($order, $name) -lt $start) { "[$name] skipped (-From $From)" | Tee-Object -Append $log; return }
  $t = [Diagnostics.Stopwatch]::StartNew()
  & $cmd 2>&1 | Out-File -Append $log -Encoding utf8
  $code = $LASTEXITCODE
  "[$name] $([math]::Round($t.Elapsed.TotalSeconds,1)) s exit $code" | Tee-Object -Append $log
  if ($code -ne 0) { throw "stage $name failed (exit $code), see $log" }
}
Stage 'p1' { & $B -b -noaudio --python-exit-code 1 --python "$S\blender\p1_build.py" -- $Work }
Stage 'p3' { & $B -b "$Work\p1.blend" -noaudio --python-exit-code 1 --python "$S\blender\p3_dress_groom.py" -- $Work }
Stage 'p2' { & $B -b "$Work\p3.blend" -noaudio --python-exit-code 1 --python "$S\blender\p2_pose.py" -- $Work }
if ($RebakeCloth -or -not (Test-Path $Frozen)) {
  Stage 'p4' { & $B -b "$Work\p2.blend" -noaudio --python-exit-code 1 --python "$S\blender\p4_cloth.py" -- $Work --freeze $Frozen }
} else { "[p4] frozen cloth reused: $Frozen" | Tee-Object -Append $log }
Stage 'p5' { & $B -b "$Work\p2.blend" -noaudio --python-exit-code 1 --python "$S\blender\p5_export.py" -- "$Work\pianist_raw.glb" --frame 90 --cloth $Frozen --suit-folds $SuitFolds --suit-subdiv $SuitSubdiv }
Stage 'tex' {
  Run $PY -I "$S\py\hand_textures.py" "$Work\pianist_raw.glb" "$Work\tex"       # also writes tex/nail_frames.json
  Run $PY -I "$S\py\nails.py" "$Work\pianist_raw.glb" "$Work\tex"               # nail plate meshes (pack adds them)
  Run $PY -I "$S\py\suit_textures.py" "$Work\pianist_raw.glb" "$Work\tex" --fold-mm $FoldMm
  Run $PY -I "$S\py\encode_textures.py" "$Work\pianist_raw.glb" "$Work\tex"
}
Stage 'pack' { node "$S\pack.mjs" "$Work\pianist_raw.glb" "$Work\tex" "$Assets\pianist.glb" }
Stage 'rig' {
  Run $PY -I "$S\py\inspect_glb.py" "$Work\pianist_raw.glb" "$Assets\pianist.inspect.json"   # raw = same meshes, uncompressed
  Run $PY -I "$S\py\rig_contract.py" "$Assets\pianist.glb" "$Assets\rig.json" "$Work\pianist_raw.glb.json"
  Run node "$S\verify_pack.mjs" "$Work\pianist_raw.glb" "$Assets\pianist.glb"      # quantisation error, joints
  Run node "$S\check_frames.mjs" "$Assets\rig.json"                               # fingertips vs piano keys
}
"done $(Get-Date -Format o)" | Tee-Object -Append $log

