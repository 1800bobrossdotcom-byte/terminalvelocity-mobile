/* lib/viz.js
 * TERMINAL VELOCITY — VJ visualizer.
 *
 * Multi-mode generative renderer driven by window.TV_AUDIO. Exposes
 * window.TV_VIZ for HUD control.
 *
 *   TV_VIZ.modes              -> ["SHARDS","PULSE","FIELD","TUNNEL","MOSAIC","STROBE"]
 *   TV_VIZ.palettes           -> ["PHOSPHOR","RGB","AMBER","NEON","ICE","INFRA"]
 *   TV_VIZ.params             -> { mode, palette, density, decay, beatSens,
 *                                  auto, autoMs, glow, scanlines }
 *   TV_VIZ.setMode(name)
 *   TV_VIZ.cycleMode(+1|-1)
 *   TV_VIZ.cyclePalette(+1|-1)
 *   TV_VIZ.toggleAuto()
 *
 * Hard rule — NO per-row horizontal-band displacement, ever. Region
 * (rectangular / radial / polar) painting only.
 */
(function () {
  const cvs = document.getElementById("viz");
  const ctx = cvs.getContext("2d", { alpha: true });
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  function resize() {
    cvs.width  = Math.floor(window.innerWidth  * dpr);
    cvs.height = Math.floor(window.innerHeight * dpr);
    cachedVignette = null;
  }
  resize();
  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("orientationchange", resize, { passive: true });

  // ───────────── palettes ─────────────
  // Each palette: [low, mid, high, accent] RGB triplets.
  const PALETTES = {
    PHOSPHOR: [[ 30,255, 90],[ 80,255,170],[180,255,220],[255,255,255]],
    RGB:      [[255, 50, 60],[ 60,220,110],[ 80,160,255],[255,255,255]],
    AMBER:    [[255,160, 40],[255,200, 80],[255,240,180],[255,255,255]],
    NEON:     [[255, 50,180],[180, 70,255],[ 90,200,255],[255,255,255]],
    ICE:      [[100,180,255],[150,220,255],[220,240,255],[255,255,255]],
    INFRA:    [[255, 20, 60],[255,100, 40],[255,200, 60],[255,255,255]],
  };
  const PALETTE_NAMES = Object.keys(PALETTES);
  function rgba(c, a) {
    return `rgba(${c[0]|0},${c[1]|0},${c[2]|0},${(+a).toFixed(3)})`;
  }
  function lerpColor(a, b, t) {
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    ];
  }

  // ───────────── public params ─────────────
  // Defaults tuned for projection / out-of-box VJ use — bright,
  // beat-sensitive, AUTO cycling on, scanlines tame so the BG video
  // stays readable.
  const params = {
    mode:       "PULSE",
    palette:    "PHOSPHOR",
    density:    0.75,
    decay:      0.45,
    beatSens:   1.4,
    glow:       0.75,
    scanlines:  0.25,
    auto:       true,
    autoMs:     14000,
  };
  const MODE_NAMES = ["SHARDS", "PULSE", "FIELD", "TUNNEL", "MOSAIC", "STROBE"];

  // ───────────── deterministic pRNG ─────────────
  let seed = 1;
  function srand(s) { seed = (s >>> 0) || 1; }
  function rnd() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  }

  // ───────────── per-frame helpers ─────────────
  function fade(a) {
    const fadeAlpha = Math.max(0.02, (0.04 + 0.5 * params.decay) + 0.3 * a.rms);
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = `rgba(0,0,0,${fadeAlpha.toFixed(3)})`;
    ctx.fillRect(0, 0, cvs.width, cvs.height);
    ctx.globalCompositeOperation = "source-over";
  }

  let cachedVignette = null;
  function vignette() {
    const w = cvs.width, h = cvs.height;
    if (!cachedVignette) {
      const g = ctx.createRadialGradient(
        w/2, h/2, Math.min(w,h) * 0.35,
        w/2, h/2, Math.max(w,h) * 0.85,
      );
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,0.40)");
      cachedVignette = g;
    }
    ctx.fillStyle = cachedVignette;
    ctx.fillRect(0, 0, w, h);
  }

  function scanlines(a) {
    if (params.scanlines < 0.01) return;
    const w = cvs.width, h = cvs.height;
    ctx.globalAlpha = (0.04 + 0.05 * a.rms) * params.scanlines;
    ctx.fillStyle = "#000";
    for (let y = 0; y < h; y += 3 * dpr) {
      ctx.fillRect(0, y, w, dpr);
    }
    ctx.globalAlpha = 1;
  }

  // ───────────── idle envelope ─────────────
  // No audio source picked, or source is dead silent? Synthesize a moving
  // envelope so the stage stays alive. A 110 BPM phantom-kick fires onset
  // every ~545 ms; sine-modulated bands keep continuous motion. The moment
  // TV_AUDIO is active AND returning non-zero levels, the real signal
  // takes over inside readEnvelope().
  const SYNTH_BPM = 110;
  const SYNTH_PERIOD = 60000 / SYNTH_BPM;
  let lastSynthBeat = 0;
  function synthEnvelope(now) {
    const t = now * 0.001;
    const beat = (now - lastSynthBeat) >= SYNTH_PERIOD;
    if (beat) lastSynthBeat = now;
    const sb = 0.45 + 0.45 * Math.max(0, Math.sin(t * 0.7));
    const b  = 0.35 + 0.45 * Math.max(0, Math.sin(t * 1.4));
    const m  = 0.30 + 0.40 * (0.5 + 0.5 * Math.sin(t * 2.1 + 1.2));
    const tr = 0.25 + 0.40 * (0.5 + 0.5 * Math.sin(t * 3.3 + 2.4));
    const air= 0.20 + 0.35 * (0.5 + 0.5 * Math.sin(t * 4.7 + 0.5));
    return {
      subBass: sb, bass: b, lowMid: m * 0.8, mid: m, highMid: (m + tr) * 0.5,
      treble: tr, air,
      dSub:  beat ? 0.30 : 0, dBass: beat ? 0.35 : 0,
      dMid:  beat ? 0.18 : 0, dTreb: beat ? 0.10 : 0, dAir: 0,
      rms:   0.30 + 0.20 * Math.sin(t * 0.5),
      peak:  beat ? 0.9 : 0.4,
      centroid: 0.35 + 0.25 * Math.sin(t * 0.9),
      onset: beat, onsetEnergy: beat ? 1.6 : 0,
      bpm: SYNTH_BPM,
      beatPhase: ((now - lastSynthBeat) / SYNTH_PERIOD) % 1,
      _synth: true,
    };
  }

  // Synthetic FFT so MOSAIC + PULSE petals stay alive without input.
  const SYNTH_FFT = new Uint8Array(512);
  function synthFft(now) {
    const t = now * 0.001;
    for (let i = 0; i < SYNTH_FFT.length; i++) {
      const f = i / SYNTH_FFT.length;
      const env = (1 - f) * 0.6 + 0.4;
      const wob = 0.5 + 0.5 * Math.sin(t * (1 + f * 4) + i * 0.07);
      const beat = Math.max(0, 1 - ((now - lastSynthBeat) / 220)) * (1 - f) * 0.5;
      SYNTH_FFT[i] = Math.min(255, ((env * wob * 0.55 + beat) * 255) | 0);
    }
    return SYNTH_FFT;
  }

  // Reads the real envelope if a live source is present, otherwise the
  // synthetic one. The returned `fft` always exists so modes don't have
  // to guard. `synth` is true when we made it up.
  let liveFftRef = null;
  function readEnvelope(now) {
    const live = window.TV_AUDIO && window.TV_AUDIO.active
      ? window.TV_AUDIO.tick()
      : null;
    if (live && (live.rms > 0.005 || live.bass > 0.005 || live.mid > 0.005)) {
      liveFftRef = window.TV_AUDIO.fft;
      return { env: live, fft: liveFftRef, synth: false };
    }
    return { env: synthEnvelope(now), fft: synthFft(now), synth: true };
  }

  // ───────────── MODE: SHARDS ─────────────
  function drawShards(a, pal, now) {
    const w = cvs.width, h = cvs.height;
    const min = Math.min(w, h);
    const cell = Math.max(28, Math.floor(min / 18));
    const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);

    if (a.bass > 0.04) {
      srand((now * 0.13) | 0);
      const count = 2 + ((a.bass * 8 * params.density) | 0);
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = rgba(pal[0], 0.08 + 0.45 * a.bass);
      for (let i = 0; i < count; i++) {
        const cx = rnd() * w, cy = rnd() * h;
        const rw = w * (0.25 + 0.5 * rnd());
        const rh = h * (0.15 + 0.35 * rnd());
        ctx.fillRect(cx - rw/2, cy - rh/2, rw, rh);
      }
      ctx.globalCompositeOperation = "source-over";
    }

    if (a.mid > 0.03) {
      srand(((now * 0.31) | 0) ^ 0xa5a5);
      const shards = 8 + ((a.mid * 40 * params.density) | 0);
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = rgba(pal[1], 0.10 + 0.30 * a.mid);
      for (let i = 0; i < shards; i++) {
        const cx = ((rnd() * cols) | 0) * cell;
        const cy = ((rnd() * rows) | 0) * cell;
        const ww = cell * (1 + ((rnd() * 4) | 0));
        const hh = cell * (1 + ((rnd() * 2) | 0));
        ctx.fillRect(cx, cy, ww, hh);
      }
      ctx.globalCompositeOperation = "source-over";
    }

    if (a.treble > 0.02) {
      srand(((now * 0.97) | 0) ^ 0x5a5a);
      const pts = 16 + ((a.treble * 140 * params.density) | 0);
      ctx.fillStyle = rgba(pal[2], 0.7 * (0.25 + a.treble));
      for (let i = 0; i < pts; i++) {
        const x = rnd() * w, y = rnd() * h;
        const r = 1 + rnd() * 3 * dpr;
        ctx.fillRect(x, y, r, r);
      }
    }
  }

  // ───────────── MODE: PULSE (radial rings on beat) ─────────────
  const pulseRings = [];
  function drawPulse(a, pal, now, fft) {
    const w = cvs.width, h = cvs.height;
    const cx = w / 2, cy = h / 2;

    if (a.onset || a.dBass > 0.06) {
      pulseRings.push({
        born: now,
        color: a.dBass > 0.06 ? pal[0] : pal[1],
        seedAngle: (now * 0.001) % (Math.PI * 2),
        thickness: 6 + 18 * (a.onsetEnergy || a.dBass + 0.4) * params.beatSens,
      });
      if (pulseRings.length > 28) pulseRings.shift();
    }

    ctx.globalCompositeOperation = "lighter";
    for (let i = pulseRings.length - 1; i >= 0; i--) {
      const ring = pulseRings[i];
      const age = (now - ring.born) / 1000;
      if (age > 2.5) { pulseRings.splice(i, 1); continue; }
      const r = age * Math.max(w, h) * 0.6;
      const alpha = Math.max(0, 0.70 * (1 - age / 2.5));
      ctx.lineWidth = ring.thickness * (1 - age / 2.5);
      ctx.strokeStyle = rgba(ring.color, alpha);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";

    // Spectrum petals around the center (FFT-driven polar bars).
    if (fft && fft.length) {
      const bins = 72;
      const step = Math.max(1, Math.floor(Math.min(360, fft.length) / bins));
      const baseR = Math.min(w, h) * 0.10;
      const maxR = Math.min(w, h) * 0.40 * (0.6 + 0.6 * params.density);
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < bins; i++) {
        let v = 0;
        for (let j = 0; j < step; j++) v += fft[i * step + j] || 0;
        v = v / (step * 255);
        if (v < 0.015) continue;
        const ang = (i / bins) * Math.PI * 2 + a.beatPhase * Math.PI * 0.25;
        const r0 = baseR, r1 = baseR + maxR * v;
        const c = lerpColor(pal[0], pal[2], i / bins);
        ctx.strokeStyle = rgba(c, 0.45 + 0.5 * v);
        ctx.lineWidth = 3 * dpr;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
        ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
    }
  }

  // ───────────── MODE: FIELD (flow-field particles) ─────────────
  const particles = [];
  function ensureParticles(n) {
    while (particles.length < n) {
      particles.push({
        x: Math.random() * cvs.width,
        y: Math.random() * cvs.height,
        vx: 0, vy: 0,
        life: Math.random() * 4,
      });
    }
    if (particles.length > n) particles.length = n;
  }
  function drawField(a, pal, now) {
    const w = cvs.width, h = cvs.height;
    const targetN = 200 + ((600 * params.density) | 0);
    ensureParticles(targetN);

    const t = now * 0.0008;
    const speedBase = 0.6 + 4.0 * a.rms;
    const speedKick = 6.0 * (a.dBass + a.onsetEnergy * 0.3) * params.beatSens;

    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      // sin/cos flow field with audio-warped frequency
      const nx = Math.sin(p.x * 0.005 + t + a.mid * 4);
      const ny = Math.cos(p.y * 0.005 - t + a.treble * 3);
      const ang = Math.atan2(ny, nx);
      const speed = speedBase + speedKick;
      p.vx = p.vx * 0.85 + Math.cos(ang) * speed * dpr;
      p.vy = p.vy * 0.85 + Math.sin(ang) * speed * dpr;
      p.x += p.vx; p.y += p.vy;
      p.life -= 0.012;
      if (p.x < 0 || p.x > w || p.y < 0 || p.y > h || p.life <= 0) {
        p.x = Math.random() * w; p.y = Math.random() * h;
        p.vx = p.vy = 0; p.life = 1 + Math.random() * 3;
      }
      const cIdx = i % 3;
      const c = pal[cIdx];
      ctx.fillStyle = rgba(c, 0.25 + 0.5 * Math.min(1, a.rms + a.dMid));
      const sz = 1 + 1.5 * dpr;
      ctx.fillRect(p.x, p.y, sz, sz);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  // ───────────── MODE: TUNNEL (zooming concentric polys) ─────────────
  const tunnelSlices = [];
  function drawTunnel(a, pal, now) {
    const w = cvs.width, h = cvs.height;
    const cx = w / 2, cy = h / 2;
    const maxR = Math.hypot(w, h) * 0.6;

    // Spawn a new slice on each beat or on strong sub-bass.
    if (a.onset || a.dSub > 0.05) {
      tunnelSlices.push({
        born: now,
        sides: 5 + ((Math.random() * 4) | 0),
        spin: (Math.random() - 0.5) * 0.4,
        color: a.dSub > 0.10 ? pal[0] : pal[1],
      });
      if (tunnelSlices.length > 30) tunnelSlices.shift();
    }
    if (tunnelSlices.length === 0) {
      tunnelSlices.push({ born: now, sides: 6, spin: 0.1, color: pal[1] });
    }

    ctx.globalCompositeOperation = "lighter";
    for (let i = tunnelSlices.length - 1; i >= 0; i--) {
      const s = tunnelSlices[i];
      const age = (now - s.born) / 1000;
      const lifespan = 3.0;
      if (age > lifespan) { tunnelSlices.splice(i, 1); continue; }
      const r = Math.pow(age / lifespan, 1.5) * maxR * (0.8 + 0.5 * params.density);
      const a01 = Math.max(0, 0.6 * (1 - age / lifespan));
      const rot = now * 0.0006 + s.spin * age;
      ctx.strokeStyle = rgba(s.color, a01);
      ctx.lineWidth = (2 + 4 * (1 - age / lifespan)) * dpr;
      ctx.beginPath();
      for (let k = 0; k <= s.sides; k++) {
        const ang = rot + (k / s.sides) * Math.PI * 2;
        const px = cx + Math.cos(ang) * r;
        const py = cy + Math.sin(ang) * r;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";

    // Center vanishing-point dot pulses with mid.
    const dotR = (3 + 30 * a.mid) * dpr;
    ctx.fillStyle = rgba(pal[3], 0.6 + 0.3 * a.peak);
    ctx.beginPath();
    ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
    ctx.fill();
  }

  // ───────────── MODE: MOSAIC (FFT-driven cell grid) ─────────────
  function drawMosaic(a, pal, now, fft) {
    const w = cvs.width, h = cvs.height;
    if (!fft) return;
    const cols = Math.max(8, Math.floor(12 + 24 * params.density));
    const rows = Math.max(8, Math.floor(cols * (h / w)));
    const cellW = w / cols, cellH = h / rows;
    const bins = Math.min(fft.length, cols * rows);
    ctx.globalCompositeOperation = "lighter";
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // Pick a stable-ish bin per cell using a hash, so the mosaic
        // doesn't visually scramble every frame.
        const idx = ((c * 31 + r * 17) % bins);
        const v = (fft[idx] || 0) / 255;
        if (v < 0.05) continue;
        const ci = Math.min(2, Math.floor(v * 3));
        const col = pal[ci];
        ctx.fillStyle = rgba(col, 0.08 + 0.5 * v);
        const pad = cellW * 0.08;
        const sz = Math.min(cellW, cellH) * (0.2 + 0.8 * v);
        const x = c * cellW + cellW / 2 - sz / 2;
        const y = r * cellH + cellH / 2 - sz / 2;
        ctx.fillRect(x, y, sz, sz);
      }
    }
    ctx.globalCompositeOperation = "source-over";

    if (a.onset) {
      ctx.fillStyle = rgba(pal[3], 0.18 * params.beatSens);
      ctx.fillRect(0, 0, w, h);
    }
  }

  // ───────────── MODE: STROBE (onset-locked block flashes) ─────────────
  function drawStrobe(a, pal, now) {
    const w = cvs.width, h = cvs.height;
    if (a.onset) {
      const blocks = 6 + ((a.onsetEnergy * 8 * params.density) | 0);
      srand((now * 1.7) | 0);
      ctx.globalCompositeOperation = "screen";
      for (let i = 0; i < blocks; i++) {
        const c = pal[(rnd() * 3) | 0];
        const x = rnd() * w, y = rnd() * h;
        const ww = w * (0.1 + 0.4 * rnd());
        const hh = h * (0.05 + 0.25 * rnd());
        ctx.fillStyle = rgba(c, 0.30 + 0.45 * a.onsetEnergy * params.beatSens);
        ctx.fillRect(x - ww/2, y - hh/2, ww, hh);
      }
      ctx.globalCompositeOperation = "source-over";
    }
    // Always pulse a thin centre band on bass (NOT a per-row scan — single rect).
    if (a.bass > 0.05) {
      const bh = h * 0.06 * a.bass;
      ctx.fillStyle = rgba(pal[0], 0.30 * a.bass);
      ctx.fillRect(0, h/2 - bh/2, w, bh);
    }
  }

  // ───────────── auto-cycle ─────────────
  let lastModeSwitch = performance.now();
  function maybeAutoSwitch(now) {
    if (!params.auto) return;
    if (now - lastModeSwitch < params.autoMs) return;
    cycleMode(+1);
    lastModeSwitch = now;
  }

  // ───────────── main render ─────────────
  let t0 = performance.now();
  function frame() {
    const now = performance.now();
    t0 = now;

    const snap = readEnvelope(now);
    const a = snap.env;
    const fft = snap.fft;

    const pal = PALETTES[params.palette] || PALETTES.PHOSPHOR;

    maybeAutoSwitch(now);

    fade(a);

    switch (params.mode) {
      case "SHARDS": drawShards(a, pal, now); break;
      case "PULSE":  drawPulse (a, pal, now, fft); break;
      case "FIELD":  drawField (a, pal, now); break;
      case "TUNNEL": drawTunnel(a, pal, now); break;
      case "MOSAIC": drawMosaic(a, pal, now, fft); break;
      case "STROBE": drawStrobe(a, pal, now); break;
      default:       drawPulse (a, pal, now, fft); break;
    }

    // Onset-triggered chromatic flash (cheap fullscreen tint).
    if (a.onset && params.glow > 0) {
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = rgba(pal[3], 0.06 * params.glow * Math.min(1, a.onsetEnergy));
      ctx.fillRect(0, 0, cvs.width, cvs.height);
      ctx.globalCompositeOperation = "source-over";
    }

    scanlines(a);
    vignette();

    rafId = requestAnimationFrame(frame);
  }

  let rafId = requestAnimationFrame(frame);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelAnimationFrame(rafId);
    else { t0 = performance.now(); rafId = requestAnimationFrame(frame); }
  });

  // ───────────── public api ─────────────
  function setMode(name) {
    if (MODE_NAMES.indexOf(name) >= 0) {
      params.mode = name;
      lastModeSwitch = performance.now();
    }
  }
  function cycleMode(dir) {
    const i = MODE_NAMES.indexOf(params.mode);
    const n = MODE_NAMES.length;
    const j = ((i + (dir || 1)) % n + n) % n;
    setMode(MODE_NAMES[j]);
  }
  function setPalette(name) {
    if (PALETTES[name]) params.palette = name;
  }
  function cyclePalette(dir) {
    const i = PALETTE_NAMES.indexOf(params.palette);
    const n = PALETTE_NAMES.length;
    const j = ((i + (dir || 1)) % n + n) % n;
    setPalette(PALETTE_NAMES[j]);
  }
  function toggleAuto() {
    params.auto = !params.auto;
    lastModeSwitch = performance.now();
    return params.auto;
  }

  window.TV_VIZ = {
    modes: MODE_NAMES.slice(),
    palettes: PALETTE_NAMES.slice(),
    params,
    setMode, cycleMode,
    setPalette, cyclePalette,
    toggleAuto,
    resize,
  };
})();
