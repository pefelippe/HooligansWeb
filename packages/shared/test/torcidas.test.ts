import { describe, expect, it } from 'vitest';
import { getTorcida, isClassico, torcidaOfTeam, TORCIDAS } from '../src';

describe('torcidas', () => {
  it('são duas, uma por lado do mapa', () => {
    expect(TORCIDAS.map((t) => t.id)).toEqual(['cearalove', 'lions-do-pici']);
    expect(torcidaOfTeam(0).id).toBe('cearalove');
    expect(torcidaOfTeam(1).id).toBe('lions-do-pici');
  });

  it('rivalidade é simétrica', () => {
    for (const t of TORCIDAS) {
      for (const r of t.rivais) {
        expect(getTorcida(r)).toBeDefined();
        expect(isClassico(r, t.id)).toBe(true);
      }
    }
  });

  it('cores são hex válidos', () => {
    for (const t of TORCIDAS) for (const c of t.cores) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
