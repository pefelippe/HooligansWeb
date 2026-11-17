import { describe, expect, it } from 'vitest';
import { type Box, DEFAULT_CONSTANTS, enterState, findTraverse, groundHeight, resolveCircleCollision, type SimState, step } from '../src';
import { Buttons, duel, FACE_MINUS_Z, FACE_PLUS_Z, fighter, inp, ofType, run, tap } from './helpers';

const c = DEFAULT_CONSTANTS;
const box = (o: Partial<Box> & Pick<Box, 'x' | 'z' | 'hw' | 'hd' | 'h'>): Box => ({ kind: 'carro', color: '#000', ...o });
const solids = (...boxes: Box[]): NonNullable<SimState['collision']> => ({ boxes, circles: [], halfW: 50, halfD: 50 });
/** Carro de comprido no eixo Z, de z = 0,8 a 5,2. */
const CAR = box({ x: 0, z: 3, hw: 0.95, hd: 2.2, h: 1.45 });
/** Grade baixa e fina atravessada no eixo Z (em z = 2). */
const GRADE = box({ x: 0, z: 2, hw: 2.5, hd: 0.12, h: 1.1, kind: 'barreira' });
const FAR = { pos: { x: 30, z: -30 } };
const RUN_Z = (extra = 0) => inp(Buttons.RUN | extra, FACE_PLUS_Z, 0, 1);

function onRoof(s: SimState, id: string, z: number) {
  const f = fighter(s, id);
  f.pos = { x: 0, z };
  f.y = f.ground = f.fallFrom = CAR.h;
  return f;
}

describe('mapa com altura', () => {
  it('groundHeight: teto do carro com o pé em cima, asfalto fora dele', () => {
    expect(groundHeight([CAR], { x: 0, z: 3 }, 1.45)).toBe(1.45);
    expect(groundHeight([CAR], { x: 0, z: 0.7 }, 1.45)).toBe(0);
    // Do chão, o teto está alto demais para "subir andando".
    expect(groundHeight([CAR], { x: 0, z: 3 }, 0)).toBe(0);
  });

  it('colisão: em cima do carro não empurra; embaixo empurra e diz quanto', () => {
    const p = { x: 0, z: 0.9 };
    expect(resolveCircleCollision(p, 0.35, solids(CAR), 1.45)).toBe(0);
    expect(resolveCircleCollision(p, 0.35, solids(CAR), 0)).toBeGreaterThan(0.2);
  });

  it('findTraverse: grade → pular, carro de lado correndo → capô, andando → subir', () => {
    const t = c.traverse;
    expect(findTraverse(solids(GRADE), { x: 0, z: 1.2 }, 0, { x: 0, z: 1 }, 0.35, false, t)?.kind).toBe('pular');
    const side = { x: -1.6, z: 3 };
    expect(findTraverse(solids(CAR), side, 0, { x: 1, z: 0 }, 0.35, true, t)?.kind).toBe('capo');
    const up = findTraverse(solids(CAR), side, 0, { x: 1, z: 0 }, 0.35, false, t);
    expect(up?.kind).toBe('subir');
    expect(up?.to.y).toBe(1.45);
    // Pelo comprimento (4,4 m), correndo, não dá para deslizar: sobe.
    expect(findTraverse(solids(CAR), { x: 0, z: 0 }, 0, { x: 0, z: 1 }, 0.35, true, t)?.kind).toBe('subir');
  });

  it('findTraverse: quiosque é alto demais; saída bloqueada por outro carro cai para subir', () => {
    const t = c.traverse;
    const quiosque = box({ x: 0, z: 2, hw: 1.6, hd: 1.2, h: 2.6, kind: 'quiosque' });
    expect(findTraverse(solids(quiosque), { x: 0, z: 0.2 }, 0, { x: 0, z: 1 }, 0.35, true, t)).toBeNull();
    const colado = box({ x: 2.05, z: 3, hw: 0.95, hd: 2.2, h: 1.45 });
    expect(findTraverse(solids(CAR, colado), { x: -1.6, z: 3 }, 0, { x: 1, z: 0 }, 0.35, true, t)?.kind).toBe('subir');
  });
});

describe('chão local e quedas', () => {
  it('andando para fora do teto cai e aterrissa no asfalto', () => {
    const { s, data } = duel({ b: FAR, collision: solids(CAR) });
    const a = onRoof(s, 'a', 1.0);
    run(s, data, 60, () => ({ a: inp(0, FACE_MINUS_Z, 0, -1) }));
    expect(a.y).toBe(0);
    expect(a.pos.z).toBeLessThan(0.5);
  });

  it('coyote: pular logo depois de sair da borda ainda vale; tarde demais não', () => {
    const jumpAfter = (k: number) => {
      const { s, data } = duel({ b: FAR, collision: solids(CAR) });
      const a = onRoof(s, 'a', 0.9);
      let left = -1;
      for (let i = 0; i < 40; i++) {
        const t = s.tick + 1;
        const press = left >= 0 && t === left + k ? Buttons.JUMP : 0;
        step(s, { a: inp(press, FACE_MINUS_Z, 0, -1) }, data);
        if (left < 0 && a.ground === 0) left = s.tick;
        if (press) return a.vy;
      }
      return 0;
    };
    expect(jumpAfter(3)).toBeGreaterThan(0);
    expect(jumpAfter(12)).toBeLessThanOrEqual(0);
  });

  it('em cima do carro é chão: Q é chute (não voadora) e dá para esquivar', () => {
    const { s, data } = duel({ b: FAR, collision: solids(CAR) });
    const a = onRoof(s, 'a', 3);
    run(s, data, 2, (t) => ({ a: inp(tap(Buttons.KICK, 1, t), FACE_PLUS_Z) }));
    expect(a.move?.def.id).toBe('chute');
    run(s, data, 40);
    run(s, data, 1, () => ({ a: inp(Buttons.DODGE, FACE_PLUS_Z) }));
    expect(a.state).toBe('dodge');
  });

  it('queda alta correndo vira rolamento grátis; parado fica lento', () => {
    const roll = duel({ b: FAR });
    const a = fighter(roll.s, 'a');
    a.y = a.fallFrom = 2.3;
    const st = a.stamina;
    run(roll.s, roll.data, 30, () => ({ a: RUN_Z() }));
    expect(a.dodgeKind).toBe('land');
    expect(a.stamina).toBeGreaterThan(st - 2);

    const lag = duel({ b: FAR });
    const b = fighter(lag.s, 'a');
    b.y = b.fallFrom = 2.3;
    run(lag.s, lag.data, 30);
    expect(b.state).toBe('idle');
    expect(b.slowUntil).toBeGreaterThan(lag.s.tick);
  });

  it('cair do alto atordoado machuca e derruba', () => {
    const { s, data } = duel({ b: FAR });
    const a = fighter(s, 'a');
    a.y = a.fallFrom = 2;
    enterState(a, 'hitstun', 120);
    const ev = run(s, data, 40);
    expect(ofType(ev, 'fall')).toHaveLength(1);
    expect(a.hp).toBe(c.maxHp - c.fall.damage);
    expect(a.state).toBe('knockdown');
  });
});

describe('travessias', () => {
  it('correndo, pula a grade de graça e continua correndo do outro lado', () => {
    const { s, data } = duel({ b: FAR, collision: solids(GRADE) });
    const a = fighter(s, 'a');
    a.pos.z = 1.0;
    const st = a.stamina;
    run(s, data, 1, () => ({ a: RUN_Z(Buttons.JUMP) }));
    expect(a.state).toBe('traverse');
    run(s, data, 20, () => ({ a: RUN_Z() }));
    expect(a.state).toBe('idle');
    expect(a.running).toBe(true);
    expect(a.pos.z).toBeGreaterThan(2.5);
    expect(a.stamina).toBeGreaterThan(st - 2);
  });

  it('correndo de lado para o carro, desliza no capô até o outro lado', () => {
    const { s, data } = duel({ b: FAR, collision: solids(CAR) });
    const a = fighter(s, 'a');
    a.pos = { x: -1.6, z: 3 };
    run(s, data, 1, () => ({ a: inp(Buttons.RUN | Buttons.JUMP, Math.PI / 2, 1, 0) }));
    expect(a.traverse?.kind).toBe('capo');
    run(s, data, 30);
    expect(a.pos.x).toBeGreaterThan(1.3);
    expect(a.y).toBe(0);
  });

  it('golpe na segunda metade do capô sai de voadora na saída', () => {
    const { s, data } = duel({ b: FAR, collision: solids(CAR) });
    const a = fighter(s, 'a');
    a.pos = { x: -1.6, z: 3 };
    run(s, data, 30, (t) => ({ a: inp(tap(Buttons.RUN | Buttons.JUMP, 1, t) | tap(Buttons.KICK, 15, t), Math.PI / 2, t === 1 ? 1 : 0, 0) }));
    expect(a.move?.def.id).toBe('voadora');
  });

  it('no ar, encostando na borda do carro, sobe sozinho', () => {
    const { s, data } = duel({ b: FAR, collision: solids(CAR) });
    const a = fighter(s, 'a');
    a.pos.z = -0.3;
    run(s, data, 80, (t) => ({ a: inp(tap(Buttons.JUMP, 1, t), FACE_PLUS_Z, 0, t < 25 ? 1 : 0) }));
    expect(a.y).toBeCloseTo(CAR.h);
  });

  it('levar golpe no meio do pulo derruba de lá (taco alcança)', () => {
    const { s, data } = duel({ a: { pos: { x: 0, z: 1 } }, b: { pos: { x: 0, z: 3.2 }, weapon: 'taco' }, collision: solids(GRADE) });
    const a = fighter(s, 'a');
    const ev = run(s, data, 14, (t) => ({ a: RUN_Z(tap(Buttons.JUMP, 1, t)), b: inp(tap(Buttons.LIGHT, 1, t), FACE_MINUS_Z) }));
    expect(ofType(ev, 'hit').some((h) => h.target === 'a')).toBe(true);
    expect(a.traverse).toBeNull();
    run(s, data, 60);
    expect(a.y).toBe(0);
  });

  it('pulo cancela a recuperação do soco', () => {
    const { s, data } = duel({ b: FAR });
    const a = fighter(s, 'a');
    run(s, data, 10, (t) => ({ a: inp(tap(Buttons.LIGHT, 1, t) | tap(Buttons.JUMP, 10, t), FACE_PLUS_Z) }));
    expect(a.state).toBe('idle');
    expect(a.vy).toBeGreaterThan(0);
  });
});

describe('combate no terreno', () => {
  it('soco de baixo não pega quem está em cima do carro; taco pega', () => {
    const hitsOn = (weapon: string) => {
      const { s, data } = duel({ b: { pos: { x: 0, z: 0.2 }, facing: FACE_PLUS_Z, weapon }, collision: solids(CAR) });
      onRoof(s, 'a', 1.0);
      return ofType(run(s, data, 40, (t) => ({ b: inp(tap(Buttons.LIGHT, 1, t), FACE_PLUS_Z) })), 'hit').length;
    };
    expect(hitsOn('punhos')).toBe(0);
    expect(hitsOn('taco')).toBe(1);
  });

  it('tiro de cima do carro não bate no próprio carro', () => {
    const { s, data } = duel({ a: { weapon: 'pistola' }, b: { pos: { x: 0, z: -4 } }, collision: solids(CAR) });
    onRoof(s, 'a', 1.2);
    const ev = run(s, data, 20, (t) => ({ a: inp(tap(Buttons.LIGHT, 1, t), FACE_MINUS_Z) }));
    expect(ofType(ev, 'hit')).toHaveLength(1);
  });

  it('magnetismo: inimigo 25° fora da mira e fora do alcance seco ainda leva; a 50° não', () => {
    const hitAt = (deg: number) => {
      const r = (deg * Math.PI) / 180;
      const { s, data } = duel({ b: { pos: { x: Math.sin(r) * 1.9, z: Math.cos(r) * 1.9 } } });
      return ofType(run(s, data, 20, (t) => ({ a: inp(tap(Buttons.LIGHT, 1, t), FACE_PLUS_Z) })), 'hit').length;
    };
    expect(hitAt(25)).toBe(1);
    expect(hitAt(50)).toBe(0);
  });

  it('empurrão contra o carro: splat (dano e atordoa); longe do carro, nada', () => {
    const shove = (bz: number) => {
      const { s, data } = duel({ a: { pos: { x: 0, z: bz - 0.9 } }, b: { pos: { x: 0, z: bz } }, collision: solids(CAR) });
      const ev = run(s, data, 30, (t) => ({ a: inp(tap(Buttons.SHOVE, 1, t), FACE_PLUS_Z) }));
      return { splats: ofType(ev, 'splat'), b: fighter(s, 'b') };
    };
    const near = shove(0.3);
    expect(near.splats).toHaveLength(1);
    expect(near.splats[0]?.attacker).toBe('a');
    expect(near.b.state).toBe('staggered');
    expect(shove(-3).splats).toHaveLength(0);
  });

  it('pisão: pulando do carro em cima de três, derruba os três; do chão é voadora', () => {
    const { s, data } = duel({ b: { pos: { x: 0, z: -0.9 } }, collision: solids(CAR) });
    const extra = [
      { id: 'c', pos: { x: 0.9, z: -0.4 } },
      { id: 'd', pos: { x: -0.9, z: -0.4 } },
    ];
    for (const e of extra) s.fighters.push({ ...fighter(s, 'b'), ...e, pos: { ...e.pos }, damagedBy: {}, bleeds: [], bag: [] });
    const a = onRoof(s, 'a', 1.0);
    const ev = run(s, data, 60, (t) => ({ a: inp(tap(Buttons.JUMP, 1, t) | tap(Buttons.KICK, 10, t), FACE_MINUS_Z, 0, t < 10 ? -1 : 0) }));
    const hits = ofType(ev, 'hit').filter((h) => h.move === 'pisao');
    expect(new Set(hits.map((h) => h.target))).toEqual(new Set(['b', 'c', 'd']));
    expect(hits.every((h) => h.knockdown)).toBe(true);
    expect(a.y).toBe(0);

    const flat = duel({ b: FAR });
    run(flat.s, flat.data, 10, (t) => ({ a: inp(tap(Buttons.JUMP, 1, t) | tap(Buttons.KICK, 8, t), FACE_PLUS_Z) }));
    expect(fighter(flat.s, 'a').move?.def.id).toBe('voadora');
  });

  it('carrinho correndo derruba, e o soco alto passa por cima', () => {
    const { s, data } = duel({ b: { pos: { x: 0, z: 2.2 } } });
    const ev = run(s, data, 40, (t) => ({
      a: RUN_Z(tap(Buttons.KICK, 2, t)),
      b: inp(tap(Buttons.LIGHT, 3, t), FACE_MINUS_Z),
    }));
    const hits = ofType(ev, 'hit');
    expect(hits.some((h) => h.target === 'b' && h.move === 'carrinho' && h.knockdown)).toBe(true);
    expect(hits.some((h) => h.target === 'a')).toBe(false);
  });
});
