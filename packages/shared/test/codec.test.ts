import { describe, expect, it } from 'vitest';
import { addPlayer, botInput, createBrain, createMatch, decodeSnapshot, encodeSnapshot, MATCH, PROTOCOL_VERSION, stepMatch, ticksLeft, toMatchInfo, toSnapshot } from '../src';

function snapshotAfter(ticks: number) {
  const m = createMatch('codec', 7);
  const brains = [];
  for (const team of [0, 1] as const) {
    for (let i = 0; i < MATCH.teamSize; i++) {
      const id = `bot-${team}-${i}`;
      addPlayer(m, { id, nick: id, team, bot: true });
      brains.push(createBrain(id, team * 10 + i));
    }
  }
  for (let t = 0; t < ticks; t++) {
    const inputs = Object.fromEntries(brains.map((b) => [b.id, botInput(m, b)]));
    stepMatch(m, inputs);
  }
  const sim = m.sim;
  const self = sim.fighters[0];
  return {
    t: 'snapshot' as const,
    tick: sim.tick,
    ackSeq: 123,
    match: toMatchInfo(m, ticksLeft(m)),
    fighters: sim.fighters.map((f) => toSnapshot(sim, f)),
    throws: sim.throwables ?? [],
    clouds: sim.clouds ?? [],
    ...(self ? { self } : {}),
  };
}

describe('snapshot binário', () => {
  it('ida e volta preserva tudo (posição em cm, ângulo em 1e-4 rad)', () => {
    const msg = snapshotAfter(900);
    const back = decodeSnapshot(encodeSnapshot(msg));
    expect(back).not.toBeNull();
    expect(back!.tick).toBe(msg.tick);
    expect(back!.ackSeq).toBe(msg.ackSeq);
    expect(back!.match).toEqual(msg.match);
    expect(back!.self).toEqual(JSON.parse(JSON.stringify(msg.self)));
    expect(back!.fighters).toHaveLength(msg.fighters.length);
    msg.fighters.forEach((f, i) => {
      const g = back!.fighters[i]!;
      expect(g.pos.x).toBeCloseTo(f.pos.x, 1);
      expect(g.pos.z).toBeCloseTo(f.pos.z, 1);
      expect(Math.cos(g.facing - f.facing)).toBeCloseTo(1, 6);
      const strip = ({ pos: _p, facing: _f, ...rest }: typeof f) => rest;
      expect(strip(g)).toEqual(strip(f));
    });
  });

  it('os lutadores ficam bem menores que em JSON', () => {
    const msg = snapshotAfter(300);
    const bin = encodeSnapshot({ ...msg, self: undefined as never }).length;
    const json = JSON.stringify({ ...msg, self: undefined }).length; // ASCII: 1 byte por caractere
    expect(bin).toBeLessThan(json * 0.5);
  });

  it('versão diferente é recusada', () => {
    const bytes = encodeSnapshot(snapshotAfter(1));
    bytes[0] = PROTOCOL_VERSION + 1;
    expect(decodeSnapshot(bytes)).toBeNull();
  });
});
