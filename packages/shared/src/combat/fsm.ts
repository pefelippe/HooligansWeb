import type { CombatConstants, MoveDef, TeamSide, Vec2 } from './types';

// Máquina de estados do lutador.
//
//   idle (parado/andando) ─┬─> charging ─> attack(startup → active → recovery)
//                          ├─> attack
//                          ├─> block (os primeiros ticks são a janela de parry)
//                          └─> dodge (i-frames)
//                          ├─> shout (grito da torcida) / healing (curativo) / eating (carrinho)
//                          └─> reviving (levantando aliado caído)
//   reações: hitstun, blockstun, staggered (levou parry), guardbreak,
//            knockdown ─> getup (i-frames)
//   fim:     [downed (caído, pode ser levantado)] ─> ko ─> dead ─> (respawn na sede) ─> idle

export type FighterStateName =
  | 'idle'
  | 'charging'
  | 'attack'
  | 'block'
  | 'dodge'
  | 'hitstun'
  | 'blockstun'
  | 'staggered'
  | 'guardbreak'
  | 'knockdown'
  | 'getup'
  | 'shout'
  | 'healing'
  | 'eating'
  | 'reviving'
  | 'downed'
  | 'ko'
  | 'dead';

export type BufferedAction = 'light' | 'heavy' | 'dodge' | 'shove' | 'kick' | 'special' | 'shout' | 'heal';

export interface ActiveMove {
  def: MoveDef;
  /** Índice no combo leve (0..2), -1 para pesado/chute/empurrão. */
  chainIndex: number;
  /** 0..1, fração da carga do pesado. */
  charge: number;
  /** Alvos já atingidos por esta instância do golpe (zera a cada segmento em multiHit). */
  hitIds: string[];
  /** Quem esquivou perfeitamente deste golpe (recompensa uma vez só). */
  dodgedIds: string[];
  /** Segmento atual de um golpe multiHit. */
  segment: number;
}

export interface Bleed {
  ticksLeft: number;
  sourceId: string;
}

export interface Fighter {
  id: string;
  team: TeamSide;
  pos: Vec2;
  /** Altura do pé em relação ao chão (pulo) e velocidade vertical. */
  y: number;
  vy: number;
  running: boolean;
  /** Carregando o bandeirão rival (modo bandeirão). */
  carrying: boolean;
  /** Velocidade de knockback (m/s), decai com atrito. */
  vel: Vec2;
  /** Embalo (m/s, na direção do corpo) de um golpe que saiu da corrida. */
  momentum: number;
  facing: number;
  /** Direção de movimento pedida pelo input neste tick (normalizada ou zero). */
  moveDir: Vec2;
  hp: number;
  stamina: number;
  lastStaminaSpendTick: number;
  state: FighterStateName;
  /** Frames decorridos no estado atual (1 no primeiro frame de um golpe). */
  stateTick: number;
  /** Duração de estados temporizados (hitstun, guardbreak...). */
  stateDuration: number;
  move: ActiveMove | null;
  dodgeDir: Vec2;
  dodgeKind: 'step' | 'roll';
  /** Barra de Raça (0..100): especial (R) e grito (G). */
  raca: number;
  /** Próximo acerto até este tick é contra-golpe (depois de parry/esquiva perfeita). */
  counterUntil: number;
  /** Grito da torcida: bônus de dano e estamina até este tick. */
  buffUntil: number;
  /** Último tick em que deu ou levou dano (fôlego fora de combate). */
  lastCombatTick: number;
  cartCooldownUntil: number;
  /** Quem derrubou (caído). Recebe o KO se ele sangrar até o fim ou for finalizado. */
  downedBy: string | null;
  /** Aliado que está sendo levantado (estado reviving). */
  reviveTarget: string | null;
  blockStartTick: number;
  lastBlockEndTick: number;
  /** Este bloqueio pode virar parry (falso se foi re-apertado durante o lockout). */
  parryEligible: boolean;
  hitstop: number;
  /** Proteção de spawn: invulnerável até este tick (cancelada ao atacar). */
  protectedUntil: number;
  weapon: string;
  durability: number | null;
  bleeds: Bleed[];
  /** id do atacante -> último tick em que causou dano (anti-gank e assistências). */
  damagedBy: Record<string, number>;
  prevButtons: number;
  buffer: { action: BufferedAction; tick: number } | null;
  lockTarget: string | null;
  koTick: number;
  money: number;
  kos: number;
  deaths: number;
  assists: number;
  streak: number;
  /** Curativos comprados na loja (uso com canalização de 2 s: marco 4). */
  curativos: number;
}

export function moveTotalFrames(m: MoveDef): number {
  return m.startup + m.active + m.recovery;
}

export type AttackPhase = 'startup' | 'active' | 'recovery';

export function attackPhase(m: MoveDef, frame: number): AttackPhase {
  if (frame <= m.startup) return 'startup';
  if (frame <= m.startup + m.active) return 'active';
  return 'recovery';
}

/** Vivo = ainda na partida (inclui caído, que pode ser levantado ou finalizado). */
export function isAlive(f: Fighter): boolean {
  return f.state !== 'ko' && f.state !== 'dead';
}

/** De pé e capaz de lutar (não caído). */
export function isStanding(f: Fighter): boolean {
  return isAlive(f) && f.state !== 'downed';
}

/** Pode iniciar uma ação nova sem cancelar nada. */
export function isActionable(f: Fighter): boolean {
  return f.state === 'idle' || f.state === 'block';
}

export function inCancelWindow(f: Fighter): boolean {
  if (f.state !== 'attack' || !f.move?.def.cancelWindow) return false;
  const [a, b] = f.move.def.cancelWindow;
  return f.stateTick >= a && f.stateTick <= b;
}

export function isInvulnerable(f: Fighter, tick: number, c: CombatConstants): boolean {
  if (!isAlive(f)) return true;
  if (tick < f.protectedUntil) return true;
  if (f.state === 'dodge') {
    const [a, b] = c.dodge[f.dodgeKind].iframes;
    return f.stateTick >= a && f.stateTick <= b;
  }
  return f.state === 'getup';
}

/** Hyper-armor parcial: recebe dano reduzido sem ser interrompido. */
export function hasArmor(f: Fighter): boolean {
  if (f.state === 'shout') return true;
  if (f.state === 'charging') return (f.move?.def.armorTicks ?? 0) > 0;
  if (f.state !== 'attack' || !f.move) return false;
  return f.stateTick <= f.move.def.armorTicks && attackPhase(f.move.def, f.stateTick) === 'startup';
}

export function enterState(f: Fighter, state: FighterStateName, duration = 0): void {
  f.state = state;
  f.stateTick = 0;
  f.stateDuration = duration;
  if (state !== 'attack' && state !== 'charging') f.move = null;
}

/** Transições por tempo. Chamado uma vez por tick (fora do hitstop), depois de incrementar stateTick. */
export function timedTransition(f: Fighter, c: CombatConstants): void {
  switch (f.state) {
    case 'attack':
      if (f.move && f.stateTick > moveTotalFrames(f.move.def)) enterState(f, 'idle');
      break;
    case 'dodge':
      if (f.stateTick >= c.dodge[f.dodgeKind].duration) enterState(f, 'idle');
      break;
    case 'shout':
    case 'healing':
    case 'eating':
      if (f.stateTick >= f.stateDuration) enterState(f, 'idle');
      break;
    case 'knockdown':
      if (f.stateTick >= f.stateDuration) enterState(f, 'getup', c.getUpTicks);
      break;
    case 'hitstun':
    case 'blockstun':
    case 'staggered':
    case 'guardbreak':
    case 'getup':
      if (f.stateTick >= f.stateDuration) enterState(f, 'idle');
      break;
    case 'ko':
      if (f.stateTick >= c.koFallTicks) enterState(f, 'dead');
      break;
    default:
      break;
  }
}
