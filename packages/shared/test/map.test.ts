import { describe, expect, it } from 'vitest';
import { createSim, type Box, GALPAO, generateMap, MAP_SIZES, mapSizeFor, MATCH_SIZES, inRect, resolveCircleCollision, segmentBoxHit, simSedes, spawnPoint, type Vec2 } from '../src';

const SEEDS = [1, 42, 1234, 99991, 2 ** 30];
const insideBox = (p: Vec2, b: Box, pad = 0) => Math.abs(p.x - b.x) < b.hw + pad && Math.abs(p.z - b.z) < b.hd + pad;

describe('galpões', () => {
  it('nenhum obstáculo solto dentro do galpão', () => {
    for (const seed of SEEDS) {
      const map = generateMap(seed);
      for (const sd of map.sedes) {
        const a = sd.area;
        const intruders = map.boxes.filter(
          (b) => b.kind !== 'galpao' && b.kind !== 'barraca' && b.kind !== 'movel' && Math.abs(b.x - a.x) < a.hw + b.hw && Math.abs(b.z - a.z) < a.hd + b.hd,
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

describe('mapa menor (150 × 80 m)', () => {
  /** Grade de 0,5 m: uma célula é andável se um lutador (r = 0,4) parado nela não é empurrado. */
  function reachable(map: ReturnType<typeof generateMap>, from: Vec2): (p: Vec2) => boolean {
    const cell = 0.5;
    const nx = Math.floor((map.halfW * 2) / cell);
    const nz = Math.floor((map.halfD * 2) / cell);
    const idx = (p: Vec2) => Math.floor((p.x + map.halfW) / cell) + Math.floor((p.z + map.halfD) / cell) * nx;
    const free = (i: number) => {
      const p = { x: (i % nx) * cell - map.halfW + cell / 2, z: Math.floor(i / nx) * cell - map.halfD + cell / 2 };
      const q = { ...p };
      resolveCircleCollision(q, 0.4, map);
      return Math.hypot(q.x - p.x, q.z - p.z) < 1e-6;
    };
    const seen = new Uint8Array(nx * nz);
    const queue = [idx(from)];
    seen[queue[0]!] = 1;
    while (queue.length) {
      const i = queue.pop()!;
      const x = i % nx;
      for (const j of [x > 0 ? i - 1 : -1, x < nx - 1 ? i + 1 : -1, i - nx, i + nx]) {
        if (j < 0 || j >= nx * nz || seen[j] || !free(j)) continue;
        seen[j] = 1;
        queue.push(j);
      }
    }
    return (p) => seen[idx(p)] === 1;
  }

  it('do spawn de cada time dá para chegar a A, B, C e ao galpão rival', () => {
    for (const seed of SEEDS.slice(0, 3)) {
      const map = generateMap(seed);
      for (const sd of map.sedes) {
        const ok = reachable(map, sd.spawn);
        for (const cp of map.controlPoints) expect(ok(cp.pos)).toBe(true);
        for (const other of map.sedes) expect(ok(other.spawn)).toBe(true);
      }
    }
  });

  it('pequeno e grande: do spawn dá para chegar às praças e ao galpão rival', () => {
    for (const size of ['pequeno', 'grande'] as const) {
      const map = generateMap(7, size);
      for (const sd of map.sedes) {
        const ok = reachable(map, sd.spawn);
        for (const cp of map.controlPoints) expect(ok(cp.pos)).toBe(true);
        for (const other of map.sedes) expect(ok(other.spawn)).toBe(true);
      }
    }
  });

  it('nenhum obstáculo fora dos limites e as três zonas são diferentes', () => {
    const map = generateMap(42);
    for (const b of map.boxes) if (b.kind !== 'grade' && b.kind !== 'muro') {
      expect(Math.abs(b.x) + b.hw).toBeLessThanOrEqual(map.halfW);
      expect(Math.abs(b.z) + b.hd).toBeLessThanOrEqual(map.halfD);
    }
    const around = (x: number, kind: string) => map.boxes.filter((b) => b.kind === kind && Math.abs(b.x - x) < 14).length;
    expect(around(-28, 'carro')).toBeGreaterThan(10);
    expect(around(28, 'barraca')).toBeGreaterThan(10);
    expect(around(0, 'carro') + around(0, 'barraca')).toBeLessThan(around(-28, 'carro'));
  });
});

describe('mapas por tamanho de sala (1×1 e 5×5 pequeno, 10×10 médio, 20×20 grande)', () => {
  it('cada tamanho de sala escolhe o mapa', () => {
    expect(MATCH_SIZES.map(mapSizeFor)).toEqual(['pequeno', 'pequeno', 'medio', 'grande']);
  });

  for (const size of ['pequeno', 'grande'] as const) {
    it(`${size}: tudo dentro dos limites, spawn/portões/praças livres e corredores sem obstáculo`, () => {
      for (const seed of [1, 2, 3]) {
        const map = generateMap(seed, size);
        expect(map.halfW).toBe(MAP_SIZES[size].halfW);
        for (const b of map.boxes) if (b.kind !== 'grade' && b.kind !== 'muro') {
          expect(Math.abs(b.x) + b.hw).toBeLessThanOrEqual(map.halfW);
          expect(Math.abs(b.z) + b.hd).toBeLessThanOrEqual(map.halfD);
        }
        const pts = [...map.sedes.flatMap((sd) => [sd.spawn, sd.flag, ...sd.doors.flatMap((d) => [d.outside, d.inside])]), ...map.controlPoints.map((c) => c.pos)];
        for (const pt of pts) {
          const p = { ...pt };
          resolveCircleCollision(p, 0.35, map);
          expect(p).toEqual(pt);
        }
        // Corredor dos bots: de uma ponta à outra das fileiras sem bater em caixa.
        const end = map.halfW - 30;
        for (const z of map.lanes) expect(segmentBoxHit(map.boxes, { x: -end, y: 1, z }, { x: end, y: 1, z })).toBe(1);
      }
    });
  }

  it('pequeno também tem 3 praças, longe do portão dos galpões; grande tem mais fileiras de carro que o médio', () => {
    const small = generateMap(1, 'pequeno');
    expect(small.controlPoints.map((c) => c.id)).toEqual(['A', 'B', 'C']);
    const front = small.halfW - GALPAO.hw - 3 - GALPAO.hw;
    for (const cp of small.controlPoints) expect(Math.abs(cp.pos.x) + cp.radius).toBeLessThan(front - 2);
    const cars = (size: 'medio' | 'grande') => generateMap(1, size).boxes.filter((b) => b.kind === 'carro').length;
    expect(cars('grande')).toBeGreaterThan(cars('medio') * 1.5);
  });
});
