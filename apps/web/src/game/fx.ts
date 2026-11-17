import * as THREE from 'three';

// Efeitos de combate: números de dano, faíscas, onomatopeias de HQ ("POW!") e fogos de artifício.
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
  life: number;
  gravity: number;
  /** Fração da velocidade que sobra por segundo (1 = sem arrasto). */
  drag: number;
}

interface Comic {
  sprite: THREE.Sprite;
  age: number;
  size: number;
}

interface Rocket {
  points: THREE.Points;
  from: THREE.Vector3;
  to: THREE.Vector3;
  age: number;
  delay: number;
  color: string;
  onBurst?: () => void;
}

const NUMBER_LIFE = 0.8;
const BURST_LIFE = 0.35;
const COMIC_LIFE = 0.6;
const ROCKET_TIME = 0.8;
const FIREWORK_LIFE = 1.8;

export type ComicStyle = 'hit' | 'heavy' | 'ko' | 'block' | 'boom';
/** Cores da explosão de HQ: [miolo, raios, texto]. */
const COMIC_COLORS: Record<ComicStyle, [string, string, string]> = {
  hit: ['#ffe14d', '#ff9d1c', '#ffffff'],
  heavy: ['#ff9d1c', '#ff3b3b', '#ffe14d'],
  ko: ['#ff3b3b', '#7a0d1a', '#ffe14d'],
  block: ['#bfe3ff', '#4d8fd6', '#ffffff'],
  boom: ['#ffb020', '#ff3b1f', '#fff3b0'],
};

const comicCache = new Map<string, THREE.CanvasTexture>();

/** Explosão de quadrinho: estrela de pontas irregulares, retícula de pontos e a palavra torta por cima. */
function comicTexture(word: string, style: ComicStyle): THREE.CanvasTexture {
  const key = `${style}|${word}`;
  const cached = comicCache.get(key);
  if (cached) return cached;
  const [core, rim, ink] = COMIC_COLORS[style];
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 192;
  const g = c.getContext('2d');
  if (g) {
    const cx = 128;
    const cy = 96;
    const spikes = 13;
    g.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const a = (i / (spikes * 2)) * Math.PI * 2;
      // Pontas de tamanhos diferentes, determinísticas pelo índice (a mesma palavra sai sempre igual).
      const r = i % 2 === 0 ? 70 + ((i * 37) % 19) : 44 + ((i * 11) % 9);
      g.lineTo(cx + Math.cos(a) * r * 1.4, cy + Math.sin(a) * r);
    }
    g.closePath();
    g.fillStyle = rim;
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = '#111';
    g.stroke();
    // Miolo com retícula (pontinhos de HQ).
    g.save();
    g.clip();
    const grad = g.createRadialGradient(cx, cy, 10, cx, cy, 110);
    grad.addColorStop(0, core);
    grad.addColorStop(0.7, core);
    grad.addColorStop(1, rim);
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 192);
    g.fillStyle = 'rgba(0,0,0,0.16)';
    for (let y = 4; y < 192; y += 9) for (let x = (y / 9) % 2 ? 4 : 8.5; x < 256; x += 9) g.fillRect(x, y, 3, 3);
    g.restore();
    // Palavra inclinada, contorno grosso preto e sombra deslocada.
    g.save();
    g.translate(cx, cy + 4);
    g.rotate(-0.12);
    const size = word.length > 5 ? 54 : 66;
    g.font = `800 ${size}px "Barlow Condensed", Impact, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = 12;
    g.strokeStyle = '#111';
    g.fillStyle = '#111';
    g.strokeText(word, 4, 5);
    g.fillText(word, 4, 5);
    g.strokeText(word, 0, 0);
    g.fillStyle = ink;
    g.fillText(word, 0, 0);
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  comicCache.set(key, tex);
  return tex;
}

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
  private readonly comics: Comic[] = [];
  private readonly rockets: Rocket[] = [];

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
    this.bursts.push({ points, vel, age: 0, life: BURST_LIFE, gravity: 18, drag: 1 });
  }

  /** Onomatopeia de HQ ("POW!") no ponto, com estalo de escala. */
  comic(pos: THREE.Vector3, word: string, style: ComicStyle, size = 1): void {
    const mat = new THREE.SpriteMaterial({ map: comicTexture(word, style), transparent: true, depthTest: false, rotation: (Math.random() - 0.5) * 0.35 });
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 21;
    sprite.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 0, (Math.random() - 0.5) * 0.4));
    sprite.scale.set(0.01, 0.01, 1);
    this.scene.add(sprite);
    this.comics.push({ sprite, age: 0, size });
  }

  /** Fogos: um rojão sobe de `from` até `to` (depois de `delay` s) e estoura em faíscas coloridas. */
  firework(from: THREE.Vector3, to: THREE.Vector3, color: string, delay = 0, onBurst?: () => void): void {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([from.x, from.y, from.z]), 3));
    const mat = new THREE.PointsMaterial({ color: '#fff3c4', size: 0.8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const points = new THREE.Points(geo, mat);
    points.visible = false;
    this.scene.add(points);
    this.rockets.push({ points, from: from.clone(), to: to.clone(), age: 0, delay, color, ...(onBurst ? { onBurst } : {}) });
  }

  private explodeFirework(at: THREE.Vector3, color: string): void {
    const count = 110;
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos.set([at.x, at.y, at.z], i * 3);
      // Esfera: direção uniforme, velocidade quase igual (anel nítido).
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const sp = 11 + Math.random() * 2.5;
      vel.set([r * Math.cos(th) * sp, u * sp, r * Math.sin(th) * sp], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color, size: 0.9, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    this.bursts.push({ points, vel, age: 0, life: FIREWORK_LIFE, gravity: 4, drag: 0.25 });
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
    for (let i = this.comics.length - 1; i >= 0; i--) {
      const c = this.comics[i]!;
      c.age += dt;
      const t = c.age / COMIC_LIFE;
      if (t >= 1) {
        this.scene.remove(c.sprite);
        c.sprite.material.dispose(); // a textura fica no cache
        this.comics.splice(i, 1);
        continue;
      }
      // Estala grande (passa do tamanho), assenta e some no fim.
      const k = t < 0.12 ? (t / 0.12) * 1.35 : t < 0.22 ? 1.35 - ((t - 0.12) / 0.1) * 0.35 : 1;
      c.sprite.scale.set(1.6 * c.size * k, 1.2 * c.size * k, 1);
      c.sprite.material.opacity = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
    }
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i]!;
      r.age += dt;
      const t = (r.age - r.delay) / ROCKET_TIME;
      if (t < 0) continue;
      r.points.visible = true;
      if (t >= 1) {
        this.explodeFirework(r.to, r.color);
        r.onBurst?.();
        this.disposePoints(r.points);
        this.rockets.splice(i, 1);
        continue;
      }
      // Sobe desacelerando, com um leve zigue-zague.
      const e = 1 - (1 - t) ** 2;
      const attr = r.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      arr[0] = r.from.x + (r.to.x - r.from.x) * e + Math.sin(t * 9) * 0.15;
      arr[1] = r.from.y + (r.to.y - r.from.y) * e;
      arr[2] = r.from.z + (r.to.z - r.from.z) * e;
      attr.needsUpdate = true;
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]!;
      b.age += dt;
      if (b.age >= b.life) {
        this.scene.remove(b.points);
        b.points.geometry.dispose();
        (b.points.material as THREE.Material).dispose();
        this.bursts.splice(i, 1);
        continue;
      }
      const attr = b.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      const keep = b.drag === 1 ? 1 : b.drag ** dt;
      for (let k = 0; k < arr.length; k += 3) {
        if (keep !== 1) {
          b.vel[k]! *= keep;
          b.vel[k + 1]! *= keep;
          b.vel[k + 2]! *= keep;
        }
        b.vel[k + 1]! -= b.gravity * dt;
        arr[k]! += b.vel[k]! * dt;
        arr[k + 1]! += b.vel[k + 1]! * dt;
        arr[k + 2]! += b.vel[k + 2]! * dt;
      }
      attr.needsUpdate = true;
      // Fogos cintilam antes de apagar.
      const fade = 1 - b.age / b.life;
      (b.points.material as THREE.PointsMaterial).opacity = b.life > 1 && fade < 0.4 ? fade * (0.6 + 0.4 * Math.sin(b.age * 60)) : fade;
    }
  }

  private disposePoints(p: THREE.Points): void {
    this.scene.remove(p);
    p.geometry.dispose();
    (p.material as THREE.Material).dispose();
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
    for (const c of this.comics) {
      this.scene.remove(c.sprite);
      c.sprite.material.dispose();
    }
    this.comics.length = 0;
    for (const r of this.rockets) this.disposePoints(r.points);
    this.rockets.length = 0;
  }
}
