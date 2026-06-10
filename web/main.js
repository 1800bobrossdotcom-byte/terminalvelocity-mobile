/* main.js
 * Wires up:
 *   - background video (rotates through bundled clips on natural ended events)
 *   - HUD source picker (MIC / FILE)
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
  // Some videos won't decode on some devices; advance every 12s as a safety net.
  setInterval(() => {
    if (bg.readyState < 2) loadNext();
  }, 12000);
  bg.src = VIDEO_FILES[vi];
  bg.play().catch(() => {});

  // ───────────── HUD ─────────────
  const btnMic   = document.getElementById("src-mic");
  const btnFile  = document.getElementById("src-file");
  const fileIn   = document.getElementById("file-input");
  const lbl      = document.getElementById("src-label");
  const meter    = document.getElementById("meter");
  const mctx     = meter.getContext("2d");

  function setPressed(el, on) {
    if (el) el.setAttribute("aria-pressed", on ? "true" : "false");
  }
  function refreshLabel() {
    lbl.textContent = window.TV_AUDIO.active
      ? window.TV_AUDIO.label
      : "— tap MIC or FILE to start —";
  }
  refreshLabel();

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

  // ───────────── meter ─────────────
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
      // red -> amber -> green -> cyan, low to high
      const hue =  10 + (i / bins) * 180;
      mctx.fillStyle = `hsl(${hue}, 90%, ${30 + v * 30}%)`;
      mctx.fillRect(i * bw, h - bh, bw - 1, bh);
    }
    requestAnimationFrame(drawMeter);
  }
  requestAnimationFrame(drawMeter);

  // ───────────── permission preflight ─────────────
  // Capacitor on Android: getUserMedia triggers the RECORD_AUDIO prompt
  // automatically when first invoked. We just don't pre-prompt so the
  // first time the user taps MIC, the system dialog is the cue.

  // Safety: keep wakelock-ish behaviour by hinting noSleep via fullscreen
  // request on first interaction. (No external lib; best effort only.)
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
