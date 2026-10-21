import { getTorcida, nickVariants, validateNick, validateVisual } from '@torcidas/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { auth } from '../auth';
import { db, schema } from '../db';
import { env } from '../env';
import { signMatchTicket } from '../tickets';

export async function requireUser(req: FastifyRequest) {
  const s = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  return s?.user ?? null;
}

export async function profileRoutes(app: FastifyInstance) {
  app.get('/me', async (req, reply) => {
    const user = await requireUser(req);
    if (!user) return reply.code(401).send({ error: 'nao_autenticado' });
    const [p] = await db.select().from(schema.profile).where(eq(schema.profile.userId, user.id));
    const [st] = await db.select().from(schema.stats).where(eq(schema.stats.userId, user.id));
    return {
      user: { id: user.id, name: user.name, image: user.image ?? null, anonymous: 'isAnonymous' in user && user.isAnonymous === true },
      profile: p ?? null,
      stats: st ?? null,
    };
  });

  // Checagem enquanto digita. O PUT /profile continua sendo quem decide (dois podem passar aqui ao mesmo tempo).
  app.get<{ Querystring: { nick?: string } }>('/nick/check', async (req, reply) => {
    const user = await requireUser(req);
    if (!user) return reply.code(401).send({ error: 'nao_autenticado' });
    const nick = req.query.nick ?? '';
    const invalid = validateNick(nick);
    if (invalid) return { nick, ok: false, error: invalid, suggestions: [] };
    const [owner] = await db.select({ userId: schema.profile.userId }).from(schema.profile).where(eq(schema.profile.nick, nick));
    if (!owner || owner.userId === user.id) return { nick, ok: true, suggestions: [] };
    const variants = nickVariants(nick, Math.floor(Math.random() * 1000));
    const used = await db.select({ nick: schema.profile.nick }).from(schema.profile).where(inArray(schema.profile.nick, variants));
    const usedSet = new Set(used.map((u) => u.nick));
    return { nick, ok: false, error: 'nick_em_uso', suggestions: variants.filter((v) => !usedSet.has(v)).slice(0, 3) };
  });

  app.put<{ Body: { nick?: unknown; torcidaId?: unknown } }>('/profile', async (req, reply) => {
    const user = await requireUser(req);
    if (!user) return reply.code(401).send({ error: 'nao_autenticado' });
    const { nick, torcidaId } = req.body ?? {};
    if (typeof nick !== 'string' || validateNick(nick)) return reply.code(400).send({ error: 'nick_invalido' });
    if (typeof torcidaId !== 'string' || !getTorcida(torcidaId)) return reply.code(400).send({ error: 'torcida_invalida' });
    const taken = await db.select().from(schema.profile).where(eq(schema.profile.nick, nick));
    if (taken.some((p) => p.userId !== user.id)) return reply.code(409).send({ error: 'nick_em_uso' });
    const [p] = await db
      .insert(schema.profile)
      .values({ userId: user.id, nick, torcidaId })
      .onConflictDoUpdate({ target: schema.profile.userId, set: { nick, torcidaId, updatedAt: new Date() } })
      .returning();
    await db.insert(schema.stats).values({ userId: user.id }).onConflictDoNothing();
    return { profile: p };
  });

  // Visual do personagem: separado do perfil para não rodar a checagem de nick a cada troca.
  app.put<{ Body: { visual?: unknown } }>('/profile/visual', async (req, reply) => {
    const user = await requireUser(req);
    if (!user) return reply.code(401).send({ error: 'nao_autenticado' });
    const visual = validateVisual(req.body?.visual);
    if (!visual) return reply.code(400).send({ error: 'visual_invalido' });
    const [p] = await db.update(schema.profile).set({ visual, updatedAt: new Date() }).where(eq(schema.profile.userId, user.id)).returning();
    if (!p) return reply.code(400).send({ error: 'sem_perfil' });
    return { profile: p };
  });

  // Fila: por enquanto o game server já tem as vagas preenchidas por bots, então entrar é imediato.
  // TODO(marco 5): filas por torcida no Redis e vários game servers.
  app.post('/queue', async (req, reply) => {
    const user = await requireUser(req);
    if (!user) return reply.code(401).send({ error: 'nao_autenticado' });
    const [p] = await db.select().from(schema.profile).where(eq(schema.profile.userId, user.id));
    const torcida = p && getTorcida(p.torcidaId);
    if (!p || !torcida) return reply.code(400).send({ error: 'sem_perfil' });
    if (p.bannedUntil && p.bannedUntil > new Date()) return reply.code(403).send({ error: 'banido' });
    const res = await fetch(`${env.GAME_INTERNAL_URL}/internal/allocate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': env.INTERNAL_SECRET },
      body: JSON.stringify({ team: torcida.team }),
    }).catch(() => null);
    if (!res?.ok) return reply.code(503).send({ error: 'servidor_de_jogo_indisponivel' });
    const { matchId } = (await res.json()) as { matchId: string };
    // Perfil que nunca escolheu visual ({}) vai sem: o cliente sorteia um pelo id, como nos bots.
    const visual = Object.keys(p.visual).length ? (validateVisual(p.visual) ?? undefined) : undefined;
    const ticket = await signMatchTicket({ userId: user.id, matchId, team: torcida.team, nick: p.nick, serverUrl: env.GAME_PUBLIC_URL, ...(visual ? { visual } : {}) });
    return { ticket, serverUrl: env.GAME_PUBLIC_URL, matchId };
  });

  app.post<{ Body: { players?: { userId: string; kos: number; deaths: number; assists: number; won: boolean }[] } }>(
    '/internal/match-result',
    async (req, reply) => {
      if (req.headers['x-internal-secret'] !== env.INTERNAL_SECRET) return reply.code(403).send({ error: 'proibido' });
      const n = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < 10_000 ? (v as number) : 0);
      for (const pl of req.body?.players ?? []) {
        if (typeof pl.userId !== 'string') continue;
        await db
          .insert(schema.stats)
          .values({ userId: pl.userId, matches: 1, wins: pl.won ? 1 : 0, kos: n(pl.kos), deaths: n(pl.deaths), assists: n(pl.assists) })
          .onConflictDoUpdate({
            target: schema.stats.userId,
            set: {
              matches: sql`${schema.stats.matches} + 1`,
              wins: sql`${schema.stats.wins} + ${pl.won ? 1 : 0}`,
              kos: sql`${schema.stats.kos} + ${n(pl.kos)}`,
              deaths: sql`${schema.stats.deaths} + ${n(pl.deaths)}`,
              assists: sql`${schema.stats.assists} + ${n(pl.assists)}`,
            },
          });
      }
      return { ok: true };
    },
  );
}
