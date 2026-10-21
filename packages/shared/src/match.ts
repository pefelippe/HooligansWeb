import { isAlive, isStanding, type Fighter } from './combat/fsm';
import { dist } from './combat/geometry';
import type { PlayerInput } from './combat/input';
import { buy, type BuyResult } from './combat/shop';
import { createFighter, createSim, type SimEvent, type SimState, spawnPoint, step } from './combat/sim';
import { addMoney, ECONOMY } from './combat/economy';
import { type TeamSide, TICK_RATE, type Vec2 } from './combat/types';
import { DEFAULT_COMBAT_DATA } from './combat/weapons';
import { type ControlPointDef, type GameMap, generateMap, inRect } from './map';
import type { CharacterVisual } from './visual';

// Regras da partida 10×10.
//   briga:     placar por nocautes; ganha quem tiver mais no fim do tempo.
//   bandeirão: leve o bandeirão rival para a sua sede (com o seu em casa). Melhor de 3.

export type MatchMode = 'bandeirao' | 'briga';

/**
 * Pontos de controle (somam ao placar da briga): o time captura ficando na praça sem
 * inimigo de pé nela; com os dois times dentro, a barra congela.
 */
export const CONTROL = {
  /** Ticks para capturar sozinho (8 s); mais gente acelera até 2×. */
  captureTicks: 480,
  maxSpeedup: 2,
  /** Cada ponto dominado vale +1 no placar a cada 10 s. */
  scoreEveryTicks: 600,
  /** Recompensa de quem estava na praça na captura. */
  captureMoney: 100,
  captureRaca: 10,
} as const;

export interface ControlPointState {
  id: ControlPointDef['id'];
  pos: Vec2;
  radius: number;
  /** Time dono (ganha pontos), ou null se neutro. */
  owner: TeamSide | null;
  /** Para qual time a barra está enchendo/cheia. */
  capTeam: TeamSide | null;
  /** 0..1 da barra de captura de `capTeam`. */
  progress: number;
  /** Os dois times dentro: congela. */
  contested: boolean;
}

export const MATCH = {
  teamSize: 10,
  durationTicks: 10 * 60 * TICK_RATE,
} as const;

export interface RosterEntry {
  id: string;
  nick: string;
  team: TeamSide;
  bot: boolean;
  /** Visual do jogador. Bots não mandam: o cliente sorteia pelo id. */
  visual?: CharacterVisual;
}

export interface PlayerResult extends Omit<RosterEntry, 'visual'> {
  kos: number;
  deaths: number;
  assists: number;
  captures: number;
}

export interface MatchResult {
  mode: MatchMode;
  winner: TeamSide | null;
  /** Placar por time: nocautes + pontos de controle. */
  score: [number, number];
  /** Quanto do placar veio dos pontos de controle. */
  pointScore: [number, number];
  /** Capturas de bandeirão por time (bandeirão). */
  captures: [number, number];
  mvp: string | null;
  players: PlayerResult[];
}

/** Bandeirão de um time. */
export interface FlagState {
  team: TeamSide;
  state: 'home' | 'carried' | 'dropped';
  pos: Vec2;
  home: Vec2;
  carrier: string | null;
  droppedAt: number;
}

export interface MatchState {
  id: string;
  seed: number;
  mode: MatchMode;
  map: GameMap;
  sim: SimState;
  /** Placar por time: nocautes + pontos de controle (briga). */
  score: [number, number];
  /** Parte do placar que veio dos pontos de controle. */
  pointScore: [number, number];
  captures: [number, number];
  flags: [FlagState, FlagState];
  /** Pontos de controle A, B, C (só valem na briga). */
  points: ControlPointState[];
  /** Capturas por jogador. */
  playerCaptures: Record<string, number>;
  endsAtTick: number;
  phase: 'playing' | 'ended';
  roster: Record<string, RosterEntry>;
  result: MatchResult | null;
}

export type PointEvent =
  | { type: 'pointCaptured'; tick: number; point: ControlPointDef['id']; team: TeamSide; by: string[] }
  | { type: 'pointLost'; tick: number; point: ControlPointDef['id']; team: TeamSide };

export type FlagEvent =
  | { type: 'flagTaken'; tick: number; team: TeamSide; by: string }
  | { type: 'flagDropped'; tick: number; team: TeamSide; pos: Vec2 }
  | { type: 'flagReturned'; tick: number; team: TeamSide; by: string | null }
  | { type: 'flagCaptured'; tick: number; team: TeamSide; by: string; captures: [number, number] };

export type MatchEvent = SimEvent | FlagEvent | PointEvent | { type: 'matchEnd'; tick: number; result: MatchResult };

/** Sedes da simulação a partir do mapa (spawn, zona do galpão). */
export function simSedes(map: GameMap): SimState['sedes'] {
  return map.sedes.map((sd) => ({ team: sd.team, pos: sd.spawn, area: sd.area }));
}

export function createMatch(id: string, seed: number, durationTicks: number = MATCH.durationTicks, mode: MatchMode = 'briga'): MatchState {
  const map = generateMap(seed);
  const sim = createSim([], {
    sedes: simSedes(map),
    arenaHalfSize: Math.max(map.halfW, map.halfD),
    collision: { boxes: map.boxes, circles: map.circles, halfW: map.halfW, halfD: map.halfD },
    // Na partida, HP 0 deixa caído: dá para ser levantado por um aliado.
    rules: { downed: true },
  });
  const flag = (team: TeamSide): FlagState => {
    const home = map.sedes[team].flag;
    return { team, state: 'home', pos: { ...home }, home: { ...home }, carrier: null, droppedAt: 0 };
  };
  return {
    id,
    seed,
    mode,
    map,
    sim,
    score: [0, 0],
    pointScore: [0, 0],
    captures: [0, 0],
    flags: [flag(0), flag(1)],
    points: map.controlPoints.map((cp) => ({ id: cp.id, pos: { ...cp.pos }, radius: cp.radius, owner: null, capTeam: null, progress: 0, contested: false })),
    playerCaptures: {},
    endsAtTick: durationTicks,
    phase: 'playing',
    roster: {},
    result: null,
  };
}

export function teamCount(m: MatchState, team: TeamSide, filter: (r: RosterEntry) => boolean = () => true): number {
  return Object.values(m.roster).filter((r) => r.team === team && filter(r)).length;
}

export function addPlayer(m: MatchState, entry: RosterEntry): Fighter {
  const existing = m.sim.fighters.find((f) => f.id === entry.id);
  if (existing) return existing;
  m.roster[entry.id] = entry;
  const index = m.sim.fighters.length;
  const f = createFighter({ id: entry.id, team: entry.team, pos: spawnPoint(m.sim, entry.team, index), facing: entry.team === 0 ? Math.PI / 2 : -Math.PI / 2 });
  // Entrar já com a proteção de spawn.
  f.protectedUntil = m.sim.tick + 180;
  m.sim.fighters.push(f);
  return f;
}

export function removePlayer(m: MatchState, id: string): void {
  // Quem sai com o bandeirão larga ele onde está.
  for (const fl of m.flags) if (fl.carrier === id) dropFlag(m, fl, []);
  delete m.roster[id];
  m.sim.fighters = m.sim.fighters.filter((f) => f.id !== id);
  for (const f of m.sim.fighters) if (f.lockTarget === id) f.lockTarget = null;
}

export function matchBuy(m: MatchState, id: string, itemId: string): BuyResult | { ok: false; reason: 'partida_encerrada' | 'jogador_inexistente' } {
  if (m.phase !== 'playing') return { ok: false, reason: 'partida_encerrada' };
  const f = m.sim.fighters.find((x) => x.id === id);
  if (!f) return { ok: false, reason: 'jogador_inexistente' };
  return buy(m.sim, f, itemId);
}

export function ticksLeft(m: MatchState): number {
  return Math.max(0, m.endsAtTick - m.sim.tick);
}

function fighter(m: MatchState, id: string | null): Fighter | undefined {
  return id ? m.sim.fighters.find((f) => f.id === id) : undefined;
}

function dropFlag(m: MatchState, fl: FlagState, events: MatchEvent[]): void {
  const carrier = fighter(m, fl.carrier);
  if (carrier) carrier.carrying = false;
  fl.state = 'dropped';
  fl.carrier = null;
  fl.droppedAt = m.sim.tick;
  fl.pos = carrier ? { ...carrier.pos } : fl.pos;
  events.push({ type: 'flagDropped', tick: m.sim.tick, team: fl.team, pos: { ...fl.pos } });
}

function returnFlag(m: MatchState, fl: FlagState, by: string | null, events: MatchEvent[]): void {
  const carrier = fighter(m, fl.carrier);
  if (carrier) carrier.carrying = false;
  fl.state = 'home';
  fl.carrier = null;
  fl.pos = { ...fl.home };
  events.push({ type: 'flagReturned', tick: m.sim.tick, team: fl.team, by });
}

/** Regras do bandeirão, depois de cada tick da simulação. */
function stepFlags(m: MatchState, events: MatchEvent[]): void {
  const c = DEFAULT_COMBAT_DATA.constants;
  const tick = m.sim.tick;
  for (const fl of m.flags) {
    const enemyTeam: TeamSide = fl.team === 0 ? 1 : 0;
    if (fl.state === 'carried') {
      const carrier = fighter(m, fl.carrier);
      // Carregador derrubado (caído/KO) ou sumiu: o bandeirão cai.
      if (!carrier || !isStanding(carrier)) {
        dropFlag(m, fl, events);
        continue;
      }
      fl.pos = { ...carrier.pos };
      // Captura: chegou na própria sede com o próprio bandeirão em casa.
      const ownFlag = m.flags[enemyTeam];
      if (inRect(carrier.pos, m.map.sedes[enemyTeam].area) && ownFlag.state === 'home') {
        m.captures[enemyTeam]++;
        m.playerCaptures[carrier.id] = (m.playerCaptures[carrier.id] ?? 0) + 1;
        carrier.money = addMoney(carrier.money, ECONOMY.ko * 2);
        for (const f of m.sim.fighters) if (f.team === enemyTeam && f !== carrier) f.money = addMoney(f.money, ECONOMY.assist);
        events.push({ type: 'flagCaptured', tick, team: enemyTeam, by: carrier.id, captures: [m.captures[0], m.captures[1]] });
        returnFlag(m, fl, null, []);
      }
      continue;
    }
    if (fl.state === 'dropped' && tick - fl.droppedAt >= c.flag.returnTicks) {
      returnFlag(m, fl, null, events);
      continue;
    }
    for (const f of m.sim.fighters) {
      if (!isStanding(f) || dist(f.pos, fl.pos) > c.flag.pickupRange) continue;
      if (f.team === fl.team) {
        // Aliado encosta no próprio bandeirão caído: devolve para a sede.
        if (fl.state === 'dropped') {
          returnFlag(m, fl, f.id, events);
          break;
        }
      } else if (!f.carrying && tick >= f.protectedUntil) {
        fl.state = 'carried';
        fl.carrier = f.id;
        f.carrying = true;
        f.running = false;
        // Fôlego para sair do galpão rival com o bandeirão.
        f.protectedUntil = Math.max(f.protectedUntil, tick + c.flag.pickupProtection);
        events.push({ type: 'flagTaken', tick, team: fl.team, by: f.id });
        break;
      }
    }
  }
}

/** Respawn atual: sobe linearmente do começo ao fim da partida. */
export function respawnTicksAt(m: MatchState): number {
  const c = DEFAULT_COMBAT_DATA.constants;
  const t = Math.max(0, Math.min(1, m.sim.tick / Math.max(1, m.endsAtTick)));
  return Math.round(c.respawnTicks + (c.respawnTicksEnd - c.respawnTicks) * t);
}

export function stepMatch(m: MatchState, inputs: Readonly<Record<string, PlayerInput | undefined>>): MatchEvent[] {
  if (m.phase !== 'playing') return [];
  m.sim.respawnTicks = respawnTicksAt(m);
  const events: MatchEvent[] = step(m.sim, inputs);
  for (const e of events) {
    if (e.type !== 'ko') continue;
    const victim = m.sim.fighters.find((f) => f.id === e.target);
    if (!victim) continue;
    // Nocaute conta para o time adversário da vítima (inclusive sangramento e dano da sede).
    const scorer: TeamSide = victim.team === 0 ? 1 : 0;
    m.score[scorer]++;
    // Virada: quem cai pelo time que está perdendo recebe um extra para se armar.
    const lead = m.mode === 'bandeirao' ? m.captures : m.score;
    const deficit = m.mode === 'bandeirao' ? (lead[scorer] - lead[victim.team]) * 5 : lead[scorer] - lead[victim.team];
    if (deficit > 0) victim.money = addMoney(victim.money, Math.min(ECONOMY.comebackMax, deficit * ECONOMY.comebackPerScore));
  }
  if (m.mode === 'bandeirao') stepFlags(m, events);
  else stepPoints(m, events);
  const won = m.mode === 'bandeirao' && m.captures.some((n) => n >= DEFAULT_COMBAT_DATA.constants.flag.capturesToWin);
  if (won || m.sim.tick >= m.endsAtTick) {
    m.phase = 'ended';
    for (const fl of m.flags) {
      const carrier = fighter(m, fl.carrier);
      if (carrier) carrier.carrying = false;
    }
    m.result = computeResult(m);
    events.push({ type: 'matchEnd', tick: m.sim.tick, result: m.result });
  }
  return events;
}

/** Pontos de controle: captura, disputa, neutralização e placar a cada 10 s. */
function stepPoints(m: MatchState, events: MatchEvent[]): void {
  const s = m.sim;
  const raca = DEFAULT_COMBAT_DATA.constants.raca.max;
  for (const p of m.points) {
    const inside: [Fighter[], Fighter[]] = [[], []];
    for (const f of s.fighters) if (isStanding(f) && dist(f.pos, p.pos) <= p.radius) inside[f.team].push(f);
    p.contested = inside[0].length > 0 && inside[1].length > 0;
    if (p.contested || (!inside[0].length && !inside[1].length)) continue;
    const team: TeamSide = inside[0].length ? 0 : 1;
    const rate = Math.min(CONTROL.maxSpeedup, 1 + 0.5 * (inside[team].length - 1)) / CONTROL.captureTicks;
    if (p.owner === team) {
      // Recupera a própria barra.
      p.capTeam = team;
      p.progress = Math.min(1, p.progress + rate);
    } else if (p.capTeam !== null && p.capTeam !== team && p.progress > 0) {
      // Barra do outro time: primeiro esvazia (neutraliza).
      p.progress = Math.max(0, p.progress - rate);
      if (p.progress === 0) {
        if (p.owner !== null) events.push({ type: 'pointLost', tick: s.tick, point: p.id, team: p.owner });
        p.owner = null;
        p.capTeam = team;
      }
    } else {
      p.capTeam = team;
      p.progress = Math.min(1, p.progress + rate);
      if (p.progress >= 1) {
        p.owner = team;
        for (const f of inside[team]) {
          f.money = addMoney(f.money, CONTROL.captureMoney);
          f.raca = Math.min(raca, f.raca + CONTROL.captureRaca);
        }
        events.push({ type: 'pointCaptured', tick: s.tick, point: p.id, team, by: inside[team].map((f) => f.id) });
      }
    }
  }
  if (s.tick % CONTROL.scoreEveryTicks === 0) {
    for (const p of m.points) {
      if (p.owner === null) continue;
      m.score[p.owner]++;
      m.pointScore[p.owner]++;
    }
  }
}

export function computeResult(m: MatchState): MatchResult {
  const players: PlayerResult[] = m.sim.fighters.map((f) => {
    // O visual fica fora do resultado (não precisa ir de novo no fim da partida).
    const r = m.roster[f.id];
    return {
      ...(r ? { id: r.id, nick: r.nick, team: r.team, bot: r.bot } : { id: f.id, nick: f.id, team: f.team, bot: true }),
      kos: f.kos,
      deaths: f.deaths,
      assists: f.assists,
      captures: m.playerCaptures[f.id] ?? 0,
    };
  });
  const [a, b] = m.score;
  const [ca, cb] = m.captures;
  let winner: TeamSide | null;
  if (m.mode === 'bandeirao' && ca !== cb) winner = ca > cb ? 0 : 1;
  else winner = a === b ? null : a > b ? 0 : 1; // desempate (ou briga): nocautes
  const ranked = [...players].sort((p, q) => q.captures - p.captures || q.kos - p.kos || q.assists - p.assists || p.deaths - q.deaths);
  return { mode: m.mode, winner, score: [a, b], pointScore: [...m.pointScore], captures: [ca, cb], mvp: ranked[0]?.id ?? null, players };
}

export function aliveCount(m: MatchState, team: TeamSide): number {
  return m.sim.fighters.filter((f) => f.team === team && isAlive(f)).length;
}
