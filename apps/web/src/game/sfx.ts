// Sons sintetizados com WebAudio: nada para baixar, tudo procedural.
// Cada som aceita volume e pan (posição na tela), calculados pelo engine a partir da distância.
// TODO(polimento): trocar por samples gravados mantendo esta mesma API.

export type HitMaterial = 'carne' | 'metal' | 'madeira' | 'vidro' | 'lamina';

export type SoundName =
  | 'hit'
  | 'heavyHit'
  | 'block'
  | 'parry'
  | 'whoosh'
  | 'bigWhoosh'
  | 'perfectDodge'
  | 'guardbreak'
  | 'ko'
  | 'step'
  | 'jump'
  | 'land'
  | 'special'
  | 'shout'
  | 'heal'
  | 'sizzle'
  | 'downed'
  | 'revive'
  | 'buy'
  | 'deny'
  | 'weaponBreak';

export interface SoundOpts {
  volume?: number;
  pan?: number;
  material?: HitMaterial;
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let ambience: { stop(): void } | null = null;
let muted = false;

function audio(): AudioContext | null {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.8;
      // Compressor para os golpes não estourarem quando muita coisa acontece junto.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      master.connect(comp).connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Contexto e saída compartilhados com a música. */
export function audioOut(): { ctx: AudioContext; out: AudioNode } | null {
  const a = audio();
  return a ? { ctx: a, out: master ?? a.destination } : null;
}

export function setMuted(m: boolean): void {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.8;
}

export function isMuted(): boolean {
  return muted;
}

/** Ruído branco reutilizável (2 s), gerado com LCG determinístico. */
function noise(a: AudioContext): AudioBuffer {
  if (noiseBuf) return noiseBuf;
  noiseBuf = a.createBuffer(1, a.sampleRate * 2, a.sampleRate);
  const ch = noiseBuf.getChannelData(0);
  let seed = 1234567;
  for (let i = 0; i < ch.length; i++) {
    seed = (seed * 16807) % 2147483647;
    ch[i] = (seed / 2147483647) * 2 - 1;
  }
  return noiseBuf;
}

function out(a: AudioContext, o: SoundOpts): AudioNode {
  const g = a.createGain();
  g.gain.value = Math.max(0, Math.min(1.5, o.volume ?? 1));
  const p = a.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, o.pan ?? 0));
  g.connect(p).connect(master ?? a.destination);
  return g;
}

/** Rajada de ruído filtrada com envelope. */
function burst(a: AudioContext, dest: AudioNode, t: number, dur: number, type: BiquadFilterType, freq: number, gain: number, q = 1, freqEnd?: number): void {
  const src = a.createBufferSource();
  src.buffer = noise(a);
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  f.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(dest);
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.02);
}

/** Tom com envelope e glide de frequência. */
function tone(a: AudioContext, dest: AudioNode, t: number, dur: number, type: OscillatorType, f0: number, f1: number, gain: number, attack = 0.005): void {
  const o = a.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function impact(a: AudioContext, d: AudioNode, t: number, m: HitMaterial, heavy: boolean): void {
  const k = heavy ? 1.4 : 1;
  // Corpo: thump grave sempre presente.
  tone(a, d, t, 0.12 * k, 'sine', 140 * (heavy ? 0.8 : 1), 45, 0.6 * k);
  switch (m) {
    case 'carne':
      burst(a, d, t, 0.07 * k, 'bandpass', 1400, 0.5 * k, 0.8);
      break;
    case 'metal':
      burst(a, d, t, 0.05, 'highpass', 3000, 0.35);
      tone(a, d, t, 0.35 * k, 'triangle', 1850, 1700, 0.12);
      tone(a, d, t, 0.3 * k, 'triangle', 2730, 2600, 0.07);
      break;
    case 'madeira':
      burst(a, d, t, 0.06, 'bandpass', 900, 0.55, 2.5);
      tone(a, d, t, 0.08, 'square', 420, 260, 0.08);
      break;
    case 'vidro':
      burst(a, d, t, 0.25, 'highpass', 4500, 0.35);
      for (let i = 0; i < 5; i++) tone(a, d, t + i * 0.025, 0.12, 'sine', 3000 + i * 700, 2600 + i * 500, 0.05);
      break;
    case 'lamina':
      burst(a, d, t, 0.12, 'highpass', 5000, 0.35, 0.7, 2500);
      burst(a, d, t, 0.05, 'bandpass', 1200, 0.3, 1);
      break;
  }
}

export function playSound(name: SoundName, o: SoundOpts = {}): void {
  const a = audio();
  if (!a || muted) return;
  const vol = o.volume ?? 1;
  if (vol < 0.02) return;
  const d = out(a, o);
  const t = a.currentTime;
  switch (name) {
    case 'hit':
      impact(a, d, t, o.material ?? 'carne', false);
      break;
    case 'heavyHit':
      impact(a, d, t, o.material ?? 'carne', true);
      burst(a, d, t + 0.02, 0.2, 'lowpass', 400, 0.4);
      break;
    case 'block':
      tone(a, d, t, 0.09, 'sine', 220, 90, 0.45);
      burst(a, d, t, 0.06, 'bandpass', 2200, 0.3, 1.5);
      break;
    case 'parry':
      tone(a, d, t, 0.45, 'triangle', 1600, 1500, 0.22);
      tone(a, d, t, 0.4, 'sine', 2400, 2300, 0.12);
      burst(a, d, t, 0.05, 'highpass', 4000, 0.3);
      break;
    case 'whoosh':
      burst(a, d, t, 0.14, 'bandpass', 600, 0.25, 1.2, 2200);
      break;
    case 'bigWhoosh':
      burst(a, d, t, 0.3, 'bandpass', 300, 0.35, 1, 1600);
      break;
    case 'perfectDodge':
      burst(a, d, t, 0.2, 'bandpass', 2500, 0.25, 1, 600);
      tone(a, d, t + 0.05, 0.4, 'sine', 880, 1760, 0.15, 0.02);
      tone(a, d, t + 0.12, 0.4, 'sine', 1320, 2640, 0.1, 0.02);
      break;
    case 'guardbreak':
      tone(a, d, t, 0.35, 'sawtooth', 300, 60, 0.25);
      burst(a, d, t, 0.2, 'lowpass', 900, 0.5);
      break;
    case 'ko':
      tone(a, d, t, 0.5, 'sine', 90, 35, 0.8);
      burst(a, d, t, 0.4, 'lowpass', 500, 0.5);
      crowd(a, d, t + 0.1, 1.6, 0.35, 'oh');
      break;
    case 'step':
      burst(a, d, t, 0.05, 'lowpass', 700, 0.12);
      break;
    case 'jump':
      burst(a, d, t, 0.08, 'lowpass', 900, 0.15);
      tone(a, d, t, 0.1, 'sine', 180, 260, 0.06);
      break;
    case 'land':
      burst(a, d, t, 0.1, 'lowpass', 500, 0.3);
      tone(a, d, t, 0.1, 'sine', 110, 50, 0.3);
      break;
    case 'special':
      tone(a, d, t, 0.5, 'sawtooth', 110, 440, 0.12, 0.1);
      tone(a, d, t, 0.5, 'sawtooth', 165, 660, 0.08, 0.1);
      burst(a, d, t, 0.4, 'bandpass', 400, 0.3, 1, 3000);
      break;
    case 'shout':
      crowd(a, d, t, 2.2, 0.7, 'ah');
      tone(a, d, t, 0.8, 'sawtooth', 196, 196, 0.08, 0.05);
      tone(a, d, t + 0.4, 0.8, 'sawtooth', 262, 262, 0.08, 0.05);
      break;
    case 'heal':
      for (let i = 0; i < 3; i++) tone(a, d, t + i * 0.09, 0.35, 'sine', 660 * 2 ** (i / 3), 660 * 2 ** (i / 3), 0.1, 0.02);
      break;
    case 'sizzle':
      burst(a, d, t, 0.6, 'highpass', 3500, 0.12, 0.5);
      break;
    case 'downed':
      tone(a, d, t, 0.6, 'sawtooth', 180, 70, 0.12, 0.05);
      burst(a, d, t, 0.3, 'lowpass', 400, 0.3);
      break;
    case 'revive':
      tone(a, d, t, 0.5, 'triangle', 330, 660, 0.15, 0.05);
      tone(a, d, t + 0.15, 0.5, 'triangle', 440, 880, 0.12, 0.05);
      crowd(a, d, t, 1.2, 0.25, 'ah');
      break;
    case 'buy':
      tone(a, d, t, 0.08, 'square', 1200, 1200, 0.08);
      tone(a, d, t + 0.08, 0.15, 'square', 1800, 1800, 0.08);
      break;
    case 'deny':
      tone(a, d, t, 0.2, 'square', 200, 150, 0.08);
      break;
    case 'weaponBreak':
      burst(a, d, t, 0.3, 'highpass', 3000, 0.3);
      tone(a, d, t, 0.2, 'triangle', 900, 300, 0.1);
      break;
  }
}

/** Torcida: muitas vozes de ruído com formantes (vogal "a" ou "o"). */
function crowd(a: AudioContext, dest: AudioNode, t: number, dur: number, gain: number, vowel: 'ah' | 'oh'): void {
  const formants = vowel === 'ah' ? [750, 1200] : [450, 800];
  for (const f of formants) {
    const src = a.createBufferSource();
    src.buffer = noise(a);
    const bp = a.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f;
    bp.Q.value = 4;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(dest);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }
}

/** Murmúrio de estádio em loop, com ondas de "olê" de vez em quando. */
export function startAmbience(): void {
  const a = audio();
  if (!a || ambience) return;
  const src = a.createBufferSource();
  src.buffer = noise(a);
  src.loop = true;
  const lp = a.createBiquadFilter();
  lp.type = 'bandpass';
  lp.frequency.value = 550;
  lp.Q.value = 0.6;
  const g = a.createGain();
  g.gain.value = 0.05;
  // Oscilação lenta do volume = multidão respirando.
  const lfo = a.createOscillator();
  lfo.frequency.value = 0.15;
  const lfoGain = a.createGain();
  lfoGain.gain.value = 0.025;
  lfo.connect(lfoGain).connect(g.gain);
  src.connect(lp).connect(g).connect(master ?? a.destination);
  src.start();
  lfo.start();
  const chant = setInterval(() => {
    if (muted || !ctx) return;
    const d = out(ctx, { volume: 0.4, pan: Math.random() * 2 - 1 });
    crowd(ctx, d, ctx.currentTime, 2.5, 0.12, Math.random() < 0.5 ? 'oh' : 'ah');
  }, 9000);
  ambience = {
    stop() {
      clearInterval(chant);
      src.stop();
      lfo.stop();
      ambience = null;
    },
  };
}

export function stopAmbience(): void {
  ambience?.stop();
}
