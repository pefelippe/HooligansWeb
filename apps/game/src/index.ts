import type { ClientMessage, LobbyClientMessage, LobbyServerMessage, MatchResult, MatchTicketClaims, RoomTicketClaims, ServerMessage, TeamSide } from '@torcidas/shared';
import { MATCH, PROTOCOL_VERSION, ROOM, TICK_MS, TICK_RATE, validateVisual } from '@torcidas/shared';
import { jwtVerify, SignJWT } from 'jose';
import { randomInt, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import { WebSocketServer } from 'ws';
import { GameMatch } from './match';
import { type Room, RoomManager } from './rooms';

const isProd = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.GAME_PORT ?? 4000);
const API_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:3000';
const ticketSecret = process.env.MATCH_TICKET_SECRET ?? (isProd ? undefined : 'dev-ticket-secret-0000');
const internalSecret = process.env.INTERNAL_SECRET ?? (isProd ? undefined : 'dev-internal-secret-0000');
if (!ticketSecret || !internalSecret) throw new Error('MATCH_TICKET_SECRET/INTERNAL_SECRET não definidos');
const ticketKey = new TextEncoder().encode(ticketSecret);
/** URL que o navegador usa para conectar aqui (vai nos tickets de partida das salas). */
const PUBLIC_URL = process.env.GAME_PUBLIC_URL ?? `ws://localhost:${PORT}`;
/** Só para testes/dev: partidas curtas. Padrão: 10 min. */
const durationTicks = !isProd && process.env.MATCH_DURATION_S ? Number(process.env.MATCH_DURATION_S) * TICK_RATE : undefined;

const matches = new Map<string, GameMatch>();
const tickDurations: number[] = [];

/** Grava as estatísticas dos humanos na API. Falha não derruba a partida. */
async function reportResult(m: GameMatch, result: MatchResult): Promise<void> {
  const players = result.players
    .filter((p) => !p.bot)
    .map((p) => ({ userId: p.id, kos: p.kos, deaths: p.deaths, assists: p.assists, won: result.winner === p.team }));
  if (!players.length) return;
  try {
    const res = await fetch(`${API_URL}/internal/match-result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': internalSecret! },
      body: JSON.stringify({ matchId: m.id, players }),
    });
    if (!res.ok) console.error(`[game] match-result HTTP ${res.status}`);
  } catch (e) {
    console.error('[game] falha ao gravar resultado', e);
  }
}

/** Partida rápida aberta com vaga no time e pelo menos 1 min de jogo; senão cria uma. Partidas de sala ficam de fora. */
function allocate(team: TeamSide): GameMatch {
  for (const m of matches.values()) {
    if (m.roomId === null && m.playing && m.humans(team) < MATCH.teamSize && m.ticksLeft() > Math.min(60 * TICK_RATE, (durationTicks ?? MATCH.durationTicks) / 2)) return m;
  }
  const m = new GameMatch(randomUUID(), randomInt(1, 2 ** 31 - 1), (mm, r) => void reportResult(mm, r), { ...(durationTicks ? { durationTicks } : {}) });
  matches.set(m.id, m);
  console.info(`[game] nova partida ${m.id} (seed ${m.seed})`);
  return m;
}

/** Ticket de partida assinado aqui mesmo (salas): mesmo formato e chave da API. */
function signMatchTicket(claims: MatchTicketClaims): Promise<string> {
  return new SignJWT({ ...claims }).setProtectedHeader({ alg: 'HS256' }).setSubject(claims.userId).setIssuedAt().setExpirationTime('2m').sign(ticketKey);
}

const rooms = new RoomManager({
  serverUrl: PUBLIC_URL,
  signMatchTicket,
  createMatch: (roomId, bots, onEnd) => {
    const m = new GameMatch(
      randomUUID(),
      randomInt(1, 2 ** 31 - 1),
      (mm, r) => {
        void reportResult(mm, r);
        onEnd();
      },
      { roomId, bots, maxPerTeam: ROOM.maxPerTeam, autoBots: false, ...(durationTicks ? { durationTicks } : {}) },
    );
    matches.set(m.id, m);
    console.info(`[game] partida de sala ${m.id} (seed ${m.seed})`);
    return m;
  },
});
// Sala vazia some depois de 5 min.
setInterval(() => rooms.sweep(5 * 60_000), 30_000).unref();

// Loop de tick fixo, corrigindo o drift do setTimeout.
let next = performance.now();
function loop() {
  next += TICK_MS;
  for (const m of matches.values()) {
    tickDurations.push(m.tick());
    if (tickDurations.length > 6000) tickDurations.shift();
    // Partida encerrada some 2 min depois (ou quando todos saem).
    if (m.endedAt !== null && (m.clientCount === 0 || performance.now() - m.endedAt > 120_000)) matches.delete(m.id);
  }
  // Atraso grande (processo suspenso): não tenta "alcançar" rodando centenas de ticks.
  if (performance.now() - next > 250) next = performance.now();
  setTimeout(loop, Math.max(0, next - performance.now()));
}
loop();

function p99(xs: number[]): number {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.99)] ?? 0;
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c: Buffer) => {
      body += c;
      if (body.length > 10_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (e) {
        reject(e);
      }
    });
  });
}

const http = createServer(async (req, res) => {
  const json = (code: number, body: unknown) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  if (req.url === '/health') return json(200, { ok: true, matches: matches.size });
  if (req.url === '/metrics') {
    const humans = [...matches.values()].reduce((n, m) => n + m.humans(0) + m.humans(1), 0);
    return res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' }).end(
      [
        '# TYPE torcidas_matches gauge',
        `torcidas_matches ${matches.size}`,
        '# TYPE torcidas_players gauge',
        `torcidas_players ${humans}`,
        '# TYPE torcidas_rooms gauge',
        `torcidas_rooms ${rooms.count}`,
        '# TYPE torcidas_tick_ms_p99 gauge',
        `torcidas_tick_ms_p99 ${p99(tickDurations).toFixed(4)}`,
        '',
      ].join('\n'),
    );
  }
  if (req.url === '/internal/allocate' && req.method === 'POST') {
    if (req.headers['x-internal-secret'] !== internalSecret) return json(403, { error: 'proibido' });
    const body = (await readJson(req).catch(() => ({}))) as { team?: unknown };
    if (body.team !== 0 && body.team !== 1) return json(400, { error: 'time_invalido' });
    return json(200, { matchId: allocate(body.team).id });
  }
  if (req.url?.startsWith('/internal/rooms')) {
    if (req.headers['x-internal-secret'] !== internalSecret) return json(403, { error: 'proibido' });
    if (req.url === '/internal/rooms' && req.method === 'GET') return json(200, { rooms: rooms.listPublic() });
    const body = (await readJson(req).catch(() => ({}))) as Record<string, unknown>;
    if (req.url === '/internal/rooms' && req.method === 'POST') {
      const { nome, publica, leaderId } = body;
      if (typeof nome !== 'string' || typeof leaderId !== 'string') return json(400, { error: 'invalido' });
      const room = rooms.create(nome, publica === true, leaderId);
      console.info(`[game] sala ${room.code} criada (${room.publica ? 'pública' : 'privada'})`);
      return json(200, { roomId: room.id, code: room.code });
    }
    if (req.url === '/internal/rooms/check' && req.method === 'POST') {
      const { code, userId, team } = body;
      if (typeof code !== 'string' || typeof userId !== 'string' || (team !== 0 && team !== 1)) return json(400, { error: 'invalido' });
      const room = rooms.byCodeOf(code);
      if (!room) return json(404, { error: 'sala_inexistente' });
      const err = room.canJoin(userId, team);
      if (err) return json(409, { error: err });
      return json(200, { roomId: room.id, code: room.code });
    }
  }
  return json(404, { error: 'nao_encontrado' });
});

const wss = new WebSocketServer({ server: http, maxPayload: 4096 });

wss.on('connection', (ws) => {
  let joined: { match: GameMatch; userId: string } | null = null;
  let lobby: { room: Room; userId: string; send: (msg: LobbyServerMessage) => void } | null = null;
  const send = (msg: ServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  const sendLobby = (msg: LobbyServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  const helloTimeout = setTimeout(() => ws.close(4001, 'sem hello'), 5000);
  // Rate limit simples de mensagens: o cliente manda ~60 inputs/s.
  let budget = 120;
  const refill = setInterval(() => (budget = 120), 1000);

  ws.on('message', async (raw) => {
    if (--budget < 0) return ws.close(4008, 'muitas mensagens');
    let msg: ClientMessage | LobbyClientMessage;
    try {
      msg = JSON.parse(String(raw)) as ClientMessage | LobbyClientMessage;
    } catch {
      return ws.close(4002, 'mensagem inválida');
    }
    if (lobby) return onLobbyMessage(lobby, msg as LobbyClientMessage);
    if (!joined && msg.t === 'helloLobby') {
      if (msg.v !== PROTOCOL_VERSION) return ws.close(4003, 'protocolo');
      try {
        const { payload } = await jwtVerify<RoomTicketClaims>(msg.ticket, ticketKey);
        if (payload.kind !== 'room') return ws.close(4004, 'ticket inválido');
        clearTimeout(helloTimeout);
        const room = rooms.get(payload.roomId);
        if (!room) return ws.close(4005, 'sala não existe');
        const visual = validateVisual(payload.visual) ?? undefined;
        const member = { userId: payload.userId, nick: payload.nick, team: payload.team, ...(visual ? { visual } : {}), send: sendLobby, close: (code: number, reason: string) => ws.close(code, reason) };
        const err = room.join(member);
        if (err) return ws.close(err === 'expulso' ? 4009 : 4006, err);
        lobby = { room, userId: payload.userId, send: sendLobby };
      } catch {
        ws.close(4004, 'ticket inválido');
      }
      return;
    }
    if (!joined) {
      if (msg.t !== 'hello' || msg.v !== PROTOCOL_VERSION) return ws.close(4003, 'protocolo');
      try {
        const { payload } = await jwtVerify<MatchTicketClaims>(msg.ticket, ticketKey);
        clearTimeout(helloTimeout);
        const match = matches.get(payload.matchId);
        if (!match) return ws.close(4005, 'partida não existe');
        if (msg.t !== 'hello') return ws.close(4003, 'protocolo');
        // O ticket é assinado pela API, mas o visual é revalidado aqui (formato desconhecido = sem visual).
        const visual = validateVisual(payload.visual) ?? undefined;
        const close = (code: number, reason: string) => ws.close(code, reason);
        if (!match.join({ userId: payload.userId, nick: payload.nick, team: payload.team, ...(visual ? { visual } : {}), send, close })) return ws.close(4006, 'sem vaga na partida');
        joined = { match, userId: payload.userId };
      } catch {
        ws.close(4004, 'ticket inválido');
      }
      return;
    }
    switch (msg.t) {
      case 'input':
        joined.match.setInput(joined.userId, msg.seq, msg.input);
        break;
      case 'buy':
        joined.match.buy(joined.userId, String(msg.item));
        break;
      case 'ping':
        send({ t: 'pong', at: msg.at });
        break;
    }
  });

  ws.on('close', () => {
    clearTimeout(helloTimeout);
    clearInterval(refill);
    joined?.match.leave(joined.userId);
    if (lobby) lobby.room.leave(lobby.userId, lobby.send);
  });
});

/** Mensagens do lobby: tudo que muda a sala é validado como "só o líder" dentro da Room. */
function onLobbyMessage(l: { room: Room; userId: string; send: (msg: LobbyServerMessage) => void }, msg: LobbyClientMessage): void {
  let err: string | null = null;
  switch (msg.t) {
    case 'kick':
      err = l.room.kick(l.userId, String(msg.userId));
      break;
    case 'setBots':
      err = l.room.setBots(l.userId, msg.team, Number(msg.count));
      break;
    case 'setPublic':
      err = l.room.setPublic(l.userId, msg.publica === true);
      break;
    case 'start':
      err = l.room.start(l.userId);
      break;
    case 'rejoin':
      err = l.room.rejoin(l.userId);
      break;
    case 'ping':
      l.send({ t: 'pong', at: msg.at });
      break;
    default:
      err = 'invalido';
  }
  if (err) l.send({ t: 'error', code: err });
}

http.listen(PORT, () => console.info(`[game] ouvindo em :${PORT}`));
