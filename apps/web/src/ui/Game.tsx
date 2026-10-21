import { CURATIVO, DEFAULT_COMBAT_DATA, type MatchResult, shopItems, TORCIDAS, type WeaponDef } from '@torcidas/shared';
import { useEffect, useRef, useState } from 'react';
import { GameEngine, type HudState } from '../game/engine';
import { Crest, Key, Meter } from './kit';

const C = DEFAULT_COMBAT_DATA.constants;
const ITEMS = shopItems();
const CHANNEL_LABEL: Record<string, string> = { healing: 'Aplicando curativo', eating: 'Comendo churrasquinho', reviving: 'Levantando aliado' };

const REASONS: Record<string, string> = {
  fora_da_sede: 'Só dá para comprar dentro da sua sede',
  saldo_insuficiente: 'Saldo insuficiente',
  ja_possui: 'Você já está com essa arma',
  limite: `Máximo de ${CURATIVO.maxPorJogador} curativos`,
  morto: 'Espere renascer',
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
  ['X', 'Levantar · churrasquinho'],
  ['Tab', 'Travar mira · segure: placar'],
  ['Roda', 'Trocar alvo travado'],
  ['J', 'Loja'],
  ['M / N', 'Som / música'],
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
}

export function Game({ serverUrl, ticket, onExit }: Props) {
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
  const [showControls, setShowControls] = useState(true);
  const shopOpenRef = useRef(false);

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
        setTimeout(() => setHitDirs((h) => h.filter((x) => x.id !== id)), 700);
      },
      onBuyResult: (ok, item, reason) => {
        const nome = ITEMS.find((i) => i.id === item)?.nome ?? item;
        setToast({ text: ok ? `${nome} comprado` : (REASONS[reason ?? ''] ?? reason ?? 'Compra negada'), ok });
        setTimeout(() => setToast(null), 2200);
      },
      onMatchEnd: (r) => {
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
      onClose: (reason) => setClosed(reason),
    });
    engine.setMinimapCanvas(minimapRef.current);
    engineRef.current = engine;
    return () => engine.destroy();
  }, [serverUrl, ticket]);

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

  return (
    <div className="game">
      <canvas ref={canvasRef} className="game-canvas" onClick={() => !shopOpen && !result && engineRef.current?.requestPointerLock()} />
      {lowHp && <div className="vignette" />}

      {/* Placar */}
      {hud?.match && (
        <div className="scorebug">
          <div className={`side left ${team === 0 ? 'mine' : ''}`}>
            <Crest torcida={TORCIDAS[0]} size={30} />
            <span className="tname">{TORCIDAS[0].nome}</span>
            <b className="score">{hud.match.score[0]}</b>
          </div>
          <div className={`clock ${secs <= 60 ? 'urgent' : ''}`}>
            <span>{fmtClock(secs)}</span>
            <small>{secs <= 60 ? 'Último minuto' : '1º tempo'}</small>
          </div>
          <div className={`side right ${team === 1 ? 'mine' : ''}`}>
            <b className="score">{hud.match.score[1]}</b>
            <span className="tname">{TORCIDAS[1].nome}</span>
            <Crest torcida={TORCIDAS[1]} size={30} />
          </div>
        </div>
      )}
      {hud?.match && hud.match.points.length > 0 && (
        <div className="points-bar" title="Ponto dominado: +1 no placar a cada 10 s">
          {hud.match.points.map((p) => {
            const rel = (t: 0 | 1 | null) => (t === null ? 'neutral' : t === team ? 'ally' : 'enemy');
            const filling = p.capTeam !== null && !(p.owner === p.capTeam && p.progress >= 1);
            return (
              <div key={p.id} className={`pt ${rel(p.owner)} ${p.contested ? 'contested' : ''}`}>
                <b>{p.id}</b>
                {filling && <i className={rel(p.capTeam)} style={{ width: `${p.progress * 100}%` }} />}
              </div>
            );
          })}
        </div>
      )}

      {/* Minimapa */}
      <div className="minimap">
        <canvas ref={minimapRef} width={300} height={135} />
        <div className="minimap-bar">
          <span>Estacionamento</span>
          <span>{hud ? `${Math.round(hud.rtt)} ms` : '—'}</span>
          <button className="ghost" onClick={onExit}>
            Sair
          </button>
        </div>
      </div>

      {/* Feed de nocautes */}
      <div className="feed">
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
        <div
          key={h.id}
          className="hitdir"
          style={{ transform: `translate(-50%, -50%) rotate(${-h.angle}rad) scale(${0.8 + h.power * 0.5})` }}
        >
          {/* A animação do contêiner some com o arco; a força do golpe vai na opacidade do arco. */}
          <i style={{ opacity: h.power }} />
        </div>
      ))}

      {/* Painel do jogador */}
      {me && (
        <div className="player-panel">
          <div className="pp-head">
            <Crest torcida={myTorcida} size={34} />
            <div>
              <b>{nick(me.id)}</b>
              <small>{myTorcida.nome}</small>
            </div>
            <div className="chips">
              {me.buffed && <span className="chip gold">Grito</span>}
              {me.counter && <span className="chip gold">Contra-golpe</span>}
              {me.bleeding > 0 && <span className="chip red">Sangrando ×{me.bleeding}</span>}
              {me.invulnerable && me.state !== 'dodge' && <span className="chip blue">Protegido</span>}
            </div>
          </div>
          <Meter kind="hp" value={me.state === 'downed' ? 0 : me.hp} max={C.maxHp} label={me.state === 'downed' ? 'CAÍDO' : Math.ceil(me.hp)} />
          <Meter kind="st" value={me.stamina} max={C.maxStamina} label="Fôlego" />
          <div className="raca-row">
            <Meter kind={`raca ${me.raca >= C.raca.shoutCost ? 'full' : me.raca >= C.raca.specialCost ? 'ready' : ''}`} value={me.raca} max={C.raca.max} marks={[C.raca.specialCost]} />
            <span className={`ability ${me.raca >= C.raca.specialCost ? 'on' : ''}`}>
              <Key>R</Key> Especial
            </span>
            <span className={`ability ${me.raca >= C.raca.shoutCost ? 'on' : ''}`}>
              <Key>G</Key> Grito
            </span>
          </div>
        </div>
      )}

      {/* Arma e recursos */}
      {me && (
        <div className="loadout">
          <div className="money">${me.money}</div>
          <div className="weapon">
            <small>Arma</small>
            <b>{weapon?.nome ?? me.weapon}</b>
            {me.durability !== null && weapon?.durabilidade ? <Meter kind="dur" value={me.durability} max={weapon.durabilidade} /> : <span className="muted">indestrutível</span>}
          </div>
          <div className={`consumable ${me.curativos > 0 ? 'on' : ''}`}>
            <Key>4</Key>
            <span>Curativo ×{me.curativos}</span>
          </div>
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
        </div>
      )}
      {hud && !hud.pointerLocked && !shopOpen && !result && <div className="lock-hint">Clique na tela para controlar a câmera</div>}

      {/* Comandos (H esconde) */}
      {showControls && !result && (
        <div className="controls">
          {CONTROLS.map(([k, label]) => (
            <div key={k}>
              <Key wide={k.length > 2}>{k}</Key>
              <span>{label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Loja */}
      {shopOpen && me && (
        <div className="overlay">
          <div className="panel shop">
            <header>
              <h2>Loja da sede</h2>
              <span className="money">${me.money}</span>
            </header>
            {!hud?.inOwnSede && <p className="banner danger">Volte para a sua sede para comprar.</p>}
            <div className="items">
              {ITEMS.map((it) => {
                const w = DEFAULT_COMBAT_DATA.weapons[it.id];
                const owned = it.tipo === 'arma' ? me.weapon === it.id : me.curativos >= CURATIVO.maxPorJogador;
                const disabled = !hud?.inOwnSede || me.money < it.preco || owned;
                return (
                  <button key={it.id} className="item" disabled={disabled} onClick={() => engineRef.current?.buy(it.id)}>
                    <div className="item-head">
                      <b>{it.nome}</b>
                      <span className={me.money >= it.preco ? 'price' : 'price short'}>${it.preco}</span>
                    </div>
                    {w ? (
                      <>
                        <small className="muted">
                          {w.tipo} · {w.durabilidade ? `${w.durabilidade} usos` : 'não quebra'}
                        </small>
                        {weaponStats(w).map(([label, v]) => (
                          <div key={label} className="stat">
                            <span>{label}</span>
                            <Meter kind="stat" value={v} max={1} />
                          </div>
                        ))}
                      </>
                    ) : (
                      <small className="muted">
                        +{(C.curativo.ticks / C.curativo.interval) * C.curativo.amount} de vida em 2 s, estanca o sangramento. Tecla 4. Você tem {me.curativos}.
                      </small>
                    )}
                    {owned && <span className="owned">{it.tipo === 'arma' ? 'Equipada' : 'Limite'}</span>}
                  </button>
                );
              })}
            </div>
            <footer>
              <span className="muted">Armas são perdidas ao ser nocauteado.</span>
              <button className="secondary" onClick={closeShop}>
                Fechar <Key>J</Key>
              </button>
            </footer>
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
                  .map((f) => ({ id: f.id, nick: nick(f.id), bot: !!hud.roster[f.id]?.bot, kos: f.kos, deaths: f.deaths, assists: f.assists, money: t === team ? f.money : null })),
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
            <button className="primary" onClick={onExit}>
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
}

function Scoreboard({ rows, score, you }: { rows: Row[][]; score: [number, number]; you: string | null }) {
  return (
    <div className="scoreboard">
      {rows.map((list, t) => {
        const torcida = TORCIDAS[t as 0 | 1];
        const showMoney = list.some((r) => r.money !== null);
        return (
          <table key={t}>
            <thead>
              <tr>
                <th>
                  <span className="sb-team">
                    <Crest torcida={torcida} size={22} /> {torcida.nome} <b>{score[t]}</b>
                  </span>
                </th>
                <th>K</th>
                <th>M</th>
                <th>A</th>
                {showMoney && <th>$</th>}
              </tr>
            </thead>
            <tbody>
              {[...list]
                .sort((a, b) => b.kos - a.kos || b.assists - a.assists)
                .map((r) => (
                  <tr key={r.id} className={r.id === you ? 'me' : ''}>
                    <td>
                      {r.nick} {r.bot && <span className="tag">BOT</span>}
                    </td>
                    <td>{r.kos}</td>
                    <td>{r.deaths}</td>
                    <td>{r.assists}</td>
                    {showMoney && <td>{r.money ?? ''}</td>}
                  </tr>
                ))}
            </tbody>
          </table>
        );
      })}
    </div>
  );
}
