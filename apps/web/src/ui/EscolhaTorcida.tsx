import {
  type CharacterVisual,
  getTorcida,
  NICK_MAX,
  randomVisual,
  TORCIDAS,
  validateNick,
  VISUAL_KEYS,
  VISUAL_OPTIONS,
  type VisualKey,
} from '@torcidas/shared';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { CharacterPreview } from './CharacterPreview';
import { Crest } from './kit';

interface Props {
  user: { name: string; image: string | null };
  initialNick?: string;
  initialTorcida?: string;
  initialVisual: CharacterVisual;
  /** Etapa em que abre (o "Visual" da home abre direto na 3). */
  startStep?: Step;
  onSaved: () => void;
  /** Presente quando já existe perfil (veio do "Editar"). */
  onCancel?: () => void;
  /** Erro vindo de fora (ex.: login com Google cancelado). */
  notice?: string | null;
}

const NICK_ERRORS: Record<string, string> = {
  nick_curto: 'Mínimo de 3 caracteres',
  nick_longo: `Máximo de ${NICK_MAX} caracteres`,
  nick_caracteres: 'Só letras, números, ponto, hífen e _',
  nick_invalido: 'Só letras, números, ponto, hífen e _ (3 a 16)',
  nick_em_uso: 'Esse nick já tem dono',
  torcida_invalida: 'Escolha uma torcida',
};

type Step = 'torcida' | 'nick' | 'visual';

const VISUAL_LABELS: Record<VisualKey, string> = {
  pele: 'Pele',
  cabelo: 'Cabelo',
  corCabelo: 'Cor do cabelo',
  barba: 'Barba',
  corpo: 'Corpo',
  altura: 'Altura',
  camisa: 'Camisa',
  acessorio: 'Acessório',
};

type Check =
  | { status: 'idle' | 'checking' | 'ok' }
  | { status: 'error'; error: string; suggestions: string[] };

interface CheckResult {
  nick: string;
  ok: boolean;
  error?: string;
  suggestions: string[];
}

export function EscolhaTorcida({ user, initialNick, initialTorcida, initialVisual, startStep, onSaved, onCancel, notice }: Props) {
  const [step, setStep] = useState<Step>(startStep ?? (initialTorcida ? 'nick' : 'torcida'));
  const [visual, setVisual] = useState(initialVisual);
  /** Perfil (torcida + nick) já gravado: libera a etapa do visual. */
  const [profileSaved, setProfileSaved] = useState(!!onCancel);
  const [torcidaId, setTorcidaId] = useState(initialTorcida ?? '');
  const [nick, setNick] = useState(initialNick ?? '');
  const [check, setCheck] = useState<Check>({ status: 'idle' });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const latest = useRef(nick);
  const torcida = getTorcida(torcidaId);
  const firstName = user.name.split(' ')[0];

  async function runCheck(value: string, signal?: AbortSignal) {
    const r = await api<CheckResult>(`/nick/check?nick=${encodeURIComponent(value)}`, { signal });
    if (r.nick !== latest.current) return; // resposta de um nick que já foi trocado
    setCheck(r.ok ? { status: 'ok' } : { status: 'error', error: r.error ?? 'nick_invalido', suggestions: r.suggestions });
  }

  // Valida na hora o formato e confere a disponibilidade com um pequeno atraso (inclusive o nick pré-preenchido).
  useEffect(() => {
    latest.current = nick;
    if (!nick) return setCheck({ status: 'idle' });
    const local = validateNick(nick);
    if (local) return setCheck({ status: 'error', error: local, suggestions: [] });
    setCheck({ status: 'checking' });
    const ctrl = new AbortController();
    const t = setTimeout(() => runCheck(nick, ctrl.signal).catch(() => setCheck({ status: 'idle' })), 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [nick]);

  function pickTorcida(id: string) {
    setTorcidaId(id);
    setStep('nick');
  }

  async function save() {
    if (!torcida || check.status !== 'ok' || saving) return;
    setSaveError(null);
    setSaving(true);
    try {
      await api('/profile', { method: 'PUT', body: JSON.stringify({ nick, torcidaId }) });
      setProfileSaved(true);
      // Primeira vez: segue para o visual. Editando: salvou, volta.
      if (onCancel) onSaved();
      else setStep('visual');
    } catch (e) {
      const code = (e as Error).message;
      // Alguém pegou o nick entre a checagem e o salvar: mostra as sugestões em vez de um erro solto.
      if (code === 'nick_em_uso') await runCheck(nick).catch(() => setSaveError(NICK_ERRORS[code]!));
      else setSaveError(NICK_ERRORS[code] ?? code);
    } finally {
      setSaving(false);
    }
  }

  async function saveVisual() {
    if (saving) return;
    setSaveError(null);
    setSaving(true);
    try {
      await api('/profile/visual', { method: 'PUT', body: JSON.stringify({ visual }) });
      onSaved();
    } catch (e) {
      const code = (e as Error).message;
      setSaveError(code === 'visual_invalido' ? 'Visual inválido' : code);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="screen home onboarding">
      <header className="greeting">
        {user.image && <img src={user.image} alt="" referrerPolicy="no-referrer" />}
        <div>
          <h2>{onCancel ? 'Editar perfil' : `Fala, ${firstName}!`}</h2>
          <p>{onCancel ? 'Troque de torcida, nick ou visual' : 'Falta pouco para a primeira briga'}</p>
        </div>
      </header>

      <ol className="stepper">
        <li className={step === 'torcida' ? 'current' : 'done'}>
          <button className="ghost" onClick={() => setStep('torcida')} disabled={step === 'torcida'}>
            <i>1</i> Torcida
          </button>
        </li>
        <li className={step === 'nick' ? 'current' : step === 'visual' ? 'done' : ''}>
          <button className="ghost" onClick={() => torcida && setStep('nick')} disabled={step === 'nick' || !torcida}>
            <i>2</i> Nick
          </button>
        </li>
        <li className={step === 'visual' ? 'current' : ''}>
          <button className="ghost" onClick={() => setStep('visual')} disabled={step === 'visual' || !torcida || !profileSaved}>
            <i>3</i> Visual
          </button>
        </li>
      </ol>

      {step === 'torcida' ? (
        <>
          <section className="pick" role="radiogroup" aria-label="Torcida">
            {TORCIDAS.map((t) => (
              <button
                key={t.id}
                role="radio"
                aria-checked={t.id === torcidaId}
                className={`pick-card ${t.id === torcidaId ? 'selected' : ''}`}
                style={{ '--c1': t.cores[0], '--c2': t.cores[1] } as React.CSSProperties}
                onClick={() => pickTorcida(t.id)}
              >
                <Crest torcida={t} size={84} />
                <b>{t.nome}</b>
                <small>
                  {t.cidade}-{t.uf} · nasce na {t.sede}
                </small>
              </button>
            ))}
          </section>
          <p className="fine">Você só enfrenta a torcida rival. Os aliados que faltarem viram bots.</p>
          {onCancel && (
            <button className="ghost" onClick={onCancel}>
              Cancelar
            </button>
          )}
        </>
      ) : step === 'nick' ? (
        torcida && (
          <section className="profile-card">
            <div className="chosen">
              <Crest torcida={torcida} size={40} />
              <div>
                <small>Sua torcida</small>
                <b>{torcida.nome}</b>
              </div>
              <button className="ghost" onClick={() => setStep('torcida')}>
                Trocar
              </button>
            </div>

            <label className="field">
              <span>
                Nick
                <em>
                  {[...nick].length}/{NICK_MAX}
                </em>
              </span>
              <input
                autoFocus
                placeholder="como você vai aparecer na partida"
                value={nick}
                maxLength={NICK_MAX}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={check.status === 'error'}
                aria-describedby="nick-status"
                onChange={(e) => setNick(e.target.value.trim())}
                onKeyDown={(e) => e.key === 'Enter' && void save()}
              />
            </label>

            <div id="nick-status" className={`nick-status ${check.status}`} aria-live="polite">
              {check.status === 'idle' && '3 a 16 caracteres: letras, números, ponto, hífen e _'}
              {check.status === 'checking' && 'Conferindo…'}
              {check.status === 'ok' && '✓ Disponível'}
              {check.status === 'error' && `✕ ${NICK_ERRORS[check.error] ?? check.error}`}
            </div>
            {check.status === 'error' && check.suggestions.length > 0 && (
              <div className="suggestions">
                <small>Que tal:</small>
                {check.suggestions.map((s) => (
                  <button key={s} className="chip" onClick={() => setNick(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}

            <div className="nick-preview" style={{ '--c1': torcida.cores[0], '--c2': torcida.cores[1] } as React.CSSProperties}>
              <small>Assim você aparece na partida</small>
              <div className="nameplate">
                <Crest torcida={torcida} size={22} />
                <b>{nick || 'SeuNick'}</b>
              </div>
            </div>

            <button className="primary big" disabled={check.status !== 'ok' || saving} onClick={save}>
              {saving ? 'Salvando…' : onCancel ? 'Salvar' : 'Continuar'}
            </button>
            {onCancel ? (
              <button className="ghost" onClick={onCancel}>
                Cancelar
              </button>
            ) : (
              <small className="fine">Dá pra trocar depois em Editar, na tela inicial.</small>
            )}
            {(saveError ?? notice) && (
              <p className="banner danger" role="alert">
                {saveError ?? notice}
              </p>
            )}
          </section>
        )
      ) : (
        torcida && (
          <section className="profile-card visual-card">
            <div className="visual-stage">
              <CharacterPreview team={torcida.team} visual={visual} />
              <button className="secondary" onClick={() => setVisual(randomVisual(Math.floor(Math.random() * 2 ** 31)))}>
                Aleatório
              </button>
            </div>
            <div className="visual-options">
              {VISUAL_KEYS.map((k) => (
                <div key={k} className="vopt">
                  <span>{VISUAL_LABELS[k]}</span>
                  <div className="vchoices" role="radiogroup" aria-label={VISUAL_LABELS[k]}>
                    {VISUAL_OPTIONS[k].map((o) => {
                      const on = visual[k] === o.id;
                      const pick = () => setVisual((v) => ({ ...v, [k]: o.id }));
                      return 'cor' in o ? (
                        <button
                          key={o.id}
                          role="radio"
                          aria-checked={on}
                          aria-label={o.nome}
                          title={o.nome}
                          className={`swatch ${on ? 'on' : ''}`}
                          style={{ background: o.cor }}
                          onClick={pick}
                        />
                      ) : (
                        <button key={o.id} role="radio" aria-checked={on} className={`chip ${on ? 'on' : ''}`} onClick={pick}>
                          {o.nome}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <button className="primary big" disabled={saving} onClick={saveVisual}>
              {saving ? 'Salvando…' : onCancel ? 'Salvar visual' : 'Entrar na torcida'}
            </button>
            {onCancel ? (
              <button className="ghost" onClick={onCancel}>
                Cancelar
              </button>
            ) : (
              <small className="fine">Dá pra trocar depois em Visual, na tela inicial.</small>
            )}
            {saveError && (
              <p className="banner danger" role="alert">
                {saveError}
              </p>
            )}
          </section>
        )
      )}
    </main>
  );
}
