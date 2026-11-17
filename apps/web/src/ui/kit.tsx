import { type Torcida, TORCIDAS } from '@torcidas/shared';
import type { ReactNode } from 'react';

// Peças visuais reutilizadas pela home e pelo HUD.

/** Tecla desenhada como keycap. */
export function Key({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <kbd className={`key ${wide ? 'wide' : ''}`}>{children}</kbd>;
}

const INITIALS: Record<string, string> = { cearalove: 'CL', 'lions-do-pici': 'LP' };

/** Escudo da torcida: listras nas cores e as iniciais. */
export function Crest({ torcida, size = 40 }: { torcida: Torcida; size?: number }) {
  const [a, b] = torcida.cores;
  return (
    <span
      className="crest"
      style={{
        width: size,
        height: size * 1.12,
        fontSize: size * 0.36,
        background: `repeating-linear-gradient(90deg, ${a} 0 ${size / 5}px, ${b} ${size / 5}px ${(size / 5) * 2}px)`,
      }}
    >
      <b style={{ background: a }}>{INITIALS[torcida.id] ?? torcida.nome.slice(0, 2)}</b>
    </span>
  );
}

/** Cor clara da torcida para luzes e faixas (o preto da Cearalove sumiria no fundo escuro). */
export function teamGlow(t: Torcida): string {
  const [a, b] = t.cores;
  const n = parseInt(a.slice(1), 16);
  const luma = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return luma < 0.15 ? b : a;
}

export function teamOf(team: 0 | 1): Torcida {
  return TORCIDAS[team];
}

/** Barra com valor e rótulo. */
export function Meter({ value, max, kind, label, marks = [] }: { value: number; max: number; kind: string; label?: ReactNode; marks?: number[] }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={`meter ${kind}`}>
      <i style={{ width: `${pct}%` }} />
      {marks.map((m) => (
        <em key={m} style={{ left: `${(m / max) * 100}%` }} />
      ))}
      {label !== undefined && <span>{label}</span>}
    </div>
  );
}

/** Botão "Entrar com Google" com o G oficial. */
export function GoogleButton({ onClick, disabled, children = 'Entrar com Google' }: { onClick: () => void; disabled?: boolean; children?: ReactNode }) {
  return (
    <button className="secondary google" onClick={onClick} disabled={disabled}>
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
      {children}
    </button>
  );
}

// Ícones de traço (24×24) para armas e itens da loja; herdam a cor do texto.
const ITEM_PATHS: Record<string, string> = {
  punhos: 'M7 11V8a1.8 1.8 0 0 1 3.6 0v2M10.6 10V6.8a1.8 1.8 0 0 1 3.6 0V10M14.2 10V7.8a1.8 1.8 0 0 1 3.6 0V14c0 3.9-3 7-6.8 7h-1C7 21 5 18.8 5 16.4V13a2 2 0 0 1 4 0',
  soqueira: 'M4 13.5h16v2.2A3.3 3.3 0 0 1 16.7 19H7.3A3.3 3.3 0 0 1 4 15.7zM6 9.8a2.2 2.2 0 1 0 0 .1M10 9.8a2.2 2.2 0 1 0 0 .1M14 9.8a2.2 2.2 0 1 0 0 .1M18 9.8a2.2 2.2 0 1 0 0 .1',
  garrafa: 'M10 2.5h4v4l2 3V20a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 8 20V9.5l2-3zM8 13h8v4H8',
  caco: 'M8 21.5h8V12l-2 2.2-1.6-3.2-1.7 3-1.9-2.6L8 12.5z',
  faca: 'M4 20.5l5.5-5.5M9.5 15L20 4.5c.8 3.5-.4 6.8-3.5 9.6L12 18.5zM3 21.5l3-3',
  punhal: 'M12 2l2.2 4.2V15h-4.4V6.2zM7 15h10M12 15v6.5M10.5 21.5h3',
  cassetete: 'M5 20L17.5 7.5M15.5 5.5l3 3M16 9l2.5 2.5',
  taco: 'M4 20.5L15.5 9c2-2 4.3-3.7 5.5-6-2.3 1.2-4 3.5-6 5.5L3.5 20M3 21.5l1.5-1.5',
  barra: 'M4.5 17.5L17.5 4.5l2 2-13 13zM6 19l-1.5-1.5',
  curativo: 'M3.5 7.5h17v12h-17zM9 7.5V5h6v2.5M12 10.5v6M9 13.5h6',
  bandagem: 'M7 7.5a4.5 4.5 0 1 0 0 9h12v-9zM7 10.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4M19 9.5h2.5',
  pistola: 'M3 8h15.5v4H11l-1.2 6.5H5.5L7 12H3zM18.5 9h2.5M10 12l1 2.5h2',
  colete: 'M8 3h2.5l1.5 2 1.5-2H16l3 4v13H5V7zM5 11h14M12 5v15',
  bomba: 'M11 21a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM14.5 9l2.5-2.5M17 6.5c.5-1.5 1.8-2.3 3.3-2M19 2.5v1.2M21.5 5h-1.2',
  gas: 'M8 9h8v12H8zM9.5 9V6.5h5V9M10 4h4M15 4.5c1.5-1.2 3.5-1 4.5.5M17.5 7.5c1.6-.3 3 .6 3.5 2M8 14h8',
};

/** Ícone do item (arma, curativo, bandagem). Sem desenho: inicial do nome. */
export function ItemIcon({ id, size = 24 }: { id: string; size?: number }) {
  const d = ITEM_PATHS[id];
  return (
    <svg className="item-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d ? <path d={d} /> : <text x="12" y="16" textAnchor="middle" fontSize="12" fill="currentColor" stroke="none">{id.slice(0, 1).toUpperCase()}</text>}
    </svg>
  );
}
