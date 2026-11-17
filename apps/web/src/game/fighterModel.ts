import * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { AnimPick, ClipInfo } from './fighterAnim';
import type { CharacterVisual } from '@torcidas/shared';

// Lutador glTF (Quaternius, CC0): corpo + esqueleto + clipes, gerado por scripts/build-models.mjs.
// A geometria é compartilhada entre todos os lutadores; material, esqueleto e mixer são de cada um.

interface FighterAsset {
  scene: THREE.Object3D;
  clips: Map<string, THREE.AnimationClip>;
  info: Map<string, ClipInfo>;
}

let asset: FighterAsset | null = null;
let loading: Promise<FighterAsset | null> | null = null;

/** Modelo já carregado, ou null (ainda carregando ou falhou: o jogo usa o boneco procedural). */
export const fighterAsset = (): FighterAsset | null => asset;

export function loadFighterModel(): Promise<FighterAsset | null> {
  loading ??= new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .loadAsync(`${import.meta.env.BASE_URL}models/fighter.glb`)
    .then((g) => (asset = prepare(g.scene, g.animations)))
    .catch((e: unknown) => {
      console.warn('[torcidas] modelo glTF indisponível, usando boneco procedural', e);
      return null;
    });
  return loading;
}

/** Mede em que segundo cada clipe estica mais a mão para a frente (o "impacto"). */
function prepare(scene: THREE.Object3D, anims: THREE.AnimationClip[]): FighterAsset {
  const probe = cloneSkinned(scene);
  const mixer = new THREE.AnimationMixer(probe);
  const chest = probe.getObjectByName('spine_03');
  const hands = [probe.getObjectByName('hand_l'), probe.getObjectByName('hand_r')];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const info = new Map<string, ClipInfo>();
  for (const clip of anims) {
    const action = mixer.clipAction(clip).play();
    let best = -Infinity;
    let impact = clip.duration * 0.4;
    for (let t = 0; t <= clip.duration; t += 1 / 60) {
      action.time = t;
      mixer.update(0);
      probe.updateMatrixWorld(true);
      chest?.getWorldPosition(a);
      for (const h of hands) {
        const reach = (h?.getWorldPosition(b).z ?? 0) - a.z;
        if (reach > best) {
          best = reach;
          impact = t;
        }
      }
    }
    action.stop();
    mixer.uncacheClip(clip);
    info.set(clip.name, { duration: clip.duration, impact });
  }
  return { scene, clips: new Map(anims.map((c) => [c.name, c])), info };
}

/** Faixas de roupa em metros no espaço do modelo (pose T de ligação, pés em y=0, frente +Z). */
const OUTFIT = { shoe: 0.09, sock: 0.4, knee: 0.52, hem: 0.97, neck: 1.47, armX: 0.21, armY: 1.2 };
/** Pescoço (cilindro vertical): a gola contorna em volta dele até `top`. */
const COLLAR = { z: -0.045, r: 0.072, top: 1.57 };

export interface BodyColors {
  skin: THREE.Color;
  shorts: THREE.Color;
  socks: THREE.Color;
  shoes: THREE.Color;
  trim: THREE.Color;
  jersey: THREE.Texture;
  /** Até onde vai a manga (|x|, m): regata para no ombro. */
  sleeve: number;
  stripes: boolean;
  /** Barba e cabelo raspado pintados na pele (seguem o rosto, sem peça solta cortando a cara). */
  hair: THREE.Color;
  beardColor: THREE.Color;
  beard: CharacterVisual['barba'];
  /** Cabelo raspado pintado: nenhum, cabeça toda ou só a coroa em volta (calvo). */
  scalp: 'nenhum' | 'todo' | 'coroa';
  /** Corpo moldado na malha (1 = modelo original): grossura do tronco, das pernas e barriga (0 a 1). */
  girth: number;
  legs: number;
  belly: number;
}

/**
 * Molda o corpo no vertex shader, no espaço da pose de ligação: engrossa tronco e pernas em volta
 * do próprio eixo e empurra a barriga para a frente. Cabeça e braços não esticam junto.
 */
const SHAPE_GLSL = `{
  vec3 b = (uBind * vec4(position, 1.0)).xyz;
  float ax = abs(b.x), sx = sign(b.x);
  vec3 d = vec3(0.0);
  if (!(ax > 0.2 && b.y > 1.2)) {
    float t = smoothstep(0.9, 1.02, b.y) * (1.0 - smoothstep(1.4, 1.52, b.y));
    d.xz += vec2(b.x, b.z + 0.02) * (uGirth - 1.0) * t;
    float bel = smoothstep(0.9, 1.04, b.y) * (1.0 - smoothstep(1.14, 1.32, b.y)) * smoothstep(-0.04, 0.08, b.z) * (1.0 - smoothstep(0.05, 0.2, ax));
    d.z += uBelly * 0.13 * bel;
    d.x += sx * uBelly * 0.035 * smoothstep(0.9, 1.0, b.y) * (1.0 - smoothstep(1.15, 1.3, b.y));
    float l = 1.0 - smoothstep(0.9, 1.0, b.y);
    d.xz += vec2(b.x - sx * 0.095, b.z) * (uLegs - 1.0) * l;
  }
  transformed += (uBindInv * vec4(d, 0.0)).xyz;
}`;

/** Põe a moldagem do corpo num material (corpo e contorno usam os mesmos uniforms). */
function shapeVertex(s: THREE.WebGLProgramParametersWithUniforms, u: Record<string, THREE.IUniform>): void {
  Object.assign(s.uniforms, u);
  s.vertexShader = s.vertexShader
    .replace('#include <common>', '#include <common>\nuniform mat4 uBind, uBindInv;\nuniform float uGirth, uLegs, uBelly;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${SHAPE_GLSL}`);
}

// Máscara pintada de cada barba (os volumes ficam em character.ts).
const BEARD: Record<CharacterVisual['barba'], number> = { nenhuma: 0, rala: 1, bigode: 2, bigodao: 2, cavanhaque: 3, cheia: 4, curta: 4, lenhador: 4, contorno: 5, costeleta: 6 };

// Pontos do rosto relativos ao osso Head, eixos do modelo (medidos no Superhero_Male).
const FACE_GLSL = `
vec3 h = vBind - uHead;
float hx = abs(h.x);
bool lips = h.y > 0.016 && h.y < 0.038 && hx < 0.024 && h.z > 0.09;
bool must = h.y > 0.036 && h.y < 0.052 && hx < 0.034 && h.z > 0.088;
bool chin = h.y > -0.03 && h.y < 0.03 && hx < 0.032 && h.z > 0.06 && !lips;
float top = 0.045 + 0.05 * smoothstep(0.045, 0.08, hx);
bool jaw = h.y > (h.z > 0.075 ? -0.04 : -0.008) && h.y < top && h.z > -0.015 && (h.y < 0.06 || h.z < 0.05) && !lips && !(h.y > 0.04 && hx < 0.03);
float beard = 0.0;
if (uBeard == 1) beard = (jaw || must || chin) ? 0.45 : 0.0;
else if (uBeard == 2) beard = must ? 1.0 : 0.0;
else if (uBeard == 3) beard = (must || chin) ? 1.0 : 0.0;
else if (uBeard == 4) beard = (jaw || must || chin) ? 1.0 : 0.0;
else if (uBeard == 5) beard = (jaw || chin) ? 1.0 : 0.0;
else if (uBeard == 6) beard = (hx > 0.062 && h.y > -0.005 && h.y < 0.085 && h.z > 0.0 && h.z < 0.055) ? 1.0 : 0.0;
bool ear = hx > 0.08 && h.y < 0.12 && h.z > -0.035;
bool scalp = uScalp > 0.5 && !ear && h.y > mix(0.152, 0.035, smoothstep(0.04, -0.07, h.z)) && (uScalp < 1.5 || (h.y < 0.17 && h.z < 0.03));
if (scalp) col = mix(col, uHair, 0.9);
else if (beard > 0.0) col = mix(col, uBeardCol, beard);
`;

/**
 * Material toon do corpo: pinta camisa (com a textura de número/nick nas costas), calção, meião e
 * tênis por faixas da pose de ligação. Uma draw call por lutador, sem textura no modelo.
 */
export function bodyMaterial(c: BodyColors, ramp: THREE.Texture): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: ramp });
  // O UV pula (frente/costas, fract): com mipmap, o salto escolhe o nível mais borrado e risca a camisa.
  c.jersey.generateMipmaps = false;
  c.jersey.minFilter = THREE.LinearFilter;
  const uniforms = {
    uBind: { value: new THREE.Matrix4() },
    uBindInv: { value: new THREE.Matrix4() },
    uGirth: { value: c.girth },
    uLegs: { value: c.legs },
    uBelly: { value: c.belly },
    uSkin: { value: c.skin },
    uShorts: { value: c.shorts },
    uSocks: { value: c.socks },
    uShoes: { value: c.shoes },
    uTrim: { value: c.trim },
    uJersey: { value: c.jersey },
    uSleeve: { value: c.sleeve },
    uStripes: { value: c.stripes ? 1 : 0 },
    uHead: { value: new THREE.Vector3(0, 99, 0) },
    uHair: { value: c.hair },
    uBeardCol: { value: c.beardColor },
    uBeard: { value: BEARD[c.beard] },
    uScalp: { value: { nenhum: 0, todo: 1, coroa: 2 }[c.scalp] },
  };
  m.userData.uniforms = uniforms;
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = (uBind * vec4(position, 1.0)).xyz;');
    shapeVertex(s, uniforms);
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vBind;
uniform vec3 uSkin, uShorts, uSocks, uShoes, uTrim;
uniform sampler2D uJersey;
uniform float uSleeve, uStripes, uScalp;
uniform vec3 uHead, uHair, uBeardCol;
uniform int uBeard;`,
      )
      .replace(
        '#include <map_fragment>',
        `{
  float y = vBind.y, ax = abs(vBind.x);
  vec3 col = uSkin;
  bool arm = ax > ${OUTFIT.armX.toFixed(3)} && y > ${OUTFIT.armY.toFixed(3)};
  // Gola: acima da linha do ombro a camisa sobe até o pescoço (fora do cilindro do pescoço).
  float nr = length(vec2(vBind.x, vBind.z - ${COLLAR.z.toFixed(3)}));
  bool collar = !arm && y < ${COLLAR.top.toFixed(3)} && nr > ${COLLAR.r.toFixed(3)};
  bool shirt = arm ? ax < uSleeve : (y >= ${OUTFIT.hem.toFixed(3)} && (y < ${OUTFIT.neck.toFixed(3)} || collar));
  bool trimEdge = false;
  if (shirt && uSleeve < 0.25 && !arm) {
    // Regata: cava funda nos ombros, alças, decote na frente e nas costas.
    bool strap = ax > 0.06 && ax < 0.155;
    if (ax > 0.165 && y > 1.32) shirt = false;
    else if (y > 1.445 && !strap) shirt = false;
    trimEdge = shirt && ((ax > 0.15 && y > 1.3) || (y > 1.425 && !strap));
  } else if (shirt) {
    trimEdge = arm ? ax > uSleeve - 0.025 : (y > ${OUTFIT.neck.toFixed(3)} && nr < ${(COLLAR.r + 0.014).toFixed(3)});
  }
  if (shirt) {
    float v = clamp((y - ${OUTFIT.hem.toFixed(3)}) / ${(OUTFIT.neck - OUTFIT.hem).toFixed(3)}, 0.0, 1.0);
    // Costas: quem olha de trás tem a direita em -X, então u cresce com -x.
    vec2 uv = vBind.z < 0.0 ? vec2(0.5 - vBind.x * 0.9, v) : vec2(abs(vBind.x) * 0.9, v); // frente: meio escudo da borda espelhado
    col = texture2D(uJersey, uv).rgb;
    if (uStripes > 0.5 && !arm && fract(y * 7.0) < 0.35) col = uTrim;
    if (trimEdge) col = uTrim; // gola, punho da manga e borda da regata
  } else if (y < ${OUTFIT.shoe.toFixed(3)}) col = uShoes;
  else if (y < ${OUTFIT.sock.toFixed(3)}) col = uSocks;
  else if (y >= ${OUTFIT.knee.toFixed(3)} && y < ${OUTFIT.hem.toFixed(3)}) col = uShorts;
  else if (y >= ${OUTFIT.neck.toFixed(3)}) {${FACE_GLSL}}
  diffuseColor.rgb *= col;
}`,
      );
  };
  return m;
}

const anchors = new WeakMap<THREE.BufferGeometry, THREE.Vector3>();
/**
 * Osso Head no espaço da pose de ligação (o do shader), pela caixa dos vértices da cabeça:
 * topo a 0.225 m e nuca a 0.09 m dele (medido). Uma vez por geometria.
 */
function headAnchor(m: THREE.SkinnedMesh, bind: THREE.Matrix4): THREE.Vector3 {
  let a = anchors.get(m.geometry);
  if (a) return a;
  const hi = m.skeleton.bones.findIndex((b) => b.name === 'Head');
  const pos = m.geometry.attributes.position!;
  const si = m.geometry.attributes.skinIndex!;
  const sw = m.geometry.attributes.skinWeight!;
  const box = new THREE.Box3();
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === hi) w += sw.getComponent(i, k);
    if (w > 0.5) box.expandByPoint(p.fromBufferAttribute(pos, i).applyMatrix4(bind));
  }
  a = box.isEmpty() ? new THREE.Vector3(0, 99, 0) : new THREE.Vector3(0, box.max.y - 0.225, box.min.z + 0.09);
  anchors.set(m.geometry, a);
  return a;
}

const _p = new THREE.Quaternion();
const _r = new THREE.Quaternion();
const _x = new THREE.Vector3();

export class SkinnedFighter {
  readonly object: THREE.Object3D;
  private readonly mixer: THREE.AnimationMixer;
  private readonly asset: FighterAsset;
  private current: THREE.AnimationAction | null = null;
  private readonly thighR: THREE.Object3D | undefined;
  /** Ossos da pose de pulo: [osso, ângulo em torno do X do modelo com tuck = 1]. */
  private readonly tuckBones: [THREE.Object3D, number][];
  private readonly hipTilt: THREE.Object3D | undefined;
  private readonly overridden: [THREE.Object3D, THREE.Quaternion][] = [];

  constructor(a: FighterAsset, body: THREE.MeshToonMaterial, hair: THREE.Material, eyes: THREE.Material, outline: THREE.Material, width: number) {
    this.asset = a;
    this.object = cloneSkinned(a.scene);
    const meshes: THREE.SkinnedMesh[] = [];
    this.object.traverse((o) => {
      if (o instanceof THREE.SkinnedMesh) meshes.push(o);
    });
    for (const m of meshes) {
      m.userData.shared = true; // geometria é do asset: não descartar por lutador
      m.frustumCulled = false; // a esfera é da pose T; deitado ou rolando sairia da tela
      if (m.name === 'SuperHero_Male') {
        m.material = body;
        m.castShadow = true;
        // Espaço do modelo na pose de ligação: a desquantização da malha está nas inverse bind matrices,
        // então posição real = osso·inversa·bindMatrix·position (com o boneco na origem).
        this.object.updateMatrixWorld(true);
        const b0 = m.skeleton.bones[0];
        const ib0 = m.skeleton.boneInverses[0];
        const u = body.userData.uniforms as { uBind: { value: THREE.Matrix4 }; uBindInv: { value: THREE.Matrix4 }; uHead: { value: THREE.Vector3 } };
        if (b0 && ib0) u.uBind.value.copy(b0.matrixWorld).multiply(ib0).multiply(m.bindMatrix);
        u.uBindInv.value.copy(u.uBind.value).invert();
        u.uHead.value.copy(headAnchor(m, u.uBind.value));
        // Contorno acompanha o corpo moldado (mesmos uniforms; o material do contorno é deste lutador).
        const before = outline.onBeforeCompile.bind(outline);
        outline.onBeforeCompile = (sh, r) => {
          before(sh, r);
          shapeVertex(sh, body.userData.uniforms as Record<string, THREE.IUniform>);
        };
        outline.customProgramCacheKey = () => 'outline-shaped';
        const hull = new THREE.SkinnedMesh(m.geometry, outline);
        hull.bind(m.skeleton, m.bindMatrix);
        hull.userData.shared = true;
        hull.frustumCulled = false;
        m.parent?.add(hull);
      } else {
        m.material = m.name === 'Eyes' ? eyes : hair;
      }
    }
    this.object.scale.set(width, 1, width);
    this.mixer = new THREE.AnimationMixer(this.object);
    this.thighR = this.object.getObjectByName('thigh_r');
    // Ordem pai → filho: a canela gira depois da coxa já girada.
    const tuck: [string, number][] = [['thigh_r', -1.5], ['calf_r', 1.7], ['thigh_l', -0.5], ['calf_l', 0.9], ['lowerarm_l', -0.7], ['lowerarm_r', -0.7]];
    this.tuckBones = tuck.flatMap(([n, a]) => {
      const b = this.object.getObjectByName(n);
      return b ? [[b, a] as [THREE.Object3D, number]] : [];
    });
    this.hipTilt = this.object.getObjectByName('spine_01');
  }

  bone(name: string): THREE.Object3D | undefined {
    return this.object.getObjectByName(name);
  }

  /**
   * Prende `obj` ao osso de forma que, na pose de ligação, ele fique em `pos` (espaço do modelo)
   * com a orientação `quat` (espaço do modelo). Chamar antes de tocar qualquer clipe.
   */
  mount(boneName: string, obj: THREE.Object3D, pos: THREE.Vector3, quat: THREE.Quaternion): void {
    const bone = this.bone(boneName);
    if (!bone) return;
    const saved = this.object.matrix.clone();
    this.object.matrix.identity();
    this.object.matrixAutoUpdate = false;
    this.object.updateMatrixWorld(true);
    const local = bone.matrixWorld.clone().invert().multiply(new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1, 1, 1)));
    local.decompose(obj.position, obj.quaternion, obj.scale);
    bone.add(obj);
    this.object.matrix.copy(saved);
    this.object.matrixAutoUpdate = true;
  }

  /** Posição de um osso na pose de ligação, no espaço do modelo. */
  restPos(name: string): THREE.Vector3 {
    const out = new THREE.Vector3();
    const s = this.object.scale.clone();
    this.object.scale.set(1, 1, 1);
    this.object.position.set(0, 0, 0);
    this.object.quaternion.identity();
    this.object.updateMatrixWorld(true);
    this.bone(name)?.getWorldPosition(out);
    this.object.scale.copy(s);
    return out;
  }

  info(name: string): ClipInfo {
    return this.asset.info.get(name) ?? { duration: 1, impact: 0.4 };
  }

  apply(pick: AnimPick, dt: number): void {
    // O mixer só reescreve o osso quando o valor do clipe muda: com o tempo parado, o ajuste do
    // quadro anterior ficaria acumulando. Desfaz antes de atualizar.
    for (const [bone, q] of this.overridden) bone.quaternion.copy(q);
    this.overridden.length = 0;
    const clip = this.asset.clips.get(pick.clip);
    if (clip) {
      const action = this.mixer.clipAction(clip);
      if (action !== this.current) {
        const fade = pick.time === undefined ? 0.18 : 0.07;
        action.reset().setEffectiveWeight(1).play();
        // Boneco recém-criado entra direto no clipe: com fade ele sai da pose T (braços abertos e fechando).
        if (this.current) {
          action.fadeIn(fade);
          this.current.fadeOut(fade);
        }
        this.current = action;
      }
      if (pick.time === undefined) {
        action.timeScale = pick.speed;
      } else {
        action.timeScale = 0;
        action.time = Math.min(pick.time, clip.duration - 1e-3);
      }
    }
    this.mixer.update(dt);
    if (pick.tuck) {
      this.object.updateMatrixWorld(true);
      this.object.getWorldQuaternion(_r);
      _x.set(1, 0, 0).applyQuaternion(_r);
      for (const [bone, a] of this.tuckBones) this.rotateWorld(bone, _r.setFromAxisAngle(_x, a * pick.tuck));
    }
    if (pick.kick && this.thighR) {
      // Chute: gira a coxa para a frente em torno do X do modelo, por cima do clipe.
      this.object.updateMatrixWorld(true);
      this.object.getWorldQuaternion(_r);
      _x.set(1, 0, 0).applyQuaternion(_r);
      this.rotateWorld(this.thighR, _r.setFromAxisAngle(_x, -1.45 * pick.kick));
      if (this.hipTilt) this.rotateWorld(this.hipTilt, _r.setFromAxisAngle(_x, 0.3 * pick.kick));
    }
  }

  /** Aplica uma rotação de mundo `q` ao osso: L' = P⁻¹·q·P·L. */
  private rotateWorld(bone: THREE.Object3D, q: THREE.Quaternion): void {
    if (!bone.parent) return;
    this.overridden.push([bone, bone.quaternion.clone()]);
    bone.parent.getWorldQuaternion(_p);
    const pInv = _p.clone().invert();
    bone.quaternion.premultiply(pInv.multiply(q).multiply(_p));
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.object);
  }
}
