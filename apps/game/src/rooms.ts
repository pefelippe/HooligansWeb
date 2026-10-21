import { type CharacterVisual, type LobbyServerMessage, type MatchTicketClaims, ROOM, type RoomInfo, type RoomSummary, type TeamSide } from '@torcidas/shared';
import { randomInt, randomUUID } from 'node:crypto';

// Salas: lobby + partidas. O líder configura (bots, pública/privada, expulsar) e começa;
// no fim da partida todo mundo volta para o lobby. Vivem só na memória deste processo.

/** Partida vista pela sala (GameMatch implementa). */
export interface RoomMatch {
  readonly id: string;
  readonly playing: boolean;
  setBots(team: TeamSide, count: number): void;
  kick(userId: string): void;
}

export interface RoomDeps {
  /** Cria e registra uma partida; `onEnd` volta a sala para o lobby. */
  createMatch(roomId: string, bots: [number, number], onEnd: () => void): RoomMatch;
  signMatchTicket(claims: MatchTicketClaims): Promise<string>;
  serverUrl: string;
}

export interface RoomMember {
  userId: string;
  nick: string;
  team: TeamSide;
  visual?: CharacterVisual;
  send(msg: LobbyServerMessage): void;
  close(code: number, reason: string): void;
}

export type RoomError = 'sala_inexistente' | 'expulso' | 'sala_cheia' | 'time_cheio' | 'so_o_lider' | 'ja_em_partida' | 'sem_jogadores' | 'invalido';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O, 1/I

export class Room {
  readonly id = randomUUID();
  private readonly members = new Map<string, RoomMember & { joinedAt: number }>();
  private readonly banned = new Set<string>();
  private joinSeq = 0;
  bots: [number, number] = [5, 5];
  match: RoomMatch | null = null;
  /** Momento em que ficou vazia (para apagar depois de um tempo). */
  emptySince: number | null = null;

  constructor(
    readonly code: string,
    public nome: string,
    public publica: boolean,
    /** Quem criou: vira líder ao entrar (até lá, ninguém é). */
    private leaderId: string,
    private readonly deps: RoomDeps,
  ) {
    this.emptySince = Date.now();
  }

  get fase(): RoomInfo['fase'] {
    return this.match?.playing ? 'playing' : 'lobby';
  }

  get size(): number {
    return this.members.size;
  }

  humans(team: TeamSide): number {
    let n = 0;
    for (const m of this.members.values()) if (m.team === team) n++;
    return n;
  }

  /** Lutadores no total (humanos + bots configurados). */
  get total(): number {
    return this.members.size + this.bots[0] + this.bots[1];
  }

  isBanned(userId: string): boolean {
    return this.banned.has(userId);
  }

  /** Checagem antes de emitir o ticket (API) e de novo ao entrar no lobby. */
  canJoin(userId: string, team: TeamSide): RoomError | null {
    if (this.banned.has(userId)) return 'expulso';
    if (this.members.has(userId)) return null; // reconectando
    if (this.humans(team) >= ROOM.maxPerTeam) return 'time_cheio';
    // Bots cedem a vaga para humanos; só humanos contam para "sala cheia".
    if (this.members.size >= ROOM.maxPlayers) return 'sala_cheia';
    return null;
  }

  join(m: RoomMember): RoomError | null {
    const err = this.canJoin(m.userId, m.team);
    if (err) return err;
    const prev = this.members.get(m.userId);
    // Mesma conta em outra aba: a conexão antiga sai.
    if (prev) prev.close(4010, 'conectou em outra aba');
    this.members.set(m.userId, { ...m, joinedAt: prev?.joinedAt ?? this.joinSeq++ });
    this.emptySince = null;
    // Humano tira um bot se o time estourar o máximo.
    if (this.humans(m.team) + this.bots[m.team] > ROOM.maxPerTeam) this.bots[m.team] = ROOM.maxPerTeam - this.humans(m.team);
    if (!this.members.has(this.leaderId)) this.leaderId = this.oldest() ?? m.userId;
    this.broadcast();
    // Partida rolando: já manda o ticket para entrar nela.
    if (this.match?.playing) void this.sendMatchTicket(m.userId);
    return null;
  }

  /** `send` identifica a conexão: a aba antiga fechando depois de reconectar não remove a nova. */
  leave(userId: string, send?: RoomMember['send']): void {
    const cur = this.members.get(userId);
    if (!cur || (send && cur.send !== send)) return;
    this.members.delete(userId);
    if (this.leaderId === userId) this.leaderId = this.oldest() ?? userId;
    if (!this.members.size) this.emptySince = Date.now();
    this.broadcast();
  }

  kick(by: string, userId: string): RoomError | null {
    if (by !== this.leaderId) return 'so_o_lider';
    if (by === userId || !this.members.has(userId)) return 'invalido';
    const m = this.members.get(userId);
    this.banned.add(userId);
    this.members.delete(userId);
    this.match?.kick(userId);
    m?.close(4009, 'expulso');
    this.broadcast();
    return null;
  }

  setBots(by: string, team: TeamSide, count: number): RoomError | null {
    if (by !== this.leaderId) return 'so_o_lider';
    if ((team !== 0 && team !== 1) || !Number.isInteger(count)) return 'invalido';
    this.bots[team] = Math.max(0, Math.min(count, ROOM.maxPerTeam - this.humans(team)));
    if (this.match?.playing) this.match.setBots(team, this.bots[team]);
    this.broadcast();
    return null;
  }

  setPublic(by: string, publica: boolean): RoomError | null {
    if (by !== this.leaderId) return 'so_o_lider';
    this.publica = !!publica;
    this.broadcast();
    return null;
  }

  start(by: string): RoomError | null {
    if (by !== this.leaderId) return 'so_o_lider';
    if (this.match?.playing) return 'ja_em_partida';
    if (!this.members.size) return 'sem_jogadores';
    const match = this.deps.createMatch(this.id, [...this.bots], () => {
      if (this.match === match) this.broadcast(); // fase volta para 'lobby'
    });
    this.match = match;
    this.broadcast();
    for (const id of this.members.keys()) void this.sendMatchTicket(id);
    return null;
  }

  /** Membro que saiu da tela da partida quer voltar enquanto ela roda. */
  rejoin(userId: string): RoomError | null {
    if (!this.members.has(userId)) return 'invalido';
    if (!this.match?.playing) return 'invalido';
    void this.sendMatchTicket(userId);
    return null;
  }

  info(): RoomInfo {
    const players = [...this.members.values()].sort((a, b) => a.joinedAt - b.joinedAt).map((m) => ({ id: m.userId, nick: m.nick, team: m.team }));
    return { id: this.id, code: this.code, nome: this.nome, publica: this.publica, liderId: this.leaderId, fase: this.fase, players, bots: [...this.bots] };
  }

  summary(): RoomSummary {
    const lider = this.members.get(this.leaderId)?.nick ?? '';
    return { code: this.code, nome: this.nome, lider, humanos: this.members.size, total: this.total, fase: this.fase };
  }

  private async sendMatchTicket(userId: string): Promise<void> {
    const m = this.members.get(userId);
    const match = this.match;
    if (!m || !match) return;
    const ticket = await this.deps.signMatchTicket({
      userId,
      matchId: match.id,
      team: m.team,
      nick: m.nick,
      serverUrl: this.deps.serverUrl,
      ...(m.visual ? { visual: m.visual } : {}),
    });
    this.members.get(userId)?.send({ t: 'matchStart', ticket, serverUrl: this.deps.serverUrl });
  }

  private oldest(): string | undefined {
    let best: (RoomMember & { joinedAt: number }) | undefined;
    for (const m of this.members.values()) if (!best || m.joinedAt < best.joinedAt) best = m;
    return best?.userId;
  }

  private broadcast(): void {
    const room = this.info();
    for (const m of this.members.values()) m.send({ t: 'room', room, you: m.userId });
  }
}

/** Todas as salas do processo, por id e por código. */
export class RoomManager {
  private readonly byId = new Map<string, Room>();
  private readonly byCode = new Map<string, Room>();

  constructor(private readonly deps: RoomDeps) {}

  create(nome: string, publica: boolean, leaderId: string): Room {
    let code = '';
    do code = Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
    while (this.byCode.has(code));
    const room = new Room(code, nome, publica, leaderId, this.deps);
    this.byId.set(room.id, room);
    this.byCode.set(code, room);
    return room;
  }

  get(id: string): Room | undefined {
    return this.byId.get(id);
  }

  byCodeOf(code: string): Room | undefined {
    return this.byCode.get(code.trim().toUpperCase());
  }

  listPublic(): RoomSummary[] {
    return [...this.byId.values()].filter((r) => r.publica && r.size > 0).map((r) => r.summary());
  }

  /** Apaga salas vazias há mais de `ttlMs`. */
  sweep(ttlMs: number, now = Date.now()): void {
    for (const r of this.byId.values()) {
      if (r.emptySince !== null && now - r.emptySince > ttlMs) {
        this.byId.delete(r.id);
        this.byCode.delete(r.code);
      }
    }
  }

  get count(): number {
    return this.byId.size;
  }
}
