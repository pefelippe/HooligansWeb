import { describe, expect, it } from 'vitest';
import { createFighter, DEFAULT_CONSTANTS, enterState, type SimEvent, type SimState, yawTo } from '../src';
import { Buttons, duel, FACE_MINUS_Z, FACE_PLUS_Z, fighter, inp, ofType, run, tap } from './helpers';

const { LIGHT, BLOCK, DODGE, SHOVE, KICK, RUN, JUMP, SPECIAL, SHOUT, USE, HEAL } = Buttons;
const C = DEFAULT_CONSTANTS;
const FAR = { pos: { x: 30, z: 30 } };

describe('esquiva: passo e rolamento', () => {
  it('passo é curto e barato; rolamento (correndo) é longo e caro', () => {
    const step = duel({ b: FAR });
    run(step.s, step.data, 2, (t) => ({ a: inp(tap(DODGE, 1, t), FACE_PLUS_Z) }));
    const a1 = fighter(step.s, 'a');
    expect(a1.dodgeKind).toBe('step');
    expect(a1.stamina).toBe(C.maxStamina - C.dodge.step.staminaCost);
    run(step.s, step.data, 28);
    expect(Math.abs(a1.pos.z)).toBeCloseTo(C.dodge.step.distance, 1);

    const roll = duel({ b: FAR });
    run(roll.s, roll.data, 2, (t) => ({ a: inp(t === 1 ? RUN | DODGE : 0, FACE_PLUS_Z, 0, t === 1 ? 1 : 0) }));
    const a2 = fighter(roll.s, 'a');
    expect(a2.dodgeKind).toBe('roll');
    expect(a2.stamina).toBeLessThan(C.maxStamina - C.dodge.roll.staminaCost + 1);
    run(roll.s, roll.data, 38);
    expect(a2.pos.z).toBeCloseTo(C.dodge.roll.distance, 1);
  });

  // Distância 0 para isolar o timing (o alvo não sai do alcance).
  function still() {
    const r = duel();
    r.data.constants.dodge.step.distance = 0;
    r.data.constants.dodge.roll.distance = 0;
    return r;
  }

  it('esquiva perfeita: golpe pelos i-frames logo no começo da esquiva dá estamina, Raça e contra-golpe', () => {
    const { s, data } = still();
    const ev = run(s, data, 12, (t) => ({ a: inp(tap(LIGHT, 1, t), FACE_PLUS_Z), b: inp(tap(DODGE, 4, t), FACE_MINUS_Z) }));
    expect(ofType(ev, 'perfectDodge')).toHaveLength(1);
    expect(ofType(ev, 'hit')).toHaveLength(0);
    const b = fighter(s, 'b');
    expect(b.raca).toBe(C.raca.perfectDodge);
    expect(b.counterUntil).toBeGreaterThan(s.tick);
  });

  it('esquivar cedo demais (fim do rolamento) não é perfeita', () => {
    const { s, data } = still();
    // Rolamento no tick 6; o golpe chega no tick 15 = frame 10 do rolamento (i-frame, mas fora da janela).
    const ev = run(s, data, 25, (t) => ({ a: inp(tap(LIGHT, 10, t), FACE_PLUS_Z), b: inp(t === 6 ? RUN | DODGE : 0, FACE_MINUS_Z, 0, t === 6 ? -1 : 0) }));
    expect(fighter(s, 'b').dodgeKind).toBe('roll');
    expect(ofType(ev, 'hit')).toHaveLength(0);
    expect(ofType(ev, 'perfectDodge')).toHaveLength(0);
  });
});

describe('bloqueio', () => {
  it('contra-golpe depois do parry: 1,6× dentro da janela, normal depois', () => {
    const counterHit = (lightAt: number) => {
      const { s, data } = duel();
      const ev = run(s, data, lightAt + 10, (t) => ({
        a: inp(tap(LIGHT, 1, t), FACE_PLUS_Z),
        b: inp((t >= 3 && t < 8 ? BLOCK : 0) | tap(LIGHT, lightAt, t), FACE_MINUS_Z),
      }));
      expect(ofType(ev, 'parry')).toHaveLength(1);
      return ofType(ev, 'hit').find((h) => h.attacker === 'b');
    };
    const inside = counterHit(14);
    expect(inside?.counter).toBe(true);
    expect(inside?.damage).toBeCloseTo(6 * C.counter.damageMultiplier);
    const after = counterHit(52);
    expect(after?.counter).toBe(false);
    expect(after?.damage).toBeCloseTo(6);
  });

  it('leve no blockstun cancela num contra-ataque pagando estamina', () => {
    const { s, data } = duel();
    const b = fighter(s, 'b');
    run(s, data, 26, (t) => ({ a: inp(tap(LIGHT, 20, t), FACE_PLUS_Z), b: inp(BLOCK, FACE_MINUS_Z) }));
    expect(b.state).toBe('blockstun');
    const before = b.stamina;
    run(s, data, 2, (t) => ({ b: inp(BLOCK | tap(LIGHT, 27, t), FACE_MINUS_Z) }));
    expect(b.state).toBe('attack');
    expect(before - b.stamina).toBeCloseTo(C.blockCounterCost + 8, 0);
  });

  it('bloquear faca de mão vazia corta; com cassetete não', () => {
    const bleedsAfterBlock = (weapon: string) => {
      const { s, data } = duel({ a: { weapon: 'faca' }, b: { weapon } });
      const ev = run(s, data, 30, (t) => ({ a: inp(tap(LIGHT, 20, t), FACE_PLUS_Z), b: inp(BLOCK, FACE_MINUS_Z) }));
      expect(ofType(ev, 'block')).toHaveLength(1);
      return fighter(s, 'b').bleeds.length;
    };
    expect(bleedsAfterBlock('punhos')).toBe(1);
    expect(bleedsAfterBlock('cassetete')).toBe(0);
  });
});

describe('Raça e especiais', () => {
  it('especial é negado sem Raça e gasta Raça quando sai', () => {
    const { s, data } = duel();
    const a = fighter(s, 'a');
    let ev = run(s, data, 5, (t) => ({ a: inp(tap(SPECIAL, 1, t), FACE_PLUS_Z), b: inp(0, FACE_MINUS_Z) }));
    expect(ofType(ev, 'special')).toHaveLength(0);
    a.raca = C.raca.specialCost + 10;
    ev = run(s, data, 5, (t) => ({ a: inp(tap(SPECIAL, 7, t), FACE_PLUS_Z), b: inp(0, FACE_MINUS_Z) }));
    expect(ofType(ev, 'special')).toHaveLength(1);
    expect(a.raca).toBe(10);
  });

  it('acertar e apanhar enchem a Raça', () => {
    const { s, data } = duel();
    run(s, data, 10, (t) => ({ a: inp(tap(LIGHT, 1, t), FACE_PLUS_Z), b: inp(0, FACE_MINUS_Z) }));
    expect(fighter(s, 'a').raca).toBeCloseTo(6 * C.raca.perDamageDealt);
    expect(fighter(s, 'b').raca).toBeCloseTo(6 * C.raca.perDamageTaken);
  });

  it('sequência de rua (punhos) acerta 5 vezes e a última derruba', () => {
    const { s, data } = duel();
    fighter(s, 'a').raca = C.raca.specialCost;
    const ev = run(s, data, 90, (t) => ({ a: inp(tap(SPECIAL, 1, t), FACE_PLUS_Z), b: inp(0, FACE_MINUS_Z) }));
    const hits = ofType(ev, 'hit').filter((h) => h.move === 'punhos.esp');
    expect(hits).toHaveLength(5);
    expect(hits.at(-1)?.knockdown).toBe(true);
    expect(hits.slice(0, 4).every((h) => !h.knockdown)).toBe(true);
  });

  it('rodada do taco acerta quem está atrás', () => {
    const { s, data } = duel({ a: { weapon: 'taco' }, b: { pos: { x: 0, z: -0.9 }, facing: FACE_PLUS_Z } });
    fighter(s, 'a').raca = C.raca.specialCost;
    const ev = run(s, data, 40, (t) => ({ a: inp(tap(SPECIAL, 1, t), FACE_PLUS_Z), b: inp(0, FACE_PLUS_Z) }));
    expect(ofType(ev, 'hit').some((h) => h.move === 'taco.esp' && h.target === 'b')).toBe(true);
  });

  it('martelada (barra) atravessa o bloqueio', () => {
    const { s, data } = duel({ a: { weapon: 'barra' } });
    fighter(s, 'a').raca = C.raca.specialCost;
    const ev = run(s, data, 50, (t) => ({ a: inp(tap(SPECIAL, 1, t), FACE_PLUS_Z), b: inp(BLOCK, FACE_MINUS_Z) }));
    expect(ofType(ev, 'block')).toHaveLength(0);
    expect(ofType(ev, 'hit').find((h) => h.move === 'barra.esp')?.damage).toBeCloseTo(data.weapons.barra?.moves.special.damage ?? -1);
  });

  it('grito da torcida: gasta 100 de Raça e dá bônus de dano aos aliados perto', () => {
    const { s, data } = duel({ b: FAR });
    s.fighters.push(createFighter({ id: 'c', team: 0, pos: { x: 3, z: 0 } }), createFighter({ id: 'd', team: 0, pos: { x: 20, z: 0 } }));
    fighter(s, 'a').raca = 100;
    const ev = run(s, data, 3, (t) => ({ a: inp(tap(SHOUT, 1, t), FACE_PLUS_Z) }));
    expect(ofType(ev, 'shout')[0]?.buffed.sort()).toEqual(['a', 'c']);
    expect(fighter(s, 'a').raca).toBe(0);
    expect(fighter(s, 'a').state).toBe('shout');
    // Com o buff, o soco causa +20%.
    const b = fighter(s, 'b');
    b.pos = { x: 3, z: 0.9 };
    run(s, data, 45);
    const hit = ofType(
      run(s, data, 10, (t) => ({ c: inp(tap(LIGHT, s.tick + 1, t), FACE_PLUS_Z), b: inp(0, FACE_MINUS_Z) })),
      'hit',
    )[0];
    expect(hit?.damage).toBeCloseTo(6 * (1 + C.shout.damageBonus));
  });
});

describe('golpes de contexto', () => {
  it('voadora: chute no ar, acerta quem também está pulando e derruba', () => {
    const { s, data } = duel();
    const ev = run(s, data, 30, (t) => ({ a: inp(tap(JUMP, 1, t) | tap(KICK, 4, t), FACE_PLUS_Z), b: inp(tap(JUMP, 2, t), FACE_MINUS_Z) }));
    const hit = ofType(ev, 'hit')[0];
    expect(hit?.move).toBe('voadora');
    expect(hit?.knockdown).toBe(true);
  });

  it('cabeçada só sai em inimigo atordoado; senão é empurrão', () => {
    const moveUsed = (dazed: boolean) => {
      const { s, data } = duel();
      if (dazed) enterState(fighter(s, 'b'), 'staggered', 120);
      const ev = run(s, data, 15, (t) => ({ a: inp(tap(SHOVE, 1, t), FACE_PLUS_Z) }));
      return ofType(ev, 'hit')[0]?.move;
    };
    expect(moveUsed(true)).toBe('cabecada');
    expect(moveUsed(false)).toBe('empurrao');
  });
});

describe('cura', () => {
  it('curativo cura em etapas durante 2 s e estanca o sangramento', () => {
    const { s, data } = duel({ b: FAR });
    const a = fighter(s, 'a');
    a.hp = 50;
    a.curativos = 1;
    a.bleeds = [{ ticksLeft: 100, sourceId: 'b' }];
    a.lastCombatTick = 0;
    const ev = run(s, data, 130, (t) => ({ a: inp(tap(HEAL, 1, t), FACE_PLUS_Z) }));
    expect(a.curativos).toBe(0);
    expect(a.bleeds).toHaveLength(0);
    const total = (C.curativo.ticks / C.curativo.interval) * C.curativo.amount;
    expect(a.hp).toBeCloseTo(50 + total);
    expect(ofType(ev, 'heal').reduce((n, e) => n + e.amount, 0)).toBeCloseTo(total);
  });

  it('curativo interrompido por um acerto fica com a cura parcial', () => {
    const { s, data } = duel();
    const a = fighter(s, 'a');
    a.hp = 50;
    a.curativos = 1;
    run(s, data, 130, (t) => ({ a: inp(tap(HEAL, 1, t), FACE_PLUS_Z), b: inp(tap(LIGHT, 40, t), FACE_MINUS_Z) }));
    // Uma etapa no tick 30, soco de 6 no tick 45, e para de curar.
    expect(a.hp).toBeCloseTo(50 + C.curativo.amount - 6);
  });

  it('sem curativo não canaliza', () => {
    const { s, data } = duel({ b: FAR });
    fighter(s, 'a').hp = 50;
    fighter(s, 'a').curativos = 0;
    run(s, data, 3, (t) => ({ a: inp(tap(HEAL, 1, t), FACE_PLUS_Z) }));
    expect(fighter(s, 'a').state).toBe('idle');
  });

  it('carrinho de churrasquinho: cobra, cura e tem recarga', () => {
    const cart = { x: 0, z: 2, hw: 0.7, hd: 1.1, h: 1.3, kind: 'carrinho' as const, color: '#000' };
    const { s, data } = duel({ b: FAR, collision: { boxes: [cart], circles: [], halfW: 40, halfD: 40 } });
    const a = fighter(s, 'a');
    a.hp = 50;
    run(s, data, 100, (t) => ({ a: inp(tap(USE, 1, t), FACE_PLUS_Z) }));
    expect(a.money).toBe(300 - C.cart.cost);
    expect(a.hp).toBeCloseTo(50 + (C.cart.ticks / C.cart.interval) * C.cart.amount);
    run(s, data, 3, (t) => ({ a: inp(tap(USE, 102, t), FACE_PLUS_Z) }));
    expect(a.state).toBe('idle');
    expect(a.money).toBe(300 - C.cart.cost);
  });

  it('fôlego: só depois de 6 s sem combate e só até 60', () => {
    const { s, data } = duel({ b: FAR });
    const a = fighter(s, 'a');
    a.hp = 30;
    run(s, data, C.breath.delay - 1);
    expect(a.hp).toBe(30);
    run(s, data, 600);
    expect(a.hp).toBe(C.breath.cap);
  });
});

describe('caído e levantar companheiro', () => {
  function downedDuel(): { s: SimState; data: ReturnType<typeof duel>['data'] } {
    const r = duel({ rules: { downed: true } });
    r.s.fighters.push(createFighter({ id: 'c', team: 1, pos: { x: 0.9, z: 1.9 } }));
    fighter(r.s, 'b').hp = 5;
    return r;
  }

  /** Derruba o b e tira o atacante de perto (fora de combate dá para levantar). */
  function knockDownAndLeave(s: SimState, data: ReturnType<typeof duel>['data']): SimEvent[] {
    const ev = run(s, data, 20, (t) => ({ a: inp(tap(LIGHT, 1, t), FACE_PLUS_Z) }));
    fighter(s, 'a').pos = { x: 30, z: 30 };
    return ev;
  }

  it('HP 0 deixa caído (sem KO); um aliado levanta segurando X', () => {
    const { s, data } = downedDuel();
    const ev = [...knockDownAndLeave(s, data), ...run(s, data, 220, () => ({ c: inp(USE, FACE_MINUS_Z) }))];
    expect(ofType(ev, 'downed')).toHaveLength(1);
    expect(ofType(ev, 'ko')).toHaveLength(0);
    expect(ofType(ev, 'revive')[0]).toMatchObject({ target: 'b', by: 'c' });
    const b = fighter(s, 'b');
    expect(b.hp).toBe(C.downed.reviveHp);
    expect(['getup', 'idle']).toContain(b.state);
  });

  it('soltar o X interrompe o levantamento', () => {
    const { s, data } = downedDuel();
    knockDownAndLeave(s, data);
    const ev = run(s, data, 220, (t) => ({ c: inp(t < 80 ? USE : 0, FACE_MINUS_Z) }));
    expect(ofType(ev, 'revive')).toHaveLength(0);
    expect(fighter(s, 'b').state).toBe('downed');
  });

  it('com inimigo perto não dá para levantar', () => {
    const { s, data } = downedDuel();
    // O atacante fica do lado do caído.
    const ev = run(s, data, 240, (t) => ({ a: inp(tap(LIGHT, 1, t), FACE_PLUS_Z), c: inp(t >= 20 ? USE : 0, FACE_MINUS_Z) }));
    expect(ofType(ev, 'revive')).toHaveLength(0);
    expect(fighter(s, 'c').state).not.toBe('reviving');
  });

  it('logo depois de brigar não dá para levantar; 5 s depois, dá', () => {
    const { s, data } = downedDuel();
    knockDownAndLeave(s, data);
    const c = fighter(s, 'c');
    c.lastCombatTick = s.tick; // acabou de levar/dar um golpe
    let ev = run(s, data, 30, () => ({ c: inp(USE, FACE_MINUS_Z) }));
    expect(c.state).not.toBe('reviving');
    run(s, data, C.downed.combatLockTicks, () => ({ c: inp(0, FACE_MINUS_Z) }));
    ev = run(s, data, C.downed.reviveTicks + 10, () => ({ c: inp(USE, FACE_MINUS_Z) }));
    expect(ofType(ev, 'revive')[0]).toMatchObject({ target: 'b', by: 'c' });
  });

  it('inimigo chegando perto interrompe o levantamento', () => {
    const { s, data } = downedDuel();
    knockDownAndLeave(s, data);
    run(s, data, 30, () => ({ c: inp(USE, FACE_MINUS_Z) }));
    expect(fighter(s, 'c').state).toBe('reviving');
    fighter(s, 'a').pos = { x: 2, z: 4 };
    const ev = run(s, data, 5, () => ({ c: inp(USE, FACE_MINUS_Z) }));
    expect(fighter(s, 'c').state).not.toBe('reviving');
    expect(ofType(ev, 'revive')).toHaveLength(0);
  });

  it('finalizar quem está caído leva alguns golpes (vida de caído) e o KO é de quem derrubou', () => {
    const { s, data } = downedDuel();
    const a = fighter(s, 'a');
    const b = fighter(s, 'b');
    const ev = run(s, data, 400, (t) => ({ a: inp(t % 24 === 1 ? LIGHT : 0, yawTo(a.pos, b.pos)) }));
    const finishing = ofType(ev, 'hit').filter((h) => h.target === 'b');
    expect(finishing.length).toBeGreaterThan(2);
    expect(ofType(ev, 'ko')[0]).toMatchObject({ target: 'b', killer: 'a' });
  });

  it('caído por 10 s sangra até o KO', () => {
    const { s, data } = downedDuel();
    const ev = run(s, data, C.downed.ticks + 20, (t) => ({ a: inp(tap(LIGHT, 1, t), FACE_PLUS_Z) }));
    expect(ofType(ev, 'ko')[0]).toMatchObject({ target: 'b', killer: 'a' });
  });

  it('sem a regra (lab/testes antigos), HP 0 é KO direto', () => {
    const { s, data } = duel();
    fighter(s, 'b').hp = 5;
    const ev = run(s, data, 10, (t) => ({ a: inp(tap(LIGHT, 1, t), FACE_PLUS_Z) }));
    expect(ofType(ev, 'downed')).toHaveLength(0);
    expect(ofType(ev, 'ko')).toHaveLength(1);
  });
});

describe('bater correndo', () => {
  it('golpe saindo da corrida leva o embalo (desloca mais que parado)', () => {
    const still = duel({ b: FAR });
    run(still.s, still.data, 30, (t) => ({ a: inp(tap(LIGHT, 1, t), FACE_PLUS_Z) }));
    const running = duel({ b: FAR });
    run(running.s, running.data, 20, () => ({ a: inp(RUN, FACE_PLUS_Z, 0, 1) }));
    const z0 = fighter(running.s, 'a').pos.z;
    // Aperta o leve ainda correndo e depois solta tudo: só o golpe (com o embalo) desloca.
    run(running.s, running.data, 30, (t) => ({ a: t === 21 ? inp(LIGHT | RUN, FACE_PLUS_Z, 0, 1) : inp(0, FACE_PLUS_Z) }));
    const moved = fighter(running.s, 'a').pos.z - z0;
    expect(moved).toBeGreaterThan(fighter(still.s, 'a').pos.z + 0.8);
  });

  it('dá para se mover durante o golpe', () => {
    const { s, data } = duel({ b: FAR });
    run(s, data, 18, (t) => ({ a: inp(tap(LIGHT, 1, t), FACE_PLUS_Z, 1, 0) }));
    expect(fighter(s, 'a').pos.x).toBeGreaterThan(0.5);
  });
});

describe('mira grudada (lock-on)', () => {
  /** A no centro; inimigo perto à direita (+X) e outro mais longe à frente (+Z). */
  function threeWay() {
    const r = duel({ b: { pos: { x: 3, z: 0 } } });
    r.s.fighters.push(createFighter({ id: 'd', team: 1, pos: { x: 0, z: 8 } }));
    return r;
  }

  it('trava no inimigo para onde está mirando, não no mais próximo', () => {
    const { s, data } = threeWay();
    run(s, data, 2, (t) => ({ a: inp(tap(Buttons.LOCK, 1, t), FACE_PLUS_Z) }));
    expect(fighter(s, 'a').lockTarget).toBe('d');
  });

  it('roda do mouse troca de alvo', () => {
    const { s, data } = threeWay();
    run(s, data, 2, (t) => ({ a: inp(tap(Buttons.LOCK, 1, t), FACE_PLUS_Z) }));
    run(s, data, 2, (t) => ({ a: inp(tap(Buttons.LOCK_NEXT, s.tick + 1 === t ? t : -1, t), FACE_PLUS_Z) }));
    expect(fighter(s, 'a').lockTarget).toBe('b');
  });

  it('travado, o golpe acompanha o alvo mesmo com a mira para outro lado', () => {
    const { s, data } = duel({ b: { pos: { x: 0.9, z: 0 } } });
    run(s, data, 2, (t) => ({ a: inp(tap(Buttons.LOCK, 1, t), Math.PI / 2) }));
    // Mira para trás e bate: o corpo continua virado para o alvo e acerta.
    const ev = run(s, data, 20, (t) => ({ a: inp(tap(LIGHT, 3, t), -Math.PI / 2) }));
    expect(ofType(ev, 'hit')).toHaveLength(1);
  });
});

describe('fluidez', () => {
  it('esquiva cancela a recuperação de qualquer golpe', () => {
    const { s, data } = duel({ b: FAR });
    const heavyStart = 1;
    // Pesado sem carregar (solta logo): na recuperação, esquiva sai na hora.
    run(s, data, 40, (t) => ({ a: inp(t === heavyStart ? Buttons.HEAVY : 0, FACE_PLUS_Z) }));
    const a = fighter(s, 'a');
    expect(a.state).toBe('attack');
    run(s, data, 1, () => ({ a: inp(DODGE, FACE_PLUS_Z) }));
    expect(a.state).toBe('dodge');
  });

  it('o buffer não envelhece durante o hitstop', () => {
    // Acerta com o leve; aperta o próximo no primeiro tick de hitstop e solta.
    const { s: s2, data: d2 } = duel();
    let pressedAt = -1;
    const ev = run(s2, d2, 60, (t) => {
      const me = fighter(s2, 'a');
      if (pressedAt < 0 && me.hitstop > 0) pressedAt = t;
      return { a: inp(t === 1 || t === pressedAt ? LIGHT : 0, FACE_PLUS_Z) };
    });
    expect(ofType(ev, 'hit').map((h) => h.move)).toEqual(['punhos.l1', 'punhos.l2']);
  });
});
