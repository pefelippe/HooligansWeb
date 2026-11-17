import { type CharacterVisual, randomVisual, VISUAL_OPTIONS, VISUAL_RANGES, type VisualKey, type VisualRangeKey } from '@torcidas/shared';
import { api } from '../api';

const LABELS: Record<VisualKey, string> = {
  pele: 'Pele',
  cabelo: 'Corte',
  corCabelo: 'Cor do cabelo',
  barba: 'Barba',
  corBarba: 'Cor da barba',
  camisa: 'Camisa',
  acessorio: 'Acessório',
};

const metros = (cm: number) => `${(cm / 100).toFixed(2).replace('.', ',')} m`;
const faixa = (n: number, nomes: string[]) => nomes[Math.min(nomes.length - 1, Math.floor((n / 101) * nomes.length))]!;

const RANGES: Record<VisualRangeKey, { nome: string; valor: (n: number) => string; ends: [string, string] }> = {
  altura: { nome: 'Altura', valor: metros, ends: ['Anão', 'Gigante'] },
  peso: { nome: 'Peso', valor: (n) => faixa(n, ['Magro', 'Normal', 'Fortinho', 'Gordo', 'Muito gordo']), ends: ['Magro', 'Gordo'] },
  musculo: { nome: 'Músculos', valor: (n) => faixa(n, ['Pouco', 'Médio', 'Forte', 'Marombado']), ends: ['Nenhum', 'Marombado'] },
};
const ALTURA_PRESETS = [115, 150, 170, 185, 200];

/** Abas do editor; a prévia aproxima no rosto fora da aba do corpo. */
export const VISUAL_TABS = [
  { id: 'corpo', nome: 'Corpo', ranges: ['altura', 'peso', 'musculo'], keys: ['pele', 'camisa'] },
  { id: 'cabelo', nome: 'Cabelo', ranges: [], keys: ['cabelo', 'corCabelo', 'acessorio'] },
  { id: 'barba', nome: 'Barba', ranges: [], keys: ['barba', 'corBarba'] },
] as const satisfies readonly { id: string; nome: string; ranges: readonly VisualRangeKey[]; keys: readonly VisualKey[] }[];
export type VisualTab = (typeof VISUAL_TABS)[number]['id'];

/** Grava o visual no perfil; devolve a mensagem de erro, ou null se deu certo. */
export async function saveVisual(visual: CharacterVisual): Promise<string | null> {
  try {
    await api('/profile/visual', { method: 'PUT', body: JSON.stringify({ visual }) });
    return null;
  } catch (e) {
    const code = (e as Error).message;
    return code === 'visual_invalido' ? 'Visual inválido' : code;
  }
}

interface Props {
  visual: CharacterVisual;
  onChange: (v: CharacterVisual) => void;
  tab: VisualTab;
  onTab: (t: VisualTab) => void;
}

/** Opções do visual em abas, com sorteio. Controlado: quem usa guarda o rascunho e salva. */
export function VisualEditor({ visual, onChange, tab, onTab }: Props) {
  const t = VISUAL_TABS.find((x) => x.id === tab)!;
  return (
    <div className="ve">
      <div className="ve-bar">
        <div className="segmented" role="tablist" aria-label="Partes do visual">
          {VISUAL_TABS.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={x.id === tab} className={x.id === tab ? 'on' : ''} onClick={() => onTab(x.id)}>
              {x.nome}
            </button>
          ))}
        </div>
        <button type="button" className="secondary" onClick={() => onChange(randomVisual(Math.floor(Math.random() * 2 ** 31)))}>
          Aleatório
        </button>
      </div>
      <div className="ve-scroll">
        {t.ranges.map((k) => {
          const r = RANGES[k];
          const id = `ve-${k}`;
          return (
            <div key={k} className="vopt">
              <label className="vrange-label" htmlFor={id}>
                {r.nome} <b>{r.valor(visual[k])}</b>
              </label>
              <input
                id={id}
                className="vrange"
                type="range"
                min={VISUAL_RANGES[k].min}
                max={VISUAL_RANGES[k].max}
                step={1}
                value={visual[k]}
                aria-valuetext={r.valor(visual[k])}
                onChange={(e) => onChange({ ...visual, [k]: Number(e.target.value) })}
              />
              <div className="vrange-ends">
                <span>{r.ends[0]}</span>
                <span>{r.ends[1]}</span>
              </div>
              {k === 'altura' && (
                <div className="vchoices">
                  {ALTURA_PRESETS.map((cm) => (
                    <button key={cm} type="button" aria-pressed={visual.altura === cm} className={`chip ${visual.altura === cm ? 'on' : ''}`} onClick={() => onChange({ ...visual, altura: cm })}>
                      {metros(cm)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {t.keys.map((k) => (
          <fieldset key={k} className="vopt">
            <legend>{LABELS[k]}</legend>
            <div className="vchoices">
              {VISUAL_OPTIONS[k].map((o) => {
                const on = visual[k] === o.id;
                const pick = () => onChange({ ...visual, [k]: o.id });
                return 'cor' in o ? (
                  <button key={o.id} type="button" aria-pressed={on} aria-label={o.nome} title={o.nome} className={`swatch ${on ? 'on' : ''}`} style={{ background: o.cor }} onClick={pick} />
                ) : (
                  <button key={o.id} type="button" aria-pressed={on} className={`chip ${on ? 'on' : ''}`} onClick={pick}>
                    {o.nome}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
      <p className="vnote">Só visual: altura e peso não mudam alcance, velocidade nem área de acerto.</p>
    </div>
  );
}
