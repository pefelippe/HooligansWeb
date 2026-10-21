import { addMoney, bounty, ECONOMY, streakBonus } from './economy';
import {
  type ActiveMove,
  type BufferedAction,
  type Fighter,
  attackPhase,
  enterState,
  hasArmor,
  inCancelWindow,
  isActionable,
  isAlive,
  isInvulnerable,
  isStanding,
  timedTransition,
} from './fsm';
import { angleDiff, dirFromYaw, dist, hitboxOverlaps, relativeAngleDeg, turnToward, yawTo } from './geometry';
import { Buttons, NEUTRAL_INPUT, type PlayerInput, sanitizeInput } from './input';
import type { CombatData, MoveDef, TeamSide, Vec2 } from './types';
import { TICK_RATE } from './types';
import { DEFAULT_COMBAT_DATA } from './weapons';
import { type GameMap, resolveCircleCollision } from '../map';

// Simulação de combate com tick fixo de 60 Hz. Determinística: mesmo estado + mesmos
// inputs = mesmo resultado. Roda igual no servidor (autoritativo), no cliente
// (predição) e no combat lab. O estado é um objeto JSON simples, mutado no lugar;
// use cloneSim() para predição/rollback.

export interface Sede {
  team: TeamSide;
  /** Spawn (e centro da zona, se não houver área). */
  pos: Vec2;
  /** Interior do galpão: loja, cura e captura. */
  area?: { x: number; z: number; hw: number; hd: number };
}

export interface SimRules {
  /** HP 0 deixa caído (pode ser levantado ou finalizado) em vez de KO direto. */
  downed?: boolean;
}

export interface SimState {
  tick: number;
  fighters: Fighter[];
  sedes: Sede[];
  /** Meia-largura da arena quadrada (m). */
  arenaHalfSize: number;
  /** Tempo de respawn atual (ticks). A partida aumenta conforme avança; lab e testes usam a constante. */
  respawnTicks: number;
  /** Obstáculos do mapa (opcional: o combat lab roda numa arena vazia). Estático. */
  collision?: Pick<GameMap, 'boxes' | 'circles' | 'halfW' | 'halfD'>;
  rules?: SimRules;
}

export type SimEvent =
  | {
      type: 'hit';
      tick: number;
      attacker: string;
      target: string;
      move: string;
      damage: number;
      backstab: boolean;
      armored: boolean;
      knockdown: boolean;
      counter: boolean;
    }
  | { type: 'block'; tick: number; attacker: string; target: string; move: string; chip: number; staminaDrain: number }
  | { type: 'parry'; tick: number; attacker: string; target: string; move: string }
  | { type: 'perfectDodge'; tick: number; attacker: string; target: string; move: string }
  | { type: 'guardbreak'; tick: number; attacker: string; target: string }
  | { type: 'whiff'; tick: number; attacker: string; move: string }
  | { type: 'bleed'; tick: number; target: string; source: string; damage: number }
  | { type: 'weaponBreak'; tick: number; fighter: string; weapon: string; into: string }
  | { type: 'weaponDrop'; tick: number; fighter: string; weapon: string; pos: Vec2 }
  | { type: 'special'; tick: number; fighter: string; move: string }
  | { type: 'shout'; tick: number; fighter: string; buffed: string[] }
  | { type: 'heal'; tick: number; fighter: string; source: 'curativo' | 'carrinho'; amount: number }
  | { type: 'downed'; tick: number; target: string; by: string | null }
  | { type: 'revive'; tick: number; target: string; by: string }
  | { type: 'ko'; tick: number; target: string; killer: string | null; assists: string[] }
  | { type: 'respawn'; tick: number; fighter: string };

export interface NewFighter {
  id: string;
  team: TeamSide;
  pos?: Vec2;
  facing?: number;
  weapon?: string;
}

/** "Nunca aconteceu": tick bem no passado. Finito para o estado sobreviver a JSON (rede/predição). */
export const NEVER = -1e9;

export function createFighter(nf: NewFighter, data: CombatData = DEFAULT_COMBAT_DATA): Fighter {
  const c = data.constants;
  const weapon = nf.weapon ?? 'punhos';
  return {
    id: nf.id,
    team: nf.team,
    pos: { ...(nf.pos ?? { x: 0, z: 0 }) },
    y: 0,
    vy: 0,
    running: false,
    carrying: false,
    vel: { x: 0, z: 0 },
    momentum: 0,
    facing: nf.facing ?? 0,
    moveDir: { x: 0, z: 0 },
    hp: c.maxHp,
    stamina: c.maxStamina,
    lastStaminaSpendTick: NEVER,
    state: 'idle',
    stateTick: 0,
    stateDuration: 0,
    move: null,
    dodgeDir: { x: 0, z: 0 },
    dodgeKind: 'step',
    raca: 0,
    counterUntil: -1,
    buffUntil: -1,
    lastCombatTick: 0,
    cartCooldownUntil: 0,
    downedBy: null,
    reviveTarget: null,
    blockStartTick: NEVER,
    lastBlockEndTick: NEVER,
    parryEligible: false,
    hitstop: 0,
    protectedUntil: 0,
    weapon,
    durability: data.weapons[weapon]?.durabilidade ?? null,
    bleeds: [],
    damagedBy: {},
    prevButtons: 0,
    buffer: null,
    lockTarget: null,
    koTick: NEVER,
    money: ECONOMY.startMoney,
    kos: 0,
    deaths: 0,
    assists: 0,
    streak: 0,
    curativos: c.startCurativos,
  };
}

export function createSim(
  fighters: NewFighter[],
  opts: { sedes?: Sede[]; arenaHalfSize?: number; collision?: SimState['collision']; rules?: SimRules } = {},
  data: CombatData = DEFAULT_COMBAT_DATA,
): SimState {
  return {
    tick: 0,
    fighters: fighters.map((f) => createFighter(f, data)),
    sedes: opts.sedes ?? [],
    arenaHalfSize: opts.arenaHalfSize ?? 40,
    respawnTicks: data.constants.respawnTicks,
    ...(opts.collision ? { collision: opts.collision } : {}),
    ...(opts.rules ? { rules: opts.rules } : {}),
  };
}

/** Ponto de spawn dentro da sede, espalhado pelo índice para ninguém nascer em cima do outro. */
export function spawnPoint(s: SimState, team: TeamSide, index: number): Vec2 {
  const sede = s.sedes.find((sd) => sd.team === team);
  const base = sede ? sede.pos : { x: 0, z: 0 };
  if (sede?.area) {
    // Galpão: grade 5×5 com 1,3 m entre vagas (cabe um time de 25).
    const slot = index % 25;
    return { x: base.x + (Math.floor(slot / 5) - 2) * 1.3, z: base.z + ((slot % 5) - 2) * 1.3 };
  }
  const ang = index * 2.399963; // ângulo áureo
  const r = 0.8 + (index % 4) * 0.7;
  return { x: base.x + Math.cos(ang) * r, z: base.z + Math.sin(ang) * r };
}

export function cloneSim(s: SimState): SimState {
  return structuredClone(s);
}

export function getFighter(s: SimState, id: string): Fighter | undefined {
  return s.fighters.find((f) => f.id === id);
}

export function inSede(s: SimState, f: Fighter, data: CombatData = DEFAULT_COMBAT_DATA): Sede | undefined {
  return s.sedes.find((sd) =>
    sd.area ? Math.abs(f.pos.x - sd.area.x) <= sd.area.hw && Math.abs(f.pos.z - sd.area.z) <= sd.area.hd : dist(sd.pos, f.pos) <= data.constants.sedeRadius,
  );
}

/** Núcleo do spawn de uma sede (onde o inimigo perde vida). */
function inSedeCore(s: SimState, f: Fighter, data: CombatData): Sede | undefined {
  const c = data.constants;
  return s.sedes.find((sd) => dist(sd.pos, f.pos) <= (sd.area ? c.sedeCoreRadius : c.sedeRadius));
}

/** Carrinho de churrasquinho ao alcance (caixas `carrinho` do mapa). */
export function cartInRange(s: SimState, f: Fighter, data: CombatData = DEFAULT_COMBAT_DATA): boolean {
  const r = data.constants.cart.range;
  return !!s.collision?.boxes.some((b) => {
    if (b.kind !== 'carrinho') return false;
    const dx = Math.max(Math.abs(f.pos.x - b.x) - b.hw, 0);
    const dz = Math.max(Math.abs(f.pos.z - b.z) - b.hd, 0);
    return Math.hypot(dx, dz) <= r;
  });
}

/** Aliado caído mais próximo ao alcance para levantar. */
export function downedAllyInRange(s: SimState, f: Fighter, data: CombatData = DEFAULT_COMBAT_DATA): Fighter | undefined {
  const r = data.constants.downed.reviveRange;
  let best: Fighter | undefined;
  let bestD = r;
  for (const o of s.fighters) {
    if (o === f || o.team !== f.team || o.state !== 'downed') continue;
    const d = dist(o.pos, f.pos);
    if (d <= bestD) {
      best = o;
      bestD = d;
    }
  }
  return best;
}

function enemyNear(s: SimState, f: Fighter, ally: Fighter, data: CombatData): boolean {
  const r = data.constants.downed.enemyBlockRange;
  return s.fighters.some((o) => o.team !== f.team && isStanding(o) && (dist(o.pos, f.pos) <= r || dist(o.pos, ally.pos) <= r));
}

/** Levantar aliado só fora de combate: sem dano recente e sem inimigo perto. */
export function canRevive(s: SimState, f: Fighter, ally: Fighter, data: CombatData = DEFAULT_COMBAT_DATA): boolean {
  // lastCombatTick 0 = nunca brigou.
  const fought = f.lastCombatTick > 0 && s.tick - f.lastCombatTick < data.constants.downed.combatLockTicks;
  return !fought && !enemyNear(s, f, ally, data);
}

/** Avança a simulação um tick. Muta `s` e devolve os eventos do tick. */
export function step(s: SimState, inputs: Readonly<Record<string, PlayerInput | undefined>>, data: CombatData = DEFAULT_COMBAT_DATA): SimEvent[] {
  s.tick++;
  const events: SimEvent[] = [];
  for (const f of s.fighters) advance(s, f, data, events);
  for (const f of s.fighters) processInput(s, f, sanitizeInput(inputs[f.id] ?? { ...NEUTRAL_INPUT, aim: f.facing }, f.facing), data, events);
  resolveHits(s, data, events);
  for (const f of s.fighters) endOfTick(s, f, data, events);
  separate(s, data);
  return events;
}

// ---------------------------------------------------------------- avanço de estado

function advance(s: SimState, f: Fighter, data: CombatData, events: SimEvent[]): void {
  const c = data.constants;
  if (f.hitstop > 0) {
    f.hitstop--;
    return;
  }
  // Gravidade (vale em qualquer estado, inclusive para quem cai nocauteado no ar).
  if (f.y > 0 || f.vy > 0) {
    f.vy -= c.gravity / TICK_RATE;
    f.y += f.vy / TICK_RATE;
    if (f.y <= 0) {
      f.y = 0;
      f.vy = 0;
    }
  }
  f.stateTick++;
  // Caído por tempo demais: sangrou até o fim.
  if (f.state === 'downed' && f.stateTick >= f.stateDuration) {
    knockOut(s, f, fighterById(s, f.downedBy), data, events);
    return;
  }
  // Cura canalizada em etapas, antes de o estado terminar (assim a última etapa conta).
  // Interrompido por um acerto = fica o que já curou.
  if (f.state === 'healing' && f.stateTick % c.curativo.interval === 0) heal(s, f, c.curativo.amount, 'curativo', data, events);
  if (f.state === 'eating' && f.stateTick % c.cart.interval === 0) heal(s, f, c.cart.amount, 'carrinho', data, events);
  const wasAttack = f.state === 'attack' ? f.move : null;
  timedTransition(f, c);
  if (wasAttack && f.state !== 'attack' && wasAttack.hitIds.length === 0 && wasAttack.segment === 0) {
    events.push({ type: 'whiff', tick: s.tick, attacker: f.id, move: wasAttack.def.id });
  }
  if (f.state === 'dead' && s.tick - f.koTick >= s.respawnTicks) respawn(s, f, data, events);

  const dt = 1 / TICK_RATE;
  switch (f.state) {
    case 'idle':
      translate(f, f.moveDir, (f.running ? c.runSpeed : c.walkSpeed) * (f.carrying ? c.flag.carrierSpeed : 1) * dt);
      break;
    case 'block':
      translate(f, f.moveDir, c.blockWalkSpeed * dt);
      break;
    case 'charging':
      translate(f, f.moveDir, c.chargeWalkSpeed * dt);
      break;
    case 'healing':
      translate(f, f.moveDir, c.curativo.walkSpeed * dt);
      break;
    case 'downed':
      translate(f, f.moveDir, c.downed.crawlSpeed * dt);
      break;
    case 'attack': {
      const fwd = dirFromYaw(f.facing);
      if (f.move && attackPhase(f.move.def, f.stateTick) !== 'recovery') {
        const frames = f.move.def.startup + f.move.def.active;
        translate(f, fwd, f.move.def.lunge / frames);
      }
      // Golpe saindo da corrida leva o embalo; o input ainda desloca um pouco (dá para bater andando).
      translate(f, fwd, f.momentum * dt);
      f.momentum *= c.runAttack.decay;
      translate(f, f.moveDir, c.attackMoveSpeed * dt);
      break;
    }
    case 'dodge': {
      // Desloca nos frames 2..duration-1 (o 1º é a entrada; no último o estado já termina).
      const d = c.dodge[f.dodgeKind];
      translate(f, f.dodgeDir, d.distance / Math.max(1, d.duration - 2));
      break;
    }
    default:
      break;
  }
  if (f.state !== 'attack') f.momentum = 0;
  f.pos.x += f.vel.x * dt;
  f.pos.z += f.vel.z * dt;
  f.vel.x *= c.knockbackFriction;
  f.vel.z *= c.knockbackFriction;
  const h = s.arenaHalfSize;
  f.pos.x = Math.max(-h, Math.min(h, f.pos.x));
  f.pos.z = Math.max(-h, Math.min(h, f.pos.z));
}

function heal(s: SimState, f: Fighter, amount: number, source: 'curativo' | 'carrinho', data: CombatData, events: SimEvent[]): void {
  const before = f.hp;
  f.hp = Math.min(data.constants.maxHp, f.hp + amount);
  if (f.hp > before) events.push({ type: 'heal', tick: s.tick, fighter: f.id, source, amount: f.hp - before });
}

function translate(f: Fighter, dir: Vec2, amount: number): void {
  f.pos.x += dir.x * amount;
  f.pos.z += dir.z * amount;
}

function fighterById(s: SimState, id: string | null): Fighter | null {
  return id ? (s.fighters.find((o) => o.id === id) ?? null) : null;
}

function respawn(s: SimState, f: Fighter, data: CombatData, events: SimEvent[]): void {
  const c = data.constants;
  f.pos = spawnPoint(s, f.team, s.fighters.indexOf(f));
  f.vel = { x: 0, z: 0 };
  f.momentum = 0;
  f.y = 0;
  f.vy = 0;
  f.hp = c.maxHp;
  f.stamina = c.maxStamina;
  f.protectedUntil = s.tick + c.spawnProtectionTicks;
  f.lastCombatTick = s.tick;
  f.buffer = null;
  f.downedBy = null;
  f.curativos = Math.max(f.curativos, c.startCurativos);
  enterState(f, 'idle');
  events.push({ type: 'respawn', tick: s.tick, fighter: f.id });
}

// ---------------------------------------------------------------- input

const ACTION_BUTTONS: [BufferedAction, number][] = [
  ['dodge', Buttons.DODGE],
  ['special', Buttons.SPECIAL],
  ['shout', Buttons.SHOUT],
  ['heal', Buttons.HEAL],
  ['shove', Buttons.SHOVE],
  ['kick', Buttons.KICK],
  ['heavy', Buttons.HEAVY],
  ['light', Buttons.LIGHT],
];

function processInput(s: SimState, f: Fighter, input: PlayerInput, data: CombatData, events: SimEvent[]): void {
  const c = data.constants;
  const pressed = input.buttons & ~f.prevButtons;
  const held = input.buttons;
  f.prevButtons = input.buttons;
  if (!isAlive(f)) {
    f.moveDir = { x: 0, z: 0 };
    return;
  }
  f.moveDir = { x: input.moveX, z: input.moveZ };
  if (f.state === 'downed') {
    // Caído: só rasteja.
    f.running = false;
    if (Math.hypot(input.moveX, input.moveZ) > 0.1) f.facing = Math.atan2(input.moveX, input.moveZ);
    return;
  }

  for (const [action, bit] of ACTION_BUTTONS) {
    if (pressed & bit) {
      f.buffer = { action, tick: s.tick };
      break;
    }
  }
  // O buffer não envelhece durante o hitstop (apertar no impacto ainda vale depois dele).
  if (f.hitstop > 0 && f.buffer && f.buffer.tick < s.tick) f.buffer.tick++;
  if (f.buffer && s.tick - f.buffer.tick > c.inputBufferTicks) f.buffer = null;

  if (pressed & Buttons.LOCK) f.lockTarget = f.lockTarget ? null : findLockTarget(s, f, input.aim, data);
  else if (pressed & Buttons.LOCK_NEXT) f.lockTarget = nextLockTarget(s, f, input.aim, data);
  const target = f.lockTarget ? s.fighters.find((o) => o.id === f.lockTarget) : undefined;
  if (f.lockTarget && (!target || !isAlive(target) || dist(target.pos, f.pos) > c.lockOnRange * 1.25)) f.lockTarget = null;
  const desiredYaw = target && f.lockTarget ? yawTo(f.pos, target.pos) : input.aim;

  if (f.hitstop > 0) return;
  const grounded = f.y <= 0 && f.vy <= 0;
  const moving = Math.hypot(input.moveX, input.moveZ) > 0.1;
  f.running = f.state === 'idle' && moving && !!(held & Buttons.RUN) && f.stamina >= 1;

  switch (f.state) {
    case 'idle':
      // Correndo, o corpo vira para onde está indo; andando, para onde mira.
      f.facing = f.running && !f.lockTarget ? Math.atan2(input.moveX, input.moveZ) : desiredYaw;
      if (f.running) {
        f.stamina = Math.max(0, f.stamina - c.runStaminaPerTick);
        f.lastStaminaSpendTick = s.tick;
      }
      if (pressed & Buttons.JUMP && grounded && spendStamina(s, f, c.jumpStaminaCost)) {
        f.vy = c.jumpVelocity;
      } else if (pressed & Buttons.USE && grounded && tryUse(s, f, data)) {
        // levantar aliado ou comer no carrinho
      } else if (f.buffer && tryStart(s, f, f.buffer.action, data, events)) f.buffer = null;
      else if (held & Buttons.BLOCK && grounded) enterBlock(s, f, data);
      break;
    case 'block':
      f.facing = desiredYaw;
      if (f.buffer && tryStart(s, f, f.buffer.action, data, events)) f.buffer = null;
      else if (!(held & Buttons.BLOCK)) {
        f.lastBlockEndTick = s.tick;
        enterState(f, 'idle');
      }
      break;
    case 'blockstun': {
      // Contra-ataque do bloqueio: leve cancela o blockstun pagando estamina extra.
      const first = weaponOf(f, data).moves.light[0];
      if (f.buffer?.action === 'light' && first && f.stamina >= c.blockCounterCost + first.staminaCost) {
        spendStamina(s, f, c.blockCounterCost);
        if (startAttack(s, f, first, 0, data)) {
          f.facing = desiredYaw;
          f.buffer = null;
        }
      }
      break;
    }
    case 'charging': {
      f.facing = desiredYaw;
      const m = f.move;
      if (!m) break;
      if (f.buffer?.action === 'dodge' && tryStart(s, f, 'dodge', data, events)) {
        f.buffer = null;
        break;
      }
      const maxCharge = m.def.chargeTicks ?? 0;
      if (!(held & Buttons.HEAVY) || f.stateTick >= maxCharge) {
        m.charge = maxCharge > 0 ? Math.min(1, f.stateTick / maxCharge) : 0;
        startAttack(s, f, m.def, -1, data, m.charge, false);
      }
      break;
    }
    case 'attack': {
      const m = f.move;
      if (!m) break;
      const phase = attackPhase(m.def, f.stateTick);
      // Com alvo travado, o corpo gruda nele no startup e no ativo; sem trava, gira devagar.
      if (f.lockTarget && phase !== 'recovery') f.facing = desiredYaw;
      else if (f.lockTarget || phase !== 'recovery') f.facing = turnToward(f.facing, desiredYaw, c.attackTurnRate);
      if (f.buffer) {
        const a = f.buffer.action;
        if (a === 'light' && inCancelWindow(f)) {
          const next = weaponOf(f, data).moves.light[m.chainIndex + 1];
          if (next && m.def.canChainInto.includes(next.id) && startAttack(s, f, next, m.chainIndex + 1, data)) {
            f.facing = desiredYaw;
            f.buffer = null;
          }
        } else if ((a === 'dodge' || a === 'special') && tryStart(s, f, a, data, events)) {
          f.buffer = null;
        }
      }
      // Leve na recuperação: segurar bloqueio cancela direto na guarda.
      if (f.state === 'attack' && phase === 'recovery' && m.def.kind === 'light' && held & Buttons.BLOCK && grounded) enterBlock(s, f, data);
      break;
    }
    case 'reviving': {
      const ally = fighterById(s, f.reviveTarget);
      const ok = ally && ally.state === 'downed' && dist(ally.pos, f.pos) <= c.downed.reviveRange * 1.2 && held & Buttons.USE && !enemyNear(s, f, ally, data);
      if (!ok || !ally) {
        f.reviveTarget = null;
        enterState(f, 'idle');
        break;
      }
      f.facing = yawTo(f.pos, ally.pos);
      if (f.stateTick >= c.downed.reviveTicks) {
        ally.hp = c.downed.reviveHp;
        ally.downedBy = null;
        ally.protectedUntil = s.tick + c.downed.reviveProtection;
        ally.lastCombatTick = s.tick;
        enterState(ally, 'getup', c.getUpTicks);
        f.money = addMoney(f.money, c.downed.reviveMoney);
        addRaca(f, c.raca.revive, data);
        f.reviveTarget = null;
        enterState(f, 'idle');
        events.push({ type: 'revive', tick: s.tick, target: ally.id, by: f.id });
      }
      break;
    }
    default:
      break;
  }
}

function lockCandidates(s: SimState, f: Fighter, data: CombatData): Fighter[] {
  return s.fighters.filter((o) => o.team !== f.team && isAlive(o) && o.state !== 'downed' && dist(o.pos, f.pos) <= data.constants.lockOnRange);
}

/** Alvo do lock-on: o inimigo mais perto da direção da mira (dentro do cone); senão, o mais próximo. */
function findLockTarget(s: SimState, f: Fighter, aim: number, data: CombatData): string | null {
  const c = data.constants;
  const cands = lockCandidates(s, f, data);
  const off = (o: Fighter) => Math.abs(angleDiff(yawTo(f.pos, o.pos), aim));
  const near = (a: Fighter, b: Fighter) => dist(a.pos, f.pos) - dist(b.pos, f.pos);
  const inCone = cands.filter((o) => off(o) <= (c.lockOnConeDeg * Math.PI) / 180);
  const pick = inCone.length ? inCone.sort((a, b) => off(a) - off(b) || near(a, b))[0] : cands.sort(near)[0];
  return pick?.id ?? null;
}

/** Troca de alvo: o próximo inimigo no sentido horário a partir do alvo atual (ou da mira). */
function nextLockTarget(s: SimState, f: Fighter, aim: number, data: CombatData): string | null {
  const cur = f.lockTarget ? s.fighters.find((o) => o.id === f.lockTarget) : undefined;
  const from = cur ? yawTo(f.pos, cur.pos) : aim;
  const cands = lockCandidates(s, f, data).filter((o) => o.id !== f.lockTarget);
  if (!cands.length) return f.lockTarget;
  const cw = (o: Fighter) => {
    const d = angleDiff(yawTo(f.pos, o.pos), from);
    return d > 0 ? d : d + 2 * Math.PI;
  };
  return cands.sort((a, b) => cw(a) - cw(b))[0]?.id ?? null;
}

function weaponOf(f: Fighter, data: CombatData) {
  // Com o bandeirão nas mãos, só dá para brigar de punhos.
  const w = (f.carrying ? undefined : data.weapons[f.weapon]) ?? data.weapons.punhos;
  if (!w) throw new Error('arma "punhos" ausente dos dados de combate');
  return w;
}

function spendStamina(s: SimState, f: Fighter, cost: number): boolean {
  if (f.stamina < cost) return false;
  f.stamina -= cost;
  f.lastStaminaSpendTick = s.tick;
  return true;
}

function addRaca(f: Fighter, amount: number, data: CombatData): void {
  f.raca = Math.max(0, Math.min(data.constants.raca.max, f.raca + amount));
}

function enterBlock(s: SimState, f: Fighter, data: CombatData): void {
  const c = data.constants;
  // Entrar no bloqueio custa estamina; sem estamina ainda dá para bloquear (e levar guard break).
  f.stamina = Math.max(0, f.stamina - c.blockEnterCost);
  f.lastStaminaSpendTick = s.tick;
  f.parryEligible = s.tick - f.lastBlockEndTick > c.parryLockout;
  enterState(f, 'block');
  f.blockStartTick = s.tick;
}

/** X: levantar aliado caído (prioridade) ou comer no carrinho de churrasquinho. */
function tryUse(s: SimState, f: Fighter, data: CombatData): boolean {
  const c = data.constants;
  const ally = s.rules?.downed ? downedAllyInRange(s, f, data) : undefined;
  if (ally && canRevive(s, f, ally, data)) {
    enterState(f, 'reviving', c.downed.reviveTicks);
    f.stateTick = 1;
    f.reviveTarget = ally.id;
    return true;
  }
  if (cartInRange(s, f, data) && s.tick >= f.cartCooldownUntil && f.money >= c.cart.cost && f.hp < c.maxHp) {
    f.money -= c.cart.cost;
    f.cartCooldownUntil = s.tick + c.cart.cooldown;
    enterState(f, 'eating', c.cart.ticks);
    f.stateTick = 1;
    return true;
  }
  return false;
}

function tryStart(s: SimState, f: Fighter, action: BufferedAction, data: CombatData, events: SimEvent[]): boolean {
  // Esquiva cancela a recuperação de qualquer golpe.
  const recoveryDodge = action === 'dodge' && f.state === 'attack' && !!f.move && attackPhase(f.move.def, f.stateTick) === 'recovery';
  if (!isActionable(f) && !(f.state === 'attack' && inCancelWindow(f)) && f.state !== 'charging' && !recoveryDodge) return false;
  const c = data.constants;
  const w = weaponOf(f, data);
  const airborne = f.y > 0;
  switch (action) {
    case 'light': {
      const first = w.moves.light[0];
      return first ? startAttack(s, f, first, 0, data) : false;
    }
    case 'heavy': {
      const def = w.moves.heavy;
      if (!spendStamina(s, f, def.staminaCost)) return false;
      f.protectedUntil = 0;
      enterState(f, 'charging');
      f.stateTick = 1;
      f.move = newMove(def, -1);
      return true;
    }
    case 'kick':
      // No ar o chute vira voadora.
      return startAttack(s, f, airborne ? data.common.voadora : data.common.kick, -1, data);
    case 'shove': {
      // Inimigo atordoado na frente: cabeçada em vez de empurrão.
      const dazed = s.fighters.find(
        (o) =>
          o.team !== f.team &&
          (o.state === 'staggered' || o.state === 'guardbreak') &&
          dist(o.pos, f.pos) <= c.headbuttRange &&
          relativeAngleDeg(f.pos, f.facing, o.pos) <= 60,
      );
      return startAttack(s, f, dazed ? data.common.cabecada : data.common.shove, -1, data);
    }
    case 'special': {
      if (f.carrying || f.raca < c.raca.specialCost) return false;
      if (!startAttack(s, f, w.moves.special, -1, data)) return false;
      f.raca -= c.raca.specialCost;
      events.push({ type: 'special', tick: s.tick, fighter: f.id, move: w.moves.special.id });
      return true;
    }
    case 'shout': {
      if (airborne || f.raca < c.raca.shoutCost) return false;
      f.raca -= c.raca.shoutCost;
      f.protectedUntil = 0;
      enterState(f, 'shout', c.shout.duration);
      f.stateTick = 1;
      const buffed: string[] = [];
      for (const o of s.fighters) {
        if (o.team !== f.team || !isStanding(o) || dist(o.pos, f.pos) > c.shout.radius) continue;
        o.buffUntil = s.tick + c.shout.buffTicks;
        buffed.push(o.id);
      }
      events.push({ type: 'shout', tick: s.tick, fighter: f.id, buffed });
      return true;
    }
    case 'heal': {
      if (airborne || f.curativos <= 0 || (f.hp >= c.maxHp && f.bleeds.length === 0)) return false;
      f.curativos--;
      f.bleeds = []; // o curativo estanca o sangramento
      enterState(f, 'healing', c.curativo.ticks);
      f.stateTick = 1;
      return true;
    }
    case 'dodge': {
      if (airborne) return false;
      // Correndo: rolamento longo; senão: passo curto e barato.
      const kind = f.running || f.prevButtons & Buttons.RUN ? 'roll' : 'step';
      const d = c.dodge[kind];
      if (!spendStamina(s, f, d.staminaCost)) return false;
      const len = Math.hypot(f.moveDir.x, f.moveDir.z);
      // Sem direção: para trás.
      const back = dirFromYaw(f.facing);
      f.dodgeDir = len > 0.1 ? { x: f.moveDir.x / len, z: f.moveDir.z / len } : { x: -back.x, z: -back.z };
      f.dodgeKind = kind;
      enterState(f, 'dodge');
      f.stateTick = 1;
      return true;
    }
  }
}

function newMove(def: MoveDef, chainIndex: number, charge = 0): ActiveMove {
  return { def, chainIndex, charge, hitIds: [], dodgedIds: [], segment: 0 };
}

function startAttack(s: SimState, f: Fighter, def: MoveDef, chainIndex: number, data: CombatData, charge = 0, payStamina = true): boolean {
  if (payStamina && !spendStamina(s, f, def.staminaCost)) return false;
  // Saindo da corrida: o golpe leva o embalo (numa corrente, o embalo que sobrou continua).
  if (f.running) f.momentum = data.constants.runSpeed * data.constants.runAttack.momentum;
  f.running = false;
  f.protectedUntil = 0; // atacar cancela a proteção de spawn
  enterState(f, 'attack');
  f.stateTick = 1;
  f.move = newMove(def, chainIndex, charge);
  return true;
}

// ---------------------------------------------------------------- acertos

interface PendingHit {
  attacker: Fighter;
  target: Fighter;
  move: ActiveMove;
}

function resolveHits(s: SimState, data: CombatData, events: SimEvent[]): void {
  const c = data.constants;
  // Coleta antes de aplicar: dois golpes ativos no mesmo tick trocam (trade) em vez de
  // depender da ordem dos jogadores no array.
  const pending: PendingHit[] = [];
  for (const a of s.fighters) {
    const m = a.move;
    if (a.state !== 'attack' || !m || attackPhase(m.def, a.stateTick) !== 'active') continue;
    if (m.def.multiHit) {
      // Cada segmento do active é um acerto novo.
      const seg = Math.floor((a.stateTick - m.def.startup - 1) / m.def.multiHit.interval);
      if (seg !== m.segment) {
        m.segment = seg;
        m.hitIds = [];
      }
    }
    for (const t of s.fighters) {
      if (t === a || t.team === a.team || m.hitIds.includes(t.id) || !isAlive(t)) continue;
      if (m.def.low && t.y > c.kickMaxTargetHeight) continue; // pulou o golpe baixo
      if (!hitboxOverlaps(m.def.hitbox, a.pos, a.facing, t.pos, c.hurtRadius)) continue;
      if (isInvulnerable(t, s.tick, c)) {
        // Esquiva perfeita: o golpe passou pelos i-frames logo no começo da esquiva.
        if (t.state === 'dodge' && t.stateTick <= c.dodge.perfectWindow && !m.dodgedIds.includes(t.id)) {
          m.dodgedIds.push(t.id);
          t.stamina = Math.min(c.maxStamina, t.stamina + c.dodge.perfectStaminaRefund);
          t.counterUntil = s.tick + c.counter.window;
          addRaca(t, c.raca.perfectDodge, data);
          events.push({ type: 'perfectDodge', tick: s.tick, attacker: a.id, target: t.id, move: m.def.id });
        }
        continue;
      }
      pending.push({ attacker: a, target: t, move: m });
    }
  }
  for (const p of pending) applyHit(s, p, data, events);
}

function applyHit(s: SimState, { attacker: a, target: t, move: m }: PendingHit, data: CombatData, events: SimEvent[]): void {
  const c = data.constants;
  if (!isAlive(t)) return;
  m.hitIds.push(t.id);
  const def = m.def;
  const facingTarget = relativeAngleDeg(t.pos, t.facing, a.pos) <= c.blockHalfAngleDeg;
  const pushDir = dirFromYaw(yawTo(a.pos, t.pos));
  a.lastCombatTick = t.lastCombatTick = s.tick;

  // Finalização: golpes inimigos tiram da vida de caído; zerou, é KO (crédito de quem derrubou).
  if (t.state === 'downed') {
    const dmg = rawDamage(a, t, m, s.tick, data).damage;
    t.hp -= dmg;
    t.damagedBy[a.id] = s.tick;
    a.hitstop = t.hitstop = def.hitstop;
    events.push({ type: 'hit', tick: s.tick, attacker: a.id, target: t.id, move: def.id, damage: dmg, backstab: false, armored: false, knockdown: false, counter: false });
    if (t.hp <= 0) knockOut(s, t, fighterById(s, t.downedBy) ?? a, data, events);
    return;
  }

  if (t.state === 'block' && facingTarget && !def.unblockable) {
    if (def.breaksGuard) {
      guardBreak(s, a, t, data, events);
      t.vel = { x: pushDir.x * def.knockback, z: pushDir.z * def.knockback };
      return;
    }
    if (t.parryEligible && s.tick - t.blockStartTick <= c.parryWindow) {
      enterState(a, 'staggered', c.parryStagger);
      a.hitstop = c.parryHitstop;
      t.hitstop = c.parryHitstop;
      t.stamina = Math.min(c.maxStamina, t.stamina + c.parryStaminaRefund);
      t.counterUntil = s.tick + c.counter.window;
      addRaca(t, c.raca.parry, data);
      events.push({ type: 'parry', tick: s.tick, attacker: a.id, target: t.id, move: def.id });
      return;
    }
    const tw = weaponOf(t, data);
    const raw = rawDamage(a, t, m, s.tick, data).damage;
    // Bloquear faca/caco de mão vazia corta a mão.
    const bareCut = !!def.bleed && tw.id === 'punhos';
    const chip = raw * (1 - tw.blockAbsorb) * (bareCut ? c.bareHandCutChipMultiplier : 1);
    const drain = (def.damage * c.blockStaminaPerDamage * (def.guardDamage ?? 1)) / tw.blockStability;
    t.stamina -= drain;
    t.lastStaminaSpendTick = s.tick;
    t.hp -= chip;
    if (bareCut) addBleed(t, a.id, data);
    if (chip > 0) t.damagedBy[a.id] = s.tick;
    addRaca(t, c.raca.block, data);
    a.hitstop = t.hitstop = Math.max(2, def.hitstop - 2);
    t.vel = { x: pushDir.x * def.knockback * 0.5, z: pushDir.z * def.knockback * 0.5 };
    events.push({ type: 'block', tick: s.tick, attacker: a.id, target: t.id, move: def.id, chip, staminaDrain: drain });
    wearWeapon(s, a, data, events);
    if (t.stamina <= 0) {
      t.stamina = 0;
      guardBreak(s, a, t, data, events);
    } else {
      enterState(t, 'blockstun', def.blockstun);
    }
    if (t.hp <= 0) lethal(s, t, a, data, events);
    return;
  }

  const { damage, backstab, counter } = rawDamage(a, t, m, s.tick, data);
  if (counter) a.counterUntil = -1; // o contra-golpe vale um acerto
  const armored = hasArmor(t);
  const dealt = armored ? damage * c.armorDamageMultiplier : damage;
  t.hp -= dealt;
  t.damagedBy[a.id] = s.tick;
  addRaca(a, dealt * c.raca.perDamageDealt, data);
  addRaca(t, dealt * c.raca.perDamageTaken, data);
  a.hitstop = t.hitstop = def.hitstop;
  a.money = addMoney(a.money, ECONOMY.hit);

  const lastSegment = def.multiHit ? Math.floor((def.active - 1) / def.multiHit.interval) : 0;
  const finalBlow = !!def.multiHit?.finalKnockdown && m.segment === lastSegment;
  const knockdown = !armored && (!!def.knockdown || finalBlow);
  if (!armored) {
    t.vel = { x: pushDir.x * def.knockback, z: pushDir.z * def.knockback };
    if (knockdown) enterState(t, 'knockdown', c.knockdownTicks);
    else if (def.stunTicks) enterState(t, 'staggered', def.stunTicks);
    else enterState(t, 'hitstun', counter ? Math.max(def.hitstun, c.counter.minHitstun) : def.hitstun);
  }
  if (def.bleed) for (let i = 0; i < (def.bleedStacks ?? 1); i++) addBleed(t, a.id, data);
  events.push({ type: 'hit', tick: s.tick, attacker: a.id, target: t.id, move: def.id, damage: dealt, backstab, armored, knockdown, counter });
  wearWeapon(s, a, data, events);
  if (t.hp <= 0) lethal(s, t, a, data, events);
}

function rawDamage(a: Fighter, t: Fighter, m: ActiveMove, tick: number, data: CombatData): { damage: number; backstab: boolean; counter: boolean } {
  const c = data.constants;
  const def = m.def;
  let dmg = def.damage * (1 + (def.chargeDamageBonus ?? 0) * m.charge);
  const backstab = !!def.backstabMultiplier && (!!def.alwaysBackstab || relativeAngleDeg(t.pos, t.facing, a.pos) >= c.backstabMinAngleDeg);
  if (backstab) dmg *= def.backstabMultiplier ?? 1;
  const counter = tick <= a.counterUntil;
  if (counter) dmg *= c.counter.damageMultiplier;
  if (tick <= a.buffUntil) dmg *= 1 + c.shout.damageBonus;
  if (t.carrying) dmg *= c.flag.carrierDamageTaken; // quem carrega o bandeirão aguenta mais
  return { damage: dmg * gankMultiplier(t, a.id, tick, data), backstab, counter };
}

/** Anti-gank leve: quanto mais atacantes distintos recentes, menos dano cada golpe causa. */
export function gankMultiplier(t: Fighter, attackerId: string, now: number, data: CombatData): number {
  const c = data.constants;
  let n = 0;
  for (const [id, tick] of Object.entries(t.damagedBy)) {
    if (id !== attackerId && now - tick <= c.gankWindow) n++;
  }
  const mults = c.gankMultipliers;
  return mults[Math.min(n, mults.length - 1)] ?? 1;
}

function guardBreak(s: SimState, a: Fighter, t: Fighter, data: CombatData, events: SimEvent[]): void {
  enterState(t, 'guardbreak', data.constants.guardBreakTicks);
  events.push({ type: 'guardbreak', tick: s.tick, attacker: a.id, target: t.id });
}

function addBleed(t: Fighter, sourceId: string, data: CombatData): void {
  const b = data.constants.bleed;
  if (t.bleeds.length >= b.maxStacks) t.bleeds.shift();
  t.bleeds.push({ ticksLeft: b.duration, sourceId });
}

function wearWeapon(s: SimState, f: Fighter, data: CombatData, events: SimEvent[]): void {
  if (f.durability === null) return;
  f.durability--;
  if (f.durability > 0) return;
  const old = weaponOf(f, data);
  const into = old.quebraEm ?? 'punhos';
  f.weapon = into;
  f.durability = data.weapons[into]?.durabilidade ?? null;
  events.push({ type: 'weaponBreak', tick: s.tick, fighter: f.id, weapon: old.id, into });
}

/** HP chegou a 0: fica caído (se a regra estiver ligada) ou nocaute direto. */
function lethal(s: SimState, t: Fighter, killer: Fighter | null, data: CombatData, events: SimEvent[]): void {
  if (!s.rules?.downed || t.state === 'downed') {
    knockOut(s, t, killer, data, events);
    return;
  }
  t.hp = data.constants.downed.hp;
  enterState(t, 'downed', data.constants.downed.ticks);
  t.downedBy = killer?.id ?? null;
  t.vel = { x: 0, z: 0 };
  t.bleeds = [];
  t.buffer = null;
  t.lockTarget = null;
  t.running = false;
  events.push({ type: 'downed', tick: s.tick, target: t.id, by: killer?.id ?? null });
}

function knockOut(s: SimState, t: Fighter, killer: Fighter | null, data: CombatData, events: SimEvent[]): void {
  const c = data.constants;
  t.hp = 0;
  enterState(t, 'ko');
  t.koTick = s.tick;
  t.vel = { x: 0, z: 0 };
  t.deaths++;
  const victimStreak = t.streak;
  t.streak = 0;
  t.money = addMoney(t.money, ECONOMY.deathConsolation);
  t.raca *= c.raca.keepOnKo;
  t.bleeds = [];
  t.lockTarget = null;
  t.buffer = null;
  t.downedBy = null;
  t.buffUntil = -1;
  t.counterUntil = -1;
  if (t.weapon !== 'punhos') {
    events.push({ type: 'weaponDrop', tick: s.tick, fighter: t.id, weapon: t.weapon, pos: { ...t.pos } });
    t.weapon = 'punhos';
    t.durability = null;
  }
  const assists: string[] = [];
  for (const [id, tick] of Object.entries(t.damagedBy)) {
    if (id === killer?.id || s.tick - tick > c.assistWindow) continue;
    const helper = s.fighters.find((o) => o.id === id);
    if (!helper || helper.team === t.team) continue;
    helper.assists++;
    helper.money = addMoney(helper.money, ECONOMY.assist);
    assists.push(id);
  }
  t.damagedBy = {};
  if (killer) {
    killer.kos++;
    killer.streak++;
    killer.money = addMoney(killer.money, ECONOMY.ko + streakBonus(killer.streak) + bounty(victimStreak));
  }
  events.push({ type: 'ko', tick: s.tick, target: t.id, killer: killer?.id ?? null, assists });
}

// ---------------------------------------------------------------- fim do tick

function endOfTick(s: SimState, f: Fighter, data: CombatData, events: SimEvent[]): void {
  const c = data.constants;
  if (!isStanding(f)) return;

  if (f.bleeds.length > 0) {
    for (const b of f.bleeds) {
      b.ticksLeft--;
      if (b.ticksLeft % c.bleed.interval === 0) {
        f.hp -= c.bleed.damagePerInterval;
        f.lastCombatTick = s.tick;
        events.push({ type: 'bleed', tick: s.tick, target: f.id, source: b.sourceId, damage: c.bleed.damagePerInterval });
      }
    }
    const last = f.bleeds[f.bleeds.length - 1];
    f.bleeds = f.bleeds.filter((b) => b.ticksLeft > 0);
    if (f.hp <= 0) {
      lethal(s, f, last ? fighterById(s, last.sourceId) : null, data, events);
      return;
    }
  }

  const core = inSedeCore(s, f, data);
  const sede = inSede(s, f, data);
  if (core && core.team !== f.team && s.tick >= f.protectedUntil) {
    f.hp -= c.sedeEnemyDamagePerTick;
    if (f.hp <= 0) {
      lethal(s, f, null, data, events);
      return;
    }
  } else if (sede && sede.team === f.team) {
    f.hp = Math.min(c.maxHp, f.hp + c.sedeHealPerTick);
  }

  // Fôlego: fora de combate por um tempo, recupera devagar até o teto.
  if (s.tick - f.lastCombatTick >= c.breath.delay && f.hp < c.breath.cap) {
    f.hp = Math.min(c.breath.cap, f.hp + c.breath.perTick);
  }

  if (s.tick - f.lastStaminaSpendTick >= c.staminaRegenDelay && f.state !== 'guardbreak') {
    let rate = f.state === 'block' ? c.staminaRegenPerTickBlocking : c.staminaRegenPerTick;
    if (s.tick <= f.buffUntil) rate *= c.shout.staminaRegenMultiplier;
    f.stamina = Math.min(c.maxStamina, f.stamina + rate);
  }
}

/** Empurra lutadores sobrepostos (corpo a corpo, sem passar por dentro). */
function separate(s: SimState, data: CombatData): void {
  const minD = data.constants.hurtRadius * 2;
  const fs = s.fighters;
  for (let i = 0; i < fs.length; i++) {
    const a = fs[i];
    if (!a || !isStanding(a) || a.state === 'dodge') continue;
    for (let j = i + 1; j < fs.length; j++) {
      const b = fs[j];
      if (!b || !isStanding(b) || b.state === 'dodge') continue;
      const d = dist(a.pos, b.pos);
      if (d >= minD) continue;
      const nx = d > 1e-6 ? (b.pos.x - a.pos.x) / d : 1;
      const nz = d > 1e-6 ? (b.pos.z - a.pos.z) / d : 0;
      const push = (minD - d) / 2;
      a.pos.x -= nx * push;
      a.pos.z -= nz * push;
      b.pos.x += nx * push;
      b.pos.z += nz * push;
    }
  }
  if (s.collision) {
    for (const f of fs) if (isAlive(f)) resolveCircleCollision(f.pos, data.constants.hurtRadius, s.collision);
  }
}
