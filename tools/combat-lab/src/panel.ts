import type { CombatConstants, CombatData, MoveDef } from '@torcidas/shared';

// Editor ao vivo do frame data. Muta o objeto `data` que a simulação lê a cada tick,
// então a mudança vale já no próximo golpe.

type NumKey = { [K in keyof MoveDef]-?: MoveDef[K] extends number | undefined ? K : never }[keyof MoveDef];

const MOVE_FIELDS: NumKey[] = ['startup', 'active', 'recovery', 'damage', 'staminaCost', 'hitstun', 'blockstun', 'knockback', 'hitstop', 'armorTicks', 'lunge'];
const OPTIONAL_FIELDS: NumKey[] = ['chargeTicks', 'chargeDamageBonus', 'backstabMultiplier', 'guardDamage'];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...children);
  return e;
}

function numField(label: string, get: () => number, set: (v: number) => void, step = 1): HTMLLabelElement {
  const input = el('input', { type: 'number', step: String(step) });
  input.value = String(get());
  input.addEventListener('input', () => {
    const v = Number(input.value);
    if (Number.isFinite(v)) set(v);
  });
  return el('label', { class: 'field' }, el('span', {}, label), input);
}

function moveEditor(m: MoveDef): HTMLDetailsElement {
  const d = el('details', {}, el('summary', {}, `${m.id} `, el('span', { class: 'muted' }, `(${m.kind})`)));
  for (const k of MOVE_FIELDS) {
    d.append(numField(k, () => m[k] ?? 0, (v) => ((m as unknown as Record<string, number>)[k] = v), k === 'knockback' || k === 'lunge' ? 0.1 : 1));
  }
  for (const k of OPTIONAL_FIELDS) {
    if (m[k] !== undefined) d.append(numField(k, () => m[k] ?? 0, (v) => ((m as unknown as Record<string, number>)[k] = v), 0.1));
  }
  const h = m.hitbox;
  if (h.shape === 'arc') {
    d.append(numField('hitbox.range', () => h.range, (v) => (h.range = v), 0.05));
    d.append(numField('hitbox.halfAngleDeg', () => h.halfAngleDeg, (v) => (h.halfAngleDeg = v), 1));
  } else {
    d.append(numField('hitbox.from', () => h.from, (v) => (h.from = v), 0.05));
    d.append(numField('hitbox.to', () => h.to, (v) => (h.to = v), 0.05));
    d.append(numField('hitbox.radius', () => h.radius, (v) => (h.radius = v), 0.05));
  }
  if (m.cancelWindow) {
    const cw = [...m.cancelWindow] as [number, number];
    const apply = () => (m.cancelWindow = [cw[0], cw[1]]);
    d.append(numField('cancelWindow início', () => cw[0], (v) => ((cw[0] = v), apply())));
    d.append(numField('cancelWindow fim', () => cw[1], (v) => ((cw[1] = v), apply())));
  }
  return d;
}

const CONSTANT_FIELDS: (keyof CombatConstants)[] = [
  'parryWindow',
  'parryLockout',
  'blockEnterCost',
  'parryStagger',
  'guardBreakTicks',
  'blockStaminaPerDamage',
  'blockHalfAngleDeg',
  'staminaRegenDelay',
  'staminaRegenPerTick',
  'walkSpeed',
  'knockdownTicks',
  'getUpTicks',
  'armorDamageMultiplier',
  'inputBufferTicks',
  'attackTurnRate',
];

export function buildConstantsEditor(data: CombatData): HTMLElement {
  const c = data.constants as unknown as Record<string, number>;
  const box = el('div');
  for (const k of CONSTANT_FIELDS) box.append(numField(k, () => c[k] ?? 0, (v) => (c[k] = v), Number.isInteger(c[k]) ? 1 : 0.05));
  for (const kind of ['step', 'roll'] as const) {
    const dodge = data.constants.dodge[kind];
    const ifr = [...dodge.iframes] as [number, number];
    const p = `${kind === 'step' ? 'passo' : 'rolamento'}.`;
    box.append(numField(`${p}staminaCost`, () => dodge.staminaCost, (v) => (dodge.staminaCost = v)));
    box.append(numField(`${p}duration`, () => dodge.duration, (v) => (dodge.duration = v)));
    box.append(numField(`${p}distance`, () => dodge.distance, (v) => (dodge.distance = v), 0.1));
    box.append(numField(`${p}iframes início`, () => ifr[0], (v) => ((ifr[0] = v), (dodge.iframes = [ifr[0], ifr[1]]))));
    box.append(numField(`${p}iframes fim`, () => ifr[1], (v) => ((ifr[1] = v), (dodge.iframes = [ifr[0], ifr[1]]))));
  }
  const d = data.constants.dodge;
  box.append(numField('esquiva perfeita (ticks)', () => d.perfectWindow, (v) => (d.perfectWindow = v)));
  const ct = data.constants.counter;
  box.append(numField('contra-golpe janela', () => ct.window, (v) => (ct.window = v)));
  box.append(numField('contra-golpe dano ×', () => ct.damageMultiplier, (v) => (ct.damageMultiplier = v), 0.1));
  return box;
}

export function buildWeaponEditor(data: CombatData, weaponId: string): HTMLElement {
  const w = data.weapons[weaponId];
  const box = el('div');
  if (!w) return box;
  box.append(numField('blockAbsorb', () => w.blockAbsorb, (v) => (w.blockAbsorb = v), 0.05));
  box.append(numField('blockStability', () => w.blockStability, (v) => (w.blockStability = v), 0.1));
  for (const m of w.moves.light) box.append(moveEditor(m));
  box.append(moveEditor(w.moves.heavy));
  box.append(moveEditor(data.common.kick));
  box.append(moveEditor(data.common.shove));
  return box;
}

export { el };
