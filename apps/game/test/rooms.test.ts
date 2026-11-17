import type { LobbyServerMessage, MatchSize, MatchTicketClaims, TeamSide } from '@torcidas/shared';
import { describe, expect, it } from 'vitest';
import { type RoomDeps, RoomManager, type RoomMatch } from '../src/rooms';

/** Partida falsa: registra o que a sala pede. */
class FakeMatch implements RoomMatch {
  readonly id = `m${Math.random()}`;
  playing = true;
  readonly bots: Record<number, number> = {};
  readonly kicked: string[] = [];
  constructor(readonly initial: [number, number], readonly end: () => void) {}
  setBots(team: TeamSide, count: number): void {
    this.bots[team] = count;
  }
  kick(userId: string): void {
    this.kicked.push(userId);
  }
}

function setup(tamanho: MatchSize = 10) {
  const matches: FakeMatch[] = [];
  const tickets: MatchTicketClaims[] = [];
  const deps: RoomDeps = {
    serverUrl: 'ws://test',
    createMatch: (_roomId, bots, size, onEnd) => {
      expect(size).toBe(tamanho);
      const m = new FakeMatch(bots, onEnd);
      matches.push(m);
      return m;
    },
    signMatchTicket: async (c) => {
      tickets.push(c);
      return `ticket-${c.userId}`;
    },
  };
  const rooms = new RoomManager(deps);
  const room = rooms.create('Sala teste', true, 'lider', tamanho);
  const inbox = new Map<string, LobbyServerMessage[]>();
  const closed = new Map<string, number>();
  const member = (userId: string, team: TeamSide = 0) => {
    inbox.set(userId, []);
    return {
      userId,
      nick: userId,
      team,
      send: (m: LobbyServerMessage) => inbox.get(userId)?.push(m),
      close: (code: number) => void closed.set(userId, code),
    };
  };
  const lastRoom = (id: string) => [...(inbox.get(id) ?? [])].reverse().find((m) => m.t === 'room');
  return { rooms, room, member, inbox, closed, matches, tickets, lastRoom };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('salas', () => {
  it('quem cria e entra é o líder; os outros não mandam', () => {
    const { room, member } = setup();
    expect(room.join(member('lider'))).toBeNull();
    expect(room.join(member('ana', 1))).toBeNull();
    expect(room.info().liderId).toBe('lider');
    expect(room.setBots('ana', 0, 3)).toBe('so_o_lider');
    expect(room.kick('ana', 'lider')).toBe('so_o_lider');
    expect(room.start('ana')).toBe('so_o_lider');
    expect(room.setPublic('ana', false)).toBe('so_o_lider');
  });

  it('líder expulsa: a conexão fecha com 4009 e o expulso não volta', () => {
    const { room, member, closed, rooms } = setup();
    room.join(member('lider'));
    room.join(member('ana', 1));
    expect(room.kick('lider', 'ana')).toBeNull();
    expect(closed.get('ana')).toBe(4009);
    expect(room.info().players.map((p) => p.id)).toEqual(['lider']);
    expect(room.canJoin('ana', 1)).toBe('expulso');
    expect(room.join(member('ana', 1))).toBe('expulso');
    expect(rooms.byCodeOf(room.code.toLowerCase())).toBe(room);
  });

  it('bots: completam o tamanho da sala e nunca passam dele contando os humanos', () => {
    const { room, member } = setup(20);
    expect(room.bots).toEqual([20, 20]);
    room.join(member('lider'));
    room.join(member('b', 0));
    expect(room.bots[0]).toBe(18);
    expect(room.setBots('lider', 0, 40)).toBeNull();
    expect(room.bots[0]).toBe(18);
    expect(room.setBots('lider', 1, -5)).toBeNull();
    expect(room.bots[1]).toBe(0);
    // Mais um humano no time cheio: um bot sai para ele.
    room.join(member('c', 0));
    expect(room.bots[0]).toBe(17);
    expect(room.humans(0) + room.bots[0]).toBe(20);
  });

  it('20×20: 20 humanos por time e 40 no total', () => {
    const { room, member } = setup(20);
    for (let i = 0; i < 20; i++) expect(room.join(member(`a${i}`, 0))).toBeNull();
    expect(room.join(member('extra', 0))).toBe('time_cheio');
    for (let i = 0; i < 20; i++) expect(room.join(member(`b${i}`, 1))).toBeNull();
    expect(room.size).toBe(40);
    expect(room.join(member('extra2', 1))).toBe('time_cheio');
  });

  it('1×1: o líder contra um bot; o segundo humano tira o bot do outro time', () => {
    const { room, member } = setup(1);
    room.join(member('lider'));
    expect(room.bots).toEqual([0, 1]);
    expect(room.join(member('ana', 0))).toBe('time_cheio');
    expect(room.join(member('bia', 1))).toBeNull();
    expect(room.bots).toEqual([0, 0]);
    expect(room.info().tamanho).toBe(1);
  });

  it('líder sai: a liderança passa para o mais antigo', () => {
    const { room, member, lastRoom } = setup();
    room.join(member('lider'));
    room.join(member('ana', 1));
    room.join(member('bia', 0));
    room.leave('lider');
    expect(room.info().liderId).toBe('ana');
    const msg = lastRoom('bia');
    expect(msg?.t === 'room' && msg.room.liderId).toBe('ana');
  });

  it('começar: cria a partida com os bots, manda ticket para todos; no fim volta ao lobby', async () => {
    const { room, member, matches, tickets, inbox } = setup();
    room.join(member('lider'));
    room.join(member('ana', 1));
    room.setBots('lider', 0, 4);
    expect(room.start('lider')).toBeNull();
    expect(room.fase).toBe('playing');
    expect(room.start('lider')).toBe('ja_em_partida');
    expect(matches[0]?.initial).toEqual([4, 9]);
    await flush();
    expect(tickets.map((t) => t.userId).sort()).toEqual(['ana', 'lider']);
    expect(tickets[0]?.matchId).toBe(matches[0]?.id);
    expect(inbox.get('ana')?.some((m) => m.t === 'matchStart')).toBe(true);
    // Bots e expulsão valem durante a partida.
    room.setBots('lider', 1, 2);
    expect(matches[0]?.bots[1]).toBe(2);
    room.kick('lider', 'ana');
    expect(matches[0]?.kicked).toEqual(['ana']);
    // Quem entra com a partida rolando também recebe o ticket.
    room.join(member('bia', 1));
    await flush();
    expect(inbox.get('bia')?.some((m) => m.t === 'matchStart')).toBe(true);
    // Fim da partida: volta ao lobby.
    matches[0]!.playing = false;
    matches[0]!.end();
    expect(room.fase).toBe('lobby');
  });

  it('lista só as públicas com gente; sala vazia some depois do prazo', () => {
    const { rooms, room, member } = setup();
    const privada = rooms.create('Privada', false, 'x', 5);
    privada.join(member('x'));
    expect(rooms.listPublic()).toEqual([]);
    room.join(member('lider'));
    expect(rooms.listPublic().map((r) => r.code)).toEqual([room.code]);
    room.leave('lider');
    rooms.sweep(60_000, Date.now() + 61_000);
    expect(rooms.get(room.id)).toBeUndefined();
    expect(rooms.get(privada.id)).toBe(privada);
  });
});
