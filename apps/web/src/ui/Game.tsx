import { BANDAGEM, BOMBA, COLETE, CURATIVO, DEFAULT_COMBAT_DATA, GAS, type MatchResult, matchXp, type ShopCategory, shopItems, TORCIDAS, type WeaponDef } from '@torcidas/shared';
import { useEffect, useRef, useState } from 'react';
import { GameEngine, type HudState } from '../game/engine';
import { Crest, ItemIcon, Key, Meter, teamGlow } from './kit';
import './hud.css';
import './screens.css';

const C = DEFAULT_COMBAT_DATA.constants;
const ITEMS = shopItems();
const CATEGORIES: [ShopCategory, string][] = [
  ['branca', 'Armas brancas'],
  ['arremessavel', 'Arremessáveis'],
  ['fogo', 'Armas de fogo'],
  ['equipamento', 'Equipamento'],
];
/** Roda de itens (Z): punhos, as armas da loja, os arremessáveis e o colete. */
const WHEEL = [{ id: 'punhos', nome: 'Punhos' }, ...ITEMS.filter((i) => i.tipo === 'arma'), ...ITEMS.filter((i) => [BOMBA.id, GAS.id, COLETE.id].some((id) => id === i.id))];
/** Fatia da roda para onde o mouse aponta (0 = topo, sentido horário), ou -1 no centro. */
function wheelSlice(v: { x: number; y: number }): number {
  if (Math.hypot(v.x, v.y) < 30) return -1;
  const a = (Math.atan2(v.x, -v.y) + 2 * Math.PI) % (2 * Math.PI);
  return Math.round(a / ((2 * Math.PI) / WHEEL.length)) % WHEEL.length;
}
const CHANNEL_LABEL: Record<string, string> = { healing: 'Aplicando curativo', reviving: 'Levantando aliado' };

const REASONS: Record<string, string> = {
  fora_da_sede: 'Só dá para comprar dentro da sua sede',
  saldo_insuficiente: 'Saldo insuficiente',
  ja_possui: 'Essa arma já está com você (roda do mouse troca)',
  limite: 'Você já está no limite desse item',
  nivel: 'Seu nível ainda não libera esse item',
  morto: 'Caído não compra: espere ser levantado ou renascer',
  partida_encerrada: 'A partida acabou',
};

const CONTROLS: [string, string][] = [
  ['WASD', 'Mover'],
  ['Shift', 'Correr'],
  ['Espaço', 'Pular'],
  ['Mouse esq.', 'Leve · combo'],
  ['Mouse dir.', 'Pesado · segure'],
  ['F', 'Bloquear · parry'],
  ['C', 'Passo · rolar correndo'],
  ['E', 'Empurrão · cabeçada'],
  ['Q', 'Chute · voadora no ar'],
  ['R', 'Especial'],
  ['G', 'Grito da torcida'],
  ['4', 'Curativo'],
  ['5', 'Bandagem · aperte seguido'],
  ['X', 'Levantar aliado'],
  ['Tab', 'Travar mira · segure: placar'],
  ['Roda', 'Trocar de arma · bomba · gás (clique arremessa)'],
  ['Z (segure)', 'Roda de itens: mire com o mouse e solte · pega o que faltar'],
  ['Puxão do mouse', 'Trocar alvo travado'],
  ['J', 'Loja'],
  ['M / N', 'Som / música'],
  ['V (segure)', 'Olhar para trás'],
  ['M · N', 'Som liga/desliga · música'],
  ['H', 'Esconder comandos'],
];

/** Atributos de 0 a 1 para os cards da loja. */
function weaponStats(w: WeaponDef) {
  const l = w.moves.light[0];
  const reach = l?.hitbox.shape === 'arc' ? l.hitbox.range : l?.hitbox.shape === 'capsule' ? l.hitbox.to : 1;
  return [
    ['Dano', Math.min(1, (l?.damage ?? 6) / 18)],
    ['Alcance', Math.min(1, reach / 2.3)],
    ['Velocidade', Math.min(1, 5 / (l?.startup ?? 5) / 1.25)],
    ['Defesa', Math.min(1, w.blockAbsorb)],
  ] as const;
}

const fmtClock = (secs: number) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

interface Props {
  serverUrl: string;
  ticket: string;
  onExit: () => void;
  /** Partida rápida: pede a vaga de volta (o servidor devolve a mesma partida). */
  onReconnect?: () => void;
}

export function Game({ serverUrl, ticket, onExit, onReconnect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [feed, setFeed] = useState<{ id: number; text: string; mine: boolean }[]>([]);
  const [shopOpen, setShopOpen] = useState(false);
  const [scoreboard, setScoreboard] = useState(false);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [closed, setClosed] = useState<string | null>(null);
  const [hitDirs, setHitDirs] = useState<{ id: number; angle: number; power: number }[]>([]);
  const [showControls, setShowControls] = useState(false);
  const [pick, setPick] = useState(ITEMS[0]?.id ?? '');
  const [cat, setCat] = useState<ShopCategory>('branca');
  const shopOpenRef = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuOpenRef = useRef(false);
  const menuAt = useRef(0);
  const resultRef = useRef(false);
  const [sens, setSens] = useState(1);
  const [wheel, setWheel] = useState<{ x: number; y: number } | null>(null);
  const wheelRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyH' && !e.repeat) setShowControls((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let hitId = 0;
    const engine = new GameEngine(canvas, serverUrl, ticket, {
      onHud: setHud,
      onFeed: (e) => {
        setFeed((f) => [e, ...f].slice(0, 6));
        setTimeout(() => setFeed((f) => f.filter((x) => x.id !== e.id)), 6000);
      },
      onHitFrom: (angle, damage) => {
        const id = ++hitId;
        // Golpe mais forte = arco maior e mais opaco.
        const power = Math.min(1, 0.35 + damage / 30);
        setHitDirs((h) => [...h, { id, angle, power }]);
        // Apanhou com a loja aberta: fecha para você reagir (a loja não pausa a briga).
        if (shopOpenRef.current) {
          shopOpenRef.current = false;
          setShopOpen(false);
          engine.inputEnabled = true;
        }
        setTimeout(() => setHitDirs((h) => h.filter((x) => x.id !== id)), 700);
      },
      onBuyResult: (ok, item, reason) => {
        const nome = ITEMS.find((i) => i.id === item)?.nome ?? item;
        setToast({ text: ok ? `Pegou: ${nome}` : (REASONS[reason ?? ''] ?? reason ?? 'Compra negada'), ok });
        setTimeout(() => setToast(null), 2200);
      },
      onMatchEnd: (r) => {
        resultRef.current = true;
        menuOpenRef.current = false;
        setMenuOpen(false);
        setResult(r);
        if (document.pointerLockElement) document.exitPointerLock();
      },
      onToggleShop: () => {
        const open = !shopOpenRef.current;
        shopOpenRef.current = open;
        setShopOpen(open);
        engine.inputEnabled = !open;
        if (open && document.pointerLockElement) document.exitPointerLock();
        if (!open) engine.requestPointerLock();
      },
      onScoreboard: setScoreboard,
      onMenu: () => openMenu(),
      onWheel: (v, commit) => {
        const last = wheelRef.current;
        wheelRef.current = v;
        setWheel(v);
        const i = last ? wheelSlice(last) : -1;
        const it = WHEEL[i];
        if (commit && it) engine.equip(it.id);
      },
      onClose: (reason) => setClosed(reason),
    });
    engine.setMinimapCanvas(minimapRef.current);
    engineRef.current = engine;
    setSens(engine.sensitivity);
    return () => engine.destroy();
  }, [serverUrl, ticket]);

  // Esc: fecha a loja; senão abre/fecha o menu. Com o mouse preso o Esc chega como "perdeu o lock" (onMenu).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.repeat) return;
      if (shopOpen) closeShop();
      // O mesmo Esc pode chegar como tecla logo depois de soltar o lock: não fecha o menu que acabou de abrir.
      else if (menuOpen) {
        if (performance.now() - menuAt.current > 300) closeMenu();
      } else openMenu();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // shortcut: o menu não pausa a partida (é online), só tira o controle; poderia avisar o time no futuro.
  function openMenu() {
    if (menuOpenRef.current || shopOpenRef.current || resultRef.current) return;
    menuOpenRef.current = true;
    menuAt.current = performance.now();
    setMenuOpen(true);
    const engine = engineRef.current;
    if (engine) engine.inputEnabled = false;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  function closeMenu() {
    menuOpenRef.current = false;
    setMenuOpen(false);
    const engine = engineRef.current;
    if (!engine) return;
    engine.inputEnabled = true;
    engine.requestPointerLock();
  }

  const closeShop = () => {
    shopOpenRef.current = false;
    setShopOpen(false);
    if (engineRef.current) {
      engineRef.current.inputEnabled = true;
      engineRef.current.requestPointerLock();
    }
  };

  const me = hud?.me ?? null;
  const team = hud?.team ?? 0;
  const secs = Math.ceil((hud?.match?.ticksLeft ?? 0) / 60);
  const nick = (id: string) => hud?.roster[id]?.nick ?? id;
  const weapon = me ? DEFAULT_COMBAT_DATA.weapons[me.weapon] : undefined;
  const lowHp = !!me && me.hp < C.maxHp * 0.3 && me.state !== 'ko' && me.state !== 'dead';
  const myTorcida = TORCIDAS[team];
  // Loja: estado de compra de cada item (mesmas regras do servidor, só para o botão).
  // Loja em qualquer lugar; só caído no chão não compra.
  const canShop = me?.state !== 'downed';
  const itemState = (id: string) => {
    const it = ITEMS.find((i) => i.id === id);
    if (!it || !me) return { owned: false, locked: false, disabled: true, label: 'Comprar' };
    const full: Record<string, boolean> = {
      [COLETE.id]: me.colete >= C.colete.hp,
      [BANDAGEM.id]: me.bandagens >= BANDAGEM.max,
      [BOMBA.id]: me.bombas >= BOMBA.max,
      [GAS.id]: me.gases >= GAS.max,
      [CURATIVO.id]: me.curativos >= CURATIVO.maxPorJogador,
    };
    const owned = it.tipo === 'arma' ? me.weapon === it.id || me.bag.includes(it.id) : !!full[it.id];
    const locked = me.level < it.nivelMin;
    const label = owned
      ? it.tipo === 'arma'
        ? me.weapon === it.id
          ? 'Equipada'
          : 'Na mochila'
        : 'Limite atingido'
      : locked
        ? `Libera no nível ${it.nivelMin}`
        : !canShop
          ? 'Caído não compra'
          : me.money < it.preco
            ? 'Saldo insuficiente'
            : it.preco === 0
              ? 'Pegar · grátis'
              : `Comprar · $${it.preco}`;
    return { owned, locked, disabled: owned || locked || !canShop || me.money < it.preco, label };
  };
  const sel = ITEMS.find((i) => i.id === pick) ?? ITEMS[0];
  const selWeapon = sel ? DEFAULT_COMBAT_DATA.weapons[sel.id] : undefined;
  const selState = itemState(sel?.id ?? '');

  return (
    <div className="game">
      <canvas ref={canvasRef} className="game-canvas" onClick={() => !shopOpen && !menuOpen && !result && engineRef.current?.requestPointerLock()} />
      {lowHp && <div className="vignette" />}

      {/* Topo: placar de transmissão + pontos de controle */}
      {hud?.match && (
        <div className="h-top">
          <div className="h-score">
            {([0, 1] as const).map((t) => (
              <div key={t} className={`h-team ${t === 0 ? 'left' : 'right'} ${team === t ? 'mine' : ''}`} style={{ ['--tc' as string]: teamGlow(TORCIDAS[t]) }}>
                <Crest torcida={TORCIDAS[t]} size={22} />
                <div className="h-team-mid">
                  <span>{TORCIDAS[t].nome}</span>
                  <div className="h-pips" title="De pé / no chão">
                    {hud.fighters
                      .filter((f) => f.team === t)
                      .map((f) => (
                        <i key={f.id} className={`${isDown(f.state) ? 'down' : ''}${f.id === hud.you ? ' me' : ''}`} />
                      ))}
                  </div>
                </div>
                <b>{hud.match!.score[t]}</b>
              </div>
            ))}
            <div className={`h-clock ${secs <= 60 ? 'urgent' : ''}`}>
              <b>{fmtClock(secs)}</b>
              <small>{secs <= 60 ? 'Último minuto' : 'Tempo'}</small>
            </div>
          </div>
          {(() => {
            const [a, b] = hud.match.score;
            const share = a + b > 0 ? a / (a + b) : 0.5;
            return (
              <div className="h-tug" style={{ ['--t0' as string]: teamGlow(TORCIDAS[0]), ['--t1' as string]: teamGlow(TORCIDAS[1]) }}>
                <i style={{ width: `${share * 100}%` }} />
              </div>
            );
          })()}
          {hud.match.points.length > 0 && (
            <div className="h-points" title="Ponto dominado: +1 no placar a cada 10 s">
              {hud.match.points.map((p) => {
                const rel = (t: 0 | 1 | null) => (t === null ? 'neutral' : t === team ? 'ally' : 'enemy');
                const filling = p.capTeam !== null && !(p.owner === p.capTeam && p.progress >= 1);
                return (
                  <div key={p.id} className={`h-pt ${rel(p.owner)} ${p.contested ? 'contested' : ''}`}>
                    <b>{p.id}</b>
                    {filling && <i className={rel(p.capTeam)} style={{ width: `${p.progress * 100}%` }} />}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Minimapa + rede */}
      <div className="h-map">
        <canvas ref={minimapRef} width={170} height={170} />
        <div className="h-net">
          <span>{hud ? `${Math.round(hud.rtt)} ms` : '—'}</span>
          {hud?.perf && (
            <span title={`${hud.perf.ms.toFixed(1)} ms · ${hud.perf.calls} draw calls · ${Math.round(hud.perf.tris / 1000)}k triângulos · qualidade ${hud.perf.quality}`}>
              {hud.perf.fps} fps
            </span>
          )}
          {hud?.muted && <span className="h-muted">Sem som · M</span>}
          <button onClick={onExit}>Sair</button>
        </div>
      </div>

      {/* Feed de nocautes */}
      <div className="h-feed">
        {feed.map((f) => (
          <div key={f.id} className={f.mine ? 'mine' : ''}>
            {f.text}
          </div>
        ))}
      </div>

      {/* Mira e indicadores */}
      {hud?.pointerLocked && <div className="crosshair" />}
      {hud?.lockTargetNick && <div className="lock-tag">Alvo · {hud.lockTargetNick}</div>}
      {hitDirs.map((h) => (
        <div key={h.id} className="hitdir" style={{ transform: `translate(-50%, -50%) rotate(${-h.angle}rad) scale(${0.8 + h.power * 0.5})` }}>
          {/* A animação do contêiner some com o arco; a força do golpe vai na opacidade do arco. */}
          <i style={{ opacity: h.power }} />
        </div>
      ))}

      {/* Jogador: vida, fôlego, raça */}
      {me && (
        <div className="h-player" style={{ ['--tc' as string]: teamGlow(myTorcida) }}>
          <div className="h-chips">
            {me.buffed && <span className="chip gold">Grito</span>}
            {me.counter && <span className="chip gold">Contra-golpe</span>}
            {me.bleeding > 0 && <span className="chip red">Sangrando ×{me.bleeding}</span>}
            {me.invulnerable && me.state !== 'dodge' && <span className="chip blue">Protegido</span>}
            {me.slowed && <span className="chip red">Lento</span>}
            {me.armored && me.fury === 0 && me.state !== 'attack' && me.state !== 'charging' && me.state !== 'shout' && <span className="chip gold">Fúria</span>}
          </div>
          <div className="h-id">
            <Crest torcida={myTorcida} size={18} />
            <b>{nick(me.id)}</b>
            <small>{myTorcida.nome}</small>
          </div>
          <div className="h-vitals">
            <b className={`h-hpnum ${lowHp ? 'low' : ''}`}>{me.state === 'downed' ? 'CAÍDO' : Math.ceil(me.hp)}</b>
            <div className="h-bars">
              <Meter kind="hp" value={me.state === 'downed' ? 0 : me.hp} max={C.maxHp} />
              <Meter kind="st" value={me.stamina} max={C.maxStamina} />
            </div>
          </div>
          <div className="h-raca">
            <small>Raça</small>
            <Meter kind={`raca ${me.raca >= C.raca.shoutCost ? 'full' : me.raca >= C.raca.specialCost ? 'ready' : ''}`} value={me.raca} max={C.raca.max} marks={[C.raca.specialCost]} />
            <span className={`h-abil ${me.raca >= C.raca.specialCost ? 'on' : ''}`}>
              <Key>R</Key> Especial
            </span>
            <span className={`h-abil ${me.raca >= C.raca.shoutCost ? 'on' : ''}`}>
              <Key>G</Key> Grito
            </span>
          </div>
          {me.fury > 0 && (
            <div className="h-fury" title="Enche quando você apanha de 2 ou mais ao mesmo tempo. Cheia, explode e derruba quem estiver perto.">
              <small>Fúria</small>
              <Meter kind="fury" value={me.fury} max={C.fury.max} />
            </div>
          )}
        </div>
      )}

      {/* Itens: saldo, arma, curativo */}
      {me && (
        <div className="h-items">
          <div className="h-cash">
            <small>Saldo</small>
            <b>${me.money}</b>
          </div>
          <div className="h-slot weapon">
            <span className="h-slot-ico">
              <ItemIcon id={me.inHand ?? me.weapon} size={20} />
            </span>
            <small>Arma</small>
            <b>{me.inHand ? `${me.inHand === 'bomba' ? 'Bomba' : 'Gás'} ×${me.inHand === 'bomba' ? me.bombas : me.gases}` : (weapon?.nome ?? me.weapon)}</b>
            {me.inHand ? <em>Clique arremessa</em> : me.durability !== null && weapon?.durabilidade ? <Meter kind="dur" value={me.durability} max={weapon.durabilidade} /> : <em>Não quebra</em>}
            {(me.bag.length > 0 || me.bombas > 0 || me.gases > 0) && (
              <span className="h-bag" title="Roda do mouse troca de arma">
                {[...me.bag, ...(me.bombas > 0 ? [`bomba ×${me.bombas}`] : []), ...(me.gases > 0 ? [`gas ×${me.gases}`] : [])].map((label) => (
                  <ItemIcon key={label} id={label.split(' ')[0] ?? label} size={16} />
                ))}
                <i>roda</i>
              </span>
            )}
          </div>
          <div className={`h-slot use ${me.curativos > 0 ? '' : 'off'}`}>
            <Key>4</Key>
            <ItemIcon id="curativo" size={16} />
            <b>Curativo</b>
            <span>×{me.curativos}</span>
          </div>
          <div className={`h-slot use ${me.bandagens > 0 ? '' : 'off'}`}>
            <Key>5</Key>
            <ItemIcon id="bandagem" size={16} />
            <b>Bandagem</b>
            <span>×{me.bandagens}</span>
          </div>
          {me.colete > 0 && (
            <div className="h-slot use">
              <ItemIcon id="colete" size={16} />
              <b>Colete</b>
              <span>{me.colete}</span>
            </div>
          )}

        </div>
      )}

      {/* Canalização */}
      {me && CHANNEL_LABEL[me.state] && (
        <div className="channel">
          <span>{CHANNEL_LABEL[me.state]}</span>
          <Meter kind="channel" value={me.channel} max={1} />
        </div>
      )}

      {/* Dicas de contexto */}
      <div className="prompts">
        {hud?.inOwnSede && (
          <div className="prompt">
            <Key>J</Key> Loja · na sede a vida regenera
          </div>
        )}
        {hud?.inEnemySede && <div className="prompt danger">Sede rival: você está perdendo vida</div>}
        {hud?.prompts.map((t) => {
          const m = /^([A-Z0-9]+)(?: \(segure\))?: (.*)$/.exec(t);
          return (
            <div key={t} className="prompt">
              {m ? (
                <>
                  <Key>{m[1]}</Key> {m[2]}
                </>
              ) : (
                t
              )}
            </div>
          );
        })}
        {hud?.warnings.map((t) => (
          <div key={t} className="prompt danger">
            {t}
          </div>
        ))}
        {toast && <div className={`prompt ${toast.ok ? 'ok' : 'danger'}`}>{toast.text}</div>}
      </div>

      {/* Caído / nocauteado */}
      {me?.state === 'downed' && !result && (
        <div className="status-banner downed">
          <h2>Caído</h2>
          <p>Rasteje até um aliado. Ele te levanta segurando X.</p>
          <Meter kind="bleedout" value={1 - me.channel} max={1} />
        </div>
      )}
      {hud?.respawnIn !== null && hud?.respawnIn !== undefined && !result && (
        <div className="status-banner ko">
          <h2>Nocauteado</h2>
          <p>Renascendo na sede em {Math.ceil(hud.respawnIn)} s</p>
          <p className="h-ko-shop">
            <Key>J</Key> Loja: o que comprar agora vem com você
          </p>
        </div>
      )}
      {wheel && me && (
        <div className="item-wheel">
          {WHEEL.map((it, i) => {
            const a = (i / WHEEL.length) * 2 * Math.PI;
            const have = it.id === me.weapon || me.bag.includes(it.id) || (it.id === BOMBA.id && me.bombas > 0) || (it.id === GAS.id && me.gases > 0) || (it.id === COLETE.id && me.colete > 0);
            const cur = (me.inHand ?? me.weapon) === it.id;
            return (
              <div key={it.id} className={`iw-slot${i === wheelSlice(wheel) ? ' on' : ''}${have ? ' have' : ''}${cur ? ' cur' : ''}`} style={{ left: `calc(50% + ${Math.sin(a) * 150}px)`, top: `calc(50% - ${Math.cos(a) * 150}px)` }}>
                <ItemIcon id={it.id} size={26} />
              </div>
            );
          })}
          <div className="iw-center">
            {(() => {
              const it = WHEEL[wheelSlice(wheel)];
              if (!it) return <span>Mova o mouse e solte o Z</span>;
              const have = it.id === me.weapon || me.bag.includes(it.id) || (it.id === BOMBA.id && me.bombas > 0) || (it.id === GAS.id && me.gases > 0);
              return (
                <>
                  <b>{it.nome}</b>
                  <span>{have ? 'Equipar' : it.id === COLETE.id ? 'Vestir' : 'Pegar'}</span>
                </>
              );
            })()}
          </div>
        </div>
      )}
      {hud && !hud.pointerLocked && !shopOpen && !menuOpen && !result && <div className="lock-hint">Clique na tela para controlar a câmera</div>}

      {/* Comandos: escondidos; H mostra */}
      {!result &&
        (showControls ? (
          <div className="controls">
            {CONTROLS.map(([k, label]) => (
              <div key={k}>
                <Key wide={k.length > 2}>{k}</Key>
                <span>{label}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="h-help">
            <Key>H</Key> Comandos
          </div>
        ))}

      {/* Menu do Esc: som, música, sensibilidade, atalhos e sair. A partida continua rolando. */}
      {menuOpen && !result && (
        <div className="overlay">
          <div className="h-menu" role="dialog" aria-labelledby="h-menu-title">
            <header>
              <h2 id="h-menu-title">Menu</h2>
              <small>A partida continua rolando</small>
            </header>
            <button className="primary" onClick={closeMenu}>
              Voltar ao jogo
            </button>
            <div className="h-menu-row">
              <span>Som</span>
              <button className="secondary" onClick={() => engineRef.current?.toggleMute()}>
                {hud?.muted ? 'Desligado' : 'Ligado'}
              </button>
            </div>
            <div className="h-menu-row">
              <span>Música (batuque)</span>
              <button className="secondary" onClick={() => engineRef.current?.switchMusic()}>
                {hud?.musicOn ? 'Ligada' : 'Desligada'}
              </button>
            </div>
            <label className="h-menu-row">
              <span>Sensibilidade do mouse · {sens.toFixed(1)}x</span>
              <input
                type="range"
                min={0.3}
                max={2.5}
                step={0.1}
                value={sens}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setSens(v);
                  if (engineRef.current) engineRef.current.sensitivity = v;
                }}
              />
            </label>
            <details className="h-menu-keys">
              <summary>Atalhos</summary>
              <div className="controls static">
                {CONTROLS.map(([k, label]) => (
                  <div key={k}>
                    <Key wide={k.length > 2}>{k}</Key>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            </details>
            <button className="secondary h-menu-exit" onClick={onExit}>
              Sair da partida
            </button>
          </div>
        </div>
      )}

      {/* Loja: lista de itens, detalhe e inventário */}
      {shopOpen && me && (
        <div className="overlay">
          <div className="h-shop" role="dialog" aria-labelledby="h-shop-title">
            <header className="h-shop-head">
              <div>
                <small>{myTorcida.sede}</small>
                <h2 id="h-shop-title">Loja</h2>
              </div>
              <dl className="h-inv">
                <div>
                  <dt>Arma</dt>
                  <dd>{weapon?.nome ?? me.weapon}</dd>
                </div>
                <div>
                  <dt>Curativos</dt>
                  <dd>
                    {me.curativos}/{CURATIVO.maxPorJogador}
                  </dd>
                </div>
                <div>
                  <dt>Bandagens</dt>
                  <dd>
                    {me.bandagens}/{BANDAGEM.max}
                  </dd>
                </div>
                <div>
                  <dt>Bomba · Gás</dt>
                  <dd>
                    {me.bombas} · {me.gases}
                  </dd>
                </div>
                <div className="cash">
                  <dt>Saldo</dt>
                  <dd>${me.money}</dd>
                </div>
              </dl>
              <button className="h-close" onClick={closeShop}>
                Fechar <Key>J</Key>
              </button>
            </header>
            {!canShop && <p className="banner danger">Caído não compra: espere ser levantado ou renascer.</p>}
            <div className="h-shop-body">
              <ul className="h-list">
                <li className="h-tabs" role="tablist">
                  {CATEGORIES.map(([id, nome]) => (
                    <button key={id} role="tab" aria-selected={cat === id} className={cat === id ? 'on' : ''} onClick={() => setCat(id)}>
                      {nome}
                    </button>
                  ))}
                </li>
                {ITEMS.filter((it) => it.categoria === cat).map((it) => {
                  const st = itemState(it.id);
                  return (
                    <li key={it.id}>
                      <button className={`h-row ${sel?.id === it.id ? 'on' : ''}`} onClick={() => setPick(it.id)} aria-pressed={sel?.id === it.id}>
                        <span className="h-ico">
                          <ItemIcon id={it.id} size={26} />
                        </span>
                        <b>{it.nome}</b>
                        <small>{st.owned ? (it.tipo === 'arma' ? (me.weapon === it.id ? 'Equipada' : 'Na mochila') : 'No limite') : it.tipo === 'arma' ? DEFAULT_COMBAT_DATA.weapons[it.id]?.tipo : it.id === BANDAGEM.id ? 'Cura rápida' : it.id === BOMBA.id || it.id === GAS.id ? 'Arremesso' : it.id === COLETE.id ? 'Proteção' : 'Consumível'}</small>
                        <span className={me.money >= it.preco && !st.locked ? 'price' : 'price short'}>{st.locked ? `Nv ${it.nivelMin}` : it.preco === 0 ? 'Grátis' : `$${it.preco}`}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {sel && (
                <section className="h-detail">
                  <div className="h-detail-head">
                    <span className="h-ico big">
                      <ItemIcon id={sel.id} size={44} />
                    </span>
                    <div>
                      <small className="h-kicker">{selWeapon ? selWeapon.tipo : 'Consumível'}</small>
                      <h3>{sel.nome}</h3>
                    </div>
                  </div>
                  {selWeapon ? (
                    <>
                      {weaponStats(selWeapon).map(([label, v]) => (
                        <div key={label} className="h-stat">
                          <span>{label}</span>
                          <Meter kind="stat" value={v} max={1} />
                        </div>
                      ))}
                      <p className="muted">
                        {selWeapon.municao ? `${selWeapon.municao} balas, sem recarga: acabou, sai da mão. Parede e carro seguram o tiro.` : selWeapon.durabilidade ? `Aguenta ${selWeapon.durabilidade} golpes.` : 'Não quebra.'} Fica com você mesmo se for nocauteado.
                      </p>
                    </>
                  ) : sel.id === COLETE.id ? (
                    <p className="muted">
                      Segura {C.colete.absorb * 100}% do dano de cada golpe até gastar {C.colete.hp} pontos. Comprar de novo conserta. O seu está em {me.colete}/{C.colete.hp}.
                    </p>
                  ) : sel.id === BOMBA.id ? (
                    <p className="muted">
                      Escolha na roda do mouse e clique: joga {C.throwables.range} m à frente e explode na queda. Derruba e empurra todo rival num raio de {C.throwables.bomba.radius} m. Não tira vida. Esquiva na hora certa escapa. Você tem {me.bombas}/{BOMBA.max}.
                    </p>
                  ) : sel.id === GAS.id ? (
                    <p className="muted">
                      Escolha na roda do mouse e clique: nuvem de {C.throwables.gas.ticks / 60} s onde cai. Rival dentro fica lento, sem correr, perde fôlego e para tossindo. Não tira vida. Você tem {me.gases}/{GAS.max}.
                    </p>
                  ) : sel.id === BANDAGEM.id ? (
                    <p className="muted">
                      {BANDAGEM.pacote} bandagens. Cada uma cura +{C.bandagem.amount} na hora, sem parar de andar; dá para apertar seguido (tecla 5). Não estanca sangramento. Você tem {me.bandagens}/{BANDAGEM.max}.
                    </p>
                  ) : (
                    <p className="muted">
                      +{(C.curativo.ticks / C.curativo.interval) * C.curativo.amount} de vida em 2 s e estanca o sangramento. Use com a tecla 4. Você tem {me.curativos}.
                    </p>
                  )}
                  <button className="h-buy" disabled={selState.disabled} onClick={() => engineRef.current?.buy(sel.id)}>
                    {selState.label}
                  </button>
                </section>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Placar (Tab segurado) */}
      {scoreboard && hud && (
        <div className="overlay soft">
          <div className="panel wide">
            <Scoreboard
              rows={[0, 1].map((t) =>
                hud.fighters
                  .filter((f) => f.team === t)
                  .map((f) => ({ id: f.id, nick: nick(f.id), bot: !!hud.roster[f.id]?.bot, kos: f.kos, deaths: f.deaths, assists: f.assists, money: t === team ? f.money : null, state: f.state, weapon: f.weapon })),
              )}
              score={hud.match?.score ?? [0, 0]}
              you={hud.you}
            />
          </div>
        </div>
      )}

      {/* Resultado */}
      {result && (
        <div className="overlay">
          <div className="panel wide result">
            <div className={`result-banner ${result.winner === null ? 'draw' : result.winner === team ? 'win' : 'loss'}`}>
              <span>{result.winner === null ? 'Empate' : result.winner === team ? 'Vitória' : 'Derrota'}</span>
              <div className="final">
                <Crest torcida={TORCIDAS[0]} size={36} />
                <b>
                  {result.score[0]} <i>×</i> {result.score[1]}
                </b>
                <Crest torcida={TORCIDAS[1]} size={36} />
              </div>
            </div>
            {(() => {
              const p = result.players.find((x) => x.id === hud?.you);
              if (!p || p.bot) return null;
              const xp = matchXp({ ...p, won: result.winner === p.team, mvp: result.mvp === p.id });
              return <p className="result-xp">+{xp} XP</p>;
            })()}
            {result.mvp && (
              <div className="mvp">
                <small>Melhor em campo</small>
                <b>{result.players.find((p) => p.id === result.mvp)?.nick}</b>
                <span className="muted">
                  {(() => {
                    const p = result.players.find((x) => x.id === result.mvp);
                    return p ? `${p.kos} nocautes · ${p.assists} assistências` : '';
                  })()}
                </span>
              </div>
            )}
            <Scoreboard
              rows={[0, 1].map((t) =>
                result.players.filter((p) => p.team === t).map((p) => ({ id: p.id, nick: p.nick, bot: p.bot, kos: p.kos, deaths: p.deaths, assists: p.assists, money: null })),
              )}
              score={result.score}
              you={hud?.you ?? null}
            />
            <footer>
              <button className="primary" onClick={onExit}>
                Voltar ao início
              </button>
            </footer>
          </div>
        </div>
      )}

      {closed && !result && (
        <div className="overlay">
          <div className="panel">
            <h2>Desconectado</h2>
            <p className="muted">{closed}</p>
            {onReconnect && (
              <>
                <p className="muted">Sua vaga fica guardada por 60 s (um bot joga por você enquanto isso).</p>
                <button className="primary" onClick={onReconnect}>
                  Voltar para a partida
                </button>
              </>
            )}
            <button className={onReconnect ? '' : 'primary'} onClick={onExit}>
              Voltar ao início
            </button>
          </div>
        </div>
      )}

      {!hud && !closed && <div className="status-banner">Conectando ao servidor…</div>}
    </div>
  );
}

interface Row {
  id: string;
  nick: string;
  bot: boolean;
  kos: number;
  deaths: number;
  assists: number;
  money: number | null;
  /** Só durante a partida (no resultado não tem). */
  state?: string;
  weapon?: string;
}

/** No chão (caído, nocauteado ou esperando renascer). */
function isDown(state: string): boolean {
  return state === 'downed' || state === 'ko' || state === 'dead';
}

const STATE_LABEL: Record<string, string> = { downed: 'Caído', ko: 'Nocauteado', dead: 'Renascendo' };

function Scoreboard({ rows, score, you }: { rows: Row[][]; score: [number, number]; you: string | null }) {
  return (
    <div className="scoreboard">
      {rows.map((list, t) => {
        const torcida = TORCIDAS[t as 0 | 1];
        const showMoney = list.some((r) => r.money !== null);
        const winning = (score[t] ?? 0) > (score[1 - t] ?? 0);
        return (
          <table key={t} style={{ ['--tc' as string]: teamGlow(torcida) }}>
            <thead>
              <tr className="sb-head">
                <th colSpan={2}>
                  <span className="sb-team">
                    <Crest torcida={torcida} size={26} /> {torcida.nome}
                    <b className={winning ? 'lead' : ''}>{score[t]}</b>
                  </span>
                </th>
                <th title="Nocautes">KO</th>
                <th title="Mortes">Mortes</th>
                <th title="Assistências">Assist.</th>
                {showMoney && <th title="Dinheiro">$</th>}
              </tr>
            </thead>
            <tbody>
              {[...list]
                .sort((a, b) => b.kos - a.kos || b.assists - a.assists || a.deaths - b.deaths)
                .map((r, i) => (
                  <tr key={r.id} className={`${r.id === you ? 'me' : ''}${r.state && isDown(r.state) ? ' down' : ''}`}>
                    <td className="sb-rank">{i + 1}</td>
                    <td>
                      <span className="sb-name">
                        {r.weapon && <ItemIcon id={r.weapon} size={14} />}
                        {r.nick} {r.bot && <span className="tag">BOT</span>}
                        {r.state && STATE_LABEL[r.state] && <span className="sb-state">{STATE_LABEL[r.state]}</span>}
                      </span>
                    </td>
                    <td className="sb-ko">{r.kos}</td>
                    <td>{r.deaths}</td>
                    <td>{r.assists}</td>
                    {showMoney && <td className="sb-money">{r.money ?? ''}</td>}
                  </tr>
                ))}
            </tbody>
          </table>
        );
      })}
    </div>
  );
}
