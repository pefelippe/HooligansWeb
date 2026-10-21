import { getTorcida, ROOM, validateVisual } from '@torcidas/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { db, schema } from '../db';
import { env } from '../env';
import { signRoomTicket } from '../tickets';
import { requireUser } from './profile';

// Salas: a API autentica, confere o perfil e assina o ticket do lobby; a sala vive no game server.

async function game(path: string, init: { method: 'GET' | 'POST'; body?: unknown }) {
  const res = await fetch(`${env.GAME_INTERNAL_URL}${path}`, {
    method: init.method,
    headers: { 'content-type': 'application/json', 'x-internal-secret': env.INTERNAL_SECRET },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  }).catch(() => null);
  if (!res) return { ok: false as const, status: 503, body: { error: 'servidor_de_jogo_indisponivel' } };
  return { ok: res.ok, status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

export async function roomRoutes(app: FastifyInstance) {
  /** Usuário logado com perfil completo (precisa da torcida para saber o time). */
  async function player(req: Parameters<typeof requireUser>[0], reply: FastifyReply) {
    const user = await requireUser(req);
    if (!user) return void reply.code(401).send({ error: 'nao_autenticado' });
    const [p] = await db.select().from(schema.profile).where(eq(schema.profile.userId, user.id));
    const torcida = p && getTorcida(p.torcidaId);
    if (!p || !torcida) return void reply.code(400).send({ error: 'sem_perfil' });
    if (p.bannedUntil && p.bannedUntil > new Date()) return void reply.code(403).send({ error: 'banido' });
    const visual = Object.keys(p.visual).length ? (validateVisual(p.visual) ?? undefined) : undefined;
    return { userId: user.id, nick: p.nick, team: torcida.team, ...(visual ? { visual } : {}) };
  }

  async function ticketFor(pl: NonNullable<Awaited<ReturnType<typeof player>>>, roomId: string) {
    return signRoomTicket({ kind: 'room', roomId, ...pl });
  }

  app.get('/rooms', async (req, reply) => {
    if (!(await requireUser(req))) return reply.code(401).send({ error: 'nao_autenticado' });
    const r = await game('/internal/rooms', { method: 'GET' });
    return reply.code(r.ok ? 200 : r.status).send(r.body);
  });

  app.post<{ Body: { nome?: unknown; publica?: unknown } }>('/rooms', async (req, reply) => {
    const pl = await player(req, reply);
    if (!pl) return reply;
    const raw = typeof req.body?.nome === 'string' ? req.body.nome.trim().replace(/\s+/g, ' ') : '';
    const nome = raw || `Sala de ${pl.nick}`;
    if (nome.length < ROOM.nameMin || nome.length > ROOM.nameMax) return reply.code(400).send({ error: 'nome_invalido' });
    const r = await game('/internal/rooms', { method: 'POST', body: { nome, publica: req.body?.publica === true, leaderId: pl.userId } });
    if (!r.ok) return reply.code(r.status).send(r.body);
    const { roomId, code } = r.body as { roomId: string; code: string };
    return { code, ticket: await ticketFor(pl, roomId), serverUrl: env.GAME_PUBLIC_URL };
  });

  app.post<{ Body: { code?: unknown } }>('/rooms/join', async (req, reply) => {
    const pl = await player(req, reply);
    if (!pl) return reply;
    if (typeof req.body?.code !== 'string' || !req.body.code.trim()) return reply.code(400).send({ error: 'codigo_invalido' });
    const r = await game('/internal/rooms/check', { method: 'POST', body: { code: req.body.code, userId: pl.userId, team: pl.team } });
    if (!r.ok) return reply.code(r.status).send(r.body);
    const { roomId, code } = r.body as { roomId: string; code: string };
    return { code, ticket: await ticketFor(pl, roomId), serverUrl: env.GAME_PUBLIC_URL };
  });
}
