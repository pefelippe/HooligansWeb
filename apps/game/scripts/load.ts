// Carga: N partidas cheias de bots no mesmo processo, medindo o tick e o custo do snapshot binário.
// Uso: pnpm --filter @torcidas/game load [partidas=5] [segundos=20]
import { encodeSnapshot, type ServerMessage, TICK_RATE } from '@torcidas/shared';
import { GameMatch } from '../src/match';

const n = Number(process.argv[2] ?? 5);
const seconds = Number(process.argv[3] ?? 20);
let bytes = 0;
let snaps = 0;
let jsonBytes = 0;
const matches = Array.from({ length: n }, (_, i) => {
  const m = new GameMatch(`load-${i}`, i + 1, () => {});
  // Um "cliente" por partida que só mede o snapshot (os 20 lutadores são bots).
  m.join({
    userId: `obs-${i}`,
    nick: 'obs',
    team: 0,
    send: (msg: ServerMessage) => {
      if (msg.t !== 'snapshot') return;
      bytes += encodeSnapshot(msg).length;
      jsonBytes += JSON.stringify(msg).length;
      snaps++;
    },
    close: () => {},
  });
  return m;
});
const times: number[] = [];
for (let t = 0; t < seconds * TICK_RATE; t++) {
  const t0 = performance.now();
  for (const m of matches) m.tick();
  times.push(performance.now() - t0);
}
times.sort((a, b) => a - b);
const pct = (p: number) => times[Math.floor(times.length * p)]!.toFixed(2);
console.log({
  partidas: n,
  lutadoresPorPartida: matches[0]!.state.sim.fighters.length,
  tickTodasMs: { p50: pct(0.5), p99: pct(0.99), max: times[times.length - 1]!.toFixed(2), orcamento: (1000 / TICK_RATE).toFixed(2) },
  snapshotBytesMedio: Math.round(bytes / Math.max(1, snaps)),
  jsonBytesMedio: Math.round(jsonBytes / Math.max(1, snaps)),
  kbpsPorJogador: Math.round(((bytes / Math.max(1, snaps)) * 30 * 8) / 1000),
});
