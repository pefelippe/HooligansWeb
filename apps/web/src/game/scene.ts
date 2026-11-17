import { GALPAO, type GameMap, nextRandom, STADIUM, TORCIDAS } from '@torcidas/shared';
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const LAMP_MAT = new THREE.MeshBasicMaterial({ color: 0xffe9b0 });

// Monta o entorno do Castelão a partir do mesmo GameMap (seed) que o servidor usa para colisão.

export function buildScene(map: GameMap): { scene: THREE.Scene; sun: THREE.DirectionalLight } {
  const scene = new THREE.Scene();
  // Noite de jogo: céu escuro com o brilho do estádio no horizonte.
  scene.background = skyTexture();
  // Névoa longe: o Castelão é a referência no horizonte.
  scene.fog = new THREE.Fog(0x161d2c, 60, 230);
  // Tudo o que é parado vai para `world` e é fundido por material no fim (poucas draw calls).
  const world = new THREE.Group();

  scene.add(new THREE.HemisphereLight(0x8fa6d6, 0x2a241c, 0.8));
  // Luz principal fria (refletores do estádio), forte o bastante para a briga continuar legível.
  const sun = new THREE.DirectionalLight(0xe4ebff, 1.45);
  sun.position.set(-25, 40, -20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -50;
  sc.right = 50;
  sc.top = 35;
  sc.bottom = -35;
  sc.far = 120;
  scene.add(sun);

  // Asfalto.
  const asphalt = new THREE.Mesh(
    new THREE.PlaneGeometry(map.halfW * 2 + 40, map.halfD * 2 + 40),
    new THREE.MeshStandardMaterial({ color: 0xffffff, map: asphaltTexture(map.halfW * 2 + 40, map.halfD * 2 + 40), roughness: 0.95 }),
  );
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.receiveShadow = true;
  world.add(asphalt);

  // Faixas das vagas (linhas brancas) e faixa amarela do corredor.
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xd9d9d9 });
  const lineGeo = new THREE.PlaneGeometry(0.1, 4.8);
  const lines = new THREE.InstancedMesh(lineGeo, lineMat, map.spots.length + 64);
  const m4 = new THREE.Matrix4();
  const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  let n = 0;
  for (const s of map.spots) {
    m4.compose(new THREE.Vector3(s.x - 1.35, 0.011, s.z), rot, new THREE.Vector3(1, 1, 1));
    lines.setMatrixAt(n++, m4);
  }
  lines.count = n;
  world.add(lines);
  const lane = new THREE.Mesh(new THREE.PlaneGeometry(map.halfW * 2 - 56, 0.15), new THREE.MeshBasicMaterial({ color: 0xe0b23a }));
  lane.rotation.x = -Math.PI / 2;
  lane.position.y = 0.012;
  for (const z of [-5, 5]) {
    const l = lane.clone();
    l.position.z = z;
    world.add(l);
  }

  // Esplanada do Castelão (concreto mais claro) e canteiros de grama da avenida.
  const esplanada = new THREE.Mesh(new THREE.PlaneGeometry(STADIUM.rx * 2 + 16, STADIUM.z - 8.5), std(0x55585e, 0.95, 0));
  esplanada.rotation.x = -Math.PI / 2;
  esplanada.position.set(STADIUM.x, 0.006, (STADIUM.z + 8.5) / 2);
  esplanada.receiveShadow = true;
  world.add(esplanada);
  for (const z of [-7.5, 7.5]) {
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(map.halfW * 2 - 56, 1.8), std(0x2d4a2b, 1, 0));
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(0, 0.008, z);
    grass.receiveShadow = true;
    world.add(grass);
  }
  world.add(castelao());

  // Sedes: piso do galpão tingido com as cores da torcida e faixa na borda.
  map.sedes.forEach((sd, team) => {
    const t = TORCIDAS[team];
    if (!t) return;
    const a = sd.area;
    const fill = new THREE.Mesh(
      new THREE.PlaneGeometry(a.hw * 2, a.hd * 2),
      new THREE.MeshBasicMaterial({ color: t.cores[0], transparent: true, opacity: 0.22 }),
    );
    fill.rotation.x = -Math.PI / 2;
    fill.position.set(a.x, 0.015, a.z);
    world.add(fill);
    const border = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(a.hw * 2 - 0.4, a.hd * 2 - 0.4)),
      new THREE.LineBasicMaterial({ color: t.cores[1], transparent: true, opacity: 0.85 }),
    );
    border.rotation.x = -Math.PI / 2;
    border.position.set(a.x, 0.02, a.z);
    world.add(border);
    const light = new THREE.PointLight(new THREE.Color(t.cores[1]), 18, 18);
    light.position.set(a.x, 4.5, a.z);
    world.add(light);
    world.add(sedeDecor(a, team as 0 | 1));
  });

  // Obstáculos.
  const rng = { seed: map.seed ^ 0x5bd1e995 };
  for (const b of map.boxes) {
    if (b.hidden) continue;
    const g = new THREE.Group();
    g.position.set(b.x, 0, b.z);
    switch (b.kind) {
      case 'carro':
        g.add(car(b.hw, b.hd, b.color, nextRandom(rng) < 0.5, Math.floor(nextRandom(rng) * CAR_TYPES.length)));
        break;
      case 'onibus':
        g.add(bus(b.hw, b.hd, b.h, b.color));
        break;
      case 'quiosque':
        g.add(quiosque(b));
        break;
      case 'barreira':
        g.add(barreira(b));
        break;
      case 'barraca':
        g.add(shopCounter(b));
        break;
      case 'movel':
        g.add(movel(b));
        break;
      case 'galpao':
        g.add(galpaoWall(b));
        break;
      default: {
        const wall = new THREE.Mesh(
          new THREE.BoxGeometry(b.hw * 2, b.h, b.hd * 2),
          b.kind === 'grade' ? fence(b.color) : std(b.color, 0.9, 0),
        );
        wall.position.y = b.h / 2;
        wall.castShadow = true;
        wall.receiveShadow = true;
        g.add(wall);
      }
    }
    world.add(g);
  }
  for (const c of map.circles) {
    // Poucas luzes pontuais (custo por pixel): só os postes do miolo da avenida acendem de verdade.
    if (c.kind === 'poste') world.add(lightPole(c.x, c.z, c.z === 0 && Math.abs(c.x) <= 66));
    else if (c.kind === 'coqueiro') world.add(coqueiro(c.x, c.z, nextRandom(rng)));
    else {
      const bin = new THREE.Mesh(new THREE.CylinderGeometry(c.r, c.r * 0.9, 1, 12), std(0x2f6b3b, 0.8, 0));
      bin.position.set(c.x, 0.5, c.z);
      bin.castShadow = true;
      world.add(bin);
    }
  }

  // Luz falsa dos postes: cone de luz e mancha no chão, todos os postes em 2 draw calls.
  const poles = map.circles.filter((c) => c.kind === 'poste');
  const glowTex = radialTexture('rgba(255,214,140,0.55)');
  const pool = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(9, 9),
    new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    poles.length,
  );
  const beamGeo = new THREE.ConeGeometry(3.2, 7.4, 20, 1, true);
  beamGeo.translate(0, 3.7, 0);
  const beam = new THREE.InstancedMesh(
    beamGeo,
    new THREE.MeshBasicMaterial({ color: 0xffd99a, transparent: true, opacity: 0.06, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    poles.length,
  );
  const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  const one = new THREE.Vector3(1, 1, 1);
  poles.forEach((p, i) => {
    pool.setMatrixAt(i, m4.compose(new THREE.Vector3(p.x, 0.025, p.z), flat, one));
    beam.setMatrixAt(i, m4.compose(new THREE.Vector3(p.x, 0, p.z), new THREE.Quaternion(), one));
  });
  pool.renderOrder = beam.renderOrder = 1;
  scene.add(pool, beam);

  // Brilho dos refletores do estádio (cabeças desenhadas em `stadium`).
  const flareMat = new THREE.SpriteMaterial({ map: radialTexture('rgba(255,248,224,0.9)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  for (let i = 0; i < 4; i++) {
    const a = Math.PI * (0.25 + i * 0.5);
    const flare = new THREE.Sprite(flareMat);
    flare.position.set(STADIUM.x + Math.cos(a) * STADIUM.rx * 0.8, STADIUM.h + 9, STADIUM.z + Math.sin(a) * STADIUM.rz * 0.8);
    flare.scale.set(30, 30, 1);
    scene.add(flare);
  }

  mergeStatic(world, scene);
  return { scene, sun };
}

/**
 * Funde as malhas paradas de `world` por material (e por flags de sombra) e põe o resultado em `scene`.
 * Luzes, linhas e instâncias vão como estão. Troca culling por objeto por pouquíssimas draw calls.
 */
function mergeStatic(world: THREE.Group, scene: THREE.Scene): void {
  world.updateMatrixWorld(true);
  const buckets = new Map<string, { mat: THREE.Material; cast: boolean; recv: boolean; geos: THREE.BufferGeometry[] }>();
  const keep: THREE.Object3D[] = [];
  world.traverse((o) => {
    if (o === world) return;
    if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh) && !Array.isArray(o.material)) {
      const mat = o.material as THREE.Material;
      const key = `${mat.uuid}|${o.castShadow}|${o.receiveShadow}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { mat, cast: o.castShadow, recv: o.receiveShadow, geos: [] }));
      const g = (o.geometry as THREE.BufferGeometry).clone().applyMatrix4(o.matrixWorld);
      b.geos.push(g);
    } else if (o instanceof THREE.Light || o instanceof THREE.LineSegments || o instanceof THREE.InstancedMesh) {
      keep.push(o);
    }
  });
  for (const o of keep) {
    const m = o.matrixWorld.clone();
    o.removeFromParent();
    m.decompose(o.position, o.quaternion, o.scale);
    scene.add(o);
  }
  for (const b of buckets.values()) {
    // Todas as geometrias do three vêm indexadas e com position/normal/uv; uma que não vier fica de fora.
    const merged = mergeGeometries(b.geos.filter((g) => g.index && g.attributes.uv && g.attributes.normal));
    for (const g of b.geos) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, b.mat);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.recv;
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
  }
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) draw(g);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function skyTexture(): THREE.CanvasTexture {
  return canvasTexture(4, 256, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#04060b');
    grad.addColorStop(0.55, '#111a2c');
    grad.addColorStop(0.8, '#2a2a36');
    grad.addColorStop(1, '#3a3026');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
  });
}

function radialTexture(center: string): THREE.CanvasTexture {
  return canvasTexture(128, 128, (g) => {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, center);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  });
}

/** Asfalto gasto: ruído, manchas de óleo e remendos. Repete a cada 8 m. */
function asphaltTexture(w: number, d: number): THREE.CanvasTexture {
  const rng = { seed: 0x2f6b3b };
  const tex = canvasTexture(256, 256, (g) => {
    g.fillStyle = '#2c2f35';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 9000; i++) {
      const v = 30 + Math.floor(nextRandom(rng) * 40);
      g.fillStyle = `rgb(${v},${v + 2},${v + 6})`;
      g.fillRect(nextRandom(rng) * 256, nextRandom(rng) * 256, 1.5, 1.5);
    }
    for (let i = 0; i < 5; i++) {
      const x = nextRandom(rng) * 256;
      const y = nextRandom(rng) * 256;
      const r = 10 + nextRandom(rng) * 26;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(10,10,12,0.45)');
      grad.addColorStop(1, 'rgba(10,10,12,0)');
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.fillStyle = 'rgba(70,72,78,0.35)';
    g.fillRect(nextRandom(rng) * 200, nextRandom(rng) * 200, 40, 26);
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(w / 8, d / 8);
  tex.anisotropy = 4;
  return tex;
}

// Materiais iguais são o mesmo objeto: é o que deixa o mergeStatic fundir carros da mesma cor.
const MATS = new Map<string, THREE.MeshStandardMaterial>();
function std(color: THREE.ColorRepresentation, roughness = 0.6, metalness = 0.1) {
  const key = `${String(color)}|${roughness}|${metalness}`;
  let m = MATS.get(key);
  if (!m) MATS.set(key, (m = new THREE.MeshStandardMaterial({ color, roughness, metalness })));
  return m;
}

function fence(color: string) {
  const key = `grade|${color}`;
  let m = MATS.get(key);
  if (!m) MATS.set(key, (m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, transparent: true, opacity: 0.55 })));
  return m;
}

function bus(hw: number, hd: number, h: number, color: string): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, h - 0.4, hd * 2), std(color, 0.4, 0.3));
  body.position.y = h / 2 + 0.2;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  const windows = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 0.02, 0.8, hd * 1.8), std(0x10161f, 0.1, 0.7));
  windows.position.y = h - 0.9;
  g.add(windows);
  return g;
}


/** Castelão: oval com base de concreto, fachada de brises metálicos, pilares e a cobertura branca em anel. */
function castelao(): THREE.Group {
  const S = STADIUM;
  const g = new THREE.Group();
  g.position.set(S.x, 0, S.z);
  const oval = (m: THREE.Mesh) => {
    m.scale.x *= S.rx;
    m.scale.z *= S.rz;
    return m;
  };
  const baseH = 7;
  const base = oval(new THREE.Mesh(new THREE.CylinderGeometry(1, 1.02, baseH, 72), std(0x858b93, 0.9, 0)));
  base.position.y = baseH / 2;
  base.receiveShadow = true;
  g.add(base);
  // Brises: listras verticais de metal claro sobre vidro escuro, abrindo para fora em cima.
  const briseTex = canvasTexture(64, 64, (c) => {
    c.fillStyle = '#26303d';
    c.fillRect(0, 0, 64, 64);
    c.fillStyle = '#b9c2cc';
    c.fillRect(0, 0, 26, 64);
    c.fillStyle = 'rgba(255,255,255,0.25)';
    c.fillRect(0, 0, 4, 64);
  });
  briseTex.wrapS = briseTex.wrapT = THREE.RepeatWrapping;
  briseTex.repeat.set(140, 1);
  const facadeH = S.h - baseH;
  const facade = oval(new THREE.Mesh(new THREE.CylinderGeometry(1.07, 0.99, facadeH, 96, 1, true), new THREE.MeshStandardMaterial({ map: briseTex, roughness: 0.45, metalness: 0.5 })));
  facade.position.y = baseH + facadeH / 2;
  g.add(facade);
  // Faixa de luz entre a base e a fachada (o anel iluminado do Castelão à noite).
  const band = oval(new THREE.Mesh(new THREE.CylinderGeometry(1.025, 1.025, 0.6, 96, 1, true), new THREE.MeshBasicMaterial({ color: 0xbfe3ff })));
  band.position.y = baseH + 0.3;
  g.add(band);
  // Pilares brancos em volta.
  const pillarMat = std(0xe9ecef, 0.6);
  const pillarGeo = new THREE.BoxGeometry(1, S.h + 1.5, 1);
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const p = new THREE.Mesh(pillarGeo, pillarMat);
    p.position.set(Math.cos(a) * S.rx * 1.075, (S.h + 1.5) / 2, Math.sin(a) * S.rz * 1.075);
    p.castShadow = true;
    g.add(p);
  }
  // Cobertura: anel branco (vão aberto no meio) com a borda grossa.
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.5, side: THREE.DoubleSide });
  const roof = new THREE.Mesh(new THREE.RingGeometry(0.62, 1.12, 96), roofMat);
  roof.scale.set(S.rx, S.rz, 1);
  roof.rotation.x = -Math.PI / 2;
  roof.position.y = S.h + 1.5;
  g.add(roof);
  const rim = oval(new THREE.Mesh(new THREE.CylinderGeometry(1.12, 1.12, 1.6, 96, 1, true), roofMat));
  rim.position.y = S.h + 0.7;
  g.add(rim);
  // Brilho do gramado subindo pelo vão da cobertura.
  const glow = oval(new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.6, 7, 64, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff3d6, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })));
  glow.position.y = S.h + 5;
  g.add(glow);
  // Letreiro na fachada sul (virada para a avenida).
  const sign = textPlane(34, 4.2, [1024, 128], (c, W, H) => {
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#ffffff';
    c.font = '900 104px Inter, Arial, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('ARENA CASTELÃO', W / 2, H / 2 + 6);
  }, true);
  sign.rotation.y = Math.PI;
  sign.position.set(0, baseH + facadeH * 0.55, -S.rz * 1.085);
  g.add(sign);
  // Torres de refletor sobre a cobertura.
  const head = new THREE.MeshBasicMaterial({ color: 0xfff8e0 });
  for (let i = 0; i < 4; i++) {
    const a = Math.PI * (0.25 + i * 0.5);
    const x = Math.cos(a) * S.rx * 0.8;
    const z = Math.sin(a) * S.rz * 0.8;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 9, 8), std(0x8a9099));
    mast.position.set(x, S.h + 4.5, z);
    g.add(mast);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 0.6), head);
    lamp.position.set(x, S.h + 9, z);
    lamp.lookAt(0, S.h + 9, 0);
    g.add(lamp);
  }
  return g;
}

/** Quiosque de ambulante: caixa clara, balcão e toldo na cor da barraca. */
function quiosque(b: { hw: number; hd: number; h: number; color: string; z: number }): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(b.hw * 1.8, 2.1, b.hd * 1.8), std(0xefe9dc, 0.8, 0));
  body.position.y = 1.05;
  body.castShadow = true;
  body.receiveShadow = true;
  const accent = std(b.color, 0.7, 0);
  const counter = new THREE.Mesh(new THREE.BoxGeometry(b.hw * 2, 0.22, b.hd * 2), accent);
  counter.position.y = 1.05;
  const awning = new THREE.Mesh(new THREE.BoxGeometry(b.hw * 2 + 0.6, 0.12, b.hd * 2 + 1), accent);
  awning.position.y = b.h - 0.1;
  // Toldo caindo para o lado da avenida.
  awning.rotation.x = b.z > 0 ? 0.12 : -0.12;
  awning.castShadow = true;
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(b.hw * 1.4, 0.06, 0.06), LAMP_MAT);
  lamp.position.set(0, b.h - 0.35, b.z > 0 ? -b.hd : b.hd);
  g.add(body, counter, awning, lamp);
  return g;
}

/** Grade de contenção da fila: dois tubos e a tela entre eles. */
function barreira(b: { hw: number; hd: number; h: number; color: string }): THREE.Group {
  const g = new THREE.Group();
  const metal = std(b.color, 0.4, 0.7);
  for (const y of [0.15, b.h]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(b.hw * 2, 0.06, 0.06), metal);
    rail.position.y = y;
    g.add(rail);
  }
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.hw * 2, b.h - 0.15, 0.02), fence(b.color));
  mesh.position.y = (b.h + 0.15) / 2;
  g.add(mesh);
  for (const x of [-b.hw, b.hw]) {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.7), metal);
    foot.position.set(x, 0.03, 0);
    g.add(foot);
  }
  return g;
}

const TRUNK_MAT = new THREE.MeshStandardMaterial({ color: 0x7a5c3e, roughness: 0.95 });
const FROND_MAT = new THREE.MeshStandardMaterial({ color: 0x2f7a35, roughness: 0.8, side: THREE.DoubleSide });
const TRUNK_GEO = new THREE.CylinderGeometry(0.15, 0.24, 7, 7).translate(0, 3.5, 0);
const FROND_GEO = new THREE.PlaneGeometry(0.7, 3.2).translate(0, 1.6, 0);

/** Coqueiro: tronco levemente torto e folhas caindo em volta. */
function coqueiro(x: number, z: number, r: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const trunk = new THREE.Mesh(TRUNK_GEO, TRUNK_MAT);
  trunk.rotation.z = (r - 0.5) * 0.18;
  trunk.castShadow = true;
  g.add(trunk);
  const top = new THREE.Vector3(0, 7, 0).applyEuler(trunk.rotation);
  for (let i = 0; i < 7; i++) {
    const f = new THREE.Mesh(FROND_GEO, FROND_MAT);
    f.position.copy(top);
    f.rotation.set(0, (i / 7) * Math.PI * 2 + r * 3, 0, 'YXZ');
    f.rotateX(1.15 + ((i * 37) % 5) * 0.08);
    f.castShadow = true;
    g.add(f);
  }
  return g;
}


function lightPole(x: number, z: number, withLight: boolean): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 8, 8), std(0x7d838b, 0.5, 0.6));
  pole.position.y = 4;
  pole.castShadow = true;
  g.add(pole);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.2, 0.4), LAMP_MAT);
  lamp.position.y = 8;
  g.add(lamp);
  if (withLight) {
    const l = new THREE.PointLight(0xffd99a, 40, 18, 1.6);
    l.position.y = 7.6;
    g.add(l);
  }
  return g;
}

// ---------------------------------------------------------------- carros

interface CarType {
  /** Altura da traseira, da linha de cintura e do bico. */
  rearH: number;
  belt: number;
  noseH: number;
  /** Estufa (vidros): base traseira, topo traseiro, topo dianteiro, base dianteira (z, frente em +z). */
  glass: [number, number, number, number];
  roofH: number;
  lift: number;
}

const CAR_TYPES: CarType[] = [
  // Sedã: porta-malas e capô.
  { rearH: 0.84, belt: 0.95, noseH: 0.72, glass: [-1.1, -0.6, 0.35, 1.0], roofH: 1.4, lift: 0 },
  // Hatch: traseira quase reta.
  { rearH: 0.9, belt: 0.95, noseH: 0.74, glass: [-1.95, -1.8, 0.3, 0.95], roofH: 1.42, lift: 0 },
  // SUV: mais alto, cabine comprida.
  { rearH: 1.02, belt: 1.08, noseH: 0.88, glass: [-1.95, -1.88, 0.45, 1.05], roofH: 1.62, lift: 0.1 },
];

const carGeoCache = new Map<string, { body: THREE.BufferGeometry; glass: THREE.BufferGeometry }>();

/** Extrusão de um perfil lateral (x do perfil = comprimento, frente em +x) com o comprimento em Z do mundo. */
function extrudeProfile(shape: THREE.Shape, width: number, bevel: number): THREE.BufferGeometry {
  const depth = Math.max(0.01, width - bevel * 2);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.75, bevelSegments: 2, curveSegments: 8 });
  geo.translate(0, 0, -depth / 2);
  geo.rotateY(-Math.PI / 2);
  // O mergeStatic só funde geometria indexada.
  return mergeVertices(geo);
}

function carGeometries(type: number, hw: number, hd: number): { body: THREE.BufferGeometry; glass: THREE.BufferGeometry } {
  const key = `${type}|${hw}|${hd}`;
  const cached = carGeoCache.get(key);
  if (cached) return cached;
  const t = CAR_TYPES[type] ?? CAR_TYPES[0]!;
  const h = hd;
  const r = 0.42;
  const wz = h - 0.85;
  const y0 = 0.28 + t.lift;
  // Carroceria: traseira, cintura, capô arredondado, bico; embaixo, os dois para-lamas.
  const s = new THREE.Shape();
  s.moveTo(-h, y0);
  s.lineTo(-h, t.rearH);
  s.quadraticCurveTo(-h, t.belt, -h + 0.3, t.belt);
  s.lineTo(h - 0.55, t.belt - 0.04);
  s.quadraticCurveTo(h, t.belt - 0.06, h, t.noseH);
  s.lineTo(h, y0);
  s.lineTo(wz + r, y0);
  s.absarc(wz, y0, r, 0, Math.PI, false);
  s.lineTo(-wz + r, y0);
  s.absarc(-wz, y0, r, 0, Math.PI, false);
  s.lineTo(-h, y0);
  const body = extrudeProfile(s, hw * 2, 0.08);
  // Estufa: trapézio de vidro um pouco mais estreito, com o teto na cor do carro por cima.
  const [rb, rt, ft, fb] = t.glass;
  const g = new THREE.Shape();
  g.moveTo(rb, t.belt - 0.02);
  g.lineTo(rt, t.roofH - 0.04);
  g.lineTo(ft, t.roofH - 0.04);
  g.lineTo(fb, t.belt - 0.04);
  g.lineTo(rb, t.belt - 0.02);
  const glass = extrudeProfile(g, hw * 1.72, 0.04);
  const out = { body, glass };
  carGeoCache.set(key, out);
  return out;
}

const HEADLIGHT_MAT = new THREE.MeshBasicMaterial({ color: 0xfff1c4 });
const TAILLIGHT_MAT = new THREE.MeshBasicMaterial({ color: 0xc8102e });

function car(hw: number, hd: number, color: string, frontNorth: boolean, type: number): THREE.Group {
  const g = new THREE.Group();
  const t = CAR_TYPES[type] ?? CAR_TYPES[0]!;
  const paint = std(color, 0.3, 0.45);
  const geos = carGeometries(type, hw, hd);
  const body = new THREE.Mesh(geos.body, paint);
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  const glass = new THREE.Mesh(geos.glass, std(0x141c28, 0.08, 0.7));
  glass.castShadow = true;
  g.add(glass);
  const [, rt, ft] = t.glass;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(hw * 1.78, 0.07, ft - rt + 0.12), paint);
  roof.position.set(0, t.roofH, (rt + ft) / 2);
  roof.castShadow = true;
  g.add(roof);
  // Para-choques, faróis e lanternas.
  const trim = std(0x16181c, 0.7, 0.2);
  for (const sz of [-1, 1]) {
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 0.04, 0.2, 0.16), trim);
    bumper.position.set(0, 0.4 + t.lift, sz * (hd + 0.04));
    g.add(bumper);
    for (const sx of [-1, 1]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.04), sz > 0 ? HEADLIGHT_MAT : TAILLIGHT_MAT);
      lamp.position.set(sx * (hw - 0.32), (sz > 0 ? t.noseH : t.rearH) - 0.1, sz * (hd + 0.075));
      g.add(lamp);
    }
  }
  const wheelGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 16);
  const hubGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.26, 10);
  const wheelMat = std(0x111111, 0.9);
  const hubMat = std(0xb8bec7, 0.35, 0.8);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(sx * (hw - 0.14), 0.33 + t.lift * 0.5, sz * (hd - 0.85));
      w.castShadow = true;
      g.add(w);
      const hub = new THREE.Mesh(hubGeo, hubMat);
      hub.rotation.z = Math.PI / 2;
      hub.position.copy(w.position);
      g.add(hub);
    }
  }
  if (frontNorth) g.rotation.y = Math.PI;
  return g;
}

// ---------------------------------------------------------------- sede (galpão)

const FONT = (px: number) => `900 ${px}px "Barlow Condensed", "Arial Narrow", Impact, sans-serif`;

/** Chapa ondulada nas cores da torcida, com uma faixa da segunda cor. Repete a cada 3 m na horizontal. */
function corrugatedMat(team: 0 | 1): THREE.MeshStandardMaterial {
  const key = `galpao|${team}`;
  let m = MATS.get(key);
  if (m) return m;
  const [c0, c1] = TORCIDAS[team]?.cores ?? ['#777777', '#cccccc'];
  const base = c0 === '#111111' ? '#1d1f23' : c0;
  const tex = canvasTexture(128, 256, (g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, 128, 256);
    // Ondas: faixas verticais claras e escuras.
    for (let x = 0; x < 128; x += 16) {
      const grad = g.createLinearGradient(x, 0, x + 16, 0);
      grad.addColorStop(0, 'rgba(0,0,0,0.35)');
      grad.addColorStop(0.5, 'rgba(255,255,255,0.14)');
      grad.addColorStop(1, 'rgba(0,0,0,0.35)');
      g.fillStyle = grad;
      g.fillRect(x, 0, 16, 256);
    }
    // Faixa da torcida e rodapé sujo.
    g.fillStyle = c1;
    g.fillRect(0, 46, 128, 22);
    g.fillRect(0, 84, 128, 6);
    const dirt = g.createLinearGradient(0, 200, 0, 256);
    dirt.addColorStop(0, 'rgba(20,14,8,0)');
    dirt.addColorStop(1, 'rgba(20,14,8,0.6)');
    g.fillStyle = dirt;
    g.fillRect(0, 200, 128, 56);
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  MATS.set(key, (m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.35 })));
  return m;
}

/** Caixa com UV em metros na horizontal (a textura não estica em paredes compridas). */
function wallBox(w: number, h: number, d: number, metersPerRepeat: number): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  // Faces na ordem +x, -x, +y, -y, +z, -z, 4 vértices cada.
  const spans = [d, d, w, w, w, w];
  for (let face = 0; face < 6; face++) {
    for (let i = 0; i < 4; i++) {
      const k = face * 4 + i;
      uv.setX(k, uv.getX(k) * ((spans[face] ?? 1) / metersPerRepeat));
    }
  }
  return geo;
}

function galpaoWall(b: { hw: number; hd: number; h: number; team?: 0 | 1 }): THREE.Mesh {
  const wall = new THREE.Mesh(wallBox(b.hw * 2, b.h, b.hd * 2, 3), corrugatedMat(b.team ?? 0));
  wall.position.y = b.h / 2;
  wall.castShadow = true;
  wall.receiveShadow = true;
  return wall;
}

function textPlane(w: number, h: number, px: [number, number], draw: (g: CanvasRenderingContext2D, W: number, H: number) => void, transparent = false): THREE.Mesh {
  const tex = canvasTexture(px[0], px[1], (g) => draw(g, px[0], px[1]));
  tex.anisotropy = 4;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent, depthWrite: !transparent }));
}

/** Listras verticais nas cores da torcida. */
function stripes(g: CanvasRenderingContext2D, W: number, H: number, a: string, b: string, n: number): void {
  for (let i = 0; i < n; i++) {
    g.fillStyle = i % 2 ? b : a;
    g.fillRect((i * W) / n, 0, W / n + 1, H);
  }
}

/** Letreiro, faixas, bandeiras, bateria, treliças e o nome pintado no chão. */
function sedeDecor(area: { x: number; z: number }, team: 0 | 1): THREE.Group {
  const g = new THREE.Group();
  const t = TORCIDAS[team];
  if (!t) return g;
  const [c0, c1] = t.cores;
  const side = team === 0 ? -1 : 1;
  const { hw, hd, height: H, frontDoor, wall } = GALPAO;
  const cx = area.x;
  const cz = area.z;
  const front = cx - side * hw;
  const back = cx + side * hw;
  // Rotação de um plano com a frente para o centro do mapa (fora da fachada / dentro do fundo).
  const facing = -side * (Math.PI / 2);
  const dark = c0 === '#111111' ? '#141518' : c0;
  const centered = (c: CanvasRenderingContext2D, px: number, color: string) => {
    c.fillStyle = color;
    c.font = FONT(px);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
  };

  // Viga sobre o portão + letreiro aceso dos dois lados.
  const header = new THREE.Mesh(wallBox(wall * 2, 1.8, frontDoor + 0.2, 3), corrugatedMat(team));
  header.position.set(front, H - 0.9, cz);
  header.castShadow = true;
  g.add(header);
  const sign = textPlane(frontDoor + 3, 1.7, [1024, 176], (c, W, Hh) => {
    c.fillStyle = dark;
    c.fillRect(0, 0, W, Hh);
    c.fillStyle = c1;
    c.fillRect(0, 0, W, 14);
    c.fillRect(0, Hh - 14, W, 14);
    centered(c, 120, '#ffffff');
    c.fillText(t.nome.toUpperCase(), W / 2, Hh / 2 + 6);
  });
  sign.position.set(front - side * (wall + 0.05), H - 0.9, cz);
  sign.rotation.y = facing;
  g.add(sign);
  const inner = textPlane(frontDoor, 0.9, [512, 96], (c, W, Hh) => {
    c.fillStyle = dark;
    c.fillRect(0, 0, W, Hh);
    centered(c, 60, c1);
    c.fillText(`SEDE · ${t.sede.toUpperCase()}`, W / 2, Hh / 2 + 4, W - 24);
  });
  inner.position.set(front + side * (wall + 0.05), H - 0.9, cz);
  inner.rotation.y = -facing;
  g.add(inner);

  // Treliças do telhado (abertas: a câmera continua vendo de cima).
  const steel = std(0x2b2f36, 0.6, 0.6);
  for (let i = -2; i <= 2; i++) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.28, hd * 2), steel);
    beam.position.set(cx + i * (hw / 2.5), H - 0.14, cz);
    g.add(beam);
  }
  for (const z of [-hd / 2, hd / 2]) {
    const purlin = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, 0.2, 0.14), steel);
    purlin.position.set(cx, H - 0.1, cz + z);
    g.add(purlin);
  }

  // Teto de chapa (sem sombra: o interior continua claro) e lâmpadas tubulares penduradas.
  const roof = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 0.6, 0.12, hd * 2 + 0.6), std(0x3b4048, 0.7, 0.4));
  roof.position.set(cx, H + 0.06, cz);
  g.add(roof);
  for (let i = -1; i <= 1; i++) {
    for (const z of [-hd / 2, hd / 2]) {
      const tube = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.14), TUBE_MAT);
      tube.position.set(cx + i * (hw / 2.5) * 2, H - 0.45, cz + z);
      g.add(tube);
      const wire = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.3, 0.02), steel);
      wire.position.set(tube.position.x, H - 0.28, tube.position.z);
      g.add(wire);
    }
  }
  const warm = new THREE.PointLight(0xffe4b8, 55, 28, 1.4);
  warm.position.set(cx, H - 0.8, cz);
  g.add(warm);

  // Bandeirão no fundo (nome da torcida) e duas bandeiras listradas nas pontas.
  const faixa = textPlane(11, 2.2, [1024, 205], (c, W, Hh) => {
    c.fillStyle = dark;
    c.fillRect(0, 0, W, Hh);
    c.fillStyle = c1;
    c.fillRect(0, 10, W, 10);
    c.fillRect(0, Hh - 20, W, 10);
    centered(c, 150, c1 === '#f5f5f5' ? '#ffffff' : '#ffffff');
    c.fillText(t.nome.toUpperCase(), W / 2, Hh / 2 + 8, W - 60);
  });
  faixa.position.set(back - side * (wall + 0.06), 3.6, cz);
  faixa.rotation.y = facing;
  g.add(faixa);
  for (const z of [-7.6, 7.6]) {
    const banner = textPlane(1.8, 3.4, [128, 256], (c, W, Hh) => stripes(c, W, Hh, dark, c1, 5));
    banner.position.set(back - side * (wall + 0.06), 3.5, cz + z);
    banner.rotation.y = facing;
    g.add(banner);
  }

  // Mastros com bandeira dos dois lados do portão, do lado de fora.
  const poleMat = std(0xc7ccd2, 0.4, 0.7);
  for (const sz of [-1, 1]) {
    const px = front - side * 1.4;
    const pz = cz + sz * (frontDoor / 2 + 1.4);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 5.2, 8), poleMat);
    pole.position.set(px, 2.6, pz);
    pole.castShadow = true;
    g.add(pole);
    const flag = textPlane(1.8, 1.1, [128, 80], (c, W, Hh) => stripes(c, W, Hh, dark, c1, 6));
    (flag.material as THREE.MeshBasicMaterial).side = THREE.DoubleSide;
    flag.position.set(px, 4.6, pz + sz * 0.92);
    flag.rotation.y = facing;
    g.add(flag);
  }

  // Bateria: surdos no canto oposto à loja.
  const shell = std(c1, 0.5, 0.3);
  const skin = std(0xeeeae0, 0.8, 0);
  for (let i = 0; i < 3; i++) {
    const r = 0.38 - i * 0.04;
    const x = back - side * (1.6 + i * 1.0);
    const z = cz - hd + 2.4 + (i % 2) * 0.5;
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.62, 16), shell);
    drum.position.set(x, 0.31, z);
    drum.castShadow = true;
    g.add(drum);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.96, r * 0.96, 0.02, 16), skin);
    top.position.set(x, 0.63, z);
    g.add(top);
  }

  // Placa da loja em cima do balcão (o balcão é a "barraca" do mapa).
  const shop = textPlane(2.2, 0.6, [256, 72], (c, W, Hh) => {
    c.fillStyle = '#16130a';
    c.fillRect(0, 0, W, Hh);
    centered(c, 52, '#f5c542');
    c.fillText('LOJA · J', W / 2, Hh / 2 + 3);
  });
  shop.position.set(back - side * 1.6, 2.5, cz + hd - 2.2);
  shop.rotation.y = facing;
  g.add(shop);

  // Escudo pintado no piso: listras num círculo com as iniciais.
  const initials = ({ cearalove: 'CL', 'lions-do-pici': 'LP' } as Record<string, string>)[t.id] ?? t.nome.slice(0, 2).toUpperCase();
  const crest = textPlane(
    6,
    6,
    [512, 512],
    (c, W) => {
      c.save();
      c.beginPath();
      c.arc(W / 2, W / 2, W / 2 - 12, 0, Math.PI * 2);
      c.clip();
      stripes(c, W, W, dark, c1, 7);
      c.restore();
      c.lineWidth = 16;
      c.strokeStyle = c1;
      c.beginPath();
      c.arc(W / 2, W / 2, W / 2 - 12, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = dark;
      c.beginPath();
      c.arc(W / 2, W / 2, W * 0.22, 0, Math.PI * 2);
      c.fill();
      centered(c, 150, '#ffffff');
      c.fillText(initials, W / 2, W / 2 + 8);
    },
    true,
  );
  (crest.material as THREE.MeshBasicMaterial).opacity = 0.55;
  crest.rotation.set(-Math.PI / 2, 0, side * (Math.PI / 2));
  crest.position.set(cx - side * 3, 0.022, cz);
  g.add(crest);
  return g;
}

const TUBE_MAT = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });

/** Móveis da sede (a colisão vem do mapa). Comprimento ao longo de Z. */
function movel(b: { hw: number; hd: number; h: number; movel?: 'sofa' | 'mesa' | 'engradados'; team?: 0 | 1 }): THREE.Group {
  const g = new THREE.Group();
  const c1 = TORCIDAS[b.team ?? 0]?.cores[1] ?? '#cccccc';
  if (b.movel === 'sofa') {
    // Sofá velho de couro marrom.
    const leather = std(0x5a3a28, 0.8, 0.05);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(b.hw * 2, 0.42, b.hd * 2), leather);
    seat.position.y = 0.21;
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.85, b.hd * 2), leather);
    back.position.set(b.hw - 0.11, 0.425, 0);
    g.add(seat, back);
    for (const sz of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(b.hw * 2, 0.62, 0.22), leather);
      arm.position.set(0, 0.31, sz * (b.hd - 0.11));
      g.add(arm);
    }
    const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.42, 0.55), std(c1, 0.9, 0));
    pillow.position.set(b.hw - 0.3, 0.6, -0.8);
    pillow.rotation.x = 0.2;
    g.add(pillow);
  } else if (b.movel === 'mesa') {
    // Mesa de bar de plástico com quatro cadeiras.
    const plastic = std(0xd9c74a, 0.6, 0);
    const top = new THREE.Mesh(new THREE.BoxGeometry(b.hw * 1.6, 0.05, b.hd * 1.6), plastic);
    top.position.y = 0.72;
    g.add(top);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.72, 0.05), plastic);
        leg.position.set(sx * b.hw * 0.7, 0.36, sz * b.hd * 0.7);
        g.add(leg);
        const chair = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.42), plastic);
        chair.position.set(sx * (b.hw + 0.05), 0.44, sz * b.hd * 0.55);
        const rest = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 0.42), plastic);
        rest.position.set(sx * (b.hw + 0.24), 0.66, sz * b.hd * 0.55);
        g.add(chair, rest);
      }
    }
    // Garrafas e copo em cima.
    const glass = std(0x2f6b3b, 0.2, 0.3);
    for (const [x, z] of [[-0.2, 0.1], [0.1, -0.15], [0.25, 0.2]] as const) {
      const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.26, 8), glass);
      bottle.position.set(x, 0.88, z);
      g.add(bottle);
    }
  } else {
    // Engradados de cerveja empilhados.
    const crate = std(0xb32424, 0.7, 0);
    const n = 5;
    for (let i = 0; i < n; i++) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.42), crate);
      box.position.set(((i % 2) - 0.5) * 0.65, 0.15 + Math.floor(i / 2) * 0.31, (i % 3) * 0.05 - 0.05);
      box.castShadow = true;
      g.add(box);
    }
  }
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  return g;
}

/** Balcão da loja: tampo, geladeira e prateleira atrás (substitui a barraca de cone). */
function shopCounter(b: { hw: number; hd: number; h: number; team?: 0 | 1 }): THREE.Group {
  const g = new THREE.Group();
  const c1 = TORCIDAS[b.team ?? 0]?.cores[1] ?? '#cccccc';
  const front = new THREE.Mesh(wallBox(b.hw * 2, b.h, b.hd * 2, 3), corrugatedMat(b.team ?? 0));
  front.position.y = b.h / 2;
  front.castShadow = true;
  g.add(front);
  const top = new THREE.Mesh(new THREE.BoxGeometry(b.hw * 2 + 0.15, 0.06, b.hd * 2 + 0.15), std(0x7a5a3a, 0.6, 0));
  top.position.y = b.h + 0.03;
  g.add(top);
  // Produtos em cima: rolos de bandagem (brancos) e caixas de curativo (com a cor da torcida).
  for (let i = 0; i < 4; i++) {
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 10), std(0xf2efe6, 0.9, 0));
    roll.position.set(-0.2 + (i % 2) * 0.18, b.h + 0.11, -0.9 + i * 0.22);
    g.add(roll);
  }
  const kit = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.4), std(c1, 0.6, 0));
  kit.position.set(0.15, b.h + 0.15, 0.6);
  g.add(kit);
  // Geladeira vermelha ao lado.
  const fridge = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.8, 0.7), std(0xc0262d, 0.4, 0.3));
  fridge.position.set(0, 0.9, -b.hd - 0.5);
  fridge.castShadow = true;
  g.add(fridge);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.1, 0.6), std(0x1b2c3a, 0.1, 0.6));
  door.position.set(0, 1.15, -b.hd - 0.5);
  g.add(door);
  return g;
}
