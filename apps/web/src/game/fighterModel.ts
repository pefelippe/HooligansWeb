import * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { AnimPick, ClipInfo } from './fighterAnim';

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
}

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
    uSkin: { value: c.skin },
    uShorts: { value: c.shorts },
    uSocks: { value: c.socks },
    uShoes: { value: c.shoes },
    uTrim: { value: c.trim },
    uJersey: { value: c.jersey },
    uSleeve: { value: c.sleeve },
    uStripes: { value: c.stripes ? 1 : 0 },
  };
  m.userData.uniforms = uniforms;
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 uBind;\nvarying vec3 vBind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = (uBind * vec4(position, 1.0)).xyz;');
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vBind;
uniform vec3 uSkin, uShorts, uSocks, uShoes, uTrim;
uniform sampler2D uJersey;
uniform float uSleeve, uStripes;`,
      )
      .replace(
        '#include <map_fragment>',
        `{
  float y = vBind.y, ax = abs(vBind.x);
  vec3 col = uSkin;
  bool arm = ax > ${OUTFIT.armX.toFixed(3)} && y > ${OUTFIT.armY.toFixed(3)};
  bool shirt = arm ? ax < uSleeve : (y >= ${OUTFIT.hem.toFixed(3)} && y < ${OUTFIT.neck.toFixed(3)});
  if (shirt) {
    float v = clamp((y - ${OUTFIT.hem.toFixed(3)}) / ${(OUTFIT.neck - OUTFIT.hem).toFixed(3)}, 0.0, 1.0);
    // Costas: quem olha de trás tem a direita em -X, então u cresce com -x.
    vec2 uv = vBind.z < 0.0 ? vec2(0.5 - vBind.x * 0.9, v) : vec2(abs(vBind.x) * 0.9, v); // frente: meio escudo da borda espelhado
    col = texture2D(uJersey, uv).rgb;
    if (uStripes > 0.5 && !arm && fract(y * 7.0) < 0.35) col = uTrim;
  } else if (y < ${OUTFIT.shoe.toFixed(3)}) col = uShoes;
  else if (y < ${OUTFIT.sock.toFixed(3)}) col = uSocks;
  else if (y >= ${OUTFIT.knee.toFixed(3)} && y < ${OUTFIT.hem.toFixed(3)}) col = uShorts;
  diffuseColor.rgb *= col;
}`,
      );
  };
  return m;
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
        if (b0 && ib0) {
          (body.userData.uniforms as { uBind: { value: THREE.Matrix4 } }).uBind.value.copy(b0.matrixWorld).multiply(ib0).multiply(m.bindMatrix);
        }
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
        action.reset().setEffectiveWeight(1).fadeIn(fade).play();
        this.current?.fadeOut(fade);
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
