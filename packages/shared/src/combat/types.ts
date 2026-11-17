// Tipos do combate. Tudo é medido em ticks (60 Hz) e metros no plano XZ.

export const TICK_RATE = 60;
export const TICK_MS = 1000 / TICK_RATE;

export interface Vec2 {
  x: number;
  z: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Índice da facção. Hoje as 2 torcidas. Para a polícia: vira `0 | 1 | 2`, `PerTeam` ganha um T
 * e `TEAM_COUNT` = 3; o compilador aponta o resto.
 */
export type TeamSide = 0 | 1;
export type PerTeam<T = number> = [T, T];
export const TEAM_COUNT = 2;
export const TEAMS: readonly TeamSide[] = [0, 1];

/** Validação na borda (mensagens de cliente, HTTP interno). */
export function isTeam(t: unknown): t is TeamSide {
  return Number.isInteger(t) && (t as number) >= 0 && (t as number) < TEAM_COUNT;
}

/** Um valor por facção (placar, capturas, bots). */
export function perTeam<T = number>(make: () => T = () => 0 as T): PerTeam<T> {
  return TEAMS.map(make) as PerTeam<T>;
}

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
  /**
   * Tiro: acerta só o primeiro lutador na linha e para no primeiro obstáculo do mapa.
   * Dano cheio até `fullRange` m, caindo linearmente até `minScale` no fim do alcance.
   */
  shot?: { fullRange: number; minScale: number };
  /** Em vez de hitstun, atordoa (staggered) por N ticks. */
  stunTicks?: number;
  /** Acúmulos de sangramento aplicados por acerto (padrão 1 se `bleed`). */
  bleedStacks?: number;
  /** Sempre conta como pelas costas. */
  alwaysBackstab?: boolean;
  /** Ignora o bloqueio (acerta mesmo com guarda). */
  unblockable?: boolean;
  /** Alcance vertical para cima (m): alvo mais alto que isto não é atingido. Padrão: constants.vReachUp. */
  vReach?: number;
  /** Corpo baixo (carrinho): golpes que não são `low` passam por cima nestes frames [início, fim]. */
  lowProfile?: readonly [number, number];
  /** Ataque de queda (pisão): o startup segura até aterrissar e o dano cresce com a altura. */
  plunge?: boolean;
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
  /** Ticks mínimos entre um golpe leve e o próximo (armas de fogo). */
  cooldown?: number;
  /** Arma de fogo: balas no pente. Acabou, a arma sai da mão (não tem recarga). */
  municao?: number;
  /** Nível mínimo da conta para comprar (progressão). */
  nivelMin?: number;
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

export interface TraverseConstants {
  /** Distância à frente (m) em que se procura o obstáculo. */
  probe: number;
  vaultMaxHeight: number;
  vaultMaxDepth: number;
  vaultTicks: number;
  vaultRunTicks: number;
  hoodMaxDepth: number;
  hoodTicks: number;
  climbBaseTicks: number;
  climbTicksPerMeter: number;
  /** No ar: sobe sozinho se a borda está até N m acima do pé. */
  airMantleReach: number;
  airMantleTicks: number;
  /** Custo parado/andando (correndo, pular e capô são de graça). */
  cost: number;
  /** Carregando o bandeirão: travessia mais lenta. */
  carrierTicksMultiplier: number;
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
  /** Pulo vale até N ticks depois de sair da borda (coyote time). */
  coyoteTicks: number;
  /** Travessias (Espaço perto de obstáculo baixo): pular por cima, deslizar no capô, subir. */
  traverse: TraverseConstants;
  /** Queda alta: correndo vira rolamento grátis; parado fica lento por um instante. */
  landing: { rollMinFall: number; lagMinFall: number; lagSlowTicks: number };
  /** Queda de ≥ minHeight atordoado/derrubado: dano e knockdown. */
  fall: { minHeight: number; damage: number };
  /** Golpe corpo a corpo: alcance vertical padrão para cima e para baixo (m). */
  vReachUp: number;
  vReachDown: number;
  /** Magnetismo do golpe sem lock-on: gira e avança até o inimigo mais perto no cone. */
  magnet: { range: number; coneDeg: number; maxExtraLunge: number };
  /** Arremessado contra obstáculo com knockback forte: dano, atordoa. */
  splat: { minSpeed: number; damage: number; stunTicks: number };
  /** Pisão: só sai caindo de pelo menos `minHeight` acima do chão; bônus de dano por metro. */
  plunge: { minHeight: number; bonusPerMeter: number };
  /** Passo curto (C andando/parado), rolamento (C correndo) e rolamento de aterrissagem. */
  dodge: {
    step: DodgeDef;
    roll: DodgeDef;
    land: DodgeDef;
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
  /** Bandagem: cura instantânea pequena, com recarga curta (spammável). */
  bandagem: { amount: number; cooldown: number; start: number };
  /** Colete: segura `absorb` do dano até gastar os `hp` dele. */
  colete: { hp: number; absorb: number };
  /** Arremessáveis de controle de grupo: não tiram vida. */
  throwables: {
    cooldown: number;
    range: number;
    flightTicks: number;
    bomba: { radius: number; knockback: number };
    gas: { radius: number; ticks: number; staminaPerTick: number; coughEvery: number; coughTicks: number };
  };
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
  /** Golpe recebido: fica lento e sem correr por um tempo. */
  hitSlow: { ticks: number; speedMultiplier: number };
  /** Quebra-trava: depois de `hits` golpes seguidos (cada um até `window` ticks do anterior), fica intocável até sair do atordoamento + `protectTicks`. */
  stunBreak: { hits: number; window: number; protectTicks: number };
  /** Fúria (anti-cerco): enche ao apanhar de 2+ atacantes; cheia, explode derrubando quem está perto e dá armadura. */
  fury: { max: number; perDamage: number; radius: number; knockback: number; armorTicks: number; decayDelay: number; decayPerTick: number };
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
  common: { kick: MoveDef; shove: MoveDef; voadora: MoveDef; cabecada: MoveDef; pisao: MoveDef; carrinho: MoveDef };
}
