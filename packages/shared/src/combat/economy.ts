// Economia da partida (estilo CS): dinheiro só vale dentro da partida.

export const ECONOMY = {
  startMoney: 300,
  hit: 5,
  assist: 50,
  ko: 150,
  deathConsolation: 75,
  /** TODO(plano): o valor do bônus por série de KOs não chegou no texto colado. Provisório: +50 por KO a partir do 3º seguido. */
  streakFrom: 3,
  streakBonusPerKo: 50,
  maxMoney: 10_000,
  /** Recompensa por derrubar quem está numa série de KOs (a partir do 3º seguido). */
  bountyFrom: 3,
  bountyPerStreak: 40,
  /** Time perdendo: quem é nocauteado ganha mais, proporcional à diferença no placar. */
  comebackPerScore: 15,
  comebackMax: 200,
} as const;

export function bounty(victimStreak: number): number {
  return victimStreak >= ECONOMY.bountyFrom ? victimStreak * ECONOMY.bountyPerStreak : 0;
}

export function streakBonus(streak: number): number {
  return streak >= ECONOMY.streakFrom ? (streak - ECONOMY.streakFrom + 1) * ECONOMY.streakBonusPerKo : 0;
}

export function addMoney(current: number, amount: number): number {
  return Math.min(ECONOMY.maxMoney, current + amount);
}
