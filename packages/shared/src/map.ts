import type { TraverseKind } from './combat/fsm';
import type { TeamSide, TraverseConstants, Vec2, Vec3 } from './combat/types';
import { nextRandom } from './rng';

// Mapa: estacionamento do Castelão (o estádio fica ao norte, atrás da grade, só de cenário),
// com a sede (galpão) de cada torcida nas pontas. Gerado por seed: cliente e servidor montam
// o mesmo layout e a mesma colisão. 150 × 80 m, para 10 contra 10 se encontrarem rápido.
//
//   z = +40  ██████████████████ grade (Castelão atrás) ████████████████████
//            carros carros      bilheteria          barracas barracas
//   ─ ─ ─ ─ ─ ─ ─ ─ corredor z=22 ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
//   ┌──────┐ carros carros      grades              barracas barracas ┌──────┐
//   │GALPÃO│=======(A)==========(B)==========(C)=======================│GALPÃO│
//   └──────┘ carros carros      grades              barracas barracas └──────┘
//   ─ ─ ─ ─ ─ ─ ─ ─ corredor z=-22 ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
//   z = -40  carros carros carros carros carros carros carros carros
//          x = -75                                                 x = +75
// A: estacionamento (carros, cobertura baixa). B: esplanada (aberta). C: barracas (apertado, cheio de quinas).

/** Caixa alinhada aos eixos: centro e meias-medidas (m). */
export interface Box {
  x: number;
  z: number;
  hw: number;
  hd: number;
  /** Altura, só para renderização. */
  h: number;
  kind: 'carro' | 'onibus' | 'barraca' | 'muro' | 'grade' | 'estadio' | 'galpao' | 'movel' | 'quiosque' | 'barreira';
  /** Só colide (o cliente desenha a peça de outro jeito, ex.: as fatias do estádio oval). */
  hidden?: boolean;
  /** Móvel da sede: qual peça (o cliente desenha; aqui só colide). */
  movel?: 'sofa' | 'mesa' | 'engradados';
  /** Cor (hex), só para renderização. */
  color: string;
  /** Galpão: de qual time é a parede. */
  team?: TeamSide;
}

export interface Circle {
  x: number;
  z: number;
  r: number;
  kind: 'poste' | 'lixeira' | 'coqueiro';
}

export interface Rect {
  x: number;
  z: number;
  hw: number;
  hd: number;
}

/** Sede = galpão entrável. */
export interface SedeDef {
  team: TeamSide;
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

export const MAP_HALF_W = 75;
export const MAP_HALF_D = 40;
/** Castelão: oval ao norte, fora da área jogável (só cenário). */
export const STADIUM = { x: 0, z: 66, rx: 58, rz: 20, h: 24 };
/** Corredores leste-oeste livres de obstáculo: os bots usam para atravessar o mapa. */
export const LANES = [-22, 0, 22] as const;
/** Mapas conhecidos. Por enquanto só o estacionamento; o estádio por dentro vem depois. */
export type MapId = 'estacionamento';
/** Raio da praça de um ponto de controle (m). */
export const CONTROL_POINT_RADIUS = 6;

/** Galpão: 24 m (x) × 20 m (z), portão grande virado para o centro e um portão em cada lateral. */
export const GALPAO = { hw: 12, hd: 10, wall: 0.3, height: 6, frontDoor: 7, sideDoor: 4 };

function galpao(team: TeamSide, boxes: Box[]): SedeDef {
  const side = team === 0 ? -1 : 1;
  const cx = side * (MAP_HALF_W - GALPAO.hw - 3); // ±60
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
  // Móveis encostados nas paredes (longe do spawn e dos portões).
  const movel = (x: number, z: number, bhw: number, bhd: number, mh: number, m: Box['movel']) => boxes.push({ x, z, hw: bhw, hd: bhd, h: mh, kind: 'movel', color: '#555', team, movel: m });
  movel(back - side * 0.75, cz, 0.45, 2.3, 0.9, 'sofa');
  movel(back - side * 6.5, cz - hd + 2.2, 0.8, 0.6, 0.75, 'mesa');
  for (const sz of [-1, 1]) movel(front + side * 1.6, cz + sz * (hd - 1.4), 0.7, 0.7, 1.2, 'engradados');
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

export function generateMap(seed: number, _mapId: MapId = 'estacionamento'): GameMap {
  const rng = { seed };
  const rand = () => nextRandom(rng);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  const boxes: Box[] = [];
  const circles: Circle[] = [];
  const spots: Vec2[] = [];
  const W = MAP_HALF_W;
  const D = MAP_HALF_D;

  // Limites: grade ao norte e ao sul, muros nas laterais.
  boxes.push({ x: 0, z: D + 0.5, hw: W + 1, hd: 0.5, h: 2.2, kind: 'grade', color: '#5a6068' });
  boxes.push({ x: 0, z: -D - 0.5, hw: W + 1, hd: 0.5, h: 2.2, kind: 'grade', color: '#5a6068' });
  boxes.push({ x: -W - 0.5, z: 0, hw: 0.5, hd: D + 1, h: 2.5, kind: 'muro', color: '#7b7f86' });
  boxes.push({ x: W + 0.5, z: 0, hw: 0.5, hd: D + 1, h: 2.5, kind: 'muro', color: '#7b7f86' });

  const sedes: [SedeDef, SedeDef] = [galpao(0, boxes), galpao(1, boxes)];
  const PX = 28;
  const controlPoints: ControlPointDef[] = [
    { id: 'A', pos: { x: -PX, z: 0 }, radius: CONTROL_POINT_RADIUS },
    { id: 'B', pos: { x: 0, z: 0 }, radius: CONTROL_POINT_RADIUS },
    { id: 'C', pos: { x: PX, z: 0 }, radius: CONTROL_POINT_RADIUS },
  ];
  /** Nada de obstáculo solto dentro das praças (com folga). */
  const inPlaza = (x: number, z: number, pad = 1.5) => controlPoints.some((cp) => Math.hypot(x - cp.pos.x, z - cp.pos.z) < cp.radius + pad);
  /** Até onde vão as fileiras: antes da frente dos galpões (x = ±48). */
  const rowEnd = W - 30;
  /** Ruas transversais (cortes nas fileiras), em x: dos lados de cada praça e no meio. */
  const streets = [-PX - 12, -PX + 12, 0, PX - 12, PX + 12];
  const onStreet = (x: number, pad = 4) => streets.some((sx) => Math.abs(x - sx) < pad);

  // Carros (comprimento no eixo Z); vagas vazias viram passagens.
  const addCar = (x: number, z: number) => {
    spots.push({ x, z });
    if (rand() < 0.35) return;
    boxes.push({ x: x + (rand() - 0.5) * 0.3, z: z + (rand() - 0.5) * 0.4, hw: 0.95, hd: 2.2, h: 1.45, kind: 'carro', color: pick(CAR_COLORS) });
  };
  const carRow = (x0: number, x1: number, z: number) => {
    for (let x = x0; x <= x1; x += 2.7) if (!onStreet(x)) addCar(x, z);
  };
  // A (oeste) e o sul inteiro: estacionamento.
  for (const z of [-11, -16]) carRow(-rowEnd, -14, z);
  for (const z of [-29, -34]) carRow(-rowEnd, rowEnd, z);
  for (const z of [11, 16, 28, 33]) carRow(-rowEnd, -14, z);

  // C (leste): barracas de churrasquinho em grade apertada, com becos.
  const BARRACA_CORES = ['#e94f37', '#f6c445', '#2a9d8f', '#e76f51', '#3d5a80', '#8ac926'];
  for (const z of [-11, -16, 11, 16, 28, 33]) {
    for (let x = 16; x <= rowEnd; x += 5) {
      if (onStreet(x, 2.6) || inPlaza(x, z, 3) || rand() < 0.2) continue;
      boxes.push({ x, z, hw: 1.4, hd: 1.4, h: 2.4, kind: 'barraca', color: pick(BARRACA_CORES) });
    }
  }

  // B (centro): esplanada aberta, filas de grades com aberturas e a bilheteria encostada na grade norte.
  for (const z of [11, 17]) {
    for (const x of [-7, 7]) boxes.push({ x, z, hw: 2.5, hd: 0.12, h: 1.1, kind: 'barreira', color: '#aab2bd' });
  }
  for (const z of [-11, -16]) for (const x of [-7, 7]) boxes.push({ x, z, hw: 2.5, hd: 0.12, h: 1.1, kind: 'barreira', color: '#aab2bd' });
  const QUIOSQUE_CORES = ['#e94f37', '#f6c445', '#2a9d8f', '#3d5a80'];
  for (const x of [-9, -4.5, 4.5, 9]) boxes.push({ x, z: 33, hw: 1.6, hd: 1.2, h: 2.6, kind: 'quiosque', color: pick(QUIOSQUE_CORES) });
  // Quiosques na beira da avenida, entre as praças.
  for (const x of [-14, 14]) for (const z of [-7, 7]) boxes.push({ x, z, hw: 1.6, hd: 1.2, h: 2.6, kind: 'quiosque', color: pick(QUIOSQUE_CORES) });

  // Ônibus das torcidas do lado de fora de cada galpão (entre o corredor e a grade).
  const busX = W - 18;
  boxes.push({ x: -busX, z: 32, hw: 1.3, hd: 5, h: 3.4, kind: 'onibus', color: '#f5f5f5' });
  boxes.push({ x: busX, z: 32, hw: 1.3, hd: 5, h: 3.4, kind: 'onibus', color: '#0033a0' });
  boxes.push({ x: -busX, z: -32, hw: 1.3, hd: 5, h: 3.4, kind: 'onibus', color: '#222222' });
  boxes.push({ x: busX, z: -32, hw: 1.3, hd: 5, h: 3.4, kind: 'onibus', color: '#e30613' });

  // Avenida: postes e coqueiros nos canteiros (fora das praças e longe das caixas).
  const nearBox = (x: number, z: number, pad: number) => boxes.some((b) => Math.abs(b.x - x) < b.hw + pad && Math.abs(b.z - z) < b.hd + pad);
  for (let x = -(rowEnd - 3); x <= rowEnd - 3; x += 12) if (!inPlaza(x, 0)) circles.push({ x, z: 0, r: 0.25, kind: 'poste' });
  for (let x = -(rowEnd - 3); x <= rowEnd - 3; x += 9) {
    for (const z of [-5, 5]) if (!inPlaza(x, z, 2) && !nearBox(x, z, 1)) circles.push({ x, z, r: 0.35, kind: 'coqueiro' });
  }
  // Coqueiros na esplanada, entre as grades e a bilheteria.
  for (const x of [-10, -3, 3, 10]) circles.push({ x, z: 26, r: 0.35, kind: 'coqueiro' });
  // Postes do estacionamento e lixeiras, fora dos corredores.
  for (let x = -rowEnd + 4; x <= rowEnd - 4; x += 16) circles.push({ x, z: -38, r: 0.25, kind: 'poste' });
  for (let i = 0; i < 16; i++) {
    const x = (rand() - 0.5) * 2 * (rowEnd - 2);
    const z = pick([-38, -5, 5, 38]);
    if (!inPlaza(x, z) && !nearBox(x, z, 0.8)) circles.push({ x, z, r: 0.45, kind: 'lixeira' });
  }

  return { seed, halfW: W, halfD: D, boxes, circles, sedes, controlPoints, spots };
}

export function inRect(p: Vec2, r: Rect): boolean {
  return Math.abs(p.x - r.x) <= r.hw && Math.abs(p.z - r.z) <= r.hd;
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

/** Degrau que se sobe andando; caixa até esta altura abaixo do pé não colide. */
export const STEP_UP = 0.3;
/** Topo mais alto (acima do chão) que dá para escalar: carro sim; barraca, quiosque e grade não. */
export const CLIMB_MAX = 1.6;

type Solids = Pick<GameMap, 'boxes' | 'circles' | 'halfW' | 'halfD'>;

/** Altura do chão debaixo do ponto: o topo mais alto alcançável (até `y + STEP_UP`) com o ponto em cima. */
export function groundHeight(boxes: readonly Box[], p: Vec2, y: number): number {
  let g = 0;
  for (const b of boxes) if (b.h > g && b.h <= y + STEP_UP && Math.abs(p.x - b.x) <= b.hw && Math.abs(p.z - b.z) <= b.hd) g = b.h;
  return g;
}

/**
 * Empurra um círculo (lutador) para fora dos obstáculos. Determinístico.
 * Caixa com o topo abaixo do pé (`y`) não colide: dá para andar em cima do carro.
 * Devolve quanto empurrou (m), para detectar o impacto contra a parede.
 */
export function resolveCircleCollision(pos: Vec2, radius: number, map: Solids, y = 0): number {
  const x0 = pos.x;
  const z0 = pos.z;
  for (const b of map.boxes) {
    if (b.h <= y + STEP_UP) continue;
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
  return Math.hypot(pos.x - x0, pos.z - z0);
}

export interface TraversePlan {
  kind: TraverseKind;
  to: Vec3;
  /** Topo do obstáculo (o arco passa por cima). */
  top: number;
  ticks: number;
}

/** Entrada e saída [t0, t1] do raio p + d·t na caixa engordada por r (plano XZ), ou null. */
function rayBox(p: Vec2, d: Vec2, b: Box, r: number): [number, number] | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  const slabs: [number, number, number, number][] = [
    [p.x, d.x, b.x - b.hw - r, b.x + b.hw + r],
    [p.z, d.z, b.z - b.hd - r, b.z + b.hd + r],
  ];
  for (const [o, v, lo, hi] of slabs) {
    if (Math.abs(v) < 1e-9) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let a = (lo - o) / v;
    let c = (hi - o) / v;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, c);
  }
  return t0 <= t1 ? [t0, t1] : null;
}

/**
 * Travessia possível andando em `dir` (normalizada) a partir de `p`, com o pé em `level`:
 * pular por cima (baixo e fino), deslizar no capô (carro, correndo) ou subir (cabe o pé em cima).
 * `air`: no ar, só sobe, e só se a borda está ao alcance da mão. A saída é validada (sem colisão).
 */
export function findTraverse(map: Solids, p: Vec2, level: number, dir: Vec2, r: number, running: boolean, t: TraverseConstants, air = false): TraversePlan | null {
  let hit: Box | undefined;
  let tIn = Infinity;
  let tOut = 0;
  for (const b of map.boxes) {
    if (b.h <= level + STEP_UP) continue;
    const span = rayBox(p, dir, b, r);
    if (!span || span[0] > t.probe || span[1] < 0 || span[0] >= tIn) continue;
    hit = b;
    [tIn, tOut] = span;
  }
  if (!hit) return null;
  const box = hit;
  const alto = box.h - level;
  if (alto > (air ? t.airMantleReach : CLIMB_MAX)) return null;
  const at = (d: number, y: number): Vec3 => ({ x: p.x + dir.x * d, y, z: p.z + dir.z * d });
  const free = (q: Vec3) => resolveCircleCollision({ x: q.x, z: q.z }, r, map, q.y) < 1e-6;
  if (!air) {
    const depth = 2 * (Math.abs(dir.x) * box.hw + Math.abs(dir.z) * box.hd);
    const over = (kind: TraverseKind, ticks: number): TraversePlan | null => {
      const to = at(tOut + 0.35, 0);
      to.y = groundHeight(map.boxes, to, level);
      return free(to) ? { kind, to, top: box.h, ticks } : null;
    };
    const vault = alto <= t.vaultMaxHeight && depth <= t.vaultMaxDepth ? over('pular', running ? t.vaultRunTicks : t.vaultTicks) : null;
    if (vault) return vault;
    const hood = box.kind === 'carro' && running && depth <= t.hoodMaxDepth ? over('capo', t.hoodTicks) : null;
    if (hood) return hood;
  }
  if (Math.min(box.hw, box.hd) < r) return null;
  // 0,5 m para dentro da borda, em cima.
  const to = at(tIn + r + 0.5, box.h);
  if (Math.abs(to.x - box.x) > box.hw || Math.abs(to.z - box.z) > box.hd || !free(to)) return null;
  return { kind: 'subir', to, top: box.h, ticks: air ? t.airMantleTicks : Math.round(t.climbBaseTicks + t.climbTicksPerMeter * alto) };
}
