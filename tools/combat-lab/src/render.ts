import {
  attackPhase,
  type CombatData,
  type Fighter,
  type Hitbox,
  hasArmor,
  isInvulnerable,
  moveTotalFrames,
  type SimState,
} from '@torcidas/shared';
import * as THREE from 'three';

// Bonecos de cápsula. A "animação" é função pura do frame da simulação:
// a pose sai de (estado, stateTick, frame data), nunca o contrário.

const PHASE_COLORS = { startup: 0xe9c46a, active: 0xe63946, recovery: 0x6c757d } as const;

export interface FighterView {
  root: THREE.Group;
  body: THREE.Mesh<THREE.CapsuleGeometry, THREE.MeshStandardMaterial>;
  arm: THREE.Group;
  weapon: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  hurt: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  guard: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  hitbox: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  hitboxKey: string;
  baseColor: THREE.Color;
}

export function createFighterView(scene: THREE.Scene, color: string, accent: string): FighterView {
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.33, 1.0, 4, 12), new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));
  body.position.y = 0.83;
  body.castShadow = true;
  root.add(body);

  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.25), new THREE.MeshStandardMaterial({ color: accent }));
  nose.position.set(0, 1.45, 0.3);
  root.add(nose);

  const arm = new THREE.Group();
  arm.position.set(0.25, 1.15, 0);
  const weapon = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 1), new THREE.MeshStandardMaterial({ color: accent }));
  arm.add(weapon);
  root.add(arm);

  const hurt = new THREE.Mesh(new THREE.RingGeometry(0.33, 0.35, 40), new THREE.MeshBasicMaterial({ color: 0x4cc9f0, transparent: true, opacity: 0.8, depthWrite: false }));
  hurt.rotation.x = -Math.PI / 2;
  hurt.position.y = 0.02;
  root.add(hurt);

  const guard = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 0.6, 32, 1, -Math.PI * 0.42 + Math.PI / 2, Math.PI * 0.84),
    new THREE.MeshBasicMaterial({ color: 0x90e0ef, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
  );
  guard.rotation.x = -Math.PI / 2;
  guard.position.y = 0.05;
  root.add(guard);

  const hitbox = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
  hitbox.rotation.x = -Math.PI / 2;
  hitbox.position.y = 0.03;
  scene.add(hitbox);

  scene.add(root);
  return { root, body, arm, weapon, hurt, guard, hitbox, hitboxKey: '', baseColor: new THREE.Color(color) };
}

/** Geometria do hitbox no plano local do atacante (+Y da forma = frente). */
function hitboxGeometry(h: Hitbox): THREE.BufferGeometry {
  if (h.shape === 'arc') {
    const half = (h.halfAngleDeg * Math.PI) / 180;
    return new THREE.CircleGeometry(h.range, 32, Math.PI / 2 - half, half * 2);
  }
  const shape = new THREE.Shape();
  const r = h.radius;
  shape.moveTo(-r, h.from);
  shape.lineTo(-r, h.to);
  shape.absarc(0, h.to, r, Math.PI, 0, true);
  shape.lineTo(r, h.from);
  shape.absarc(0, h.from, r, 0, Math.PI, true);
  return new THREE.ShapeGeometry(shape, 12);
}

export function updateFighterView(v: FighterView, f: Fighter, s: SimState, data: CombatData, showHitboxes: boolean): void {
  const c = data.constants;
  v.root.position.set(f.pos.x, f.y, f.pos.z);
  v.root.rotation.set(0, f.facing, 0);

  // Pose do corpo por estado.
  const t = f.stateTick;
  let lean = 0;
  let lie = 0;
  let squash = 1;
  switch (f.state) {
    case 'hitstun':
      lean = -0.35 * Math.max(0, 1 - t / Math.max(1, f.stateDuration));
      break;
    case 'staggered':
    case 'guardbreak':
      lean = -0.25 + Math.sin(t * 0.4) * 0.12;
      break;
    case 'knockdown':
      lie = Math.min(1, t / 8);
      break;
    case 'getup':
      lie = 1 - Math.min(1, t / Math.max(1, f.stateDuration));
      break;
    case 'ko':
      lie = Math.min(1, t / 20);
      break;
    case 'dead':
      lie = 1;
      break;
    case 'dodge':
      squash = 0.6;
      break;
    case 'charging':
      squash = 0.92;
      break;
  }
  v.body.rotation.x = lean - lie * (Math.PI / 2);
  v.body.position.y = 0.83 * (1 - lie * 0.65) * squash;
  v.body.scale.y = squash;

  // Braço/arma: wind-up no startup, varrida no active, volta no recovery.
  const def = f.move?.def;
  const w = data.weapons[f.weapon];
  const reach = def?.hitbox.shape === 'arc' ? def.hitbox.range : def?.hitbox.shape === 'capsule' ? def.hitbox.to : 0.9;
  v.weapon.scale.z = Math.max(0.3, reach * 0.8);
  v.weapon.position.z = (reach * 0.8) / 2;
  v.weapon.material.color.set(w?.material === 'metal' ? 0xbfc7d5 : w?.material === 'madeira' ? 0xa0522d : w?.material === 'vidro' ? 0x2a9d8f : 0xf4a261);
  let swing = 0.2;
  if (f.state === 'attack' && def) {
    const half = def.hitbox.shape === 'arc' ? (def.hitbox.halfAngleDeg * Math.PI) / 180 : 0;
    const ph = attackPhase(def, t);
    if (ph === 'startup') swing = -half * (t / def.startup) - 0.2;
    else if (ph === 'active') swing = -half + 2 * half * ((t - def.startup) / def.active);
    else swing = half * (1 - (t - def.startup - def.active) / def.recovery);
    if (def.hitbox.shape === 'capsule') v.weapon.position.z = (reach * 0.8) / 2 + (ph === 'active' ? 0.25 : 0);
  } else if (f.state === 'charging') {
    swing = -0.9;
  } else if (f.state === 'block') {
    swing = 1.2;
  }
  v.arm.rotation.y = -swing;

  // Cores e indicadores.
  const flash = f.hitstop > 0 && (f.state === 'hitstun' || f.state === 'knockdown');
  const inv = isInvulnerable(f, s.tick, c);
  v.body.material.color.copy(flash ? new THREE.Color(0xffffff) : v.baseColor);
  v.body.material.emissive.set(hasArmor(f) ? 0x7b2cbf : f.state === 'staggered' || f.state === 'guardbreak' ? 0x664400 : 0x000000);
  v.body.material.transparent = inv;
  v.body.material.opacity = inv ? 0.45 : 1;
  v.hurt.material.color.set(inv ? 0x00f5d4 : 0x4cc9f0);
  v.hurt.visible = showHitboxes;

  v.guard.visible = f.state === 'block' || f.state === 'blockstun';
  const parryLive = f.state === 'block' && f.parryEligible && s.tick - f.blockStartTick <= c.parryWindow;
  v.guard.material.color.set(parryLive ? 0xffd60a : 0x90e0ef);

  // Hitbox do golpe: amarelo no startup (preview), vermelho ativo, cinza recovery.
  if (showHitboxes && f.state === 'attack' && def) {
    const key = JSON.stringify(def.hitbox);
    if (key !== v.hitboxKey) {
      v.hitbox.geometry.dispose();
      v.hitbox.geometry = hitboxGeometry(def.hitbox);
      v.hitboxKey = key;
    }
    const ph = attackPhase(def, t);
    v.hitbox.visible = true;
    v.hitbox.material.color.set(PHASE_COLORS[ph]);
    v.hitbox.material.opacity = ph === 'active' ? 0.55 : 0.18;
    v.hitbox.position.x = f.pos.x;
    v.hitbox.position.z = f.pos.z;
    // Forma desenhada com a frente em +Y local. Com Euler XYZ (Rz, depois Rx = -PI/2),
    // +Y local vira (-sin z, 0, -cos z) no mundo; para apontar em dirFromYaw(facing), z = facing + PI.
    v.hitbox.rotation.set(-Math.PI / 2, 0, f.facing + Math.PI);
  } else {
    v.hitbox.visible = false;
  }
}

export function frameInfo(f: Fighter): { label: string; total: number; frame: number } | null {
  if (f.state === 'attack' && f.move) {
    return { label: f.move.def.id, total: moveTotalFrames(f.move.def), frame: f.stateTick };
  }
  return null;
}
