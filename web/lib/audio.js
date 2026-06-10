/* lib/audio.js
 * Mobile audio source bridge + analysis. Exposes window.TV_AUDIO.
 *
 *   await TV_AUDIO.useMic()        // RECORD_AUDIO prompt on Android
 *   await TV_AUDIO.useFile(file)   // user-picked audio file
 *   TV_AUDIO.stop()
 *
 *   TV_AUDIO.fft               -> Uint8Array, length frequencyBinCount
 *   TV_AUDIO.tick()            -> snapshot:
 *     {
 *       subBass, bass, lowMid, mid, highMid, treble, air,   // 0..1 smoothed
 *       dSub, dBass, dMid, dTreb, dAir,                     // delta this frame
 *       rms, peak, centroid,                                // 0..1
 *       onset, onsetEnergy,                                 // bool, 0..~3
 *       bpm, beatPhase                                      // bpm or 0, 0..1
 *     }
 *
 * Mic constraints are tuned HARD against voice processing: AGC, NS, EC
 * and the legacy goog* flags are all disabled so an untreated stereo
 * line/mic feed reaches the analyser. MainActivity.java additionally
 * pins the system to MODE_NORMAL so Spotify on the same phone keeps
 * its full-band speaker profile instead of getting downsampled to 8 kHz.
 */
(function () {
  const FFT_SIZE = 2048; // 1024 bins
  // Band edges, in FFT bin indexes at 48 kHz / 2048 -> ~23.4 Hz/bin.
  const B_SUB    = [   1,   4 ];  // ~23–94 Hz   sub
  const B_BASS   = [   4,  12 ];  // ~94–281 Hz  kick body
  const B_LOWMID = [  12,  32 ];  // ~281–750 Hz
  const B_MID    = [  32,  80 ];  // ~750 Hz–1.9 kHz   snare body
  const B_HIMID  = [  80, 160 ];  // ~1.9–3.7 kHz
  const B_TREB   = [ 160, 320 ];  // ~3.7–7.5 kHz hats
  const B_AIR    = [ 320, 600 ];  // ~7.5–14 kHz  cymbal shimmer

  let ctx = null;
  let analyser = null;
  let srcNode = null;
  let gainNode = null;
  let hpNode = null;
  let mediaEl = null;
  let stream = null;
  let fileObjUrl = null;
  let sourceLabel = "—";

  function ensureCtx() {
    if (!ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      ctx = new Ctor({ latencyHint: "playback" });
    }
    if (ctx.state === "suspended") ctx.resume();
    if (!analyser) {
      analyser = ctx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.minDecibels = -85;
      analyser.maxDecibels = -12;
      analyser.smoothingTimeConstant = 0.4;
    }
    if (!gainNode) {
      gainNode = ctx.createGain();
      gainNode.gain.value = 1.0;
      // Very gentle high-pass to remove mic rumble / LF DC without
      // robbing the kick.
      hpNode = ctx.createBiquadFilter();
      hpNode.type = "highpass";
      hpNode.frequency.value = 20;
      hpNode.Q.value = 0.707;
      gainNode.connect(hpNode);
      hpNode.connect(analyser);
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

  // Strongest constraints we can request on Android Chrome WebView to
  // get an untreated music-quality stream (no AGC, no NS, no EC, no
  // mono downmix, no voice-mode resampling). Try the modern shape
  // first, fall back to the legacy mandatory/optional form.
  async function getRawMic() {
    const modern = {
      audio: {
        echoCancellation: { ideal: false },
        noiseSuppression: { ideal: false },
        autoGainControl:  { ideal: false },
        channelCount:     { ideal: 2 },
        sampleRate:       { ideal: 48000 },
        sampleSize:       { ideal: 16 },
        latency:          { ideal: 0 },
      },
      video: false,
    };
    try {
      return await navigator.mediaDevices.getUserMedia(modern);
    } catch (_) {}

    // Legacy goog* flags. Some Android WebView builds only honour these.
    const legacy = {
      audio: {
        mandatory: {
          googEchoCancellation: false,
          googEchoCancellation2: false,
          googAutoGainControl: false,
          googAutoGainControl2: false,
          googNoiseSuppression: false,
          googNoiseSuppression2: false,
          googHighpassFilter: false,
          googTypingNoiseDetection: false,
          googAudioMirroring: false,
        },
        optional: [
          { echoCancellation: false },
          { noiseSuppression: false },
          { autoGainControl: false },
          { channelCount: 2 },
          { sampleRate: 48000 },
        ],
      },
      video: false,
    };
    return await navigator.mediaDevices.getUserMedia(legacy);
  }

  async function useMic() {
    ensureCtx();
    disconnectSource();
    stream = await getRawMic();
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
    srcNode.connect(ctx.destination);
    sourceLabel = "FILE " + (file.name || "");
  }

  function stop() {
    disconnectSource();
    sourceLabel = "—";
  }

  const fft = new Uint8Array(FFT_SIZE / 2);
  const fftPrev = new Uint8Array(FFT_SIZE / 2);

  // Per-band smoothed envelopes + previous-frame values for delta.
  const env  = {
    subBass: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, treble: 0, air: 0,
    dSub: 0, dBass: 0, dMid: 0, dTreb: 0, dAir: 0,
    rms: 0, peak: 0, centroid: 0,
    onset: false, onsetEnergy: 0,
    bpm: 0, beatPhase: 0,
  };
  const prev = { subBass: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, treble: 0, air: 0 };
  const att = 0.6, rel = 0.08;

  // Onset detection state
  const fluxHist = new Float32Array(43);    // ~700ms history @60fps
  let fluxIdx = 0;
  let lastOnsetTime = 0;
  const ONSET_REFRACTORY_MS = 90;
  const ioiHist = [];                       // inter-onset intervals (ms)
  const IOI_MAX = 24;
  let lastFrameTime = performance.now();
  let beatPhaseAccum = 0;

  // Caching: TV_AUDIO.tick() may be called from multiple consumers per frame
  // (visualizer + HUD beat indicator). We coalesce to a single FFT read /
  // onset evaluation per ~12 ms so subsequent callers see the same snapshot
  // instead of corrupting the spectral-flux state.
  let lastTickAt = 0;
  const TICK_MIN_MS = 12;

  function bandAvg(buf, [lo, hi]) {
    let s = 0;
    const n = Math.max(1, hi - lo);
    for (let i = lo; i < hi; i++) s += buf[i] || 0;
    return s / (n * 255);
  }

  function follow(name, raw) {
    const prevV = env[name];
    const cf = raw > prevV ? att : rel;
    env[name] = prevV + cf * (raw - prevV);
  }

  function tick() {
    if (!analyser) return env;

    const tNow = performance.now();
    if (tNow - lastTickAt < TICK_MIN_MS) return env;
    lastTickAt = tNow;

    // Save previous spectrum for spectral flux before we overwrite.
    fftPrev.set(fft);
    analyser.getByteFrequencyData(fft);

    const now = tNow;
    const dt = Math.max(1, now - lastFrameTime);
    lastFrameTime = now;

    // Per-band raw levels.
    const sb = bandAvg(fft, B_SUB);
    const b  = bandAvg(fft, B_BASS);
    const lm = bandAvg(fft, B_LOWMID);
    const m  = bandAvg(fft, B_MID);
    const hm = bandAvg(fft, B_HIMID);
    const t  = bandAvg(fft, B_TREB);
    const a  = bandAvg(fft, B_AIR);

    env.dSub  = Math.max(0, sb - prev.subBass);
    env.dBass = Math.max(0, b  - prev.bass);
    env.dMid  = Math.max(0, m  - prev.mid);
    env.dTreb = Math.max(0, t  - prev.treble);
    env.dAir  = Math.max(0, a  - prev.air);
    prev.subBass = sb; prev.bass = b; prev.lowMid = lm; prev.mid = m;
    prev.highMid = hm; prev.treble = t; prev.air = a;

    follow("subBass", sb);
    follow("bass",    b);
    follow("lowMid",  lm);
    follow("mid",     m);
    follow("highMid", hm);
    follow("treble",  t);
    follow("air",     a);

    // RMS + peak + spectral centroid.
    let rsum = 0, peak = 0, num = 0, den = 0;
    for (let i = 0; i < fft.length; i++) {
      const v = (fft[i] || 0) / 255;
      rsum += v * v;
      if (v > peak) peak = v;
      num += i * v;
      den += v;
    }
    const r = Math.sqrt(rsum / fft.length);
    env.rms     += (r > env.rms ? att : rel) * (r - env.rms);
    env.peak     = peak;
    env.centroid = den > 1e-6 ? (num / den) / fft.length : 0;

    // Spectral flux (positive energy increase, biased to low+mid).
    let flux = 0;
    const fluxLo = 1, fluxHi = Math.min(200, fft.length);
    for (let i = fluxLo; i < fluxHi; i++) {
      const d = (fft[i] - fftPrev[i]) / 255;
      if (d > 0) flux += d;
    }
    flux /= (fluxHi - fluxLo);

    fluxHist[fluxIdx] = flux;
    fluxIdx = (fluxIdx + 1) % fluxHist.length;

    // Adaptive threshold from recent flux history.
    let mu = 0, mx = 0;
    for (let i = 0; i < fluxHist.length; i++) {
      mu += fluxHist[i];
      if (fluxHist[i] > mx) mx = fluxHist[i];
    }
    mu /= fluxHist.length;
    const thr = mu * 1.6 + 0.005;

    env.onset = false;
    env.onsetEnergy *= 0.85;
    if (flux > thr && flux > mx * 0.65 && (now - lastOnsetTime) > ONSET_REFRACTORY_MS) {
      env.onset = true;
      env.onsetEnergy = Math.min(3, flux / Math.max(0.01, mu));
      const ioi = now - lastOnsetTime;
      lastOnsetTime = now;
      if (ioi > 250 && ioi < 1500) {
        ioiHist.push(ioi);
        while (ioiHist.length > IOI_MAX) ioiHist.shift();
        if (ioiHist.length >= 4) {
          const sorted = ioiHist.slice().sort((x, y) => x - y);
          const med = sorted[(sorted.length / 2) | 0];
          const bpm = Math.round(60000 / med);
          // Fold to 70..170 BPM range.
          let folded = bpm;
          while (folded > 170) folded /= 2;
          while (folded < 70) folded *= 2;
          env.bpm = Math.round(folded);
        }
      }
    }

    // Beat phase: monotonic 0..1 cycling every estimated beat.
    if (env.bpm > 0) {
      const period = 60000 / env.bpm;
      beatPhaseAccum += dt / period;
      if (env.onset) beatPhaseAccum = 0;       // re-sync on onset
      env.beatPhase = beatPhaseAccum % 1;
    } else {
      env.beatPhase = 0;
    }

    return env;
  }

  window.TV_AUDIO = {
    useMic, useFile, stop, tick,
    get fft()    { return fft; },
    get label()  { return sourceLabel; },
    get active() { return !!srcNode; },
  };
})();

