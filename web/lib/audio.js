/* lib/audio.js
 * Mobile audio source bridge. Exposes window.TV_AUDIO:
 *
 *   await TV_AUDIO.useMic()        // RECORD_AUDIO prompt on Android
 *   await TV_AUDIO.useFile(file)   // user-picked audio file
 *   TV_AUDIO.stop()
 *
 *   TV_AUDIO.fft               -> Uint8Array, length frequencyBinCount
 *   TV_AUDIO.tick()            -> { bass, mid, treble, rms } 0..1
 *
 * Reactive levels follow the patterns in
 *   /memories/audio-reactive-viz-patterns.md
 * (named bands, fast deltas, no threshold creep on sustained levels).
 */
(function () {
  const FFT_SIZE = 1024; // 512 bins
  const BAND_BASS    = [   1,   8 ];  // ~21–172 Hz @ 44.1k
  const BAND_MID     = [   9,  60 ];  // ~190 Hz–1.3 kHz
  const BAND_TREBLE  = [  60, 250 ];  // ~1.3 kHz–5.4 kHz

  let ctx = null;
  let analyser = null;
  let srcNode = null;
  let gainNode = null;
  let mediaEl = null;
  let stream = null;
  let fileObjUrl = null;
  let sourceLabel = "—";

  function ensureCtx() {
    if (!ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") ctx.resume();
    if (!analyser) {
      analyser = ctx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -10;
      analyser.smoothingTimeConstant = 0.55;
    }
    if (!gainNode) {
      gainNode = ctx.createGain();
      gainNode.gain.value = 1.2; // tiny boost; mic on phones is quiet
      gainNode.connect(analyser);
    }
    return ctx;
  }

  function disconnectSource() {
    try { if (srcNode) srcNode.disconnect(); } catch (_) {}
    srcNode = null;
    if (mediaEl) {
      try { mediaEl.pause(); } catch (_) {}
      mediaEl = null;
    }
    if (stream) {
      try { stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
      stream = null;
    }
    if (fileObjUrl) {
      try { URL.revokeObjectURL(fileObjUrl); } catch (_) {}
      fileObjUrl = null;
    }
  }

  async function useMic() {
    ensureCtx();
    disconnectSource();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    srcNode = ctx.createMediaStreamSource(stream);
    srcNode.connect(gainNode);
    sourceLabel = "MIC";
  }

  async function useFile(file) {
    ensureCtx();
    disconnectSource();
    fileObjUrl = URL.createObjectURL(file);
    mediaEl = new Audio();
    mediaEl.src = fileObjUrl;
    mediaEl.loop = true;
    mediaEl.crossOrigin = "anonymous";
    await mediaEl.play().catch(() => {});
    srcNode = ctx.createMediaElementSource(mediaEl);
    srcNode.connect(gainNode);
    // Also send to output so the user hears the file.
    srcNode.connect(ctx.destination);
    sourceLabel = "FILE " + (file.name || "");
  }

  function stop() {
    disconnectSource();
    sourceLabel = "—";
  }

  const fft = new Uint8Array(FFT_SIZE / 2);
  // simple per-band envelope follower so visuals don't strobe per-frame
  const env = { bass: 0, mid: 0, treble: 0, rms: 0 };
  const att = 0.55, rel = 0.10;

  function bandAvg(buf, [lo, hi]) {
    let s = 0;
    const n = Math.max(1, hi - lo);
    for (let i = lo; i < hi; i++) s += buf[i] || 0;
    return s / (n * 255);
  }

  function tick() {
    if (!analyser) return env;
    analyser.getByteFrequencyData(fft);
    const b = bandAvg(fft, BAND_BASS);
    const m = bandAvg(fft, BAND_MID);
    const t = bandAvg(fft, BAND_TREBLE);

    // Rolling RMS for overall amplitude
    let r = 0;
    for (let i = 0; i < fft.length; i++) {
      const v = (fft[i] || 0) / 255;
      r += v * v;
    }
    r = Math.sqrt(r / fft.length);

    env.bass   += (b > env.bass   ? att : rel) * (b - env.bass);
    env.mid    += (m > env.mid    ? att : rel) * (m - env.mid);
    env.treble += (t > env.treble ? att : rel) * (t - env.treble);
    env.rms    += (r > env.rms    ? att : rel) * (r - env.rms);
    return env;
  }

  window.TV_AUDIO = {
    useMic, useFile, stop, tick,
    get fft() { return fft; },
    get label() { return sourceLabel; },
    get active() { return !!srcNode; },
  };
})();
