import type { GasCloud, Throwable, Vec2 } from '@torcidas/shared';
import { DEFAULT_COMBAT_DATA } from '@torcidas/shared';
import * as THREE from 'three';

// Arremessáveis: a lata voando em arco, o clarão da bomba e a nuvem de gás.
// O estado (em voo, nuvens ativas) vem do snapshot; a explosão e o "puff" vêm dos eventos.

const T = DEFAULT_COMBAT_DATA.constants.throwables;
const ARC = 3.2;
const BLAST_LIFE = 0.5;

interface Blast {
  ball: THREE.Mesh;
  ring: THREE.Mesh;
  age: number;
}

interface Cloud {
  group: THREE.Group;
  /** Um material por nuvem, sem luz: as nuvens dos bots enchiam a tela de esferas iluminadas. */
  mat: THREE.MeshBasicMaterial;
  puffs: THREE.Mesh[];
  until: number;
  born: number;
}

// Caixa de 1 m ao longo de +Z a partir da origem (escala no comprimento do tiro).
const TRACER_GEO = new THREE.BoxGeometry(0.04, 0.04, 1).translate(0, 0, 0.5);
const CAN_GEO = new THREE.CylinderGeometry(0.13, 0.13, 0.32, 10);
const BOMB_MAT = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.8 });
const GAS_CAN_MAT = new THREE.MeshStandardMaterial({ color: 0x9aa36a, roughness: 0.5, metalness: 0.3 });
const SMOKE_GEO = new THREE.SphereGeometry(1, 8, 6);
const PUFFS = 5;
// Geometria compartilhada e sem PointLight: luz nova na cena recompila o shader de todo material (o FPS ia a 1).
const BALL_GEO = new THREE.SphereGeometry(1, 16, 12);
const RING_GEO = new THREE.RingGeometry(0.85, 1, 40);

export class ThrowFx {
  private readonly cans = new Map<string, THREE.Mesh>();
  private readonly clouds = new Map<string, Cloud>();
  private readonly blasts: Blast[] = [];
  private time = 0;
  private readonly tracers: { line: THREE.Mesh; age: number }[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  explode(pos: Vec2): void {
    const ball = new THREE.Mesh(BALL_GEO, new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    ball.position.set(pos.x, 0.6, pos.z);
    const ring = new THREE.Mesh(RING_GEO, new THREE.MeshBasicMaterial({ color: 0xfff1c0, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, 0.05, pos.z);
    this.scene.add(ball, ring);
    this.blasts.push({ ball, ring, age: 0 });
  }

  /** Traço do tiro: some em 0,12 s. */
  shot(from: Vec2, yaw: number, range: number): void {
    const line = new THREE.Mesh(TRACER_GEO, new THREE.MeshBasicMaterial({ color: 0xfff2a8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    line.scale.set(1, 1, range);
    line.position.set(from.x, 1.35, from.z);
    line.rotation.y = yaw;
    this.scene.add(line);
    this.tracers.push({ line, age: 0 });
  }

  /** O gás estoura: a nuvem em si chega pelo snapshot. */
  puff(pos: Vec2): void {
    this.explode(pos);
    const b = this.blasts[this.blasts.length - 1];
    if (!b) return;
    const m = b.ball.material as THREE.MeshBasicMaterial;
    m.color.set(0xe8eadf);
    m.blending = THREE.NormalBlending;
  }

  update(dt: number, snap: { tick: number; throws: Throwable[]; clouds: GasCloud[] } | undefined, serverTick: number): void {
    this.time += dt;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i]!;
      t.age += dt;
      if (t.age >= 0.12) {
        this.scene.remove(t.line);
        (t.line.material as THREE.Material).dispose();
        this.tracers.splice(i, 1);
      } else (t.line.material as THREE.MeshBasicMaterial).opacity = 1 - t.age / 0.12;
    }
    this.syncCans(snap?.throws ?? [], serverTick);
    this.syncClouds(snap?.clouds ?? [], serverTick);
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i]!;
      b.age += dt;
      const t = b.age / BLAST_LIFE;
      if (t >= 1) {
        this.scene.remove(b.ball, b.ring);
        (b.ball.material as THREE.Material).dispose();
        (b.ring.material as THREE.Material).dispose();
        this.blasts.splice(i, 1);
        continue;
      }
      const ease = 1 - (1 - t) ** 3;
      b.ball.scale.setScalar(0.4 + ease * 1.6);
      (b.ball.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.85;
      b.ring.scale.setScalar(0.5 + ease * T.bomba.radius);
      (b.ring.material as THREE.MeshBasicMaterial).opacity = 1 - t;
    }
  }

  private syncCans(list: Throwable[], tick: number): void {
    const seen = new Set<string>();
    for (const p of list) {
      const key = `${p.owner}:${p.t0}`;
      seen.add(key);
      let m = this.cans.get(key);
      if (!m) {
        m = new THREE.Mesh(CAN_GEO, p.kind === 'bomba' ? BOMB_MAT : GAS_CAN_MAT);
        m.castShadow = true;
        this.scene.add(m);
        this.cans.set(key, m);
      }
      const t = Math.max(0, Math.min(1, (tick - p.t0) / (p.t1 - p.t0)));
      m.position.set(p.from.x + (p.to.x - p.from.x) * t, 1.4 * (1 - t) + 4 * ARC * t * (1 - t) * 0.5 + 0.12, p.from.z + (p.to.z - p.from.z) * t);
      m.rotation.set(t * 14, 0, t * 9);
    }
    for (const [key, m] of this.cans) {
      if (seen.has(key)) continue;
      this.scene.remove(m);
      this.cans.delete(key);
    }
  }

  private syncClouds(list: GasCloud[], tick: number): void {
    const seen = new Set<string>();
    for (const g of list) {
      const key = `${g.owner}:${g.until}`;
      seen.add(key);
      let c = this.clouds.get(key);
      if (!c) {
        const group = new THREE.Group();
        group.position.set(g.x, 0, g.z);
        const puffs: THREE.Mesh[] = [];
        const mat = new THREE.MeshBasicMaterial({ color: 0xcfd3c0, transparent: true, opacity: 0, depthWrite: false });
        for (let i = 0; i < PUFFS; i++) {
          const p = new THREE.Mesh(SMOKE_GEO, mat);
          const a = (i / PUFFS) * Math.PI * 2;
          const r = i === 0 ? 0 : T.gas.radius * (0.35 + (i % 3) * 0.2);
          p.position.set(Math.cos(a) * r, 0.7 + (i % 2) * 0.5, Math.sin(a) * r);
          p.userData.base = p.position.clone();
          p.userData.size = 1.1 + (i % 4) * 0.25;
          group.add(p);
          puffs.push(p);
        }
        this.scene.add(group);
        c = { group, mat, puffs, until: g.until, born: this.time };
        this.clouds.set(key, c);
      }
      const left = (g.until - tick) / 60;
      const grow = Math.min(1, (this.time - c.born) / 0.6);
      const fade = Math.max(0, Math.min(1, left / 1.2));
      c.mat.opacity = 0.38 * grow * fade;
      c.puffs.forEach((p, i) => {
        const base = p.userData.base as THREE.Vector3;
        const sz = (p.userData.size as number) * (0.4 + grow * 0.6);
        p.scale.setScalar(sz * (1 + Math.sin(this.time * 0.8 + i) * 0.08));
        p.position.set(base.x + Math.sin(this.time * 0.4 + i) * 0.25, base.y + Math.sin(this.time * 0.6 + i * 2) * 0.12, base.z + Math.cos(this.time * 0.35 + i) * 0.25);
      });
    }
    for (const [key, c] of this.clouds) {
      if (seen.has(key)) continue;
      this.removeCloud(c);
      this.clouds.delete(key);
    }
  }

  private removeCloud(c: Cloud): void {
    this.scene.remove(c.group);
    c.mat.dispose();
  }

  dispose(): void {
    for (const m of this.cans.values()) {
      this.scene.remove(m);
    }
    for (const c of this.clouds.values()) this.removeCloud(c);
    for (const b of this.blasts) this.scene.remove(b.ball, b.ring);
  }
}
