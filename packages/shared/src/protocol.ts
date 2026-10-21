import { type Fighter, type FighterStateName, hasArmor, isInvulnerable } from './combat/fsm';
import type { SimState } from './combat/sim';
import { DEFAULT_COMBAT_DATA } from './combat/weapons';
import type { PlayerInput } from './combat/input';
import type { TeamSide, Vec2 } from './combat/types';
import type { ControlPointState, MatchEvent, MatchResult, MatchState, RosterEntry } from './match';
import type { CharacterVisual } from './visual';

// Protocolo cliente <-> game server (JSON por enquanto; binário depois do marco de netcode).
export const PROTOCOL_VERSION = 5;

/** Claims do ticket JWT emitido pela API ao entrar na fila. */
export interface MatchTicketClaims {
  userId: string;
  matchId: string;
  team: TeamSide;
  nick: string;
  serverUrl: string;
  /** Visual escolhido no perfil (o game server revalida). */
  visual?: CharacterVisual;
}

// ---------------------------------------------------------------- salas (lobby)

/** Sala: até 50 lutadores (humanos + bots), no máximo 25 por torcida. */
export const ROOM = { maxPlayers: 50, maxPerTeam: 25, nameMin: 3, nameMax: 32 } as const;

/** Claims do ticket de sala, emitido pela API ao criar/entrar. Vale para o WebSocket do lobby. */
export interface RoomTicketClaims {
  kind: 'room';
  userId: string;
  roomId: string;
  team: TeamSide;
  nick: string;
  visual?: CharacterVisual;
}

export interface RoomPlayer {
  id: string;
  nick: string;
  team: TeamSide;
}

export interface RoomInfo {
  id: string;
  code: string;
  nome: string;
  publica: boolean;
  liderId: string;
  fase: 'lobby' | 'playing';
  players: RoomPlayer[];
  /** Bots configurados por time. */
  bots: [number, number];
}

/** Linha da lista de salas públicas. */
export interface RoomSummary {
  code: string;
  nome: string;
  lider: string;
  humanos: number;
  total: number;
  fase: RoomInfo['fase'];
}

export type LobbyClientMessage =
  | { t: 'helloLobby'; v: number; ticket: string }
  | { t: 'kick'; userId: string }
  | { t: 'setBots'; team: TeamSide; count: number }
  | { t: 'start' }
  /** Saiu da tela da partida e quer voltar: pede um ticket novo. */
  | { t: 'rejoin' }
  | { t: 'setPublic'; publica: boolean }
  | { t: 'ping'; at: number };

export type LobbyServerMessage =
  | { t: 'room'; room: RoomInfo; you: string }
  | { t: 'matchStart'; ticket: string; serverUrl: string }
  | { t: 'error'; code: string }
  | { t: 'pong'; at: number };

export type ClientMessage =
  | { t: 'hello'; v: number; ticket: string }
  | { t: 'input'; seq: number; input: PlayerInput }
  | { t: 'buy'; item: string }
  | { t: 'ping'; at: number };

export interface FighterSnapshot {
  id: string;
  team: TeamSide;
  pos: Vec2;
  y: number;
  running: boolean;
  facing: number;
  hp: number;
  stamina: number;
  state: FighterStateName;
  stateTick: number;
  stateDuration: number;
  move: string | null;
  charge: number;
  weapon: string;
  durability: number | null;
  /** Proteção de spawn ativa ou i-frames. */
  invulnerable: boolean;
  /** Bloqueio dentro da janela de parry. */
  parryLive: boolean;
  armored: boolean;
  bleeding: number;
  hitstop: number;
  lockTarget: string | null;
  money: number;
  kos: number;
  deaths: number;
  assists: number;
  curativos: number;
  koTick: number;
  raca: number;
  buffed: boolean;
  /** Janela de contra-golpe aberta. */
  counter: boolean;
  dodgeKind: 'step' | 'roll';
  /** Progresso 0..1 de canalização (curativo, carrinho, levantando) ou do caído. */
  channel: number;
}

export interface MatchSnapshotInfo {
  score: [number, number];
  ticksLeft: number;
  phase: MatchState['phase'];
  /** Respawn atual (ticks): cresce ao longo da partida. */
  respawnTicks: number;
  /** Pontos de controle (a posição vem do mapa). */
  points: Pick<ControlPointState, 'id' | 'owner' | 'capTeam' | 'progress' | 'contested'>[];
  /** Parte do placar que veio dos pontos. */
  pointScore: [number, number];
}

export function toMatchInfo(m: MatchState, ticksLeft: number): MatchSnapshotInfo {
  return {
    score: m.score,
    ticksLeft,
    phase: m.phase,
    respawnTicks: m.sim.respawnTicks,
    points: m.points.map((p) => ({ id: p.id, owner: p.owner, capTeam: p.capTeam, progress: Math.round(p.progress * 1000) / 1000, contested: p.contested })),
    pointScore: m.pointScore,
  };
}

export type ServerMessage =
  | { t: 'welcome'; you: string; matchId: string; team: TeamSide; tick: number; seed: number }
  | { t: 'roster'; players: RosterEntry[] }
  /** `self`: estado completo do seu lutador, para a predição reconciliar. */
  | { t: 'snapshot'; tick: number; ackSeq: number; match: MatchSnapshotInfo; fighters: FighterSnapshot[]; self?: Fighter }
  | { t: 'events'; events: MatchEvent[] }
  | { t: 'buyResult'; ok: boolean; item: string; reason?: string }
  | { t: 'matchEnd'; result: MatchResult }
  | { t: 'pong'; at: number }
  | { t: 'error'; code: string };

export function toSnapshot(s: SimState, f: Fighter, data = DEFAULT_COMBAT_DATA): FighterSnapshot {
  const c = data.constants;
  return {
    id: f.id,
    team: f.team,
    pos: { x: round(f.pos.x), z: round(f.pos.z) },
    y: round(f.y),
    running: f.running,
    facing: round(f.facing),
    hp: round(f.hp),
    stamina: round(f.stamina),
    state: f.state,
    stateTick: f.stateTick,
    stateDuration: f.stateDuration,
    move: f.move?.def.id ?? null,
    charge: f.state === 'charging' ? f.stateTick : round(f.move?.charge ?? 0),
    weapon: f.weapon,
    durability: f.durability,
    invulnerable: f.state !== 'ko' && f.state !== 'dead' && isInvulnerable(f, s.tick, c),
    parryLive: f.state === 'block' && f.parryEligible && s.tick - f.blockStartTick <= c.parryWindow,
    armored: hasArmor(f),
    bleeding: f.bleeds.length,
    hitstop: f.hitstop,
    lockTarget: f.lockTarget,
    money: f.money,
    kos: f.kos,
    deaths: f.deaths,
    assists: f.assists,
    curativos: f.curativos,
    koTick: f.koTick,
    raca: round(f.raca),
    buffed: s.tick <= f.buffUntil,
    counter: s.tick <= f.counterUntil,
    dodgeKind: f.dodgeKind,
    channel:
      f.state === 'healing' || f.state === 'eating' || f.state === 'reviving' || f.state === 'downed'
        ? round(Math.min(1, f.stateTick / Math.max(1, f.stateDuration)))
        : 0,
  };
}

const round = (v: number) => Math.round(v * 1000) / 1000;
