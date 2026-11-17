import type { FighterSnapshot, MoveDef } from '@torcidas/shared';
import { DEFAULT_CONSTANTS } from '@torcidas/shared';

const DODGE = DEFAULT_CONSTANTS.dodge;
/** Últimos ticks do knockdown em que o boneco já começa a levantar. */
const KD_RISE = 15;
/** Segundos iniciais do LayToIdle em que o corpo ainda está deitado parado. */
const LAY_START = 0.43;

// Estado da simulação → clipe do Quaternius. Função pura (sem three) para testar.
// Clipes de golpe e de reação são posicionados pelo tick (`time`), não pelo relógio:
// o impacto do clipe cai no primeiro tick ativo do frame data.

export interface ClipInfo {
  duration: number;
  /** Segundo do clipe em que o braço está mais esticado para a frente. */
  impact: number;
}

export interface AnimPick {
  clip: string;
  /** Tempo fixo no clipe (s). Ausente: toca em loop no relógio, com `speed`. */
  time?: number;
  speed: number;
  /** Perna por cima do clipe: chute e voadora não têm clipe próprio. */
  kick?: number;
}

type Snap = Pick<FighterSnapshot, 'state' | 'stateTick' | 'stateDuration' | 'y' | 'running' | 'dodgeKind'>;

export const TICK_S = 1 / 60;

/** Golpe → clipe, pela arma (prefixo do id), tipo e posição no combo. */
export function attackClip(def: MoveDef): string {
  const weapon = def.id.split('.')[0] ?? 'punhos';
  if (def.id === 'voadora') return 'Jump_Loop';
  if (def.kind === 'kick') return 'Idle_Loop';
  if (def.kind === 'shove' || def.id === 'cabecada') return 'Shield_OneShot';
  const unarmed = weapon === 'punhos' || weapon === 'soqueira';
  const idx = def.id.endsWith('l2') ? 2 : def.id.endsWith('l3') ? 3 : def.kind === 'heavy' ? 4 : 1;
  if (def.kind === 'special') {
    if (def.multiHit) return 'Punch_Jab';
    if (weapon === 'taco') return 'Sword_Heavy_Combo';
    if (weapon === 'cassetete') return 'Sword_Regular_C';
    if (weapon === 'faca' || weapon === 'punhal') return 'Sword_Dash';
    return 'Sword_Attack';
  }
  if (unarmed || def.hitbox.shape === 'capsule') return ['Punch_Jab', 'Punch_Cross', 'Melee_Hook', 'Punch_Cross'][idx - 1] ?? 'Punch_Jab';
  return ['Sword_Regular_A', 'Sword_Regular_B', 'Sword_Regular_C', 'Sword_Attack'][idx - 1] ?? 'Sword_Regular_A';
}

/** startup → [0, impacto], active → um respiro depois do impacto, recovery → resto do clipe. */
export function attackTime(def: MoveDef, tick: number, c: ClipInfo): number {
  const after = Math.max(0, c.duration - c.impact);
  const hold = Math.min(0.08, after * 0.2);
  if (tick <= def.startup) return (c.impact * tick) / Math.max(1, def.startup);
  if (tick <= def.startup + def.active) return c.impact + (hold * (tick - def.startup)) / Math.max(1, def.active);
  const k = Math.min(1, (tick - def.startup - def.active) / Math.max(1, def.recovery));
  return c.impact + hold + (after - hold) * k;
}

const prog = (t: number, d: number) => Math.min(1, t / Math.max(1, d));

export function pickAnim(f: Snap, def: MoveDef | undefined, speed: number, clips: (name: string) => ClipInfo): AnimPick {
  const t = f.stateTick;
  const at = (clip: string, k: number): AnimPick => ({ clip, time: clips(clip).duration * Math.min(1, Math.max(0, k)), speed: 1 });
  // Do fim do knockdown ao fim do getup: só a parte do clipe em que o corpo sobe (antes ele está parado no chão).
  const layToIdle = (tick: number): AnimPick => {
    const d = clips('LayToIdle').duration;
    return { clip: 'LayToIdle', time: LAY_START + (d - LAY_START) * Math.min(1, tick / (KD_RISE + DEFAULT_CONSTANTS.getUpTicks)), speed: 1 };
  };
  switch (f.state) {
    case 'attack': {
      if (!def) break;
      const clip = attackClip(def);
      if (def.multiHit && def.kind === 'special') {
        // Socos alternados: jab/direto a cada segmento do multi-hit.
        const seg = Math.max(0, Math.floor((t - def.startup - 1) / def.multiHit.interval));
        const c = seg % 2 ? 'Punch_Cross' : 'Punch_Jab';
        const inSeg = t <= def.startup ? 0 : ((t - def.startup - 1) % def.multiHit.interval) / def.multiHit.interval;
        return { clip: c, time: clips(c).impact * (t <= def.startup ? prog(t, def.startup) : 0.4 + 0.6 * Math.sin(inSeg * Math.PI)), speed: 1 };
      }
      const pick: AnimPick = { clip, time: attackTime(def, t, clips(clip)), speed: 1 };
      if (def.kind === 'kick' || def.id === 'voadora') {
        // Perna sobe no startup, fica esticada no active e volta no recovery.
        pick.time = clips(clip).duration * 0.5;
        pick.kick = t <= def.startup ? prog(t, def.startup) : t <= def.startup + def.active ? 1 : 1 - prog(t - def.startup - def.active, def.recovery);
      }
      return pick;
    }
    case 'charging': {
      const clip = def ? attackClip(def) : 'Sword_Attack';
      return { clip, time: clips(clip).impact * 0.35, speed: 1 };
    }
    case 'block':
    case 'blockstun':
      return at('Sword_Block', 0.45);
    case 'dodge':
      // A esquiva entra sem duração no estado: o tempo vem das constantes (senão o clipe pula pro fim).
      return f.dodgeKind === 'roll' ? at('Roll', prog(t, DODGE.roll.duration)) : { clip: 'Crouch_Idle_Loop', speed: 1 };
    case 'hitstun':
      return at(f.stateDuration % 2 ? 'Hit_Head' : 'Hit_Chest', prog(t, f.stateDuration));
    case 'staggered':
    case 'guardbreak':
      return at('Idle_Shield_Break', prog(t, f.stateDuration));
    case 'knockdown': {
      // Cai rápido (o clipe aterrissa em ~0,4 s), fica no chão e começa a levantar ainda no knockdown:
      // o getup sozinho (getUpTicks) é curto demais para o LayToIdle, que ficava 4x acelerado.
      const rise = f.stateDuration - KD_RISE;
      if (t < rise) return at('Hit_Knockback', prog(t, Math.min(28, rise)));
      return layToIdle(t - rise);
    }
    case 'ko':
    case 'dead':
    case 'downed':
      return at('Death01', f.state === 'ko' ? prog(t, 40) : 1);
    case 'getup':
      return layToIdle(KD_RISE + t);
    case 'shout':
      return { clip: 'Spell_Simple_Shoot', speed: 1 };
    case 'healing':
      return { clip: 'Consume', speed: 1 };
    case 'reviving':
      return { clip: 'Fixing_Kneeling', speed: 1 };
    default:
      break;
  }
  if (f.y > 0.02) return { clip: 'Jump_Loop', speed: 1 };
  // Locomoção: velocidade do clipe acompanha a do boneco para o pé não patinar.
  if (speed < 0.3) return { clip: 'Idle_Loop', speed: 1 };
  if (f.running) return { clip: 'Sprint_Loop', speed: Math.max(0.6, speed / 6.5) };
  if (speed > 2.6) return { clip: 'Jog_Fwd_Loop', speed: Math.max(0.6, speed / 3.6) };
  return { clip: 'Walk_Loop', speed: Math.max(0.5, speed / 1.5) };
}
