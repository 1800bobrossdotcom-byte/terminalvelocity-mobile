# ──────────────────────────────────────────────────────────────
# TERMINAL VELOCITY MOBILE  ·  video compression + corruption
# ──────────────────────────────────────────────────────────────
# Pulls the ter*.mp4 footage from the lovebeing repo, shrinks it
# aggressively, and (optionally) starves H.264 of bitrate until
# the bitstream itself becomes the aesthetic (smearing, blocky
# chroma, ghost frames). Movement is preserved because the
# encoder spends its tiny budget on motion vectors.
#
# Two modes:
#   -Mode clean       safe small encode (~150 kbps, 480x270, 20fps)
#   -Mode corrupted   bitrate-starved (~50 kbps, 360x202, 15fps,
#                     1 keyframe per file, no B-frames -> max smear)
#
# Requires: ffmpeg on PATH (winget install ffmpeg).
# ──────────────────────────────────────────────────────────────

param(
    [ValidateSet("clean","corrupted")]
    [string]$Mode = "corrupted",

    [string]$SourceDir = "$PSScriptRoot\..\..\lovebeing\public\collections\terminalvelocity\footage\ter",

    [string]$OutDir = "$PSScriptRoot\..\web\assets\videos"
)

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Error "ffmpeg not found on PATH. Install: winget install Gyan.FFmpeg"
    exit 1
}

if (-not (Test-Path $SourceDir)) {
    Write-Error "Source dir not found: $SourceDir"
    exit 1
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$videos = Get-ChildItem -Path $SourceDir -Filter *.mp4 -File
if ($videos.Count -eq 0) {
    Write-Error "No .mp4 files in $SourceDir"
    exit 1
}

# Encoder flags per mode. Both drop audio (the app has its own).
if ($Mode -eq "clean") {
    $vfilter = "scale=480:-2,fps=20"
    $bitrate = "150k"
    $maxrate = "180k"
    $bufsize = "300k"
    $gopArgs = @()
} else {
    # Corrupted: one keyframe at file start, no B-frames, only 1
    # reference frame -> any error propagates -> visible smear.
    $vfilter = "scale=360:-2,fps=15"
    $bitrate = "50k"
    $maxrate = "60k"
    $bufsize = "120k"
    $gopArgs = @("-g","9999","-bf","0","-refs","1","-sc_threshold","0")
}

Write-Host "[compress] mode=$Mode  source=$SourceDir  out=$OutDir"
Write-Host "[compress] $($videos.Count) file(s)"

$total = 0L
$totalOut = 0L

foreach ($v in $videos) {
    $outName = [System.IO.Path]::GetFileNameWithoutExtension($v.Name) + ".mp4"
    $outPath = Join-Path $OutDir $outName
    Write-Host "  -> $($v.Name)" -ForegroundColor Cyan

    $args = @(
        "-y","-hide_banner","-loglevel","error",
        "-i", $v.FullName,
        "-an",
        "-vf", $vfilter,
        "-c:v","libx264",
        "-preset","slow",
        "-pix_fmt","yuv420p",
        "-b:v",$bitrate,
        "-maxrate",$maxrate,
        "-bufsize",$bufsize,
        "-movflags","+faststart"
    ) + $gopArgs + @($outPath)

    & ffmpeg @args
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "    ffmpeg failed on $($v.Name) (exit $LASTEXITCODE)"
        continue
    }

    $inSize = $v.Length
    $outSize = (Get-Item $outPath).Length
    $total += $inSize
    $totalOut += $outSize
    $pct = if ($inSize -gt 0) { [int](100 * $outSize / $inSize) } else { 0 }
    Write-Host ("    {0,8} -> {1,8}  ({2}% of source)" -f ([string]::Format("{0:n0}b",$inSize)), ([string]::Format("{0:n0}b",$outSize)), $pct)
}

Write-Host ""
Write-Host ("TOTAL: {0:n0} bytes  ->  {1:n0} bytes  ({2}% of source)" -f $total, $totalOut, [int](100 * $totalOut / [Math]::Max(1,$total))) -ForegroundColor Green
Write-Host "Output: $OutDir"
