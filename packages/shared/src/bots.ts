import { attackPhase, isAlive } from './combat/fsm';
import { dist, yawTo } from './combat/geometry';
import { Buttons, type PlayerInput } from './combat/input';
import { canBuy, CURATIVO } from './combat/shop';
import { canRevive, downedAllyInRange, inSede } from './combat/sim';
import type { Vec2 } from './combat/types';
import { DEFAULT_COMBAT_DATA } from './combat/weapons';
import { inRect, MAP_HALF_W } from './map';
import { type ControlPointState, type MatchState, matchBuy } from './match';
import { nextRandom } from './rng';

// IA simples com máquina de estados: perseguir, atacar, bloquear ao ver um startup,
// recuar com HP baixo e comprar arma na sede. Serve para completar vagas e para teste de carga.

export type BotMode = 'perseguir' | 'atacar' | 'recuar';
/** Papel no bandeirão: atacante busca o bandeirão rival, defensor guarda o próprio, caçador briga no meio. */
export type BotRole = 'atacante' | 'defensor' | 'cacador';

export interface BotBrain {
  id: string;
  mode: BotMode;
  rng: { seed: number };
  targetId: string | null;
  /** Reação humana: decide bloquear/esquivar com atraso de alguns ticks. */
  reactAt: number;
  reaction: 'block' | 'dodge' | null;
  lastPos: Vec2;
  stuckTicks: number;
  strafe: number;
  /** Cada bot tem um "estilo": agressividade em [0,1]. */
  aggression: number;
  /** Ordem de preferência de armas para comprar. */
  wishlist: string[];
  /** Habilidade de defesa em [0,1]: chance de reagir a um golpe vindo. */
  defense: number;
  /** Último golpe inimigo já avaliado (decide reagir uma vez por golpe). */
  seenAttack: string;
  heldBlock: boolean;
  role: BotRole;
  /** Rota do atacante (z da rua usada para atravessar o estacionamento). */
  lane: number;
  /** Ponto de controle preferido (0 = A, 1 = B, 2 = C): espalha o time pelos três. */
  pointPref: number;
}

const WISHLISTS = [
  ['taco', 'cassetete', 'soqueira'],
  ['faca', 'soqueira', 'garrafa'],
  ['barra', 'cassetete', 'soqueira'],
  ['punhal', 'faca', 'garrafa'],
  ['cassetete', 'soqueira', 'garrafa'],
];

export function createBrain(id: string, seed: number): BotBrain {
  const rng = { seed };
  return {
    id,
    mode: 'perseguir',
    rng,
    targetId: null,
    reactAt: -1,
    reaction: null,
    lastPos: { x: 0, z: 0 },
    stuckTicks: 0,
    strafe: 0,
    aggression: 0.35 + nextRandom(rng) * 0.6,
    wishlist: WISHLISTS[Math.floor(nextRandom(rng) * WISHLISTS.length)] ?? ['soqueira'],
    heldBlock: false,
    defense: 0.4 + nextRandom(rng) * 0.45,
    seenAttack: '',
    // Papel pela vaga (seed % 10): 5 atacantes, 2 defensores, 3 caçadores, igual nos dois times.
    role: seed % 10 < 5 ? 'atacante' : seed % 10 < 7 ? 'defensor' : 'cacador',
    lane: [-25, 0, 25][seed % 3] ?? 0,
    pointPref: Math.floor(seed / 3) % 3,
  };
}

export function botInput(m: MatchState, brain: BotBrain): PlayerInput {
  const s = m.sim;
  const self = s.fighters.find((f) => f.id === brain.id);
  const idle: PlayerInput = { moveX: 0, moveZ: 0, aim: self?.facing ?? 0, buttons: 0 };
  if (!self || !isAlive(self)) return idle;
  const rand = () => nextRandom(brain.rng);
  const c = DEFAULT_COMBAT_DATA.constants;
  const mySede = s.sedes.find((sd) => sd.team === self.team)?.pos ?? { x: 0, z: 0 };
  const inMySede = inSede(s, self)?.team === self.team;

  // Caído: rasteja na direção do aliado mais próximo.
  if (self.state === 'downed') {
    const ally = s.fighters
      .filter((f) => f.team === self.team && f !== self && f.state !== 'downed' && isAlive(f))
      .sort((a, b) => dist(a.pos, self.pos) - dist(b.pos, self.pos))[0];
    if (!ally) return idle;
    const dx = ally.pos.x - self.pos.x;
    const dz = ally.pos.z - self.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    return { moveX: dx / len, moveZ: dz / len, aim: self.facing, buttons: 0 };
  }

  // Compra na sede: arma quando está de punhos, depois um curativo se sobrar dinheiro.
  if (inMySede && self.weapon === 'punhos') {
    for (const w of brain.wishlist) {
      if (canBuy(s, self, w).ok) {
        matchBuy(m, self.id, w);
        break;
      }
    }
  }
  if (inMySede && self.curativos === 0 && self.money >= CURATIVO.preco + 100) matchBuy(m, self.id, CURATIVO.id);

  const standingEnemies = s.fighters.filter((f) => f.team !== self.team && isAlive(f) && f.state !== 'downed');
  const nearestEnemyD = Math.min(Infinity, ...standingEnemies.map((f) => dist(f.pos, self.pos)));

  // Levantando um aliado: segura o X enquanto ninguém chega perto.
  if (self.state === 'reviving') return { ...idle, buttons: nearestEnemyD > 1.8 ? Buttons.USE : 0 };

  // Aliado caído por perto e sem inimigo em cima: vai levantar.
  const downedAlly = s.fighters
    .filter((f) => f.team === self.team && f.state === 'downed')
    .sort((a, b) => dist(a.pos, self.pos) - dist(b.pos, self.pos))[0];
  const allyD = downedAlly ? dist(downedAlly.pos, self.pos) : Infinity;
  // Em combate não dá para levantar (dano recente ou inimigo perto): nem tenta.
  if (downedAlly && allyD < 12 && canRevive(s, self, downedAlly) && self.state === 'idle') {
    if (downedAllyInRange(s, self)) {
      // Borda de subida: solta um tick antes de apertar.
      return { ...idle, aim: yawTo(self.pos, downedAlly.pos), buttons: s.tick % 2 === 0 ? Buttons.USE : 0 };
    }
    const dx = downedAlly.pos.x - self.pos.x;
    const dz = downedAlly.pos.z - self.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    return { moveX: dx / len, moveZ: dz / len, aim: yawTo(self.pos, downedAlly.pos), buttons: Buttons.RUN };
  }

  // Curativo com vida baixa e ninguém em cima.
  if (self.hp < 40 && self.curativos > 0 && nearestEnemyD > 3 && self.state === 'idle') {
    return { ...idle, buttons: s.tick % 2 === 0 ? Buttons.HEAL : 0 };
  }

  // Modo.
  if (self.hp < 30 && self.curativos === 0) brain.mode = 'recuar';
  else if (brain.mode === 'recuar' && self.hp >= 85) brain.mode = 'perseguir';

  // Alvo: inimigo vivo mais próximo, fora da sede dele. Caído por perto tem prioridade (finalizar).
  const enemies = s.fighters.filter((f) => f.team !== self.team && isAlive(f) && s.tick >= f.protectedUntil);
  let target = enemies.find((f) => f.id === brain.targetId);
  const downedEnemy = enemies.find((f) => f.state === 'downed' && dist(f.pos, self.pos) < 2.2);
  if (downedEnemy) {
    target = downedEnemy;
    brain.targetId = downedEnemy.id;
  } else if (!target || s.tick % 30 === 0) {
    target = enemies
      // Na briga, não fica caçando quem está na própria sede; no bandeirão, a sede rival é o objetivo.
      .filter((f) => m.mode === 'bandeirao' || inSede(s, f)?.team !== f.team)
      .sort((a, b) => dist(a.pos, self.pos) - dist(b.pos, self.pos))[0];
    brain.targetId = target?.id ?? null;
  }

  // Detecta quando está preso num carro e sai de lado.
  const moved = dist(self.pos, brain.lastPos);
  brain.lastPos = { ...self.pos };
  brain.stuckTicks = moved < 0.01 && self.state === 'idle' ? brain.stuckTicks + 1 : 0;
  if (brain.stuckTicks > 20) {
    brain.strafe = rand() < 0.5 ? -1 : 1;
    brain.stuckTicks = 0;
  }
  if (brain.strafe !== 0 && rand() < 0.02) brain.strafe = 0;

  const moveTo = (p: Vec2, away = false): Pick<PlayerInput, 'moveX' | 'moveZ'> => {
    let dx = p.x - self.pos.x;
    let dz = p.z - self.pos.z;
    if (away) {
      dx = -dx;
      dz = -dz;
    }
    const len = Math.hypot(dx, dz) || 1;
    let mx = dx / len;
    let mz = dz / len;
    if (brain.strafe !== 0) {
      // Perpendicular, para contornar o obstáculo.
      const t = mx;
      mx = -mz * brain.strafe * 0.9 + mx * 0.3;
      mz = t * brain.strafe * 0.9 + mz * 0.3;
    }
    return { moveX: mx, moveZ: mz };
  };

  // ------------------------------------------------------------ bandeirão
  if (m.mode === 'bandeirao') {
    const myTeam = self.team;
    const enemyTeam = myTeam === 0 ? 1 : 0;
    const ownFlag = m.flags[myTeam];
    const enemyFlag = m.flags[enemyTeam];
    const go = (p: Vec2, run = true): PlayerInput => {
      const wp = waypoint(m, self.pos, p);
      return { ...moveTo(wp), aim: yawTo(self.pos, wp), buttons: run && self.stamina > c.maxStamina * 0.15 ? Buttons.RUN : 0 };
    };
    // Só para para brigar se alguém encostou ou se acabou de apanhar (senão segue o objetivo).
    const justHit = s.tick - self.lastCombatTick < 45;
    const adjacentEnemy = standingEnemies.find((f) => dist(f.pos, self.pos) < (self.carrying ? 1.4 : justHit ? 3.5 : 1.8));
    // Carregando: volta para casa sem parar (só briga se alguém encostar).
    if (self.carrying) {
      // Volta pela rua mais próxima (sem cruzar fileiras de carros) até perto do galpão, e entra.
      const homeX = (myTeam === 0 ? -1 : 1) * (MAP_HALF_W - 30);
      const towardHome = myTeam === 0 ? -1 : 1;
      if (towardHome * self.pos.x < towardHome * homeX - 1) {
        const lane = [-25, 0, 25].reduce((b, l) => (Math.abs(l - self.pos.z) < Math.abs(b - self.pos.z) ? l : b), 0);
        if (Math.abs(self.pos.z - lane) > 2.5) return go({ x: self.pos.x + towardHome * 2, z: lane });
        return go({ x: homeX, z: lane });
      }
      return go(m.map.sedes[myTeam].flag);
    }
    // Bandeirão rival ao alcance: agarra mesmo com gente em cima.
    if (!self.carrying && enemyFlag.state !== 'carried' && dist(enemyFlag.pos, self.pos) < 5) return go(enemyFlag.pos);
    if (!self.carrying) {
      // Bandeirão próprio roubado: caça o carregador.
      const thief = ownFlag.carrier ? s.fighters.find((f) => f.id === ownFlag.carrier) : undefined;
      if (thief && dist(thief.pos, self.pos) < 22) {
        brain.targetId = thief.id;
        target = thief;
        if (dist(thief.pos, self.pos) > 2) return go(thief.pos);
      } else if (ownFlag.state === 'dropped' && dist(ownFlag.pos, self.pos) < 30) {
        // Bandeirão próprio no chão: devolve.
        if (!adjacentEnemy) return go(ownFlag.pos);
      } else if (enemyFlag.state === 'dropped' && dist(enemyFlag.pos, self.pos) < 30 && !adjacentEnemy) {
        return go(enemyFlag.pos);
      } else if (enemyFlag.state === 'home' && brain.role === 'atacante' && !adjacentEnemy && brain.mode !== 'recuar') {
        // Segue uma rota (avenida central ou uma das ruas laterais) até a porta do galpão rival.
        const lane = brain.lane;
        const sideX = myTeam === 0 ? 1 : -1;
        const approachX = sideX * (MAP_HALF_W - 30);
        const progress = sideX * self.pos.x;
        if (progress < sideX * approachX - 1) {
          // Ainda no caminho: entra na rota e anda por ela.
          if (Math.abs(self.pos.z - lane) > 2.5) return go({ x: self.pos.x + sideX * 3, z: lane });
          return go({ x: approachX, z: lane });
        }
        return go(enemyFlag.pos);
      } else if (enemyFlag.state === 'carried' && enemyFlag.carrier !== self.id && brain.role !== 'defensor') {
        // Escolta o aliado que está com o bandeirão.
        const mate = s.fighters.find((f) => f.id === enemyFlag.carrier);
        const threat = mate && standingEnemies.find((f) => dist(f.pos, mate.pos) < 6);
        if (threat) {
          brain.targetId = threat.id;
          target = threat;
        } else if (mate && dist(mate.pos, self.pos) > 4) return go(mate.pos);
      } else if (brain.role === 'defensor') {
        // Guarda o próprio bandeirão: briga com quem chegar perto, senão fica de olho.
        const intruder = standingEnemies.find((f) => dist(f.pos, ownFlag.home) < 14);
        if (intruder) {
          brain.targetId = intruder.id;
          target = intruder;
        } else {
          // Posição de guarda na entrada do galpão (não em cima do bandeirão, para não bloquear a passagem).
          const door = m.map.sedes[myTeam].doors[0]?.inside ?? ownFlag.home;
          const post = { x: door.x, z: door.z + (brain.aggression > 0.6 ? 2 : -2) };
          if (dist(self.pos, post) > 1.5) return go(post, false);
          return { ...idle, aim: yawTo(self.pos, { x: 0, z: 0 }) };
        }
      }
    }
  }

  // ------------------------------------------------------------ pontos de controle (briga)
  // Caçadores seguem caçando; o resto disputa os pontos: só para para brigar com quem encostar
  // ou com inimigo dentro da praça (que impede a captura).
  if (m.mode === 'briga' && m.points.length && brain.role !== 'cacador' && brain.mode !== 'recuar') {
    const goal = pointGoal(m, self.team, brain.pointPref);
    if (goal) {
      const justHit = s.tick - self.lastCombatTick < 45;
      const adjacent = standingEnemies.find((f) => dist(f.pos, self.pos) < (justHit ? 3.5 : 2));
      const intruder = standingEnemies
        .filter((f) => dist(f.pos, goal.pos) <= goal.radius + 1)
        .sort((a, b) => dist(a.pos, self.pos) - dist(b.pos, self.pos))[0];
      const foe = adjacent ?? (dist(self.pos, goal.pos) < goal.radius + 6 ? intruder : undefined);
      if (foe) {
        brain.targetId = foe.id;
        target = foe;
      } else {
        // Vai para uma vaga dentro da praça (espalhados pela preferência) e segura.
        const spot = { x: goal.pos.x + Math.cos(brain.aggression * 20) * goal.radius * 0.5, z: goal.pos.z + Math.sin(brain.aggression * 20) * goal.radius * 0.5 };
        if (dist(self.pos, spot) > 1.2) {
          const wp = waypoint(m, self.pos, spot);
          const far = dist(self.pos, spot) > 8;
          return { ...moveTo(wp), aim: yawTo(self.pos, wp), buttons: far && self.stamina > c.maxStamina * 0.15 ? Buttons.RUN : 0 };
        }
        return { ...idle, aim: yawTo(self.pos, nearestEnemyPos(standingEnemies, self.pos) ?? goal.pos) };
      }
    }
  }

  if (brain.mode === 'recuar') {
    if (dist(self.pos, mySede) < 2) return { ...idle, aim: self.facing };
    return { ...moveTo(mySede), aim: yawTo(self.pos, mySede), buttons: 0 };
  }
  if (!target) {
    // Sem alvo à vista: avança pelo estacionamento até um ponto de encontro (varia por bot).
    const rally = { x: (self.team === 0 ? 1 : -1) * (brain.aggression - 0.5) * 16, z: (brain.aggression * 37) % 1 > 0.5 ? 2 : -2 };
    if (dist(self.pos, rally) < 1.5) return { ...idle, aim: self.facing };
    return { ...moveTo(rally), aim: yawTo(self.pos, rally), buttons: 0 };
  }

  const d = dist(self.pos, target.pos);
  const aim = yawTo(self.pos, target.pos);
  const weapon = DEFAULT_COMBAT_DATA.weapons[self.weapon];
  const first = weapon?.moves.light[0];
  const reach = first?.hitbox.shape === 'arc' ? first.hitbox.range : first?.hitbox.shape === 'capsule' ? first.hitbox.to : 1.1;

  // Reação a um golpe vindo: bloquear (ou esquivar) depois de um atraso.
  const incoming = target.state === 'attack' && target.move && attackPhase(target.move.def, target.stateTick) === 'startup' && d < reach + 1.8;
  const attackKey = incoming && target.move ? `${target.id}:${target.move.def.id}:${s.tick - target.stateTick}` : '';
  if (incoming && target.move && attackKey !== brain.seenAttack) {
    brain.seenAttack = attackKey;
    const skill = Math.min(0.95, brain.defense + (self.hp < 50 ? 0.15 : 0));
    if (brain.reaction === null && rand() < skill) {
      brain.reaction = rand() < 0.7 ? 'block' : 'dodge';
      // Reage alguns ticks antes do impacto: perto do impacto o bloqueio vira parry.
      const toActive = target.move.def.startup + 1 - target.stateTick;
      const lead = brain.reaction === 'block' ? 1 + Math.floor(rand() * 7) : 2 + Math.floor(rand() * 3);
      brain.reactAt = s.tick + Math.max(0, toActive - lead);
    }
  }
  let buttons = 0;
  if (brain.reaction && s.tick >= brain.reactAt) {
    if (brain.reaction === 'block') {
      buttons |= Buttons.BLOCK;
      if (!incoming && target.state !== 'attack') brain.reaction = null;
    } else {
      // Esquiva é um toque: segura um tick só.
      buttons |= Buttons.DODGE;
      brain.reaction = null;
    }
  }
  if (buttons) {
    brain.heldBlock = (buttons & Buttons.BLOCK) !== 0;
    // Esquiva: passo para o lado (perpendicular ao alvo).
    const side = rand() < 0.5 ? 1 : -1;
    const toT = { x: target.pos.x - self.pos.x, z: target.pos.z - self.pos.z };
    const len = Math.hypot(toT.x, toT.z) || 1;
    const sideways = { moveX: (-toT.z / len) * side, moveZ: (toT.x / len) * side };
    return { ...(buttons & Buttons.DODGE ? sideways : { moveX: 0, moveZ: 0 }), aim, buttons };
  }
  brain.heldBlock = false;

  if (d > reach + 0.25) {
    brain.mode = 'perseguir';
    // Corre quando o alvo está longe e sobra estamina para brigar.
    return { ...moveTo(target.pos), aim, buttons: d > 7 && self.stamina > c.maxStamina * 0.4 ? Buttons.RUN : 0 };
  }
  brain.mode = 'atacar';
  // Ataca com cadência: alterna apertar/soltar para gerar bordas. Às vezes pesado ou chute.
  if (self.state === 'idle' || self.state === 'attack') {
    const r = rand();
    const allies = s.fighters.filter((f) => f.team === self.team && f.state !== 'downed' && isAlive(f) && dist(f.pos, self.pos) < 8).length;
    if (self.raca >= c.raca.shoutCost && allies >= 3 && r < 0.05) buttons = Buttons.SHOUT;
    else if (self.raca >= c.raca.specialCost && target.state !== 'downed' && r < 0.04) buttons = Buttons.SPECIAL;
    else if (r < 0.12 * brain.aggression) buttons = Buttons.LIGHT;
    else if (r < 0.14 * brain.aggression) buttons = Buttons.KICK;
    else if (r < 0.155 * brain.aggression) buttons = Buttons.HEAVY;
    else if (target.state === 'block' && r < 0.2) buttons = Buttons.SHOVE;
  }
  if (self.stamina < c.maxStamina * 0.1) {
    // Sem fôlego: dá uns passos para trás para recuperar.
    return { ...moveTo(target.pos, true), aim, buttons: 0 };
  }
  return { moveX: 0, moveZ: 0, aim, buttons };
}

/** Navegação simples pelos portões: entrar ou sair de um galpão passa pelo portão mais conveniente. */
/**
 * Ponto a disputar: o preferido se não for nosso; senão o não-nosso mais perto da preferência; tudo nosso = defende o preferido.
 * A ordem é a partir da própria sede (preferência 0 = o ponto do nosso lado), igual nos dois times.
 */
function pointGoal(m: MatchState, team: 0 | 1, pref: number): ControlPointState | undefined {
  const pts = team === 0 ? m.points : [...m.points].reverse();
  const preferred = pts[pref % pts.length];
  const notOurs = (p: ControlPointState) => p.owner !== team || p.contested || p.progress < 1;
  if (preferred && notOurs(preferred)) return preferred;
  const open = pts.filter(notOurs).sort((a, b) => Math.abs(pts.indexOf(a) - pref) - Math.abs(pts.indexOf(b) - pref))[0];
  return open ?? preferred;
}

function nearestEnemyPos(enemies: { pos: Vec2 }[], from: Vec2): Vec2 | undefined {
  return [...enemies].sort((a, b) => dist(a.pos, from) - dist(b.pos, from))[0]?.pos;
}

function waypoint(m: MatchState, from: Vec2, to: Vec2): Vec2 {
  for (const sd of m.map.sedes) {
    const fIn = inRect(from, sd.area);
    const tIn = inRect(to, sd.area);
    if (fIn === tIn) continue;
    let best = sd.doors[0];
    let bestCost = Infinity;
    for (const d of sd.doors) {
      const a = fIn ? d.inside : d.outside;
      const b = fIn ? d.outside : d.inside;
      const cost = dist(from, a) + dist(a, b) + dist(b, to);
      if (cost < bestCost) {
        bestCost = cost;
        best = d;
      }
    }
    if (!best) return to;
    const first = fIn ? best.inside : best.outside;
    const second = fIn ? best.outside : best.inside;
    // Já passou do primeiro ponto (está mais perto do segundo do que ele): segue para o segundo. Evita oscilar no portão.
    return dist(from, second) <= dist(first, second) + 0.3 || dist(from, first) < 0.8 ? second : first;
  }
  return to;
}
