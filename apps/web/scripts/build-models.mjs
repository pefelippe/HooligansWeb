// Monta public/models/fighter.glb a partir dos pacotes CC0 do Quaternius em assets-src/quaternius
// (gitignored; baixe Universal Base Characters, Universal Animation Library 1 e 2, versões Standard).
//
//   pnpm --filter @torcidas/web models
//
// Sai um arquivo só: corpo (Superhero_Male) e só as
// animações que o jogo usa. Texturas, cores de vértice e UVs saem: o jogo pinta
// a roupa no shader e monta cabelo/acessórios por cima do osso da cabeça.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, mergeDocuments, meshopt, prune, resample, simplify, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.join(root, 'assets-src/quaternius');
const out = path.join(root, 'apps/web/public/models/fighter.glb');

const BODY = 'Universal Base Characters[Standard]/Base Characters/Godot - UE/Superhero_Male_FullBody.gltf';
const ANIMS = {
  'Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb': [
    'Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Jump_Start', 'Jump_Loop', 'Jump_Land',
    'Punch_Jab', 'Punch_Cross', 'Sword_Attack', 'Sword_Idle', 'Roll', 'Hit_Chest', 'Hit_Head', 'Death01',
    'Crouch_Idle_Loop', 'Fixing_Kneeling', 'Spell_Simple_Shoot',
  ],
  'Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard.glb': [
    'Hit_Knockback', 'LayToIdle', 'Melee_Hook', 'Sword_Block', 'Sword_Regular_A', 'Sword_Regular_B', 'Sword_Regular_C',
    'Sword_Heavy_Combo', 'Sword_Dash', 'Shield_OneShot', 'Consume', 'Idle_Shield_Break',
  ],
};

for (const f of [BODY, ...Object.keys(ANIMS)]) {
  if (!existsSync(path.join(src, f))) throw new Error(`Falta ${f} em ${src}. Veja o comentário no topo deste script.`);
}

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression])
  .registerDependencies({ 'meshopt.simplifier': MeshoptSimplifier, 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

/** Lê .gltf ignorando as imagens (algumas faltam no pacote e o jogo não usa textura). */
async function read(file) {
  if (file.endsWith('.glb')) return io.read(file);
  const json = JSON.parse(readFileSync(file, 'utf8'));
  delete json.images;
  delete json.textures;
  delete json.samplers;
  for (const m of json.materials ?? []) {
    delete m.normalTexture;
    delete m.occlusionTexture;
    delete m.emissiveTexture;
    if (m.pbrMetallicRoughness) {
      delete m.pbrMetallicRoughness.baseColorTexture;
      delete m.pbrMetallicRoughness.metallicRoughnessTexture;
    }
  }
  const resources = {};
  for (const b of json.buffers ?? []) resources[b.uri] = new Uint8Array(readFileSync(path.join(path.dirname(file), b.uri)));
  return io.readJSON({ json, resources });
}

const doc = await read(path.join(src, BODY));
const body = doc.getRoot();
const bodySkin = body.listSkins()[0];
const boneByName = new Map(bodySkin.listJoints().map((j) => [j.getName(), j]));

// Animações: os canais apontam para os ossos do pacote; troca pelos ossos do corpo com o mesmo nome.
for (const [file, keep] of Object.entries(ANIMS)) {
  const adoc = await read(path.join(src, file));
  for (const a of adoc.getRoot().listAnimations()) if (!keep.includes(a.getName())) a.dispose();
  const missing = keep.filter((k) => !adoc.getRoot().listAnimations().some((a) => a.getName() === k));
  if (missing.length) throw new Error(`Animações não encontradas em ${file}: ${missing.join(', ')}`);
  await adoc.transform(prune());
  const map = mergeDocuments(doc, adoc);
  for (const a of adoc.getRoot().listAnimations()) {
    for (const ch of map.get(a).listChannels()) {
      const target = ch.getTargetNode();
      const bone = target && boneByName.get(target.getName());
      // Root motion fica de fora: quem move o lutador é a simulação.
      // Escala e translação (fora a pelve) não mudam nesse rig; pontas (_leaf) não têm malha.
      const path = ch.getTargetPath();
      const useless = path === 'scale' || (path === 'translation' && bone?.getName() !== 'pelvis') || bone?.getName().includes('_leaf');
      if (!bone || bone.getName() === 'root' || useless) {
        const smp = ch.getSampler();
        smp?.getOutput()?.dispose();
        smp?.dispose();
        ch.dispose();
        continue;
      }
      ch.setTargetNode(bone);
      // Pelve: só a altura (Z no espaço do root, que é Z-up). Deslocamento horizontal descolaria o boneco da hitbox.
      if (bone.getName() === 'pelvis' && ch.getTargetPath() === 'translation') {
        const outp = ch.getSampler().getOutput();
        const rest = bone.getTranslation();
        const v = outp.getArray().slice();
        for (let i = 0; i < v.length; i += 3) {
          v[i] = rest[0];
          v[i + 1] = rest[1];
        }
        outp.dispose();
        ch.getSampler().setOutput(doc.createAccessor().setType('VEC3').setArray(v).setBuffer(body.listBuffers()[0]));
      }
    }
  }
  for (const n of adoc.getRoot().listNodes()) map.get(n)?.dispose();
  for (const m of adoc.getRoot().listMeshes()) map.get(m)?.dispose();
  for (const sk of adoc.getRoot().listSkins()) map.get(sk)?.dispose();
  for (const sc of adoc.getRoot().listScenes()) map.get(sc)?.dispose();
}

// Só geometria + esqueleto: sem texturas, cores de vértice nem UVs.
for (const t of body.listTextures()) t.dispose();
for (const m of body.listMeshes()) {
  for (const p of m.listPrimitives()) {
    for (const sem of p.listSemantics()) if (/^(COLOR_|TEXCOORD_)/.test(sem)) p.setAttribute(sem, null);
  }
}
// Um buffer só no arquivo final.
const buffer = body.listBuffers()[0];
for (const b of body.listBuffers()) if (b !== buffer) b.dispose();
for (const a of body.listAccessors()) a.setBuffer(buffer);

await doc.transform(prune(), dedup(), weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 0.5, error: 0.001 }), resample({ tolerance: 1e-3 }), prune(),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }), prune());

mkdirSync(path.dirname(out), { recursive: true });
// Samplers soltos (de animações descartadas) seguram accessors que o prune não vê: relê e poda de novo.
const final = await io.readBinary(await io.writeBinary(doc));
await final.transform(prune());
await io.write(out, final);
const tris = body.listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((t, p) => t + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);
console.log(`ok: ${path.relative(root, out)} · ${body.listMeshes().length} malhas · ${tris} triângulos · ${body.listAnimations().length} animações`);
console.log('malhas:', body.listNodes().filter((n) => n.getMesh()).map((n) => n.getName()).join(', '));
