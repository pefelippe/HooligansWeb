import { type Fighter, isAlive, isStanding } from './fsm';
import type { SimState } from './sim';
import type { CombatData } from './types';
import { DEFAULT_COMBAT_DATA } from './weapons';

// Loja da partida (tecla J): de graça e em qualquer lugar (menos caído no chão).

/** Tudo de graça por enquanto. false volta aos preços de cada item. */
export const FREE_SHOP = true;

export const CURATIVO = {
  id: 'curativo',
  nome: 'Curativo',
  // TODO(plano): preço não chegou no texto colado do plano. Provisório. Cura e canalização: constants.curativo.
  preco: 150,
  maxPorJogador: 3,
} as const;

/** Bandagens vêm em pacote. Cura e recarga: constants.bandagem. */
export const BANDAGEM = { id: 'bandagem', nome: 'Bandagens ×5', preco: 100, pacote: 5, max: 15 } as const;

/** Arremessáveis de controle de grupo (não matam, derrubam). Efeito: constants.throwables. */
export const BOMBA = { id: 'bomba', nome: 'Bomba caseira', preco: 250, max: 2 } as const;
export const GAS = { id: 'gas', nome: 'Gás lacrimogêneo', preco: 300, max: 2 } as const;
/** Colete: compra enche os pontos dele (constants.colete). */
export const COLETE = { id: 'colete', nome: 'Colete', preco: 400 } as const;

export interface ShopItem {
  id: string;
  nome: string;
  preco: number;
  tipo: 'arma' | 'item';
}

export function shopItems(data: CombatData = DEFAULT_COMBAT_DATA): ShopItem[] {
  const armas = Object.values(data.weapons)
    .filter((w): w is typeof w & { preco: number } => w.preco !== null)
    .map((w) => ({ id: w.id, nome: w.nome, preco: FREE_SHOP ? 0 : w.preco, tipo: 'arma' as const }));
  const itens: ShopItem[] = [CURATIVO, BANDAGEM, BOMBA, GAS, COLETE].map((i) => ({ id: i.id, nome: i.nome, preco: FREE_SHOP ? 0 : i.preco, tipo: 'item' }));
  return [...armas, ...itens];
}

export type BuyResult =
  | { ok: true; item: ShopItem }
  | { ok: false; reason: 'item_inexistente' | 'morto' | 'saldo_insuficiente' | 'ja_possui' | 'limite' };

export function canBuy(s: SimState, f: Fighter, itemId: string, data: CombatData = DEFAULT_COMBAT_DATA): BuyResult {
  const item = shopItems(data).find((i) => i.id === itemId);
  if (!item) return { ok: false, reason: 'item_inexistente' };
  // Caído no chão não compra (ainda dá para ser levantado ou finalizado). Nocauteado compra para renascer com.
  if (isAlive(f) && !isStanding(f)) return { ok: false, reason: 'morto' };
  if (f.money < item.preco) return { ok: false, reason: 'saldo_insuficiente' };
  if (item.tipo === 'arma' && (f.weapon === item.id || f.bag.some((w) => w.id === item.id))) return { ok: false, reason: 'ja_possui' };
  if (item.id === CURATIVO.id && f.curativos >= CURATIVO.maxPorJogador) return { ok: false, reason: 'limite' };
  if (item.id === BANDAGEM.id && f.bandagens >= BANDAGEM.max) return { ok: false, reason: 'limite' };
  if (item.id === BOMBA.id && f.bombas >= BOMBA.max) return { ok: false, reason: 'limite' };
  if (item.id === GAS.id && f.gases >= GAS.max) return { ok: false, reason: 'limite' };
  if (item.id === COLETE.id && f.colete >= data.constants.colete.hp) return { ok: false, reason: 'limite' };
  return { ok: true, item };
}

/** Valida e aplica a compra. A arma da mão vai para a mochila; a comprada fica até quebrar. */
export function buy(s: SimState, f: Fighter, itemId: string, data: CombatData = DEFAULT_COMBAT_DATA): BuyResult {
  const r = canBuy(s, f, itemId, data);
  if (!r.ok) return r;
  f.money -= r.item.preco;
  if (r.item.tipo === 'arma') {
    // A arma da mão vai para a mochila (roda do mouse troca).
    f.bag.push({ id: f.weapon, durability: f.durability });
    f.weapon = r.item.id;
    f.inHand = null;
    f.durability = data.weapons[r.item.id]?.durabilidade ?? null;
  } else if (r.item.id === BANDAGEM.id) {
    f.bandagens = Math.min(BANDAGEM.max, f.bandagens + BANDAGEM.pacote);
  } else if (r.item.id === BOMBA.id) {
    f.bombas++;
  } else if (r.item.id === GAS.id) {
    f.gases++;
  } else if (r.item.id === COLETE.id) {
    f.colete = data.constants.colete.hp;
  } else {
    f.curativos++;
  }
  return r;
}
