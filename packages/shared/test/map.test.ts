import { describe, expect, it } from 'vitest';
import { createSim, type Box, generateMap, inRect, resolveCircleCollision, segmentBoxHit, simSedes, spawnPoint, type Vec2 } from '../src';

const SEEDS = [1, 42, 1234, 99991, 2 ** 30];
const insideBox = (p: Vec2, b: Box, pad = 0) => Math.abs(p.x - b.x) < b.hw + pad && Math.abs(p.z - b.z) < b.hd + pad;

describe('galpões', () => {
  it('nenhum obstáculo solto dentro do galpão', () => {
    for (const seed of SEEDS) {
      const map = generateMap(seed);
      for (const sd of map.sedes) {
        const a = sd.area;
        const intruders = map.boxes.filter(
          (b) => b.kind !== 'galpao' && b.kind !== 'barraca' && Math.abs(b.x - a.x) < a.hw + b.hw && Math.abs(b.z - a.z) < a.hd + b.hd,
        );
        expect(intruders).toEqual([]);
      }
    }
  });

  it('portões livres por dentro e por fora', () => {
    for (const seed of SEEDS) {
      const map = generateMap(seed);
      for (const sd of map.sedes) {
        for (const door of sd.doors) {
          for (const p of [door.inside, door.outside]) expect(map.boxes.some((b) => insideBox(p, b, 0.4))).toBe(false);
        }
      }
    }
  });

  it('25 spawns por time dentro da sede, sem obstáculo e sem um em cima do outro', () => {
    const map = generateMap(7);
    const s = createSim([], { sedes: simSedes(map) });
    for (const team of [0, 1] as const) {
      const pts = Array.from({ length: 25 }, (_, i) => spawnPoint(s, team, i));
      for (const p of pts) {
        expect(inRect(p, map.sedes[team].area)).toBe(true);
        const moved = { ...p };
        resolveCircleCollision(moved, 0.4, map);
        expect(Math.hypot(moved.x - p.x, moved.z - p.z)).toBeLessThan(1e-6);
      }
      for (let i = 0; i < pts.length; i++)
        for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.z - pts[j]!.z)).toBeGreaterThan(1);
    }
  });
});

describe('pontos de controle', () => {
  it('três praças na avenida (perto de cada sede e no meio), livres de obstáculo', () => {
    for (const seed of SEEDS) {
      const map = generateMap(seed);
      expect(map.controlPoints.map((cp) => cp.id)).toEqual(['A', 'B', 'C']);
      const [a, b, c] = map.controlPoints;
      expect(a!.pos.x).toBeLessThan(b!.pos.x);
      expect(b!.pos.x).toBeLessThan(c!.pos.x);
      // A fica do lado da sede 0 (oeste), C do lado da sede 1.
      expect(Math.sign(a!.pos.x)).toBe(Math.sign(map.sedes[0].spawn.x));
      for (const cp of map.controlPoints) {
        const near = (x: number, z: number, r: number) => Math.hypot(x - cp.pos.x, z - cp.pos.z) < cp.radius + r;
        expect(map.boxes.filter((bx) => near(Math.max(bx.x - bx.hw, Math.min(cp.pos.x, bx.x + bx.hw)), Math.max(bx.z - bx.hd, Math.min(cp.pos.z, bx.z + bx.hd)), 0))).toEqual([]);
        expect(map.circles.filter((ci) => near(ci.x, ci.z, ci.r))).toEqual([]);
      }
    }
  });
});

describe('segmentBoxHit (câmera)', () => {
  const wall: Box = { x: 5, z: 0, hw: 0.5, hd: 5, h: 3, kind: 'muro', color: '#000' };

  it('para antes da parede', () => {
    const t = segmentBoxHit([wall], { x: 0, y: 1.5, z: 0 }, { x: 10, y: 1.5, z: 0 });
    expect(t).toBeCloseTo(0.45, 5);
  });

  it('livre quando passa por cima ou ao lado', () => {
    expect(segmentBoxHit([wall], { x: 0, y: 4, z: 0 }, { x: 10, y: 4, z: 0 })).toBe(1);
    expect(segmentBoxHit([wall], { x: 0, y: 1, z: 8 }, { x: 10, y: 1, z: 8 })).toBe(1);
    expect(segmentBoxHit([wall], { x: 0, y: 1, z: 0 }, { x: 3, y: 1, z: 0 })).toBe(1);
  });

  it('câmera no spawn não fica atrás da parede do fundo', () => {
    const map = generateMap(3);
    for (const sd of map.sedes) {
      // Câmera a 4,4 m atrás do jogador, olhando para o portão (centro do mapa).
      const back = Math.sign(sd.spawn.x);
      const t = segmentBoxHit(map.boxes, { x: sd.spawn.x, y: 1.65, z: sd.spawn.z }, { x: sd.spawn.x + back * 4.4, y: 2.7, z: sd.spawn.z });
      expect(t).toBe(1);
    }
  });
});
