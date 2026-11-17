// Qualidade automática: se o FPS ficar baixo por um tempo, desce um nível. Só desce, nunca volta
// (ligar/desligar sombra recompila os shaders; ficar alternando seria pior que o FPS baixo).
// shortcut: não sobe de volta; se jogadores reclamarem de qualidade presa, adicionar subida com histerese longa.

export const QUALITY_LEVELS = [
  { pixelRatio: 1.5, shadows: true },
  { pixelRatio: 1, shadows: true },
  { pixelRatio: 1, shadows: false },
] as const;

export const LOW_FPS = 50;
/** Segundos seguidos abaixo de LOW_FPS antes de descer um nível. */
export const LOW_FOR_S = 3;

export interface QualityState {
  level: number;
  lowFor: number;
}

export function stepQuality(s: QualityState, fps: number, dt: number): QualityState {
  if (fps >= LOW_FPS) return { level: s.level, lowFor: 0 };
  const lowFor = s.lowFor + dt;
  if (lowFor < LOW_FOR_S || s.level >= QUALITY_LEVELS.length - 1) return { level: s.level, lowFor };
  return { level: s.level + 1, lowFor: 0 };
}
