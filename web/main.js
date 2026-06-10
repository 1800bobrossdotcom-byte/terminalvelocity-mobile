/* main.js
 * Wires up:
 *   - background video rotation
 *   - HUD source picker (MIC / FILE)
 *   - VJ controls (modes/palette/AUTO/sliders)
 *   - audio level meter + beat dot + BPM
 *
 * Uses plain `click` events on real <button>/<input> elements — the same
 * shape that worked in v0.2.0 for the MIC button. A diagnostic
 * "BUILD 0.2.2  TAPS: N" badge is rendered into the HUD so the user can
 * confirm at a glance which APK is actually loaded and whether any tap
 * is reaching JS at all.
 */
const BUILD_ID = "0.2.4";

(function () {
  // ───────────── global error surfacing ─────────────
  // Errors go to a wrapping line in the HUD so the FULL message is
  // readable on a phone screen (the old #src-label truncated it).
  function showError(prefix, err) {
    const node = document.getElementById("err-line");
    const msg = prefix + ": " + (err && err.message ? err.message : String(err));
    if (node) { node.textContent = "ERR " + msg; node.classList.add("on"); }
    try { console.error(prefix, err); } catch (_) {}
  }
  window.addEventListener("error", (e) => showError("uncaught", e.error || e.message));
  window.addEventListener("unhandledrejection", (e) => showError("promise", e.reason));

  // ───────────── background video rotation ─────────────
  const VIDEO_FILES = [
    "assets/videos/ter001.mp4","assets/videos/ter002.mp4","assets/videos/ter003.mp4",
    "assets/videos/ter004.mp4","assets/videos/ter005.mp4","assets/videos/ter006.mp4",
    "assets/videos/ter017.mp4","assets/videos/ter018.mp4","assets/videos/ter027.mp4",
    "assets/videos/ter028.mp4","assets/videos/ter029.mp4","assets/videos/ter030.mp4",
    "assets/videos/ter035.mp4","assets/videos/ter038.mp4","assets/videos/ter043.mp4",
    "assets/videos/ter044.mp4","assets/videos/ter045.mp4",
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
  const buildLbl = $("build-label");

  const sliders = {
    density: $("p-density"),
    decay:   $("p-decay"),
    beat:    $("p-beat"),
    glow:    $("p-glow"),
    scan:    $("p-scan"),
  };

  // ───────────── tap counter (proves taps reach JS) ─────────────
  let tapCount = 0;
  function bump(label) {
    tapCount++;
    if (buildLbl) buildLbl.textContent = "BUILD " + BUILD_ID + "  TAPS:" + tapCount + " " + (label || "");
  }
  if (buildLbl) buildLbl.textContent = "BUILD " + BUILD_ID + "  TAPS:0";

  function setPressed(el, on) {
    if (el) el.setAttribute("aria-pressed", on ? "true" : "false");
  }
  function refreshLabel() {
    if (!lbl) return;
    lbl.textContent = window.TV_AUDIO && window.TV_AUDIO.active
      ? window.TV_AUDIO.label
      : "tap MIC or FILE to start";
  }
  function refreshVjBadges() {
    if (!window.TV_VIZ) return;
    if (modeName) modeName.textContent = "MODE: " + window.TV_VIZ.params.mode;
    if (palName)  palName.textContent  = "PAL: "  + window.TV_VIZ.params.palette;
    setPressed(autoBtn, window.TV_VIZ.params.auto);
  }
  refreshLabel();
  refreshVjBadges();

  // ───────────── click bindings (plain, no preventDefault) ─────────────
  function onClick(name, el, fn) {
    if (!el) { showError("missing #" + name, new Error("element not found")); return; }
    el.addEventListener("click", function (ev) {
      bump(name);
      try { fn(ev); } catch (err) { showError(name, err); }
    });
  }

  onClick("MIC", btnMic, async () => {
    if (!window.TV_AUDIO) throw new Error("audio module missing (TV_AUDIO)");
    await window.TV_AUDIO.useMic();
    setPressed(btnMic, true);
    setPressed(btnFile, false);
    refreshLabel();
  });
  onClick("FILE", btnFile, () => { if (fileIn) fileIn.click(); });
  if (fileIn) {
    fileIn.addEventListener("change", async () => {
      bump("file:change");
      const f = fileIn.files && fileIn.files[0];
      if (!f) return;
      try {
        if (!window.TV_AUDIO) throw new Error("audio module missing (TV_AUDIO)");
        await window.TV_AUDIO.useFile(f);
        setPressed(btnMic, false);
        setPressed(btnFile, true);
        refreshLabel();
      } catch (e) { showError("FILE", e); }
    });
  }

  function vizCall(name, fn) {
    if (!window.TV_VIZ) { showError(name, new Error("viz module missing (TV_VIZ)")); return; }
    fn(window.TV_VIZ);
    refreshVjBadges();
  }
  onClick("MODE-", modePrev, () => vizCall("MODE-", (v) => v.cycleMode(-1)));
  onClick("MODE+", modeNext, () => vizCall("MODE+", (v) => v.cycleMode(+1)));
  onClick("PAL-",  palPrev,  () => vizCall("PAL-",  (v) => v.cyclePalette(-1)));
  onClick("PAL+",  palNext,  () => vizCall("PAL+",  (v) => v.cyclePalette(+1)));
  onClick("AUTO",  autoBtn,  () => vizCall("AUTO",  (v) => v.toggleAuto()));

  function bindSlider(name, input, key, scale) {
    if (!input) { showError("slider " + name, new Error("element not found")); return; }
    const apply = () => {
      try {
        if (!window.TV_VIZ || !window.TV_VIZ.params) return; // not ready yet — fine
        window.TV_VIZ.params[key] = (+input.value) / 100 * scale;
      } catch (err) { showError("slider " + name, err); }
    };
    input.addEventListener("input",  apply);
    input.addEventListener("change", apply);
    apply();
  }
  bindSlider("density", sliders.density, "density",   1);
  bindSlider("decay",   sliders.decay,   "decay",     1);
  bindSlider("beat",    sliders.beat,    "beatSens",  2);
  bindSlider("glow",    sliders.glow,    "glow",      1);
  bindSlider("scan",    sliders.scan,    "scanlines", 1);

  onClick("HUD", hudTog, () => {
    if (!hud) return;
    const collapsed = hud.getAttribute("data-collapsed") === "true";
    hud.setAttribute("data-collapsed", collapsed ? "false" : "true");
    if (hudTog) hudTog.textContent = collapsed ? "≡" : "▴";
  });

  // ───────────── meter + beat indicator ─────────────
  function drawMeter() {
    if (mctx && meter) {
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
  document.addEventListener("click", function tryWake() {
    if (wokeOnce) return;
    wokeOnce = true;
    if ("wakeLock" in navigator) {
      try { navigator.wakeLock.request("screen"); } catch (_) {}
    }
  }, { once: true });
})();
