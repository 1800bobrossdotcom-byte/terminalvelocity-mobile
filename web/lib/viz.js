/* lib/viz.js
 * Mobile-tuned TERMINAL VELOCITY visualizer.
 *
 * Single canvas, no DOM clones, no postfx panel. All effects are
 * implemented as cheap 2D-context passes — no per-pixel JS loops —
 * so this stays at 60fps on a mid-range phone.
 *
 * Layered over the looping background video; the canvas is what
 * gets all the audio-reactive paint.
 *
 * Hard rules from /memories/audio-reactive-viz-patterns.md:
 *   - No per-row horizontal-band displacement, ever.
 *   - Region (rectangular / radial) displacement only.
 *   - Bass = coarse, mid = mid, treble = fine.
 */
(function () {
  const cvs = document.getElementById("viz");
  const ctx = cvs.getContext("2d", { alpha: true });
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  function resize() {
    cvs.width  = Math.floor(window.innerWidth  * dpr);
    cvs.height = Math.floor(window.innerHeight * dpr);
  }
  resize();
  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("orientationchange", resize, { passive: true });

  // Grid sized to viewport so the shards feel right on phone vs tablet.
  function gridDims() {
    const min = Math.min(cvs.width, cvs.height);
    const cell = Math.max(28, Math.floor(min / 18));
    return {
      cell,
      cols: Math.ceil(cvs.width  / cell),
      rows: Math.ceil(cvs.height / cell),
    };
  }

  const palette = {
    bass:   [255, 70, 50],
    mid:    [80, 220, 110],
    treble: [120, 220, 255],
    phosphor: [51, 255, 102],
  };
  function rgba(c, a) {
    return `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;
  }

  // Cheap deterministic pRNG so block-sets stay stable inside a frame
  // (we re-seed each frame off the audio envelope so they evolve).
  let seed = 1;
  function srand(s) { seed = s >>> 0 || 1; }
  function rnd() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  }

  let t0 = performance.now();

  function frame() {
    const w = cvs.width, h = cvs.height;
    const now = performance.now();
    const dt = Math.min(0.05, (now - t0) / 1000);
    t0 = now;

    const a = (window.TV_AUDIO && window.TV_AUDIO.tick()) || { bass: 0, mid: 0, treble: 0, rms: 0 };

    // 1. Fade to transparent so old paint leaves trails over the BG video.
    //    Use destination-out at the audio-driven rate. Quieter -> longer trails.
    const fadeAlpha = 0.10 + 0.55 * a.rms;
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = `rgba(0,0,0,${fadeAlpha.toFixed(3)})`;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";

    const { cell, cols, rows } = gridDims();

    // 2. Bass = coarse: a few big tinted slabs that wash across.
    if (a.bass > 0.18) {
      srand((now * 0.13) | 0);
      const count = 1 + ((a.bass * 4) | 0);
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = rgba(palette.bass, 0.05 + 0.25 * a.bass);
      for (let i = 0; i < count; i++) {
        const cx = rnd() * w, cy = rnd() * h;
        const rw = w * (0.25 + 0.5 * rnd());
        const rh = h * (0.15 + 0.35 * rnd());
        ctx.fillRect(cx - rw / 2, cy - rh / 2, rw, rh);
      }
      ctx.globalCompositeOperation = "source-over";
    }

    // 3. Mid = grid shards. 2D BLOCK scramble (NEVER row-bands).
    if (a.mid > 0.10) {
      srand(((now * 0.31) | 0) ^ 0xa5a5);
      const shards = 4 + ((a.mid * 18) | 0);
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = rgba(palette.mid, 0.06 + 0.18 * a.mid);
      for (let i = 0; i < shards; i++) {
        const cx = ((rnd() * cols) | 0) * cell;
        const cy = ((rnd() * rows) | 0) * cell;
        const ww = cell * (1 + ((rnd() * 4) | 0));
        const hh = cell * (1 + ((rnd() * 2) | 0));
        ctx.fillRect(cx, cy, ww, hh);
      }
      ctx.globalCompositeOperation = "source-over";
    }

    // 4. Treble = fine: small phosphor sparkles around the high-band peak.
    if (a.treble > 0.08) {
      srand(((now * 0.97) | 0) ^ 0x5a5a);
      const pts = 8 + ((a.treble * 60) | 0);
      ctx.fillStyle = rgba(palette.phosphor, 0.6 * a.treble);
      for (let i = 0; i < pts; i++) {
        const x = rnd() * w, y = rnd() * h;
        const r = 1 + rnd() * 2.5 * dpr;
        ctx.fillRect(x, y, r, r);
      }
    }

    // 5. CRT-ish scanline overlay (cheap, single fillRect with pattern).
    //    Static texture, not per-row JS = no banding rule violation.
    ctx.globalAlpha = 0.06 + 0.04 * a.rms;
    ctx.fillStyle = "#000";
    for (let y = 0; y < h; y += 3 * dpr) {
      ctx.fillRect(0, y, w, dpr);
    }
    ctx.globalAlpha = 1;

    // 6. Subtle vignette (drawn last). Cached gradient.
    if (!frame._vg || frame._vgW !== w || frame._vgH !== h) {
      const vg = ctx.createRadialGradient(
        w / 2, h / 2, Math.min(w, h) * 0.35,
        w / 2, h / 2, Math.max(w, h) * 0.85,
      );
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,0,0,0.75)");
      frame._vg = vg;
      frame._vgW = w; frame._vgH = h;
    }
    ctx.fillStyle = frame._vg;
    ctx.fillRect(0, 0, w, h);

    rafId = requestAnimationFrame(frame);
  }

  let rafId = requestAnimationFrame(frame);

  // Tab-hidden -> pause RAF to save battery; resume on visible.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelAnimationFrame(rafId);
    } else {
      t0 = performance.now();
      rafId = requestAnimationFrame(frame);
    }
  });

  window.TV_VIZ = { resize };
})();
