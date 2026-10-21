import {
  attackPhase,
  type CharacterVisual,
  DEFAULT_COMBAT_DATA,
  type FighterSnapshot,
  findMove,
  type MoveDef,
  randomVisual,
  TORCIDAS,
  visualColor,
  visualSeed,
} from '@torcidas/shared';
import * as THREE from 'three';

// Boneco humano procedural com juntas (quadril/joelho, ombro/cotovelo). A pose alvo é
// função pura do estado da simulação (estado, stateTick, frame data) e as juntas
// interpolam até ela, então a animação segue o tick e as transições ficam suaves.
// TODO(polimento): trocar por glTF rigado (Quaternius/Mixamo) mantendo esta mesma lógica de pose.

const data = DEFAULT_COMBAT_DATA;
/** Altura e largura do tronco/ombros por opção do visual. */
const HEIGHT = { baixo: 0.93, medio: 1, alto: 1.07 } as const;
const BUILD = { magro: { torso: 0.86, shoulder: 0.215, hip: 0.09 }, normal: { torso: 1, shoulder: 0.235, hip: 0.095 }, forte: { torso: 1.17, shoulder: 0.262, hip: 0.1 } } as const;

interface Pose {
  hipL: number;
  kneeL: number;
  hipR: number;
  kneeR: number;
  hipLz: number;
  hipRz: number;
  shL: number;
  shLz: number;
  elL: number;
  shR: number;
  shRz: number;
  elR: number;
  spineX: number;
  spineY: number;
  headX: number;
  pelvisY: number;
  /** Queda: rotação do corpo inteiro em torno dos pés (para trás = negativo). */
  fall: number;
  /** Giro extra do corpo inteiro (rodada do taco). */
  spin: number;
}

/** Guarda de briga: punhos na altura do rosto, joelhos levemente dobrados. */
const GUARD: Pose = {
  hipL: -0.12,
  kneeL: 0.25,
  hipR: 0.08,
  kneeR: 0.2,
  hipLz: 0.05,
  hipRz: -0.05,
  shL: -0.55,
  shLz: 0.15,
  elL: -1.9,
  shR: -0.45,
  shRz: -0.15,
  elR: -1.9,
  spineX: 0.08,
  spineY: -0.15,
  headX: -0.05,
  pelvisY: -0.04,
  fall: 0,
  spin: 0,
};

const KEYS = Object.keys(GUARD) as (keyof Pose)[];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const mat = (color: THREE.ColorRepresentation, roughness = 0.75) => new THREE.MeshStandardMaterial({ color, roughness });

/** Segmento de membro pendurado para baixo a partir da junta. */
function segment(len: number, rTop: number, rBot: number, m: THREE.Material): THREE.Mesh {
  const g = new THREE.CylinderGeometry(rTop, rBot, len, 10);
  g.translate(0, -len / 2, 0);
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  return mesh;
}

function joint(r: number, m: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), m);
  mesh.castShadow = true;
  return mesh;
}

export class CharacterView {
  readonly root = new THREE.Group();
  private readonly yawG = new THREE.Group();
  private readonly fallG = new THREE.Group();
  private readonly rollG = new THREE.Group();
  private readonly pelvis = new THREE.Group();
  private readonly spine = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly hipL = new THREE.Group();
  private readonly hipR = new THREE.Group();
  private readonly kneeL = new THREE.Group();
  private readonly kneeR = new THREE.Group();
  private readonly shL = new THREE.Group();
  private readonly shR = new THREE.Group();
  private readonly elL = new THREE.Group();
  private readonly elR = new THREE.Group();
  private readonly handR = new THREE.Group();
  private readonly weapon = new THREE.Group();
  private readonly shirtMat: THREE.MeshStandardMaterial;
  private readonly allMats: THREE.MeshStandardMaterial[] = [];
  private readonly guard: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly aura: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly label: THREE.Sprite;
  /** Seta vermelha sobre a cabeça: este é o seu alvo travado. */
  private readonly lockMarker: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>;
  private locked = false;
  private readonly hpBar: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly hpBack: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly shirtColor: THREE.Color;
  private pose: Pose = { ...GUARD };
  private walkPhase = 0;
  private lastPos = new THREE.Vector2(Number.NaN, Number.NaN);
  private velLocal = new THREE.Vector2();
  private weaponId = '';
  private breath: number;

  /**
   * `visual` vem do roster; sem ele (bots, perfis que nunca escolheram), sorteia um pelo id,
   * então cada um continua com a mesma cara a partida inteira.
   */
  constructor(
    readonly id: string,
    team: 0 | 1,
    nick: string,
    readonly isSelf: boolean,
    allied: boolean,
    visual?: CharacterVisual,
  ) {
    const h = hash(id);
    const v = visual ?? randomVisual(visualSeed(id));
    this.breath = (h % 100) / 10;
    const t = TORCIDAS[team];
    this.shirtColor = new THREE.Color(t.cores[0]);
    const trim = new THREE.Color(t.cores[1]);
    const skin = mat(visualColor('pele', v.pele), 0.6);
    this.shirtMat = mat(this.shirtColor, 0.85);
    const trimMat = mat(trim, 0.85);
    const shorts = mat(team === 0 ? 0x111111 : 0xf5f5f5, 0.85);
    const socks = mat(team === 0 ? 0x111111 : 0xe30613, 0.9);
    const shoes = mat([0xf2f2f2, 0x1a1a1a, 0x2d4a8a, 0xb5352b][(h >> 3) % 4] ?? 0x1a1a1a, 0.5);
    const hair = mat(visualColor('corCabelo', v.corCabelo), 0.9);
    const eyeMat = mat(0x111111, 0.3);
    this.allMats.push(skin, this.shirtMat, trimMat, shorts, socks, shoes, hair, eyeMat);
    const scale = HEIGHT[v.altura];
    const build = BUILD[v.corpo];
    // Regata: ombro e braço de fora (pele) em vez da manga da camisa.
    const sleeve = v.camisa === 'regata' ? skin : this.shirtMat;

    // Hierarquia: root(pos) > yaw > fall (pivô nos pés) > roll > pelvis > (spine > cabeça, ombros) + quadris.
    this.root.add(this.yawG);
    this.yawG.add(this.fallG);
    this.fallG.add(this.rollG);
    this.rollG.position.y = 0.55;
    this.rollG.add(this.pelvis);
    this.pelvis.position.y = 0.4; // quadril a ~0.95 m
    this.yawG.scale.setScalar(scale);

    const hips = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.16, 0.22, 12), shorts);
    hips.scale.z = 0.7;
    hips.castShadow = true;
    this.pelvis.add(hips);

    // Tronco: camisa da torcida com faixa na cor secundária.
    this.spine.position.y = 0.08;
    this.pelvis.add(this.spine);
    const torsoG = new THREE.CylinderGeometry(0.21, 0.165, 0.5, 14);
    torsoG.translate(0, 0.27, 0);
    const torso = new THREE.Mesh(torsoG, this.shirtMat);
    torso.scale.set(build.torso, 1, 0.62 * build.torso);
    torso.castShadow = true;
    // Faixa na cor secundária: uma na lisa, três na listrada.
    const bands = v.camisa === 'listrada' ? [0.16, 0.29, 0.42] : [0.36];
    for (const y of bands) {
      const stripeG = new THREE.CylinderGeometry(0.212, 0.2, v.camisa === 'listrada' ? 0.05 : 0.07, 14);
      stripeG.translate(0, y, 0);
      const stripe = new THREE.Mesh(stripeG, trimMat);
      stripe.scale.set(build.torso, 1, 0.63 * build.torso);
      this.spine.add(stripe);
    }
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.018, 6, 14), trimMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.53;
    const neck = segment(0.09, 0.05, 0.055, skin);
    neck.position.y = 0.6;
    this.spine.add(torso, collar, neck);
    if (v.acessorio === 'corrente') {
      const gold = mat(0xd4a017, 0.25);
      gold.metalness = 0.8;
      this.allMats.push(gold);
      const chain = new THREE.Mesh(new THREE.TorusGeometry(0.1 * build.torso, 0.012, 6, 20), gold);
      chain.rotation.x = Math.PI / 2 + 0.35;
      chain.position.set(0, 0.5, 0.03);
      this.spine.add(chain);
    }

    // Cabeça.
    this.head.position.y = 0.6;
    this.spine.add(this.head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), skin);
    skull.scale.set(0.92, 1.12, 1);
    skull.position.y = 0.11;
    skull.castShadow = true;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.04, 6), skin);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 0.1, 0.11);
    const earG = new THREE.SphereGeometry(0.025, 6, 6);
    const earL = new THREE.Mesh(earG, skin);
    earL.position.set(0.1, 0.1, 0);
    const earR = new THREE.Mesh(earG, skin);
    earR.position.set(-0.1, 0.1, 0);
    const eyeG = new THREE.SphereGeometry(0.012, 6, 6);
    const eyeL = new THREE.Mesh(eyeG, eyeMat);
    eyeL.position.set(0.035, 0.13, 0.095);
    const eyeR = new THREE.Mesh(eyeG, eyeMat);
    eyeR.position.set(-0.035, 0.13, 0.095);
    this.head.add(skull, nose, earL, earR, eyeL, eyeR);
    this.buildHair(v, hair);
    this.buildBeard(v, hair);
    this.buildHeadwear(v, trimMat);

    // Braços. O lado direito do personagem é -X (ele olha para +Z).
    const arm = (side: 1 | -1, sh: THREE.Group, el: THREE.Group) => {
      sh.position.set(side * build.shoulder, 0.48, 0);
      this.spine.add(sh);
      sh.add(joint(0.062, sleeve), segment(0.13, 0.064, 0.058, sleeve), segment(0.28, 0.05, 0.043, skin));
      el.position.y = -0.28;
      sh.add(el);
      const fist = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.09, 0.085), skin);
      fist.position.y = -0.29;
      fist.castShadow = true;
      el.add(joint(0.044, skin), segment(0.25, 0.043, 0.034, skin), fist);
    };
    arm(1, this.shL, this.elL);
    arm(-1, this.shR, this.elR);
    this.handR.position.y = -0.29;
    this.elR.add(this.handR);
    this.handR.add(this.weapon);

    // Pernas: calção, coxa, joelho, canela, meião e tênis.
    const leg = (side: 1 | -1, hip: THREE.Group, knee: THREE.Group) => {
      hip.position.set(side * build.hip, -0.06, 0);
      this.pelvis.add(hip);
      hip.add(segment(0.2, 0.085, 0.075, shorts), segment(0.42, 0.075, 0.055, skin));
      knee.position.y = -0.42;
      hip.add(knee);
      const sock = segment(0.14, 0.045, 0.04, socks);
      sock.position.y = -0.27;
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.25), shoes);
      shoe.position.set(0, -0.44, 0.05);
      shoe.castShadow = true;
      knee.add(joint(0.055, skin), segment(0.3, 0.055, 0.04, skin), sock, shoe);
    };
    leg(1, this.hipL, this.kneeL);
    leg(-1, this.hipR, this.kneeR);

    this.guard = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.66, 32, 1, Math.PI / 2 - 1.3, 2.6),
      new THREE.MeshBasicMaterial({ color: 0x90e0ef, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.guard.position.y = 0.04;
    this.root.add(this.guard);
    // Aura do Grito da Torcida (buff).
    this.aura = new THREE.Mesh(
      new THREE.RingGeometry(0.35, 0.75, 32),
      new THREE.MeshBasicMaterial({ color: 0xffc300, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.aura.rotation.x = -Math.PI / 2;
    this.aura.position.y = 0.03;
    this.root.add(this.aura);

    this.label = makeLabel(nick, allied ? '#9be7ff' : '#ff8a8a');
    this.label.position.y = 2.2;
    this.root.add(this.label);
    this.hpBack = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.07), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6, depthTest: false }));
    this.hpBar = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.07), new THREE.MeshBasicMaterial({ color: allied ? 0x4ade80 : 0xef4444, depthTest: false }));
    this.hpBack.position.y = this.hpBar.position.y = 2.02;
    this.hpBack.renderOrder = 10;
    this.hpBar.renderOrder = 11;
    this.root.add(this.hpBack, this.hpBar);
    this.lockMarker = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.3, 4),
      new THREE.MeshBasicMaterial({ color: 0xff3b4e, depthTest: false, transparent: true, opacity: 0.95 }),
    );
    this.lockMarker.rotation.x = Math.PI; // ponta para baixo
    this.lockMarker.renderOrder = 13;
    this.lockMarker.visible = false;
    this.root.add(this.lockMarker);
  }

  private buildHair(v: CharacterVisual, hair: THREE.Material): void {
    const cap = (radius: number, cover: number, sy: number) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 8, 0, Math.PI * 2, 0, Math.PI * cover), hair);
      m.scale.set(0.95, sy, 1.04);
      m.position.set(0, 0.13, -0.008);
      m.rotation.x = -0.25;
      m.castShadow = true;
      return m;
    };
    switch (v.cabelo) {
      case 'careca':
        break;
      case 'raspado':
        this.head.add(cap(0.1115, 0.5, 1.12));
        break;
      case 'curto':
        this.head.add(cap(0.113, 0.55, 1.1));
        break;
      case 'black': {
        const afro = new THREE.Mesh(new THREE.SphereGeometry(0.165, 16, 12), hair);
        afro.scale.set(1, 0.85, 0.95);
        afro.position.set(0, 0.2, -0.03);
        afro.castShadow = true;
        this.head.add(afro);
        break;
      }
      case 'moicano': {
        this.head.add(cap(0.1115, 0.5, 1.12));
        const crest = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.08, 0.22), hair);
        crest.position.set(0, 0.25, -0.01);
        crest.castShadow = true;
        this.head.add(crest);
        break;
      }
      case 'rabo': {
        this.head.add(cap(0.114, 0.58, 1.1));
        const tail = segment(0.16, 0.03, 0.018, hair);
        tail.position.set(0, 0.19, -0.11);
        tail.rotation.x = -0.5;
        this.head.add(tail);
        break;
      }
    }
  }

  private buildBeard(v: CharacterVisual, hair: THREE.Material): void {
    if (v.barba === 'cavanhaque' || v.barba === 'cheia') {
      const goatee = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.045, 0.03), hair);
      goatee.position.set(0, 0.025, 0.088);
      this.head.add(goatee);
    }
    if (v.barba === 'bigode' || v.barba === 'cheia' || v.barba === 'cavanhaque') {
      const stache = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.014, 0.02), hair);
      stache.position.set(0, 0.07, 0.1);
      this.head.add(stache);
    }
    if (v.barba === 'cheia') {
      const beard = new THREE.Mesh(new THREE.SphereGeometry(0.105, 14, 8, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45), hair);
      beard.scale.set(0.95, 1.05, 1.02);
      beard.position.set(0, 0.105, 0.01);
      this.head.add(beard);
    }
  }

  private buildHeadwear(v: CharacterVisual, trimMat: THREE.Material): void {
    if (v.acessorio === 'bone') {
      // Boné na cor da torcida, com aba para a frente.
      const crown = new THREE.Mesh(new THREE.SphereGeometry(0.118, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), this.shirtMat);
      crown.scale.set(0.97, 0.9, 1.05);
      crown.position.set(0, 0.15, 0);
      const brim = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, 0.11), trimMat);
      brim.position.set(0, 0.155, 0.13);
      brim.rotation.x = 0.12;
      crown.castShadow = brim.castShadow = true;
      this.head.add(crown, brim);
    } else if (v.acessorio === 'bandana') {
      const cloth = mat(0xc1121f, 0.9);
      this.allMats.push(cloth);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.104, 0.018, 6, 20), cloth);
      band.rotation.x = Math.PI / 2 - 0.2;
      band.scale.set(0.95, 1.04, 1);
      band.position.set(0, 0.175, 0);
      this.head.add(band);
    } else if (v.acessorio === 'oculos') {
      const glass = mat(0x0b0b0b, 0.15);
      glass.metalness = 0.4;
      this.allMats.push(glass);
      const lensG = new THREE.BoxGeometry(0.042, 0.026, 0.012);
      for (const side of [1, -1]) {
        const lens = new THREE.Mesh(lensG, glass);
        lens.position.set(side * 0.036, 0.13, 0.104);
        this.head.add(lens);
      }
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.006, 0.008), glass);
      bridge.position.set(0, 0.135, 0.106);
      this.head.add(bridge);
    }
  }

  /** Marca este boneco como o alvo travado do jogador. */
  setLocked(on: boolean): void {
    this.locked = on;
  }

  private setWeapon(id: string): void {
    if (id === this.weaponId) return;
    this.weaponId = id;
    for (const c of [...this.weapon.children]) {
      this.weapon.remove(c);
      if (c instanceof THREE.Mesh) c.geometry.dispose();
    }
    if (!data.weapons[id] || id === 'punhos') return;
    const metal = new THREE.MeshStandardMaterial({ color: 0xc8d0dc, roughness: 0.3, metalness: 0.8 });
    const wood = mat(0x9c6b3c, 0.8);
    const dark = mat(0x222222, 0.6);
    const glass = new THREE.MeshStandardMaterial({ color: 0x2a9d8f, roughness: 0.1, transparent: true, opacity: 0.75 });
    this.allMats.push(metal, wood, dark, glass);
    // Cilindro ao longo do +Z local da arma, saindo da mão.
    const along = (len: number, r1: number, r2: number, m: THREE.Material, offset = 0) => {
      const g = new THREE.CylinderGeometry(r2, r1, len, 10);
      g.rotateX(Math.PI / 2);
      g.translate(0, 0, offset + len / 2);
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = true;
      this.weapon.add(mesh);
    };
    // Com o antebraço pendurado, a arma aponta para frente; com o braço estendido, aponta para o alvo.
    this.weapon.rotation.x = Math.PI / 2 - 0.3;
    switch (id) {
      case 'soqueira': {
        const ring = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 0.05), metal);
        ring.position.set(0, 0.0, 0.05);
        this.weapon.add(ring);
        this.weapon.rotation.x = 0;
        break;
      }
      case 'garrafa':
        along(0.09, 0.02, 0.02, glass, -0.04);
        along(0.16, 0.038, 0.038, glass, 0.05);
        break;
      case 'caco':
        along(0.09, 0.02, 0.02, glass, -0.04);
        along(0.08, 0.05, 0.03, glass, 0.05);
        break;
      case 'faca':
        along(0.1, 0.018, 0.018, dark, -0.05);
        along(0.17, 0.022, 0.004, metal, 0.05);
        break;
      case 'punhal':
        along(0.11, 0.018, 0.018, dark, -0.05);
        along(0.24, 0.02, 0.003, metal, 0.06);
        break;
      case 'cassetete':
        along(0.6, 0.025, 0.025, dark, -0.08);
        break;
      case 'taco':
        along(0.85, 0.02, 0.045, wood, -0.1);
        break;
      case 'barra':
        along(0.95, 0.018, 0.018, metal, -0.15);
        break;
    }
  }

  /** Pose alvo para o estado atual. */
  private targetPose(f: FighterSnapshot, speed: number): { p: Pose; crisp: boolean; roll: number } {
    const p: Pose = { ...GUARD };
    const t = f.stateTick;
    const def = findMove(data, f.move);
    let crisp = false; // golpes e quedas seguem o frame data mais de perto
    let roll = 0;

    // Locomoção.
    const run = f.running;
    const amt = Math.min(1, speed / (run ? 6.8 : 4));
    const s = Math.sin(this.walkPhase);
    const c = Math.cos(this.walkPhase);
    if (amt > 0.05) {
      const legA = (run ? 0.95 : 0.55) * amt;
      p.hipL = -s * legA - 0.1;
      p.hipR = s * legA - 0.1;
      // O joelho dobra na perna que está atrás (fase de balanço).
      p.kneeL = 0.2 + Math.max(0, -s) * (run ? 1.5 : 0.8) * amt;
      p.kneeR = 0.2 + Math.max(0, s) * (run ? 1.5 : 0.8) * amt;
      p.pelvisY = -0.03 - Math.abs(c) * (run ? 0.06 : 0.025) * amt;
      if (run) {
        p.shL = s * 0.9;
        p.shR = -s * 0.9;
        p.elL = p.elR = -1.4;
        p.shLz = 0.1;
        p.shRz = -0.1;
        p.spineX = 0.32;
        p.spineY = 0;
        p.headX = -0.2;
      } else {
        p.shL += s * 0.15;
        p.shR -= s * 0.15;
      }
    } else {
      p.spineX += Math.sin(this.breath) * 0.02;
      p.pelvisY += Math.sin(this.breath) * 0.008;
    }

    // No ar (pulo): pernas recolhidas, braços para cima.
    if (f.y > 0.02 && f.state === 'idle') {
      p.hipL = -0.9;
      p.hipR = -0.3;
      p.kneeL = 1.4;
      p.kneeR = 0.9;
      p.shL = -1.2;
      p.shR = -1.0;
      p.elL = p.elR = -1.2;
      p.spineX = 0.1;
    }

    switch (f.state) {
      case 'attack':
        if (def) {
          crisp = true;
          this.attackPose(p, def, t);
        }
        break;
      case 'charging':
        p.shR = -2.5;
        p.shRz = 0.5;
        p.elR = -1.0;
        p.spineY = -0.6;
        p.spineX = -0.05;
        p.kneeL = p.kneeR = 0.5;
        p.hipL = p.hipR = -0.35;
        p.pelvisY = -0.1;
        break;
      case 'block':
      case 'blockstun':
        p.shL = p.shR = -1.35;
        p.shLz = -0.35;
        p.shRz = 0.35;
        p.elL = p.elR = -2.1;
        p.spineX = f.state === 'blockstun' ? -0.05 : 0.18;
        p.headX = 0.15;
        p.kneeL = p.kneeR = 0.45;
        p.hipL = p.hipR = -0.3;
        p.pelvisY = -0.08;
        break;
      case 'dodge':
        if (f.dodgeKind === 'step') {
          // Passo: abaixa e inclina para o lado do movimento.
          roll = 0.35 * Math.sin(Math.min(1, t / 12) * Math.PI);
          p.kneeL = p.kneeR = 0.7;
          p.hipL = p.hipR = -0.45;
          p.pelvisY = -0.12;
          p.spineX = 0.2;
          break;
        }
        roll = Math.min(1, t / 22) * Math.PI * 2;
        p.hipL = p.hipR = -1.6;
        p.kneeL = p.kneeR = 2.1;
        p.shL = p.shR = -1.2;
        p.elL = p.elR = -1.8;
        p.spineX = 0.7;
        p.headX = 0.5;
        p.pelvisY = -0.35;
        break;
      case 'hitstun': {
        const k = Math.max(0, 1 - t / Math.max(1, f.stateDuration));
        p.spineX = -0.45 * k;
        p.headX = -0.5 * k;
        p.shL = 0.2;
        p.shR = 0.3;
        p.elL = p.elR = -0.6;
        p.shLz = 0.6 * k;
        p.shRz = -0.6 * k;
        p.hipL = 0.15;
        p.kneeR = 0.5;
        break;
      }
      case 'staggered':
      case 'guardbreak':
        p.spineX = -0.25 + Math.sin(t * 0.35) * 0.12;
        p.spineY = Math.sin(t * 0.21) * 0.3;
        p.headX = -0.3;
        p.shL = p.shR = 0.1;
        p.elL = p.elR = -0.4;
        p.shLz = 0.4;
        p.shRz = -0.4;
        p.kneeL = 0.5 + Math.sin(t * 0.3) * 0.2;
        p.kneeR = 0.5 - Math.sin(t * 0.3) * 0.2;
        p.pelvisY = -0.08;
        break;
      case 'knockdown':
      case 'ko':
      case 'dead': {
        const k = f.state === 'dead' ? 1 : Math.min(1, t / (f.state === 'ko' ? 20 : 10));
        p.fall = -k * (Math.PI / 2 - 0.08);
        p.spineX = -0.2 * k;
        p.headX = -0.3 * k;
        p.shL = p.shR = -2.6 * k;
        p.shLz = 0.5;
        p.shRz = -0.5;
        p.elL = p.elR = -0.3;
        p.hipL = -0.3 * k;
        p.kneeL = 0.6 * k;
        p.hipR = 0.1;
        p.kneeR = 0.1;
        crisp = true;
        break;
      }
      case 'shout': {
        const pulse = Math.sin(t * 0.5) * 0.15;
        p.shL = p.shR = -2.7 + pulse;
        p.shLz = 0.45;
        p.shRz = -0.45;
        p.elL = p.elR = -0.5;
        p.headX = -0.45;
        p.spineX = -0.2;
        p.kneeL = p.kneeR = 0.35;
        p.pelvisY = -0.06;
        break;
      }
      case 'healing':
        // Enfaixando o antebraço.
        p.shL = -0.9;
        p.elL = -1.2;
        p.shR = -1.0;
        p.elR = -1.6 + Math.sin(t * 0.4) * 0.3;
        p.shRz = 0.55;
        p.headX = 0.35;
        p.spineX = 0.2;
        break;
      case 'eating':
        // Churrasquinho na boca, mastigando.
        p.shR = -1.25;
        p.elR = -2.4;
        p.shRz = 0.35;
        p.headX = Math.sin(t * 0.6) * 0.08;
        break;
      case 'reviving':
        // Ajoelhado puxando o aliado.
        p.hipL = -1.4;
        p.kneeL = 1.5;
        p.hipR = 0.25;
        p.kneeR = 1.9;
        p.pelvisY = -0.45;
        p.shL = p.shR = -0.9 + Math.sin(t * 0.25) * 0.15;
        p.elL = p.elR = -0.3;
        p.spineX = 0.45;
        p.headX = 0.2;
        break;
      case 'downed': {
        // De bruços, rastejando com os braços.
        const crawl = Math.sin(this.walkPhase * 1.6);
        p.fall = Math.PI / 2 - 0.12;
        crisp = true;
        p.shL = -2.9 + crawl * 0.5;
        p.shR = -2.9 - crawl * 0.5;
        p.elL = p.elR = -0.4;
        p.shLz = 0.3;
        p.shRz = -0.3;
        p.hipL = 0.1 + crawl * 0.3;
        p.hipR = 0.1 - crawl * 0.3;
        p.kneeL = p.kneeR = 0.4;
        p.headX = -0.6;
        p.spineX = 0;
        p.spineY = 0;
        p.pelvisY = 0;
        break;
      }
      case 'getup': {
        const k = 1 - Math.min(1, t / Math.max(1, f.stateDuration));
        p.fall = -k * (Math.PI / 2 - 0.08);
        p.hipL = p.hipR = -1.2 * k;
        p.kneeL = p.kneeR = 1.6 * k + 0.2;
        p.shL = p.shR = 0.4 * k;
        break;
      }
      default:
        break;
    }
    return { p, crisp, roll };
  }

  private attackPose(p: Pose, def: MoveDef, t: number): void {
    const ph = attackPhase(def, Math.max(1, Math.round(t)));
    const kStart = Math.min(1, t / Math.max(1, def.startup));
    const kAct = Math.min(1, (t - def.startup) / Math.max(1, def.active));
    const kRec = Math.min(1, (t - def.startup - def.active) / Math.max(1, def.recovery));

    if (def.kind === 'kick') {
      if (ph === 'startup') {
        p.hipR = -1.3 * kStart;
        p.kneeR = 1.6 * kStart;
      } else if (ph === 'active') {
        p.hipR = -1.45;
        p.kneeR = 0.15;
      } else {
        p.hipR = -1.45 * (1 - kRec);
        p.kneeR = 0.15 + 0.5 * (1 - kRec);
      }
      p.spineX = -0.25;
      p.kneeL = 0.3;
      p.shL = -0.9;
      p.shR = -0.5;
      return;
    }
    if (def.kind === 'shove') {
      const ext = ph === 'startup' ? 0 : ph === 'active' ? 1 : 1 - kRec;
      p.shL = p.shR = -1.0 - 0.55 * ext;
      p.elL = p.elR = -1.9 + 1.8 * ext;
      p.shLz = -0.2;
      p.shRz = 0.2;
      p.spineX = 0.1 + 0.3 * ext;
      p.hipL = -0.6 * ext;
      p.kneeL = 0.5;
      return;
    }

    if (def.id === 'voadora') {
      // Corpo quase na horizontal, perna da frente esticada.
      const k = ph === 'startup' ? kStart : ph === 'active' ? 1 : 1 - kRec;
      p.spineX = -0.55 * k;
      p.hipR = -1.55 * k;
      p.kneeR = 0.1;
      p.hipL = -0.5 * k;
      p.kneeL = 1.3 * k;
      p.shL = -1.2 * k;
      p.shR = 0.6 * k;
      p.shLz = 0.8 * k;
      p.shRz = -0.8 * k;
      p.elL = p.elR = -0.3;
      return;
    }
    if (def.id === 'cabecada') {
      const back = ph === 'startup' ? kStart : 0;
      const fwd = ph === 'active' ? 1 : ph === 'recovery' ? 1 - kRec : 0;
      p.spineX = -0.35 * back + 0.65 * fwd;
      p.headX = -0.4 * back + 0.5 * fwd;
      p.shL = p.shR = -0.9;
      p.elL = p.elR = -1.0;
      p.shLz = -0.4;
      p.shRz = 0.4;
      return;
    }

    const weapon = def.id.split('.')[0] ?? 'punhos';
    const unarmed = weapon === 'punhos' || weapon === 'soqueira';
    if (def.kind === 'special') {
      this.specialPose(p, def, weapon, ph, kStart, kAct, kRec, t);
      return;
    }
    const stab = def.hitbox.shape === 'capsule';
    const idx = def.id.endsWith('l2') ? 2 : def.id.endsWith('l3') ? 3 : def.kind === 'heavy' ? 4 : 1;

    if (unarmed) {
      // l1: jab de direita · l2: direto de esquerda · l3: gancho de direita · pesado: cruzado carregado.
      const left = idx === 2;
      const hook = idx === 3 || idx === 4;
      const ext = ph === 'startup' ? -0.3 * kStart : ph === 'active' ? 1 : 1 - kRec;
      const e = Math.max(0, ext);
      const sh = hook ? -1.25 : -0.5 - 1.05 * e;
      const shz = hook ? -1.1 + 0.6 * e : 0;
      const el = hook ? -1.4 : -1.9 + 1.8 * e;
      if (left) {
        p.shL = sh;
        p.shLz = -shz;
        p.elL = el;
      } else {
        p.shR = sh;
        p.shRz = shz;
        p.elR = el;
      }
      // Ry positivo leva o ombro direito (-X) para frente.
      p.spineY = (left ? -1 : 1) * (hook ? 0.7 : 0.45) * ext;
      p.spineX = 0.15 + 0.1 * e;
      p.hipL = -0.3;
      p.kneeL = 0.4;
      return;
    }
    if (stab) {
      // Estocada: puxa para trás no startup e projeta para frente no active.
      const ext = ph === 'startup' ? -kStart : ph === 'active' ? 1 : 1 - kRec;
      const e = Math.max(0, ext);
      p.shR = -0.6 - 0.95 * e + 0.4 * Math.max(0, -ext);
      p.elR = -1.7 + 1.6 * e;
      p.shRz = 0;
      p.spineY = 0.5 * ext;
      p.spineX = 0.2;
      p.hipL = -0.5 * e;
      p.kneeL = 0.5;
      return;
    }
    // Arma de golpear: levanta por cima do ombro e varre na diagonal.
    const big = def.kind === 'heavy' || weapon === 'taco' || weapon === 'barra';
    if (ph === 'startup') {
      p.shR = -2.5 * kStart;
      p.shRz = 0.6 * kStart;
      p.elR = -1.2 * kStart;
      p.spineY = -0.6 * kStart * (big ? 1.2 : 0.8);
      p.shL = -0.7;
    } else if (ph === 'active') {
      p.shR = -2.5 + 2.0 * kAct;
      p.shRz = 0.6 - 1.3 * kAct;
      p.elR = -1.2 + 1.1 * kAct;
      p.spineY = -0.6 + 1.3 * kAct;
      p.spineX = 0.3;
    } else {
      p.shR = -0.5 * (1 - kRec) - 0.45 * kRec;
      p.shRz = -0.7 * (1 - kRec);
      p.elR = -0.1 - 1.8 * kRec;
      p.spineY = 0.7 * (1 - kRec);
      p.spineX = 0.3 * (1 - kRec);
    }
    p.hipL = -0.4;
    p.kneeL = 0.5;
    p.kneeR = 0.3;
  }

  private specialPose(p: Pose, def: MoveDef, weapon: string, ph: string, kStart: number, kAct: number, kRec: number, t: number): void {
    if (def.multiHit) {
      // Sequência de rua: socos alternados, um por segmento.
      const iv = def.multiHit.interval;
      const seg = Math.max(0, Math.floor((t - def.startup - 1) / iv));
      const inSeg = ph === 'active' ? (((t - def.startup - 1) % iv) + iv) % iv / iv : 0;
      const ext = ph === 'startup' ? 0 : ph === 'active' ? Math.sin(inSeg * Math.PI) : 1 - kRec;
      const left = seg % 2 === 1;
      if (left) {
        p.shL = -0.5 - 1.1 * ext;
        p.elL = -1.9 + 1.8 * ext;
      } else {
        p.shR = -0.5 - 1.1 * ext;
        p.elR = -1.9 + 1.8 * ext;
      }
      p.spineY = (left ? -1 : 1) * 0.45 * ext;
      p.spineX = 0.25;
      p.hipL = -0.4;
      p.kneeL = 0.5;
      p.kneeR = 0.4;
      return;
    }
    switch (weapon) {
      case 'taco':
        // Rodada: braços abertos e corpo girando 360° no active.
        p.shR = -1.45;
        p.shRz = 1.0;
        p.elR = -0.1;
        p.shL = -1.3;
        p.shLz = -0.6;
        p.spin = ph === 'startup' ? -0.6 * kStart : ph === 'active' ? -0.6 + (Math.PI * 2 + 0.6) * kAct : 0;
        p.kneeL = p.kneeR = 0.45;
        p.pelvisY = -0.08;
        return;
      case 'barra':
      case 'garrafa':
      case 'caco': {
        // Martelada/garrafada: os dois braços por cima da cabeça e desce com tudo.
        const up = ph === 'startup' ? kStart : 0;
        const down = ph === 'active' ? kAct : ph === 'recovery' ? 1 - kRec * 0.5 : 0;
        p.shR = p.shL = ph === 'startup' ? -3.0 * up : -3.0 + 2.3 * down;
        p.elR = p.elL = -0.6 * up;
        p.shLz = -0.3;
        p.shRz = 0.3;
        p.spineX = -0.25 * up + 0.55 * down;
        p.kneeL = p.kneeR = 0.3 + 0.4 * down;
        p.pelvisY = -0.12 * down;
        return;
      }
      case 'cassetete':
        // Varredura baixa.
        p.kneeL = p.kneeR = 0.9;
        p.hipL = p.hipR = -0.6;
        p.pelvisY = -0.22;
        p.shR = -0.9;
        p.shRz = ph === 'startup' ? 1.2 * kStart : ph === 'active' ? 1.2 - 2.4 * kAct : -1.2 * (1 - kRec);
        p.spineY = ph === 'active' ? -0.6 + 1.2 * kAct : 0;
        p.spineX = 0.35;
        return;
      default: {
        // Faca/punhal: corte largo ou estocada funda.
        const ext = ph === 'startup' ? -kStart : ph === 'active' ? 1 : 1 - kRec;
        const e = Math.max(0, ext);
        p.shR = -0.5 - 1.1 * e;
        p.elR = -1.8 + 1.7 * e;
        p.shRz = weapon === 'faca' ? 1.0 - 2.0 * (ph === 'active' ? kAct : ph === 'recovery' ? 1 : 0) : 0;
        p.spineY = 0.6 * ext;
        p.spineX = 0.3;
        p.hipL = -0.7 * e;
        p.kneeL = 0.7;
      }
    }
  }

  update(f: FighterSnapshot, camera: THREE.Camera, dt: number): void {
    this.root.position.set(f.pos.x, f.y, f.pos.z);
    this.yawG.rotation.y = f.facing;
    // Anel no chão: com Euler XYZ, +Y local aponta para dirFromYaw(facing) quando z = facing + PI.
    this.guard.rotation.set(-Math.PI / 2, 0, f.facing + Math.PI);
    this.guard.position.y = 0.04 - f.y;
    this.setWeapon(f.weapon);
    this.breath += dt * 2.2;

    // Velocidade: ciclo de passos e direção do rolamento.
    let speed = 0;
    if (!Number.isNaN(this.lastPos.x) && dt > 0) {
      const dx = f.pos.x - this.lastPos.x;
      const dz = f.pos.z - this.lastPos.y;
      const moved = Math.hypot(dx, dz);
      if (moved < 2) {
        speed = moved / dt;
        this.walkPhase += moved * (f.running ? 2.6 : 3.4);
      }
      if (moved > 1e-4 && moved < 2) {
        // Direção no espaço local do boneco (inverso do yaw).
        const cos = Math.cos(f.facing);
        const sin = Math.sin(f.facing);
        this.velLocal.set(dx * cos - dz * sin, dx * sin + dz * cos).normalize();
      }
    }
    this.lastPos.set(f.pos.x, f.pos.z);

    const { p: target, crisp, roll } = this.targetPose(f, speed);
    const k = 1 - Math.exp(-dt * (crisp ? 30 : 14));
    for (const key of KEYS) this.pose[key] += (target[key] - this.pose[key]) * k;
    const q = this.pose;

    this.hipL.rotation.set(q.hipL, 0, q.hipLz);
    this.hipR.rotation.set(q.hipR, 0, q.hipRz);
    this.kneeL.rotation.x = q.kneeL;
    this.kneeR.rotation.x = q.kneeR;
    this.shL.rotation.set(q.shL, 0, q.shLz);
    this.shR.rotation.set(q.shR, 0, q.shRz);
    this.elL.rotation.x = q.elL;
    this.elR.rotation.x = q.elR;
    this.spine.rotation.set(q.spineX, q.spineY, 0);
    this.head.rotation.x = q.headX - q.spineX * 0.6;
    this.pelvis.position.y = 0.4 + q.pelvisY;
    this.fallG.rotation.x = q.fall;
    this.fallG.rotation.y = q.spin;

    // Rolamento: gira em torno do eixo perpendicular ao movimento (local).
    if (roll > 0) {
      const axis = new THREE.Vector3(this.velLocal.y, 0, -this.velLocal.x);
      if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0);
      this.rollG.quaternion.setFromAxisAngle(axis.normalize(), roll);
    } else {
      this.rollG.quaternion.identity();
    }

    // Indicadores de estado.
    const flash = f.hitstop > 0 && (f.state === 'hitstun' || f.state === 'knockdown');
    this.shirtMat.color.copy(flash ? new THREE.Color(0xffffff) : this.shirtColor);
    this.shirtMat.emissive.set(
      f.armored ? 0x5b21b6 : f.counter ? 0x8a6a00 : f.state === 'staggered' || f.state === 'guardbreak' ? 0x5a3d00 : 0x000000,
    );
    this.aura.visible = f.buffed && f.state !== 'ko' && f.state !== 'dead';
    if (this.aura.visible) this.aura.material.opacity = 0.3 + Math.sin(this.breath * 3) * 0.15;
    this.aura.position.y = 0.03 - f.y;
    for (const m of this.allMats) {
      if (m.userData.baseOpacity === undefined) m.userData.baseOpacity = m.opacity;
      const base = m.userData.baseOpacity as number;
      m.opacity = f.invulnerable ? 0.5 * base : base;
      m.transparent = m.opacity < 1;
    }
    this.guard.visible = f.state === 'block' || f.state === 'blockstun';
    this.guard.material.color.set(f.parryLive ? 0xffd60a : 0x90e0ef);

    const alive = f.state !== 'ko' && f.state !== 'dead';
    this.root.visible = f.state !== 'dead' || f.stateTick < 150;
    this.hpBar.visible = this.hpBack.visible = !this.isSelf && alive;
    this.label.visible = !this.isSelf && alive;
    const hp = Math.max(0, Math.min(1, f.hp / data.constants.maxHp));
    this.hpBar.scale.x = Math.max(0.001, hp);
    this.hpBar.position.x = -(1 - hp) * 0.4;
    for (const m of [this.hpBar, this.hpBack]) m.quaternion.copy(camera.quaternion);
    this.lockMarker.visible = this.locked && alive;
    if (this.lockMarker.visible) {
      this.lockMarker.position.y = 2.62 + Math.sin(this.breath * 2.2) * 0.06;
      this.lockMarker.rotation.y += dt * 3;
    }
  }

  dispose(): void {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    for (const m of this.allMats) m.dispose();
    this.guard.material.dispose();
    this.aura.material.dispose();
    this.hpBar.material.dispose();
    this.hpBack.material.dispose();
    this.label.material.map?.dispose();
    this.label.material.dispose();
    this.lockMarker.material.dispose();
  }
}

function makeLabel(text: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(text, 128, 32);
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 32);
  }
  const tex = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(1.6, 0.4, 1);
  s.renderOrder = 12;
  return s;
}
