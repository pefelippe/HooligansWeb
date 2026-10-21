// Input de um jogador por tick. O cliente manda isto; o servidor nunca recebe dano ou acerto.

export const Buttons = {
  LIGHT: 1 << 0,
  HEAVY: 1 << 1,
  BLOCK: 1 << 2,
  DODGE: 1 << 3,
  SHOVE: 1 << 4,
  KICK: 1 << 5,
  LOCK: 1 << 6,
  RUN: 1 << 7,
  JUMP: 1 << 8,
  SPECIAL: 1 << 9,
  SHOUT: 1 << 10,
  USE: 1 << 11,
  HEAL: 1 << 12,
  /** Troca o alvo do lock-on (roda do mouse). */
  LOCK_NEXT: 1 << 13,
} as const;

export interface PlayerInput {
  /** Direção de movimento no mundo, cada eixo em [-1, 1]. */
  moveX: number;
  moveZ: number;
  /** Yaw para onde o jogador mira (câmera/mouse). */
  aim: number;
  /** Bitmask de botões segurados neste tick (ver Buttons). */
  buttons: number;
}

export const NEUTRAL_INPUT: PlayerInput = { moveX: 0, moveZ: 0, aim: 0, buttons: 0 };

/** Validação anti-cheat: corrige valores fora do intervalo em vez de confiar no cliente. */
export function sanitizeInput(input: PlayerInput, fallbackAim: number): PlayerInput {
  const fin = (v: number, d: number) => (Number.isFinite(v) ? v : d);
  let moveX = Math.max(-1, Math.min(1, fin(input.moveX, 0)));
  let moveZ = Math.max(-1, Math.min(1, fin(input.moveZ, 0)));
  const len = Math.hypot(moveX, moveZ);
  if (len > 1) {
    moveX /= len;
    moveZ /= len;
  }
  return { moveX, moveZ, aim: fin(input.aim, fallbackAim), buttons: (input.buttons | 0) & 0x3fff };
}
