import { describe, expect, it } from 'vitest';
import { createSim, DEFAULT_CONSTANTS, slotsTaken } from '../src';
import { Buttons, duel, FACE_MINUS_Z, FACE_PLUS_Z, fighter, inp, ofType, run, tap } from './helpers';

const LIGHT = Buttons.LIGHT;
const c = DEFAULT_CONSTANTS;

describe('anti-bolinho', () => {
  it('golpe recebido deixa lento e sem correr', () => {
    const { s, data } = duel();
    run(s, data, 12, (t) => ({ a: inp(tap(LIGHT, 1, t), FACE_PLUS_Z), b: inp(0, FACE_MINUS_Z) }));
    const b = fighter(s, 'b');
    expect(b.slowUntil).toBeGreaterThan(s.tick);
    // Tenta correr: continua andando.
    run(s, data, 30, () => ({ b: inp(Buttons.RUN, FACE_MINUS_Z, 1, 0) }));
    expect(b.running).toBe(false);
  });

  it('quebra-trava: no 4º golpe seguido a vítima fica intocável', () => {
    const { s, data } = duel();
    const b = fighter(s, 'b');
    b.comboHits = c.stunBreak.hits - 1;
    b.lastHitTakenTick = 0;
    const ev = run(s, data, 12, (t) => ({ a: inp(tap(LIGHT, 1, t), FACE_PLUS_Z), b: inp(0, FACE_MINUS_Z) }));
    expect(ofType(ev, 'stunbreak')).toHaveLength(1);
    expect(b.protectedUntil).toBeGreaterThan(s.tick);
  });

  it('fúria: cheia no cerco, explode e derruba quem está perto', () => {
    const { s, data } = duel();
    const b = fighter(s, 'b');
    b.fury = c.fury.max - 1;
    b.damagedBy = { x: 0 }; // outro atacante acabou de bater
    const ev = run(s, data, 12, (t) => ({ a: inp(tap(LIGHT, 1, t), FACE_PLUS_Z), b: inp(0, FACE_MINUS_Z) }));
    expect(ofType(ev, 'fury')[0]?.hit).toEqual(['a']);
    expect(fighter(s, 'a').state).toBe('knockdown');
    expect(b.fury).toBe(0);
    expect(b.furyArmorUntil).toBeGreaterThan(s.tick);
  });

  it('fúria não enche no x1', () => {
    const { s, data } = duel();
    run(s, data, 12, (t) => ({ a: inp(tap(LIGHT, 1, t), FACE_PLUS_Z), b: inp(0, FACE_MINUS_Z) }));
    expect(fighter(s, 'b').fury).toBe(0);
  });

  it('fila de ataque: conta aliados engajados mais perto do alvo', () => {
    const s = createSim([
      { id: 't', team: 1, pos: { x: 0, z: 0 } },
      { id: 'a1', team: 0, pos: { x: 1, z: 0 } },
      { id: 'a2', team: 0, pos: { x: -1, z: 0 } },
      { id: 'me', team: 0, pos: { x: 0, z: 2 } },
      { id: 'longe', team: 0, pos: { x: 9, z: 0 } },
    ]);
    const f = (id: string) => s.fighters.find((x) => x.id === id)!;
    expect(slotsTaken(s.fighters, f('me'), f('t'))).toBe(2);
    expect(slotsTaken(s.fighters, f('a1'), f('t'))).toBe(0);
  });
});

describe('bandagem', () => {
  it('cura na hora, gasta uma e só repete depois da recarga', () => {
    const { s, data } = duel({ b: { pos: { x: 0, z: 9 } } });
    const a = fighter(s, 'a');
    a.hp = 50;
    const start = a.bandagens;
    // Aperta em ticks seguidos (borda de subida a cada 2 ticks): só a primeira e a da recarga valem.
    const ev = run(s, data, c.bandagem.cooldown + 2, (t) => ({ a: inp(t % 2 === 1 ? Buttons.QUICK_HEAL : 0, FACE_PLUS_Z) }));
    const heals = ofType(ev, 'heal').filter((h) => h.source === 'bandagem');
    expect(heals).toHaveLength(2);
    expect(a.bandagens).toBe(start - 2);
    expect(a.hp).toBe(50 + 2 * c.bandagem.amount);
  });

  it('não usa apanhando', () => {
    const { s, data } = duel();
    const b = fighter(s, 'b');
    b.hp = 50;
    run(s, data, 12, (t) => ({ a: inp(tap(LIGHT, 1, t), FACE_PLUS_Z), b: inp(t === 9 ? Buttons.QUICK_HEAL : 0, FACE_MINUS_Z) }));
    expect(b.state).toBe('hitstun');
    expect(b.bandagens).toBe(c.bandagem.start);
  });
});

describe('arremessáveis', () => {
  const throwAt = (btn: number) => (t: number) => ({ a: inp(tap(btn, 1, t), FACE_PLUS_Z) });

  it('bomba derruba inimigos no raio, sem dano, e não pega aliado', () => {
    const { s, data } = duel({ b: { pos: { x: 0, z: c.throwables.range } } });
    const a = fighter(s, 'a');
    const b = fighter(s, 'b');
    a.bombas = 1;
    const hp = b.hp;
    const ev = run(s, data, c.throwables.flightTicks + 3, throwAt(Buttons.THROW_BOMB));
    expect(ofType(ev, 'explosion')[0]?.hit).toEqual(['b']);
    expect(b.state).toBe('knockdown');
    expect(b.hp).toBe(hp);
    expect(a.bombas).toBe(0);
    expect(a.state).not.toBe('knockdown');
  });

  it('roda põe a bomba na mão e o clique arremessa (sem bater)', () => {
    const { s, data } = duel({ b: { pos: { x: 0, z: c.throwables.range } } });
    const a = fighter(s, 'a');
    a.bombas = 1;
    run(s, data, 2, (t) => ({ a: inp(tap(Buttons.WEAPON_NEXT, s.tick + 1, t)) }));
    expect(a.inHand).toBe('bomba');
    const ev = run(s, data, 3, (t) => ({ a: inp(tap(LIGHT, s.tick + 1, t), FACE_PLUS_Z) }));
    expect(ofType(ev, 'throw')).toHaveLength(1);
    expect(a.state).not.toBe('attack');
    expect(a.inHand).toBeNull();
  });

  it('sem bomba no estoque não arremessa', () => {
    const { s, data } = duel();
    const ev = run(s, data, 5, throwAt(Buttons.THROW_BOMB));
    expect(ofType(ev, 'throw')).toHaveLength(0);
  });

  it('gás: rival dentro da nuvem fica lento, perde fôlego e tosse', () => {
    const { s, data } = duel({ b: { pos: { x: 0, z: c.throwables.range } } });
    const b = fighter(s, 'b');
    fighter(s, 'a').gases = 1;
    const ev = run(s, data, c.throwables.flightTicks + 2, throwAt(Buttons.THROW_GAS));
    expect(ofType(ev, 'gas')).toHaveLength(1);
    const st = b.stamina;
    const ev2 = run(s, data, c.throwables.gas.coughEvery + 2);
    expect(b.slowUntil).toBeGreaterThan(s.tick);
    expect(b.stamina).toBeLessThan(st);
    expect(ev2.some((e) => e.type === 'hit')).toBe(false);
    expect(b.hp).toBe(c.maxHp);
    // A nuvem acaba.
    run(s, data, c.throwables.gas.ticks);
    expect(s.clouds).toEqual([]);
  });
});

describe('carros', () => {
  const car = { x: 0, z: 3, hw: 0.95, hd: 1, h: 1.45, kind: 'carro' as const, color: '#000' };
  const collision = { boxes: [car], circles: [], halfW: 50, halfD: 50 };

  it('andando, o carro bloqueia', () => {
    const { s, data } = duel({ b: { pos: { x: 30, z: 0 } }, collision });
    run(s, data, 90, () => ({ a: inp(0, FACE_PLUS_Z, 0, 1) }));
    expect(fighter(s, 'a').pos.z).toBeLessThan(car.z - car.hd);
  });

  it('Espaço encostado no carro sobe nele (e fica em cima)', () => {
    const { s, data } = duel({ b: { pos: { x: 30, z: 0 } }, collision });
    const a = fighter(s, 'a');
    a.pos.z = 1.1;
    run(s, data, 90, (t) => ({ a: inp(tap(Buttons.JUMP, 1, t), FACE_PLUS_Z, 0, t === 1 ? 1 : 0) }));
    expect(a.y).toBeCloseTo(car.h);
    expect(Math.abs(a.pos.z - car.z)).toBeLessThan(car.hd);
  });
});
