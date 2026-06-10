/* main.js
 * Wires up:
 *   - background video (rotates through bundled clips on natural ended events)
 *   - HUD source picker (MIC / FILE)
 *   - VJ params: mode/palette cycling, sliders, AUTO, beat indicator, BPM
 *   - small audio level meter
 *
 * Every listener block is wrapped in safeBind() so a single broken element
 * never prevents the rest of the UI from coming up, and any thrown error
 * is surfaced in the source label so the user can see it on-device.
 */
(function () {
  // ───────────── global error surfacing ─────────────
  // Anything thrown anywhere in the page lights up the label so it's
  // visible without USB debugging. Cheap, no-cost when nothing fails.
  function showError(prefix, err) {
    const node = document.getElementById("src-label");
    if (node) node.textContent = "ERR " + prefix + ": " +
      (err && err.message ? err.message : String(err));
    try { console.error(prefix, err); } catch (_) {}
  }
  window.addEventListener("error", (e) => showError("uncaught", e.error || e.message));
  window.addEventListener("unhandledrejection", (e) => showError("promise", e.reason));

  function safeBind(name, el, ev, fn, opts) {
    if (!el) { showError("missing #" + name, new Error("element not found")); return; }
    try {
      el.addEventListener(ev, function (event) {
        try { fn(event); }
        catch (err) { showError(name, err); }
      }, opts);
    } catch (err) {
      showError("bind " + name, err);
    }
  }

  // ───────────── background video rotation ─────────────
  const VIDEO_FILES = [
    "assets/videos/ter001.mp4",
    "assets/videos/ter002.mp4",
    "assets/videos/ter003.mp4",
    "assets/videos/ter004.mp4",
    "assets/videos/ter005.mp4",
    "assets/videos/ter006.mp4",
    "assets/videos/ter017.mp4",
    "assets/videos/ter018.mp4",
    "assets/videos/ter027.mp4",
    "assets/videos/ter028.mp4",
    "assets/videos/ter029.mp4",
    "assets/videos/ter030.mp4",
    "assets/videos/ter035.mp4",
    "assets/videos/ter038.mp4",
    "assets/videos/ter043.mp4",
    "assets/videos/ter044.mp4",
    "assets/videos/ter045.mp4",
  ];

  const bg = document.getElementById("bg-video");
  let vi = Math.floor(Math.random() * VIDEO_FILES.length);
  function loadNext() {
    vi = (vi + 1) % VIDEO_FILES.length;
    bg.src = VIDEO_FILES[vi];
    bg.play().catch(() => {});
  }
  if (bg) {
    bg.addEventListener("ended", loadNext);
    bg.addEventListener("error", () => setTimeout(loadNext, 250));
    setInterval(() => { if (bg.readyState < 2) loadNext(); }, 12000);
    bg.src = VIDEO_FILES[vi];
    bg.play().catch(() => {});
  }

  // ───────────── HUD elements ─────────────
  const $ = (id) => document.getElementById(id);
  const btnMic   = $("src-mic");
  const btnFile  = $("src-file");
  const fileIn   = $("file-input");
  const lbl      = $("src-label");
  const meter    = $("meter");
  const mctx     = meter ? meter.getContext("2d") : null;
  const hud      = $("hud");
  const hudTog   = $("hud-toggle");

  const modeName = $("mode-name");
  const modePrev = $("mode-prev");
  const modeNext = $("mode-next");
  const palName  = $("pal-name");
  const palPrev  = $("pal-prev");
  const palNext  = $("pal-next");
  const autoBtn  = $("auto-toggle");
  const beatDot  = $("beat-dot");
  const bpmLbl   = $("bpm-label");

  const sliders = {
    density: $("p-density"),
    decay:   $("p-decay"),
    beat:    $("p-beat"),
    glow:    $("p-glow"),
    scan:    $("p-scan"),
  };

  function setPressed(el, on) {
    if (el) el.setAttribute("aria-pressed", on ? "true" : "false");
  }
  function refreshLabel() {
    if (!lbl) return;
    lbl.textContent = window.TV_AUDIO && window.TV_AUDIO.active
      ? window.TV_AUDIO.label
      : "— tap MIC or FILE to start —";
  }
  function refreshVjBadges() {
    if (!window.TV_VIZ) return;
    if (modeName) modeName.textContent = "MODE: " + window.TV_VIZ.params.mode;
    if (palName)  palName.textContent  = "PAL: "  + window.TV_VIZ.params.palette;
    setPressed(autoBtn, window.TV_VIZ.params.auto);
  }
  try { refreshLabel(); refreshVjBadges(); } catch (e) { showError("init", e); }

  // ───────────── tap handler ─────────────
  // Use pointerup with pointerType filtering so taps fire instantly on
  // touch without waiting for the 300ms click-delay. Falls back to
  // synthetic click if pointer events aren't supported.
  function onTap(name, el, fn) {
    if (!el) { showError("missing #" + name, new Error("element not found")); return; }
    let pressed = false;
    safeBind(name + ":down", el, "pointerdown", () => { pressed = true; });
    safeBind(name + ":up",   el, "pointerup",   (ev) => {
      if (!pressed) return;
      pressed = false;
      ev.preventDefault();
      fn(ev);
    });
    safeBind(name + ":leave", el, "pointerleave", () => { pressed = false; });
    safeBind(name + ":cancel", el, "pointercancel", () => { pressed = false; });
    // click fallback (covers cases where pointer events are not delivered)
    safeBind(name + ":click", el, "click", (ev) => { ev.preventDefault(); fn(ev); });
  }

  // ───────────── audio source buttons ─────────────
  onTap("mic", btnMic, async () => {
    try {
      await window.TV_AUDIO.useMic();
      setPressed(btnMic, true);
      setPressed(btnFile, false);
      refreshLabel();
    } catch (e) {
      showError("mic", e);
    }
  });
  onTap("file", btnFile, () => fileIn && fileIn.click());
  safeBind("file:change", fileIn, "change", async () => {
    const f = fileIn.files && fileIn.files[0];
    if (!f) return;
    try {
      await window.TV_AUDIO.useFile(f);
      setPressed(btnMic, false);
      setPressed(btnFile, true);
      refreshLabel();
    } catch (e) {
      showError("file", e);
    }
  });

  // ───────────── VJ controls ─────────────
  onTap("modePrev", modePrev, () => { window.TV_VIZ.cycleMode(-1); refreshVjBadges(); });
  onTap("modeNext", modeNext, () => { window.TV_VIZ.cycleMode(+1); refreshVjBadges(); });
  onTap("palPrev",  palPrev,  () => { window.TV_VIZ.cyclePalette(-1); refreshVjBadges(); });
  onTap("palNext",  palNext,  () => { window.TV_VIZ.cyclePalette(+1); refreshVjBadges(); });
  onTap("auto",     autoBtn,  () => { window.TV_VIZ.toggleAuto(); refreshVjBadges(); });

  function bindSlider(name, input, key, scale) {
    if (!input) { showError("missing slider " + name, new Error("not found")); return; }
    const apply = () => { window.TV_VIZ.params[key] = (+input.value) / 100 * scale; };
    safeBind("slider:" + name + ":input",  input, "input",  apply);
    safeBind("slider:" + name + ":change", input, "change", apply);
    safeBind("slider:" + name + ":touch",  input, "touchmove", apply, { passive: true });
    apply();
  }
  bindSlider("density", sliders.density, "density",   1);
  bindSlider("decay",   sliders.decay,   "decay",     1);
  bindSlider("beat",    sliders.beat,    "beatSens",  2);
  bindSlider("glow",    sliders.glow,    "glow",      1);
  bindSlider("scan",    sliders.scan,    "scanlines", 1);

  // Collapse HUD
  onTap("hudToggle", hudTog, () => {
    if (!hud) return;
    const collapsed = hud.getAttribute("data-collapsed") === "true";
    hud.setAttribute("data-collapsed", collapsed ? "false" : "true");
    if (hudTog) hudTog.textContent = collapsed ? "≡" : "▴";
  });

  // Tap on the canvas to advance mode (gestures for stage use without HUD).
  // Top-half tap = next mode, bottom-half tap = next palette.
  const vizCanvas = $("viz");
  if (vizCanvas) {
    // Re-enable pointer events on viz so taps work, but only fire on tap
    // (not on slow drags). pointer-events still off via CSS — we re-enable here.
    vizCanvas.style.pointerEvents = "auto";
    let downAt = 0, downX = 0, downY = 0;
    safeBind("viz:down", vizCanvas, "pointerdown", (ev) => {
      downAt = performance.now(); downX = ev.clientX; downY = ev.clientY;
    });
    safeBind("viz:up", vizCanvas, "pointerup", (ev) => {
      const dt = performance.now() - downAt;
      const dx = Math.abs(ev.clientX - downX), dy = Math.abs(ev.clientY - downY);
      if (dt > 300 || dx > 12 || dy > 12) return; // ignore drags/long press
      if (!window.TV_VIZ) return;
      if (ev.clientY < window.innerHeight * 0.5) {
        window.TV_VIZ.cycleMode(+1);
      } else {
        window.TV_VIZ.cyclePalette(+1);
      }
      refreshVjBadges();
    });
  }

  // ───────────── meter + beat indicator ─────────────
  function drawMeter() {
    if (!meter || !mctx) return;
    const w = meter.width, h = meter.height;
    mctx.clearRect(0, 0, w, h);
    const fft = window.TV_AUDIO && window.TV_AUDIO.fft;
    if (fft && fft.length) {
      const bins = 48;
      const step = Math.floor(fft.length / bins);
      const bw = w / bins;
      for (let i = 0; i < bins; i++) {
        let s = 0;
        for (let j = 0; j < step; j++) s += fft[i * step + j] || 0;
        const v = s / (step * 255);
        const bh = Math.max(1, v * h);
        const hue = 10 + (i / bins) * 180;
        mctx.fillStyle = `hsl(${hue}, 90%, ${30 + v * 30}%)`;
        mctx.fillRect(i * bw, h - bh, bw - 1, bh);
      }
    }
    requestAnimationFrame(drawMeter);
  }
  requestAnimationFrame(drawMeter);

  let lastBeatFlash = 0;
  function pollBeat() {
    try {
      const a = window.TV_AUDIO && window.TV_AUDIO.tick ? window.TV_AUDIO.tick() : null;
      const now = performance.now();
      if (a && a.onset) lastBeatFlash = now;
      const lit = (now - lastBeatFlash) < 120;
      if (beatDot) beatDot.classList.toggle("on", lit);
      if (bpmLbl)  bpmLbl.textContent = a && a.bpm ? ("BPM " + a.bpm) : "BPM —";
    } catch (_) {}
    requestAnimationFrame(pollBeat);
  }
  requestAnimationFrame(pollBeat);

  // ───────────── wake ─────────────
  let wokeOnce = false;
  function tryWake() {
    if (wokeOnce) return;
    wokeOnce = true;
    if ("wakeLock" in navigator) {
      try { navigator.wakeLock.request("screen"); } catch (_) {}
    }
  }
  document.addEventListener("pointerdown", tryWake, { once: true });
})();
