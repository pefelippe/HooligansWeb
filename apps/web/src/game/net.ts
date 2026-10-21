import {
  type ClientMessage,
  type Fighter,
  type FighterSnapshot,
  type MatchEvent,
  type MatchResult,
  type MatchSnapshotInfo,
  type PlayerInput,
  PROTOCOL_VERSION,
  type RosterEntry,
  type ServerMessage,
  type TeamSide,
  TICK_MS,
} from '@torcidas/shared';

// Conexão com o game server. Os outros lutadores são desenhados a partir dos snapshots
// interpolados com um pequeno atraso; o próprio lutador é previsto localmente (engine + Predictor).
// TODO(marco netcode): compensação de lag no servidor (rebobinar hitboxes).

interface Snap {
  tick: number;
  recvAt: number;
  match: MatchSnapshotInfo;
  fighters: Map<string, FighterSnapshot>;
}

/** Atraso mínimo de interpolação em ticks: snapshots chegam a cada 2 ticks; 4 cobre jitter. */
const INTERP_DELAY = 4;

export interface Welcome {
  you: string;
  matchId: string;
  team: TeamSide;
  seed: number;
}

export interface NetHandlers {
  onWelcome(w: Welcome): void;
  onRoster(players: RosterEntry[]): void;
  onEvents(events: MatchEvent[]): void;
  onBuyResult(ok: boolean, item: string, reason?: string): void;
  onMatchEnd(result: MatchResult): void;
  onClose(reason: string): void;
  /** Snapshot cru (estado completo do próprio lutador + ack), para a predição reconciliar. */
  onSnapshot(tick: number, ackSeq: number, self: Fighter | undefined, fighters: FighterSnapshot[]): void;
}

export class GameConnection {
  private ws: WebSocket;
  private snaps: Snap[] = [];
  private seq = 0;
  rtt = 0;
  private pingTimer: ReturnType<typeof setInterval> | undefined;

  constructor(url: string, ticket: string, private readonly h: NetHandlers) {
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      this.send({ t: 'hello', v: PROTOCOL_VERSION, ticket });
      this.pingTimer = setInterval(() => this.send({ t: 'ping', at: performance.now() }), 2000);
    };
    this.ws.onmessage = (ev) => this.receive(JSON.parse(String(ev.data)) as ServerMessage);
    this.ws.onclose = (ev) => {
      clearInterval(this.pingTimer);
      this.h.onClose(ev.reason || `conexão encerrada (${ev.code})`);
    };
  }

  close(): void {
    clearInterval(this.pingTimer);
    this.ws.onclose = null;
    this.ws.close();
  }

  private send(msg: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Manda o input e devolve o seq usado (a predição aplica o mesmo input localmente). */
  sendInput(input: PlayerInput): number {
    this.send({ t: 'input', seq: ++this.seq, input });
    return this.seq;
  }

  buy(item: string): void {
    this.send({ t: 'buy', item });
  }

  private receive(msg: ServerMessage): void {
    switch (msg.t) {
      case 'welcome':
        this.h.onWelcome(msg);
        break;
      case 'roster':
        this.h.onRoster(msg.players);
        break;
      case 'snapshot':
        this.snaps.push({ tick: msg.tick, recvAt: performance.now(), match: msg.match, fighters: new Map(msg.fighters.map((f) => [f.id, f])) });
        if (this.snaps.length > 30) this.snaps.shift();
        this.h.onSnapshot(msg.tick, msg.ackSeq, msg.self, msg.fighters);
        break;
      case 'events':
        this.h.onEvents(msg.events);
        break;
      case 'buyResult':
        this.h.onBuyResult(msg.ok, msg.item, msg.reason);
        break;
      case 'matchEnd':
        this.h.onMatchEnd(msg.result);
        break;
      case 'pong':
        this.rtt = performance.now() - msg.at;
        break;
      case 'error':
        console.warn('[net] erro do servidor', msg.code);
        break;
    }
  }

  get latest(): Snap | undefined {
    return this.snaps[this.snaps.length - 1];
  }

  /** Tick estimado do servidor agora. */
  serverTick(now = performance.now()): number {
    const l = this.latest;
    return l ? l.tick + (now - l.recvAt) / TICK_MS : 0;
  }

  /** Estado interpolado de todos os lutadores no tempo de render. */
  sample(now = performance.now()): { tick: number; match: MatchSnapshotInfo; fighters: FighterSnapshot[] } | null {
    const l = this.latest;
    if (!l) return null;
    // Partidas grandes mandam snapshot mais espaçado: o atraso acompanha (2 intervalos).
    const prev = this.snaps[this.snaps.length - 2];
    const gap = prev ? l.tick - prev.tick : 2;
    const renderTick = Math.min(this.serverTick(now) - Math.max(INTERP_DELAY, gap * 2), l.tick);
    let a = this.snaps[0] as Snap;
    let b = a;
    for (let i = 0; i < this.snaps.length - 1; i++) {
      const s0 = this.snaps[i] as Snap;
      const s1 = this.snaps[i + 1] as Snap;
      if (s0.tick <= renderTick && renderTick <= s1.tick) {
        a = s0;
        b = s1;
        break;
      }
      if (s1.tick <= renderTick) {
        a = s1;
        b = s1;
      }
    }
    const span = b.tick - a.tick;
    const alpha = span > 0 ? Math.max(0, Math.min(1, (renderTick - a.tick) / span)) : 0;
    const fighters: FighterSnapshot[] = [];
    for (const fa of a.fighters.values()) {
      const fb = b.fighters.get(fa.id);
      if (!fb) {
        fighters.push(fa);
        continue;
      }
      const sameState = fa.state === fb.state && fb.stateTick >= fa.stateTick;
      fighters.push({
        ...(alpha < 0.5 ? fa : fb),
        pos: { x: fa.pos.x + (fb.pos.x - fa.pos.x) * alpha, z: fa.pos.z + (fb.pos.z - fa.pos.z) * alpha },
        y: fa.y + (fb.y - fa.y) * alpha,
        facing: lerpAngle(fa.facing, fb.facing, alpha),
        state: sameState ? fa.state : alpha < 0.5 ? fa.state : fb.state,
        stateTick: sameState ? fa.stateTick + (fb.stateTick - fa.stateTick) * alpha : alpha < 0.5 ? fa.stateTick : fb.stateTick,
        move: sameState ? fa.move : alpha < 0.5 ? fa.move : fb.move,
      });
    }
    return { tick: a.tick + span * alpha, match: b.match, fighters };
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}
