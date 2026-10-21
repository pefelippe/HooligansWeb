// Regra do nick, usada pela API (autoridade) e pelo web (validação enquanto digita).

export const NICK_MIN = 3;
export const NICK_MAX = 16;
export const NICK_RE = /^[\p{L}\p{N}_.-]{3,16}$/u;

export type NickError = 'nick_curto' | 'nick_longo' | 'nick_caracteres';

export function validateNick(nick: string): NickError | null {
  if ([...nick].length < NICK_MIN) return 'nick_curto';
  if ([...nick].length > NICK_MAX) return 'nick_longo';
  if (!NICK_RE.test(nick)) return 'nick_caracteres';
  return null;
}

/** Tira o que o nick não aceita ("Pedro Silva" -> "PedroSilva"); vazio se sobrar pouco. */
export function sanitizeNick(raw: string): string {
  const nick = [...raw.replace(/[^\p{L}\p{N}_.-]/gu, '')].slice(0, NICK_MAX).join('');
  return [...nick].length >= NICK_MIN ? nick : '';
}

/** Variações de um nick ocupado, todas válidas: base cortada + número. */
export function nickVariants(base: string, seed: number): string[] {
  const clean = sanitizeNick(base) || 'torcedor';
  const out: string[] = [];
  for (let i = 0; i < 8; i++) {
    const n = String(((seed + i * 7919) % 900) + 10 * (i + 1));
    out.push([...clean].slice(0, NICK_MAX - n.length).join('') + n);
  }
  return [...new Set(out)];
}
