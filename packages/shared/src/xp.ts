// XP e nível. A conta mora aqui para o servidor gravar e o cliente mostrar o mesmo número.

export const XP = { match: 50, win: 100, ko: 20, assist: 10, capture: 30, mvp: 50 } as const;

export interface XpInput {
  kos: number;
  assists: number;
  captures: number;
  won: boolean;
  mvp: boolean;
}

/** XP ganho numa partida. */
export function matchXp(p: XpInput): number {
  return XP.match + (p.won ? XP.win : 0) + p.kos * XP.ko + p.assists * XP.assist + p.captures * XP.capture + (p.mvp ? XP.mvp : 0);
}

/** XP para ir do nível `level` ao próximo: 100, 200, 300... */
export function xpToNext(level: number): number {
  return 100 * level;
}

/** Nível (começa em 1), XP já feito dentro dele e quanto falta no total do nível. */
export function levelFromXp(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let rest = Math.max(0, Math.floor(xp));
  while (rest >= xpToNext(level)) rest -= xpToNext(level++);
  return { level, into: rest, need: xpToNext(level) };
}
