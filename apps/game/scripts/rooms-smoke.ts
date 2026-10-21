// Smoke test das salas, ponta a ponta: criar sala -> entrar por código -> bots -> começar ->
// os dois entram na partida -> líder expulsa -> expulso não volta.
// Uso: com api e game rodando (pnpm dev), rode pnpm --filter @torcidas/game rooms-smoke
import { type LobbyServerMessage, PROTOCOL_VERSION, type RoomInfo, type ServerMessage } from '@torcidas/shared';
import WebSocket from 'ws';

const API = process.env.API_URL ?? 'http://localhost:3000';
const ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function player(nick: string, torcidaId: string) {
  let cookie = '';
  const call = async (path: string, method = 'GET', body?: unknown) => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { 'content-type': 'application/json', origin: ORIGIN, cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.getSetCookie?.() ?? [];
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  };
  await call('/api/auth/sign-in/anonymous', 'POST', {});
  await call('/profile', 'PUT', { nick, torcidaId });
  return { call };
}

/** Conecta no WebSocket com o hello indicado e guarda tudo o que chegar. */
async function connect<T>(url: string, hello: unknown) {
  const ws = new WebSocket(url);
  const got: T[] = [];
  let closeCode: number | null = null;
  ws.on('message', (raw) => got.push(JSON.parse(String(raw)) as T));
  ws.on('close', (code) => (closeCode = code));
  await new Promise((r) => ws.once('open', r));
  ws.send(JSON.stringify(hello));
  return { ws, got, closed: () => closeCode };
}

const lobbyHello = (ticket: string) => ({ t: 'helloLobby', v: PROTOCOL_VERSION, ticket });
const lastRoom = (got: LobbyServerMessage[]): RoomInfo | undefined => {
  const m = [...got].reverse().find((x) => x.t === 'room');
  return m?.t === 'room' ? m.room : undefined;
};

const suffix = Date.now().toString(36).slice(-5);
const a = await player(`sala_a_${suffix}`, 'cearalove');
const b = await player(`sala_b_${suffix}`, 'lions-do-pici');

const created = await a.call('/rooms', 'POST', { nome: `Smoke ${suffix}`, publica: true });
const { code, ticket: ticketA, serverUrl } = created.body as { code: string; ticket: string; serverUrl: string };
const la = await connect<LobbyServerMessage>(serverUrl, lobbyHello(ticketA));
await wait(200);
const listed = await b.call('/rooms');
const joined = await b.call('/rooms/join', 'POST', { code: code.toLowerCase() });
const lb = await connect<LobbyServerMessage>(serverUrl, lobbyHello((joined.body as { ticket: string }).ticket));
await wait(200);

la.ws.send(JSON.stringify({ t: 'setBots', team: 0, count: 3 }));
la.ws.send(JSON.stringify({ t: 'setBots', team: 1, count: 2 }));
lb.ws.send(JSON.stringify({ t: 'start' })); // não é líder: tem que ser recusado
await wait(200);
la.ws.send(JSON.stringify({ t: 'start' }));
await wait(500);

const startA = la.got.find((m) => m.t === 'matchStart');
const startB = lb.got.find((m) => m.t === 'matchStart');
const ga = startA?.t === 'matchStart' ? await connect<ServerMessage>(startA.serverUrl, { t: 'hello', v: PROTOCOL_VERSION, ticket: startA.ticket }) : null;
const gb = startB?.t === 'matchStart' ? await connect<ServerMessage>(startB.serverUrl, { t: 'hello', v: PROTOCOL_VERSION, ticket: startB.ticket }) : null;
await wait(800);
const roster = ga?.got.filter((m) => m.t === 'roster').at(-1);
const welcomeA = ga?.got.find((m) => m.t === 'welcome');
const roomMatchId = welcomeA?.t === 'welcome' ? welcomeA.matchId : '';
// Fila rápida com a partida da sala rolando: tem que cair em outra partida.
const c = await player(`sala_c_${suffix}`, 'cearalove');
const quick = (await c.call('/queue', 'POST', {})).body as { matchId?: string };
const room = lastRoom(la.got);
const bId = room?.players.find((p) => p.team === 1)?.id ?? '';

la.ws.send(JSON.stringify({ t: 'kick', userId: bId }));
await wait(500);
const rejoin = await b.call('/rooms/join', 'POST', { code });
// O ticket de partida do expulso ainda não venceu: a partida também tem que recusar.
const gb2 = startB?.t === 'matchStart' ? await connect<ServerMessage>(startB.serverUrl, { t: 'hello', v: PROTOCOL_VERSION, ticket: startB.ticket }) : null;
await wait(400);

const summary = {
  code,
  listedPublic: ((listed.body.rooms as { code: string }[] | undefined) ?? []).some((r) => r.code === code),
  joinStatus: joined.status,
  players: room?.players.length,
  bots: room?.bots,
  notLeaderRefused: lb.got.some((m) => m.t === 'error' && m.code === 'so_o_lider'),
  fase: room?.fase,
  bothGotMatch: !!startA && !!startB,
  welcome: ga?.got.some((m) => m.t === 'welcome') && gb?.got.some((m) => m.t === 'welcome'),
  rosterSize: roster?.t === 'roster' ? roster.players.length : 0,
  kickedLobbyClose: lb.closed(),
  kickedGameClose: gb?.closed(),
  rejoinStatus: rejoin.status,
  rejoinError: rejoin.body.error,
  afterKickPlayers: lastRoom(la.got)?.players.length,
  quickAvoidsRoom: !!quick.matchId && !!roomMatchId && quick.matchId !== roomMatchId,
  kickedTicketRefused: gb2?.closed() === 4006 && !gb2.got.some((m) => m.t === 'welcome'),
};
console.log(summary);
for (const conn of [la, lb, ga, gb, gb2]) conn?.ws.close();
const ok =
  summary.listedPublic &&
  summary.joinStatus === 200 &&
  summary.players === 2 &&
  JSON.stringify(summary.bots) === '[3,2]' &&
  summary.notLeaderRefused &&
  summary.fase === 'playing' &&
  summary.bothGotMatch &&
  summary.welcome &&
  summary.rosterSize === 7 &&
  summary.kickedLobbyClose === 4009 &&
  summary.kickedGameClose === 4009 &&
  summary.rejoinStatus === 409 &&
  summary.rejoinError === 'expulso' &&
  summary.afterKickPlayers === 1 &&
  summary.quickAvoidsRoom &&
  summary.kickedTicketRefused;
console.log(ok ? 'ROOMS SMOKE OK' : 'ROOMS SMOKE FALHOU');
process.exit(ok ? 0 : 1);
