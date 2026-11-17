import { MATCH_SIZES, type MatchSize, ROOM, type RoomSummary } from '@torcidas/shared';
import { useEffect, useState } from 'react';
import { api } from '../api';

export interface RoomEntry {
  code: string;
  ticket: string;
  serverUrl: string;
}

const ERRORS: Record<string, string> = {
  sala_inexistente: 'Não existe sala com esse código',
  expulso: 'Você foi expulso dessa sala',
  sala_cheia: 'A sala está cheia',
  tamanho_invalido: 'Escolha 1×1, 5×5, 10×10 ou 20×20',
  time_cheio: 'A sala está cheia para a sua torcida',
  nome_invalido: `O nome da sala precisa ter de ${ROOM.nameMin} a ${ROOM.nameMax} caracteres`,
  codigo_invalido: 'Digite o código da sala',
  servidor_de_jogo_indisponivel: 'Servidor de jogo fora do ar (porta 4000)',
};

export const roomError = (code: string) => ERRORS[code] ?? code;

/** Home: salas públicas, criar sala e entrar com código. */
export function Rooms({ onEnter }: { onEnter: (r: RoomEntry) => void }) {
  const [list, setList] = useState<RoomSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [nome, setNome] = useState('');
  const [publica, setPublica] = useState(true);
  const [tamanho, setTamanho] = useState<MatchSize>(ROOM.defaultSize);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lista atualiza a cada 5 s enquanto a home está aberta.
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ rooms: RoomSummary[] }>('/rooms')
        .then((r) => alive && setList(r.rooms))
        .catch(() => alive && setList([]));
    void load();
    const id = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  async function go(path: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      onEnter(await api<RoomEntry>(path, { method: 'POST', body: JSON.stringify(body) }));
    } catch (e) {
      setError(roomError((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="profile-card rooms">
      <header className="rooms-head">
        <h3>Salas</h3>
        <button className="secondary" onClick={() => setCreating((v) => !v)}>
          {creating ? 'Fechar' : 'Criar sala'}
        </button>
      </header>

      {creating && (
        <form
          className="room-create"
          onSubmit={(e) => {
            e.preventDefault();
            void go('/rooms', { nome, publica, tamanho });
          }}
        >
          <label className="field">
            <span>Nome da sala</span>
            <input value={nome} maxLength={ROOM.nameMax} placeholder="ex.: Clássico da firma" onChange={(e) => setNome(e.target.value)} />
          </label>
          <div className="segmented" role="radiogroup" aria-label="Visibilidade">
            <button type="button" role="radio" aria-checked={publica} className={publica ? 'on' : ''} onClick={() => setPublica(true)}>
              Pública
            </button>
            <button type="button" role="radio" aria-checked={!publica} className={!publica ? 'on' : ''} onClick={() => setPublica(false)}>
              Privada
            </button>
          </div>
          <div className="segmented" role="radiogroup" aria-label="Tamanho da partida">
            {MATCH_SIZES.map((n) => (
              <button key={n} type="button" role="radio" aria-checked={tamanho === n} className={tamanho === n ? 'on' : ''} onClick={() => setTamanho(n)}>
                {n}×{n}
              </button>
            ))}
          </div>
          <small className="fine">
            {publica ? 'Aparece na lista para todo mundo.' : 'Só entra quem tiver o código ou o link.'} {tamanho} por torcida, bots completam as vagas.{' '}
            {tamanho <= 5 ? 'Mapa pequeno, só a praça do meio.' : tamanho <= 10 ? 'Mapa médio, 3 praças.' : 'Mapa grande, 3 praças.'}
          </small>
          <button className="primary" disabled={busy}>
            Criar e entrar
          </button>
        </form>
      )}

      <form
        className="room-code"
        onSubmit={(e) => {
          e.preventDefault();
          void go('/rooms/join', { code });
        }}
      >
        <input value={code} maxLength={6} placeholder="Código da sala" spellCheck={false} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
        <button className="secondary" disabled={busy || code.length < 6}>
          Entrar
        </button>
      </form>

      {error && (
        <p className="banner danger" role="alert">
          {error}
        </p>
      )}

      <ul className="room-list">
        {list === null && <li className="muted">Carregando…</li>}
        {list?.length === 0 && <li className="muted">Nenhuma sala pública agora. Crie uma!</li>}
        {list?.map((r) => (
          <li key={r.code}>
            <div>
              <b>{r.nome}</b>
              <small>
                {r.tamanho}×{r.tamanho} · {r.lider} · {r.humanos} {r.humanos === 1 ? 'pessoa' : 'pessoas'} · {r.total}/{r.tamanho * 2} · {r.fase === 'playing' ? 'em partida' : 'no lobby'}
              </small>
            </div>
            <button className="secondary" disabled={busy} onClick={() => void go('/rooms/join', { code: r.code })}>
              Entrar
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
