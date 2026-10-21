import {
  addPlayer,
  type BotBrain,
  botInput,
  createBrain,
  createMatch,
  InputQueue,
  MATCH,
  matchBuy,
  type MatchResult,
  type MatchState,
  type PlayerInput,
  removePlayer,
  type RosterEntry,
  type ServerMessage,
  stepMatch,
  type TeamSide,
  ticksLeft,
  toMatchInfo,
  toSnapshot,
  type CharacterVisual,
} from '@torcidas/shared';

const SNAPSHOT_EVERY = 2; // 60 Hz de simulação, 30 Hz de snapshot
/** Partida grande (sala com mais de 30 lutadores): 20 Hz, o snapshot de 50 passa de 24 KB. */
const SNAPSHOT_EVERY_BIG = 3;
const BIG_MATCH = 30;

export interface MatchClient {
  userId: string;
  nick: string;
  team: TeamSide;
  visual?: CharacterVisual;
  send(msg: ServerMessage): void;
  /** Fecha a conexão (expulso da sala). */
  close(code: number, reason: string): void;
}

export interface MatchOptions {
  durationTicks?: number;
  /** Bots iniciais por time. Padrão: completa o time da fila rápida (10). */
  bots?: [number, number];
  /** Máximo de lutadores por time (humanos + bots). */
  maxPerTeam?: number;
  /** Fila rápida: quem sai vira bot e quem entra tira um bot. Sala: o líder decide os bots. */
  autoBots?: boolean;
  /** Partida de sala: a fila rápida nunca põe ninguém nela. */
  roomId?: string;
}

/** Uma partida. Na fila rápida, 10×10 com bots nas vagas sem humano; numa sala, o líder define os bots. */
export class GameMatch {
  readonly state: MatchState;
  private readonly clients = new Map<string, MatchClient>();
  private readonly inputs = new Map<string, InputQueue>();
  private readonly brains = new Map<string, BotBrain>();
  private botSeq = 0;
  /** Vaga de bot por time: o bot N tem a mesma "personalidade" nos dois times (partida justa). */
  private readonly botSlot: [number, number] = [0, 0];
  endedAt: number | null = null;
  private readonly maxPerTeam: number;
  private readonly autoBots: boolean;
  readonly roomId: string | null;
  /** Expulsos: o ticket de partida ainda vale por 2 min, então a partida também recusa. */
  private readonly kicked = new Set<string>();

  constructor(
    readonly id: string,
    readonly seed: number,
    private readonly onEnd: (m: GameMatch, result: MatchResult) => void,
    opts: MatchOptions = {},
  ) {
    this.state = createMatch(id, seed, opts.durationTicks);
    this.maxPerTeam = opts.maxPerTeam ?? MATCH.teamSize;
    this.autoBots = opts.autoBots ?? true;
    this.roomId = opts.roomId ?? null;
    const bots = opts.bots ?? [MATCH.teamSize, MATCH.teamSize];
    for (const team of [0, 1] as const) for (let i = 0; i < Math.min(bots[team], this.maxPerTeam); i++) this.addBot(team);
  }

  get playing(): boolean {
    return this.state.phase === 'playing';
  }

  get clientCount(): number {
    return this.clients.size;
  }

  humans(team: TeamSide): number {
    return Object.values(this.state.roster).filter((r) => r.team === team && !r.bot).length;
  }

  ticksLeft(): number {
    return ticksLeft(this.state);
  }

  bots(team: TeamSide): number {
    return Object.values(this.state.roster).filter((r) => r.team === team && r.bot).length;
  }

  private addBot(team: TeamSide): void {
    const id = `bot-${team}-${this.botSeq++}`;
    addPlayer(this.state, { id, nick: `Bot ${this.botSeq}`, team, bot: true });
    const slot = this.botSlot[team]++ % MATCH.teamSize;
    this.brains.set(id, createBrain(id, this.seed * 1000 + slot));
  }

  private removeOneBot(team: TeamSide): void {
    const bot = Object.values(this.state.roster).find((r) => r.team === team && r.bot);
    if (!bot) return;
    removePlayer(this.state, bot.id);
    this.brains.delete(bot.id);
  }

  /** Ajusta os bots de um time ao vivo (líder da sala). Respeita o máximo por time. */
  setBots(team: TeamSide, count: number): void {
    const target = Math.max(0, Math.min(count, this.maxPerTeam - this.humans(team)));
    while (this.bots(team) > target) this.removeOneBot(team);
    while (this.bots(team) < target) this.addBot(team);
    this.broadcastRoster();
  }

  /** Expulso da sala: sai da partida sem bot no lugar e a conexão fecha. */
  kick(userId: string): void {
    this.kicked.add(userId);
    const c = this.clients.get(userId);
    this.clients.delete(userId);
    this.inputs.delete(userId);
    if (this.state.roster[userId]) removePlayer(this.state, userId);
    c?.close(4009, 'expulso');
    this.broadcastRoster();
  }

  join(c: MatchClient): boolean {
    if (this.kicked.has(c.userId)) return false;
    if (!this.state.roster[c.userId]) {
      if (this.humans(c.team) >= this.maxPerTeam) return false;
      // Fila rápida: o humano sempre tira um bot. Sala: só se o time estiver cheio.
      if (this.autoBots || this.humans(c.team) + this.bots(c.team) >= this.maxPerTeam) this.removeOneBot(c.team);
      addPlayer(this.state, { id: c.userId, nick: c.nick, team: c.team, bot: false, ...(c.visual ? { visual: c.visual } : {}) });
    }
    this.clients.set(c.userId, c);
    c.send({ t: 'welcome', you: c.userId, matchId: this.id, team: c.team, tick: this.state.sim.tick, seed: this.seed });
    this.broadcastRoster();
    if (this.state.result) c.send({ t: 'matchEnd', result: this.state.result });
    return true;
  }

  leave(userId: string): void {
    this.clients.delete(userId);
    this.inputs.delete(userId);
    const r = this.state.roster[userId];
    if (r && !r.bot && this.playing) {
      removePlayer(this.state, userId);
      if (this.autoBots) this.addBot(r.team);
      this.broadcastRoster();
    }
  }

  setInput(userId: string, seq: number, input: PlayerInput): void {
    let q = this.inputs.get(userId);
    if (!q) this.inputs.set(userId, (q = new InputQueue()));
    q.push(seq, input);
  }

  buy(userId: string, item: string): void {
    const r = matchBuy(this.state, userId, item);
    this.clients.get(userId)?.send({ t: 'buyResult', ok: r.ok, item, ...(r.ok ? {} : { reason: r.reason }) });
  }

  /** Um tick de simulação. Devolve a duração em ms (para /metrics). */
  tick(): number {
    if (!this.playing) return 0;
    const t0 = performance.now();
    const inputs: Record<string, PlayerInput> = {};
    // Um input por tick, na ordem em que o cliente mandou (a predição do cliente conta com isso).
    // Se faltar, repete o último: seguro, porque ações só disparam na borda do botão.
    for (const [id, q] of this.inputs) inputs[id] = q.next();
    for (const [id, brain] of this.brains) inputs[id] = botInput(this.state, brain);
    const events = stepMatch(this.state, inputs);
    if (events.length) this.broadcast({ t: 'events', events });
    const sim = this.state.sim;
    const every = sim.fighters.length > BIG_MATCH ? SNAPSHOT_EVERY_BIG : SNAPSHOT_EVERY;
    if (sim.tick % every === 0 || !this.playing) {
      const fighters = sim.fighters.map((f) => toSnapshot(sim, f));
      const match = toMatchInfo(this.state, ticksLeft(this.state));
      for (const c of this.clients.values()) {
        const self = sim.fighters.find((f) => f.id === c.userId);
        c.send({ t: 'snapshot', tick: sim.tick, ackSeq: this.inputs.get(c.userId)?.ack ?? 0, match, fighters, ...(self ? { self } : {}) });
      }
    }
    if (!this.playing && this.state.result) {
      this.endedAt = performance.now();
      this.broadcast({ t: 'matchEnd', result: this.state.result });
      this.onEnd(this, this.state.result);
    }
    return performance.now() - t0;
  }

  private broadcastRoster(): void {
    const players: RosterEntry[] = Object.values(this.state.roster);
    this.broadcast({ t: 'roster', players });
  }

  private broadcast(msg: ServerMessage): void {
    for (const c of this.clients.values()) c.send(msg);
  }
}
