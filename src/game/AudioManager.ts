// AudioManager: everything is synthesised with the Web Audio API (no audio files, nothing to license).
import type { Settings } from "../state/settings";

type Bus = "ambient" | "traffic" | "sfx" | "voices";

export class AudioManager {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private bus!: Record<Bus, GainNode>;
  private noise!: AudioBuffer;
  private crowdGain!: GainNode; private rainGain!: GainNode; private windGain!: GainNode; private cityGain!: GainNode;
  private engines: { osc: OscillatorNode; gain: GainNode; pan: PannerNode; filter: BiquadFilterNode }[] = [];
  private train: { gain: GainNode; pan: PannerNode } | null = null;
  private shop: { pan: PannerNode; gain: GainNode; next: number; step: number }[] = [];
  private signalT = 0; private signalFlip = false;
  private babble: { g: GainNode; next: number }[] = [];
  private paused = false;

  start(st: Settings) {
    if (this.ctx) { void this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain(); this.master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor(); comp.connect(this.master);
    const mk = () => { const g = ctx.createGain(); g.connect(comp); return g; };
    this.bus = { ambient: mk(), traffic: mk(), sfx: mk(), voices: mk() };
    // shared noise buffer (white with a brown-ish second channel baked in by filtering at use)
    const len = ctx.sampleRate * 3;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const loop = (type: BiquadFilterType, freq: number, q: number, dest: AudioNode, gain: number) => {
      const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; s.playbackRate.value = 0.8 + Math.random() * 0.4;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = gain;
      s.connect(f); f.connect(g); g.connect(dest); s.start(0, Math.random() * 2);
      return { g, f };
    };
    // city hum + distant traffic
    this.cityGain = loop("lowpass", 170, 0.5, this.bus.ambient, 0.5).g;
    loop("bandpass", 90, 0.8, this.bus.traffic, 0.22);
    // wind
    const wind = loop("bandpass", 420, 0.6, this.bus.ambient, 0.035);
    this.windGain = wind.g;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.11; const lg = ctx.createGain(); lg.gain.value = 180; lfo.connect(lg); lg.connect(wind.f.frequency); lfo.start();
    // crowd murmur: several formant bands with independent slow amplitude wobble
    this.crowdGain = ctx.createGain(); this.crowdGain.gain.value = 0.2; this.crowdGain.connect(this.bus.ambient);
    for (const fq of [320, 520, 780, 1150, 1700, 2400]) { const b = loop("bandpass", fq, 4.5, this.crowdGain, 0.12); this.babble.push({ g: b.g, next: 0 }); }
    // rain
    this.rainGain = ctx.createGain(); this.rainGain.gain.value = 0; this.rainGain.connect(this.bus.ambient);
    loop("highpass", 2400, 0.3, this.rainGain, 0.16); loop("bandpass", 900, 0.4, this.rainGain, 0.07);
    // vehicle engine voices (assigned to the nearest vehicles each frame)
    for (let i = 0; i < 6; i++) {
      const osc = ctx.createOscillator(); osc.type = "sawtooth"; osc.frequency.value = 55;
      const filter = ctx.createBiquadFilter(); filter.type = "lowpass"; filter.frequency.value = 220;
      const gain = ctx.createGain(); gain.gain.value = 0;
      const pan = this.panner(14);
      osc.connect(filter); filter.connect(gain); gain.connect(pan); pan.connect(this.bus.traffic); osc.start();
      this.engines.push({ osc, gain, pan, filter });
    }
    // train rumble
    { const pan = this.panner(30); const g = ctx.createGain(); g.gain.value = 0; loop("lowpass", 260, 0.7, g, 1.4); g.connect(pan); pan.connect(this.bus.traffic); this.train = { gain: g, pan }; }
    // shop-front music boxes (original generative pentatonic chimes)
    for (const [x, z] of [[-24, 18.5], [22, 18.5], [-22, -18.5]] as [number, number][]) {
      const pan = this.panner(5); pan.positionX.value = x; pan.positionY.value = 2.5; pan.positionZ.value = -z;
      const gain = ctx.createGain(); gain.gain.value = 0.16; gain.connect(pan); pan.connect(this.bus.ambient);
      this.shop.push({ pan, gain, next: ctx.currentTime + Math.random(), step: Math.floor(Math.random() * 8) });
    }
    this.applyVolumes(st);
  }

  private panner(ref: number): PannerNode {
    const p = this.ctx!.createPanner();
    p.panningModel = "equalpower"; p.distanceModel = "inverse"; p.refDistance = ref; p.maxDistance = 400; p.rolloffFactor = 1.3;
    return p;
  }

  applyVolumes(st: Settings) {
    if (!this.ctx) return;
    this.master.gain.value = st.volMaster;
    this.bus.ambient.gain.value = st.volAmbient; this.bus.traffic.gain.value = st.volTraffic;
    this.bus.sfx.gain.value = st.volSfx; this.bus.voices.gain.value = st.volVoices;
  }
  setPaused(p: boolean) {
    if (!this.ctx || p === this.paused) return;
    this.paused = p;
    if (p) void this.ctx.suspend(); else void this.ctx.resume();
  }
  setWeather(rain: boolean, night: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.rainGain.gain.setTargetAtTime(rain ? 1 : 0, t, 1.2);
    this.windGain.gain.setTargetAtTime(rain ? 0.07 : 0.035, t, 1);
    this.cityGain.gain.setTargetAtTime(night ? 0.4 : 0.5, t, 1);
  }

  /** Per-frame update: listener, crowd level, engines, signal chirps. Babylon is left-handed, Web Audio right-handed: z is flipped. */
  update(dt: number, l: { x: number; y: number; z: number; fx: number; fy: number; fz: number }, crowdNear: number,
    vehicles: { x: number; z: number; v: number; brake: number; id: number }[], ped: "green" | "flash" | "red", train: { x: number; z: number; on: boolean }) {
    const ctx = this.ctx;
    if (!ctx || this.paused) return;
    const t = ctx.currentTime, L = ctx.listener;
    if (L.positionX) {
      L.positionX.value = l.x; L.positionY.value = l.y; L.positionZ.value = -l.z;
      L.forwardX.value = l.fx; L.forwardY.value = l.fy; L.forwardZ.value = -l.fz; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else { L.setPosition(l.x, l.y, -l.z); L.setOrientation(l.fx, l.fy, -l.fz, 0, 1, 0); }
    this.crowdGain.gain.setTargetAtTime(0.1 + Math.min(1, crowdNear / 14) * 0.5, t, 0.5);
    for (const b of this.babble) if (t > b.next) { b.g.gain.setTargetAtTime(0.04 + Math.random() * 0.16, t, 0.12 + Math.random() * 0.2); b.next = t + 0.12 + Math.random() * 0.35; }
    // engines → nearest vehicles
    const near = vehicles.map((v) => ({ v, d: Math.hypot(v.x - l.x, v.z - l.z) })).sort((a, b) => a.d - b.d).slice(0, this.engines.length);
    this.engines.forEach((e, i) => {
      const n = near[i];
      if (!n || n.d > 90) { e.gain.gain.setTargetAtTime(0, t, 0.2); return; }
      e.pan.positionX.value = n.v.x; e.pan.positionY.value = 0.6; e.pan.positionZ.value = -n.v.z;
      e.osc.frequency.setTargetAtTime(48 + n.v.v * 7.5 + (n.v.id % 5) * 3, t, 0.15);
      e.filter.frequency.setTargetAtTime(160 + n.v.v * 45, t, 0.2);
      e.gain.gain.setTargetAtTime(0.1 + Math.min(1, n.v.v / 9) * 0.22, t, 0.2);
      if (n.v.brake && n.v.v > 1.2 && n.v.v < 3.2 && Math.random() < dt * 0.9 && n.d < 40) this.brake(n.v.x, n.v.z);
    });
    if (this.train) {
      this.train.pan.positionX.value = train.x; this.train.pan.positionY.value = 8; this.train.pan.positionZ.value = -train.z;
      this.train.gain.gain.setTargetAtTime(train.on ? 1 : 0, t, 0.8);
    }
    // pedestrian signal sound: bird-like chirps, alternating corners; faster while flashing
    if (ped !== "red") {
      this.signalT -= dt;
      if (this.signalT <= 0) {
        this.signalT = ped === "flash" ? 0.42 : 0.95;
        this.signalFlip = !this.signalFlip;
        const c = this.signalFlip ? [13, 11] : [-13, -11];
        this.chirp(c[0], c[1], this.signalFlip ? 2300 : 1900, ped === "flash");
      }
    } else this.signalT = 0;
    // shop chimes
    const scale = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];
    for (const s of this.shop) if (t > s.next) {
      s.step++;
      const f = scale[(s.step * 5 + (s.step % 3) * 2) % scale.length] * (s.step % 8 === 0 ? 0.5 : 1);
      const o = ctx.createOscillator(); o.type = "triangle"; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      o.connect(g); g.connect(s.gain); o.start(t); o.stop(t + 1);
      s.next = t + (s.step % 4 === 3 ? 0.66 : 0.33);
    }
  }

  private burst(dest: AudioNode, dur: number, type: BiquadFilterType, freq: number, gain: number, q = 0.7, when = 0) {
    const ctx = this.ctx!; const t = ctx.currentTime + when;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    s.connect(f); f.connect(g); g.connect(dest); s.start(t, Math.random() * 2, dur + 0.02);
  }
  private at(x: number, y: number, z: number, ref: number, bus: Bus): PannerNode {
    const p = this.panner(ref); p.positionX.value = x; p.positionY.value = y; p.positionZ.value = -z; p.connect(this.bus[bus]);
    setTimeout(() => p.disconnect(), 2500);
    return p;
  }
  private chirp(x: number, z: number, f: number, fast: boolean) {
    const ctx = this.ctx!, t = ctx.currentTime, p = this.at(x, 4, z, 9, "traffic");
    for (let i = 0; i < (fast ? 1 : 2); i++) {
      const o = ctx.createOscillator(); o.type = "sine";
      const s = t + i * 0.13;
      o.frequency.setValueAtTime(f, s); o.frequency.exponentialRampToValueAtTime(f * 0.72, s + 0.09);
      const g = ctx.createGain(); g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(0.16, s + 0.01); g.gain.exponentialRampToValueAtTime(0.001, s + 0.11);
      o.connect(g); g.connect(p); o.start(s); o.stop(s + 0.14);
    }
  }
  private brake(x: number, z: number) {
    const ctx = this.ctx!, t = ctx.currentTime, p = this.at(x, 0.5, z, 8, "traffic");
    const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.setValueAtTime(2600, t); o.frequency.linearRampToValueAtTime(2250, t + 0.45);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.02, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.5);
    o.connect(g); g.connect(p); o.start(t); o.stop(t + 0.55);
  }

  footstep(wet: boolean, run: boolean) {
    if (!this.ctx || this.paused) return;
    this.burst(this.bus.sfx, 0.07, "lowpass", wet ? 1400 : 750, run ? 0.22 : 0.13, 1.2);
    if (wet) this.burst(this.bus.sfx, 0.12, "highpass", 3000, 0.05);
  }
  shutter() {
    if (!this.ctx) return;
    this.burst(this.bus.sfx, 0.02, "highpass", 2500, 0.5); this.burst(this.bus.sfx, 0.05, "bandpass", 420, 0.6, 2);
    this.burst(this.bus.sfx, 0.025, "highpass", 3000, 0.4, 0.7, 0.085); this.burst(this.bus.sfx, 0.06, "bandpass", 300, 0.4, 2, 0.09);
  }
  focusBeep() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const d of [0, 0.09]) {
      const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = 3400;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t + d); g.gain.linearRampToValueAtTime(0.07, t + d + 0.005); g.gain.linearRampToValueAtTime(0, t + d + 0.05);
      o.connect(g); g.connect(this.bus.sfx); o.start(t + d); o.stop(t + d + 0.06);
    }
  }
  cameraMove(up: boolean) { if (this.ctx) { this.burst(this.bus.sfx, 0.16, "bandpass", up ? 1500 : 900, 0.12, 0.8); this.burst(this.bus.sfx, 0.03, "highpass", 4000, 0.08, 0.7, 0.14); } }
  dial() { if (this.ctx) this.burst(this.bus.sfx, 0.018, "highpass", 3500, 0.18); }
  uiClick() { if (this.ctx) this.burst(this.bus.sfx, 0.02, "bandpass", 1800, 0.12, 3); }
  warn() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const d of [0, 0.16]) { const o = ctx.createOscillator(); o.type = "square"; o.frequency.value = 880; const g = ctx.createGain(); g.gain.setValueAtTime(0.045, t + d); g.gain.linearRampToValueAtTime(0, t + d + 0.1); o.connect(g); g.connect(this.bus.sfx); o.start(t + d); o.stop(t + d + 0.11); }
  }

  /** Short wordless vocalisation (formant synth) placed at the speaker. */
  voice(x: number, z: number, kind: "greet" | "surprise" | "laugh" | "talk", female: boolean, seed: number) {
    if (!this.ctx || this.paused) return;
    const ctx = this.ctx, t = ctx.currentTime, p = this.at(x, 1.6, z, 2.2, "voices");
    const base = (female ? 215 : 125) * (0.9 + (seed % 7) * 0.035);
    const syll = kind === "laugh" ? 4 : kind === "surprise" ? 1 : kind === "greet" ? 2 : 3;
    const vowels = [[800, 1200], [400, 2000], [350, 800], [600, 1700], [300, 2300]];
    for (let i = 0; i < syll; i++) {
      const s = t + i * (kind === "laugh" ? 0.13 : 0.19), dur = kind === "laugh" ? 0.09 : kind === "surprise" ? 0.3 : 0.15;
      const o = ctx.createOscillator(); o.type = "sawtooth";
      const f0 = base * (kind === "surprise" ? 1.25 : 1 + (((seed + i * 3) % 5) - 2) * 0.05);
      o.frequency.setValueAtTime(f0, s); o.frequency.linearRampToValueAtTime(f0 * (kind === "surprise" ? 1.5 : kind === "greet" && i === syll - 1 ? 1.18 : 0.93), s + dur);
      const g = ctx.createGain(); g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(0.5, s + 0.02); g.gain.linearRampToValueAtTime(0, s + dur);
      const v = vowels[(seed + i * 2) % vowels.length];
      for (const fq of v) { const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = fq * (female ? 1.15 : 1); f.Q.value = 7; o.connect(f); f.connect(g); }
      g.connect(p); o.start(s); o.stop(s + dur + 0.02);
    }
  }

  dispose() { void this.ctx?.close(); this.ctx = null; }
}
