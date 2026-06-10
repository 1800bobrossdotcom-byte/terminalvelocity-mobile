# TERMINAL VELOCITY · mobile

Capacitor wrapper that runs a phone-tuned variant of the
TERMINAL VELOCITY visualizer (the same look as
[lovebeing.world/collections/terminalvelocity](https://lovebeing.world/collections/terminalvelocity))
as a native Android (and iOS, when you have a Mac) app.

- **No wallet**: pure visualizer.
- **Bundled video assets**: bitrate-starved through ffmpeg so
  the artifacts themselves are part of the aesthetic. Total
  asset size target: < 5 MB for all looping clips.
- **Audio sources**: phone microphone + user-picked audio files.
- **Single canvas**: no DOM clones, no per-pixel JS — stays at
  60 fps on a mid-range phone.

```
.
├── web/                  source for the WebView UI (HTML / JS / CSS)
│   ├── index.html
│   ├── style.css
│   ├── main.js           bg-video rotation, HUD wiring, meter
│   ├── lib/
│   │   ├── audio.js      MIC + FILE audio source bridge, bands & RMS
│   │   └── viz.js        canvas painter (cheap 2D-context FX)
│   └── assets/videos/    populated by scripts/compress-assets.ps1
├── scripts/
│   ├── build-web.mjs     copies web/ -> www/
│   └── compress-assets.ps1   ffmpeg pipeline (clean | corrupted)
├── capacitor.config.ts
└── package.json
```

`www/` (generated) is what Capacitor copies into the native
projects. Don't edit it by hand.

---

## 1. One-time setup

```powershell
Set-Location C:\Users\giann\terminalvelocity-mobile

# 1. Install deps
npm install

# 2. Generate the compressed video assets (requires ffmpeg on PATH).
#    Pulls from C:\Users\giann\lovebeing\public\collections\terminalvelocity\footage\ter
#    Modes: -Mode corrupted (default)  |  -Mode clean
npm run compress:videos

# 3. Build web/ -> www/
npm run build

# 4. Add the native platforms
npx cap add android
npx cap add ios     # only useful if you have a Mac
```

> If you don't have ffmpeg: `winget install Gyan.FFmpeg` and reopen the
> terminal.

---

## 2. Run on Android

```powershell
# Connect a phone with USB debugging, or have an emulator running.
npm run android        # opens Android Studio at android/
# or, headless:
npm run android:run
```

The first time a user taps `MIC`, Android will prompt for
RECORD_AUDIO. `FILE` opens the system audio picker.

---

## 3. Run on iOS (Mac required)

```bash
# On the Mac, after `git pull`:
npm install
npm run build
npx cap sync ios
npx cap open ios
# Set DEVELOPMENT_TEAM in Xcode, then run on device or simulator.
```

---

## 4. Iterate on visuals

Edit `web/*` then either:

```powershell
npm run sync           # rebuild www/ and sync to native
```

…or, for faster iteration in the browser:

```powershell
# serve web/ directly; any static server works
npx http-server web -p 8080
# then open http://localhost:8080 in Chrome/Edge
```

Browser will block mic auto-play of the bg videos until you
interact with the page — that's a desktop browser quirk, not
the app.

---

## 5. The ffmpeg "corruption" approach

`scripts/compress-assets.ps1 -Mode corrupted` runs:

```
ffmpeg -i in.mp4 -an \
  -vf "scale=360:-2,fps=15" \
  -c:v libx264 -preset slow -pix_fmt yuv420p \
  -b:v 50k -maxrate 60k -bufsize 120k \
  -g 9999 -bf 0 -refs 1 -sc_threshold 0 \
  out.mp4
```

Why this looks the way it does:

| flag             | effect on bitstream                                                  |
|------------------|----------------------------------------------------------------------|
| `-b:v 50k`       | starves the encoder; chroma blocks visibly                           |
| `-g 9999`        | one keyframe per file; all later frames are P-frame deltas           |
| `-bf 0`          | no B-frames; smearing is one-directional, more ghosty                |
| `-refs 1`        | each P-frame references only the previous one; errors cascade        |
| `-sc_threshold 0`| disable scene-cut detection; encoder won't sneak in extra keyframes  |
| `-vf scale=360`  | tiny resolution; the canvas upscale adds soft chunky pixels for free |

Tune `-b:v` between `30k` (very corrupted) and `200k` (visibly
glitchy but recognisable) for the look you want.

The clean mode (`-Mode clean`) is a sane ~150 kbps small file
in case you want recognisable backgrounds for a particular
build.

---

## 6. Release signing (Android)

Same pattern as `bastion-mobile`: keep the keystore OUTSIDE
the repo, read paths/password from env at build time.

```powershell
# Create once, then back up to your password manager.
keytool -genkeypair -v `
  -keystore C:\Users\giann\terminalvelocity-release.keystore `
  -alias tv-release `
  -keyalg RSA -keysize 2048 -validity 9125 -storetype PKCS12
```

(Wire-up in `android/app/build.gradle.kts` is identical to
bastion-mobile's pattern — copy that signing block when you're
ready to ship a release AAB.)
