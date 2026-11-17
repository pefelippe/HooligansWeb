import { DEFAULT_COMBAT_DATA, findMove, type MoveDef } from '@torcidas/shared';
import { describe, expect, it } from 'vitest';
import { attackClip, attackTime, pickAnim } from './fighterAnim';

const clip = { duration: 1, impact: 0.4 };
const jab = findMove(DEFAULT_COMBAT_DATA, 'punhos.l1') as MoveDef;
const base = { state: 'attack' as const, stateTick: 0, stateDuration: 0, y: 0, running: false, dodgeKind: 'step' as const };

describe('attackTime', () => {
  it('chega ao impacto no último tick de startup e termina no fim do recovery', () => {
    expect(attackTime(jab, jab.startup, clip)).toBeCloseTo(0.4);
    expect(attackTime(jab, 0, clip)).toBe(0);
    expect(attackTime(jab, jab.startup + jab.active + jab.recovery, clip)).toBeCloseTo(1);
  });
  it('nunca volta no tempo', () => {
    let last = -1;
    for (let t = 0; t <= jab.startup + jab.active + jab.recovery + 5; t++) {
      const v = attackTime(jab, t, clip);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
  });
});

describe('pickAnim', () => {
  it('usa o clipe do golpe e um mapeamento por arma', () => {
    expect(jab).toBeTruthy();
    expect(attackClip(jab)).toBe('Punch_Jab');
    expect(pickAnim({ ...base, stateTick: jab.startup }, jab, 0, () => clip)).toMatchObject({ clip: 'Punch_Jab', time: 0.4 });
  });
  it('escolhe a locomoção pela velocidade', () => {
    const idle = { ...base, state: 'idle' as const };
    expect(pickAnim(idle, undefined, 0, () => clip).clip).toBe('Idle_Loop');
    expect(pickAnim(idle, undefined, 1.4, () => clip).clip).toBe('Walk_Loop');
    expect(pickAnim({ ...idle, running: true }, undefined, 6.5, () => clip)).toMatchObject({ clip: 'Sprint_Loop', speed: 1 });
    expect(pickAnim({ ...idle, y: 0.5 }, undefined, 3, () => clip).clip).toBe('Jump_Loop');
  });
  it('knockdown cai, fica no chão e levanta sem pular quadro no getup', () => {
    const lay = { duration: 1.53, impact: 0.4 };
    const kd = { ...base, state: 'knockdown' as const, stateDuration: 45 };
    expect(pickAnim({ ...kd, stateTick: 10 }, undefined, 0, () => lay).clip).toBe('Hit_Knockback');
    const end = pickAnim({ ...kd, stateTick: 45 }, undefined, 0, () => lay);
    const start = pickAnim({ ...base, state: 'getup' as const, stateTick: 0, stateDuration: 20 }, undefined, 0, () => lay);
    expect(end.clip).toBe('LayToIdle');
    expect(start.clip).toBe('LayToIdle');
    expect(start.time).toBeCloseTo(end.time ?? -1);
    expect(pickAnim({ ...base, state: 'getup' as const, stateTick: 20, stateDuration: 20 }, undefined, 0, () => lay).time).toBeCloseTo(1.53);
  });
  it('todo golpe dos dados tem clipe', () => {
    const all = [...Object.values(DEFAULT_COMBAT_DATA.common), ...Object.values(DEFAULT_COMBAT_DATA.weapons).flatMap((w) => [...w.moves.light, w.moves.heavy, w.moves.special])];
    for (const m of all) expect(attackClip(m)).toMatch(/^[A-Z]/);
  });
});
