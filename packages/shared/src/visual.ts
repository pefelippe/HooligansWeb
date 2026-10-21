import { nextRandom } from './rng';

// Visual do personagem: só cosmético (não muda hitbox nem combate). Catálogo fixo de opções;
// a API valida, o ticket leva para o game server e o roster entrega para os clientes.

export const VISUAL_OPTIONS = {
  pele: [
    { id: 'p1', nome: 'Muito clara', cor: '#f6d2b0' },
    { id: 'p2', nome: 'Clara', cor: '#f1c27d' },
    { id: 'p3', nome: 'Média', cor: '#d9a066' },
    { id: 'p4', nome: 'Morena', cor: '#c68642' },
    { id: 'p5', nome: 'Escura', cor: '#8d5524' },
    { id: 'p6', nome: 'Muito escura', cor: '#5e3a1f' },
  ],
  cabelo: [
    { id: 'careca', nome: 'Careca' },
    { id: 'raspado', nome: 'Raspado' },
    { id: 'curto', nome: 'Curto' },
    { id: 'black', nome: 'Black power' },
    { id: 'moicano', nome: 'Moicano' },
    { id: 'rabo', nome: 'Rabo de cavalo' },
  ],
  corCabelo: [
    { id: 'preto', nome: 'Preto', cor: '#1b1b1b' },
    { id: 'castanho', nome: 'Castanho', cor: '#4a3426' },
    { id: 'loiro', nome: 'Loiro', cor: '#c8a15a' },
    { id: 'ruivo', nome: 'Ruivo', cor: '#8a3b1d' },
    { id: 'grisalho', nome: 'Grisalho', cor: '#9a9a9a' },
    { id: 'azul', nome: 'Pintado', cor: '#2d5bd8' },
  ],
  barba: [
    { id: 'nenhuma', nome: 'Sem barba' },
    { id: 'cavanhaque', nome: 'Cavanhaque' },
    { id: 'bigode', nome: 'Bigode' },
    { id: 'cheia', nome: 'Barba cheia' },
  ],
  corpo: [
    { id: 'magro', nome: 'Magro' },
    { id: 'normal', nome: 'Normal' },
    { id: 'forte', nome: 'Forte' },
  ],
  altura: [
    { id: 'baixo', nome: 'Baixo' },
    { id: 'medio', nome: 'Médio' },
    { id: 'alto', nome: 'Alto' },
  ],
  camisa: [
    { id: 'lisa', nome: 'Lisa' },
    { id: 'listrada', nome: 'Listrada' },
    { id: 'regata', nome: 'Regata' },
  ],
  acessorio: [
    { id: 'nenhum', nome: 'Nenhum' },
    { id: 'bone', nome: 'Boné' },
    { id: 'bandana', nome: 'Bandana' },
    { id: 'oculos', nome: 'Óculos escuros' },
    { id: 'corrente', nome: 'Corrente' },
  ],
} as const;

export type VisualKey = keyof typeof VISUAL_OPTIONS;
export type CharacterVisual = { [K in VisualKey]: (typeof VISUAL_OPTIONS)[K][number]['id'] };

export const VISUAL_KEYS = Object.keys(VISUAL_OPTIONS) as VisualKey[];

export const DEFAULT_VISUAL: CharacterVisual = {
  pele: 'p3',
  cabelo: 'curto',
  corCabelo: 'preto',
  barba: 'nenhuma',
  corpo: 'normal',
  altura: 'medio',
  camisa: 'lisa',
  acessorio: 'nenhum',
};

function isOption(key: VisualKey, id: unknown): boolean {
  return typeof id === 'string' && VISUAL_OPTIONS[key].some((o) => o.id === id);
}

/** Visual vindo de fora (API, ticket): só chaves e opções conhecidas. Faltando chave, usa o padrão. */
export function validateVisual(v: unknown): CharacterVisual | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const out: Record<string, string> = { ...DEFAULT_VISUAL };
  for (const [k, id] of Object.entries(v)) {
    if (!(k in VISUAL_OPTIONS) || !isOption(k as VisualKey, id)) return null;
    out[k] = id as string;
  }
  return out as CharacterVisual;
}

/** Seed do visual sorteado a partir do id (bots e perfis sem visual): cliente e editor chegam no mesmo. */
export function visualSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Visual aleatório e determinístico pelo seed (bots, botão "Aleatório"). */
export function randomVisual(seed: number): CharacterVisual {
  const rng = { seed: (seed | 0) || 1 };
  const out: Record<string, string> = {};
  for (const k of VISUAL_KEYS) {
    const opts = VISUAL_OPTIONS[k];
    out[k] = opts[Math.floor(nextRandom(rng) * opts.length)]!.id;
  }
  // Acessório e barba são mais raros nos bots.
  if (nextRandom(rng) < 0.5) out.acessorio = 'nenhum';
  if (nextRandom(rng) < 0.4) out.barba = 'nenhuma';
  return out as CharacterVisual;
}

/** Cor (hex) de uma opção com cor (pele, cabelo). */
export function visualColor(key: 'pele' | 'corCabelo', id: string): string {
  const opt = VISUAL_OPTIONS[key].find((o) => o.id === id) ?? VISUAL_OPTIONS[key][0];
  return opt.cor;
}
