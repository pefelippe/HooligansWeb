import { type CharacterVisual, getTorcida, randomVisual, sanitizeNick, TORCIDAS, validateVisual, visualSeed } from '@torcidas/shared';
import { useCallback, useEffect, useState } from 'react';
import { api, authClient } from './api';
import { EscolhaTorcida } from './ui/EscolhaTorcida';
import { Game } from './ui/Game';
import { Crest, Key } from './ui/kit';
import { Lobby } from './ui/Lobby';
import { Login } from './ui/Login';
import { type RoomEntry, roomError, Rooms } from './ui/Rooms';

interface Me {
  user: { id: string; name: string; image: string | null; anonymous: boolean };
  profile: { nick: string; torcidaId: string; visual: Partial<CharacterVisual> } | null;
  stats: { matches: number; wins: number; kos: number; deaths: number; assists: number } | null;
}

const INVITE_KEY = 'torcidas.convite';

/**
 * Convite por link (?sala=CODIGO). Guarda na sessão para sobreviver ao login com Google,
 * que volta sem a query string.
 */
function takeInvite(): void {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('sala');
  if (!code) return;
  try {
    sessionStorage.setItem(INVITE_KEY, code.toUpperCase());
  } catch {
    /* sem storage: o convite vale só se já estiver logado */
  }
  url.searchParams.delete('sala');
  window.history.replaceState(null, '', url);
}

function pendingInvite(): string | null {
  try {
    const code = sessionStorage.getItem(INVITE_KEY);
    sessionStorage.removeItem(INVITE_KEY);
    return code;
  } catch {
    return null;
  }
}

takeInvite();

function takeLoginError(): string | null {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('error');
  if (!code) return null;
  url.searchParams.delete('error');
  window.history.replaceState(null, '', url);
  return code === 'access_denied' ? 'Login com Google cancelado' : `Não foi possível entrar com Google (${code})`;
}

export function App() {
  // undefined: carregando; null: sem sessão (tela de login).
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  /** Editando o perfil: abre na etapa do nick (Editar) ou do visual (Visual). */
  const [editing, setEditing] = useState<false | 'nick' | 'visual'>(false);
  const [error, setError] = useState<string | null>(takeLoginError);
  const [match, setMatch] = useState<{ ticket: string; serverUrl: string } | null>(null);
  const [joining, setJoining] = useState(false);
  const [room, setRoom] = useState<RoomEntry | null>(null);

  const load = useCallback(async () => {
    try {
      const m = await api<Me>('/me');
      // Sessão anônima é só do smoke test; no web, quem tiver uma sobrando volta para o login.
      if (m.user.anonymous) {
        await authClient.signOut();
        return setMe(null);
      }
      setMe(m);
    } catch (e) {
      if ((e as Error).message !== 'nao_autenticado') throw e;
      setMe(null);
    }
  }, []);
  useEffect(() => {
    load().catch(() => setError('API fora do ar (http://localhost:3000)'));
  }, [load]);

  // Convite por link: entra na sala assim que estiver logado e com perfil.
  const hasProfile = !!me?.profile;
  useEffect(() => {
    if (!hasProfile) return;
    const code = pendingInvite();
    if (!code) return;
    api<RoomEntry>('/rooms/join', { method: 'POST', body: JSON.stringify({ code }) })
      .then(setRoom)
      .catch((e: Error) => setError(roomError(e.message)));
  }, [hasProfile]);

  async function signOut() {
    await authClient.signOut();
    setMatch(null);
    setRoom(null);
    setEditing(false);
    setError(null);
    setMe(null);
  }

  async function play() {
    setJoining(true);
    setError(null);
    try {
      setMatch(await api<{ ticket: string; serverUrl: string }>('/queue', { method: 'POST', body: '{}' }));
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg === 'servidor_de_jogo_indisponivel' ? 'Servidor de jogo fora do ar (porta 4000)' : msg);
    } finally {
      setJoining(false);
    }
  }

  if (room) {
    return (
      <Lobby
        ticket={room.ticket}
        serverUrl={room.serverUrl}
        onLeave={(reason) => {
          setRoom(null);
          setError(reason ?? null);
          void load();
        }}
      />
    );
  }
  if (match) {
    return (
      <Game
        serverUrl={match.serverUrl}
        ticket={match.ticket}
        onExit={() => {
          setMatch(null);
          void load();
        }}
      />
    );
  }
  if (error && me === undefined) {
    return (
      <main className="screen center">
        <p className="banner danger">{error}</p>
      </main>
    );
  }
  if (me === undefined) {
    return (
      <main className="screen center">
        <p className="muted">Carregando…</p>
      </main>
    );
  }
  if (me === null) return <Login initialError={error} />;
  const t = me.profile ? getTorcida(me.profile.torcidaId) : undefined;
  if (!me.profile || !t || editing) {
    return (
      <EscolhaTorcida
        user={me.user}
        initialNick={me.profile?.nick ?? sanitizeNick(me.user.name)}
        initialTorcida={t?.id}
        // Sem visual salvo: começa no mesmo sorteio que aparece na partida.
        initialVisual={(me.profile && Object.keys(me.profile.visual).length ? validateVisual(me.profile.visual) : null) ?? randomVisual(visualSeed(me.user.id))}
        {...(editing ? { startStep: editing } : {})}
        onCancel={me.profile && t ? () => setEditing(false) : undefined}
        notice={error}
        onSaved={() => {
          setEditing(false);
          void load();
        }}
      />
    );
  }
  const s = me.stats;
  const rival = TORCIDAS[t.team === 0 ? 1 : 0];
  return (
    <main className="screen home">
      <header className="brand">
        <h1>Torcidas</h1>
        <p>Briga 10×10 no estacionamento do estádio</p>
      </header>

      <section className="versus">
        <div className={`vs-side ${t.team === 0 ? 'mine' : ''}`}>
          <Crest torcida={TORCIDAS[0]} size={72} />
          <b>{TORCIDAS[0].nome}</b>
        </div>
        <span className="vs">×</span>
        <div className={`vs-side ${t.team === 1 ? 'mine' : ''}`}>
          <Crest torcida={TORCIDAS[1]} size={72} />
          <b>{TORCIDAS[1].nome}</b>
        </div>
      </section>

      <section className="profile-card">
        <div className="profile-id">
          <Crest torcida={t} size={44} />
          <div>
            <b>{me.profile.nick}</b>
            <small>
              {t.nome} · contra {rival.nome}
            </small>
          </div>
          <button className="ghost" onClick={() => setEditing('visual')}>
            Visual
          </button>
          <button className="ghost" onClick={() => setEditing('nick')}>
            Editar
          </button>
        </div>
        <div className="stats">
          <div>
            <b>{s?.matches ?? 0}</b>
            <small>Partidas</small>
          </div>
          <div>
            <b>{s?.wins ?? 0}</b>
            <small>Vitórias</small>
          </div>
          <div>
            <b>{s?.kos ?? 0}</b>
            <small>Nocautes</small>
          </div>
          <div>
            <b>{s && s.deaths > 0 ? (s.kos / s.deaths).toFixed(2) : (s?.kos ?? 0)}</b>
            <small>K/M</small>
          </div>
        </div>
        <button className="primary big" onClick={play} disabled={joining}>
          {joining ? 'Entrando…' : 'Jogar'}
        </button>
        {error && <p className="banner danger">{error}</p>}
        <div className="account">
          {me.user.image && <img src={me.user.image} alt="" referrerPolicy="no-referrer" />}
          <span>{me.user.name}</span>
          <button className="ghost" onClick={signOut}>
            Sair
          </button>
        </div>
      </section>

      <Rooms
        onEnter={(r) => {
          setError(null);
          setRoom(r);
        }}
      />

      <footer className="home-tips">
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
      </footer>
    </main>
  );
}
