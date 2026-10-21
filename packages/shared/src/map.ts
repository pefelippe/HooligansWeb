import type { Vec2 } from './combat/types';
import { nextRandom } from './rng';

// Mapa: estacionamento do estádio, com a sede (galpão) de cada torcida nas pontas.
// Gerado por seed: cliente e servidor montam o mesmo layout e a mesma colisão.
//
//   z = +45  ████████ grade ███████  ESTÁDIO  ███████ grade ████████
//            carros carros carros  ▓▓▓▓▓▓▓▓▓▓▓▓  carros carros carros
//   ┌──────┐ carros   carros   carros   carros   carros   carros ┌──────┐
//   │GALPÃO│====(A)======== avenida central ====(B)=====(C)=====│GALPÃO│
//   └──────┘ carros   carros   carros   carros   carros   carros └──────┘
//   z = -45  ─────────────────────── grade / avenida ───────────────────
//          x = -100                                            x = +100
// A, B e C são os pontos de controle (praças livres na avenida).

/** Caixa alinhada aos eixos: centro e meias-medidas (m). */
export interface Box {
  x: number;
  z: number;
  hw: number;
  hd: number;
  /** Altura, só para renderização. */
  h: number;
  kind: 'carro' | 'onibus' | 'barraca' | 'muro' | 'grade' | 'estadio' | 'carrinho' | 'galpao';
  /** Cor (hex), só para renderização. */
  color: string;
  /** Galpão: de qual time é a parede. */
  team?: 0 | 1;
}

export interface Circle {
  x: number;
  z: number;
  r: number;
  kind: 'poste' | 'lixeira';
}

export interface Rect {
  x: number;
  z: number;
  hw: number;
  hd: number;
}

/** Sede = galpão entrável. */
export interface SedeDef {
  team: 0 | 1;
  /** Ponto de spawn (fundo do galpão). */
  spawn: Vec2;
  /** Onde fica o bandeirão. */
  flag: Vec2;
  /** Interior do galpão (zona da sede: loja, cura, captura). */
  area: Rect;
  /** Pontos logo fora e logo dentro de cada portão (navegação dos bots). */
  doors: { outside: Vec2; inside: Vec2 }[];
}

/** Ponto de controle: praça circular livre na avenida. */
export interface ControlPointDef {
  id: 'A' | 'B' | 'C';
  pos: Vec2;
  radius: number;
}

export interface GameMap {
  seed: number;
  halfW: number;
  halfD: number;
  boxes: Box[];
  circles: Circle[];
  sedes: [SedeDef, SedeDef];
  controlPoints: ControlPointDef[];
  /** Vagas pintadas no chão (só renderização). */
  spots: Vec2[];
}

const CAR_COLORS = ['#c0c4cc', '#1d1f24', '#f2f2f2', '#8b1e2d', '#1f3f7a', '#5d6670', '#a8742a', '#2e5e3e', '#d9cfb6'];
const TEAM_COLORS: [string, string][] = [
  ['#151515', '#f5f5f5'],
  ['#0033a0', '#e30613'],
];

export const MAP_HALF_W = 100;
export const MAP_HALF_D = 45;
/** Raio da praça de um ponto de controle (m). */
export const CONTROL_POINT_RADIUS = 6;

/** Galpão: 24 m (x) × 20 m (z), portão grande virado para o centro e um portão em cada lateral. */
export const GALPAO = { hw: 12, hd: 10, wall: 0.3, height: 6, frontDoor: 7, sideDoor: 4 };

function galpao(team: 0 | 1, boxes: Box[]): SedeDef {
  const side = team === 0 ? -1 : 1;
  const cx = side * (MAP_HALF_W - GALPAO.hw - 3); // ±85
  const cz = 0;
  const { hw, hd, wall: t, height: h } = GALPAO;
  const [wallColor] = TEAM_COLORS[team] ?? ['#777', '#999'];
  const add = (x: number, z: number, bhw: number, bhd: number) => boxes.push({ x, z, hw: bhw, hd: bhd, h, kind: 'galpao', color: wallColor, team });
  const front = cx - side * hw; // parede virada para o centro do mapa
  const back = cx + side * hw;
  // Fundo inteiro.
  add(back, cz, t, hd + t);
  // Frente com portão central.
  const fd = GALPAO.frontDoor / 2;
  const seg = (hd - fd) / 2;
  add(front, cz + fd + seg, t, seg);
  add(front, cz - fd - seg, t, seg);
  // Laterais com portão no meio.
  const sd = GALPAO.sideDoor / 2;
  const sseg = (hw - sd) / 2;
  for (const z of [cz - hd, cz + hd]) {
    add(cx - sd - sseg, z, sseg, t);
    add(cx + sd + sseg, z, sseg, t);
  }
  // Balcão da loja (barraca) encostado no fundo, de lado.
  boxes.push({ x: back - side * 1.6, z: cz + hd - 2.2, hw: 1.2, hd: 1.6, h: 1.1, kind: 'barraca', color: TEAM_COLORS[team]?.[1] ?? '#ccc', team });
  return {
    team,
    // Spawn entre o centro e o fundo: a câmera (atrás do jogador, olhando para o portão) cabe lá dentro.
    spawn: { x: cx + side * 4, z: cz },
    flag: { x: cx - side * 1, z: cz },
    area: { x: cx, z: cz, hw: hw - t, hd: hd - t },
    doors: [
      { outside: { x: front - side * 2, z: cz }, inside: { x: front + side * 2, z: cz } },
      { outside: { x: cx, z: cz - hd - 2 }, inside: { x: cx, z: cz - hd + 2 } },
      { outside: { x: cx, z: cz + hd + 2 }, inside: { x: cx, z: cz + hd - 2 } },
    ],
  };
}

export function generateMap(seed: number): GameMap {
  const rng = { seed };
  const rand = () => nextRandom(rng);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  const boxes: Box[] = [];
  const circles: Circle[] = [];
  const spots: Vec2[] = [];
  const W = MAP_HALF_W;
  const D = MAP_HALF_D;

  // Limites: grade ao norte e ao sul, muros nas laterais. Estádio no meio do lado norte.
  boxes.push({ x: 0, z: D + 0.5, hw: W + 1, hd: 0.5, h: 2.2, kind: 'grade', color: '#5a6068' });
  boxes.push({ x: 0, z: -D - 0.5, hw: W + 1, hd: 0.5, h: 2.2, kind: 'grade', color: '#5a6068' });
  boxes.push({ x: -W - 0.5, z: 0, hw: 0.5, hd: D + 1, h: 2.5, kind: 'muro', color: '#7b7f86' });
  boxes.push({ x: W + 0.5, z: 0, hw: 0.5, hd: D + 1, h: 2.5, kind: 'muro', color: '#7b7f86' });
  boxes.push({ x: 0, z: D - 7, hw: 26, hd: 7, h: 20, kind: 'estadio', color: '#8f969e' });

  const sedes: [SedeDef, SedeDef] = [galpao(0, boxes), galpao(1, boxes)];
  // Pontos de controle: um perto de cada sede e um no meio, todos na avenida.
  const controlPoints: ControlPointDef[] = [
    { id: 'A', pos: { x: -W / 2, z: 0 }, radius: CONTROL_POINT_RADIUS },
    { id: 'B', pos: { x: 0, z: 0 }, radius: CONTROL_POINT_RADIUS },
    { id: 'C', pos: { x: W / 2, z: 0 }, radius: CONTROL_POINT_RADIUS },
  ];
  /** Nada de obstáculo solto dentro das praças (com folga). */
  const inPlaza = (x: number, z: number, pad = 1.5) => controlPoints.some((cp) => Math.hypot(x - cp.pos.x, z - cp.pos.z) < cp.radius + pad);
  /** Fim das fileiras de carros: antes da frente dos galpões. */
  const rowEnd = W - 26;

  // Fileiras de carros (comprimento no eixo Z), com vagas vazias que viram passagens.
  // Avenida central em z ∈ [-6, 6]; ruas entre as quadras.
  const rows = [-37, -30, -20, -13, 13, 20];
  const CAR_HW = 0.95;
  const CAR_HD = 2.2;
  const addRow = (z: number, x0: number, x1: number) => {
    for (let x = x0; x <= x1; x += 2.7) {
      spots.push({ x, z });
      if (rand() < 0.3) continue;
      boxes.push({ x: x + (rand() - 0.5) * 0.3, z: z + (rand() - 0.5) * 0.4, hw: CAR_HW, hd: CAR_HD, h: 1.45, kind: 'carro', color: pick(CAR_COLORS) });
    }
  };
  for (const z of rows) {
    // Ruas transversais em x ≈ ±16 e x = 0 (cortes nas fileiras).
    addRow(z, -rowEnd, -19);
    addRow(z, -13, -3);
    addRow(z, 3, 13);
    addRow(z, 19, rowEnd);
  }
  // Fileiras ao lado do estádio.
  for (const z of [30, 37]) {
    addRow(z, -rowEnd, -30);
    addRow(z, 30, rowEnd);
  }

  // Ônibus das torcidas do lado de fora de cada galpão.
  const busX = W - 18;
  boxes.push({ x: -busX, z: 20, hw: 1.3, hd: 6, h: 3.4, kind: 'onibus', color: '#f5f5f5' });
  boxes.push({ x: busX, z: 20, hw: 1.3, hd: 6, h: 3.4, kind: 'onibus', color: '#0033a0' });
  boxes.push({ x: -busX, z: -22, hw: 1.3, hd: 6, h: 3.4, kind: 'onibus', color: '#222222' });
  boxes.push({ x: busX, z: -22, hw: 1.3, hd: 6, h: 3.4, kind: 'onibus', color: '#e30613' });

  // Avenida central: postes a cada 12 m (fora das praças) e carrinhos de churrasquinho (cura disputada).
  for (let x = -(rowEnd - 8); x <= rowEnd - 8; x += 12) if (!inPlaza(x, 0)) circles.push({ x, z: 0, r: 0.25, kind: 'poste' });
  for (const x of [-60, -45, -30, -16, 0, 16, 30, 45, 60]) {
    for (const z of [-25, 25]) if (Math.abs(x) > 26 || z < 0) circles.push({ x, z, r: 0.25, kind: 'poste' });
  }
  for (const [x, z] of [
    [-25, 3.4],
    [25, -3.4],
    [0, -25],
    [-W / 2, -25],
    [W / 2, -25],
  ] as const) {
    boxes.push({ x: x + (rand() - 0.5) * 3, z, hw: 0.7, hd: 1.1, h: 1.3, kind: 'carrinho', color: '#c9822b' });
  }
  for (let i = 0; i < 18; i++) {
    const x = (rand() - 0.5) * 2 * (rowEnd - 2);
    const z = pick([-41, 41, -8, 8, -25, 25]);
    if (!inPlaza(x, z)) circles.push({ x, z, r: 0.45, kind: 'lixeira' });
  }

  return { seed, halfW: W, halfD: D, boxes, circles, sedes, controlPoints, spots };
}

export function inRect(p: Vec2, r: Rect): boolean {
  return Math.abs(p.x - r.x) <= r.hw && Math.abs(p.z - r.z) <= r.hd;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Fração [0, 1] do segmento a→b até o primeiro obstáculo (caixas do chão até `h`); 1 = livre.
 * Usado pela câmera para não atravessar paredes.
 */
export function segmentBoxHit(boxes: readonly Box[], a: Vec3, b: Vec3): number {
  const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  let best = 1;
  for (const box of boxes) {
    let t0 = 0;
    let t1 = best;
    const slabs: [number, number, number, number][] = [
      [a.x, d.x, box.x - box.hw, box.x + box.hw],
      [a.y, d.y, 0, box.h],
      [a.z, d.z, box.z - box.hd, box.z + box.hd],
    ];
    let hit = true;
    for (const [o, dir, lo, hi] of slabs) {
      if (Math.abs(dir) < 1e-9) {
        if (o < lo || o > hi) {
          hit = false;
          break;
        }
        continue;
      }
      let ta = (lo - o) / dir;
      let tb = (hi - o) / dir;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) {
        hit = false;
        break;
      }
    }
    if (hit) best = Math.min(best, t0);
  }
  return best;
}

/** Empurra um círculo (lutador) para fora dos obstáculos. Determinístico. */
export function resolveCircleCollision(pos: Vec2, radius: number, map: Pick<GameMap, 'boxes' | 'circles' | 'halfW' | 'halfD'>): void {
  for (const b of map.boxes) {
    // Descarte rápido: longe da caixa.
    if (Math.abs(pos.x - b.x) > b.hw + radius || Math.abs(pos.z - b.z) > b.hd + radius) continue;
    const cx = Math.max(b.x - b.hw, Math.min(b.x + b.hw, pos.x));
    const cz = Math.max(b.z - b.hd, Math.min(b.z + b.hd, pos.z));
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    if (d2 > 1e-12) {
      const d = Math.sqrt(d2);
      pos.x = cx + (dx / d) * radius;
      pos.z = cz + (dz / d) * radius;
    } else {
      // Centro dentro da caixa: sai pelo lado mais próximo.
      const pushes = [
        { ax: 'x' as const, v: b.x - b.hw - radius, dist: pos.x - (b.x - b.hw) },
        { ax: 'x' as const, v: b.x + b.hw + radius, dist: b.x + b.hw - pos.x },
        { ax: 'z' as const, v: b.z - b.hd - radius, dist: pos.z - (b.z - b.hd) },
        { ax: 'z' as const, v: b.z + b.hd + radius, dist: b.z + b.hd - pos.z },
      ].sort((p, q) => p.dist - q.dist);
      const p = pushes[0];
      if (p) pos[p.ax] = p.v;
    }
  }
  for (const c of map.circles) {
    const dx = pos.x - c.x;
    const dz = pos.z - c.z;
    const min = radius + c.r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min) continue;
    const d = Math.sqrt(d2) || 1e-6;
    pos.x = c.x + (dx / d) * min;
    pos.z = c.z + (dz / d) * min;
  }
  pos.x = Math.max(-map.halfW + radius, Math.min(map.halfW - radius, pos.x));
  pos.z = Math.max(-map.halfD + radius, Math.min(map.halfD - radius, pos.z));
}
