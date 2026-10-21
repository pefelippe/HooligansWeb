import {
  attackPhase,
  Buttons,
  createCombatData,
  createSim,
  type Fighter,
  getTorcida,
  type PlayerInput,
  type SimEvent,
  type SimState,
  step,
  TICK_MS,
  TORCIDAS,
  WEAPON_IDS,
  yawTo,
} from '@torcidas/shared';
import * as THREE from 'three';
import { DUMMY_MODES, type DummyMode, type DummyOptions, dummyInput } from './dummy';
import { buildConstantsEditor, buildWeaponEditor, el } from './panel';
import { createFighterView, type FighterView, updateFighterView } from './render';
import './style.css';

// ------------------------------------------------------------------ estado do lab

const data = createCombatData();
const home = TORCIDAS[0];
const rival = getTorcida(home.rivais[0] ?? '') ?? TORCIDAS[1];
let sim: SimState = newSim('punhos', 'punhos');
const dummy: DummyOptions = { mode: 'parado', reactLead: 4 };
let paused = false;
let slowmo = false;
let showHitboxes = true;
let stepOnce = false;
const log: string[] = [];

function newSim(weaponA: string, weaponB: string): SimState {
  return createSim(
    [
      { id: 'voce', team: 0, pos: { x: 0, z: -1 }, facing: 0, weapon: weaponA },
      { id: 'boneco', team: 1, pos: { x: 0, z: 1 }, facing: Math.PI, weapon: weaponB },
    ],
    { arenaHalfSize: 12 },
    data,
  );
}

const player = () => sim.fighters[0] as Fighter;
const foe = () => sim.fighters[1] as Fighter;

// ------------------------------------------------------------------ cena

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
const hud = document.querySelector<HTMLDivElement>('#hud');
const panel = document.querySelector<HTMLElement>('#panel');
const viewport = document.querySelector<HTMLDivElement>('#viewport');
if (!canvas || !hud || !panel || !viewport) throw new Error('HTML do lab incompleto');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14171c);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(6, 12, -4);
sun.castShadow = true;
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(24, 24, 0x3d4450, 0x323842);
grid.position.y = 0.005;
scene.add(grid);

const views: FighterView[] = [
  createFighterView(scene, home.cores[0], home.cores[1]),
  createFighterView(scene, rival.cores[0], rival.cores[1]),
];

function resize() {
  const r = viewport!.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ input

const keys = new Set<string>();
let mouseButtons = 0;
const mouseNdc = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
  if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyP') paused = !paused;
  if (e.code === 'Period') stepOnce = true;
  if (e.code === 'Digit1') slowmo = !slowmo;
  if (e.code === 'KeyH') showHitboxes = !showHitboxes;
  if (e.code === 'KeyR') reset();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => {
  keys.clear();
  mouseButtons = 0;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => (mouseButtons = e.buttons));
window.addEventListener('mouseup', (e) => (mouseButtons = e.buttons));
canvas.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect();
  mouseNdc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
});

function playerInput(): PlayerInput {
  // Câmera olha para +Z: direita da tela = -X.
  const mx = (keys.has('KeyA') ? 1 : 0) - (keys.has('KeyD') ? 1 : 0);
  const mz = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const len = Math.hypot(mx, mz) || 1;
  raycaster.setFromCamera(mouseNdc, camera);
  const hit = new THREE.Vector3();
  const p = player();
  const aim = raycaster.ray.intersectPlane(groundPlane, hit) ? yawTo(p.pos, { x: hit.x, z: hit.z }) : p.facing;
  let buttons = 0;
  if (mouseButtons & 1) buttons |= Buttons.LIGHT;
  if (mouseButtons & 2) buttons |= Buttons.HEAVY;
  if (keys.has('KeyF')) buttons |= Buttons.BLOCK;
  if (keys.has('KeyC')) buttons |= Buttons.DODGE;
  if (keys.has('Space')) buttons |= Buttons.JUMP;
  if (keys.has('ShiftLeft') || keys.has('ShiftRight')) buttons |= Buttons.RUN;
  if (keys.has('KeyR')) buttons |= Buttons.SPECIAL;
  if (keys.has('KeyG')) buttons |= Buttons.SHOUT;
  if (keys.has('Digit4')) buttons |= Buttons.HEAL;
  if (keys.has('KeyX')) buttons |= Buttons.USE;
  if (keys.has('KeyE')) buttons |= Buttons.SHOVE;
  if (keys.has('KeyQ')) buttons |= Buttons.KICK;
  if (keys.has('Tab')) buttons |= Buttons.LOCK;
  return { moveX: mx / len, moveZ: mz / len, aim, buttons };
}

// ------------------------------------------------------------------ feedback

let shake = 0;

function damageNumber(target: Fighter, text: string, color: string) {
  const v = new THREE.Vector3(target.pos.x, 2.1, target.pos.z).project(camera);
  const r = viewport!.getBoundingClientRect();
  const div = el('div', { class: 'dmg' }, text);
  div.style.color = color;
  div.style.left = `${((v.x + 1) / 2) * r.width}px`;
  div.style.top = `${((1 - v.y) / 2) * r.height}px`;
  viewport!.append(div);
  requestAnimationFrame(() => {
    div.style.transform = 'translateY(-40px)';
    div.style.opacity = '0';
  });
  setTimeout(() => div.remove(), 700);
}

function handleEvents(events: SimEvent[]) {
  for (const e of events) {
    const name = (id: string) => (id === 'voce' ? 'você' : id);
    let line = '';
    switch (e.type) {
      case 'hit': {
        const t = sim.fighters.find((f) => f.id === e.target);
        if (t) damageNumber(t, `${e.damage.toFixed(1)}${e.backstab ? ' COSTAS' : ''}`, e.armored ? '#c77dff' : '#ffd166');
        shake = Math.max(shake, e.knockdown ? 0.25 : 0.12);
        line = `${name(e.attacker)} acertou ${name(e.target)} com ${e.move}: ${e.damage.toFixed(1)}${e.armored ? ' (armadura)' : ''}${e.backstab ? ' (costas)' : ''}`;
        break;
      }
      case 'block':
        line = `${name(e.target)} bloqueou ${e.move}: chip ${e.chip.toFixed(1)}, estamina -${e.staminaDrain.toFixed(1)}`;
        break;
      case 'parry': {
        const t = sim.fighters.find((f) => f.id === e.target);
        if (t) damageNumber(t, 'PARRY', '#ffd60a');
        shake = Math.max(shake, 0.1);
        line = `${name(e.target)} deu PARRY em ${name(e.attacker)} (${e.move})`;
        break;
      }
      case 'guardbreak':
        line = `${name(e.target)} teve a guarda QUEBRADA`;
        break;
      case 'whiff':
        line = `${name(e.attacker)} errou ${e.move}`;
        break;
      case 'weaponBreak':
        line = `arma de ${name(e.fighter)} quebrou: ${e.weapon} → ${e.into}`;
        break;
      case 'ko':
        line = `NOCAUTE: ${name(e.target)}`;
        break;
      case 'respawn':
        line = `${name(e.fighter)} renasceu`;
        break;
      default:
        continue;
    }
    log.unshift(`[${String(e.tick).padStart(5)}] ${line}`);
  }
  log.length = Math.min(log.length, 60);
}

// ------------------------------------------------------------------ painel

let weaponA = 'punhos';
let weaponB = 'punhos';
const weaponEditorBox = el('div');
const logBox = el('div', { id: 'log' });

function reset() {
  sim = newSim(weaponA, weaponB);
  log.length = 0;
}

function select(options: Record<string, string>, value: string, onChange: (v: string) => void) {
  const s = el('select');
  for (const [v, label] of Object.entries(options)) s.append(el('option', { value: v }, label));
  s.value = value;
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

const weaponOptions = Object.fromEntries(WEAPON_IDS.map((id) => [id, data.weapons[id]?.nome ?? id]));
const exportArea = el('textarea', { rows: '6', readonly: '' });

panel.append(
  el('h2', {}, 'Lutadores'),
  el('label', { class: 'field' }, el('span', {}, 'Sua arma'), select(weaponOptions, weaponA, (v) => {
    weaponA = v;
    player().weapon = v;
    player().durability = data.weapons[v]?.durabilidade ?? null;
    renderWeaponEditor();
  })),
  el('label', { class: 'field' }, el('span', {}, 'Arma do boneco'), select(weaponOptions, weaponB, (v) => {
    weaponB = v;
    foe().weapon = v;
    foe().durability = data.weapons[v]?.durabilidade ?? null;
  })),
  el('h2', {}, 'Boneco'),
  select(DUMMY_MODES, dummy.mode, (v) => (dummy.mode = v as DummyMode)),
  (() => {
    const input = el('input', { type: 'number', step: '1', min: '0' });
    input.value = String(dummy.reactLead);
    input.addEventListener('input', () => (dummy.reactLead = Math.max(0, Number(input.value) || 0)));
    return el('label', { class: 'field' }, el('span', {}, 'Reage N ticks antes do impacto'), input);
  })(),
  el('div', { class: 'row' }, ...[
    ['Reset (R)', reset],
    ['Vida cheia', () => sim.fighters.forEach((f) => ((f.hp = data.constants.maxHp), (f.stamina = data.constants.maxStamina)))],
    ['Raça cheia', () => sim.fighters.forEach((f) => (f.raca = data.constants.raca.max))],
    ['+3 curativos', () => (player().curativos += 3)],
  ].map(([label, fn]) => {
    const b = el('button', {}, label as string);
    b.addEventListener('click', fn as () => void);
    return b;
  })),
  el('h2', {}, 'Registro'),
  logBox,
  el('h2', {}, 'Constantes'),
  buildConstantsEditor(data),
  el('h2', {}, 'Frame data da sua arma'),
  weaponEditorBox,
  el('h2', {}, 'Exportar'),
  (() => {
    const b = el('button', {}, 'Gerar JSON dos dados atuais');
    b.addEventListener('click', () => {
      exportArea.value = JSON.stringify({ constants: data.constants, weapon: data.weapons[weaponA], common: data.common }, null, 2);
      exportArea.select();
    });
    return b;
  })(),
  exportArea,
);

function renderWeaponEditor() {
  weaponEditorBox.replaceChildren(buildWeaponEditor(data, weaponA));
}
renderWeaponEditor();

// ------------------------------------------------------------------ HUD

function bar(value: number, max: number, color: string) {
  return `<div class="bar"><i style="width:${Math.max(0, (value / max) * 100)}%;background:${color}"></i></div>`;
}

function card(f: Fighter, title: string) {
  const c = data.constants;
  let timeline = '';
  let frame = '';
  if (f.state === 'attack' && f.move) {
    const d = f.move.def;
    const total = d.startup + d.active + d.recovery;
    const pct = (n: number) => `${(n / total) * 100}%`;
    timeline = `<div class="timeline">
      <span style="width:${pct(d.startup)};background:var(--startup)"></span>
      <span style="width:${pct(d.active)};background:var(--active)"></span>
      <span style="width:${pct(d.recovery)};background:var(--recovery)"></span>
      <i class="cursor" style="left:${pct(f.stateTick - 0.5)}"></i></div>`;
    frame = `${d.id} · frame ${f.stateTick}/${total} · ${attackPhase(d, f.stateTick)}`;
  } else if (f.state === 'charging' && f.move) {
    frame = `carga ${f.stateTick}/${f.move.def.chargeTicks ?? 0}`;
  } else if (f.stateDuration) {
    frame = `${f.stateTick}/${f.stateDuration}`;
  } else {
    frame = `${f.stateTick}`;
  }
  const parry = f.state === 'block' && f.parryEligible && sim.tick - f.blockStartTick <= c.parryWindow ? ' <b style="color:#ffd60a">PARRY</b>' : '';
  return `<div class="card"><h3>${title} · ${data.weapons[f.weapon]?.nome ?? f.weapon}${f.durability !== null ? ` (${f.durability})` : ''}</h3>
    <div class="row"><span>${f.state}${parry}</span><span class="muted">${frame}</span></div>
    ${bar(f.hp, c.maxHp, '#e63946')}${bar(f.stamina, c.maxStamina, '#4cc9f0')}
    <div class="row muted"><span>HP ${f.hp.toFixed(1)}</span><span>EST ${f.stamina.toFixed(1)}</span><span>hitstop ${f.hitstop}</span></div>
    <div class="row muted"><span>sangr. ${f.bleeds.length}</span><span>buffer ${f.buffer?.action ?? '-'}</span><span>lock ${f.lockTarget ?? '-'}</span></div>
    ${timeline}</div>`;
}

// ------------------------------------------------------------------ loop

let acc = 0;
let last = performance.now();

function tick() {
  const p = player();
  const b = foe();
  const events = step(sim, { voce: playerInput(), boneco: dummyInput(b, p, sim.tick, dummy) }, data);
  handleEvents(events);
}

function frame(now: number) {
  const dt = Math.min(250, now - last);
  last = now;
  if (!paused) {
    acc += dt * (slowmo ? 0.25 : 1);
    while (acc >= TICK_MS) {
      tick();
      acc -= TICK_MS;
    }
  } else if (stepOnce) {
    tick();
  }
  stepOnce = false;

  for (const [i, v] of views.entries()) {
    const f = sim.fighters[i];
    if (f) updateFighterView(v, f, sim, data, showHitboxes);
  }
  const p = player();
  const b = foe();
  const mid = new THREE.Vector3((p.pos.x + b.pos.x) / 2, 0, (p.pos.z + b.pos.z) / 2);
  shake *= 0.85;
  camera.position.set(mid.x + Math.sin(now * 0.09) * shake, 10 + Math.cos(now * 0.11) * shake, mid.z - 7.5);
  camera.lookAt(mid.x, 0.6, mid.z);
  renderer.render(scene, camera);

  hud!.innerHTML = card(p, 'Você') + card(b, 'Boneco') + `<div class="card" style="min-width:auto">tick ${sim.tick}${paused ? ' · PAUSA' : ''}${slowmo ? ' · 0.25x' : ''}</div>`;
  logBox.textContent = log.join('\n');
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
