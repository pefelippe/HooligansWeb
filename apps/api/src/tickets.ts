import type { MatchTicketClaims, RoomTicketClaims } from '@torcidas/shared';
import { SignJWT } from 'jose';
import { env } from './env';

const key = new TextEncoder().encode(env.MATCH_TICKET_SECRET);

/** Ticket de curta duração que o cliente apresenta ao game server ao conectar. */
export function signMatchTicket(claims: MatchTicketClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime('2m')
    .sign(key);
}

/** Ticket do lobby de uma sala (WebSocket do lobby no game server). */
export function signRoomTicket(claims: RoomTicketClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime('2m')
    .sign(key);
}
