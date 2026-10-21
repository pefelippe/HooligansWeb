import {
  angleDiff,
  Buttons,
  DEFAULT_COMBAT_DATA,
  DEFAULT_CONSTANTS,
  dirFromYaw,
  type Fighter,
  type FighterSnapshot,
  generateMap,
  inRect,
  type GameMap,
  type MatchEvent,
  type MatchResult,
  type MatchSnapshotInfo,
  Predictor,
  segmentBoxHit,
  simSedes,
  type RosterEntry,
  type TeamSide,
  TICK_MS,
  toSnapshot,
  TORCIDAS,
  type Vec2,
  yawTo,
} from '@torcidas/shared';
import * as THREE from 'three';
import { CharacterView } from './character';
import { CombatFx } from './fx';
import { ControlPoints, POINT_COLORS } from './points';
import { GameConnection, type Welcome } from './net';
import { buildScene } from './scene';
import { setMusicIntensity, startMusic, stopMusic, toggleMusic, isMusicOn } from './music';
import { type HitMaterial, isMuted, playSound, type SoundName, setMuted, startAmbience, stopAmbience } from './sfx';

export interface HudState {
  connected: boolean;
  you: string | null;
  team: TeamSide | null;
  me: FighterSnapshot | null;
  match: MatchSnapshotInfo | null;
  fighters: FighterSnapshot[];
  roster: Record<string, RosterEntry>;
  inOwnSede: boolean;
  inEnemySede: boolean;
  respawnIn: number | null;
  pointerLocked: boolean;
  lockTargetNick: string | null;
  rtt: number;
  /** Dicas de contexto (X: levantar, R: especial...). */
  prompts: string[];
  warnings: string[];
  muted: boolean;
  musicOn: boolean;
}

export interface EngineCallbacks {
  onHud(h: HudState): void;
  onFeed(e: { id: number; text: string; mine: boolean }): void;
  onHitFrom(angleRad: number, damage: number): void;
  onBuyResult(ok: boolean, item: string, reason?: string): void;
  onMatchEnd(r: MatchResult): void;
  onToggleShop(): void;
  onScoreboard(show: boolean): void;
  onClose(reason: string): void;
}

const CAM_DIST = 4.4;
const SHOULDER = 0.7;
/** Assistência de mira (sem lock-on): alcance e meia-abertura do cone. */
const ASSIST_RANGE = 3;
const ASSIST_HALF_ANGLE = (35 * Math.PI) / 180;
/** Números de golpes entre outros jogadores só aparecem perto de você. */
const OTHERS_FX_RANGE = 20;

export class GameEngine {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera = new THREE.PerspectiveCamera(65, 1, 0.1, 300);
  private scene: THREE.Scene | null = null;
  private map: GameMap | null = null;
  private readonly conn: GameConnection;
  private readonly views = new Map<string, CharacterView>();
  /** Nick+visual com que cada boneco foi montado: muda no roster = monta de novo. */
  private readonly viewKeys = new Map<string, string>();
  private roster: Record<string, RosterEntry> = {};
  private welcome: Welcome | null = null;
  private raf = 0;
  private last = performance.now();
  private inputAcc = 0;
  private hudAcc = 0;
  private yaw = Math.PI / 2;
  private pitch = 0.25;
  private shake = 0;
  private feedId = 0;
  // Input.
  private readonly keys = new Set<string>();
  private mouse = 0;
  private latch = 0;
  private tabDownAt = 0;
  private scoreboardShown = false;
  inputEnabled = true;
  private readonly cleanup: (() => void)[] = [];
  /** Estado anterior de cada lutador, para disparar sons de assobio, passos, pulo e aterrissagem. */
  private readonly prev = new Map<string, { move: string | null; stateTick: number; y: number; step: number; state: string }>();
  private meNow: FighterSnapshot | null = null;
  // Predição do próprio lutador.
  private predictor: Predictor | null = null;
  private predPrev: Vec2 | null = null;
  /** Correção visual: erro de reconciliação que decai em vez de "teleportar". */
  private predOffset = { x: 0, z: 0 };
  private minimap: HTMLCanvasElement | null = null;
  private minimapBase: HTMLCanvasElement | null = null;
  private readonly lastPos = new Map<string, Vec2>();
  private fx: CombatFx | null = null;
  private points: ControlPoints | null = null;
  private lastFighters: FighterSnapshot[] = [];
  /** Assistência de mira: segura a mira no inimigo enquanto o golpe sai. */
  private assist: { id: string; until: number } | null = null;
  /** Lock-on: um puxão forte do mouse troca de alvo. */
  private flick = { acc: 0, at: 0 };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    url: string,
    ticket: string,
    private readonly cb: EngineCallbacks,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.conn = new GameConnection(url, ticket, {
      onWelcome: (w) => this.onWelcome(w),
      onRoster: (players) => {
        this.roster = Object.fromEntries(players.map((p) => [p.id, p]));
      },
      onEvents: (ev) => this.onEvents(ev),
      onBuyResult: (ok, item, reason) => {
        playSound(ok ? 'buy' : 'deny', { volume: 0.7 });
        cb.onBuyResult(ok, item, reason);
      },
      onMatchEnd: (r) => cb.onMatchEnd(r),
      onSnapshot: (tick, ackSeq, self, fighters) => this.reconcile(tick, ackSeq, self, fighters),
      onClose: (reason) => cb.onClose(reason),
    });
    this.bindInput();
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.conn.close();
    for (const f of this.cleanup) f();
    for (const v of this.views.values()) v.dispose();
    this.fx?.dispose();
    this.points?.dispose();
    this.renderer.dispose();
    stopAmbience();
    stopMusic();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  buy(item: string): void {
    this.conn.buy(item);
  }

  requestPointerLock(): void {
    // O Chrome recusa um novo lock logo depois de um Esc: ignora a falha e segue no modo sem lock.
    try {
      const r = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      r?.catch?.(() => undefined);
    } catch {
      /* sem pointer lock: a câmera segue o mouse sobre o canvas */
    }
  }

  private onWelcome(w: Welcome): void {
    this.welcome = w;
    this.map = generateMap(w.seed);
    const { scene } = buildScene(this.map);
    this.scene = scene;
    this.fx?.dispose();
    this.fx = new CombatFx(scene);
    this.points?.dispose();
    this.points = new ControlPoints(scene, this.map, w.team);
    this.yaw = w.team === 0 ? Math.PI / 2 : -Math.PI / 2;
    this.predictor = new Predictor(w.you, {
      sedes: simSedes(this.map),
      arenaHalfSize: Math.max(this.map.halfW, this.map.halfD),
      collision: { boxes: this.map.boxes, circles: this.map.circles, halfW: this.map.halfW, halfD: this.map.halfD },
      rules: { downed: true },
    });
    this.minimapBase = null;
    startAmbience();
    startMusic();
  }

  setMinimapCanvas(c: HTMLCanvasElement | null): void {
    this.minimap = c;
  }

  private reconcile(tick: number, ackSeq: number, self: Fighter | undefined, fighters: FighterSnapshot[]): void {
    const p = this.predictor;
    if (!p || !self) return;
    const respawn = this.conn.latest?.match.respawnTicks;
    if (respawn) p.respawnTicks = respawn;
    const before = p.self ? { ...p.self.pos } : null;
    p.reconcile(tick, ackSeq, self, fighters);
    const after = p.self?.pos;
    if (before && after) {
      const ex = before.x - after.x;
      const ez = before.z - after.z;
      // Erro pequeno: suaviza. Erro grande (respawn, knockback forte): corrige na hora.
      if (Math.hypot(ex, ez) < 1.5) {
        this.predOffset.x += ex;
        this.predOffset.z += ez;
      } else {
        this.predOffset = { x: 0, z: 0 };
      }
    }
  }

  /** Lutador previsto (posição suavizada entre ticks + correção decaindo). */
  private predictedSelf(alpha: number): FighterSnapshot | null {
    const p = this.predictor;
    const f = p?.self;
    if (!p?.state || !f) return null;
    const snap = toSnapshot(p.state, f);
    const prev = this.predPrev ?? f.pos;
    const jump = Math.hypot(f.pos.x - prev.x, f.pos.z - prev.z) > 2;
    const x = jump ? f.pos.x : prev.x + (f.pos.x - prev.x) * alpha;
    const z = jump ? f.pos.z : prev.z + (f.pos.z - prev.z) * alpha;
    snap.pos = { x: x + this.predOffset.x, z: z + this.predOffset.z };
    return snap;
  }

  /** Volume pela distância até o jogador e pan pela posição relativa à câmera. */
  private spatial(pos: Vec2 | undefined): { volume: number; pan: number } {
    const me = this.meNow;
    if (!pos || !me) return { volume: 1, pan: 0 };
    const d = Math.hypot(pos.x - me.pos.x, pos.z - me.pos.z);
    const volume = 1 / (1 + (d / 6) ** 2);
    // Direita da câmera = dirFromYaw(yaw - PI/2).
    const r = dirFromYaw(this.yaw - Math.PI / 2);
    const dx = pos.x - me.pos.x;
    const dz = pos.z - me.pos.z;
    const pan = d > 0.5 ? (dx * r.x + dz * r.z) / d : 0;
    return { volume, pan };
  }

  private sfxAt(name: SoundName, pos: Vec2 | undefined, material?: HitMaterial, gain = 1): void {
    const sp = this.spatial(pos);
    playSound(name, { volume: sp.volume * gain, pan: sp.pan, ...(material ? { material } : {}) });
  }

  private materialOf(id: string): HitMaterial {
    const f = this.conn.latest?.fighters.get(id);
    const w = f ? DEFAULT_COMBAT_DATA.weapons[f.weapon] : undefined;
    if (!w || w.id === 'punhos') return 'carne';
    if (w.tipo === 'cortante' || w.tipo === 'perfurante') return w.material === 'vidro' ? 'vidro' : 'lamina';
    return w.material;
  }

  private name(id: string | null): string {
    if (!id) return 'a sede';
    return this.roster[id]?.nick ?? id;
  }

  private onEvents(events: MatchEvent[]): void {
    const you = this.welcome?.you ?? '';
    const snap = this.conn.latest;
    const posOf = (id: string) => snap?.fighters.get(id)?.pos;
    const feed = (text: string, mine: boolean) => this.cb.onFeed({ id: ++this.feedId, text, mine });
    // Som só do que envolve você: os golpes dos outros entre si ficam em silêncio (sobra o ambiente).
    for (const e of events) {
      switch (e.type) {
        case 'hit': {
          const crit = e.backstab || e.counter || e.knockdown;
          const mine = e.attacker === you || e.target === you;
          this.damageFx(e.target, e.damage, e.target === you ? 'taken' : e.attacker === you ? (crit ? 'crit' : 'dealt') : 'other', mine);
          this.sparkFx(e.target, crit ? '#ffb020' : '#ffd27a', crit ? 24 : 14, mine);
          if (!mine) break;
          const heavy = e.knockdown || e.damage >= 15;
          this.sfxAt(heavy ? 'heavyHit' : 'hit', posOf(e.target), this.materialOf(e.attacker));
          this.shake = Math.max(this.shake, e.knockdown ? 0.35 : heavy ? 0.25 : 0.15);
          if (e.counter && e.attacker === you) feed('CONTRA-GOLPE!', true);
          if (e.target === you && snap) {
            const a = snap.fighters.get(e.attacker);
            const me = snap.fighters.get(e.target);
            if (a && me) this.cb.onHitFrom(yawTo(me.pos, a.pos) - this.yaw, e.damage);
          }
          break;
        }
        case 'block':
          if (e.chip > 0) this.damageFx(e.target, e.chip, 'chip', e.attacker === you || e.target === you);
          this.sparkFx(e.target, '#bcd8ff', 8, e.attacker === you || e.target === you);
          if (e.attacker !== you && e.target !== you) break;
          this.sfxAt('block', posOf(e.target));
          if (e.target === you) this.shake = Math.max(this.shake, 0.08);
          break;
        case 'parry':
          if (e.attacker !== you && e.target !== you) break;
          this.sfxAt('parry', posOf(e.target));
          if (e.target === you) feed('PARRY! Contra-golpe liberado', true);
          break;
        case 'perfectDodge':
          if (e.target !== you) break;
          playSound('perfectDodge');
          feed('ESQUIVA PERFEITA! Contra-golpe liberado', true);
          break;
        case 'guardbreak':
          if (e.attacker !== you && e.target !== you) break;
          this.sfxAt('guardbreak', posOf(e.target));
          if (e.target === you) feed('Sua guarda quebrou!', true);
          break;
        case 'special':
          if (e.fighter === you) playSound('special');
          break;
        case 'shout':
          if (e.fighter === you || e.buffed.includes(you)) playSound('shout', { volume: 1.2 });
          feed(`${this.name(e.fighter)} puxou o grito da torcida! (${e.buffed.length} na energia)`, e.buffed.includes(you));
          break;
        case 'bleed':
          this.damageFx(e.target, e.damage, 'bleed', e.target === you || e.source === you);
          break;
        case 'heal':
          if (e.fighter === you) playSound('heal', { volume: 0.6 });
          break;
        case 'downed':
          if (e.target === you || e.by === you) playSound('downed');
          feed(`${this.name(e.target)} caiu${e.by ? ` (${this.name(e.by)})` : ''}`, e.target === you || e.by === you);
          break;
        case 'revive':
          if (e.target === you || e.by === you) playSound('revive');
          feed(`${this.name(e.by)} levantou ${this.name(e.target)}`, e.target === you || e.by === you);
          break;
        case 'pointCaptured': {
          const mine = e.team === this.welcome?.team;
          feed(`${mine ? 'Seu time' : 'O rival'} dominou o ponto ${e.point}`, e.by.includes(you));
          if (e.by.includes(you)) playSound('buy', { volume: 0.8 });
          break;
        }
        case 'pointLost':
          feed(`${e.team === this.welcome?.team ? 'Seu time perdeu' : 'O rival perdeu'} o ponto ${e.point}`, e.team === this.welcome?.team);
          break;
        case 'ko': {
          const mine = e.target === you || e.killer === you || e.assists.includes(you);
          feed(`${e.killer ? this.name(e.killer) : 'a sede'} nocauteou ${this.name(e.target)}`, mine);
          if (mine) playSound('ko', { volume: 1.1 });
          break;
        }
        case 'weaponBreak':
          if (e.fighter !== you) break;
          playSound('weaponBreak');
          feed(`Sua arma quebrou (${e.weapon} → ${e.into})`, true);
          break;
        default:
          break;
      }
    }
  }

  private nearMe(id: string): boolean {
    const me = this.meNow;
    const f = this.conn.latest?.fighters.get(id);
    return !!(me && f && Math.hypot(f.pos.x - me.pos.x, f.pos.z - me.pos.z) <= OTHERS_FX_RANGE);
  }

  /** Número de dano sobre o alvo. Golpes entre outros: pequeno e apagado, e só perto de você. */
  private damageFx(target: string, amount: number, kind: 'dealt' | 'crit' | 'taken' | 'chip' | 'bleed' | 'other', mine: boolean): void {
    const v = this.views.get(target);
    if (!this.fx || !v || (!mine && !this.nearMe(target))) return;
    const n = Math.max(1, Math.round(amount));
    const styles = {
      dealt: { color: '#ffffff', size: 1, opacity: 1 },
      crit: { color: '#ffb020', size: 1.4, opacity: 1 },
      taken: { color: '#ff4d5e', size: 1.1, opacity: 1 },
      chip: { color: '#9aa3ad', size: 0.8, opacity: mine ? 1 : 0.55 },
      bleed: { color: '#c0263f', size: 0.65, opacity: mine ? 1 : 0.55 },
      other: { color: '#d6dbe2', size: 0.7, opacity: 0.55 },
    } as const;
    this.fx.number(v.root, kind === 'crit' ? `${n}!` : String(n), styles[kind]);
  }

  private sparkFx(target: string, color: string, count: number, mine: boolean): void {
    const v = this.views.get(target);
    if (!this.fx || !v || (!mine && !this.nearMe(target))) return;
    this.fx.spark(v.root, color, mine ? count : Math.ceil(count / 2));
  }

  /** Sons que saem do estado (sem evento): assobio do golpe, passos, pulo, aterrissagem, churrasqueira. */
  private stateSounds(f: FighterSnapshot, walked: number): void {
    if (f.id !== this.welcome?.you) return; // só os seus passos, assobios e pulos
    const p = this.prev.get(f.id) ?? { move: null, stateTick: 0, y: 0, step: 0, state: f.state };
    if (f.state === 'attack' && f.move && (f.move !== p.move || f.stateTick < p.stateTick)) {
      const def = DEFAULT_COMBAT_DATA.weapons[f.weapon];
      const big = f.move.endsWith('.h') || f.move.endsWith('.esp') || def?.id === 'taco' || def?.id === 'barra';
      this.sfxAt(big ? 'bigWhoosh' : 'whoosh', f.pos, undefined, 0.8);
    }
    if (f.y > 0.05 && p.y <= 0.05) this.sfxAt('jump', f.pos, undefined, 0.7);
    if (f.y <= 0.01 && p.y > 0.3) this.sfxAt('land', f.pos, undefined, 0.8);
    if (f.state === 'eating' && p.state !== 'eating') this.sfxAt('sizzle', f.pos);
    // Um passo a cada 0,8 m andando (passada maior correndo).
    let step = p.step + walked;
    const stride = f.running ? 1.2 : 0.8;
    if (f.y <= 0.01 && step >= stride) {
      step = 0;
      this.sfxAt('step', f.pos, undefined, f.running ? 0.6 : 0.35);
    }
    this.prev.set(f.id, { move: f.state === 'attack' ? f.move : null, stateTick: f.stateTick, y: f.y, step, state: f.state });
  }

  private contextHints(me: FighterSnapshot | null, fighters: FighterSnapshot[], points: MatchSnapshotInfo['points'] = []): { prompts: string[]; warnings: string[] } {
    const prompts: string[] = [];
    const warnings: string[] = [];
    const c = DEFAULT_CONSTANTS;
    if (!me || me.state === 'ko' || me.state === 'dead') return { prompts, warnings };
    if (me.state === 'downed') return { prompts, warnings };
    // Dentro de um ponto de controle: o que está acontecendo com a captura.
    const cp = this.map?.controlPoints.find((p) => Math.hypot(p.pos.x - me.pos.x, p.pos.z - me.pos.z) <= p.radius);
    const st = cp && points.find((p) => p.id === cp.id);
    if (cp && st) {
      if (st.contested) warnings.push(`Ponto ${cp.id} disputado: tire o rival da praça`);
      else if (st.owner === me.team && st.progress >= 1) prompts.push(`Ponto ${cp.id} é do seu time`);
      else if (st.capTeam === me.team) prompts.push(`Capturando o ponto ${cp.id}: ${Math.round(st.progress * 100)}%`);
      else prompts.push(`Neutralizando o ponto ${cp.id}: ${Math.round((1 - st.progress) * 100)}%`);
    }
    const ally = fighters.find(
      (f) => f.team === me.team && f.id !== me.id && f.state === 'downed' && Math.hypot(f.pos.x - me.pos.x, f.pos.z - me.pos.z) <= c.downed.reviveRange,
    );
    if (me.state === 'reviving') prompts.push('X: segure para levantar');
    else if (ally && this.inCombat(me, ally, fighters)) warnings.push('Em combate: não dá para levantar');
    else if (ally) prompts.push(`X (segure): levantar ${this.name(ally.id)}`);
    else if (this.nearCart(me)) prompts.push(`X: churrasquinho $${c.cart.cost} (+${(c.cart.ticks / c.cart.interval) * c.cart.amount} vida)`);
    if (me.curativos > 0 && me.hp < c.maxHp * 0.5) prompts.push(`4: usar curativo (${me.curativos})`);
    if (me.state === 'block' && me.stamina < c.maxStamina * 0.15) warnings.push('Guarda fraca: pouco fôlego');
    if (me.bleeding > 0 && me.curativos > 0) warnings.push('Sangrando: o curativo (4) estanca');
    return { prompts, warnings };
  }

  /** Mesma regra do servidor (canRevive): dano recente ou inimigo perto impedem levantar. */
  private inCombat(me: FighterSnapshot, ally: FighterSnapshot, fighters: FighterSnapshot[]): boolean {
    const d = DEFAULT_CONSTANTS.downed;
    const self = this.predictor?.self;
    const tick = this.conn.serverTick(performance.now());
    const fought = !!self && self.lastCombatTick > 0 && tick - self.lastCombatTick < d.combatLockTicks;
    const standing = (f: FighterSnapshot) => f.state !== 'ko' && f.state !== 'dead' && f.state !== 'downed';
    const near = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z) <= d.enemyBlockRange;
    return fought || fighters.some((f) => f.team !== me.team && standing(f) && (near(f.pos, me.pos) || near(f.pos, ally.pos)));
  }

  private nearCart(me: FighterSnapshot): boolean {
    const r = DEFAULT_CONSTANTS.cart.range;
    return !!this.map?.boxes.some((b) => {
      if (b.kind !== 'carrinho') return false;
      const dx = Math.max(Math.abs(me.pos.x - b.x) - b.hw, 0);
      const dz = Math.max(Math.abs(me.pos.z - b.z) - b.hd, 0);
      return Math.hypot(dx, dz) <= r;
    });
  }

  /** Minimapa: norte = estádio. Aliados sempre; inimigos só perto de você ou de um aliado. */
  private drawMinimap(me: FighterSnapshot | null, fighters: FighterSnapshot[], points: MatchSnapshotInfo['points']): void {
    const c = this.minimap;
    const map = this.map;
    if (!c || !map || !this.welcome) return;
    const W = c.width;
    const H = c.height;
    const sx = W / (map.halfW * 2);
    const sz = H / (map.halfD * 2);
    const px = (x: number) => (x + map.halfW) * sx;
    const pz = (z: number) => (map.halfD - z) * sz;
    if (!this.minimapBase || this.minimapBase.width !== W) {
      const b = document.createElement('canvas');
      b.width = W;
      b.height = H;
      const g = b.getContext('2d');
      if (g) {
        g.fillStyle = '#1b1f26';
        g.fillRect(0, 0, W, H);
        for (const box of map.boxes) {
          if (box.kind === 'estadio' || box.kind === 'muro' || box.kind === 'grade') continue;
          g.fillStyle = box.kind === 'carro' ? '#3a404b' : box.kind === 'onibus' ? '#59606c' : '#6b5536';
          g.fillRect(px(box.x - box.hw), pz(box.z + box.hd), box.hw * 2 * sx, box.hd * 2 * sz);
        }
        g.fillStyle = '#2a2f38';
        g.fillRect(0, 0, W, 4);
        map.sedes.forEach((sd, team) => {
          const t = TORCIDAS[team];
          if (!t) return;
          const a = sd.area;
          g.beginPath();
          g.rect(px(a.x - a.hw), pz(a.z + a.hd), a.hw * 2 * sx, a.hd * 2 * sz);
          g.fillStyle = team === this.welcome?.team ? 'rgba(80,170,255,0.18)' : 'rgba(255,80,80,0.18)';
          g.fill();
          g.strokeStyle = team === this.welcome?.team ? 'rgba(80,170,255,0.7)' : 'rgba(255,80,80,0.7)';
          g.lineWidth = 1.5;
          g.stroke();
        });
      }
      this.minimapBase = b;
    }
    const g = c.getContext('2d');
    if (!g) return;
    g.drawImage(this.minimapBase, 0, 0);
    // Pontos de controle: círculo na cor do dono e a letra.
    for (const p of points) {
      const cp = map.controlPoints.find((x) => x.id === p.id);
      if (!cp) continue;
      const color = p.owner === null ? POINT_COLORS.neutral : p.owner === this.welcome.team ? POINT_COLORS.ally : POINT_COLORS.enemy;
      g.beginPath();
      g.arc(px(cp.pos.x), pz(cp.pos.z), Math.max(4, cp.radius * sx), 0, Math.PI * 2);
      g.fillStyle = color + '55';
      g.fill();
      g.strokeStyle = color;
      g.lineWidth = p.contested ? 2.5 : 1.5;
      g.stroke();
      g.fillStyle = '#fff';
      g.font = '700 9px Inter, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(p.id, px(cp.pos.x), pz(cp.pos.z));
    }
    const myTeam = this.welcome.team;
    const allies = fighters.filter((f) => f.team === myTeam && f.state !== 'dead');
    const seen = (f: FighterSnapshot) => allies.some((a) => Math.hypot(a.pos.x - f.pos.x, a.pos.z - f.pos.z) < 16);
    const blink = Math.floor(performance.now() / 300) % 2 === 0;
    for (const f of fighters) {
      if (f.id === me?.id || f.state === 'dead') continue;
      const ally = f.team === myTeam;
      if (!ally && !seen(f)) continue;
      const x = px(f.pos.x);
      const y = pz(f.pos.z);
      if (f.state === 'downed' || f.state === 'ko') {
        if (ally && !blink) continue;
        g.strokeStyle = ally ? '#7ee787' : '#ff6b6b';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x - 3, y);
        g.lineTo(x + 3, y);
        g.moveTo(x, y - 3);
        g.lineTo(x, y + 3);
        g.stroke();
        continue;
      }
      g.beginPath();
      g.arc(x, y, 3, 0, Math.PI * 2);
      g.fillStyle = ally ? '#4dabf7' : '#ff5c5c';
      g.fill();
    }
    if (me) {
      // Você: seta na direção da câmera. Mundo (x, z) -> mapa (x, -z).
      const d = dirFromYaw(this.yaw);
      const ang = Math.atan2(-d.z, d.x);
      const x = px(me.pos.x);
      const y = pz(me.pos.z);
      g.save();
      g.translate(x, y);
      g.rotate(ang);
      g.beginPath();
      g.moveTo(7, 0);
      g.lineTo(-4, -4.5);
      g.lineTo(-2, 0);
      g.lineTo(-4, 4.5);
      g.closePath();
      g.fillStyle = '#ffd166';
      g.fill();
      g.strokeStyle = '#000';
      g.lineWidth = 1;
      g.stroke();
      g.restore();
    }
  }

  // ------------------------------------------------------------------ input

  private bindInput(): void {
    const on = <K extends keyof WindowEventMap>(t: K, fn: (e: WindowEventMap[K]) => void, target: Window | HTMLElement = window) => {
      target.addEventListener(t, fn as EventListener);
      this.cleanup.push(() => target.removeEventListener(t, fn as EventListener));
    };
    const LATCH: Record<string, number> = {
      Space: Buttons.JUMP,
      KeyC: Buttons.DODGE,
      KeyE: Buttons.SHOVE,
      KeyQ: Buttons.KICK,
      KeyR: Buttons.SPECIAL,
      KeyG: Buttons.SHOUT,
      Digit4: Buttons.HEAL,
    };
    on('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      if (e.repeat) return;
      if (e.code === 'KeyJ') {
        this.cb.onToggleShop();
        return;
      }
      if (e.code === 'KeyM') {
        setMuted(!isMuted());
        return;
      }
      if (e.code === 'KeyN') {
        toggleMusic();
        return;
      }
      if (e.code === 'Tab') {
        this.tabDownAt = performance.now();
        return;
      }
      this.keys.add(e.code);
      const bit = LATCH[e.code];
      if (bit) this.latch |= bit;
    });
    on('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Tab') {
        // Tab tocado = lock-on; segurado = placar.
        if (performance.now() - this.tabDownAt < 220) this.latch |= Buttons.LOCK;
        this.tabDownAt = 0;
        if (this.scoreboardShown) {
          this.scoreboardShown = false;
          this.cb.onScoreboard(false);
        }
      }
    });
    // Aba em segundo plano para o rAF e o servidor repete o último input: solta tudo na hora.
    const releaseAll = () => {
      this.keys.clear();
      this.mouse = 0;
      this.latch = 0;
      this.conn.sendInput({ moveX: 0, moveZ: 0, aim: this.yaw, buttons: 0 });
    };
    on('blur', releaseAll);
    const onVis = () => {
      if (document.hidden) releaseAll();
    };
    document.addEventListener('visibilitychange', onVis);
    this.cleanup.push(() => document.removeEventListener('visibilitychange', onVis));
    on('mousedown', (e) => {
      // Com ou sem pointer lock: só não ataca ao clicar em botões do HUD.
      if (document.pointerLockElement !== this.canvas && e.target !== this.canvas) return;
      if (!this.inputEnabled) return;
      this.mouse = e.buttons;
      if (e.button === 0) this.latch |= Buttons.LIGHT;
      if (e.button === 1) {
        e.preventDefault();
        this.latch |= Buttons.LOCK;
      }
    });
    on('mouseup', (e) => (this.mouse = e.buttons));
    on('mousemove', (e) => {
      // Sem lock (fallback), a câmera gira enquanto o mouse está sobre o canvas.
      const locked = document.pointerLockElement === this.canvas;
      if (!locked && (e.target !== this.canvas || !this.inputEnabled)) return;
      this.pitch = Math.max(-0.35, Math.min(1.1, this.pitch + e.movementY * 0.0022));
      if (this.meNow?.lockTarget) {
        // Mira grudada: o mouse não gira a câmera; um puxão forte para o lado troca de alvo.
        const now = performance.now();
        if (now - this.flick.at > 250) this.flick.acc = 0;
        this.flick.acc += e.movementX;
        this.flick.at = now;
        if (Math.abs(this.flick.acc) > 160) {
          this.latch |= Buttons.LOCK_NEXT;
          this.flick.acc = 0;
        }
        return;
      }
      this.yaw -= e.movementX * 0.0028;
    });
    on(
      'wheel',
      (e) => {
        if (document.pointerLockElement !== this.canvas && e.target !== this.canvas) return;
        if (this.inputEnabled && Math.abs(e.deltaY) > 0) this.latch |= Buttons.LOCK_NEXT;
      },
      this.canvas,
    );
    on('contextmenu', (e) => e.preventDefault(), this.canvas);
    on('resize', () => this.resize());
  }

  private buildInput() {
    const k = (c: string) => (this.keys.has(c) ? 1 : 0);
    const fwd = k('KeyW') - k('KeyS');
    const side = k('KeyD') - k('KeyA');
    // Movimento relativo à câmera. Direita da câmera = dirFromYaw(yaw - PI/2).
    const f = dirFromYaw(this.yaw);
    const r = dirFromYaw(this.yaw - Math.PI / 2);
    let mx = f.x * fwd + r.x * side;
    let mz = f.z * fwd + r.z * side;
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    let buttons = this.latch;
    this.latch = 0;
    if (this.mouse & 1) buttons |= Buttons.LIGHT;
    if (this.mouse & 2) buttons |= Buttons.HEAVY;
    if (this.keys.has('KeyF')) buttons |= Buttons.BLOCK;
    if (this.keys.has('KeyX')) buttons |= Buttons.USE;
    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) buttons |= Buttons.RUN;
    if (!this.inputEnabled) return { moveX: 0, moveZ: 0, aim: this.yaw, buttons: 0 };
    return { moveX: mx, moveZ: mz, aim: this.assistAim(buttons), buttons };
  }

  /**
   * Assistência leve de mira (sem lock-on): ao bater, puxa a mira para o inimigo mais perto
   * dentro de um cone curto e segura enquanto o golpe sai. Só muda o input: a predição bate.
   */
  private assistAim(buttons: number): number {
    const me = this.meNow;
    const now = performance.now();
    if (!me || me.lockTarget) return this.yaw;
    if (buttons & (Buttons.LIGHT | Buttons.HEAVY | Buttons.KICK) && (!this.assist || now > this.assist.until)) {
      let best: FighterSnapshot | null = null;
      let bestScore = Infinity;
      for (const f of this.lastFighters) {
        if (f.team === me.team || f.state === 'ko' || f.state === 'dead' || f.state === 'downed') continue;
        const d = Math.hypot(f.pos.x - me.pos.x, f.pos.z - me.pos.z);
        const off = Math.abs(angleDiff(yawTo(me.pos, f.pos), this.yaw));
        if (d > ASSIST_RANGE || off > ASSIST_HALF_ANGLE) continue;
        const score = off * 2 + d;
        if (score < bestScore) {
          best = f;
          bestScore = score;
        }
      }
      this.assist = best ? { id: best.id, until: now + 450 } : null;
    }
    if (!this.assist || now > this.assist.until) return this.yaw;
    const t = this.lastFighters.find((f) => f.id === this.assist?.id);
    return t ? yawTo(me.pos, t.pos) : this.yaw;
  }

  // ------------------------------------------------------------------ loop

  private resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private readonly frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;

    // Um input por tick de simulação.
    this.inputAcc += dt * 1000;
    let sends = 0;
    while (this.inputAcc >= TICK_MS && sends < 6) {
      const input = this.buildInput();
      const self = this.predictor?.self;
      this.predPrev = self ? { ...self.pos } : null;
      const seq = this.conn.sendInput(input);
      this.predictor?.applyLocal(seq, input);
      this.inputAcc -= TICK_MS;
      sends++;
    }
    // A correção da predição some em ~150 ms.
    const decay = Math.exp(-dt * 14);
    this.predOffset.x *= decay;
    this.predOffset.z *= decay;
    if (this.inputAcc > TICK_MS * 6) this.inputAcc = 0;

    if (this.tabDownAt && !this.scoreboardShown && now - this.tabDownAt >= 220) {
      this.scoreboardShown = true;
      this.cb.onScoreboard(true);
    }

    const sample = this.conn.sample(now);
    if (!this.scene || !sample || !this.welcome) return;
    const you = this.welcome.you;
    // Você: estado previsto localmente (responde na hora). Os outros: interpolados.
    const predicted = this.predictedSelf(Math.min(1, this.inputAcc / TICK_MS));
    if (predicted) {
      const i = sample.fighters.findIndex((f) => f.id === you);
      if (i >= 0) sample.fighters[i] = predicted;
    }

    // Cria/atualiza/remove bonecos.
    const seen = new Set<string>();
    let me: FighterSnapshot | null = null;
    for (const f of sample.fighters) {
      seen.add(f.id);
      let v = this.views.get(f.id);
      // O primeiro snapshot pode chegar antes do roster: quando o roster chega, remonta com nick e visual.
      const r = this.roster[f.id];
      const key = `${r?.nick ?? ''}|${r?.visual ? JSON.stringify(r.visual) : ''}`;
      if (v && this.viewKeys.get(f.id) !== key) {
        this.scene.remove(v.root);
        v.dispose();
        v = undefined;
      }
      if (!v) {
        v = new CharacterView(f.id, f.team, r?.nick ?? '…', f.id === you, f.team === this.welcome.team, r?.visual);
        this.views.set(f.id, v);
        this.viewKeys.set(f.id, key);
        this.scene.add(v.root);
      }
      const lastPos = this.lastPos.get(f.id);
      const walked = lastPos ? Math.min(2, Math.hypot(f.pos.x - lastPos.x, f.pos.z - lastPos.z)) : 0;
      this.lastPos.set(f.id, { ...f.pos });
      this.stateSounds(f, walked);
      v.update(f, this.camera, dt);
      if (f.id === you) me = f;
    }
    this.lastFighters = sample.fighters;
    for (const [id, v] of this.views) v.setLocked(!!me && me.lockTarget === id);
    this.fx?.update(dt);
    for (const [id, v] of this.views) {
      if (!seen.has(id)) {
        this.scene.remove(v.root);
        v.dispose();
        this.views.delete(id);
        this.viewKeys.delete(id);
      }
    }

    this.meNow = me;

    // Lock-on: a câmera gruda no alvo (o mouse não gira enquanto travado).
    const target = me?.lockTarget ? sample.fighters.find((f) => f.id === me?.lockTarget) : undefined;
    if (me && target) {
      const want = yawTo(me.pos, target.pos);
      let d = (want - this.yaw) % (2 * Math.PI);
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      this.yaw += d * Math.min(1, dt * 14);
    }

    // Câmera em 3ª pessoa por cima do ombro.
    if (me && this.map) {
      const fwd = dirFromYaw(this.yaw);
      const right = dirFromYaw(this.yaw - Math.PI / 2);
      const pivot = new THREE.Vector3(me.pos.x + right.x * SHOULDER, 1.65, me.pos.z + right.z * SHOULDER);
      const horiz = Math.cos(this.pitch) * CAM_DIST;
      const cam = new THREE.Vector3(pivot.x - fwd.x * horiz, pivot.y + Math.sin(this.pitch) * CAM_DIST, pivot.z - fwd.z * horiz);
      cam.x = Math.max(-this.map.halfW + 0.3, Math.min(this.map.halfW - 0.3, cam.x));
      cam.z = Math.max(-this.map.halfD + 0.3, Math.min(this.map.halfD - 0.3, cam.z));
      cam.y = Math.max(0.4, cam.y);
      // Não atravessa paredes: puxa a câmera para antes do primeiro obstáculo entre ela e o jogador.
      const hit = segmentBoxHit(this.map.boxes, pivot, cam);
      if (hit < 1) {
        const t = Math.max(0.12, hit - 0.3 / CAM_DIST);
        cam.lerpVectors(pivot, cam, t);
      }
      this.shake *= Math.pow(0.02, dt);
      cam.x += Math.sin(now * 0.09) * this.shake;
      cam.y += Math.cos(now * 0.11) * this.shake;
      this.camera.position.copy(cam);
      this.camera.lookAt(pivot.x + fwd.x * 3, pivot.y - 0.2, pivot.z + fwd.z * 3);
    }
    this.renderer.render(this.scene, this.camera);
    this.points?.update(sample.match.points, now);
    this.drawMinimap(me, sample.fighters, sample.match.points);

    // HUD a ~10 Hz (React não precisa de 60 fps).
    this.hudAcc += dt;
    if (this.hudAcc >= 0.1) {
      this.hudAcc = 0;
      const sedes = this.map?.sedes;
      const inSede = (team: number) => !!(me && sedes?.[team] && inRect(me.pos, sedes[team].area));
      const tick = this.conn.serverTick(now);
      this.cb.onHud({
        connected: true,
        you,
        team: this.welcome.team,
        me,
        match: sample.match,
        fighters: sample.fighters,
        roster: this.roster,
        inOwnSede: inSede(this.welcome.team),
        inEnemySede: inSede(this.welcome.team === 0 ? 1 : 0),
        respawnIn: me && (me.state === 'ko' || me.state === 'dead') ? Math.max(0, (me.koTick + sample.match.respawnTicks - tick) / 60) : null,
        pointerLocked: document.pointerLockElement === this.canvas,
        lockTargetNick: target ? this.name(target.id) : null,
        rtt: this.conn.rtt,
        ...this.contextHints(me, sample.fighters, sample.match.points),
        muted: isMuted(),
        musicOn: isMusicOn(),
      });
      // Música: mais intensa com briga perto e no último minuto.
      const near = me ? sample.fighters.filter((f) => f.team !== me.team && Math.hypot(f.pos.x - me.pos.x, f.pos.z - me.pos.z) < 8).length : 0;
      const lastMinute = sample.match.ticksLeft < 60 * 60;
      setMusicIntensity(Math.min(1, near * 0.25 + (lastMinute ? 0.5 : 0)));
    }
  };
}
