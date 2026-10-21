import type { CombatConstants, CombatData, MoveDef, WeaponDef } from './types';

// Valores iniciais para afinar no combat lab. Frames são ticks a 60 Hz.

type MoveOverrides = Partial<MoveDef> & Pick<MoveDef, 'id'>;

const LIGHT_BASE: Omit<MoveDef, 'id'> = {
  kind: 'light',
  startup: 5,
  active: 3,
  recovery: 10,
  damage: 6,
  staminaCost: 8,
  hitbox: { shape: 'arc', range: 1.1, halfAngleDeg: 50 },
  hitstun: 16,
  blockstun: 10,
  knockback: 1.5,
  hitstop: 3,
  cancelWindow: [9, 16],
  canChainInto: [],
  armorTicks: 0,
  lunge: 0.2,
};

const HEAVY_BASE: Omit<MoveDef, 'id'> = {
  kind: 'heavy',
  startup: 14,
  active: 4,
  recovery: 22,
  damage: 16,
  staminaCost: 22,
  hitbox: { shape: 'arc', range: 1.3, halfAngleDeg: 45 },
  hitstun: 26,
  blockstun: 16,
  knockback: 4,
  hitstop: 6,
  cancelWindow: null,
  canChainInto: [],
  armorTicks: 12,
  lunge: 0.4,
  chargeTicks: 40,
  chargeDamageBonus: 0.6,
};

const move = (base: Omit<MoveDef, 'id'>, o: MoveOverrides): MoveDef => ({ ...base, ...o });
/** Leve sem janela explícita: encadeia da recuperação até o fim (acompanha os frames da arma, depois do acerto). */
const light = (o: MoveOverrides): MoveDef => {
  const m = move(LIGHT_BASE, o);
  return 'cancelWindow' in o ? m : { ...m, cancelWindow: [m.startup + m.active + 1, moveTotal(m)] };
};
const moveTotal = (m: MoveDef) => m.startup + m.active + m.recovery;
const heavy = (o: MoveOverrides) => move(HEAVY_BASE, o);

/** Combo leve de 3 golpes: cada um encadeia no próximo dentro da janela de cancel. */
function chain3(prefix: string, moves: [Partial<MoveDef>, Partial<MoveDef>, Partial<MoveDef>]): MoveDef[] {
  const ids = [`${prefix}.l1`, `${prefix}.l2`, `${prefix}.l3`] as const;
  return [
    light({ ...moves[0], id: ids[0], canChainInto: [ids[1]] }),
    light({ ...moves[1], id: ids[1], canChainInto: [ids[2]] }),
    light({ cancelWindow: null, ...moves[2], id: ids[2], canChainInto: [] }),
  ];
}

type BaseWeapon = Omit<WeaponDef, 'moves'> & { moves: Omit<WeaponDef['moves'], 'special'> };

const BASE_WEAPONS: BaseWeapon[] = [
  {
    id: 'punhos',
    nome: 'Punhos',
    tipo: 'nenhum',
    material: 'carne',
    preco: null,
    durabilidade: null,
    blockAbsorb: 0.5,
    blockStability: 1,
    moves: {
      light: chain3('punhos', [
        {},
        { damage: 7, recovery: 11 },
        { startup: 7, active: 4, recovery: 16, damage: 10, knockback: 3, hitstop: 5, hitstun: 22 },
      ]),
      heavy: heavy({ id: 'punhos.h' }),
    },
  },
  {
    id: 'soqueira',
    nome: 'Soqueira',
    tipo: 'contundente',
    material: 'metal',
    // TODO(plano): preço não chegou no texto colado do plano. Valor provisório.
    preco: 200,
    durabilidade: null,
    blockAbsorb: 0.55,
    blockStability: 1,
    moves: {
      light: chain3('soqueira', [
        { damage: 9 },
        { damage: 10, recovery: 11 },
        { startup: 7, active: 4, recovery: 16, damage: 16, knockback: 3, hitstop: 5, hitstun: 22 },
      ]),
      heavy: heavy({ id: 'soqueira.h', damage: 26 }),
    },
  },
  {
    id: 'garrafa',
    nome: 'Garrafa',
    tipo: 'contundente',
    material: 'vidro',
    preco: 100, // TODO(plano): preço provisório
    durabilidade: 1,
    quebraEm: 'caco',
    blockAbsorb: 0.45,
    blockStability: 0.9,
    moves: {
      light: [light({ id: 'garrafa.l1', startup: 7, active: 3, recovery: 14, damage: 18, hitstun: 24, knockback: 2.5, hitstop: 6, cancelWindow: null, hitbox: { shape: 'arc', range: 1.3, halfAngleDeg: 55 } })],
      heavy: heavy({ id: 'garrafa.h', damage: 26, hitbox: { shape: 'arc', range: 1.4, halfAngleDeg: 50 } }),
    },
  },
  {
    id: 'caco',
    nome: 'Caco de garrafa',
    tipo: 'cortante',
    material: 'vidro',
    preco: null,
    durabilidade: 6,
    blockAbsorb: 0.3,
    blockStability: 0.8,
    moves: {
      light: chain3('caco', [
        { damage: 5, bleed: true },
        { damage: 5, bleed: true },
        { startup: 6, damage: 7, bleed: true },
      ]),
      heavy: heavy({ id: 'caco.h', damage: 12, bleed: true, startup: 12 }),
    },
  },
  {
    id: 'faca',
    nome: 'Faca',
    tipo: 'cortante',
    material: 'metal',
    preco: 400, // TODO(plano): preço provisório
    durabilidade: 30,
    blockAbsorb: 0.35,
    blockStability: 0.9,
    moves: {
      light: chain3('faca', [
        { startup: 4, damage: 6, bleed: true, recovery: 9 },
        { startup: 4, damage: 6, bleed: true, recovery: 9 },
        { startup: 6, active: 3, damage: 9, bleed: true, recovery: 14, hitstun: 20 },
      ]),
      heavy: heavy({ id: 'faca.h', startup: 12, damage: 18, bleed: true, hitbox: { shape: 'capsule', from: 0.2, to: 1.3, radius: 0.2 } }),
    },
  },
  {
    id: 'punhal',
    nome: 'Punhal',
    tipo: 'perfurante',
    material: 'metal',
    preco: 500, // TODO(plano): preço provisório
    durabilidade: 25,
    blockAbsorb: 0.35,
    blockStability: 0.9,
    moves: {
      light: chain3('punhal', [
        { startup: 6, damage: 8, backstabMultiplier: 2.5, hitbox: { shape: 'capsule', from: 0.2, to: 1.2, radius: 0.18 } },
        { startup: 6, damage: 8, backstabMultiplier: 2.5, hitbox: { shape: 'capsule', from: 0.2, to: 1.2, radius: 0.18 } },
        { startup: 8, damage: 12, backstabMultiplier: 2.5, recovery: 18, hitbox: { shape: 'capsule', from: 0.2, to: 1.3, radius: 0.18 } },
      ]),
      heavy: heavy({ id: 'punhal.h', damage: 24, backstabMultiplier: 3, hitbox: { shape: 'capsule', from: 0.2, to: 1.4, radius: 0.2 } }),
    },
  },
  {
    id: 'cassetete',
    nome: 'Cassetete',
    tipo: 'contundente',
    material: 'madeira',
    preco: 350, // TODO(plano): preço provisório
    durabilidade: 40,
    blockAbsorb: 0.85,
    blockStability: 1.6,
    moves: {
      light: chain3('cassetete', [
        { startup: 6, damage: 9, hitbox: { shape: 'arc', range: 1.5, halfAngleDeg: 55 } },
        { startup: 6, damage: 9, hitbox: { shape: 'arc', range: 1.5, halfAngleDeg: 55 } },
        { startup: 8, active: 4, recovery: 18, damage: 13, knockback: 3, hitstop: 5, hitbox: { shape: 'arc', range: 1.6, halfAngleDeg: 50 } },
      ]),
      heavy: heavy({ id: 'cassetete.h', damage: 22, hitbox: { shape: 'arc', range: 1.6, halfAngleDeg: 45 } }),
    },
  },
  {
    id: 'taco',
    nome: 'Taco de beisebol',
    tipo: 'contundente',
    material: 'madeira',
    preco: 600, // TODO(plano): preço provisório
    durabilidade: 30,
    blockAbsorb: 0.7,
    blockStability: 1.3,
    moves: {
      light: [
        light({ id: 'taco.l1', startup: 11, active: 4, recovery: 18, damage: 14, staminaCost: 14, hitstun: 22, knockback: 3, hitstop: 5, cancelWindow: [16, 26], canChainInto: ['taco.l2'], lunge: 0.3, hitbox: { shape: 'arc', range: 1.85, halfAngleDeg: 55 } }),
        light({ id: 'taco.l2', startup: 11, active: 4, recovery: 22, damage: 16, staminaCost: 14, hitstun: 24, knockback: 4, hitstop: 6, cancelWindow: null, lunge: 0.3, hitbox: { shape: 'arc', range: 1.85, halfAngleDeg: 55 } }),
      ],
      heavy: heavy({ id: 'taco.h', startup: 20, active: 5, recovery: 28, damage: 30, staminaCost: 30, knockback: 6, knockdown: true, armorTicks: 16, hitbox: { shape: 'arc', range: 2.0, halfAngleDeg: 50 } }),
    },
  },
  {
    id: 'barra',
    nome: 'Barra de ferro',
    tipo: 'contundente',
    material: 'metal',
    preco: 700, // TODO(plano): preço provisório
    durabilidade: 50,
    blockAbsorb: 0.75,
    blockStability: 1.4,
    moves: {
      light: [
        light({ id: 'barra.l1', startup: 13, active: 4, recovery: 20, damage: 16, staminaCost: 16, hitstun: 24, knockback: 3.5, hitstop: 6, guardDamage: 1.8, cancelWindow: [18, 30], canChainInto: ['barra.l2'], lunge: 0.3, hitbox: { shape: 'arc', range: 1.7, halfAngleDeg: 50 } }),
        light({ id: 'barra.l2', startup: 13, active: 4, recovery: 24, damage: 18, staminaCost: 16, hitstun: 26, knockback: 4, hitstop: 6, guardDamage: 1.8, cancelWindow: null, lunge: 0.3, hitbox: { shape: 'arc', range: 1.7, halfAngleDeg: 50 } }),
      ],
      heavy: heavy({ id: 'barra.h', startup: 22, active: 5, recovery: 30, damage: 32, staminaCost: 32, knockback: 5, guardDamage: 3, armorTicks: 18, hitbox: { shape: 'arc', range: 1.8, halfAngleDeg: 45 } }),
    },
  },
];

const KICK: MoveDef = {
  id: 'chute',
  kind: 'kick',
  startup: 9,
  active: 3,
  recovery: 20,
  damage: 8,
  staminaCost: 18,
  hitbox: { shape: 'capsule', from: 0.2, to: 1.0, radius: 0.3 },
  hitstun: 0,
  blockstun: 14,
  knockback: 4,
  hitstop: 5,
  cancelWindow: null,
  canChainInto: [],
  armorTicks: 0,
  lunge: 0.2,
  knockdown: true,
  low: true,
};

const SPECIAL_BASE: Omit<MoveDef, 'id'> = {
  kind: 'special',
  startup: 10,
  active: 5,
  recovery: 24,
  damage: 20,
  staminaCost: 10,
  hitbox: { shape: 'arc', range: 1.4, halfAngleDeg: 50 },
  hitstun: 30,
  blockstun: 18,
  knockback: 4,
  hitstop: 6,
  cancelWindow: null,
  canChainInto: [],
  armorTicks: 10,
  lunge: 0.4,
};
const special = (o: MoveOverrides) => move(SPECIAL_BASE, o);

/** Especial de cada arma (tecla R, gasta Raça). */
const SPECIALS: Record<string, MoveDef> = {
  // Sequência de rua: 5 socos com armadura, o último derruba.
  punhos: special({ id: 'punhos.esp', startup: 6, active: 25, recovery: 22, damage: 5, hitstun: 14, knockback: 1, hitstop: 2, armorTicks: 31, lunge: 1.2, multiHit: { interval: 5, finalKnockdown: true }, hitbox: { shape: 'arc', range: 1.15, halfAngleDeg: 50 } }),
  soqueira: special({ id: 'soqueira.esp', startup: 6, active: 25, recovery: 22, damage: 7, hitstun: 14, knockback: 1, hitstop: 2, armorTicks: 31, lunge: 1.2, multiHit: { interval: 5, finalKnockdown: true }, hitbox: { shape: 'arc', range: 1.15, halfAngleDeg: 50 } }),
  // Garrafada: por cima, atordoa. A garrafa quebra no acerto (durabilidade 1).
  garrafa: special({ id: 'garrafa.esp', startup: 10, damage: 26, stunTicks: 75, hitbox: { shape: 'arc', range: 1.3, halfAngleDeg: 40 } }),
  caco: special({ id: 'caco.esp', startup: 12, damage: 16, stunTicks: 50, bleed: true, bleedStacks: 2, hitbox: { shape: 'arc', range: 1.2, halfAngleDeg: 40 } }),
  // Corte profundo: 3 sangramentos de uma vez.
  faca: special({ id: 'faca.esp', startup: 8, damage: 12, bleed: true, bleedStacks: 3, hitbox: { shape: 'arc', range: 1.25, halfAngleDeg: 70 } }),
  // Estocada fatal: sempre conta como pelas costas.
  punhal: special({ id: 'punhal.esp', startup: 12, damage: 14, backstabMultiplier: 2.5, alwaysBackstab: true, lunge: 0.9, hitbox: { shape: 'capsule', from: 0.2, to: 1.5, radius: 0.22 } }),
  // Varredura: arco largo e baixo, derruba.
  cassetete: special({ id: 'cassetete.esp', startup: 12, damage: 18, knockdown: true, hitbox: { shape: 'arc', range: 1.8, halfAngleDeg: 75 } }),
  // Rodada: giro de 360°.
  taco: special({ id: 'taco.esp', startup: 16, active: 8, recovery: 32, damage: 16, knockback: 7, hitbox: { shape: 'arc', range: 2.0, halfAngleDeg: 180 } }),
  // Martelada: não dá para bloquear.
  barra: special({ id: 'barra.esp', startup: 26, active: 5, recovery: 36, damage: 30, knockback: 5, knockdown: true, unblockable: true, armorTicks: 24, hitbox: { shape: 'arc', range: 2, halfAngleDeg: 35 } }),
};

/** Voadora: Q no ar. */
const VOADORA: MoveDef = {
  id: 'voadora',
  kind: 'context',
  startup: 4,
  active: 10,
  recovery: 18,
  damage: 14,
  staminaCost: 16,
  hitbox: { shape: 'capsule', from: 0.2, to: 1.1, radius: 0.35 },
  hitstun: 0,
  blockstun: 22,
  knockback: 6,
  hitstop: 6,
  cancelWindow: null,
  canChainInto: [],
  armorTicks: 0,
  lunge: 2.5,
  knockdown: true,
};

/** Cabeçada: E com inimigo atordoado na frente. */
const CABECADA: MoveDef = {
  id: 'cabecada',
  kind: 'context',
  startup: 6,
  active: 3,
  recovery: 18,
  damage: 15,
  staminaCost: 10,
  hitbox: { shape: 'arc', range: 1.0, halfAngleDeg: 40 },
  hitstun: 0,
  blockstun: 10,
  knockback: 3,
  hitstop: 7,
  cancelWindow: null,
  canChainInto: [],
  armorTicks: 0,
  lunge: 0.3,
  knockdown: true,
};

const SHOVE: MoveDef = {
  id: 'empurrao',
  kind: 'shove',
  startup: 8,
  active: 3,
  recovery: 18,
  damage: 2,
  staminaCost: 18,
  hitbox: { shape: 'capsule', from: 0.1, to: 0.9, radius: 0.35 },
  hitstun: 14,
  blockstun: 0,
  knockback: 5,
  hitstop: 4,
  cancelWindow: null,
  canChainInto: [],
  armorTicks: 0,
  lunge: 0.25,
  breaksGuard: true,
};

const WEAPON_LIST: WeaponDef[] = BASE_WEAPONS.map((w) => {
  const sp = SPECIALS[w.id];
  if (!sp) throw new Error(`arma ${w.id} sem especial`);
  return { ...w, moves: { ...w.moves, special: sp } };
});

export const DEFAULT_CONSTANTS: CombatConstants = {
  // 150 de vida: brigas duram mais (playtest com 100: KO em ~3 s do primeiro dano).
  maxHp: 150,
  // Fôlego muito grande: correr e brigar por bastante tempo antes de cansar.
  maxStamina: 500,
  // Volta a recuperar em 0,25 s e enche em ~2 s.
  staminaRegenDelay: 15,
  staminaRegenPerTick: 4,
  staminaRegenPerTickBlocking: 0.4,
  walkSpeed: 4,
  runSpeed: 6.8,
  // ~3,5 min de corrida com o fôlego cheio.
  runStaminaPerTick: 0.04,
  jumpVelocity: 6.5,
  gravity: 24,
  jumpStaminaCost: 12,
  kickMaxTargetHeight: 0.35,
  blockWalkSpeed: 1.5,
  chargeWalkSpeed: 1.2,
  hurtRadius: 0.35,
  blockHalfAngleDeg: 75,
  parryWindow: 9,
  parryLockout: 24,
  blockEnterCost: 4,
  parryStagger: 45,
  parryHitstop: 6,
  parryStaminaRefund: 10,
  // Proporcional ao fôlego maior: o guard break continua possível.
  blockStaminaPerDamage: 4,
  guardBreakTicks: 60,
  dodge: {
    step: { staminaCost: 14, duration: 12, distance: 1.4, iframes: [2, 7] },
    roll: { staminaCost: 30, duration: 24, distance: 3, iframes: [2, 14] },
    perfectWindow: 8,
    perfectStaminaRefund: 15,
  },
  counter: { window: 40, damageMultiplier: 1.6, minHitstun: 30 },
  blockCounterCost: 12,
  bareHandCutChipMultiplier: 1.5,
  raca: { max: 100, perDamageDealt: 0.3, perDamageTaken: 0.2, parry: 15, perfectDodge: 10, block: 2, revive: 10, specialCost: 70, shoutCost: 100, keepOnKo: 0.5 },
  shout: { duration: 40, radius: 8, buffTicks: 480, damageBonus: 0.2, staminaRegenMultiplier: 2 },
  headbuttRange: 1.2,
  curativo: { ticks: 120, interval: 30, amount: 15, walkSpeed: 1.2 },
  cart: { ticks: 90, interval: 30, amount: 15, cost: 50, cooldown: 1200, range: 1.8 },
  breath: { delay: 360, perTick: 0.15, cap: 90 },
  downed: { ticks: 900, hp: 45, crawlSpeed: 0.8, reviveTicks: 150, reviveRange: 1.6, reviveHp: 50, reviveProtection: 90, reviveMoney: 75, combatLockTicks: 300, enemyBlockRange: 6 },
  knockdownTicks: 45,
  getUpTicks: 20,
  armorDamageMultiplier: 0.75,
  backstabMinAngleDeg: 120,
  bleed: { duration: 180, interval: 30, damagePerInterval: 1, maxStacks: 5 },
  gankWindow: 90,
  gankMultipliers: [1, 0.8, 0.62, 0.5, 0.4],
  assistWindow: 600,
  koFallTicks: 60,
  // Respawn cresce com a partida: 5 s no começo, 20 s no fim.
  respawnTicks: 300,
  respawnTicksEnd: 1200,
  spawnProtectionTicks: 180,
  inputBufferTicks: 12,
  attackTurnRate: 0.15,
  lockOnRange: 18,
  lockOnConeDeg: 40,
  attackMoveSpeed: 2.4,
  runAttack: { momentum: 0.85, decay: 0.92 },
  knockbackFriction: 0.85,
  sedeRadius: 6,
  sedeCoreRadius: 4.5,
  flag: { carrierSpeed: 0.88, pickupRange: 1.6, returnTicks: 1800, capturesToWin: 3, carrierDamageTaken: 0.65, pickupProtection: 60 },
  startCurativos: 2,
  sedeEnemyDamagePerTick: 0.5,
  sedeHealPerTick: 0.08,
};

export function createCombatData(): CombatData {
  return structuredClone({
    constants: DEFAULT_CONSTANTS,
    weapons: Object.fromEntries(WEAPON_LIST.map((w) => [w.id, w])),
    common: { kick: KICK, shove: SHOVE, voadora: VOADORA, cabecada: CABECADA },
  });
}

/** Dados padrão. O combat lab usa createCombatData() para ter uma cópia editável. */
export const DEFAULT_COMBAT_DATA: CombatData = createCombatData();

export const WEAPON_IDS = WEAPON_LIST.map((w) => w.id);

/** Acha a definição de um golpe pelo id (o snapshot de rede só manda o id). */
export function findMove(data: CombatData, id: string | null): MoveDef | undefined {
  if (!id) return undefined;
  for (const m of Object.values(data.common)) if (m.id === id) return m;
  for (const w of Object.values(data.weapons)) {
    if (w.moves.heavy.id === id) return w.moves.heavy;
    if (w.moves.special.id === id) return w.moves.special;
    const m = w.moves.light.find((x) => x.id === id);
    if (m) return m;
  }
  return undefined;
}
