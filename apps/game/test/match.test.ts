import { Buttons, type ServerMessage } from '@torcidas/shared';
import { describe, expect, it } from 'vitest';
import { GameMatch, RECONNECT_TICKS } from '../src/match';

const client = (userId: string, inbox: ServerMessage[] = [], closed: number[] = []) => ({
  userId,
  nick: userId,
  team: 0 as const,
  send: (m: ServerMessage) => void inbox.push(m),
  close: (code: number) => void closed.push(code),
});

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

describe('conexão nova antes de o servidor notar a queda', () => {
  it('o fechamento atrasado da conexão velha não derruba a nova', () => {
    const m = new GameMatch('m', 2, () => {});
    const oldClosed: number[] = [];
    const c1 = client('ana', [], oldClosed);
    const inbox: ServerMessage[] = [];
    const c2 = client('ana', inbox);
    m.join(c1);
    m.join(c2);
    expect(oldClosed).toEqual([4010]);
    m.leave('ana', c1); // chega depois
    expect(m.isAway('ana')).toBe(false);
    for (let i = 0; i < 4; i++) m.tick();
    expect(inbox.some((x) => x.t === 'snapshot')).toBe(true);
  });
});

describe('compensação de lag no servidor', () => {
  it.each([
    ['com', 10, true],
    ['sem', undefined, false],
  ] as const)('o tiro usa as posições do tick que o cliente via (%s view)', (_label, behind, hits) => {
    const m = new GameMatch('m', 3, () => {}, { bots: [0, 0] });
    m.join(client('atirador'));
    m.join({ ...client('alvo'), team: 1 as const });
    const [a, b] = ['atirador', 'alvo'].map((id) => m.state.sim.fighters.find((f) => f.id === id)!);
    a!.pos = { x: 0, z: 0 };
    a!.facing = 0;
    a!.weapon = 'pistola';
    a!.durability = 8;
    a!.protectedUntil = 0;
    b!.protectedUntil = 0;
    // Alvo na frente por alguns ticks (vira histórico), depois sai da linha.
    b!.pos = { x: 0, z: 10 };
    for (let i = 0; i < 20; i++) m.tick();
    // Agora o alvo sai da linha; o atirador está 10 ticks atrás e ainda o vê na frente.
    b!.pos = { x: 4, z: 10 };
    const hp = b!.hp;
    m.setInput('atirador', 1, { moveX: 0, moveZ: 0, aim: 0, buttons: Buttons.LIGHT }, behind === undefined ? undefined : m.state.sim.tick - behind);
    for (let i = 0; i < 12; i++) m.tick();
    if (hits) expect(b!.hp).toBeLessThan(hp);
    else expect(b!.hp).toBe(hp);
  });
});
