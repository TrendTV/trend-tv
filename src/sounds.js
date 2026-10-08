/* Trend TV — synthesized CRT sound pack.
   Everything is generated with WebAudio oscillators/noise: no asset
   files, no network. Volume defaults to barely-audible (0.12) so the
   TV never startles anyone; browsers also gate audio behind the first
   user gesture, so we lazily resume the context on first interaction. */

let ctx = null;
let master = null;
let volume = parseFloat(localStorage.getItem('tc.volume') ?? '0.12');
let humNodes = null;

function ensureCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function getVolume() { return volume; }

export function setVolume(v) {
  volume = Math.max(0, Math.min(1, v));
  localStorage.setItem('tc.volume', String(volume));
  if (master) master.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.05);
}

/* white noise buffer, reused */
let noiseBuf = null;
function getNoise() {
  if (!noiseBuf) {
    const len = ctx.sampleRate * 1.5;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

function env(node, t0, peak, decay) {
  node.gain.setValueAtTime(0, t0);
  node.gain.linearRampToValueAtTime(peak, t0 + 0.005);
  node.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
}

/* ── power-on: soft thump + rising hum, then a constant quiet hum ── */
export function powerOn() {
  try {
    ensureCtx();
    const t = ctx.currentTime;
    // thump
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.25);
    env(g, t, 0.5, 0.3);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + 0.35);
    // brief static crackle as the tube warms
    staticBurst(0.25, 0.25);
    startHum();
  } catch (e) { /* audio unavailable — stay silent */ }
}

/* ── constant quiet tube hum (50Hz mains + harmonics) ── */
export function startHum() {
  if (humNodes || !ctx) return;
  const g = ctx.createGain();
  g.gain.value = 0.028; // whisper level
  const oscs = [50, 100].map((f, i) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const og = ctx.createGain();
    og.gain.value = i === 0 ? 1 : 0.3;
    o.connect(og).connect(g);
    o.start();
    return o;
  });
  g.connect(master);
  humNodes = { g, oscs };
}

export function stopHum() {
  if (!humNodes) return;
  humNodes.oscs.forEach(o => o.stop());
  humNodes.g.disconnect();
  humNodes = null;
}

/* ── typing clack: short filtered noise tick, one per character ── */
let lastClack = 0;
export function clack() {
  try {
    ensureCtx();
    const t = ctx.currentTime;
    if (t - lastClack < 0.03) return; // rate-limit
    lastClack = t;
    const src = ctx.createBufferSource();
    src.buffer = getNoise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800 + Math.random() * 900;
    bp.Q.value = 6;
    const g = ctx.createGain();
    env(g, t, 0.10 + Math.random() * 0.05, 0.045);
    src.connect(bp).connect(g).connect(master);
    src.start(t, Math.random());
    src.stop(t + 0.06);
  } catch (e) { /* silent */ }
}

/* ── static burst for channel switching ── */
export function staticBurst(dur = 0.5, level = 0.4) {
  try {
    ensureCtx();
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = getNoise();
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(6000, t);
    lp.frequency.exponentialRampToValueAtTime(400, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.05);
  } catch (e) { /* silent */ }
}

/* ── degauss: wobbling descending hum-thump (hover on screen) ── */
let lastDegauss = 0;
export function degauss() {
  try {
    ensureCtx();
    const t = ctx.currentTime;
    if (t - lastDegauss < 1.2) return; // throttle hover re-triggers
    lastDegauss = t;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(60, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.4);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 11; // wobble
    const lfoG = ctx.createGain();
    lfoG.gain.value = 8;
    lfo.connect(lfoG).connect(o.frequency);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 300;
    const g = ctx.createGain();
    env(g, t, 0.22, 0.45);
    o.connect(lp).connect(g).connect(master);
    o.start(t); o.stop(t + 0.5);
    lfo.start(t); lfo.stop(t + 0.5);
  } catch (e) { /* silent */ }
}

/* ── knob click: crisp mechanical tick ── */
export function knobClick() {
  try {
    ensureCtx();
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = getNoise();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3000;
    const g = ctx.createGain();
    env(g, t, 0.3, 0.03);
    src.connect(hp).connect(g).connect(master);
    src.start(t, Math.random());
    src.stop(t + 0.04);
  } catch (e) { /* silent */ }
}

/* unlock audio on the very first user interaction (autoplay policy) */
export function armAudioUnlock(onFirstUnlock) {
  const unlock = () => {
    ensureCtx();
    if (onFirstUnlock) onFirstUnlock();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}
