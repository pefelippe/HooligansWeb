import cors from '@fastify/cors';
import Fastify from 'fastify';
import { auth } from './auth';
import { env } from './env';
import { profileRoutes } from './routes/profile';
import { roomRoutes } from './routes/rooms';

const app = Fastify({ logger: true });

await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true, methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] });

app.get('/health', async () => ({ ok: true }));

// Better Auth recebe Request/Response padrão (Fetch API); adapta a partir do Fastify.
app.route({
  method: ['GET', 'POST'],
  url: '/api/auth/*',
  async handler(request, reply) {
    const url = new URL(request.url, env.BETTER_AUTH_URL);
    const headers = new Headers();
    for (const [k, v] of Object.entries(request.headers)) if (v) headers.append(k, v.toString());
    const res = await auth.handler(
      new Request(url, { method: request.method, headers, body: request.body ? JSON.stringify(request.body) : undefined }),
    );
    reply.status(res.status);
    res.headers.forEach((value, key) => reply.header(key, value));
    return reply.send(res.body ? await res.text() : null);
  },
});

await app.register(profileRoutes);
await app.register(roomRoutes);

await app.listen({ port: env.PORT, host: '0.0.0.0' });
