import type { GameMap, MatchSnapshotInfo, TeamSide } from '@torcidas/shared';
import * as THREE from 'three';

// Pontos de controle no mundo: piso tingido pelo dono, anel de progresso da captura,
// letra flutuante e luz. Cores relativas a você: aliado azul, rival vermelho, neutro cinza.

export const POINT_COLORS = { ally: '#4dabf7', enemy: '#ff4d5e', neutral: '#c9ced6' } as const;

type PointInfo = MatchSnapshotInfo['points'][number];

interface PointView {
  floor: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  border: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  progress: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  letter: THREE.Sprite;
  light: THREE.PointLight;
  radius: number;
  /** Progresso desenhado (quantizado), para só refazer a geometria quando muda. */
  drawn: number;
}

function letterSprite(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    g.font = '800 96px "Barlow Condensed", Inter, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 10;
    g.strokeStyle = 'rgba(0,0,0,0.8)';
    g.strokeText(text, 64, 70);
    g.fillStyle = '#ffffff';
    g.fillText(text, 64, 70);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(1.6, 1.6, 1);
  return s;
}

export class ControlPoints {
  private readonly views = new Map<string, PointView>();

  constructor(
    private readonly scene: THREE.Scene,
    map: GameMap,
    private readonly myTeam: TeamSide,
  ) {
    for (const cp of map.controlPoints) {
      const floor = new THREE.Mesh(new THREE.CircleGeometry(cp.radius, 48), new THREE.MeshBasicMaterial({ color: POINT_COLORS.neutral, transparent: true, opacity: 0.16, depthWrite: false }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(cp.pos.x, 0.018, cp.pos.z);
      const border = new THREE.Mesh(new THREE.RingGeometry(cp.radius - 0.25, cp.radius, 64), new THREE.MeshBasicMaterial({ color: POINT_COLORS.neutral, transparent: true, opacity: 0.9 }));
      border.rotation.x = -Math.PI / 2;
      border.position.set(cp.pos.x, 0.022, cp.pos.z);
      const progress = new THREE.Mesh(new THREE.RingGeometry(cp.radius + 0.1, cp.radius + 0.55, 64, 1, 0, 0.0001), new THREE.MeshBasicMaterial({ color: POINT_COLORS.ally, transparent: true, opacity: 0.95, side: THREE.DoubleSide }));
      progress.rotation.x = -Math.PI / 2;
      progress.position.set(cp.pos.x, 0.026, cp.pos.z);
      const letter = letterSprite(cp.id);
      letter.position.set(cp.pos.x, 3.4, cp.pos.z);
      const light = new THREE.PointLight(POINT_COLORS.neutral, 18, cp.radius * 3);
      light.position.set(cp.pos.x, 3, cp.pos.z);
      scene.add(floor, border, progress, letter, light);
      this.views.set(cp.id, { floor, border, progress, letter, light, radius: cp.radius, drawn: 0 });
    }
  }

  colorOf(team: TeamSide | null): string {
    return team === null ? POINT_COLORS.neutral : team === this.myTeam ? POINT_COLORS.ally : POINT_COLORS.enemy;
  }

  update(points: readonly PointInfo[], now: number): void {
    for (const p of points) {
      const v = this.views.get(p.id);
      if (!v) continue;
      const owner = this.colorOf(p.owner);
      v.floor.material.color.set(owner);
      v.border.material.color.set(owner);
      v.light.color.set(owner);
      // Disputado: o piso pisca.
      v.floor.material.opacity = p.contested ? 0.16 + 0.14 * (0.5 + 0.5 * Math.sin(now / 90)) : p.owner === null ? 0.12 : 0.22;
      v.letter.position.y = 3.4 + Math.sin(now / 600) * 0.12;
      // Anel de progresso só enquanto enche/esvazia (cheio e dono = sem anel extra).
      const showing = p.capTeam !== null && p.progress > 0 && !(p.owner === p.capTeam && p.progress >= 1);
      const q = showing ? Math.round(p.progress * 64) / 64 : 0;
      v.progress.visible = q > 0;
      if (q > 0) v.progress.material.color.set(this.colorOf(p.capTeam));
      if (q !== v.drawn && q > 0) {
        v.progress.geometry.dispose();
        v.progress.geometry = new THREE.RingGeometry(v.radius + 0.1, v.radius + 0.55, 64, 1, Math.PI / 2, -Math.PI * 2 * q);
      }
      v.drawn = q;
    }
  }

  dispose(): void {
    for (const v of this.views.values()) {
      this.scene.remove(v.floor, v.border, v.progress, v.letter, v.light);
      v.floor.geometry.dispose();
      v.floor.material.dispose();
      v.border.geometry.dispose();
      v.border.material.dispose();
      v.progress.geometry.dispose();
      v.progress.material.dispose();
      v.letter.material.map?.dispose();
      v.letter.material.dispose();
    }
    this.views.clear();
  }
}
