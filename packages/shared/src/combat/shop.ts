import { type Fighter, isStanding } from './fsm';
import { inSede, type SimState } from './sim';
import type { CombatData } from './types';
import { DEFAULT_COMBAT_DATA } from './weapons';

// Loja da partida (tecla J). Só funciona dentro da própria sede, com saldo.

export const CURATIVO = {
  id: 'curativo',
  nome: 'Curativo',
  // TODO(plano): preço não chegou no texto colado do plano. Provisório. Cura e canalização: constants.curativo.
  preco: 150,
  maxPorJogador: 3,
} as const;

export interface ShopItem {
  id: string;
  nome: string;
  preco: number;
  tipo: 'arma' | 'item';
}

export function shopItems(data: CombatData = DEFAULT_COMBAT_DATA): ShopItem[] {
  const armas = Object.values(data.weapons)
    .filter((w): w is typeof w & { preco: number } => w.preco !== null)
    .map((w) => ({ id: w.id, nome: w.nome, preco: w.preco, tipo: 'arma' as const }));
  return [...armas, { id: CURATIVO.id, nome: CURATIVO.nome, preco: CURATIVO.preco, tipo: 'item' }];
}

export type BuyResult =
  | { ok: true; item: ShopItem }
  | { ok: false; reason: 'item_inexistente' | 'morto' | 'fora_da_sede' | 'saldo_insuficiente' | 'ja_possui' | 'limite' };

export function canBuy(s: SimState, f: Fighter, itemId: string, data: CombatData = DEFAULT_COMBAT_DATA): BuyResult {
  const item = shopItems(data).find((i) => i.id === itemId);
  if (!item) return { ok: false, reason: 'item_inexistente' };
  if (!isStanding(f)) return { ok: false, reason: 'morto' };
  if (inSede(s, f, data)?.team !== f.team) return { ok: false, reason: 'fora_da_sede' };
  if (f.money < item.preco) return { ok: false, reason: 'saldo_insuficiente' };
  if (item.tipo === 'arma' && f.weapon === item.id) return { ok: false, reason: 'ja_possui' };
  if (item.id === CURATIVO.id && f.curativos >= CURATIVO.maxPorJogador) return { ok: false, reason: 'limite' };
  return { ok: true, item };
}

/** Valida e aplica a compra. A arma atual é descartada (sem reembolso). */
export function buy(s: SimState, f: Fighter, itemId: string, data: CombatData = DEFAULT_COMBAT_DATA): BuyResult {
  const r = canBuy(s, f, itemId, data);
  if (!r.ok) return r;
  f.money -= r.item.preco;
  if (r.item.tipo === 'arma') {
    f.weapon = r.item.id;
    f.durability = data.weapons[r.item.id]?.durabilidade ?? null;
  } else {
    f.curativos++;
  }
  return r;
}
