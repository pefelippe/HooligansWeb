// Smoke test ponta a ponta: sessão anônima -> perfil -> fila -> WebSocket -> partida com bots.
// Uso: com api e game rodando (pnpm dev), rode pnpm --filter @torcidas/game smoke
import { Buttons, PROTOCOL_VERSION, type ServerMessage } from '@torcidas/shared';
import WebSocket from 'ws';

const API = process.env.API_URL ?? 'http://localhost:3000';
const ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:5173';

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
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
    return json;
  };
  await call('/api/auth/sign-in/anonymous', 'POST', {});
  await call('/profile', 'PUT', { nick, torcidaId });
  const q = (await call('/queue', 'POST', {})) as { ticket: string; serverUrl: string; matchId: string };
  const ws = new WebSocket(q.serverUrl);
  const got: ServerMessage[] = [];
  ws.on('message', (raw) => got.push(JSON.parse(String(raw)) as ServerMessage));
  await new Promise((r) => ws.once('open', r));
  ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, ticket: q.ticket }));
  return { ws, got, matchId: q.matchId, call };
}

const suffix = Date.now().toString(36).slice(-5);
const a = await player(`smk_a_${suffix}`, 'cearalove');
const b = await player(`smk_b_${suffix}`, 'lions-do-pici');

let seq = 0;
a.ws.send(JSON.stringify({ t: 'buy', item: 'soqueira' })); // nasce na sede com $300
const timer = setInterval(() => {
  seq++;
  // a anda para o leste (+X) e soca de vez em quando
  a.ws.send(JSON.stringify({ t: 'input', seq, input: { moveX: 1, moveZ: 0, aim: Math.PI / 2, buttons: seq % 20 < 2 ? Buttons.LIGHT : 0 } }));
}, 1000 / 60);
await new Promise((r) => setTimeout(r, 4000));
clearInterval(timer);

// Com MATCH_DURATION_S curto no game server, espera o fim e confere as estatísticas gravadas.
const waitEnd = Number(process.env.WAIT_MATCH_END_S ?? 0);
let endedOk: boolean | null = null;
if (waitEnd > 0) {
  const t0 = Date.now();
  while (!a.got.some((m) => m.t === 'matchEnd') && Date.now() - t0 < waitEnd * 1000) await new Promise((r) => setTimeout(r, 250));
  await new Promise((r) => setTimeout(r, 1000)); // dá tempo do game gravar na API
  const me2 = (await a.call('/me')) as { stats?: { matches: number } };
  endedOk = a.got.some((m) => m.t === 'matchEnd') && me2.stats?.matches === 1;
  console.log({ matchEnd: a.got.some((m) => m.t === 'matchEnd'), statsMatches: me2.stats?.matches });
}

const welcome = a.got.find((m) => m.t === 'welcome');
const roster = a.got.filter((m) => m.t === 'roster').at(-1);
const snaps = a.got.filter((m) => m.t === 'snapshot');
const last = snaps.at(-1);
const myId = welcome?.t === 'welcome' ? welcome.you : '';
const me = last?.t === 'snapshot' ? last.fighters.find((f) => f.id === myId) : undefined;
const first = snaps[0]?.t === 'snapshot' ? snaps[0].fighters.find((f) => f.id === myId) : undefined;
const buy = a.got.find((m) => m.t === 'buyResult');
const evTypes = new Set(a.got.flatMap((m) => (m.t === 'events' ? m.events.map((e) => e.type) : [])));
const summary = {
  sameMatch: a.matchId === b.matchId,
  welcome: welcome?.t,
  rosterSize: roster?.t === 'roster' ? roster.players.length : 0,
  humans: roster?.t === 'roster' ? roster.players.filter((p) => !p.bot).length : 0,
  snapshots: snaps.length,
  fighters: last?.t === 'snapshot' ? last.fighters.length : 0,
  meX: me?.pos.x.toFixed(2),
  // a anda para leste (+X) durante 4 s: tem que ter saído do lugar.
  movedX: me && first ? (me.pos.x - first.pos.x).toFixed(2) : null,
  weapon: me?.weapon,
  buy: buy?.t === 'buyResult' ? buy.ok : null,
  ticksLeft: last?.t === 'snapshot' ? last.match.ticksLeft : null,
  events: [...evTypes],
  // Predição: o snapshot traz o estado completo do próprio lutador e o ack dos inputs.
  hasSelf: last?.t === 'snapshot' && !!last.self && last.self.id === (welcome?.t === 'welcome' ? welcome.you : ''),
  ackSeq: last?.t === 'snapshot' ? last.ackSeq : 0,
  // Pontos de controle e respawn crescente vêm no snapshot.
  points: last?.t === 'snapshot' ? last.match.points.map((p) => p.id).join('') : '',
  respawnTicks: last?.t === 'snapshot' ? last.match.respawnTicks : 0,
};
console.log(summary);
a.ws.close();
b.ws.close();
const ok =
  summary.sameMatch && summary.welcome === 'welcome' && summary.rosterSize === 20 && summary.humans >= 2 && summary.snapshots > 60 && summary.buy === true && summary.weapon === 'soqueira' && Number(summary.movedX) > 3 && endedOk !== false && summary.hasSelf && summary.ackSeq > 100 && summary.points === 'ABC' && summary.respawnTicks >= 300;
console.log(ok ? 'SMOKE OK' : 'SMOKE FALHOU');
process.exit(ok ? 0 : 1);
