import { nextRandom } from './rng';

// Visual do personagem: só cosmético (não muda hitbox nem combate). Catálogo fixo de opções;
// a API valida, o ticket leva para o game server e o roster entrega para os clientes.

const CORES_CABELO = [
  { id: 'preto', nome: 'Preto', cor: '#1b1b1b' },
  { id: 'castanhoEscuro', nome: 'Castanho escuro', cor: '#3b2a20' },
  { id: 'castanho', nome: 'Castanho', cor: '#4a3426' },
  { id: 'castanhoClaro', nome: 'Castanho claro', cor: '#8b6a43' },
  { id: 'loiro', nome: 'Loiro', cor: '#c8a15a' },
  { id: 'platinado', nome: 'Loiro platinado', cor: '#e6cf8f' },
  { id: 'ruivo', nome: 'Ruivo', cor: '#8a3b1d' },
  { id: 'grisalho', nome: 'Grisalho', cor: '#9a9a9a' },
  { id: 'branco', nome: 'Branco', cor: '#e8e8e8' },
  { id: 'azul', nome: 'Azul', cor: '#2d5bd8' },
  { id: 'rosa', nome: 'Rosa', cor: '#e8559a' },
  { id: 'verde', nome: 'Verde', cor: '#2fa36b' },
] as const;

export const VISUAL_OPTIONS = {
  pele: [
    { id: 'p0', nome: 'Porcelana', cor: '#fbe3cf' },
    { id: 'p1', nome: 'Muito clara', cor: '#f6d2b0' },
    { id: 'p2', nome: 'Clara', cor: '#f1c27d' },
    { id: 'p7', nome: 'Bege', cor: '#e5b48a' },
    { id: 'p3', nome: 'Média', cor: '#d9a066' },
    { id: 'p4', nome: 'Morena', cor: '#c68642' },
    { id: 'p8', nome: 'Morena escura', cor: '#a8683a' },
    { id: 'p5', nome: 'Escura', cor: '#8d5524' },
    { id: 'p6', nome: 'Muito escura', cor: '#5e3a1f' },
    { id: 'p9', nome: 'Retinta', cor: '#4a2c17' },
  ],
  cabelo: [
    { id: 'careca', nome: 'Careca' },
    { id: 'raspado', nome: 'Raspado' },
    { id: 'militar', nome: 'Militar' },
    { id: 'curto', nome: 'Curto' },
    { id: 'topete', nome: 'Topete' },
    { id: 'moicano', nome: 'Moicano' },
    { id: 'black', nome: 'Black power' },
    { id: 'cacheado', nome: 'Cacheado' },
    { id: 'coque', nome: 'Coque' },
    { id: 'rabo', nome: 'Rabo de cavalo' },
    { id: 'trancas', nome: 'Tranças' },
    { id: 'dreads', nome: 'Dreads' },
    { id: 'longo', nome: 'Longo' },
    { id: 'mullet', nome: 'Mullet' },
    { id: 'calvo', nome: 'Calvo' },
  ],
  corCabelo: CORES_CABELO,
  barba: [
    { id: 'nenhuma', nome: 'Sem barba' },
    { id: 'rala', nome: 'Por fazer' },
    { id: 'bigode', nome: 'Bigode' },
    { id: 'bigodao', nome: 'Bigodão' },
    { id: 'cavanhaque', nome: 'Cavanhaque' },
    { id: 'contorno', nome: 'Contorno' },
    { id: 'costeleta', nome: 'Costeletas' },
    { id: 'curta', nome: 'Barba curta' },
    { id: 'cheia', nome: 'Barba cheia' },
    { id: 'lenhador', nome: 'Lenhador' },
  ],
  corBarba: [{ id: 'igual', nome: 'Igual ao cabelo' }, ...CORES_CABELO],
  camisa: [
    { id: 'lisa', nome: 'Lisa' },
    { id: 'listrada', nome: 'Listrada' },
    { id: 'regata', nome: 'Regata' },
  ],
  acessorio: [
    { id: 'nenhum', nome: 'Nenhum' },
    { id: 'bone', nome: 'Boné' },
    { id: 'bandana', nome: 'Bandana' },
    { id: 'touca', nome: 'Touca' },
    { id: 'oculos', nome: 'Óculos escuros' },
    { id: 'corrente', nome: 'Corrente' },
  ],
} as const;

/** Medidas contínuas (sliders), inteiras: altura em cm; peso e músculos de 0 a 100. */
export const VISUAL_RANGES = {
  altura: { min: 110, max: 200 },
  peso: { min: 0, max: 100 },
  musculo: { min: 0, max: 100 },
} as const;

export type VisualKey = keyof typeof VISUAL_OPTIONS;
export type VisualRangeKey = keyof typeof VISUAL_RANGES;
export type CharacterVisual = { [K in VisualKey]: (typeof VISUAL_OPTIONS)[K][number]['id'] } & { [K in VisualRangeKey]: number };

export const VISUAL_KEYS = Object.keys(VISUAL_OPTIONS) as VisualKey[];
export const VISUAL_RANGE_KEYS = Object.keys(VISUAL_RANGES) as VisualRangeKey[];

export const DEFAULT_VISUAL: CharacterVisual = {
  pele: 'p3',
  cabelo: 'curto',
  corCabelo: 'preto',
  barba: 'nenhuma',
  corBarba: 'igual',
  camisa: 'lisa',
  acessorio: 'nenhum',
  altura: 175,
  peso: 40,
  musculo: 35,
};

// Perfis salvos antes dos sliders: corpo e altura eram opções.
const LEGACY_ALTURA: Record<string, number> = { baixo: 154, medio: 175, alto: 198 };
const LEGACY_CORPO: Record<string, { peso: number; musculo: number }> = {
  magro: { peso: 10, musculo: 15 },
  normal: { peso: 40, musculo: 35 },
  forte: { peso: 55, musculo: 85 },
};

function isOption(key: VisualKey, id: unknown): boolean {
  return typeof id === 'string' && VISUAL_OPTIONS[key].some((o) => o.id === id);
}

/** Visual vindo de fora (API, ticket): só chaves e valores conhecidos. Faltando chave, usa o padrão. */
export function validateVisual(v: unknown): CharacterVisual | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const out: Record<string, string | number> = { ...DEFAULT_VISUAL };
  for (const [k, val] of Object.entries(v)) {
    if (k === 'altura' && typeof val === 'string' && val in LEGACY_ALTURA) out.altura = LEGACY_ALTURA[val]!;
    else if (k === 'corpo' && typeof val === 'string' && val in LEGACY_CORPO) Object.assign(out, LEGACY_CORPO[val]);
    else if (k in VISUAL_RANGES) {
      const r = VISUAL_RANGES[k as VisualRangeKey];
      if (typeof val !== 'number' || !Number.isInteger(val) || val < r.min || val > r.max) return null;
      out[k] = val;
    } else if (k in VISUAL_OPTIONS && isOption(k as VisualKey, val)) out[k] = val as string;
    else return null;
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
  const out: Record<string, string | number> = {};
  for (const k of VISUAL_KEYS) {
    const opts = VISUAL_OPTIONS[k];
    out[k] = opts[Math.floor(nextRandom(rng) * opts.length)]!.id;
  }
  // Altura: quase todo mundo entre 1,55 e 1,98 m; de vez em quando um baixinho.
  const r = nextRandom(rng);
  out.altura = Math.round(r < 0.08 ? 110 + (r / 0.08) * 40 : 155 + nextRandom(rng) * 43);
  out.peso = Math.round(nextRandom(rng) * 100);
  out.musculo = Math.round(nextRandom(rng) * 100);
  // Acessório, barba e barba de outra cor são mais raros nos bots.
  if (nextRandom(rng) < 0.5) out.acessorio = 'nenhum';
  if (nextRandom(rng) < 0.4) out.barba = 'nenhuma';
  if (nextRandom(rng) < 0.8) out.corBarba = 'igual';
  return out as CharacterVisual;
}

/** Cor (hex) de uma opção com cor (pele, cabelo). */
export function visualColor(key: 'pele' | 'corCabelo', id: string): string {
  const opt = VISUAL_OPTIONS[key].find((o) => o.id === id) ?? VISUAL_OPTIONS[key][0];
  return opt.cor;
}

/** Cor da barba: a própria ou a do cabelo. */
export function beardColor(v: CharacterVisual): string {
  return visualColor('corCabelo', v.corBarba === 'igual' ? v.corCabelo : v.corBarba);
}
