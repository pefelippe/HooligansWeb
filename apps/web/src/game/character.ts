import {
  attackPhase,
  beardColor,
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
import { pickAnim } from './fighterAnim';
import { bodyMaterial, fighterAsset, SkinnedFighter } from './fighterModel';

// Boneco humano procedural com juntas (quadril/joelho, ombro/cotovelo). A pose alvo é
// função pura do estado da simulação (estado, stateTick, frame data) e as juntas
// interpolam até ela, então a animação segue o tick e as transições ficam suaves.
// Com o modelo glTF carregado (fighterModel.ts), o corpo vira o do Quaternius e os clipes seguem o
// mesmo estado/frame data (fighterAnim.ts); este boneco fica de reserva se o modelo não carregar.

const data = DEFAULT_COMBAT_DATA;
/**
 * Corpo pelos sliders do visual (só cosmético, a hitbox não muda). O modelo tem 1,75 m.
 * Largura: magro 0.84 até gordo e marombado ~1.46. Quem é baixo ganha cabeça maior (cartoon, lê de longe).
 */
function bodyShape(v: CharacterVisual) {
  const peso = v.peso / 100;
  const musculo = v.musculo / 100;
  const width = 0.84 + peso * 0.5 + musculo * 0.12;
  return {
    scale: v.altura / 175,
    width,
    /** Tronco e pernas moldados no shader do glTF (1 = modelo original). */
    girth: 0.92 + peso * 0.28 + musculo * 0.1,
    legs: 0.92 + peso * 0.22 + musculo * 0.12,
    arms: 0.86 + musculo * 0.36 + peso * 0.1,
    head: 1 + Math.max(0, (170 - v.altura) / 200),
    /** Barriga a partir de "fortinho" (0 a 1). */
    belly: Math.max(0, (peso - 0.55) / 0.45),
    build: { torso: width, shoulder: 0.2 + 0.035 * width, hip: 0.095 },
  };
}
/** Grupo da cabeça e da mão presos aos ossos do glTF (afinado por screenshot). */
const HEAD_FIT = { offset: new THREE.Vector3(0, 0, 0), scale: 1 };

/**
 * Onde fica cada parte do rosto no grupo da cabeça (+Y para cima, +Z para a frente, origem no pescoço):
 * cabelo, barba e acessórios são montados a partir disto, então servem aos dois bonecos.
 */
interface Face {
  /** Centro e raios do crânio (elipsoide). */
  c: THREE.Vector3;
  r: THREE.Vector3;
  eye: { y: number; z: number };
  mustache: { y: number; z: number };
  chin: { y: number; z: number };
  /** Raios da casca da barba (largura do maxilar, altura, profundidade). */
  jaw: THREE.Vector3;
  /** Cabelo raspado e barba já vêm pintados na pele (material do glTF). */
  painted: boolean;
}
// Medido no Superhero_Male (vértices do osso Head, pose de ligação).
const FACE_GLTF: Face = {
  c: new THREE.Vector3(0, 0.113, 0.012),
  r: new THREE.Vector3(0.093, 0.114, 0.102),
  eye: { y: 0.097, z: 0.1 },
  mustache: { y: 0.047, z: 0.117 },
  chin: { y: 0.0, z: 0.1 },
  jaw: new THREE.Vector3(0.078, 0.07, 0.105),
  painted: true,
};
// Boneco procedural de reserva (crânio de raio 0.11 a 0.11 do pescoço).
const FACE_PROC: Face = {
  c: new THREE.Vector3(0, 0.11, 0),
  r: new THREE.Vector3(0.101, 0.123, 0.11),
  eye: { y: 0.13, z: 0.095 },
  mustache: { y: 0.07, z: 0.1 },
  chin: { y: 0.025, z: 0.088 },
  jaw: new THREE.Vector3(0.09, 0.075, 0.1),
  painted: false,
};
// Mão do glTF (espaço do osso hand_r): +Y vai para os dedos, +Z para o lado do polegar/indicador,
// -X é a palma. Os clipes deixam o punho sempre fechado; o buraco do punho fica aqui.
const GRIP_HOLE = new THREE.Vector3(-0.025, 0.09, 0);
const basis = (x: THREE.Vector3Tuple, y: THREE.Vector3Tuple, z: THREE.Vector3Tuple) =>
  new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...x), new THREE.Vector3(...y), new THREE.Vector3(...z)));
/** Orientação da arma (+Z = lâmina/cano) no espaço da mão do glTF. */
const SKINNED_GRIP: Record<string, THREE.Quaternion> = {
  // Cabo atravessa o punho (mindinho→indicador); a lâmina sai pelo lado do polegar, um pouco inclinada.
  melee: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.25),
  // Lata deitada no punho.
  can: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2),
  // Soqueira atravessada sobre os nós dos dedos.
  soqueira: basis([0, 0, 1], [1, 0, 0], [0, 1, 0]),
  // Cabo no punho descendo para o mindinho, cano para frente dos dedos.
  gun: basis([-1, 0, 0], [0, 0, 1], [0, 1, 0]),
};

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

// Sombreamento em 3 faixas (estilo desenho). Uma textura só para todos os bonecos.
const TOON_RAMP = new THREE.DataTexture(new Uint8Array([95, 95, 95, 255, 175, 175, 175, 255, 255, 255, 255, 255]), 3, 1);
TOON_RAMP.minFilter = TOON_RAMP.magFilter = THREE.NearestFilter;
TOON_RAMP.needsUpdate = true;

const mat = (color: THREE.ColorRepresentation) => new THREE.MeshToonMaterial({ color, gradientMap: TOON_RAMP });

/** Espessura do contorno (m), empurrando os vértices pela normal. */
const OUTLINE_WIDTH = 0.012;
function outlineMaterial(color: number): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed += normal * ${OUTLINE_WIDTH};`);
  };
  return m;
}
// Compartilhados entre bonecos: inimigo com contorno vinho, você e aliados com contorno escuro.
const OUTLINE_ALLY = outlineMaterial(0x0d1117);
const OUTLINE_ENEMY = outlineMaterial(0x8f1426);
/** Só peças grandes ganham contorno (juntas, olhos e dedos não), para não dobrar as draw calls. */
const OUTLINE_MIN_RADIUS = 0.09;

/** Camisa: cor da torcida, escudo no peito (u=0 é o +Z, a frente) e número + nick nas costas (u=0.5). */
function jerseyTexture(shirt: string, trim: string, number: number, nick: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = shirt;
    g.fillRect(0, 0, c.width, c.height);
    const stroke = new THREE.Color(trim).getHSL({ h: 0, s: 0, l: 0 }).l > 0.8 ? '#000000' : trim;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.fillStyle = '#f5f5f5';
    g.strokeStyle = stroke;
    if (nick) {
      g.font = '700 26px "Barlow Condensed", Inter, sans-serif';
      g.lineWidth = 5;
      g.strokeText(nick.toUpperCase(), 256, 62);
      g.fillText(nick.toUpperCase(), 256, 62);
    }
    g.font = '800 104px "Barlow Condensed", Inter, sans-serif';
    g.lineWidth = 10;
    g.strokeText(String(number), 256, 140);
    g.fillText(String(number), 256, 140);
    // Escudo pequeno no peito: desenhado nas duas bordas, que se encontram na frente.
    for (const cx of [0, 512]) {
      g.fillStyle = trim;
      g.beginPath();
      g.moveTo(cx - 16, 70);
      g.lineTo(cx + 16, 70);
      g.lineTo(cx + 16, 92);
      g.quadraticCurveTo(cx, 112, cx - 16, 92);
      g.closePath();
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

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

const THROW_CLIP = 'OverhandThrow';
const _gp = new THREE.Vector3();
const _gq = new THREE.Quaternion();
const _gs = new THREE.Vector3();
const _gm = new THREE.Matrix4();
const _gw = new THREE.Matrix4();
const THROW_SECS = 0.45;

export class CharacterView {
  readonly root = new THREE.Group();
  private readonly yawG = new THREE.Group();
  private readonly fallG = new THREE.Group();
  private readonly rollG = new THREE.Group();
  private readonly vest = new THREE.Group();
  /**
   * Arma do boneco skinned: fora da hierarquia do modelo, que é alargado só em X/Z (corpo forte/magro).
   * Presa ao osso, essa escala desigual entortava a arma quando o braço girava e ela saía do punho.
   * A cada quadro copia só posição e rotação da mão (handR fica no osso como âncora).
   */
  private readonly grip = new THREE.Group();
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
  private readonly shirtMat: THREE.MeshToonMaterial;
  /** Tronco com número e nick (textura própria; o resto da camisa usa `shirtMat`). */
  private readonly jerseyMat: THREE.MeshToonMaterial;
  private readonly jerseyTex: THREE.CanvasTexture;
  /** Corpo glTF; null = boneco procedural. */
  private readonly skinned: SkinnedFighter | null;
  private readonly allMats: THREE.MeshToonMaterial[] = [];
  private readonly outlines: THREE.Mesh[] = [];
  /** Contorno próprio do boneco glTF: muda de cor para mostrar armadura e contra-golpe. */
  private outlineMat: THREE.MeshBasicMaterial | null = null;
  private outlineBase = 0;
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
  /** Yaw desenhado e velocidade suavizados (a simulação vira e acelera na hora; o boneco não pode piscar). */
  private visYaw = Number.NaN;
  private speedEma = 0;
  /** Segundos que ainda faltam do gesto de arremesso (vem do evento, não do estado). */
  private throwT = 0;
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
    const skin = mat(visualColor('pele', v.pele));
    this.shirtMat = mat(this.shirtColor);
    const trimMat = mat(trim);
    const shorts = mat(team === 0 ? 0x111111 : 0xf5f5f5);
    const socks = mat(team === 0 ? 0x111111 : 0xe30613);
    const shoes = mat([0xf2f2f2, 0x1a1a1a, 0x2d4a8a, 0xb5352b][(h >> 3) % 4] ?? 0x1a1a1a);
    const hair = mat(visualColor('corCabelo', v.corCabelo));
    const beard = v.corBarba === 'igual' ? hair : mat(beardColor(v));
    const eyeMat = mat(0x111111);
    const asset = fighterAsset();
    const shape = bodyShape(v);
    this.jerseyTex = jerseyTexture(t.cores[0], t.cores[1], (h % 98) + 1, nick);
    this.jerseyMat = asset
      ? bodyMaterial(
          { skin: skin.color, shorts: shorts.color, socks: socks.color, shoes: shoes.color, trim, jersey: this.jerseyTex, sleeve: v.camisa === 'regata' ? 0.21 : 0.36, stripes: v.camisa === 'listrada', hair: hair.color, beardColor: beard.color, beard: v.barba, scalp: v.cabelo === 'careca' ? 'nenhum' : v.cabelo === 'calvo' ? 'coroa' : 'todo', girth: shape.girth, legs: shape.legs, belly: shape.belly },
          TOON_RAMP,
        )
      : new THREE.MeshToonMaterial({ map: this.jerseyTex, gradientMap: TOON_RAMP });
    this.allMats.push(skin, this.shirtMat, this.jerseyMat, trimMat, shorts, socks, shoes, hair, eyeMat);
    if (beard !== hair) this.allMats.push(beard);
    const { scale, build } = shape;
    // Regata: ombro e braço de fora (pele) em vez da manga da camisa.
    const sleeve = v.camisa === 'regata' ? skin : this.shirtMat;

    if (asset) {
      this.outlineBase = allied ? OUTLINE_ALLY.color.getHex() : OUTLINE_ENEMY.color.getHex();
      this.outlineMat = outlineMaterial(this.outlineBase);
      // Tronco, pernas e barriga são moldados no shader do corpo; o boneco em si não alarga
      // (alargar tudo esticava a cabeça e virava um ovo).
      const sk = new SkinnedFighter(asset, this.jerseyMat, hair, eyeMat, this.outlineMat, 1);
      for (const b of ['upperarm_l', 'upperarm_r']) sk.bone(b)?.scale.setScalar(shape.arms);
      this.skinned = sk;
      // Cabeça: o grupo procedural (cabelo, barba, boné) vai preso ao osso, de pé e olhando para +Z.
      sk.mount('Head', this.head, sk.restPos('Head').add(HEAD_FIT.offset), new THREE.Quaternion());
      this.head.scale.setScalar(HEAD_FIT.scale);
      sk.bone('Head')?.scale.setScalar(shape.head);
      this.buildHair(v, FACE_GLTF, hair);
      // Barba pintada no rosto pelo material do corpo; aqui só os volumes.
      if (v.barba === 'cheia') this.buildBeardVolume(FACE_GLTF, beard, 1);
      else if (v.barba === 'lenhador') this.buildBeardVolume(FACE_GLTF, beard, 1.45);
      else if (v.barba === 'bigodao') this.buildMustache(FACE_GLTF, beard, 1.8);
      this.buildHeadwear(v, FACE_GLTF, trimMat);
      if (v.acessorio === 'corrente') {
        const gold = mat(0xd4a017);
        this.allMats.push(gold);
        const chain = new THREE.Mesh(new THREE.TorusGeometry(0.085 * build.torso, 0.009, 6, 24), gold);
        chain.rotation.x = Math.PI / 2 + 0.35;
        sk.mount('neck_01', chain, sk.restPos('neck_01').add(new THREE.Vector3(0, -0.03, 0.02)), chain.quaternion.clone());
      }
      // Colete: preso ao peito, aparece quando o lutador tem pontos de colete.
      const vestMat = mat(0x3d4630);
      this.allMats.push(vestMat);
      const vestG = new THREE.CylinderGeometry(0.2, 0.18, 0.4, 14);
      const vest = new THREE.Mesh(vestG, vestMat);
      vest.scale.z = 0.72;
      vest.castShadow = true;
      this.vest.add(vest);
      this.vest.visible = false;
      sk.mount('spine_03', this.vest, sk.restPos('spine_03').add(new THREE.Vector3(0, 0.0, 0.02)), new THREE.Quaternion());
      // Âncora da arma no buraco do punho, nos eixos do osso da mão (ver GRIP_HOLE).
      sk.bone('hand_r')?.add(this.handR);
      this.handR.position.copy(GRIP_HOLE);
      this.grip.matrixAutoUpdate = false;
      this.grip.add(this.weapon);
      this.root.add(this.grip);
      this.root.add(this.yawG);
      this.yawG.add(sk.object);
      this.yawG.scale.setScalar(scale);
    } else {
      this.skinned = null;
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
      const torso = new THREE.Mesh(torsoG, this.jerseyMat);
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
        const gold = mat(0xd4a017);
        this.allMats.push(gold);
        const chain = new THREE.Mesh(new THREE.TorusGeometry(0.1 * build.torso, 0.012, 6, 20), gold);
        chain.rotation.x = Math.PI / 2 + 0.35;
        chain.position.set(0, 0.5, 0.03);
        this.spine.add(chain);
      }

      // Cabeça.
      this.head.position.y = 0.6;
      // Cabeça um pouco maior que o real: lê melhor de longe (só visual, hitbox não muda).
      this.head.scale.setScalar(1.12 * shape.head);
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
      this.buildHair(v, FACE_PROC, hair);
      this.buildBeard(v, FACE_PROC, beard);
      this.buildHeadwear(v, FACE_PROC, trimMat);

      // Braços. O lado direito do personagem é -X (ele olha para +Z).
      const arm = (side: 1 | -1, sh: THREE.Group, el: THREE.Group) => {
        sh.position.set(side * build.shoulder, 0.48, 0);
        this.spine.add(sh);
        sh.add(joint(0.062, sleeve), segment(0.13, 0.064, 0.058, sleeve), segment(0.28, 0.05, 0.043, skin));
        el.position.y = -0.28;
        sh.add(el);
        const fist = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.09, 0.085), skin);
        fist.position.y = -0.29;
        fist.scale.setScalar(1.25);
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
        shoe.scale.setScalar(1.12);
        shoe.castShadow = true;
        knee.add(joint(0.055, skin), segment(0.3, 0.055, 0.04, skin), sock, shoe);
      };
      leg(1, this.hipL, this.kneeL);
      leg(-1, this.hipR, this.kneeR);

      // Contorno: cópia da peça com as faces de trás, inflada pela normal (a arma, criada depois, fica sem).
      const outlineMat = allied ? OUTLINE_ALLY : OUTLINE_ENEMY;
      const parts: THREE.Mesh[] = [];
      this.yawG.traverse((o) => {
        if (!(o instanceof THREE.Mesh) || !o.castShadow) return;
        o.geometry.computeBoundingSphere();
        const r = o.geometry.boundingSphere?.radius ?? 0;
        if (r >= OUTLINE_MIN_RADIUS) parts.push(o);
      });
      for (const p of parts) {
        const hull = new THREE.Mesh(p.geometry, outlineMat);
        p.add(hull);
        this.outlines.push(hull);
      }
    }

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

  /** Elipsoide do crânio (raio 1 escalado), cortado de cima até `cover`·π e inclinado (frente sobe). */
  private shell(f: Face, m: THREE.Material, inflate: number, cover: number, tilt: number): THREE.Mesh {
    const s = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * cover), m);
    s.scale.copy(f.r).multiplyScalar(inflate);
    s.position.copy(f.c);
    s.rotation.x = -tilt;
    s.castShadow = true;
    return s;
  }

  private buildHair(v: CharacterVisual, f: Face, hair: THREE.Material): void {
    const { c, r } = f;
    const add = (...o: THREE.Object3D[]) => this.head.add(...o);
    switch (v.cabelo) {
      case 'careca':
        break;
      case 'raspado':
        if (!f.painted) add(this.shell(f, hair, 1.02, 0.5, 0.35));
        break;
      case 'curto': {
        add(this.shell(f, hair, 1.05, 0.5, 0.42));
        break;
      }
      case 'topete': {
        add(this.shell(f, hair, 1.05, 0.5, 0.42));
        // Volume na frente, puxado para cima.
        const quiff = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), hair);
        quiff.scale.set(r.x * 0.62, r.y * 0.3, r.z * 0.5);
        quiff.position.set(0, c.y + r.y * 0.72, c.z + r.z * 0.5);
        quiff.rotation.x = -0.35;
        quiff.castShadow = true;
        add(quiff);
        break;
      }
      case 'black': {
        // Alto e para trás: o rosto continua aparecendo.
        const afro = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), hair);
        afro.scale.set(r.x * 1.5, r.y * 1.18, r.z * 1.38);
        afro.position.set(0, c.y + r.y * 0.72, c.z - r.z * 0.3);
        afro.castShadow = true;
        add(afro);
        break;
      }
      case 'moicano': {
        if (!f.painted) add(this.shell(f, hair, 1.015, 0.5, 0.35));
        // Crista: arco de lâminas do topo da testa até a nuca.
        for (let i = 0; i < 6; i++) {
          const a = -0.45 + i * 0.36; // ângulo a partir do topo: negativo = testa, positivo = nuca
          const tall = 0.065 - Math.abs(i - 1.5) * 0.008;
          const blade = new THREE.Mesh(new THREE.BoxGeometry(0.022, tall, 0.05), hair);
          blade.position.set(0, c.y + Math.cos(a) * (r.y + tall * 0.35), c.z - Math.sin(a) * (r.z + tall * 0.35));
          blade.rotation.x = -a;
          blade.castShadow = true;
          add(blade);
        }
        break;
      }
      case 'trancas': {
        if (!f.painted) add(this.shell(f, hair, 1.01, 0.5, 0.35));
        // Tranças rente: arcos da testa à nuca.
        for (const x of [-0.052, -0.026, 0, 0.026, 0.052]) {
          const k = Math.sqrt(1 - (x / r.x) ** 2);
          const braid = new THREE.Mesh(new THREE.TorusGeometry(1, 0.11, 6, 24, Math.PI * 0.82), hair);
          braid.rotation.y = Math.PI / 2;
          braid.rotation.z = 0.25;
          braid.scale.set(r.z * k * 1.04, r.y * k * 1.04, 0.09);
          braid.position.set(x, c.y, c.z);
          add(braid);
        }
        break;
      }
      case 'militar':
        // Raspado nas laterais e um pouco de volume reto no topo.
        if (!f.painted) add(this.shell(f, hair, 1.01, 0.45, 0.5));
        add(this.shell(f, hair, 1.04, 0.24, 0.25));
        break;
      case 'cacheado': {
        add(this.shell(f, hair, 1.07, 0.52, 0.4));
        // Cachos: bolinhas espalhadas pela parte de cima.
        const curl = new THREE.SphereGeometry(1, 8, 6);
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          const up = 0.35 + 0.35 * ((i * 7) % 3) / 2;
          const b = new THREE.Mesh(curl, hair);
          b.scale.setScalar(0.03);
          b.position.set(c.x + Math.cos(a) * r.x * 1.02 * Math.cos(up), c.y + Math.sin(up) * r.y * 1.04, c.z + Math.sin(a) * r.z * 1.02 * Math.cos(up) - 0.01);
          add(b);
        }
        break;
      }
      case 'coque': {
        add(this.shell(f, hair, 1.04, 0.5, 0.42));
        const bun = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 10), hair);
        bun.position.set(0, c.y + r.y * 0.95, c.z - r.z * 0.45);
        bun.castShadow = true;
        add(bun);
        break;
      }
      case 'dreads': {
        add(this.shell(f, hair, 1.05, 0.52, 0.4));
        // Mechas grossas caindo da metade de trás da cabeça.
        for (let i = 0; i < 9; i++) {
          const a = Math.PI * (0.1 + (i / 8) * 0.8); // de um lado ao outro, por trás
          const lock = segment(0.17, 0.014, 0.012, hair);
          lock.position.set(Math.cos(a) * r.x * 0.95, c.y + r.y * 0.1, c.z - Math.sin(a) * r.z * 0.95);
          lock.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.2);
          add(lock);
        }
        break;
      }
      case 'longo':
      case 'mullet': {
        add(this.shell(f, hair, 1.05, 0.55, 0.4));
        // Cabelo de trás: placa arredondada até o ombro (longo) ou até a nuca (mullet).
        const len = v.cabelo === 'longo' ? 0.22 : 0.13;
        const back = new THREE.Mesh(new THREE.CylinderGeometry(r.x * 1.02, r.x * 1.08, len, 16, 1, false, Math.PI / 2, Math.PI), hair);
        back.scale.z = 0.75;
        back.position.set(0, c.y - len / 2 + r.y * 0.2, c.z - 0.01);
        back.castShadow = true;
        add(back);
        break;
      }
      case 'calvo': {
        if (f.painted) break; // pintado na pele pelo material do glTF
        // Coroa de cabelo em volta da nuca e das orelhas, topo careca.
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.1, 8, 24, Math.PI * 1.3), hair);
        // Arco de 1,3π centrado na nuca (-Z), aberto na testa.
        ring.rotation.set(Math.PI / 2 - 0.15, 0, Math.PI * 0.85);
        ring.scale.set(r.x * 0.96, r.z * 0.96, 0.3);
        ring.position.set(0, c.y - r.y * 0.3, c.z);
        add(ring);
        break;
      }
      case 'rabo': {
        add(this.shell(f, hair, 1.05, 0.52, 0.4));
        // Rabo saindo da nuca, caindo para trás, com elástico.
        const tail = segment(0.13, 0.026, 0.012, hair);
        tail.position.set(0, c.y + r.y * 0.25, c.z - r.z * 1.0);
        tail.rotation.x = 0.55;
        const tie = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.008, 6, 12), mat(0xc1121f));
        this.allMats.push(tie.material);
        tie.position.copy(tail.position);
        tie.rotation.x = Math.PI / 2 + 0.55;
        add(tail, tie);
        break;
      }
    }
  }

  /** Volume fechado no queixo/maxilar (por dentro some na cabeça; sem borda cortando o rosto). */
  private buildBeardVolume(f: Face, hair: THREE.Material, long: number): void {
    const vol = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), hair);
    vol.scale.set(0.056 + 0.012 * (long - 1), 0.04 * long, 0.045);
    vol.position.set(0, f.chin.y + 0.008 - 0.04 * (long - 1), f.chin.z - 0.036);
    vol.castShadow = true;
    this.head.add(vol);
  }

  /** Bigode em duas metades; o bigodão é mais grosso, mais largo e cai nas pontas. */
  private buildMustache(f: Face, hair: THREE.Material, size: number): void {
    const big = size > 1;
    for (const side of [1, -1]) {
      const half = new THREE.Mesh(new THREE.CapsuleGeometry(0.0055 * size, 0.022 * size, 3, 8), hair);
      half.rotation.z = Math.PI / 2 + side * (big ? -0.4 : 0.3);
      half.position.set(side * (big ? 0.027 : 0.017), f.mustache.y - (big ? 0.01 : 0.004), f.mustache.z + (big ? 0.004 : 0));
      this.head.add(half);
    }
  }

  private buildBeard(v: CharacterVisual, f: Face, hair: THREE.Material): void {
    const mustache = () => this.buildMustache(f, hair, 1);
    // Barba: casca do maxilar, da altura da boca para baixo.
    const jaw = (m: THREE.Material, inflate: number) => {
      const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.42), m);
      shell.scale.set(f.jaw.x * inflate, f.jaw.y * inflate, f.jaw.z * inflate);
      shell.position.set(0, f.mustache.y + 0.012, f.c.z + 0.006);
      shell.rotation.x = 0.38; // frente desce: a boca fica de fora
      this.head.add(shell);
    };
    switch (v.barba) {
      case 'nenhuma':
        break;
      case 'rala': {
        const stubble = (hair as THREE.MeshToonMaterial).clone();
        stubble.transparent = true;
        stubble.opacity = 0.45;
        this.allMats.push(stubble);
        jaw(stubble, 1.01);
        break;
      }
      case 'bigode':
        mustache();
        break;
      case 'cavanhaque': {
        mustache();
        const goatee = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), hair);
        goatee.scale.set(0.015, 0.02, 0.01);
        goatee.position.set(0, f.chin.y + 0.006, f.chin.z + 0.002);
        this.head.add(goatee);
        break;
      }
      case 'cheia':
        mustache();
        jaw(hair, 1.08);
        break;
      case 'bigodao':
        this.buildMustache(f, hair, 1.8);
        break;
      case 'contorno':
        jaw(hair, 1.02);
        break;
      case 'costeleta':
        for (const side of [1, -1]) {
          const burn = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.05, 0.03), hair);
          burn.position.set(side * f.r.x * 0.98, f.eye.y - 0.035, f.c.z - 0.01);
          this.head.add(burn);
        }
        break;
      case 'curta':
        mustache();
        jaw(hair, 1.04);
        break;
      case 'lenhador': {
        mustache();
        jaw(hair, 1.12);
        const vol = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), hair);
        vol.scale.set(0.06, 0.07, 0.05);
        vol.position.set(0, f.chin.y - 0.02, f.chin.z - 0.01);
        this.head.add(vol);
        break;
      }
    }
  }

  private buildHeadwear(v: CharacterVisual, f: Face, trimMat: THREE.Material): void {
    const { c, r } = f;
    const add = (...o: THREE.Object3D[]) => this.head.add(...o);
    if (v.acessorio === 'bone') {
      // Boné na cor da torcida, aba e botão na cor secundária.
      const crown = this.shell(f, this.shirtMat, 1.1, 0.5, 0.18);
      const brimG = new THREE.CylinderGeometry(0.085, 0.085, 0.01, 18, 1, false, -Math.PI / 2, Math.PI);
      const brim = new THREE.Mesh(brimG, trimMat);
      brim.scale.set(1, 1, 0.75);
      brim.position.set(0, c.y + r.y * 0.16, c.z + r.z * 0.98);
      brim.rotation.x = 0.12;
      const button = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), trimMat);
      button.position.set(0, c.y + r.y * 1.1, c.z);
      brim.castShadow = true;
      add(crown, brim, button);
    } else if (v.acessorio === 'touca') {
      const wool = this.shell(f, this.shirtMat, 1.1, 0.56, 0.12);
      const fold = new THREE.Mesh(new THREE.TorusGeometry(1, 0.13, 8, 24), trimMat);
      fold.rotation.x = Math.PI / 2 - 0.12;
      fold.scale.set(r.x * 1.03, r.z * 1.05, 0.12);
      fold.position.set(0, c.y + r.y * 0.12, c.z);
      add(wool, fold);
    } else if (v.acessorio === 'bandana') {
      const cloth = mat(0xc1121f);
      this.allMats.push(cloth);
      // Faixa na testa, mais alta na frente; nó atrás com as pontas.
      const k = 0.88;
      const band = new THREE.Mesh(new THREE.TorusGeometry(1, 0.16, 8, 28), cloth);
      band.rotation.x = Math.PI / 2 - 0.3;
      band.scale.set(r.x * k * 1.06, r.z * k * 1.06, 0.1);
      band.position.set(0, c.y + r.y * 0.4, c.z);
      const knot = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), cloth);
      knot.position.set(0, c.y + r.y * 0.15, c.z - r.z * 0.98);
      add(band, knot);
      for (const side of [1, -1]) {
        const end = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.05, 0.006), cloth);
        end.position.set(side * 0.012, knot.position.y - 0.03, knot.position.z - 0.006);
        end.rotation.z = side * 0.3;
        add(end);
      }
    } else if (v.acessorio === 'oculos') {
      const frame = mat(0x0b0b0b);
      this.allMats.push(frame);
      const lensG = new THREE.BoxGeometry(0.038, 0.022, 0.008);
      const z = f.eye.z + 0.008;
      for (const side of [1, -1]) {
        const lens = new THREE.Mesh(lensG, frame);
        lens.position.set(side * 0.033, f.eye.y, z);
        // Haste até a orelha.
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.005, 0.09), frame);
        arm.position.set(side * r.x * 0.93, f.eye.y + 0.004, z - 0.05);
        const hinge = new THREE.Mesh(new THREE.BoxGeometry(r.x * 0.93 - 0.05, 0.005, 0.005), frame);
        hinge.position.set(side * (0.05 + r.x * 0.93) / 2, f.eye.y + 0.006, z - 0.004);
        add(hinge);
        add(lens, arm);
      }
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.005, 0.006), frame);
      bridge.position.set(0, f.eye.y + 0.006, z);
      add(bridge);
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
    if ((!data.weapons[id] && id !== 'bomba' && id !== 'gas') || id === 'punhos') return;
    const metal = mat(0xc8d0dc);
    const wood = mat(0x9c6b3c);
    const dark = mat(0x222222);
    const glass = mat(0x2a9d8f);
    glass.transparent = true;
    glass.opacity = 0.75;
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
      case 'bomba':
      case 'gas': {
        // Lata na mão (bomba de pavio ou granada de gás).
        this.weapon.rotation.x = 0;
        const can = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.14, 10), id === 'bomba' ? wood : metal);
        can.position.set(0, -0.02, 0.03);
        this.weapon.add(can);
        break;
      }
      case 'pistola':
      case 'revolver': {
        // Cano para a frente da mão, cabo descendo.
        this.weapon.rotation.x = 0;
        const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.05, 0.2), dark);
        barrel.position.set(0, 0.02, 0.07);
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.045), dark);
        grip.position.set(0, -0.03, -0.01);
        grip.rotation.x = -0.25;
        this.weapon.add(barrel, grip);
        break;
      }
    }
    // As rotações acima são do antebraço procedural; no glTF a arma segue o osso da mão.
    if (this.skinned) {
      const kind = id === 'soqueira' ? 'soqueira' : id === 'bomba' || id === 'gas' ? 'can' : id === 'pistola' || id === 'revolver' ? 'gun' : 'melee';
      this.weapon.quaternion.copy(SKINNED_GRIP[kind]!);
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
    const amt = Math.min(1, speed / (run ? DEFAULT_COMBAT_DATA.constants.runSpeed : DEFAULT_COMBAT_DATA.constants.walkSpeed));
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

    // No ar (pulo): pernas recolhidas, braços para cima. Em cima do carro é chão.
    if (f.airborne && f.state === 'idle') {
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

  private syncGrip(): void {
    this.handR.updateWorldMatrix(true, false);
    this.handR.matrixWorld.decompose(_gp, _gq, _gs);
    _gs.setScalar(this.yawG.scale.x);
    this.root.updateWorldMatrix(true, false);
    this.grip.matrix.copy(_gm.copy(this.root.matrixWorld).invert()).multiply(_gw.compose(_gp, _gq, _gs));
  }

  playThrow(): void {
    this.throwT = THROW_SECS;
  }

  update(f: FighterSnapshot, camera: THREE.Camera, dt: number): void {
    this.root.position.set(f.pos.x, f.y, f.pos.z);
    // Gira até o yaw da simulação em ~60 ms (sem o giro de 180° num quadro só).
    if (Number.isNaN(this.visYaw)) this.visYaw = f.facing;
    let dYaw = f.facing - this.visYaw;
    dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
    this.visYaw += dYaw * (1 - Math.exp(-dt * 18));
    this.yawG.rotation.y = this.visYaw;
    // Anel no chão: com Euler XYZ, +Y local aponta para dirFromYaw(facing) quando z = facing + PI.
    this.guard.rotation.set(-Math.PI / 2, 0, f.facing + Math.PI);
    this.guard.position.y = 0.04 - (f.airborne ? f.y : 0);
    this.setWeapon(f.inHand ?? f.weapon);
    this.vest.visible = f.colete > 0;
    this.breath += dt * 2.2;

    // Velocidade: ciclo de passos e direção do rolamento.
    let speed = 0;
    if (!Number.isNaN(this.lastPos.x) && dt > 0) {
      const dx = f.pos.x - this.lastPos.x;
      const dz = f.pos.z - this.lastPos.y;
      const moved = Math.hypot(dx, dz);
      if (moved < 2) {
        speed = moved / dt;
        this.speedEma += (speed - this.speedEma) * (1 - Math.exp(-dt * 12));
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

    if (this.skinned) {
      const info = (n: string) => this.skinned?.info(n) ?? { duration: 1, impact: 0.4 };
      this.throwT = Math.max(0, this.throwT - dt);
      // Arremesso: gesto de braço por cima da locomoção (só quando o boneco está livre).
      const pick = this.throwT > 0 && f.state === 'idle' ? { clip: THROW_CLIP, time: info(THROW_CLIP).duration * (1 - this.throwT / THROW_SECS), speed: 1 } : pickAnim(f, findMove(data, f.move), this.speedEma, info);
      this.skinned.apply(pick, dt);
      this.syncGrip();
    } else {
      const { p: target, crisp, roll } = this.targetPose(f, this.speedEma);
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
    }

    // Indicadores de estado.
    const flash = f.hitstop > 0 && (f.state === 'hitstun' || f.state === 'knockdown');
    this.shirtMat.color.copy(flash ? new THREE.Color(0xffffff) : this.shirtColor);
    this.shirtMat.emissive.set(
      f.armored ? 0x5b21b6 : f.counter ? 0x8a6a00 : f.state === 'staggered' || f.state === 'guardbreak' ? 0x5a3d00 : 0x000000,
    );
    // O tronco tem textura: o clarão do acerto vem pelo emissive em vez da cor.
    if (flash) this.jerseyMat.emissive.set(0xaaaaaa);
    else if (this.outlineMat) {
      // glTF: o corpo é uma malha só (pintar tudo de roxo assusta); armadura e contra-golpe vão no contorno.
      this.jerseyMat.emissive.set(f.state === 'staggered' || f.state === 'guardbreak' ? 0x3a2800 : 0x000000);
      this.outlineMat.color.setHex(f.armored ? 0xb06cff : f.counter ? 0xffc300 : this.outlineBase);
    } else this.jerseyMat.emissive.copy(this.shirtMat.emissive);
    for (const o of this.outlines) o.visible = !f.invulnerable;
    this.aura.visible = f.buffed && f.state !== 'ko' && f.state !== 'dead';
    if (this.aura.visible) this.aura.material.opacity = 0.3 + Math.sin(this.breath * 3) * 0.15;
    this.aura.position.y = 0.03 - (f.airborne ? f.y : 0);
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
      if (o instanceof THREE.Mesh && !o.userData.shared) o.geometry.dispose();
    });
    this.skinned?.dispose();
    this.jerseyTex.dispose();
    this.outlineMat?.dispose();
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
