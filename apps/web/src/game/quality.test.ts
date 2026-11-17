import { describe, expect, it } from 'vitest';
import { QUALITY_LEVELS, stepQuality } from './quality';

const run = (fps: number, seconds: number, start = { level: 0, lowFor: 0 }) => {
  let s = start;
  for (let t = 0; t < seconds; t += 0.1) s = stepQuality(s, fps, 0.1);
  return s;
};

describe('stepQuality', () => {
  it('mantém o nível com FPS bom', () => {
    expect(run(60, 10).level).toBe(0);
  });

  it('desce um nível após 3 s abaixo de 50 fps', () => {
    expect(run(40, 2.5).level).toBe(0);
    expect(run(40, 3.2).level).toBe(1);
  });

  it('um frame bom zera a contagem', () => {
    let s = run(40, 2.5);
    s = stepQuality(s, 60, 0.1);
    expect(run(40, 2.5, s).level).toBe(0);
  });

  it('nunca passa do último nível nem sobe de volta', () => {
    const low = run(20, 30);
    expect(low.level).toBe(QUALITY_LEVELS.length - 1);
    expect(run(144, 30, low).level).toBe(QUALITY_LEVELS.length - 1);
  });
});
