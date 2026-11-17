import { describe, expect, it } from 'vitest';
import { DEFAULT_VISUAL, randomVisual, validateVisual, VISUAL_KEYS, VISUAL_OPTIONS } from '../src';

describe('visual do personagem', () => {
  it('aceita um visual completo e completa o parcial com o padrão', () => {
    expect(validateVisual({ ...DEFAULT_VISUAL, cabelo: 'black' })).toEqual({ ...DEFAULT_VISUAL, cabelo: 'black' });
    expect(validateVisual({ acessorio: 'bone' })).toEqual({ ...DEFAULT_VISUAL, acessorio: 'bone' });
    expect(validateVisual({})).toEqual(DEFAULT_VISUAL);
  });

  it('recusa chave ou opção desconhecida e formatos inválidos', () => {
    expect(validateVisual({ cabelo: 'arco-iris' })).toBeNull();
    expect(validateVisual({ chapeu: 'bone' })).toBeNull();
    expect(validateVisual({ pele: 3 })).toBeNull();
    expect(validateVisual(null)).toBeNull();
    expect(validateVisual('p1')).toBeNull();
    expect(validateVisual([])).toBeNull();
  });

  it('altura, peso e músculos: inteiros dentro da faixa', () => {
    expect(validateVisual({ altura: 110, peso: 100, musculo: 0 })).toEqual({ ...DEFAULT_VISUAL, altura: 110, peso: 100, musculo: 0 });
    expect(validateVisual({ altura: 109 })).toBeNull();
    expect(validateVisual({ altura: 201 })).toBeNull();
    expect(validateVisual({ peso: 50.5 })).toBeNull();
    expect(validateVisual({ musculo: '50' })).toBeNull();
    expect(validateVisual({ peso: Number.NaN })).toBeNull();
  });

  it('converte perfis antigos (corpo e altura como opção)', () => {
    expect(validateVisual({ altura: 'alto', corpo: 'forte' })).toEqual({ ...DEFAULT_VISUAL, altura: 198, peso: 55, musculo: 85 });
    expect(validateVisual({ corpo: 'gigante' })).toBeNull();
  });

  it('aleatório é sempre válido e determinístico pelo seed', () => {
    for (let seed = 0; seed < 200; seed++) {
      const v = randomVisual(seed);
      expect(validateVisual(v)).toEqual(v);
      expect(randomVisual(seed)).toEqual(v);
    }
    // E varia: com 200 seeds aparecem várias opções de cada item.
    for (const k of VISUAL_KEYS) {
      const seen = new Set(Array.from({ length: 200 }, (_, i) => randomVisual(i)[k]));
      expect(seen.size).toBeGreaterThan(Math.min(2, VISUAL_OPTIONS[k].length - 1));
    }
  });
});
