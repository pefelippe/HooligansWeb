import * as THREE from 'three';

// Efeitos de combate: números de dano que sobem e somem, e faíscas no ponto do acerto.
// Tudo em espaço de mundo (sprites/points), sem passar pelo React.

export interface NumberStyle {
  color: string;
  /** Escala do texto (1 = normal). */
  size: number;
  opacity: number;
}

interface Floater {
  sprite: THREE.Sprite;
  anchor: THREE.Object3D;
  base: THREE.Vector3;
  age: number;
  drift: number;
  size: number;
}

interface Burst {
  points: THREE.Points;
  vel: Float32Array;
  age: number;
}

const NUMBER_LIFE = 0.8;
const BURST_LIFE = 0.35;

function numberTexture(text: string, color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    g.font = '800 44px "Barlow Condensed", Inter, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 7;
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.strokeText(text, 64, 34);
    g.fillStyle = color;
    g.fillText(text, 64, 34);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class CombatFx {
  private readonly floaters: Floater[] = [];
  private readonly bursts: Burst[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  /** Número de dano preso ao boneco (segue o boneco enquanto sobe). */
  number(anchor: THREE.Object3D, text: string, style: NumberStyle): void {
    const mat = new THREE.SpriteMaterial({ map: numberTexture(text, style.color), transparent: true, depthTest: false, opacity: style.opacity });
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 20;
    sprite.scale.set(0.9 * style.size, 0.45 * style.size, 1);
    // Espalha um pouco para números seguidos não ficarem um em cima do outro.
    const drift = (Math.random() - 0.5) * 0.6;
    const base = anchor.getWorldPosition(new THREE.Vector3());
    sprite.position.copy(base).add(new THREE.Vector3(drift, 2.4, 0));
    this.scene.add(sprite);
    this.floaters.push({ sprite, anchor, base, age: 0, drift, size: style.size });
  }

  /** Faíscas saindo do peito do alvo. */
  spark(anchor: THREE.Object3D, color: string, count: number): void {
    const origin = anchor.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1.25, 0));
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos.set([origin.x, origin.y, origin.z], i * 3);
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.9 + 0.2;
      const sp = 3 + Math.random() * 4;
      vel.set([Math.cos(a) * sp, up * sp, Math.sin(a) * sp], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color, size: 0.09, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    this.bursts.push({ points, vel, age: 0 });
  }

  update(dt: number): void {
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i]!;
      f.age += dt;
      const t = f.age / NUMBER_LIFE;
      if (t >= 1) {
        this.removeFloater(i);
        continue;
      }
      // Segue o boneco (se ainda estiver na cena) e sobe desacelerando.
      if (f.anchor.parent) f.anchor.getWorldPosition(f.base);
      const rise = 2.4 + (1 - (1 - t) ** 2) * 0.9;
      f.sprite.position.set(f.base.x + f.drift, f.base.y + rise, f.base.z);
      const mat = f.sprite.material;
      mat.opacity = Math.min(mat.opacity, t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4);
      // "Pop" no começo.
      const pop = t < 0.12 ? 1 + (0.12 - t) * 3 : 1;
      f.sprite.scale.set(0.9 * f.size * pop, 0.45 * f.size * pop, 1);
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]!;
      b.age += dt;
      if (b.age >= BURST_LIFE) {
        this.scene.remove(b.points);
        b.points.geometry.dispose();
        (b.points.material as THREE.Material).dispose();
        this.bursts.splice(i, 1);
        continue;
      }
      const attr = b.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let k = 0; k < arr.length; k += 3) {
        b.vel[k + 1]! -= 18 * dt;
        arr[k]! += b.vel[k]! * dt;
        arr[k + 1]! += b.vel[k + 1]! * dt;
        arr[k + 2]! += b.vel[k + 2]! * dt;
      }
      attr.needsUpdate = true;
      (b.points.material as THREE.PointsMaterial).opacity = 1 - b.age / BURST_LIFE;
    }
  }

  private removeFloater(i: number): void {
    const f = this.floaters[i]!;
    this.scene.remove(f.sprite);
    f.sprite.material.map?.dispose();
    f.sprite.material.dispose();
    this.floaters.splice(i, 1);
  }

  dispose(): void {
    while (this.floaters.length) this.removeFloater(this.floaters.length - 1);
    for (const b of this.bursts) {
      this.scene.remove(b.points);
      b.points.geometry.dispose();
      (b.points.material as THREE.Material).dispose();
    }
    this.bursts.length = 0;
  }
}
