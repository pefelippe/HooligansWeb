import {
  addPlayer,
  type BotBrain,
  botInput,
  createBrain,
  createMatch,
  InputQueue,
  MATCH,
  matchBuy,
  matchEquip,
  type MatchResult,
  type MatchState,
  type PlayerInput,
  removePlayer,
  type RosterEntry,
  type ServerMessage,
  stepMatch,
  type StepHooks,
  type TeamSide,
  ticksLeft,
  toMatchInfo,
  toSnapshot,
  type CharacterVisual,
  type Vec2,
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
  level?: number;
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

/**
 * Compensação de lag do tiro: até 15 ticks (250 ms) para trás. Mais que isso, quem tem ping alto
 * mira um pouco à frente. O cliente diz o que via (`view`); mentir só rende até esse teto.
 */
const MAX_REWIND = 15;

/** Quem cai da conexão fica com a vaga (um bot joga no lugar) por 60 s; voltou, retoma o mesmo lutador. */
export const RECONNECT_TICKS = 60 * 60;

/** Uma partida. Na fila rápida, 10×10 com bots nas vagas sem humano; numa sala, o líder define os bots. */
export class GameMatch {
  readonly state: MatchState;
  private readonly clients = new Map<string, MatchClient>();
  private readonly inputs = new Map<string, InputQueue>();
  private readonly brains = new Map<string, BotBrain>();
  /** Humanos que caíram: tick até quando a vaga fica reservada. */
  private readonly away = new Map<string, number>();
  /** Posições dos lutadores nos últimos MAX_REWIND ticks (por tick). */
  private readonly history = new Map<number, Map<string, Vec2>>();
  /** Atraso de cada cliente em ticks: o tick atual menos o tick que ele estava vendo. */
  private readonly lag = new Map<string, number>();
  private readonly hooks: StepHooks = {
    shotView: (id) => {
      const l = this.lag.get(id);
      return l ? this.history.get(this.state.sim.tick - l) : undefined;
    },
  };
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
    this.away.delete(userId);
    this.brains.delete(userId);
    const c = this.clients.get(userId);
    this.clients.delete(userId);
    this.inputs.delete(userId);
    if (this.state.roster[userId]) removePlayer(this.state, userId);
    c?.close(4009, 'expulso');
    this.broadcastRoster();
  }

  /** Vaga reservada para quem caiu e ainda pode voltar. */
  isAway(userId: string): boolean {
    return this.away.has(userId);
  }

  join(c: MatchClient): boolean {
    if (this.kicked.has(c.userId)) return false;
    if (this.away.delete(c.userId)) this.brains.delete(c.userId); // voltou: devolve o controle
    if (!this.state.roster[c.userId]) {
      if (this.humans(c.team) >= this.maxPerTeam) return false;
      // Fila rápida: o humano sempre tira um bot. Sala: só se o time estiver cheio.
      if (this.autoBots || this.humans(c.team) + this.bots(c.team) >= this.maxPerTeam) this.removeOneBot(c.team);
      addPlayer(this.state, { id: c.userId, nick: c.nick, team: c.team, bot: false, ...(c.level ? { level: c.level } : {}), ...(c.visual ? { visual: c.visual } : {}) });
    }
    // Mesma conta conectando de novo (outra aba, ou voltou antes do servidor notar a queda): a nova vale.
    const prev = this.clients.get(c.userId);
    if (prev && prev !== c) prev.close(4010, 'conectado em outro lugar');
    this.clients.set(c.userId, c);
    c.send({ t: 'welcome', you: c.userId, matchId: this.id, team: c.team, tick: this.state.sim.tick, seed: this.seed });
    this.broadcastRoster();
    if (this.state.result) c.send({ t: 'matchEnd', result: this.state.result });
    return true;
  }

  /** `client`: a conexão que fechou. Se o jogador já está numa conexão mais nova, não faz nada. */
  leave(userId: string, client?: MatchClient): void {
    if (client && this.clients.get(userId) !== client) return;
    this.clients.delete(userId);
    this.inputs.delete(userId);
    const r = this.state.roster[userId];
    if (r && !r.bot && this.playing) {
      // Segura a vaga: um bot controla o lutador até ele voltar ou o prazo acabar.
      this.away.set(userId, this.state.sim.tick + RECONNECT_TICKS);
      this.brains.set(userId, createBrain(userId, this.seed ^ this.botSeq++));
    }
  }

  /** Prazo de volta acabou: sai de vez (na fila rápida, entra um bot no lugar). */
  private expireAway(): void {
    for (const [userId, until] of this.away) {
      if (this.state.sim.tick < until) continue;
      this.away.delete(userId);
      this.brains.delete(userId);
      const r = this.state.roster[userId];
      if (!r) continue;
      removePlayer(this.state, userId);
      if (this.autoBots) this.addBot(r.team);
      this.broadcastRoster();
    }
  }

  setInput(userId: string, seq: number, input: PlayerInput, view?: unknown): void {
    if (typeof view === 'number' && Number.isFinite(view)) this.lag.set(userId, Math.max(0, Math.min(MAX_REWIND, Math.round(this.state.sim.tick - view))));
    let q = this.inputs.get(userId);
    if (!q) this.inputs.set(userId, (q = new InputQueue()));
    q.push(seq, input);
  }

  equip(userId: string, item: string): void {
    const r = matchEquip(this.state, userId, item);
    if (r) this.clients.get(userId)?.send({ t: 'buyResult', ok: r.ok, item, ...(r.ok ? {} : { reason: r.reason }) });
  }

  buy(userId: string, item: string): void {
    const r = matchBuy(this.state, userId, item);
    this.clients.get(userId)?.send({ t: 'buyResult', ok: r.ok, item, ...(r.ok ? {} : { reason: r.reason }) });
  }

  private recordHistory(): void {
    const sim = this.state.sim;
    this.history.set(sim.tick, new Map(sim.fighters.map((f) => [f.id, { x: f.pos.x, z: f.pos.z }])));
    this.history.delete(sim.tick - MAX_REWIND - 1);
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
    const events = stepMatch(this.state, inputs, this.hooks);
    this.recordHistory();
    if (this.away.size) this.expireAway();
    if (events.length) this.broadcast({ t: 'events', events });
    const sim = this.state.sim;
    const every = sim.fighters.length > BIG_MATCH ? SNAPSHOT_EVERY_BIG : SNAPSHOT_EVERY;
    if (sim.tick % every === 0 || !this.playing) {
      const fighters = sim.fighters.map((f) => toSnapshot(sim, f));
      const match = toMatchInfo(this.state, ticksLeft(this.state));
      for (const c of this.clients.values()) {
        const self = sim.fighters.find((f) => f.id === c.userId);
        c.send({ t: 'snapshot', tick: sim.tick, ackSeq: this.inputs.get(c.userId)?.ack ?? 0, match, fighters, throws: sim.throwables ?? [], clouds: sim.clouds ?? [], ...(self ? { self } : {}) });
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
