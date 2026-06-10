/* main.js
 * Wires up:
 *   - background video (rotates through bundled clips on natural ended events)
 *   - HUD source picker (MIC / FILE)
 *   - VJ params: mode/palette cycling, sliders, AUTO, beat indicator, BPM
 *   - small audio level meter
 */
(function () {
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
  bg.addEventListener("ended", loadNext);
  bg.addEventListener("error", () => setTimeout(loadNext, 250));
  setInterval(() => {
    if (bg.readyState < 2) loadNext();
  }, 12000);
  bg.src = VIDEO_FILES[vi];
  bg.play().catch(() => {});

  // ───────────── HUD elements ─────────────
  const btnMic   = document.getElementById("src-mic");
  const btnFile  = document.getElementById("src-file");
  const fileIn   = document.getElementById("file-input");
  const lbl      = document.getElementById("src-label");
  const meter    = document.getElementById("meter");
  const mctx     = meter.getContext("2d");
  const hud      = document.getElementById("hud");
  const hudTog   = document.getElementById("hud-toggle");

  const modeName = document.getElementById("mode-name");
  const modePrev = document.getElementById("mode-prev");
  const modeNext = document.getElementById("mode-next");
  const palName  = document.getElementById("pal-name");
  const palPrev  = document.getElementById("pal-prev");
  const palNext  = document.getElementById("pal-next");
  const autoBtn  = document.getElementById("auto-toggle");
  const beatDot  = document.getElementById("beat-dot");
  const bpmLbl   = document.getElementById("bpm-label");

  const sliders = {
    density: document.getElementById("p-density"),
    decay:   document.getElementById("p-decay"),
    beat:    document.getElementById("p-beat"),
    glow:    document.getElementById("p-glow"),
    scan:    document.getElementById("p-scan"),
  };

  function setPressed(el, on) {
    if (el) el.setAttribute("aria-pressed", on ? "true" : "false");
  }
  function refreshLabel() {
    lbl.textContent = window.TV_AUDIO.active
      ? window.TV_AUDIO.label
      : "— tap MIC or FILE to start —";
  }
  function refreshVjBadges() {
    if (!window.TV_VIZ) return;
    modeName.textContent = "MODE: " + window.TV_VIZ.params.mode;
    palName.textContent  = "PAL: "  + window.TV_VIZ.params.palette;
    setPressed(autoBtn, window.TV_VIZ.params.auto);
  }
  refreshLabel();
  refreshVjBadges();

  // ───────────── audio source buttons ─────────────
  btnMic.addEventListener("click", async () => {
    try {
      await window.TV_AUDIO.useMic();
      setPressed(btnMic, true);
      setPressed(btnFile, false);
      refreshLabel();
    } catch (e) {
      lbl.textContent = "mic blocked: " + (e && e.message ? e.message : e);
    }
  });
  btnFile.addEventListener("click", () => fileIn.click());
  fileIn.addEventListener("change", async () => {
    const f = fileIn.files && fileIn.files[0];
    if (!f) return;
    try {
      await window.TV_AUDIO.useFile(f);
      setPressed(btnMic, false);
      setPressed(btnFile, true);
      refreshLabel();
    } catch (e) {
      lbl.textContent = "file failed: " + (e && e.message ? e.message : e);
    }
  });

  // ───────────── VJ controls ─────────────
  modePrev.addEventListener("click", () => { window.TV_VIZ.cycleMode(-1); refreshVjBadges(); });
  modeNext.addEventListener("click", () => { window.TV_VIZ.cycleMode(+1); refreshVjBadges(); });
  palPrev .addEventListener("click", () => { window.TV_VIZ.cyclePalette(-1); refreshVjBadges(); });
  palNext .addEventListener("click", () => { window.TV_VIZ.cyclePalette(+1); refreshVjBadges(); });
  autoBtn .addEventListener("click", () => { window.TV_VIZ.toggleAuto(); refreshVjBadges(); });

  function bindSlider(input, key, scale) {
    input.addEventListener("input", () => {
      window.TV_VIZ.params[key] = (+input.value) / 100 * scale;
    });
  }
  bindSlider(sliders.density, "density",   1);
  bindSlider(sliders.decay,   "decay",     1);
  bindSlider(sliders.beat,    "beatSens",  2);
  bindSlider(sliders.glow,    "glow",      1);
  bindSlider(sliders.scan,    "scanlines", 1);

  // Tap mode-name to long-press cycle palettes via double-tap; nice to have.
  modeName.addEventListener("dblclick", () => { window.TV_VIZ.cyclePalette(+1); refreshVjBadges(); });

  // Collapse HUD
  hudTog.addEventListener("click", () => {
    const collapsed = hud.getAttribute("data-collapsed") === "true";
    hud.setAttribute("data-collapsed", collapsed ? "false" : "true");
    hudTog.textContent = collapsed ? "≡" : "▴";
  });

  // ───────────── meter + beat indicator ─────────────
  function drawMeter() {
    const w = meter.width, h = meter.height;
    mctx.clearRect(0, 0, w, h);
    const fft = window.TV_AUDIO.fft;
    if (!fft) { requestAnimationFrame(drawMeter); return; }
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
    requestAnimationFrame(drawMeter);
  }
  requestAnimationFrame(drawMeter);

  let lastBeatFlash = 0;
  function pollBeat() {
    const a = window.TV_AUDIO && window.TV_AUDIO.tick ? window.TV_AUDIO.tick() : null;
    const now = performance.now();
    if (a && a.onset) lastBeatFlash = now;
    const lit = (now - lastBeatFlash) < 120;
    if (beatDot) beatDot.classList.toggle("on", lit);
    if (a && a.bpm && bpmLbl) bpmLbl.textContent = "BPM " + a.bpm;
    else if (bpmLbl) bpmLbl.textContent = "BPM —";
    requestAnimationFrame(pollBeat);
  }
  requestAnimationFrame(pollBeat);

  // ───────────── wake / fullscreen ─────────────
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
