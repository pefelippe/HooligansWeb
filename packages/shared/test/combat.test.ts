import { describe, expect, it } from 'vitest';
import { buy, canBuy, cloneSim, DEFAULT_COMBAT_DATA, DEFAULT_CONSTANTS, ECONOMY, shotFalloff } from '../src';
import { Buttons, duel, FACE_MINUS_Z, FACE_PLUS_Z, fighter, inp, ofType, run, tap } from './helpers';

const { LIGHT, HEAVY, BLOCK, DODGE, SHOVE, KICK, RUN, JUMP } = Buttons;

// Golpe leve de punhos: startup 5, active 3. Apertado no tick 1, acerta no tick 6.
const LIGHT_HIT_TICK = 6;

describe('parry', () => {
  it('bloquear dentro da janela (~150 ms antes do impacto) atordoa o atacante', () => {
    const { s, data } = duel();
    const blockAt = LIGHT_HIT_TICK - 3;
    const ev = run(s, data, 12, (t) => ({
      a: inp(tap(LIGHT, 1, t), FACE_PLUS_Z),
      b: inp(t >= blockAt ? BLOCK : 0, FACE_MINUS_Z),
    }));
    expect(ofType(ev, 'parry')).toHaveLength(1);
    expect(ofType(ev, 'hit')).toHaveLength(0);
    expect(fighter(s, 'a').state).toBe('staggered');
    expect(fighter(s, 'b').hp).toBe(DEFAULT_CONSTANTS.maxHp);
  });

  it('no limite exato da janela ainda é parry; um tick antes já é bloqueio comum', () => {
    const w = DEFAULT_CONSTANTS.parryWindow;
    for (const [offset, expected] of [
      [w, 'parry'],
      [w + 1, 'block'],
    ] as const) {
      const { s, data } = duel();
      const attackAt = 20;
      const hitTick = attackAt + LIGHT_HIT_TICK - 1;
      const ev = run(s, data, 40, (t) => ({
        a: inp(tap(LIGHT, attackAt, t), FACE_PLUS_Z),
        b: inp(t >= hitTick - offset ? BLOCK : 0, FACE_MINUS_Z),
      }));
      expect(ev.find((e) => e.type === 'parry' || e.type === 'block')?.type).toBe(expected);
    }
  });

  it('apertar o bloqueio repetidamente não mantém a janela de parry aberta (anti-spam)', () => {
    const { s, data } = duel();
    const attackAt = 20;
    // Toca o bloqueio (2 ticks apertado, 1 solto) desde bem antes do golpe até o impacto.
    const ev = run(s, data, 40, (t) => ({
      a: inp(tap(LIGHT, attackAt, t), FACE_PLUS_Z),
      b: inp(t % 3 !== 0 ? BLOCK : 0, FACE_MINUS_Z),
    }));
    expect(ofType(ev, 'parry')).toHaveLength(0);
    expect(fighter(s, 'b').stamina).toBeLessThan(DEFAULT_CONSTANTS.maxStamina - 5 * DEFAULT_CONSTANTS.blockEnterCost);
  });

  it('parry volta a funcionar depois do lockout', () => {
    const { s, data } = duel();
    const hitTick = 40 + LIGHT_HIT_TICK - 1;
    const release = hitTick - 3 - DEFAULT_CONSTANTS.parryLockout - 2;
    const ev = run(s, data, 60, (t) => ({
      a: inp(tap(LIGHT, 40, t), FACE_PLUS_Z),
      b: inp(t < release || t >= hitTick - 3 ? BLOCK : 0, FACE_MINUS_Z),
    }));
    expect(ofType(ev, 'parry')).toHaveLength(1);
  });

  it('bloqueio segurado muito antes é bloqueio comum: dano reduzido e blockstun', () => {
    const { s, data } = duel();
    const ev = run(s, data, LIGHT_HIT_TICK + 19, (t) => ({
      a: inp(tap(LIGHT, 20, t), FACE_PLUS_Z),
      b: inp(BLOCK, FACE_MINUS_Z),
    }));
    const blocks = ofType(ev, 'block');
    expect(ofType(ev, 'parry')).toHaveLength(0);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.chip).toBeCloseTo(6 * 0.5);
    expect(fighter(s, 'b').hp).toBeCloseTo(DEFAULT_CONSTANTS.maxHp - 3);
    expect(fighter(s, 'b').state).toBe('blockstun');
  });

  it('bloqueio não protege golpes pelas costas', () => {
    const { s, data } = duel({ b: { facing: FACE_PLUS_Z } });
    const ev = run(s, data, 30, (t) => ({
      a: inp(tap(LIGHT, 20, t), FACE_PLUS_Z),
      b: inp(BLOCK, FACE_PLUS_Z),
    }));
    expect(ofType(ev, 'hit')).toHaveLength(1);
    expect(ofType(ev, 'block')).toHaveLength(0);
  });
});

describe('guard break', () => {
  it('bloquear com estamina insuficiente zera a estamina e atordoa', () => {
    const { s, data } = duel();
    const b = fighter(s, 'b');
    b.stamina = 3;
    b.lastStaminaSpendTick = 0; // sem regen durante o teste
    const ev = run(s, data, 30, (t) => ({
      a: inp(tap(LIGHT, 20, t), FACE_PLUS_Z),
      b: inp(BLOCK, FACE_MINUS_Z),
    }));
    expect(ofType(ev, 'guardbreak')).toHaveLength(1);
    expect(b.stamina).toBe(0);
    expect(b.state).toBe('guardbreak');
  });

  it('empurrão quebra a guarda mesmo com estamina cheia', () => {
    const { s, data } = duel();
    const ev = run(s, data, 40, (t) => ({
      a: inp(tap(SHOVE, 20, t), FACE_PLUS_Z),
      b: inp(BLOCK, FACE_MINUS_Z),
    }));
    expect(ofType(ev, 'guardbreak')).toHaveLength(1);
    expect(fighter(s, 'b').state).toBe('guardbreak');
  });

  it('não regenera estamina durante o guard break', () => {
    const { s, data } = duel();
    const b = fighter(s, 'b');
    b.stamina = 3;
    b.lastStaminaSpendTick = -1000;
    run(s, data, 30, (t) => ({ a: inp(tap(LIGHT, 20, t), FACE_PLUS_Z), b: inp(BLOCK, FACE_MINUS_Z) }));
    expect(b.state).toBe('guardbreak');
    run(s, data, 20);
    expect(b.state).toBe('guardbreak');
    expect(b.stamina).toBe(0);
  });
});

describe('esquiva', () => {
  // Distância 0 para isolar os i-frames (sem isso o alvo simplesmente sairia do alcance).
  function dodgeDuel() {
    const r = duel();
    r.data.constants.dodge.step.distance = 0;
    return r;
  }

  it('golpe que cai nos i-frames não acerta', () => {
    const { s, data } = dodgeDuel();
    const ev = run(s, data, 30, (t) => ({
      a: inp(tap(LIGHT, 1, t), FACE_PLUS_Z),
      b: inp(tap(DODGE, LIGHT_HIT_TICK - 2, t), FACE_MINUS_Z),
    }));
    expect(ofType(ev, 'hit')).toHaveLength(0);
    expect(fighter(s, 'b').hp).toBe(DEFAULT_CONSTANTS.maxHp);
  });

  it('esquiva atrasada (primeiro frame, antes dos i-frames) é acertada', () => {
    const { s, data } = dodgeDuel();
    const ev = run(s, data, 30, (t) => ({
      a: inp(tap(LIGHT, 1, t), FACE_PLUS_Z),
      b: inp(tap(DODGE, LIGHT_HIT_TICK, t), FACE_MINUS_Z),
    }));
    expect(ofType(ev, 'hit')).toHaveLength(1);
  });

  it('esquiva custa estamina e é negada sem estamina', () => {
    const { s, data } = dodgeDuel();
    const b = fighter(s, 'b');
    b.stamina = DEFAULT_CONSTANTS.dodge.step.staminaCost - 1;
    b.lastStaminaSpendTick = 0;
    run(s, data, 2, (t) => ({ b: inp(tap(DODGE, 1, t), FACE_MINUS_Z) }));
    expect(b.state).toBe('idle');
  });
});

describe('golpes', () => {
  it('combo leve de 3 golpes encadeia com o botão no cancel window', () => {
    const { s, data } = duel();
    // Aperta leve a cada 6 ticks (soltando entre um e outro); o buffer segura até o cancel window.
    const ev = run(s, data, 80, (t) => ({ a: inp(t < 40 && t % 6 === 1 ? LIGHT : 0, FACE_PLUS_Z), b: inp(0, FACE_MINUS_Z) }));
    const moves = ofType(ev, 'hit').map((h) => h.move);
    expect(moves).toEqual(['punhos.l1', 'punhos.l2', 'punhos.l3']);
  });

  it('sem estamina não ataca (anti-spam)', () => {
    const { s, data } = duel();
    const a = fighter(s, 'a');
    a.stamina = 2;
    a.lastStaminaSpendTick = 0;
    const ev = run(s, data, 20, (t) => ({ a: inp(tap(LIGHT, 1, t), FACE_PLUS_Z) }));
    expect(ofType(ev, 'hit')).toHaveLength(0);
    expect(a.state).toBe('idle');
  });

  it('golpe leve interrompe o startup de quem não tem armadura', () => {
    const { s, data } = duel();
    const ev = run(s, data, 12, (t) => ({
      a: inp(tap(LIGHT, 1, t), FACE_PLUS_Z),
      b: inp(tap(KICK, 2, t), FACE_MINUS_Z), // chute: startup 9, perde a troca
    }));
    expect(ofType(ev, 'hit').map((h) => h.attacker)).toEqual(['a']);
    expect(fighter(s, 'b').state).toBe('hitstun');
  });

  it('pesado tem hyper-armor parcial: leva dano reduzido e não é interrompido', () => {
    const { s, data } = duel();
    const ev = run(s, data, 60, (t) => ({
      a: inp(tap(LIGHT, 3, t), FACE_PLUS_Z),
      b: inp(t === 1 ? HEAVY : 0, FACE_MINUS_Z), // toque: carga mínima
    }));
    const hits = ofType(ev, 'hit');
    const onB = hits.find((h) => h.target === 'b');
    expect(onB?.armored).toBe(true);
    expect(onB?.damage).toBeCloseTo(6 * DEFAULT_CONSTANTS.armorDamageMultiplier);
    expect(hits.some((h) => h.attacker === 'b' && h.move === 'punhos.h')).toBe(true);
  });

  it('pesado carregado causa mais dano', () => {
    const dmg = (hold: number) => {
      const { s, data } = duel();
      const ev = run(s, data, 120, (t) => ({ a: inp(t <= hold ? HEAVY : 0, FACE_PLUS_Z), b: inp(0, FACE_MINUS_Z) }));
      return ofType(ev, 'hit')[0]?.damage ?? 0;
    };
    expect(dmg(40)).toBeCloseTo(16 * 1.6);
    expect(dmg(1)).toBeLessThan(dmg(20));
  });

  it('chute derruba e o levantar tem i-frames', () => {
    const { s, data } = duel();
    const ev = run(s, data, 15, (t) => ({ a: inp(tap(KICK, 1, t), FACE_PLUS_Z), b: inp(0, FACE_MINUS_Z) }));
    expect(ofType(ev, 'hit')[0]?.knockdown).toBe(true);
    expect(fighter(s, 'b').state).toBe('knockdown');
    run(s, data, DEFAULT_CONSTANTS.knockdownTicks);
    expect(fighter(s, 'b').state).toBe('getup');
  });

  it('é determinístico: mesmo estado e inputs geram o mesmo resultado', () => {
    const { s, data } = duel();
    const copy = cloneSim(s);
    const script = (t: number) => ({
      a: inp(t % 7 === 1 ? LIGHT : t % 23 === 0 ? HEAVY : 0, Math.sin(t / 10), Math.cos(t / 9), 0.3),
      b: inp(t % 11 < 4 ? BLOCK : t % 31 === 0 ? DODGE : 0, FACE_MINUS_Z + Math.sin(t / 13), -0.2, Math.sin(t / 5)),
    });
    const e1 = run(s, data, 600, script);
    const e2 = run(copy, data, 600, script);
    expect(e2).toEqual(e1);
    expect(copy).toEqual(s);
  });
});

describe('armas', () => {
  it('sangramento da faca acumula por golpe', () => {
    const { s, data } = duel({ a: { weapon: 'faca' } });
    const ev = run(s, data, 60, (t) => ({
      a: inp(tap(LIGHT, 1, t) | tap(LIGHT, 40, t), FACE_PLUS_Z),
      b: inp(0, FACE_MINUS_Z),
    }));
    expect(ofType(ev, 'hit')).toHaveLength(2);
    const b = fighter(s, 'b');
    expect(b.bleeds).toHaveLength(2);
    const hpAfterHits = DEFAULT_CONSTANTS.maxHp - ofType(ev, 'hit').reduce((sum, h) => sum + h.damage, 0) - ofType(ev, 'bleed').reduce((sum, e) => sum + e.damage, 0);
    expect(b.hp).toBeCloseTo(hpAfterHits);

    const later = run(s, data, 200);
    const { duration, interval, damagePerInterval } = DEFAULT_CONSTANTS.bleed;
    const totalBleed = [...ev, ...later].filter((e) => e.type === 'bleed').length * damagePerInterval;
    expect(totalBleed).toBe(2 * (duration / interval) * damagePerInterval);
    expect(b.bleeds).toHaveLength(0);
  });

  it('punhal causa dano de backstab só pelas costas', () => {
    const hitDamage = (bFacing: number) => {
      const { s, data } = duel({ a: { weapon: 'punhal' }, b: { facing: bFacing } });
      const ev = run(s, data, 20, (t) => ({ a: inp(tap(LIGHT, 1, t), FACE_PLUS_Z), b: inp(0, bFacing) }));
      return ofType(ev, 'hit')[0];
    };
    const front = hitDamage(FACE_MINUS_Z);
    const back = hitDamage(FACE_PLUS_Z);
    const side = hitDamage(Math.PI / 2);
    expect(front?.backstab).toBe(false);
    expect(front?.damage).toBeCloseTo(8);
    expect(side?.backstab).toBe(false);
    expect(back?.backstab).toBe(true);
    expect(back?.damage).toBeCloseTo(8 * 2.5);
  });

  it('garrafa quebra no primeiro acerto e vira caco cortante', () => {
    const { s, data } = duel({ a: { weapon: 'garrafa' } });
    const ev = run(s, data, 20, (t) => ({ a: inp(tap(LIGHT, 1, t), FACE_PLUS_Z), b: inp(0, FACE_MINUS_Z) }));
    expect(ofType(ev, 'weaponBreak')[0]).toMatchObject({ weapon: 'garrafa', into: 'caco' });
    expect(fighter(s, 'a').weapon).toBe('caco');
    expect(fighter(s, 'a').durability).toBe(data.weapons.caco?.durabilidade);
  });

  it('cassetete bloqueia melhor que punhos', () => {
    const chip = (weapon: string) => {
      const { s, data } = duel({ b: { weapon } });
      const ev = run(s, data, 30, (t) => ({ a: inp(tap(LIGHT, 20, t), FACE_PLUS_Z), b: inp(BLOCK, FACE_MINUS_Z) }));
      return ofType(ev, 'block')[0];
    };
    const fists = chip('punhos');
    const baton = chip('cassetete');
    expect(baton?.chip).toBeLessThan(fists?.chip ?? 0);
    expect(baton?.staminaDrain).toBeLessThan(fists?.staminaDrain ?? 0);
  });
});

describe('KO, respawn e economia', () => {
  const sedes = [
    { team: 0 as const, pos: { x: -20, z: 0 } },
    { team: 1 as const, pos: { x: 20, z: 0 } },
  ];

  it('KO dá dinheiro, assistência conta, e o morto renasce na sede após 5 s', () => {
    const { s, data } = duel({ sedes });
    s.fighters.push({ ...structuredClone(fighter(s, 'a')), id: 'c', pos: { x: 5, z: 5 } });
    const b = fighter(s, 'b');
    b.damagedBy.c = 0; // c causou dano recentemente
    b.hp = 4;
    const ev = run(s, data, 10, (t) => ({ a: inp(tap(LIGHT, 1, t), FACE_PLUS_Z), b: inp(0, FACE_MINUS_Z) }));
    const ko = ofType(ev, 'ko')[0];
    expect(ko).toMatchObject({ target: 'b', killer: 'a', assists: ['c'] });
    expect(fighter(s, 'a').money).toBe(ECONOMY.startMoney + ECONOMY.hit + ECONOMY.ko);
    expect(fighter(s, 'c').money).toBe(ECONOMY.startMoney + ECONOMY.assist);
    expect(b.money).toBe(ECONOMY.startMoney + ECONOMY.deathConsolation);

    const koTick = ko?.tick ?? 0;
    run(s, data, DEFAULT_CONSTANTS.respawnTicks - (s.tick - koTick) - 1);
    expect(b.state).toBe('dead');
    const ev2 = run(s, data, 1);
    expect(ofType(ev2, 'respawn')).toHaveLength(1);
    expect(Math.hypot(b.pos.x - 20, b.pos.z)).toBeLessThan(DEFAULT_CONSTANTS.sedeRadius);
    expect(b.hp).toBe(DEFAULT_CONSTANTS.maxHp);
  });

  it('arma comprada fica depois do nocaute', () => {
    const { s, data } = duel({ sedes, b: { weapon: 'taco' } });
    fighter(s, 'b').hp = 1;
    const ev = run(s, data, 10, (t) => ({ a: inp(tap(LIGHT, 1, t), FACE_PLUS_Z), b: inp(0, FACE_MINUS_Z) }));
    expect(ofType(ev, 'ko')).toHaveLength(1);
    expect(ofType(ev, 'weaponDrop')).toHaveLength(0);
    expect(fighter(s, 'b').weapon).toBe('taco');
  });

  it('proteção de spawn: invulnerável por 3 s, cancelada ao atacar', () => {
    const { s, data } = duel();
    const b = fighter(s, 'b');
    b.protectedUntil = 1000;
    let ev = run(s, data, 12, (t) => ({ a: inp(tap(LIGHT, 1, t), FACE_PLUS_Z), b: inp(0, FACE_MINUS_Z) }));
    expect(ofType(ev, 'hit')).toHaveLength(0);
    ev = run(s, data, 60, (t) => ({ a: inp(tap(LIGHT, 40, t), FACE_PLUS_Z), b: inp(tap(LIGHT, 20, t), FACE_MINUS_Z) }));
    expect(b.protectedUntil).toBe(0);
    expect(ofType(ev, 'hit').some((h) => h.target === 'b')).toBe(true);
  });

  it('inimigo dentro da sede rival perde vida', () => {
    const { s, data } = duel({ sedes, a: { pos: { x: 20, z: 0 } }, b: { pos: { x: 0, z: 10 } } });
    run(s, data, 60);
    expect(fighter(s, 'a').hp).toBeCloseTo(DEFAULT_CONSTANTS.maxHp - 60 * DEFAULT_CONSTANTS.sedeEnemyDamagePerTick);
  });

  it('anti-gank: o terceiro atacante simultâneo causa menos dano', () => {
    const { s, data } = duel();
    const b = fighter(s, 'b');
    b.damagedBy = { x: 0, y: 0 };
    const ev = run(s, data, 10, (t) => ({ a: inp(tap(LIGHT, 1, t), FACE_PLUS_Z), b: inp(0, FACE_MINUS_Z) }));
    expect(ofType(ev, 'hit')[0]?.damage).toBeCloseTo(6 * (DEFAULT_CONSTANTS.gankMultipliers[2] ?? 1));
  });
});

describe('loja', () => {
  const sedes = [{ team: 0 as const, pos: { x: -20, z: 0 } }];

  it('loja cobra o preço e funciona em qualquer lugar (até na sede do rival)', () => {
    const { s, data } = duel({ sedes, b: { pos: { x: -20, z: 0 } } });
    const b = fighter(s, 'b');
    expect(ECONOMY.startMoney).toBe(1000);
    expect(buy(s, b, 'barra', data).ok).toBe(true);
    expect(b.weapon).toBe('barra');
    expect(b.money).toBe(ECONOMY.startMoney - (data.weapons.barra?.preco ?? 0));
  });

  it('sem dinheiro ou sem nível, a compra é recusada e nada muda', () => {
    const { s, data } = duel();
    const b = fighter(s, 'b');
    b.level = 99;
    b.money = 100;
    expect(buy(s, b, 'barra', data)).toEqual({ ok: false, reason: 'saldo_insuficiente' });
    expect(b.money).toBe(100);
    expect(b.weapon).toBe('punhos');
    b.level = 1;
    b.money = 9000;
    expect(buy(s, b, 'pistola', data)).toEqual({ ok: false, reason: 'nivel' });
    b.level = data.weapons.pistola?.nivelMin ?? 1;
    expect(buy(s, b, 'pistola', data).ok).toBe(true);
    expect(b.durability).toBe(data.weapons.pistola?.municao);
  });
  it('colete segura metade do dano até gastar', () => {
    const { s, data } = duel();
    const b = fighter(s, 'b');
    expect(buy(s, b, 'colete', data).ok).toBe(true);
    expect(canBuy(s, b, 'colete', data)).toEqual({ ok: false, reason: 'limite' });
    run(s, data, 12, (t) => ({ a: inp(tap(LIGHT, 1, t), FACE_PLUS_Z), b: inp(0, FACE_MINUS_Z) }));
    const lost = DEFAULT_CONSTANTS.maxHp - b.hp;
    expect(lost).toBeGreaterThan(0);
    expect(DEFAULT_CONSTANTS.colete.hp - b.colete).toBeCloseTo(lost, 5);
  });

  it('tiro para na parede e acerta só o primeiro da fila', () => {
    const wall = { x: 0, z: 6, hw: 3, hd: 0.3, h: 2.5, kind: 'muro' as const, color: '#000' };
    const shoot = (t: number) => ({ a: inp(t === 1 ? LIGHT : 0, FACE_PLUS_Z), b: inp(0, FACE_MINUS_Z), c: inp(0, FACE_MINUS_Z) });
    // Com a parede no meio: ninguém toma o tiro.
    const blocked = duel({ a: { weapon: 'pistola' }, b: { pos: { x: 0, z: 12 } }, collision: { boxes: [wall], circles: [], halfW: 50, halfD: 50 } });
    expect(ofType(run(blocked.s, blocked.data, 20, shoot), 'hit')).toHaveLength(0);
    // Sem parede, dois na linha: só o da frente.
    const open = duel({ a: { weapon: 'pistola' }, b: { pos: { x: 0, z: 6 } } });
    open.s.fighters.push({ ...structuredClone(fighter(open.s, 'b')), id: 'c', pos: { x: 0, z: 12 } });
    const hits = ofType(run(open.s, open.data, 20, shoot), 'hit');
    expect(hits.map((h) => h.target)).toEqual(['b']);
  });

  it('dano do tiro cai com a distância', () => {
    const def = DEFAULT_COMBAT_DATA.weapons.pistola!.moves.light[0]!;
    expect(shotFalloff(def, 3)).toBe(1);
    expect(shotFalloff(def, 20)).toBeCloseTo(def.shot!.minScale, 5);
    expect(shotFalloff(def, 14)).toBeLessThan(1);
  });

  it('acabou a munição, a pistola sai da mão', () => {
    const { s, data } = duel({ a: { weapon: 'pistola' }, b: { pos: { x: 0, z: 12 } } });
    const a = fighter(s, 'a');
    const ammo = data.weapons.pistola?.municao ?? 0;
    const cd = data.weapons.pistola?.cooldown ?? 0;
    const ev = run(s, data, ammo * cd + 5, (t) => ({ a: inp(t % cd === 1 ? LIGHT : 0, FACE_PLUS_Z), b: inp(0, FACE_MINUS_Z) }));
    expect(ofType(ev, 'weaponBreak')).toHaveLength(1);
    expect(a.weapon).toBe('punhos');
  });

  it('pistola acerta de longe e só atira de novo depois do intervalo', () => {
    const { s, data } = duel({ a: { weapon: 'pistola' }, b: { pos: { x: 0, z: 12 } } });
    const b = fighter(s, 'b');
    const shoot = (t: number) => ({ a: inp(t % 20 === 1 ? LIGHT : 0, FACE_PLUS_Z), b: inp(0, FACE_MINUS_Z) });
    const cd = data.weapons.pistola?.cooldown ?? 0;
    // Clicando a cada 20 ticks: só um tiro por intervalo.
    const ev = run(s, data, cd - 10, shoot);
    expect(ofType(ev, 'hit')).toHaveLength(1);
    expect(b.hp).toBeLessThan(DEFAULT_CONSTANTS.maxHp);
    const ev2 = run(s, data, cd, shoot);
    expect(ofType(ev2, 'hit')).toHaveLength(1);
  });

  it('nocauteado compra de qualquer lugar e renasce com a arma; caído não compra', () => {
    const { s, data } = duel({ sedes });
    const a = fighter(s, 'a');
    a.state = 'downed';
    expect(canBuy(s, a, 'soqueira', data)).toEqual({ ok: false, reason: 'morto' });
    a.state = 'dead';
    a.money = 500;
    expect(buy(s, a, 'soqueira', data).ok).toBe(true);
    expect(a.weapon).toBe('soqueira');
  });


  it('punhos e caco não são vendidos', () => {
    const { s, data } = duel({ sedes, a: { pos: { x: -20, z: 0 } } });
    expect(canBuy(s, fighter(s, 'a'), 'caco', data)).toEqual({ ok: false, reason: 'item_inexistente' });
  });
});

describe('correr e pular', () => {
  it('correr é mais rápido que andar e gasta estamina', () => {
    const dist = (buttons: number) => {
      const { s, data } = duel({ b: { pos: { x: 30, z: 30 } } });
      run(s, data, 60, () => ({ a: inp(buttons, FACE_PLUS_Z, 0, 1) }));
      return { z: fighter(s, 'a').pos.z, st: fighter(s, 'a').stamina };
    };
    const walk = dist(0);
    const sprint = dist(RUN);
    // O input do tick N move a partir do tick N+1: 59 ticks de deslocamento em 60.
    expect(walk.z).toBeCloseTo((DEFAULT_CONSTANTS.walkSpeed * 59) / 60, 5);
    expect(sprint.z).toBeCloseTo((DEFAULT_CONSTANTS.runSpeed * 59) / 60, 5);
    expect(walk.st).toBe(DEFAULT_CONSTANTS.maxStamina);
    expect(sprint.st).toBeCloseTo(DEFAULT_CONSTANTS.maxStamina - 60 * DEFAULT_CONSTANTS.runStaminaPerTick, 5);
  });

  it('sem estamina não corre', () => {
    const { s, data } = duel({ b: { pos: { x: 30, z: 30 } } });
    const a = fighter(s, 'a');
    a.stamina = 0;
    a.lastStaminaSpendTick = 0;
    // Antes de o fôlego voltar a encher, anda em vez de correr.
    const ticks = DEFAULT_CONSTANTS.staminaRegenDelay;
    run(s, data, ticks, () => ({ a: inp(RUN, FACE_PLUS_Z, 0, 1) }));
    expect(a.pos.z).toBeCloseTo((DEFAULT_CONSTANTS.walkSpeed * (ticks - 1)) / 60, 5);
  });

  it('pulo sobe, desce e aterrissa', () => {
    const { s, data } = duel({ b: { pos: { x: 30, z: 30 } } });
    const a = fighter(s, 'a');
    run(s, data, 1, (t) => ({ a: inp(tap(JUMP, 1, t), FACE_PLUS_Z) }));
    expect(a.stamina).toBe(DEFAULT_CONSTANTS.maxStamina - DEFAULT_CONSTANTS.jumpStaminaCost);
    run(s, data, 15);
    expect(a.y).toBeGreaterThan(0.5);
    run(s, data, 30);
    expect(a.y).toBe(0);
  });

  it('pular por cima do chute: golpe baixo não pega no ar', () => {
    const { s, data } = duel();
    const ev = run(s, data, 40, (t) => ({ a: inp(tap(KICK, 1, t), FACE_PLUS_Z), b: inp(tap(JUMP, 2, t), FACE_MINUS_Z) }));
    expect(ofType(ev, 'hit')).toHaveLength(0);
  });

  it('não esquiva nem bloqueia no ar', () => {
    const { s, data } = duel({ b: { pos: { x: 30, z: 30 } } });
    const a = fighter(s, 'a');
    run(s, data, 5, (t) => ({ a: inp(tap(JUMP, 1, t) | (t === 4 ? DODGE : 0) | (t >= 3 ? BLOCK : 0), FACE_PLUS_Z) }));
    expect(a.state).toBe('idle');
    expect(a.y).toBeGreaterThan(0);
  });
});

describe('mochila de armas', () => {
  const sedes = [{ team: 0 as const, pos: { x: -20, z: 0 } }];

  it('comprar guarda a arma da mão; a roda gira entre elas', () => {
    const { s, data } = duel({ sedes, a: { pos: { x: -20, z: 0 } } });
    const a = fighter(s, 'a');
    a.money = 2000;
    expect(buy(s, a, 'soqueira', data).ok).toBe(true);
    expect(buy(s, a, 'faca', data).ok).toBe(true);
    expect(a.weapon).toBe('faca');
    expect(a.bag.map((w) => w.id)).toEqual(['punhos', 'soqueira']);
    expect(buy(s, a, 'soqueira', data)).toEqual({ ok: false, reason: 'ja_possui' });
    run(s, data, 2, (t) => ({ a: inp(tap(Buttons.WEAPON_NEXT, 1, t)) }));
    expect(a.weapon).toBe('punhos');
    run(s, data, 2, (t) => ({ a: inp(tap(Buttons.WEAPON_PREV, s.tick + 1, t)) }));
    expect(a.weapon).toBe('faca');
  });

  it('arma que quebra em punhos não duplica os punhos da mochila', () => {
    const { s, data } = duel({ a: { weapon: 'faca' } });
    const a = fighter(s, 'a');
    a.durability = 1;
    run(s, data, 12, (t) => ({ a: inp(tap(Buttons.LIGHT, 1, t), FACE_PLUS_Z), b: inp(0, FACE_MINUS_Z) }));
    expect(a.weapon).not.toBe('faca');
    expect(a.bag.filter((w) => w.id === a.weapon)).toEqual([]);
  });
});
