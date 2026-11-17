import { type CharacterVisual, levelFromXp, shopItems, type Torcida, TORCIDAS } from '@torcidas/shared';
import { useState } from 'react';
import { CharacterPreview } from './CharacterPreview';
import { Crest, Key, teamGlow } from './kit';
import { type RoomEntry, Rooms } from './Rooms';
import './screens.css';
import { saveVisual, VisualEditor, type VisualTab } from './VisualEditor';

interface Props {
  user: { name: string; image: string | null };
  nick: string;
  torcida: Torcida;
  visual: CharacterVisual;
  stats: {
    matches: number;
    wins: number;
    kos: number;
    deaths: number;
    assists: number;
    xp: number;
  } | null;
  joining: boolean;
  error: string | null;
  onPlay: () => void;
  onEdit: (step: 'nick') => void;
  /** Visual salvo: recarrega o perfil (resolve quando a home já tem o visual novo). */
  onVisualSaved: () => Promise<void>;
  onSignOut: () => void;
  onEnterRoom: (r: RoomEntry) => void;
}

export function Home({ user, nick, torcida, visual, stats, joining, error, onPlay, onEdit, onVisualSaved, onSignOut, onEnterRoom }: Props) {
  // Rascunho do visual: presente enquanto o editor está aberto; a prévia grande mostra ele ao vivo.
  const [draft, setDraft] = useState<CharacterVisual | null>(null);
  const [tab, setTab] = useState<VisualTab>('corpo');
  const [saving, setSaving] = useState(false);
  const [visualError, setVisualError] = useState<string | null>(null);

  async function save() {
    if (!draft || saving) return;
    setSaving(true);
    setVisualError(null);
    const err = await saveVisual(draft);
    if (err) setVisualError(err);
    else {
      await onVisualSaved();
      setDraft(null);
    }
    setSaving(false);
  }

  function closeEditor() {
    setDraft(null);
    setVisualError(null);
  }

  const rival = TORCIDAS[torcida.team === 0 ? 1 : 0];
  const s = stats ?? {
    matches: 0,
    wins: 0,
    kos: 0,
    deaths: 0,
    assists: 0,
    xp: 0,
  };
  const lv = levelFromXp(s.xp);
  const nextUnlock = shopItems()
    .filter((i) => i.nivelMin > lv.level)
    .sort((a, b) => a.nivelMin - b.nivelMin)[0];
  const km = s.deaths > 0 ? (s.kos / s.deaths).toFixed(2) : String(s.kos);
  const [c1, c2] = torcida.cores;
  const glow = teamGlow(torcida);
  return (
    <main
      className="hm"
      style={{
        ['--t1' as string]: c1,
        ['--t2' as string]: c2,
        ['--glow' as string]: glow,
      }}
    >
      <header className="hm-top">
        <span className="ln-mark">T</span>
        <b className="hm-brand">Torcidas</b>
        <div className="hm-user">
          {user.image && <img src={user.image} alt="" referrerPolicy="no-referrer" />}
          <span>{user.name}</span>
          <button className="hm-link" onClick={onSignOut}>
            Sair
          </button>
        </div>
      </header>

      <div className="hm-grid">
        <section className="hm-stage" aria-label="Seu lutador">
          <div className="hm-flood" aria-hidden="true" />
          <CharacterPreview team={torcida.team} visual={draft ?? visual} framing={draft && tab !== 'corpo' ? 'head' : 'body'} className="hm-canvas" />
          <div className="hm-id">
            <Crest torcida={torcida} size={40} />
            <div>
              <h1>{nick}</h1>
              <p>
                {torcida.nome} · sede: {torcida.sede}
              </p>
              <div className="hm-xp">
                <b>Nível {lv.level}</b>
                <span
                  className="hm-xp-bar"
                  role="progressbar"
                  aria-label="XP até o próximo nível"
                  aria-valuemin={0}
                  aria-valuemax={lv.need}
                  aria-valuenow={lv.into}
                >
                  <i style={{ width: `${(lv.into / lv.need) * 100}%` }} />
                </span>
                <small>
                  {lv.into} / {lv.need} XP
                </small>
              </div>
              {nextUnlock && (
                <small className="muted">
                  Nível {nextUnlock.nivelMin} libera: {nextUnlock.nome}
                </small>
              )}
            </div>
          </div>
          {!draft && (
            <div className="hm-edit">
              <button
                onClick={() => {
                  setTab('corpo');
                  setDraft(visual);
                }}
              >
                Mudar visual
              </button>
              <button onClick={() => onEdit('nick')}>Nick e torcida</button>
            </div>
          )}
          <small className="hm-drag">Arraste para girar</small>
        </section>

        {draft ? (
          <div className="hm-side">
            <section className="hm-play hm-editor" aria-labelledby="hm-editor-title">
              <p className="hm-kicker">Seu lutador</p>
              <h2 id="hm-editor-title">Mudar visual</h2>
              <VisualEditor visual={draft} onChange={setDraft} tab={tab} onTab={setTab} />
              <button className="hm-go" onClick={save} disabled={saving}>
                {saving ? 'Salvando…' : 'Salvar visual'}
              </button>
              <button className="hm-cancel" onClick={closeEditor} disabled={saving}>
                Cancelar
              </button>
              {visualError && (
                <p className="ln-error" role="alert">
                  {visualError}
                </p>
              )}
            </section>
          </div>
        ) : (
          <div className="hm-side">
            <section className="hm-play" aria-labelledby="hm-play-title">
              <p className="hm-kicker">Partida rápida · 10 × 10</p>
              <h2 id="hm-play-title">
                {torcida.nome}
                <span aria-label="contra"> × </span>
                {rival.nome}
              </h2>
              <button className="hm-go" onClick={onPlay} disabled={joining}>
                {joining ? 'Entrando…' : 'Jogar'}
              </button>
              <p className="hm-note">Vagas vazias viram bots. Segure os pontos A, B e C. Segure Z para pegar armas, bomba e gás em qualquer lugar.</p>
              {error && (
                <p className="ln-error" role="alert">
                  {error}
                </p>
              )}
            </section>

            <dl className="hm-stats">
              <div>
                <dt>Partidas</dt>
                <dd>{s.matches}</dd>
              </div>
              <div>
                <dt>Vitórias</dt>
                <dd>{s.wins}</dd>
              </div>
              <div>
                <dt>Nocautes</dt>
                <dd>{s.kos}</dd>
              </div>
              <div>
                <dt>K/M</dt>
                <dd>{km}</dd>
              </div>
            </dl>

            <Rooms onEnter={onEnterRoom} />
          </div>
        )}
      </div>

      <footer className="hm-tips">
        <span>
          <Key>F</Key> no tempo certo = parry
        </span>
        <span>
          <Key>C</Key> no último instante = esquiva perfeita
        </span>
        <span>
          <Key>R</Key> especial com a barra de Raça
        </span>
        <span>
          <Key>X</Key> levanta o parceiro caído
        </span>
        <span>
          <Key>Espaço</Key> correndo pula grade e desliza no capô
        </span>
        <span>
          <Key>E</Key> com o rival encostado no carro esmaga
        </span>
      </footer>
    </main>
  );
}
