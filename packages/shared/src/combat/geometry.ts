import type { Hitbox, Vec2 } from './types';

// Matemática própria de hitbox. Personagens são cápsulas verticais; no plano XZ
// isso vira um círculo de raio hurtRadius. Golpes são arcos ou cápsulas horizontais.

const DEG = Math.PI / 180;

/** Yaw 0 aponta para +Z; yaw positivo gira em direção a +X. */
export function dirFromYaw(yaw: number): Vec2 {
  return { x: Math.sin(yaw), z: Math.cos(yaw) };
}

export function yawTo(from: Vec2, to: Vec2): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Diferença angular em [-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

export function turnToward(current: number, target: number, maxStep: number): number {
  const d = angleDiff(target, current);
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}

/** Ângulo (graus, 0..180) entre a frente de `self` e a direção até `other`. */
export function relativeAngleDeg(selfPos: Vec2, selfYaw: number, otherPos: Vec2): number {
  return Math.abs(angleDiff(yawTo(selfPos, otherPos), selfYaw)) / DEG;
}

export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2));
  return Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t));
}

export function hitboxOverlaps(hitbox: Hitbox, origin: Vec2, yaw: number, target: Vec2, targetRadius: number): boolean {
  if (hitbox.shape === 'arc') {
    const d = dist(origin, target);
    if (d > hitbox.range + targetRadius) return false;
    if (d <= targetRadius) return true;
    // Folga angular pelo raio do alvo: um alvo encostado na borda do arco ainda conta.
    const slack = Math.asin(Math.min(1, targetRadius / d)) / DEG;
    return relativeAngleDeg(origin, yaw, target) <= hitbox.halfAngleDeg + slack;
  }
  const dir = dirFromYaw(yaw);
  const a = { x: origin.x + dir.x * hitbox.from, z: origin.z + dir.z * hitbox.from };
  const b = { x: origin.x + dir.x * hitbox.to, z: origin.z + dir.z * hitbox.to };
  return pointSegmentDistance(target, a, b) <= hitbox.radius + targetRadius;
}
