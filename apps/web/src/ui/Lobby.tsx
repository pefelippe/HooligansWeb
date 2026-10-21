import { type LobbyClientMessage, type LobbyServerMessage, PROTOCOL_VERSION, ROOM, type RoomInfo, type TeamSide, TORCIDAS } from '@torcidas/shared';
import { useEffect, useRef, useState } from 'react';
import { Game } from './Game';
import { Crest } from './kit';

interface Props {
  ticket: string;
  serverUrl: string;
  /** Saiu da sala (botão Sair, expulso, sala fechou). `reason` vira aviso na home. */
  onLeave: (reason?: string) => void;
}

const CLOSE_REASONS: Record<number, string> = {
  4009: 'Você foi expulso da sala',
  4005: 'Essa sala não existe mais',
  4006: 'A sala está cheia para a sua torcida',
  4010: 'Você entrou nesta sala em outra aba',
  4004: 'Convite expirado: entre na sala de novo',
};

const ERRORS: Record<string, string> = {
  so_o_lider: 'Só o líder pode fazer isso',
  ja_em_partida: 'A partida já começou',
  sem_jogadores: 'Precisa de alguém na sala',
  invalido: 'Ação inválida',
};

/** Lobby da sala: lista por torcida, bots, expulsar, começar. A partida abre por cima e volta para cá. */
export function Lobby({ ticket, serverUrl, onLeave }: Props) {
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [you, setYou] = useState('');
  const [match, setMatch] = useState<{ ticket: string; serverUrl: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const ws = useRef<WebSocket | null>(null);
  const leaving = useRef(false);
  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;

  useEffect(() => {
    const sock = new WebSocket(serverUrl);
    ws.current = sock;
    sock.onopen = () => sock.send(JSON.stringify({ t: 'helloLobby', v: PROTOCOL_VERSION, ticket } satisfies LobbyClientMessage));
    sock.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as LobbyServerMessage;
      if (msg.t === 'room') {
        setRoom(msg.room);
        setYou(msg.you);
      } else if (msg.t === 'matchStart') setMatch({ ticket: msg.ticket, serverUrl: msg.serverUrl });
      else if (msg.t === 'error') {
        setToast(ERRORS[msg.code] ?? msg.code);
        setTimeout(() => setToast(null), 2500);
      }
    };
    sock.onclose = (ev) => {
      if (ws.current !== sock || leaving.current) return;
      onLeaveRef.current(CLOSE_REASONS[ev.code] ?? 'Conexão com a sala caiu');
    };
    return () => {
      if (ws.current === sock) ws.current = null;
      sock.close();
    };
  }, [ticket, serverUrl]);

  const send = (msg: LobbyClientMessage) => ws.current?.readyState === WebSocket.OPEN && ws.current.send(JSON.stringify(msg));

  // key: um ticket novo (próxima partida, voltar para a partida) monta o Game do zero, sem o resultado anterior.
  if (match) return <Game key={match.ticket} serverUrl={match.serverUrl} ticket={match.ticket} onExit={() => setMatch(null)} />;

  if (!room) {
    return (
      <main className="screen center">
        <p className="muted">Entrando na sala…</p>
      </main>
    );
  }

  const isLeader = room.liderId === you;
  const link = `${window.location.origin}${window.location.pathname}?sala=${room.code}`;

  function leave() {
    leaving.current = true;
    ws.current?.close();
    onLeave();
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setToast('Não deu para copiar: o código é ' + room?.code);
    }
  }

  const team = (t: TeamSide) => {
    const torcida = TORCIDAS[t];
    const players = room.players.filter((p) => p.team === t);
    const bots = room.bots[t];
    const max = ROOM.maxPerTeam - players.length;
    return (
      <section key={t} className={`lobby-team ${t === room.players.find((p) => p.id === you)?.team ? 'mine' : ''}`}>
        <header>
          <Crest torcida={torcida} size={36} />
          <b>{torcida.nome}</b>
          <small>
            {players.length + bots}/{ROOM.maxPerTeam}
          </small>
        </header>
        <ul>
          {players.map((p) => (
            <li key={p.id}>
              <span className="lobby-nick">
                {p.nick}
                {p.id === room.liderId && <em className="tag gold">líder</em>}
                {p.id === you && <em className="tag">você</em>}
              </span>
              {isLeader && p.id !== you && (
                <button className="ghost danger-text" onClick={() => send({ t: 'kick', userId: p.id })}>
                  Expulsar
                </button>
              )}
            </li>
          ))}
          {players.length === 0 && <li className="muted">Ninguém ainda</li>}
        </ul>
        <div className="lobby-bots">
          <span>Bots</span>
          {isLeader ? (
            <div className="stepper-num">
              <button className="secondary" aria-label="Menos um bot" disabled={bots <= 0} onClick={() => send({ t: 'setBots', team: t, count: bots - 1 })}>
                −
              </button>
              <b>{bots}</b>
              <button className="secondary" aria-label="Mais um bot" disabled={bots >= max} onClick={() => send({ t: 'setBots', team: t, count: bots + 1 })}>
                +
              </button>
              <button className="ghost" disabled={bots >= max} onClick={() => send({ t: 'setBots', team: t, count: max })}>
                Completar
              </button>
            </div>
          ) : (
            <b>{bots}</b>
          )}
        </div>
      </section>
    );
  };

  return (
    <main className="screen home lobby">
      <header className="lobby-head">
        <div>
          <h2>{room.nome}</h2>
          <p className="muted">
            {room.players.length} {room.players.length === 1 ? 'pessoa' : 'pessoas'} · {room.players.length + room.bots[0] + room.bots[1]}/{ROOM.maxPlayers} lutadores
          </p>
        </div>
        <div className="lobby-code">
          <small>Código</small>
          <b>{room.code}</b>
          <button className="secondary" onClick={copyLink}>
            {copied ? 'Link copiado!' : 'Copiar convite'}
          </button>
        </div>
      </header>

      <div className="lobby-visibility">
        {isLeader ? (
          <button className="ghost" onClick={() => send({ t: 'setPublic', publica: !room.publica })}>
            {room.publica ? 'Pública (aparece na lista) · tornar privada' : 'Privada (só com o código) · tornar pública'}
          </button>
        ) : (
          <span className="muted">{room.publica ? 'Sala pública' : 'Sala privada'}</span>
        )}
      </div>

      <div className="lobby-teams">{([0, 1] as const).map(team)}</div>

      <section className="profile-card lobby-actions">
        {room.fase === 'playing' ? (
          <>
            <p className="banner">Partida em andamento.</p>
            <button className="primary big" onClick={() => send({ t: 'rejoin' })}>
              Voltar para a partida
            </button>
          </>
        ) : isLeader ? (
          <button className="primary big" onClick={() => send({ t: 'start' })}>
            Começar partida
          </button>
        ) : (
          <p className="muted center-text">Esperando o líder começar…</p>
        )}
        <button className="ghost" onClick={leave}>
          Sair da sala
        </button>
        {toast && (
          <p className="banner danger" role="alert">
            {toast}
          </p>
        )}
      </section>
    </main>
  );
}
