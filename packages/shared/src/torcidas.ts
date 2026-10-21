// Torcidas do jogo. O engine trata cada torcida como dado: nome, cidade, cores, sede e rivais.

export interface Torcida {
  id: string;
  nome: string;
  cidade: string;
  uf: string;
  /** Cores em hex: [camisa, calção/detalhe] */
  cores: readonly [string, string];
  /** Nome da sede (cada time nasce na sua, em lados opostos do estacionamento). */
  sede: string;
  rivais: readonly string[];
  /** Lado fixo no mapa: 0 = oeste, 1 = leste. */
  team: 0 | 1;
}

export const TORCIDAS = [
  { id: 'cearalove', nome: 'Cearalove', cidade: 'Fortaleza', uf: 'CE', cores: ['#111111', '#f5f5f5'], sede: 'Barraca da Cearalove', rivais: ['lions-do-pici'], team: 0 },
  { id: 'lions-do-pici', nome: 'Lions do Pici', cidade: 'Fortaleza', uf: 'CE', cores: ['#0033a0', '#e30613'], sede: 'Ônibus dos Lions', rivais: ['cearalove'], team: 1 },
] as const satisfies readonly Torcida[];

export type TorcidaId = (typeof TORCIDAS)[number]['id'];

const BY_ID = new Map<string, Torcida>(TORCIDAS.map((t) => [t.id, t]));

export function getTorcida(id: string): Torcida | undefined {
  return BY_ID.get(id);
}

export function torcidaOfTeam(team: 0 | 1): Torcida {
  return TORCIDAS[team];
}

export function isClassico(a: string, b: string): boolean {
  return BY_ID.get(a)?.rivais.includes(b) ?? false;
}
