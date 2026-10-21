import { type GameMap, nextRandom, TORCIDAS } from '@torcidas/shared';
import * as THREE from 'three';

// Monta o estacionamento do estádio a partir do mesmo GameMap (seed) que o servidor usa para colisão.

export function buildScene(map: GameMap): { scene: THREE.Scene; sun: THREE.DirectionalLight } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b2233);
  scene.fog = new THREE.Fog(0x1b2233, 45, 120);

  scene.add(new THREE.HemisphereLight(0x9fb3d1, 0x2a2a2a, 0.9));
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
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
    new THREE.MeshStandardMaterial({ color: 0x2d3036, roughness: 0.95 }),
  );
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.receiveShadow = true;
  scene.add(asphalt);

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
  scene.add(lines);
  const lane = new THREE.Mesh(new THREE.PlaneGeometry(56, 0.15), new THREE.MeshBasicMaterial({ color: 0xe0b23a }));
  lane.rotation.x = -Math.PI / 2;
  lane.position.y = 0.012;
  for (const z of [-5, 5]) {
    const l = lane.clone();
    l.position.z = z;
    scene.add(l);
  }

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
    scene.add(fill);
    const border = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(a.hw * 2 - 0.4, a.hd * 2 - 0.4)),
      new THREE.LineBasicMaterial({ color: t.cores[1], transparent: true, opacity: 0.85 }),
    );
    border.rotation.x = -Math.PI / 2;
    border.position.set(a.x, 0.02, a.z);
    scene.add(border);
    const light = new THREE.PointLight(new THREE.Color(t.cores[1]), 40, 22);
    light.position.set(a.x, 4.5, a.z);
    scene.add(light);
  });

  // Obstáculos.
  const rng = { seed: map.seed ^ 0x5bd1e995 };
  for (const b of map.boxes) {
    const g = new THREE.Group();
    g.position.set(b.x, 0, b.z);
    switch (b.kind) {
      case 'carro':
        g.add(car(b.hw, b.hd, b.color, nextRandom(rng) < 0.5));
        break;
      case 'onibus':
        g.add(bus(b.hw, b.hd, b.h, b.color));
        break;
      case 'estadio':
        g.add(stadium(b.hw, b.hd, b.h));
        break;
      case 'barraca':
        g.add(tent(b.hw, b.hd, b.h, b.color));
        break;
      case 'carrinho':
        g.add(cart(b.hw, b.hd, b.h));
        break;
      default: {
        const wall = new THREE.Mesh(
          new THREE.BoxGeometry(b.hw * 2, b.h, b.hd * 2),
          new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.9, transparent: b.kind === 'grade', opacity: b.kind === 'grade' ? 0.55 : 1 }),
        );
        wall.position.y = b.h / 2;
        wall.castShadow = true;
        wall.receiveShadow = true;
        g.add(wall);
      }
    }
    scene.add(g);
  }
  for (const c of map.circles) {
    // Poucas luzes pontuais (custo por pixel): só os postes do corredor central acendem de verdade.
    if (c.kind === 'poste') scene.add(lightPole(c.x, c.z, c.z === 0));
    else {
      const bin = new THREE.Mesh(new THREE.CylinderGeometry(c.r, c.r * 0.9, 1, 12), new THREE.MeshStandardMaterial({ color: 0x2f6b3b }));
      bin.position.set(c.x, 0.5, c.z);
      bin.castShadow = true;
      scene.add(bin);
    }
  }

  return { scene, sun };
}

function std(color: THREE.ColorRepresentation, roughness = 0.6, metalness = 0.1) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function car(hw: number, hd: number, color: string, frontNorth: boolean): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, 0.75, hd * 2), std(color, 0.35, 0.4));
  body.position.y = 0.55;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(hw * 1.8, 0.55, hd * 1.05), std(0x1a2230, 0.1, 0.6));
  cabin.position.set(0, 1.18, frontNorth ? -0.25 : 0.25);
  cabin.castShadow = true;
  g.add(cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.25, 14);
  const wheelMat = std(0x111111, 0.9);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(sx * (hw - 0.05), 0.33, sz * (hd - 0.75));
      g.add(w);
    }
  }
  return g;
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

function tent(hw: number, hd: number, h: number, color: string): THREE.Group {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.ConeGeometry(Math.max(hw, hd) * 1.5, 1, 4), std(color, 0.8));
  top.position.y = h;
  top.rotation.y = Math.PI / 4;
  top.castShadow = true;
  g.add(top);
  const table = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, 0.9, hd * 2), std(0x8a6a44, 0.9));
  table.position.y = 0.45;
  table.castShadow = true;
  g.add(table);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, h, 6), std(0xcccccc));
      pole.position.set(sx * hw * 1.4, h / 2, sz * hd * 1.4);
      g.add(pole);
    }
  }
  return g;
}

function cart(hw: number, hd: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, h * 0.7, hd * 2), std(0xc9822b, 0.6));
  box.position.y = h * 0.5;
  box.castShadow = true;
  g.add(box);
  const grill = new THREE.Mesh(new THREE.BoxGeometry(hw * 1.8, 0.08, hd * 1.6), std(0x333333, 0.4, 0.8));
  grill.position.y = h * 0.86;
  g.add(grill);
  return g;
}

function stadium(hw: number, hd: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, h, hd * 2), std(0x9aa1a9, 0.85));
  wall.position.y = h / 2;
  wall.receiveShadow = true;
  g.add(wall);
  // Pilares e portões ao longo da fachada.
  const pillarMat = std(0xc7ccd2, 0.7);
  const gateMat = std(0x30353c, 0.5, 0.6);
  for (let x = -hw + 4; x < hw; x += 8) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, h + 2, 1.2), pillarMat);
    p.position.set(x, (h + 2) / 2, -hd - 0.4);
    p.castShadow = true;
    g.add(p);
    const gate = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 0.2), gateMat);
    gate.position.set(x + 4, 2, -hd - 0.05);
    g.add(gate);
  }
  // Cobertura das arquibancadas e refletores.
  const roof = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 4, 0.6, hd * 2 + 6), std(0xe6e8eb, 0.5));
  roof.position.set(0, h + 2.3, 1);
  g.add(roof);
  for (const x of [-hw + 6, hw - 6]) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 14, 8), std(0x8a9099));
    mast.position.set(x, h + 9, 0);
    g.add(mast);
    const head = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 0.6), new THREE.MeshBasicMaterial({ color: 0xfff8e0 }));
    head.position.set(x, h + 16, -1);
    g.add(head);
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
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.2, 0.4), new THREE.MeshBasicMaterial({ color: 0xffe9b0 }));
  lamp.position.y = 8;
  g.add(lamp);
  if (withLight) {
    const l = new THREE.PointLight(0xffd99a, 40, 18, 1.6);
    l.position.y = 7.6;
    g.add(l);
  }
  return g;
}
