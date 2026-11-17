import type { ServerMessage } from '@torcidas/shared';
import { describe, expect, it } from 'vitest';
import { GameMatch, RECONNECT_TICKS } from '../src/match';

const client = (userId: string) => ({ userId, nick: userId, team: 0 as const, send: (_: ServerMessage) => {}, close: () => {} });

describe('reconexão', () => {
  it('quem cai fica com o lutador por um tempo e volta para ele; depois a vaga vai para um bot', () => {
    const m = new GameMatch('m', 1, () => {});
    expect(m.join(client('ana'))).toBe(true);
    const fighter = () => m.state.sim.fighters.find((f) => f.id === 'ana');
    fighter()!.kos = 3;
    m.leave('ana');
    expect(m.isAway('ana')).toBe(true);
    for (let i = 0; i < 10; i++) m.tick();
    expect(fighter()?.kos).toBe(3);
    // Volta dentro do prazo: mesmo lutador, sem duplicar.
    expect(m.join(client('ana'))).toBe(true);
    expect(m.isAway('ana')).toBe(false);
    expect(m.state.sim.fighters.filter((f) => f.id === 'ana')).toHaveLength(1);
    expect(fighter()?.kos).toBe(3);
    // Cai de novo e não volta: sai e o time fica completo com bot.
    m.leave('ana');
    const before = m.state.sim.fighters.length;
    for (let i = 0; i <= RECONNECT_TICKS; i++) m.tick();
    expect(fighter()).toBeUndefined();
    expect(m.isAway('ana')).toBe(false);
    expect(m.state.sim.fighters.length).toBe(before);
  });
});
