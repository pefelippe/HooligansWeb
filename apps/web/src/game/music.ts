import { audioOut } from './sfx';

// Música: bateria de torcida (batucada) sintetizada, em loop, com agendamento à frente
// (lookahead) no relógio do WebAudio. A intensidade (0..1) acrescenta camadas quando a
// briga esquenta ou no último minuto.

const BPM = 104;
const STEP = 60 / BPM / 4; // semicolcheia
const LOOKAHEAD = 0.12;

// Padrões de 16 passos (1 compasso 2/4 em semicolcheias = 8; usamos 2 compassos).
const SURDO_1 = 'x...............x...............'; // marcação
const SURDO_2 = '........x...............x.......'; // resposta
const SURDO_3 = '..x...x.....x.x...x...x.....x...'; // cortador (intensidade)
const CAIXA = 'x.xxx.xxx.xxx.xxx.xxx.xxx.xxx.xx';
const CAIXA_ACC = 'x...x...x...x...x...x...x...x...';
const TAMBORIM = 'x.x.xx.x.x.x.xx.x.x.xx.x.x.x.xx.';
const AGOGO = 'x.x..x.x..x.x.x.x.x..x.x..x.x.x.';
const AGOGO_HI = 'x....x....x.....x....x....x.....';
const CHOCALHO = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const REPIQUE = '..............xx..............x.';

let timer: ReturnType<typeof setInterval> | null = null;
let gain: GainNode | null = null;
let nextTime = 0;
let stepIdx = 0;
let intensity = 0;
let on = true;
let noise: AudioBuffer | null = null;

function noiseBuf(ctx: AudioContext): AudioBuffer {
  if (noise) return noise;
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const ch = noise.getChannelData(0);
  let seed = 987654;
  for (let i = 0; i < ch.length; i++) {
    seed = (seed * 16807) % 2147483647;
    ch[i] = (seed / 2147483647) * 2 - 1;
  }
  return noise;
}

function drum(ctx: AudioContext, out: AudioNode, t: number, f0: number, f1: number, dur: number, vol: number): void {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function hiss(ctx: AudioContext, out: AudioNode, t: number, type: BiquadFilterType, freq: number, dur: number, vol: number): void {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf(ctx);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out);
  src.start(t, (stepIdx * 0.037) % 0.8);
  src.stop(t + dur + 0.02);
}

function bell(ctx: AudioContext, out: AudioNode, t: number, freq: number, vol: number): void {
  for (const [mult, v] of [
    [1, 1],
    [2.76, 0.4],
  ] as const) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq * mult;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.2);
  }
}

function schedule(ctx: AudioContext, out: AudioNode, t: number, i: number): void {
  const at = (p: string) => p[i % p.length] === 'x';
  const swing = i % 2 === 1 ? STEP * 0.12 : 0; // balanço do samba
  const tt = t + swing;
  const hot = intensity;
  if (at(SURDO_1)) drum(ctx, out, t, 95, 42, 0.45, 0.9);
  if (at(SURDO_2)) drum(ctx, out, t, 120, 55, 0.35, 0.7);
  if (hot > 0.3 && at(SURDO_3)) drum(ctx, out, t, 150, 70, 0.18, 0.35);
  if (at(CAIXA)) hiss(ctx, out, tt, 'highpass', 2500, 0.05, at(CAIXA_ACC) ? 0.18 : 0.07);
  if (at(CHOCALHO)) hiss(ctx, out, tt, 'highpass', 7000, 0.03, 0.025 + hot * 0.02);
  if (at(TAMBORIM)) drum(ctx, out, tt, 900, 700, 0.04, 0.12 + hot * 0.08);
  if (hot > 0.15 && at(AGOGO)) bell(ctx, out, tt, at(AGOGO_HI) ? 1180 : 880, 0.05);
  if (hot > 0.5 && at(REPIQUE)) drum(ctx, out, tt, 420, 300, 0.07, 0.3);
}

export function startMusic(): void {
  const a = audioOut();
  if (!a || timer) return;
  const { ctx, out } = a;
  gain = ctx.createGain();
  gain.gain.value = on ? 0.32 : 0;
  gain.connect(out);
  nextTime = ctx.currentTime + 0.1;
  stepIdx = 0;
  timer = setInterval(() => {
    if (!gain) return;
    while (nextTime < ctx.currentTime + LOOKAHEAD) {
      schedule(ctx, gain, nextTime, stepIdx);
      nextTime += STEP;
      stepIdx = (stepIdx + 1) % 32;
    }
  }, 25);
}

export function stopMusic(): void {
  if (timer) clearInterval(timer);
  timer = null;
  gain?.disconnect();
  gain = null;
}

export function setMusicIntensity(v: number): void {
  // Sobe rápido, desce devagar.
  intensity = v > intensity ? v : intensity * 0.97 + v * 0.03;
}

export function toggleMusic(): void {
  on = !on;
  if (gain) gain.gain.value = on ? 0.32 : 0;
}

export function isMusicOn(): boolean {
  return on;
}
