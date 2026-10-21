// Tipos do combate. Tudo é medido em ticks (60 Hz) e metros no plano XZ.

export const TICK_RATE = 60;
export const TICK_MS = 1000 / TICK_RATE;

export interface Vec2 {
  x: number;
  z: number;
}

export type TeamSide = 0 | 1;

export type Hitbox =
  /** Arco à frente do atacante: alcance em metros, meia-abertura em graus. */
  | { shape: 'arc'; range: number; halfAngleDeg: number }
  /** Cápsula varrida ao longo da direção do golpe (estocadas, tacos). */
  | { shape: 'capsule'; from: number; to: number; radius: number };

export type MoveKind = 'light' | 'heavy' | 'kick' | 'shove' | 'special' | 'context';

export interface MoveDef {
  id: string;
  kind: MoveKind;
  startup: number;
  active: number;
  recovery: number;
  damage: number;
  staminaCost: number;
  hitbox: Hitbox;
  hitstun: number;
  blockstun: number;
  /** Velocidade inicial (m/s) aplicada ao alvo na direção do golpe. */
  knockback: number;
  /** Ticks de hitstop (congela atacante e alvo) ao conectar. */
  hitstop: number;
  /** Janela [início, fim] (em frames do golpe, 1-indexados) para cancelar no próximo golpe ou esquiva. */
  cancelWindow: readonly [number, number] | null;
  canChainInto: readonly string[];
  /** Frames iniciais (contando a carga) em que o golpe tem hyper-armor parcial. */
  armorTicks: number;
  /** Deslocamento à frente (m) distribuído entre startup e active. */
  lunge: number;
  knockdown?: boolean;
  /** Empurrão/agarrão: contra bloqueio causa guard break direto. */
  breaksGuard?: boolean;
  /** Multiplicador do dreno de estamina quando bloqueado. */
  guardDamage?: number;
  bleed?: boolean;
  /** Multiplicador de dano quando acerta pelas costas. */
  backstabMultiplier?: number;
  /** Ticks máximos de carga (golpe pesado). 0 = sem carga. */
  chargeTicks?: number;
  /** Dano extra com carga máxima (0.6 = +60%). */
  chargeDamageBonus?: number;
  /** Golpe baixo: não pega quem está no ar (chute). */
  low?: boolean;
  /** Vários acertos no mesmo active: a lista de alvos zera a cada `interval` frames. */
  multiHit?: { interval: number; finalKnockdown?: boolean };
  /** Em vez de hitstun, atordoa (staggered) por N ticks. */
  stunTicks?: number;
  /** Acúmulos de sangramento aplicados por acerto (padrão 1 se `bleed`). */
  bleedStacks?: number;
  /** Sempre conta como pelas costas. */
  alwaysBackstab?: boolean;
  /** Ignora o bloqueio (acerta mesmo com guarda). */
  unblockable?: boolean;
}

export type WeaponType = 'nenhum' | 'contundente' | 'cortante' | 'perfurante';
export type HitMaterial = 'carne' | 'metal' | 'madeira' | 'vidro';

export interface WeaponDef {
  id: string;
  nome: string;
  tipo: WeaponType;
  material: HitMaterial;
  /** null = não vendida na loja (punhos, caco). */
  preco: number | null;
  /** Número de contatos (acerto ou bloqueio) até quebrar. null = indestrutível. */
  durabilidade: number | null;
  /** Arma em que se transforma ao quebrar (garrafa → caco). Padrão: punhos. */
  quebraEm?: string;
  /** Fração do dano absorvida ao bloquear com esta arma. */
  blockAbsorb: number;
  /** Divide o dreno de estamina ao bloquear (maior = bloqueia melhor). */
  blockStability: number;
  moves: {
    light: readonly MoveDef[];
    heavy: MoveDef;
    /** Especial da arma (tecla R), gasta Raça. */
    special: MoveDef;
  };
}

export interface DodgeDef {
  staminaCost: number;
  duration: number;
  distance: number;
  /** i-frames [início, fim], frames 1-indexados. */
  iframes: readonly [number, number];
}

export interface CombatConstants {
  maxHp: number;
  maxStamina: number;
  staminaRegenDelay: number;
  staminaRegenPerTick: number;
  staminaRegenPerTickBlocking: number;
  walkSpeed: number;
  /** Correr (Shift): mais rápido, gasta estamina e trava a regeneração. */
  runSpeed: number;
  runStaminaPerTick: number;
  /** Pulo: velocidade vertical inicial (m/s), gravidade (m/s²) e custo. */
  jumpVelocity: number;
  gravity: number;
  jumpStaminaCost: number;
  /** Chute (golpe baixo) não pega quem está no ar acima desta altura. */
  kickMaxTargetHeight: number;
  blockWalkSpeed: number;
  chargeWalkSpeed: number;
  hurtRadius: number;
  /** Bloqueio só protege golpes vindos deste cone frontal. */
  blockHalfAngleDeg: number;
  /** ~150 ms: bloqueio iniciado até N ticks antes do impacto vira parry. */
  parryWindow: number;
  /** Re-apertar o bloqueio menos de N ticks depois de soltar não abre nova janela de parry (anti-spam). */
  parryLockout: number;
  /** Custo de estamina para entrar no bloqueio. */
  blockEnterCost: number;
  parryStagger: number;
  parryHitstop: number;
  parryStaminaRefund: number;
  blockStaminaPerDamage: number;
  guardBreakTicks: number;
  /** Passo curto (C andando/parado) e rolamento (C correndo). */
  dodge: {
    step: DodgeDef;
    roll: DodgeDef;
    /** Esquiva perfeita: o golpe passou pelos i-frames até N ticks depois de começar a esquiva. */
    perfectWindow: number;
    perfectStaminaRefund: number;
  };
  /** Contra-golpe depois de parry/esquiva perfeita. */
  counter: { window: number; damageMultiplier: number; minHitstun: number };
  /** Apertar leve no blockstun cancela num golpe (custo extra de estamina). */
  blockCounterCost: number;
  /** Bloquear arma cortante de mão vazia: multiplica o chip e sangra. */
  bareHandCutChipMultiplier: number;
  raca: {
    max: number;
    perDamageDealt: number;
    perDamageTaken: number;
    parry: number;
    perfectDodge: number;
    block: number;
    revive: number;
    specialCost: number;
    shoutCost: number;
    /** Fração mantida ao ser nocauteado. */
    keepOnKo: number;
  };
  shout: { duration: number; radius: number; buffTicks: number; damageBonus: number; staminaRegenMultiplier: number };
  /** Cabeçada: E perto de inimigo atordoado. */
  headbuttRange: number;
  curativo: { ticks: number; interval: number; amount: number; walkSpeed: number };
  cart: { ticks: number; interval: number; amount: number; cost: number; cooldown: number; range: number };
  /** Fôlego: regenera fora de combate até um teto. */
  breath: { delay: number; perTick: number; cap: number };
  /** Caído: `hp` é a vida de caído (golpes inimigos tiram dela até o KO). */
  downed: {
    ticks: number;
    hp: number;
    crawlSpeed: number;
    reviveTicks: number;
    reviveRange: number;
    reviveHp: number;
    reviveProtection: number;
    reviveMoney: number;
    /** Sem levantar aliado até este tanto de ticks depois de dar/levar dano. */
    combatLockTicks: number;
    /** Inimigo vivo a esta distância (do reviver ou do caído) impede levantar. */
    enemyBlockRange: number;
  };
  knockdownTicks: number;
  getUpTicks: number;
  /** Dano recebido durante hyper-armor é multiplicado por isto (armadura parcial). */
  armorDamageMultiplier: number;
  /** Ataque pelas costas: ângulo mínimo entre a frente do alvo e o atacante. */
  backstabMinAngleDeg: number;
  bleed: {
    duration: number;
    interval: number;
    damagePerInterval: number;
    maxStacks: number;
  };
  /** Anti-gank: janela em que atacantes distintos contam. */
  gankWindow: number;
  /** Multiplicador por número de atacantes recentes (índice = atacantes - 1). */
  gankMultipliers: readonly number[];
  assistWindow: number;
  koFallTicks: number;
  /** Respawn no começo da partida; vai subindo até respawnTicksEnd no fim. */
  respawnTicks: number;
  respawnTicksEnd: number;
  spawnProtectionTicks: number;
  inputBufferTicks: number;
  attackTurnRate: number;
  lockOnRange: number;
  /** Cone (graus, meia-abertura) em volta da mira para escolher o alvo do lock-on. */
  lockOnConeDeg: number;
  /** Deslocamento (m/s) que o input ainda dá durante um golpe. */
  attackMoveSpeed: number;
  /** Golpe saindo da corrida: embalo inicial (fração da runSpeed) e decaimento por tick. */
  runAttack: { momentum: number; decay: number };
  knockbackFriction: number;
  /** Raio da sede (zona segura) quando a sede não tem área (lab). */
  sedeRadius: number;
  /** Núcleo do spawn: inimigo aqui dentro perde vida (anti spawn camping). */
  sedeCoreRadius: number;
  /** Bandeirão: carregador anda mais devagar e só de punhos. */
  flag: { carrierSpeed: number; pickupRange: number; returnTicks: number; capturesToWin: number; carrierDamageTaken: number; pickupProtection: number };
  startCurativos: number;
  sedeEnemyDamagePerTick: number;
  sedeHealPerTick: number;
}

export interface CombatData {
  constants: CombatConstants;
  weapons: Record<string, WeaponDef>;
  /** Golpes universais, independentes da arma. Voadora e cabeçada são de contexto. */
  common: { kick: MoveDef; shove: MoveDef; voadora: MoveDef; cabecada: MoveDef };
}
