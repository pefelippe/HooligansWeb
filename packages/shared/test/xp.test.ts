import { describe, expect, it } from 'vitest';
import { levelFromXp, matchXp } from '../src/xp';

describe('xp', () => {
  it('soma participação, vitória, nocautes, assistências, capturas e MVP', () => {
    expect(matchXp({ kos: 0, assists: 0, captures: 0, won: false, mvp: false })).toBe(50);
    expect(matchXp({ kos: 3, assists: 2, captures: 1, won: true, mvp: true })).toBe(50 + 100 + 60 + 20 + 30 + 50);
  });

  it('nível sobe a cada 100, 200, 300... de XP', () => {
    expect(levelFromXp(0)).toEqual({ level: 1, into: 0, need: 100 });
    expect(levelFromXp(99)).toEqual({ level: 1, into: 99, need: 100 });
    expect(levelFromXp(100)).toEqual({ level: 2, into: 0, need: 200 });
    expect(levelFromXp(350)).toEqual({ level: 3, into: 50, need: 300 });
  });
});
