// Sound: every effect is synthesized with WebAudio, no audio files and no
// network. Each weapon has its own report — a sharp crack for the carbine, a
// deep boom for the shotgun, a long rolling crack for the sniper — and every
// sound is placed in the world: distant shots arrive quieter and duller, the
// way sound carries across a desert yard at dusk. The wind never stops.
export function createAudio() {
  let ctx = null;
  let master = null;
  let windSrc = null;
  let windGain = null;
  let windFilter = null;

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext ?? window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    // Ambient wind: looped brown noise through a lowpass, very quiet, with a
    // slow swell so it breathes instead of sitting flat.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i += 1) {
      last = (last + (Math.random() * 2 - 1) * 0.02) * 0.98;
      data[i] = last * 3;
    }
    windSrc = ctx.createBufferSource();
    windSrc.buffer = buf; windSrc.loop = true;
    windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass'; windFilter.frequency.value = 320;
    windGain = ctx.createGain(); windGain.gain.value = 0.05;
    windSrc.connect(windFilter); windFilter.connect(windGain); windGain.connect(master);
    windSrc.start();
    return ctx;
  }

  // Shared noise buffer, built once and reused: a fresh buffer per shot would
  // churn the garbage collector in the middle of a firefight.
  let noiseBuf = null;
  function sharedNoise() {
    if (noiseBuf) return noiseBuf;
    const len = Math.floor(ctx.sampleRate * 1);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i += 1) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  function noiseBurst(dur, filterFreq, gain, type = 'lowpass', when = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = sharedNoise();
    src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  function tone(freq, dur, gain, type = 'sine', slideTo = null, when = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur);
  }

  // Distance model: loud close, dull far. Past ~30 m only the low thump is
  // left, the way a shot across the map really sounds.
  function attenuate(dist) {
    const d = Math.max(0, dist);
    return { gain: Math.max(0.06, 0.55 - d * 0.011), freq: Math.max(500, 2400 - d * 55) };
  }

  // Per-weapon reports: crack + body, tuned so each gun is recognisable by
  // ear alone. `dist` 0 = the player's own gun.
  const SHOT_PROFILES = {
    pistol: { crack: [0.10, 1900, 0.62], body: [170, 0.08, 0.20, 70] },
    rifle: { crack: [0.13, 1500, 0.68], body: [150, 0.11, 0.26, 55] },
    smg: { crack: [0.08, 2100, 0.48], body: [230, 0.06, 0.15, 90] },
    sniper: { crack: [0.30, 950, 0.9], body: [120, 0.22, 0.32, 45] },
    shotgun: { crack: [0.22, 750, 0.85], body: [100, 0.16, 0.34, 42] },
  };

  return {
    unlock() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); },
    shot(kind, dist = 0) {
      const p = SHOT_PROFILES[kind] ?? SHOT_PROFILES.rifle;
      if (dist > 0) {
        const a = attenuate(dist);
        noiseBurst(0.14, a.freq, a.gain);
        tone(p.body[0], 0.12, a.gain * 0.4, 'sawtooth', p.body[3]);
      } else {
        noiseBurst(p.crack[0], p.crack[1], p.crack[2]);
        tone(p.body[0], p.body[1], p.body[2], 'sawtooth', p.body[3]);
        // A short echo tail off the perimeter walls.
        noiseBurst(0.22, 700, 0.12, 'lowpass', 0.06);
      }
    },
    enemyShot(dist) {
      const a = attenuate(dist);
      noiseBurst(0.12, a.freq, a.gain);
      tone(150, 0.1, a.gain * 0.35, 'sawtooth', 60);
    },
    dryFire() { tone(1400, 0.03, 0.12, 'square'); noiseBurst(0.03, 3000, 0.06, 'highpass'); },
    reload(kind) {
      // Three beats, timed to the gun: magazine out, magazine in, bolt rack.
      // Heavy guns take longer between beats.
      const slow = kind === 'sniper' || kind === 'shotgun' ? 1.5 : 1;
      tone(850, 0.04, 0.16, 'square', null, 0);
      noiseBurst(0.04, 2400, 0.12, 'bandpass', 0.02);
      tone(650, 0.04, 0.16, 'square', null, 0.3 * slow);
      noiseBurst(0.04, 2000, 0.12, 'bandpass', 0.32 * slow);
      tone(1150, 0.05, 0.2, 'square', null, 0.62 * slow);
      noiseBurst(0.06, 3200, 0.16, 'bandpass', 0.64 * slow);
    },
    reloadDone() { tone(1250, 0.04, 0.14, 'square'); },
    weaponDraw() { noiseBurst(0.07, 1800, 0.1, 'bandpass'); tone(500, 0.04, 0.08, 'square'); },
    hit() { tone(1250, 0.05, 0.2, 'sine'); },
    headshot() { tone(1568, 0.05, 0.22, 'sine'); tone(2093, 0.06, 0.18, 'sine', null, 0.05); },
    kill() { tone(880, 0.09, 0.22, 'sine'); tone(1318, 0.12, 0.22, 'sine', null, 0.09); },
    hurt() { tone(180, 0.16, 0.3, 'sawtooth', 90); noiseBurst(0.1, 500, 0.15); },
    step(run = false) { noiseBurst(run ? 0.06 : 0.05, 480, run ? 0.1 : 0.07); },
    land() { noiseBurst(0.09, 350, 0.16); tone(90, 0.08, 0.14, 'sine', 55); },
    beep(urgent = false) { tone(urgent ? 1760 : 1568, 0.07, 0.25, 'square'); },
    plant() { tone(660, 0.1, 0.2, 'sine'); tone(880, 0.14, 0.2, 'sine', null, 0.12); },
    defuseTick() { tone(1175, 0.05, 0.18, 'square'); },
    pinPull() { tone(1900, 0.03, 0.1, 'square'); noiseBurst(0.03, 4000, 0.08, 'highpass'); },
    grenadeBounce() { noiseBurst(0.04, 900, 0.14); tone(320, 0.05, 0.1, 'square', 180); },
    explosion() {
      noiseBurst(0.9, 300, 1.0);
      tone(70, 0.7, 0.5, 'sine', 35);
      noiseBurst(0.4, 1200, 0.3, 'bandpass', 0.02);
      // Debris patter after the blast.
      noiseBurst(0.12, 2500, 0.12, 'bandpass', 0.35);
      noiseBurst(0.1, 2200, 0.09, 'bandpass', 0.55);
    },
    roundWin() {
      tone(523, 0.12, 0.2, 'sine'); tone(659, 0.12, 0.2, 'sine', null, 0.13);
      tone(784, 0.22, 0.22, 'sine', null, 0.26); tone(1047, 0.28, 0.16, 'sine', null, 0.42);
    },
    roundLose() {
      tone(392, 0.14, 0.2, 'sine'); tone(311, 0.2, 0.2, 'sine', null, 0.15);
      tone(233, 0.3, 0.18, 'sine', null, 0.34);
    },
    click() { tone(1000, 0.03, 0.12, 'square'); },
    // A bot's footstep at distance: a soft sand tap, quieter the further away.
    distantStep(dist) {
      const g = Math.max(0.02, 0.12 - dist * 0.007);
      noiseBurst(0.05, 480, g);
    },
    buy() { tone(988, 0.05, 0.16, 'sine'); tone(1319, 0.07, 0.16, 'sine', null, 0.06); },
    denied() { tone(220, 0.09, 0.16, 'square', 180); },
    // Let the wind swell for a moment, e.g. at round start.
    gust() {
      if (!ensure() || !windGain) return;
      const t = ctx.currentTime;
      windGain.gain.cancelScheduledValues(t);
      windGain.gain.setValueAtTime(windGain.gain.value, t);
      windGain.gain.linearRampToValueAtTime(0.11, t + 0.7);
      windGain.gain.linearRampToValueAtTime(0.05, t + 2.2);
    },
  };
}
